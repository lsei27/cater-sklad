import { describe, expect, it } from "vitest";
import { EventStatus, LedgerReason, Role, type Prisma } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { createExportTx } from "../src/services/export.js";
import { getPhysicalTotal } from "../src/services/availability.js";
import { getIssuedDaysTx, issueDayTx } from "../src/services/issueDay.js";
import { issueAdditionalTx } from "../src/services/issueAdditional.js";
import { returnCloseTx } from "../src/services/returnClose.js";

type TestPrisma = ReturnType<typeof createTestPrisma>["prisma"];

async function setup(prisma: TestPrisma, opts: { days: 1 | 3 }) {
  const stamp = fixtureStamp();
  const user = await prisma.user.create({ data: { email: `issday-${stamp}@local`, passwordHash: "x", role: Role.admin } });
  const warehouse = await prisma.warehouse.create({ data: { name: `Sklad-issday-${stamp}` } });
  const parent = await prisma.category.create({ data: { name: `Kuchyn-issday-${stamp}` } });
  const child = await prisma.category.create({ data: { name: `Zidle-issday-${stamp}`, parentId: parent.id } });
  const item = await prisma.inventoryItem.create({
    data: { name: `Zidle-${stamp}`, categoryId: child.id, unit: "ks", warehouseId: warehouse.id }
  });
  await prisma.inventoryLedger.create({
    data: {
      inventoryItemId: item.id,
      deltaQuantity: 200,
      reason: LedgerReason.audit_adjustment,
      warehouseId: warehouse.id,
      createdById: user.id
    }
  });
  const event = await prisma.event.create({
    data: {
      name: `Issday-${stamp}`,
      location: "L",
      eventDate: new Date("2030-11-05T00:00:00Z"),
      eventEndDate: new Date(opts.days === 3 ? "2030-11-07T00:00:00Z" : "2030-11-05T00:00:00Z"),
      deliveryDatetime: new Date("2030-11-05T07:00:00Z"),
      pickupDatetime: new Date(opts.days === 3 ? "2030-11-07T17:00:00Z" : "2030-11-05T17:00:00Z"),
      status: EventStatus.READY_FOR_WAREHOUSE,
      createdById: user.id
    }
  });
  await prisma.eventReservation.create({
    data: { eventId: event.id, inventoryItemId: item.id, reservedQuantity: 50, state: "confirmed" }
  });
  if (opts.days === 3) {
    await prisma.eventReservation.create({
      data: { eventId: event.id, inventoryItemId: item.id, reservedQuantity: 70, state: "confirmed", dayFrom: 2, dayTo: 2 }
    });
  }
  await prisma.$transaction((tx) => createExportTx({ tx, eventId: event.id, userId: user.id }));

  const issue = (day: number) =>
    prisma.$transaction((tx) => issueDayTx({ tx, eventId: event.id, userId: user.id, day, idempotencyKey: `t-${stamp}` }));
  const issueRows = () =>
    prisma.eventIssue.findMany({
      where: { eventId: event.id, type: "issued" },
      orderBy: { issuedAt: "asc" },
      select: { issuedQuantity: true, dayFrom: true, dayTo: true }
    });
  return { stamp, user, warehouse, item, event, issue, issueRows };
}

describe("výdej po dnech (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("den 1 vydá jen řádky začínající dnem 1 a přepne akci na Vydáno", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });

    const res = await f.issue(1);

    expect(res.alreadyIssued).toBe(false);
    expect(res.event.status).toBe(EventStatus.ISSUED);
    expect(await f.issueRows()).toEqual([{ issuedQuantity: 50, dayFrom: 1, dayTo: null }]);
    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(150);
    await disconnect();
  });

  maybe("další den jde vydat i ve stavu Vydáno", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });
    await f.issue(1);

    await f.issue(2);

    expect(await f.issueRows()).toEqual([
      { issuedQuantity: 50, dayFrom: 1, dayTo: null },
      { issuedQuantity: 70, dayFrom: 2, dayTo: 2 }
    ]);
    expect(await getIssuedDaysTx(prisma, f.event.id)).toEqual([1, 2]);
    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(80);
    await disconnect();
  });

  maybe("explicitní day_to rovné poslednímu dni se uloží jako NULL", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });

    await prisma.$transaction((tx) =>
      issueDayTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        day: 1,
        idempotencyKey: `t-${f.stamp}`,
        items: [{ inventory_item_id: f.item.id, issued_quantity: 50, day_to: 3 }]
      })
    );

    expect(await f.issueRows()).toEqual([{ issuedQuantity: 50, dayFrom: 1, dayTo: null }]);
    await disconnect();
  });

  maybe("explicitní day_to menší než den se odmítne jako INVALID_DAY", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });

    await expect(
      prisma.$transaction((tx) =>
        issueDayTx({
          tx,
          eventId: f.event.id,
          userId: f.user.id,
          day: 2,
          idempotencyKey: `t-${f.stamp}`,
          items: [{ inventory_item_id: f.item.id, issued_quantity: 70, day_to: 1 }]
        })
      )
    ).rejects.toThrow("INVALID_DAY");
    await disconnect();
  });

  maybe("opakovaný výdej téhož dne nic nezapíše", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });
    await f.issue(1);

    const again = await f.issue(1);

    expect(again.alreadyIssued).toBe(true);
    expect(await f.issueRows()).toHaveLength(1);
    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(150);
    await disconnect();
  });

  maybe("den mimo akci se odmítne", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });

    await expect(f.issue(4)).rejects.toThrow("INVALID_DAY");
    await disconnect();
  });

  maybe("výdej dne smaže jen balení toho dne", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });
    await prisma.eventPacking.createMany({
      data: [
        { eventId: f.event.id, inventoryItemId: f.item.id, dayFrom: 1, dayTo: null, state: "confirmed", updatedById: f.user.id },
        { eventId: f.event.id, inventoryItemId: f.item.id, dayFrom: 2, dayTo: 2, state: "confirmed", updatedById: f.user.id }
      ]
    });

    await f.issue(1);

    const left = await prisma.eventPacking.findMany({ where: { eventId: f.event.id }, select: { dayFrom: true } });
    expect(left).toEqual([{ dayFrom: 2 }]);
    await disconnect();
  });

  maybe("doplňkový výdej nevytvoří vydaný den", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });
    await f.issue(1);
    await prisma.$transaction((tx) =>
      issueAdditionalTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        idempotencyKey: `add-${f.stamp}`,
        items: [{ inventoryItemId: f.item.id, qty: 5 }]
      })
    );

    expect(await getIssuedDaysTx(prisma, f.event.id)).toEqual([1]);
    await disconnect();
  });

  maybe("starý výdej se bere jako vydaný den 1", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 1 });
    // Stav po migraci: akce vydaná starým kódem má řádky s day_from = 1.
    await prisma.eventIssue.create({
      data: {
        eventId: f.event.id,
        inventoryItemId: f.item.id,
        issuedQuantity: 50,
        type: "issued",
        issuedById: f.user.id,
        warehouseId: f.warehouse.id,
        dayFrom: 1,
        idempotencyKey: `legacy-${f.stamp}`
      }
    });
    await prisma.event.update({ where: { id: f.event.id }, data: { status: EventStatus.ISSUED } });

    const res = await f.issue(1);
    expect(res.alreadyIssued).toBe(true);
    await disconnect();
  });

  maybe("snapshot bez dnů se vydá jako den 1", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 1 });
    // Export vytvořený před nasazením nemá dayFrom/dayTo ani dayCount.
    const latest = await prisma.eventExport.findFirstOrThrow({ where: { eventId: f.event.id }, orderBy: { version: "desc" } });
    const snap = latest.snapshotJson as { event: Record<string, unknown>; groups: Array<{ items: Array<Record<string, unknown>> }> };
    delete snap.event.dayCount;
    for (const g of snap.groups) for (const i of g.items) { delete i.dayFrom; delete i.dayTo; }
    await prisma.eventExport.update({ where: { id: latest.id }, data: { snapshotJson: snap as unknown as Prisma.InputJsonValue } });

    await f.issue(1);
    expect(await f.issueRows()).toEqual([{ issuedQuantity: 50, dayFrom: 1, dayTo: null }]);
    await disconnect();
  });

  maybe("uzavření sečte výdej všech dnů", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { days: 3 });
    await f.issue(1);
    await f.issue(2);

    await prisma.$transaction((tx) =>
      returnCloseTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        idempotencyKey: `close-${f.stamp}`,
        items: [{ inventory_item_id: f.item.id, returned_quantity: 120, broken_quantity: 0, target_warehouse_id: f.warehouse.id }]
      })
    );

    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(200);
    await disconnect();
  });
});

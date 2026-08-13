import { describe, expect, it } from "vitest";
import { Role, LedgerReason, EventStatus } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { createInventoryLedgerEntry } from "../src/services/ledger.js";
import { getPhysicalTotal } from "../src/services/availability.js";
import { issueAdditionalTx } from "../src/services/issueAdditional.js";
import { returnCloseTx } from "../src/services/returnClose.js";

type TestPrisma = ReturnType<typeof createTestPrisma>["prisma"];
type Fixture = Awaited<ReturnType<typeof makeFixture>>;

async function makeFixture(prisma: TestPrisma, status: EventStatus) {
  const stamp = fixtureStamp();
  const user = await prisma.user.create({
    data: { email: `add-${stamp}@local`, passwordHash: "x", role: Role.admin }
  });
  const warehouse = await prisma.warehouse.create({ data: { name: `SkladA-${stamp}` } });
  const parent = await prisma.category.create({ data: { name: `InventarA-${stamp}` } });
  const child = await prisma.category.create({ data: { name: `SkloA-${stamp}`, parentId: parent.id } });
  const item = await prisma.inventoryItem.create({
    data: { name: `SkleniceA-${stamp}`, categoryId: child.id, unit: "ks", warehouseId: warehouse.id }
  });
  await prisma.inventoryLedger.create({
    data: {
      inventoryItemId: item.id,
      deltaQuantity: 50,
      reason: LedgerReason.audit_adjustment,
      warehouseId: warehouse.id,
      createdById: user.id
    }
  });
  const event = await prisma.event.create({
    data: {
      name: `AkceA-${stamp}`,
      location: "Praha",
      deliveryDatetime: new Date("2026-09-01T08:00:00Z"),
      pickupDatetime: new Date("2026-09-02T08:00:00Z"),
      status,
      createdById: user.id
    }
  });
  return { stamp, user, warehouse, item, event };
}

async function issueOriginal(prisma: TestPrisma, f: Fixture, qty: number) {
  await prisma.eventIssue.create({
    data: {
      eventId: f.event.id,
      inventoryItemId: f.item.id,
      issuedQuantity: qty,
      type: "issued",
      warehouseId: f.warehouse.id,
      issuedById: f.user.id,
      idempotencyKey: `orig:${f.event.id}:${f.item.id}`
    }
  });
  await createInventoryLedgerEntry(prisma, {
    inventoryItemId: f.item.id,
    deltaQuantity: -qty,
    reason: LedgerReason.issue,
    eventId: f.event.id,
    warehouseId: f.warehouse.id,
    createdById: f.user.id,
    note: "Výdej na akci"
  });
}

describe("doplnkovy vydej (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("prida dalsi radek vydeje a odepise ze skladu", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const f = await makeFixture(prisma, EventStatus.ISSUED);
    await issueOriginal(prisma, f, 10);
    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(40);

    await prisma.$transaction((tx) =>
      issueAdditionalTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        idempotencyKey: `add-${f.stamp}`,
        items: [{ inventoryItemId: f.item.id, qty: 4 }]
      })
    );

    const issues = await prisma.eventIssue.findMany({
      where: { eventId: f.event.id, inventoryItemId: f.item.id, type: "issued" }
    });
    expect(issues).toHaveLength(2);
    expect(issues.reduce((s, i) => s + i.issuedQuantity, 0)).toBe(14);
    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(36);

    await disconnect();
  });

  maybe("uzavreni akce secte oba vydeje", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const f = await makeFixture(prisma, EventStatus.ISSUED);
    await issueOriginal(prisma, f, 10);
    await prisma.$transaction((tx) =>
      issueAdditionalTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        idempotencyKey: `add2-${f.stamp}`,
        items: [{ inventoryItemId: f.item.id, qty: 4 }]
      })
    );

    // Vydano celkem 14, vrati se 12, jedna rozbita, jedna chybi.
    await prisma.$transaction((tx) =>
      returnCloseTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        idempotencyKey: `close-${f.stamp}`,
        items: [
          {
            inventory_item_id: f.item.id,
            returned_quantity: 12,
            broken_quantity: 1,
            target_warehouse_id: f.warehouse.id
          }
        ]
      })
    );

    const losses = await prisma.eventIssue.findMany({
      where: { eventId: f.event.id, type: { in: ["broken", "missing"] } }
    });
    expect(losses.map((l) => [l.type, l.issuedQuantity]).sort()).toEqual([
      ["broken", 1],
      ["missing", 1]
    ]);
    // 50 na sklade, 14 vydano, 12 vraceno.
    expect(await getPhysicalTotal(prisma, f.item.id)).toBe(48);

    await disconnect();
  });

  maybe("prepocita vahu akce z celeho vydeje", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const f = await makeFixture(prisma, EventStatus.ISSUED);
    // Baleni po 10 kusech po 8.5 kg: 6 + 3 kusy je 9, tedy jedno baleni.
    await prisma.inventoryItem.update({
      where: { id: f.item.id },
      data: { masterPackageQty: 10, masterPackageWeight: "8.5" }
    });
    await issueOriginal(prisma, f, 6);

    const result = await prisma.$transaction((tx) =>
      issueAdditionalTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        idempotencyKey: `weight-${f.stamp}`,
        palletCount: 2,
        items: [{ inventoryItemId: f.item.id, qty: 3 }]
      })
    );

    expect(result.totalWeight).toBe("8,5 kg");
    const updated = await prisma.event.findUniqueOrThrow({ where: { id: f.event.id } });
    expect(updated.totalWeight).toBe("8,5 kg");
    expect(updated.palletCount).toBe(2);

    await disconnect();
  });

  maybe("bez zadaneho poctu palet zustane puvodni hodnota", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const f = await makeFixture(prisma, EventStatus.ISSUED);
    await prisma.event.update({ where: { id: f.event.id }, data: { palletCount: 5 } });
    await issueOriginal(prisma, f, 2);

    await prisma.$transaction((tx) =>
      issueAdditionalTx({
        tx,
        eventId: f.event.id,
        userId: f.user.id,
        idempotencyKey: `nopallet-${f.stamp}`,
        items: [{ inventoryItemId: f.item.id, qty: 1 }]
      })
    );

    const updated = await prisma.event.findUniqueOrThrow({ where: { id: f.event.id } });
    expect(updated.palletCount).toBe(5);

    await disconnect();
  });

  maybe("odmitne vydej nad ramec dostupne zasoby", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const f = await makeFixture(prisma, EventStatus.ISSUED);
    await issueOriginal(prisma, f, 10);

    await expect(
      prisma.$transaction((tx) =>
        issueAdditionalTx({
          tx,
          eventId: f.event.id,
          userId: f.user.id,
          idempotencyKey: `over-${f.stamp}`,
          items: [{ inventoryItemId: f.item.id, qty: 999 }]
        })
      )
    ).rejects.toThrow("INSUFFICIENT_STOCK");

    await disconnect();
  });

  maybe("odmitne akci, ktera neni ve stavu ISSUED", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const f = await makeFixture(prisma, EventStatus.SENT_TO_WAREHOUSE);

    await expect(
      prisma.$transaction((tx) =>
        issueAdditionalTx({
          tx,
          eventId: f.event.id,
          userId: f.user.id,
          idempotencyKey: `bad-${f.stamp}`,
          items: [{ inventoryItemId: f.item.id, qty: 1 }]
        })
      )
    ).rejects.toThrow("BAD_STATUS");

    await disconnect();
  });
});

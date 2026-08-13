import { describe, expect, it } from "vitest";
import { Role, LedgerReason, EventStatus } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { createInventoryLedgerEntry } from "../src/services/ledger.js";
import { getAvailabilityForEventItemTx, getPhysicalTotal } from "../src/services/availability.js";
import { returnCloseTx } from "../src/services/returnClose.js";

describe("spotřební zboží a prodleva návratu (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("nevrácený zbytek u spotřebního zboží je spotřeba, u inventáře manko", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const stamp = fixtureStamp();
    const user = await prisma.user.create({
      data: { email: `consum-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const warehouse = await prisma.warehouse.create({ data: { name: `Sklad-${stamp}` } });
    const parent = await prisma.category.create({ data: { name: `Zbozi-${stamp}` } });
    const child = await prisma.category.create({ data: { name: `Napoje-${stamp}`, parentId: parent.id } });

    const wine = await prisma.inventoryItem.create({
      data: { name: `Vino-${stamp}`, categoryId: child.id, unit: "ks", warehouseId: warehouse.id, consumable: true }
    });
    const glass = await prisma.inventoryItem.create({
      data: { name: `Sklenice-${stamp}`, categoryId: child.id, unit: "ks", warehouseId: warehouse.id, consumable: false }
    });

    const event = await prisma.event.create({
      data: {
        name: `Akce-${stamp}`,
        location: "Praha",
        deliveryDatetime: new Date("2026-03-01T08:00:00Z"),
        pickupDatetime: new Date("2026-03-02T08:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });

    for (const item of [wine, glass]) {
      await prisma.inventoryLedger.create({
        data: {
          inventoryItemId: item.id,
          deltaQuantity: 10,
          reason: LedgerReason.audit_adjustment,
          warehouseId: warehouse.id,
          createdById: user.id
        }
      });
      await prisma.eventIssue.create({
        data: {
          eventId: event.id,
          inventoryItemId: item.id,
          issuedQuantity: 10,
          type: "issued",
          warehouseId: warehouse.id,
          issuedById: user.id,
          idempotencyKey: `issued:${event.id}:${item.id}`
        }
      });
      await createInventoryLedgerEntry(prisma, {
        inventoryItemId: item.id,
        deltaQuantity: -10,
        reason: LedgerReason.issue,
        eventId: event.id,
        warehouseId: warehouse.id,
        createdById: user.id,
        note: "Výdej na akci"
      });
    }

    // Vína se vrátily 3 z 10, sklenic 8 z 10 a jedna se rozbila.
    await prisma.$transaction((tx) =>
      returnCloseTx({
        tx,
        eventId: event.id,
        userId: user.id,
        idempotencyKey: `close-${stamp}`,
        items: [
          { inventory_item_id: wine.id, returned_quantity: 3, broken_quantity: 0, target_warehouse_id: warehouse.id },
          { inventory_item_id: glass.id, returned_quantity: 8, broken_quantity: 1, target_warehouse_id: warehouse.id }
        ]
      })
    );

    const wineIssues = await prisma.eventIssue.findMany({
      where: { eventId: event.id, inventoryItemId: wine.id, type: { not: "issued" } }
    });
    expect(wineIssues).toHaveLength(1);
    expect(wineIssues[0]?.type).toBe("consumed");
    expect(wineIssues[0]?.issuedQuantity).toBe(7);

    const glassIssues = await prisma.eventIssue.findMany({
      where: { eventId: event.id, inventoryItemId: glass.id, type: { not: "issued" } }
    });
    expect(glassIssues.map((i) => [i.type, i.issuedQuantity]).sort()).toEqual([
      ["broken", 1],
      ["missing", 1]
    ]);

    // Ztráty ani spotřeba nesmí generovat další skladový pohyb, výdej je odepsal už dřív.
    const lossLedger = await prisma.inventoryLedger.findMany({
      where: {
        eventId: event.id,
        reason: { in: [LedgerReason.writeoff, LedgerReason.breakage, LedgerReason.missing] }
      }
    });
    expect(lossLedger).toHaveLength(0);

    // 10 na skladě, 10 vydáno, 3 zpět: zůstávají 3 kusy.
    expect(await getPhysicalTotal(prisma, wine.id)).toBe(3);
    // 10 na skladě, 10 vydáno, 8 zpět, 1 rozbitá, 1 chybí: zůstává 8 kusů.
    expect(await getPhysicalTotal(prisma, glass.id)).toBe(8);

    await disconnect();
  });

  maybe("vydaná položka je volná až po uplynutí return_delay_days od svozu", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const stamp = fixtureStamp();
    const user = await prisma.user.create({
      data: { email: `delay-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const warehouse = await prisma.warehouse.create({ data: { name: `Sklad-d-${stamp}` } });
    const parent = await prisma.category.create({ data: { name: `Inventar-d-${stamp}` } });
    const child = await prisma.category.create({ data: { name: `Sklo-d-${stamp}`, parentId: parent.id } });

    const item = await prisma.inventoryItem.create({
      data: {
        name: `Talir-${stamp}`,
        categoryId: child.id,
        unit: "ks",
        warehouseId: warehouse.id,
        returnDelayDays: 1
      }
    });
    await prisma.inventoryLedger.create({
      data: {
        inventoryItemId: item.id,
        deltaQuantity: 10,
        reason: LedgerReason.audit_adjustment,
        warehouseId: warehouse.id,
        createdById: user.id
      }
    });

    const issued = await prisma.event.create({
      data: {
        name: `Probiha-${stamp}`,
        location: "L",
        deliveryDatetime: new Date("2026-04-01T08:00:00Z"),
        pickupDatetime: new Date("2026-04-02T08:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });
    await prisma.eventIssue.create({
      data: {
        eventId: issued.id,
        inventoryItemId: item.id,
        issuedQuantity: 10,
        type: "issued",
        warehouseId: warehouse.id,
        issuedById: user.id,
        idempotencyKey: `issued:${issued.id}:${item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: item.id,
      deltaQuantity: -10,
      reason: LedgerReason.issue,
      eventId: issued.id,
      warehouseId: warehouse.id,
      createdById: user.id,
      note: "Výdej na akci"
    });

    // Akce začínající pár hodin po svozu: prodleva 1 dne ještě neuplynula.
    const tooSoon = await prisma.event.create({
      data: {
        name: `Brzy-${stamp}`,
        location: "L",
        deliveryDatetime: new Date("2026-04-02T12:00:00Z"),
        pickupDatetime: new Date("2026-04-02T18:00:00Z"),
        status: EventStatus.DRAFT,
        createdById: user.id
      }
    });
    const soon = await prisma.$transaction((tx) => getAvailabilityForEventItemTx(tx, tooSoon.id, item.id));
    expect(soon.physicalTotal).toBe(0);

    // Akce další den po svozu: prodleva uplynula, kusy se počítají jako volné.
    const laterEvent = await prisma.event.create({
      data: {
        name: `Pozdeji-${stamp}`,
        location: "L",
        deliveryDatetime: new Date("2026-04-03T12:00:00Z"),
        pickupDatetime: new Date("2026-04-03T18:00:00Z"),
        status: EventStatus.DRAFT,
        createdById: user.id
      }
    });
    const later = await prisma.$transaction((tx) => getAvailabilityForEventItemTx(tx, laterEvent.id, item.id));
    expect(later.physicalTotal).toBe(10);

    await disconnect();
  });

  maybe("spotřební zboží se nikdy nepočítá jako virtuální návrat", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const stamp = fixtureStamp();
    const user = await prisma.user.create({
      data: { email: `virt-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const warehouse = await prisma.warehouse.create({ data: { name: `Sklad-v-${stamp}` } });
    const parent = await prisma.category.create({ data: { name: `Zbozi-v-${stamp}` } });
    const child = await prisma.category.create({ data: { name: `Napoje-v-${stamp}`, parentId: parent.id } });

    const item = await prisma.inventoryItem.create({
      data: { name: `Kava-${stamp}`, categoryId: child.id, unit: "ks", warehouseId: warehouse.id, consumable: true }
    });
    await prisma.inventoryLedger.create({
      data: {
        inventoryItemId: item.id,
        deltaQuantity: 10,
        reason: LedgerReason.audit_adjustment,
        warehouseId: warehouse.id,
        createdById: user.id
      }
    });

    const issued = await prisma.event.create({
      data: {
        name: `Probiha-v-${stamp}`,
        location: "L",
        deliveryDatetime: new Date("2026-05-01T08:00:00Z"),
        pickupDatetime: new Date("2026-05-02T08:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });
    await prisma.eventIssue.create({
      data: {
        eventId: issued.id,
        inventoryItemId: item.id,
        issuedQuantity: 10,
        type: "issued",
        warehouseId: warehouse.id,
        issuedById: user.id,
        idempotencyKey: `issued:${issued.id}:${item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: item.id,
      deltaQuantity: -10,
      reason: LedgerReason.issue,
      eventId: issued.id,
      warehouseId: warehouse.id,
      createdById: user.id,
      note: "Výdej na akci"
    });

    const muchLater = await prisma.event.create({
      data: {
        name: `Pozdeji-v-${stamp}`,
        location: "L",
        deliveryDatetime: new Date("2026-06-01T12:00:00Z"),
        pickupDatetime: new Date("2026-06-01T18:00:00Z"),
        status: EventStatus.DRAFT,
        createdById: user.id
      }
    });
    const a = await prisma.$transaction((tx) => getAvailabilityForEventItemTx(tx, muchLater.id, item.id));
    expect(a.physicalTotal).toBe(0);

    await disconnect();
  });
});

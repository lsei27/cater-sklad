import { describe, expect, it } from "vitest";
import { Role, LedgerReason } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { duplicateEventTx } from "../src/services/duplicateEvent.js";

describe("duplicate event (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("copies items into a new draft event and leaves the source untouched", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const stamp = Date.now();

    const user = await prisma.user.create({
      data: { email: `dup-ok-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const parent = await prisma.category.create({ data: { name: `Dup ok ${stamp}` } });
    const child = await prisma.category.create({ data: { name: "Položky", parentId: parent.id } });
    const item = await prisma.inventoryItem.create({ data: { name: "Talíř", categoryId: child.id, unit: "ks" } });
    await prisma.inventoryLedger.create({
      data: { inventoryItemId: item.id, deltaQuantity: 50, reason: LedgerReason.audit_adjustment, createdById: user.id }
    });

    const source = await prisma.event.create({
      data: {
        name: "Zdroj",
        location: "Praha",
        notes: "Auto do 3,5 t",
        deliveryDatetime: new Date("2030-07-01T08:00:00Z"),
        pickupDatetime: new Date("2030-07-02T08:00:00Z"),
        status: "CLOSED",
        createdById: user.id
      }
    });
    await prisma.eventReservation.create({
      data: { eventId: source.id, inventoryItemId: item.id, reservedQuantity: 20, state: "confirmed" }
    });

    const result = await prisma.$transaction((tx) =>
      duplicateEventTx({
        tx,
        actor: { id: user.id, role: user.role },
        sourceEventId: source.id,
        data: {
          name: "Kopie",
          location: "Brno",
          address: null,
          notes: "Auto do 3,5 t",
          registrationNumber: null,
          eventDate: null,
          deliveryDatetime: new Date("2030-09-01T08:00:00Z"),
          pickupDatetime: new Date("2030-09-02T08:00:00Z")
        }
      })
    );

    expect(result.adjustments).toEqual([]);
    expect(result.event.status).toBe("DRAFT");
    expect(result.event.location).toBe("Brno");

    const copied = await prisma.eventReservation.findMany({ where: { eventId: result.event.id } });
    expect(copied).toHaveLength(1);
    expect(copied[0]?.reservedQuantity).toBe(20);

    const sourceRows = await prisma.eventReservation.findMany({ where: { eventId: source.id } });
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]?.reservedQuantity).toBe(20);

    await disconnect();
  });

  maybe("clamps quantities to what the new date allows and reports the shortfall", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const stamp = Date.now();

    const user = await prisma.user.create({
      data: { email: `dup-short-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const parent = await prisma.category.create({ data: { name: `Dup short ${stamp}` } });
    const child = await prisma.category.create({ data: { name: "Položky", parentId: parent.id } });
    const item = await prisma.inventoryItem.create({ data: { name: "Sklenice", categoryId: child.id, unit: "ks" } });
    await prisma.inventoryLedger.create({
      data: { inventoryItemId: item.id, deltaQuantity: 10, reason: LedgerReason.audit_adjustment, createdById: user.id }
    });

    const source = await prisma.event.create({
      data: {
        name: "Zdroj",
        location: "Praha",
        deliveryDatetime: new Date("2030-07-01T08:00:00Z"),
        pickupDatetime: new Date("2030-07-02T08:00:00Z"),
        status: "CLOSED",
        createdById: user.id
      }
    });
    await prisma.eventReservation.create({
      data: { eventId: source.id, inventoryItemId: item.id, reservedQuantity: 10, state: "confirmed" }
    });

    // Konkurenční akce ve stejném termínu jako kopie drží 7 z 10 kusů.
    const blocking = await prisma.event.create({
      data: {
        name: "Blokující",
        location: "Praha",
        deliveryDatetime: new Date("2030-09-01T08:00:00Z"),
        pickupDatetime: new Date("2030-09-02T08:00:00Z"),
        status: "READY_FOR_WAREHOUSE",
        createdById: user.id
      }
    });
    await prisma.eventReservation.create({
      data: { eventId: blocking.id, inventoryItemId: item.id, reservedQuantity: 7, state: "confirmed" }
    });

    const result = await prisma.$transaction((tx) =>
      duplicateEventTx({
        tx,
        actor: { id: user.id, role: user.role },
        sourceEventId: source.id,
        data: {
          name: "Kopie",
          location: "Praha",
          address: null,
          notes: null,
          registrationNumber: null,
          eventDate: null,
          deliveryDatetime: new Date("2030-09-01T08:00:00Z"),
          pickupDatetime: new Date("2030-09-02T08:00:00Z")
        }
      })
    );

    expect(result.adjustments).toEqual([
      { inventoryItemId: item.id, name: "Sklenice", unit: "ks", sourceQty: 10, copiedQty: 3 }
    ]);

    const copied = await prisma.eventReservation.findMany({ where: { eventId: result.event.id } });
    expect(copied).toHaveLength(1);
    expect(copied[0]?.reservedQuantity).toBe(3);

    await disconnect();
  });

  maybe("rounds down to whole master packages so the roundup cannot oversell", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const stamp = Date.now();

    const user = await prisma.user.create({
      data: { email: `dup-mpq-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const parent = await prisma.category.create({ data: { name: `Dup mpq ${stamp}` } });
    const child = await prisma.category.create({ data: { name: "Položky", parentId: parent.id } });
    const item = await prisma.inventoryItem.create({
      data: { name: "Ubrousky", categoryId: child.id, unit: "ks", masterPackageQty: 6 }
    });
    await prisma.inventoryLedger.create({
      data: { inventoryItemId: item.id, deltaQuantity: 12, reason: LedgerReason.audit_adjustment, createdById: user.id }
    });

    const source = await prisma.event.create({
      data: {
        name: "Zdroj",
        location: "Praha",
        deliveryDatetime: new Date("2030-07-01T08:00:00Z"),
        pickupDatetime: new Date("2030-07-02T08:00:00Z"),
        status: "CLOSED",
        createdById: user.id
      }
    });
    await prisma.eventReservation.create({
      data: { eventId: source.id, inventoryItemId: item.id, reservedQuantity: 12, state: "confirmed" }
    });

    const blocking = await prisma.event.create({
      data: {
        name: "Blokující",
        location: "Praha",
        deliveryDatetime: new Date("2030-09-01T08:00:00Z"),
        pickupDatetime: new Date("2030-09-02T08:00:00Z"),
        status: "READY_FOR_WAREHOUSE",
        createdById: user.id
      }
    });
    // Zbývá 4 kusy, což není celé master balení - do kopie smí jít jen 0.
    await prisma.eventReservation.create({
      data: { eventId: blocking.id, inventoryItemId: item.id, reservedQuantity: 8, state: "confirmed" }
    });

    const result = await prisma.$transaction((tx) =>
      duplicateEventTx({
        tx,
        actor: { id: user.id, role: user.role },
        sourceEventId: source.id,
        data: {
          name: "Kopie",
          location: "Praha",
          address: null,
          notes: null,
          registrationNumber: null,
          eventDate: null,
          deliveryDatetime: new Date("2030-09-01T08:00:00Z"),
          pickupDatetime: new Date("2030-09-02T08:00:00Z")
        }
      })
    );

    expect(result.adjustments[0]?.copiedQty).toBe(0);
    const copied = await prisma.eventReservation.findMany({ where: { eventId: result.event.id } });
    expect(copied).toHaveLength(0);

    await disconnect();
  });
});

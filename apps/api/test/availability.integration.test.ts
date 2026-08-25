import { describe, expect, it } from "vitest";
import { Role, LedgerReason } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { getAvailabilityForEventItemTx, getAvailabilityForEventItemsTx } from "../src/services/availability.js";

describe("availability SQL (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("computes available = physical - blocked", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const user = await prisma.user.create({
      data: { email: `t${Date.now()}@local`, passwordHash: "x", role: Role.admin }
    });

    const parent = await prisma.category.create({ data: { name: "Inventář" } });
    const child = await prisma.category.create({ data: { name: "Test", parentId: parent.id } });
    const item = await prisma.inventoryItem.create({ data: { name: "X", categoryId: child.id, unit: "ks" } });
    await prisma.inventoryLedger.create({ data: { inventoryItemId: item.id, deltaQuantity: 5, reason: LedgerReason.audit_adjustment, createdById: user.id } });

    const e1 = await prisma.event.create({
      data: {
        name: "E1",
        location: "L",
        deliveryDatetime: new Date("2025-01-01T10:00:00Z"),
        pickupDatetime: new Date("2025-01-01T11:00:00Z"),
        status: "DRAFT",
        createdById: user.id
      }
    });
    const e2 = await prisma.event.create({
      data: {
        name: "E2",
        location: "L",
        deliveryDatetime: new Date("2025-01-01T10:30:00Z"),
        pickupDatetime: new Date("2025-01-01T12:00:00Z"),
        status: "READY_FOR_WAREHOUSE",
        createdById: user.id
      }
    });

    await prisma.eventReservation.create({
      data: { eventId: e2.id, inventoryItemId: item.id, reservedQuantity: 3, state: "confirmed" }
    });

    const a = await prisma.$transaction((tx) => getAvailabilityForEventItemTx(tx, e1.id, item.id));
    expect(a.physicalTotal).toBe(5);
    expect(a.blockedTotal).toBe(3);
    expect(a.available).toBe(2);

    await disconnect();
  });
});


describe("warehouse block on a closed event (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  // Sklad si po uzavření akce nechává špinavé zboží stranou, dokud ho nezkontroluje.
  // Blokace se proto musí řídit svým blocked_until, ne stavem akce.
  maybe("blocks stock even though the event is already closed", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const user = await prisma.user.create({
      data: { email: `blk${Date.now()}@local`, passwordHash: "x", role: Role.admin }
    });
    const parent = await prisma.category.create({ data: { name: `Inventář ${Date.now()}` } });
    const child = await prisma.category.create({ data: { name: "Blok", parentId: parent.id } });
    const item = await prisma.inventoryItem.create({ data: { name: "Blokovaná", categoryId: child.id, unit: "ks" } });
    await prisma.inventoryLedger.create({
      data: { inventoryItemId: item.id, deltaQuantity: 10, reason: LedgerReason.audit_adjustment, createdById: user.id }
    });

    const closed = await prisma.event.create({
      data: {
        name: "Uzavřená",
        location: "L",
        deliveryDatetime: new Date("2025-03-01T08:00:00Z"),
        pickupDatetime: new Date("2025-03-02T08:00:00Z"),
        status: "CLOSED",
        createdById: user.id
      }
    });
    await prisma.warehouseBlock.create({
      data: {
        eventId: closed.id,
        inventoryItemId: item.id,
        blockedQuantity: 10,
        blockedUntil: new Date("2025-03-10T08:00:00Z"),
        createdById: user.id
      }
    });

    const upcoming = await prisma.event.create({
      data: {
        name: "Nadcházející",
        location: "L",
        deliveryDatetime: new Date("2025-03-05T08:00:00Z"),
        pickupDatetime: new Date("2025-03-06T08:00:00Z"),
        status: "DRAFT",
        createdById: user.id
      }
    });

    const a = await prisma.$transaction((tx) => getAvailabilityForEventItemTx(tx, upcoming.id, item.id));
    expect(a.physicalTotal).toBe(10);
    expect(a.blockedTotal).toBe(10);
    expect(a.available).toBe(0);

    await disconnect();
  });

  maybe("stops blocking once blocked_until has passed", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const user = await prisma.user.create({
      data: { email: `blk2${Date.now()}@local`, passwordHash: "x", role: Role.admin }
    });
    const parent = await prisma.category.create({ data: { name: `Inventář2 ${Date.now()}` } });
    const child = await prisma.category.create({ data: { name: "Blok2", parentId: parent.id } });
    const item = await prisma.inventoryItem.create({ data: { name: "Uvolněná", categoryId: child.id, unit: "ks" } });
    await prisma.inventoryLedger.create({
      data: { inventoryItemId: item.id, deltaQuantity: 10, reason: LedgerReason.audit_adjustment, createdById: user.id }
    });

    const closed = await prisma.event.create({
      data: {
        name: "Uzavřená 2",
        location: "L",
        deliveryDatetime: new Date("2025-03-01T08:00:00Z"),
        pickupDatetime: new Date("2025-03-02T08:00:00Z"),
        status: "CLOSED",
        createdById: user.id
      }
    });
    await prisma.warehouseBlock.create({
      data: {
        eventId: closed.id,
        inventoryItemId: item.id,
        blockedQuantity: 10,
        blockedUntil: new Date("2025-03-04T08:00:00Z"),
        createdById: user.id
      }
    });

    const later = await prisma.event.create({
      data: {
        name: "Po vypršení blokace",
        location: "L",
        deliveryDatetime: new Date("2025-03-20T08:00:00Z"),
        pickupDatetime: new Date("2025-03-21T08:00:00Z"),
        status: "DRAFT",
        createdById: user.id
      }
    });

    const a = await prisma.$transaction((tx) => getAvailabilityForEventItemTx(tx, later.id, item.id));
    expect(a.blockedTotal).toBe(0);
    expect(a.available).toBe(10);

    await disconnect();
  });
});

describe("bulk event availability (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("returns independent availability for multiple items in one query", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const stamp = Date.now();

    const user = await prisma.user.create({
      data: { email: `bulk-availability-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const parent = await prisma.category.create({ data: { name: `Bulk ${stamp}` } });
    const child = await prisma.category.create({ data: { name: "Položky", parentId: parent.id } });
    const [firstItem, secondItem] = await Promise.all([
      prisma.inventoryItem.create({ data: { name: "První", categoryId: child.id, unit: "ks" } }),
      prisma.inventoryItem.create({ data: { name: "Druhá", categoryId: child.id, unit: "ks" } })
    ]);
    await prisma.inventoryLedger.createMany({
      data: [
        { inventoryItemId: firstItem.id, deltaQuantity: 10, reason: LedgerReason.audit_adjustment, createdById: user.id },
        { inventoryItemId: secondItem.id, deltaQuantity: 4, reason: LedgerReason.audit_adjustment, createdById: user.id }
      ]
    });

    const targetEvent = await prisma.event.create({
      data: {
        name: "Cílová akce",
        location: "L",
        deliveryDatetime: new Date("2030-06-01T08:00:00Z"),
        pickupDatetime: new Date("2030-06-02T08:00:00Z"),
        status: "DRAFT",
        createdById: user.id
      }
    });
    const blockingEvent = await prisma.event.create({
      data: {
        name: "Překrývající se akce",
        location: "L",
        deliveryDatetime: new Date("2030-06-01T10:00:00Z"),
        pickupDatetime: new Date("2030-06-01T18:00:00Z"),
        status: "READY_FOR_WAREHOUSE",
        createdById: user.id
      }
    });
    await prisma.eventReservation.create({
      data: {
        eventId: blockingEvent.id,
        inventoryItemId: firstItem.id,
        reservedQuantity: 3,
        state: "confirmed"
      }
    });

    const rows = await prisma.$transaction((tx) =>
      getAvailabilityForEventItemsTx(tx, targetEvent.id, [firstItem.id, secondItem.id])
    );
    expect(rows).toEqual([
      { inventoryItemId: firstItem.id, physicalTotal: 10, blockedTotal: 3, available: 7 },
      { inventoryItemId: secondItem.id, physicalTotal: 4, blockedTotal: 0, available: 4 }
    ]);

    await disconnect();
  });
});

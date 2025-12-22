import { describe, expect, it } from "vitest";
import { PrismaClient, Role, LedgerReason } from "@prisma/client";
import { getAvailabilityForEventItemTx } from "../src/services/availability.js";

describe("availability SQL (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("computes available = physical - blocked", async () => {
    const prisma = new PrismaClient({ datasources: { db: { url } } });
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

    await prisma.$disconnect();
  });
});


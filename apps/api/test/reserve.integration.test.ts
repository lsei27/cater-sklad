import { describe, expect, it } from "vitest";
import { PrismaClient, Role, LedgerReason } from "../generated/prisma/client.js";
import { reserveItemsTx, InsufficientStockError } from "../src/services/reserve.js";

describe("reserve transaction (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("prevents oversell under concurrency via advisory lock", async () => {
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    const user = await prisma.user.create({
      data: { email: `t2${Date.now()}@local`, passwordHash: "x", role: Role.admin }
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
        status: "READY_FOR_WAREHOUSE",
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

    const runReserve = (eventId: string) =>
      prisma.$transaction((tx) =>
        reserveItemsTx({ tx, actor: { id: user.id, role: user.role }, eventId, items: [{ inventoryItemId: item.id, qty: 4 }] })
      );

    const [r1, r2] = await Promise.allSettled([runReserve(e1.id), runReserve(e2.id)]);
    const okCount = [r1, r2].filter((r) => r.status === "fulfilled").length;
    expect(okCount).toBe(1);
    const fail = [r1, r2].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    expect(fail?.reason instanceof InsufficientStockError || fail?.reason?.message === "INSUFFICIENT_STOCK").toBe(true);

    await prisma.$disconnect();
  });
});


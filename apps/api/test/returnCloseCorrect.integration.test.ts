import { describe, expect, it } from "vitest";
import { Role, LedgerReason, EventStatus } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { createInventoryLedgerEntry } from "../src/services/ledger.js";
import { getPhysicalTotal } from "../src/services/availability.js";
import { correctReturnCloseTx, returnCloseTx } from "../src/services/returnClose.js";

describe("oprava uzavřené akce (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  async function setup(prisma: ReturnType<typeof createTestPrisma>["prisma"], stamp: string) {
    const user = await prisma.user.create({
      data: { email: `correct-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const parent = await prisma.category.create({ data: { name: `Inventar-correct-${stamp}` } });
    const child = await prisma.category.create({ data: { name: `Test-correct-${stamp}`, parentId: parent.id } });
    const warehouse = await prisma.warehouse.create({ data: { name: `Sklad-correct-${stamp}` } });
    const item = await prisma.inventoryItem.create({
      data: { name: `Item-correct-${stamp}`, categoryId: child.id, unit: "ks", warehouseId: warehouse.id }
    });
    await prisma.inventoryLedger.create({
      data: { inventoryItemId: item.id, deltaQuantity: 10, reason: LedgerReason.audit_adjustment, createdById: user.id }
    });
    const event = await prisma.event.create({
      data: {
        name: "NKT oprava",
        location: "Kladno",
        deliveryDatetime: new Date("2026-02-10T10:00:00Z"),
        pickupDatetime: new Date("2026-02-11T10:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });
    await prisma.eventIssue.create({
      data: {
        eventId: event.id,
        inventoryItemId: item.id,
        issuedQuantity: 10,
        type: "issued",
        issuedById: user.id,
        idempotencyKey: `issued-correct:${event.id}:${item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: item.id,
      deltaQuantity: -10,
      reason: LedgerReason.issue,
      eventId: event.id,
      createdById: user.id
    });
    return { user, item, event };
  }

  async function losses(prisma: ReturnType<typeof createTestPrisma>["prisma"], eventId: string) {
    const rows = await prisma.eventIssue.findMany({ where: { eventId, type: { not: "issued" } } });
    return Object.fromEntries(rows.map((r) => [r.type, r.issuedQuantity]));
  }

  maybe("opraví vrácené a rozbité kusy a sklad narovná jen o rozdíl", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    try {
      const { user, item, event } = await setup(prisma, `ok-${Date.now()}`);

      await prisma.$transaction((tx) =>
        returnCloseTx({
          tx,
          eventId: event.id,
          userId: user.id,
          idempotencyKey: `close-${event.id}`,
          items: [{ inventory_item_id: item.id, returned_quantity: 6, broken_quantity: 1 }]
        })
      );
      expect(await getPhysicalTotal(prisma, item.id)).toBe(6);
      expect(await losses(prisma, event.id)).toEqual({ broken: 1, missing: 3 });

      // Dodatečně se našly 3 kusy: všechno chybějící se vrátilo.
      await prisma.$transaction((tx) =>
        correctReturnCloseTx({
          tx,
          eventId: event.id,
          userId: user.id,
          items: [{ inventory_item_id: item.id, returned_quantity: 9, broken_quantity: 1 }]
        })
      );
      expect(await getPhysicalTotal(prisma, item.id)).toBe(9);
      expect(await losses(prisma, event.id)).toEqual({ broken: 1 });
      const returns = await prisma.eventReturn.findMany({ where: { eventId: event.id } });
      expect(returns.map((r) => [r.returnedQuantity, r.brokenQuantity])).toEqual([[9, 1]]);

      // Oprava směrem dolů odečte ze skladu.
      await prisma.$transaction((tx) =>
        correctReturnCloseTx({
          tx,
          eventId: event.id,
          userId: user.id,
          items: [{ inventory_item_id: item.id, returned_quantity: 4, broken_quantity: 0 }]
        })
      );
      expect(await getPhysicalTotal(prisma, item.id)).toBe(4);
      expect(await losses(prisma, event.id)).toEqual({ missing: 6 });

      const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
      expect(after.status).toBe(EventStatus.CLOSED);
      const audits = await prisma.auditLog.findMany({ where: { entityId: event.id, action: "return_close_correct" } });
      expect(audits).toHaveLength(2);
    } finally {
      await disconnect();
    }
  });

  maybe("odmítne opravu neuzavřené akce a množství nad vydané", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    try {
      const { user, item, event } = await setup(prisma, `bad-${Date.now()}`);

      await expect(
        prisma.$transaction((tx) =>
          correctReturnCloseTx({
            tx,
            eventId: event.id,
            userId: user.id,
            items: [{ inventory_item_id: item.id, returned_quantity: 10, broken_quantity: 0 }]
          })
        )
      ).rejects.toThrow("NOT_CLOSED");

      await prisma.$transaction((tx) =>
        returnCloseTx({
          tx,
          eventId: event.id,
          userId: user.id,
          idempotencyKey: `close-${event.id}`,
          items: [{ inventory_item_id: item.id, returned_quantity: 10, broken_quantity: 0 }]
        })
      );

      await expect(
        prisma.$transaction((tx) =>
          correctReturnCloseTx({
            tx,
            eventId: event.id,
            userId: user.id,
            items: [{ inventory_item_id: item.id, returned_quantity: 10, broken_quantity: 1 }]
          })
        )
      ).rejects.toThrow("ITEMS_EXCEED_ISSUED");
      expect(await getPhysicalTotal(prisma, item.id)).toBe(10);
    } finally {
      await disconnect();
    }
  });
});

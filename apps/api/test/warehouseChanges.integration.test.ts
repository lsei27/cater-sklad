import { describe, expect, it } from "vitest";
import { EventStatus, Role } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { createExportTx } from "../src/services/export.js";
import { ackChanges, getUnseenChanges } from "../src/services/warehouseChanges.js";

describe("zmeny akce pro sklad (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("nova verze ukaze zmeny, potvrzeni je schova a dalsi zmena je zase ukaze", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();
    const stamp = fixtureStamp();
    const user = await prisma.user.create({ data: { email: `chg-${stamp}@local`, passwordHash: "x", role: Role.admin } });
    const parent = await prisma.category.create({ data: { name: `InventarC-${stamp}` } });
    const child = await prisma.category.create({ data: { name: `SkloC-${stamp}`, parentId: parent.id } });
    const glass = await prisma.inventoryItem.create({ data: { name: `Sklenice-${stamp}`, categoryId: child.id, unit: "ks" } });
    const cloth = await prisma.inventoryItem.create({ data: { name: `Ubrus-${stamp}`, categoryId: child.id, unit: "ks" } });
    const event = await prisma.event.create({
      data: {
        name: `AkceC-${stamp}`,
        location: "Praha",
        deliveryDatetime: new Date("2026-12-01T08:00:00Z"),
        pickupDatetime: new Date("2026-12-02T08:00:00Z"),
        status: EventStatus.DRAFT,
        createdById: user.id
      }
    });
    const exportNow = () => prisma.$transaction((tx) => createExportTx({ tx, eventId: event.id, userId: user.id }));

    try {
      await prisma.eventReservation.create({ data: { eventId: event.id, inventoryItemId: glass.id, reservedQuantity: 10 } });
      await exportNow();
      expect(await getUnseenChanges(prisma, event.id)).toBeNull();

      await prisma.eventReservation.updateMany({ where: { eventId: event.id, inventoryItemId: glass.id }, data: { reservedQuantity: 12 } });
      await prisma.eventReservation.create({ data: { eventId: event.id, inventoryItemId: cloth.id, reservedQuantity: 3 } });
      await exportNow();

      const unseen = await getUnseenChanges(prisma, event.id);
      expect(unseen?.baseVersion).toBe(1);
      expect(unseen?.latestVersion).toBe(2);
      expect(unseen?.changes.map((c) => [c.inventoryItemId, c.kind, c.from, c.to])).toEqual(
        expect.arrayContaining([
          [glass.id, "changed", 10, 12],
          [cloth.id, "added", 0, 3]
        ])
      );

      await ackChanges(prisma, event.id, 2);
      expect(await getUnseenChanges(prisma, event.id)).toBeNull();

      // Starší potvrzení nesmí vrátit už potvrzenou verzi zpět.
      await ackChanges(prisma, event.id, 1);
      expect((await prisma.event.findUnique({ where: { id: event.id } }))?.warehouseAckVersion).toBe(2);

      await prisma.eventReservation.deleteMany({ where: { eventId: event.id, inventoryItemId: cloth.id } });
      await exportNow();
      const again = await getUnseenChanges(prisma, event.id);
      expect(again?.baseVersion).toBe(2);
      expect(again?.changes).toEqual([expect.objectContaining({ inventoryItemId: cloth.id, kind: "removed", from: 3, to: 0 })]);
    } finally {
      await prisma.event.delete({ where: { id: event.id } });
      await prisma.inventoryItem.deleteMany({ where: { id: { in: [glass.id, cloth.id] } } });
      await prisma.category.delete({ where: { id: child.id } });
      await prisma.category.delete({ where: { id: parent.id } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await disconnect();
    }
  });
});

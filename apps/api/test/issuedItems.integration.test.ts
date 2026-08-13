import { describe, expect, it } from "vitest";
import { Role, EventStatus } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { getIssuedWarehouseItems } from "../src/services/issuedItems.js";

describe("seznam vydanych polozek (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("secte vice radku vydeje na jednu polozku a doplni kategorie", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const stamp = fixtureStamp();
    const user = await prisma.user.create({
      data: { email: `issued-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const warehouse = await prisma.warehouse.create({ data: { name: `Sklad-${stamp}` } });
    const parent = await prisma.category.create({ data: { name: `Inventar-${stamp}` } });
    const child = await prisma.category.create({ data: { name: `Sklo-${stamp}`, parentId: parent.id } });
    const item = await prisma.inventoryItem.create({
      data: { name: `Sklenice-${stamp}`, categoryId: child.id, unit: "ks", warehouseId: warehouse.id }
    });

    const event = await prisma.event.create({
      data: {
        name: `Akce-${stamp}`,
        location: "Praha",
        deliveryDatetime: new Date("2026-09-01T08:00:00Z"),
        pickupDatetime: new Date("2026-09-02T08:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });

    for (const [suffix, qty] of [["a", 10], ["b", 4]] as const) {
      await prisma.eventIssue.create({
        data: {
          eventId: event.id,
          inventoryItemId: item.id,
          issuedQuantity: qty,
          type: "issued",
          warehouseId: warehouse.id,
          issuedById: user.id,
          idempotencyKey: `iss-${suffix}:${event.id}:${item.id}`
        }
      });
    }

    // Ztraty se do seznamu nesmi pocitat.
    await prisma.eventIssue.create({
      data: {
        eventId: event.id,
        inventoryItemId: item.id,
        issuedQuantity: 3,
        type: "missing",
        warehouseId: warehouse.id,
        issuedById: user.id,
        idempotencyKey: `miss:${event.id}:${item.id}`
      }
    });

    const rows = await getIssuedWarehouseItems(prisma, event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      inventoryItemId: item.id,
      name: `Sklenice-${stamp}`,
      unit: "ks",
      qty: 14,
      parentCategory: `Inventar-${stamp}`,
      category: `Sklo-${stamp}`
    });

    await disconnect();
  });

  maybe("polozka bez nadrazene kategorie ma prazdnou podkategorii", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const stamp = fixtureStamp();
    const user = await prisma.user.create({
      data: { email: `issued2-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const warehouse = await prisma.warehouse.create({ data: { name: `Sklad2-${stamp}` } });
    const solo = await prisma.category.create({ data: { name: `Samostatna-${stamp}` } });
    const item = await prisma.inventoryItem.create({
      data: { name: `Bedna-${stamp}`, categoryId: solo.id, unit: "ks", warehouseId: warehouse.id }
    });
    const event = await prisma.event.create({
      data: {
        name: `Akce2-${stamp}`,
        location: "Praha",
        deliveryDatetime: new Date("2026-09-01T08:00:00Z"),
        pickupDatetime: new Date("2026-09-02T08:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });
    await prisma.eventIssue.create({
      data: {
        eventId: event.id,
        inventoryItemId: item.id,
        issuedQuantity: 2,
        type: "issued",
        warehouseId: warehouse.id,
        issuedById: user.id,
        idempotencyKey: `solo:${event.id}:${item.id}`
      }
    });

    const rows = await getIssuedWarehouseItems(prisma, event.id);
    expect(rows[0]?.parentCategory).toBe(`Samostatna-${stamp}`);
    expect(rows[0]?.category).toBe("");

    await disconnect();
  });
});

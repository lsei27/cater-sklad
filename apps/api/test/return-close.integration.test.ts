import { describe, expect, it } from "vitest";
import { PrismaClient, Role, LedgerReason, EventStatus } from "../generated/prisma/client.js";
import { createInventoryLedgerEntry } from "../src/services/ledger.js";
import { getPhysicalTotal } from "../src/services/availability.js";
import { returnCloseTx } from "../src/services/returnClose.js";

describe("return close transaction (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("restores stock exactly to issued quantity when everything is returned", async () => {
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    const user = await prisma.user.create({
      data: { email: `return-${Date.now()}@local`, passwordHash: "x", role: Role.admin }
    });
    const parent = await prisma.category.create({ data: { name: `Inventar-${Date.now()}` } });
    const child = await prisma.category.create({ data: { name: `Test-${Date.now()}`, parentId: parent.id } });
    const item = await prisma.inventoryItem.create({ data: { name: `Item-${Date.now()}`, categoryId: child.id, unit: "ks" } });

    await prisma.inventoryLedger.create({
      data: { inventoryItemId: item.id, deltaQuantity: 5, reason: LedgerReason.audit_adjustment, createdById: user.id }
    });

    const event = await prisma.event.create({
      data: {
        name: "Return exact",
        location: "Praha",
        deliveryDatetime: new Date("2026-01-10T10:00:00Z"),
        pickupDatetime: new Date("2026-01-11T10:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });

    await prisma.eventIssue.create({
      data: {
        eventId: event.id,
        inventoryItemId: item.id,
        issuedQuantity: 5,
        type: "issued",
        issuedById: user.id,
        idempotencyKey: `issued:${event.id}:${item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: item.id,
      deltaQuantity: -5,
      reason: LedgerReason.issue,
      eventId: event.id,
      createdById: user.id,
      note: "Výdej na akci"
    });

    expect(await getPhysicalTotal(prisma, item.id)).toBe(0);

    await prisma.$transaction((tx) =>
      returnCloseTx({
        tx,
        eventId: event.id,
        userId: user.id,
        idempotencyKey: "return-close-exact",
        items: [
          {
            inventory_item_id: item.id,
            returned_quantity: 5,
            broken_quantity: 0
          }
        ]
      })
    );

    expect(await getPhysicalTotal(prisma, item.id)).toBe(5);

    const closedEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(closedEvent.status).toBe(EventStatus.CLOSED);

    const returns = await prisma.eventReturn.findMany({ where: { eventId: event.id, inventoryItemId: item.id } });
    expect(returns).toHaveLength(1);
    expect(returns[0]?.returnedQuantity).toBe(5);
    expect(returns[0]?.brokenQuantity).toBe(0);

    const lossIssues = await prisma.eventIssue.findMany({
      where: { eventId: event.id, inventoryItemId: item.id, type: { in: ["broken", "missing"] } }
    });
    expect(lossIssues).toHaveLength(0);

    await prisma.$disconnect();
  });

  maybe("rejects returning more than was actually issued and leaves stock unchanged", async () => {
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    const user = await prisma.user.create({
      data: { email: `return-over-${Date.now()}@local`, passwordHash: "x", role: Role.admin }
    });
    const parent = await prisma.category.create({ data: { name: `Inventar-over-${Date.now()}` } });
    const child = await prisma.category.create({ data: { name: `Test-over-${Date.now()}`, parentId: parent.id } });
    const item = await prisma.inventoryItem.create({ data: { name: `Item-over-${Date.now()}`, categoryId: child.id, unit: "ks" } });

    await prisma.inventoryLedger.create({
      data: { inventoryItemId: item.id, deltaQuantity: 5, reason: LedgerReason.audit_adjustment, createdById: user.id }
    });

    const event = await prisma.event.create({
      data: {
        name: "Return over",
        location: "Praha",
        deliveryDatetime: new Date("2026-01-12T10:00:00Z"),
        pickupDatetime: new Date("2026-01-13T10:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });

    await prisma.eventIssue.create({
      data: {
        eventId: event.id,
        inventoryItemId: item.id,
        issuedQuantity: 3,
        type: "issued",
        issuedById: user.id,
        idempotencyKey: `issued-over:${event.id}:${item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: item.id,
      deltaQuantity: -3,
      reason: LedgerReason.issue,
      eventId: event.id,
      createdById: user.id,
      note: "Výdej na akci"
    });

    expect(await getPhysicalTotal(prisma, item.id)).toBe(2);

    await expect(
      prisma.$transaction((tx) =>
        returnCloseTx({
          tx,
          eventId: event.id,
          userId: user.id,
          idempotencyKey: "return-close-over",
          items: [
            {
              inventory_item_id: item.id,
              returned_quantity: 4,
              broken_quantity: 0
            }
          ]
        })
      )
    ).rejects.toThrow("ITEMS_EXCEED_ISSUED");

    expect(await getPhysicalTotal(prisma, item.id)).toBe(2);

    const currentEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(currentEvent.status).toBe(EventStatus.ISSUED);

    await prisma.$disconnect();
  });
});

import { describe, expect, it } from "vitest";
import { EventStatus, LedgerReason, Role } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { duplicateEventTx } from "../src/services/duplicateEvent.js";

type TestPrisma = ReturnType<typeof createTestPrisma>["prisma"];

async function setup(prisma: TestPrisma) {
  const stamp = fixtureStamp();
  const user = await prisma.user.create({ data: { email: `dupd-${stamp}@local`, passwordHash: "x", role: Role.admin } });
  const parent = await prisma.category.create({ data: { name: `Inv-dupd-${stamp}` } });
  const child = await prisma.category.create({ data: { name: `Sub-dupd-${stamp}`, parentId: parent.id } });
  const item = await prisma.inventoryItem.create({ data: { name: `Stul-${stamp}`, categoryId: child.id, unit: "ks" } });
  await prisma.inventoryLedger.create({
    data: { inventoryItemId: item.id, deltaQuantity: 100, reason: LedgerReason.audit_adjustment, createdById: user.id }
  });
  const source = await prisma.event.create({
    data: {
      name: `Zdroj-${stamp}`,
      location: "L",
      eventDate: new Date("2031-01-10T00:00:00Z"),
      eventEndDate: new Date("2031-01-12T00:00:00Z"),
      deliveryDatetime: new Date("2031-01-10T07:00:00Z"),
      pickupDatetime: new Date("2031-01-12T17:00:00Z"),
      status: EventStatus.CLOSED,
      createdById: user.id
    }
  });
  const add = (qty: number, dayFrom: number, dayTo: number | null) =>
    prisma.eventReservation.create({
      data: { eventId: source.id, inventoryItemId: item.id, reservedQuantity: qty, state: "confirmed", dayFrom, dayTo }
    });
  const duplicate = (delivery: string, pickup: string) =>
    prisma.$transaction((tx) =>
      duplicateEventTx({
        tx,
        actor: { id: user.id, role: Role.admin },
        sourceEventId: source.id,
        data: {
          name: `Kopie-${stamp}`,
          location: "L",
          address: null,
          notes: null,
          registrationNumber: null,
          eventDate: new Date(`${delivery.slice(0, 10)}T00:00:00Z`),
          eventEndDate: new Date(`${pickup.slice(0, 10)}T00:00:00Z`),
          deliveryDatetime: new Date(delivery),
          pickupDatetime: new Date(pickup)
        }
      })
    );
  const rowsOf = (eventId: string) =>
    prisma.eventReservation.findMany({
      where: { eventId },
      orderBy: [{ dayFrom: "asc" }, { reservedQuantity: "asc" }],
      select: { dayFrom: true, dayTo: true, reservedQuantity: true }
    });
  return { add, duplicate, rowsOf };
}

describe("kopírování vícedenní akce (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("kopie stejně dlouhé akce převezme rozsahy dnů", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma);
    await f.add(10, 1, null);
    await f.add(5, 2, 2);

    const { event, adjustments } = await f.duplicate("2031-02-10T07:00:00Z", "2031-02-12T17:00:00Z");

    expect(adjustments).toEqual([]);
    expect(await f.rowsOf(event.id)).toEqual([
      { dayFrom: 1, dayTo: null, reservedQuantity: 10 },
      { dayFrom: 2, dayTo: 2, reservedQuantity: 5 }
    ]);
    await disconnect();
  });

  maybe("kopie do kratší akce zkrátí, sečte a vynechá řádky", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma);
    await f.add(10, 1, null);
    await f.add(4, 1, 2);
    await f.add(2, 3, 3);

    const { event, adjustments } = await f.duplicate("2031-02-10T07:00:00Z", "2031-02-11T17:00:00Z");

    expect(await f.rowsOf(event.id)).toEqual([{ dayFrom: 1, dayTo: null, reservedQuantity: 14 }]);
    expect(adjustments.map((a) => [a.dayFrom, a.dayTo, a.sourceQty, a.copiedQty])).toEqual([[3, 3, 2, 0]]);
    await disconnect();
  });
});

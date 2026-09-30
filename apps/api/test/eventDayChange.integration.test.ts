import { describe, expect, it } from "vitest";
import { EventStatus, Role } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { fitReservationsToDayCountTx } from "../src/services/eventDayChange.js";

type TestPrisma = ReturnType<typeof createTestPrisma>["prisma"];

async function setup(prisma: TestPrisma) {
  const stamp = fixtureStamp();
  const user = await prisma.user.create({ data: { email: `daychg-${stamp}@local`, passwordHash: "x", role: Role.admin } });
  const parent = await prisma.category.create({ data: { name: `Inv-chg-${stamp}` } });
  const child = await prisma.category.create({ data: { name: `Sub-chg-${stamp}`, parentId: parent.id } });
  const item = await prisma.inventoryItem.create({ data: { name: `Ubrus-${stamp}`, categoryId: child.id, unit: "ks" } });
  const event = await prisma.event.create({
    data: {
      name: `Chg-${stamp}`,
      location: "L",
      deliveryDatetime: new Date("2030-09-01T06:00:00Z"),
      pickupDatetime: new Date("2030-09-03T18:00:00Z"),
      status: EventStatus.DRAFT,
      createdById: user.id
    }
  });
  const add = (qty: number, dayFrom: number, dayTo: number | null) =>
    prisma.eventReservation.create({
      data: { eventId: event.id, inventoryItemId: item.id, reservedQuantity: qty, state: "confirmed", dayFrom, dayTo }
    });
  const rows = () =>
    prisma.eventReservation.findMany({
      where: { eventId: event.id },
      orderBy: [{ dayFrom: "asc" }, { reservedQuantity: "asc" }],
      select: { dayFrom: true, dayTo: true, reservedQuantity: true }
    });
  const pack = (dayFrom: number, dayTo: number | null) =>
    prisma.eventPacking.create({
      data: { eventId: event.id, inventoryItemId: item.id, state: "confirmed", dayFrom, dayTo, updatedById: user.id }
    });
  const packing = () =>
    prisma.eventPacking.findMany({
      where: { eventId: event.id },
      orderBy: [{ dayFrom: "asc" }, { dayTo: "asc" }],
      select: { dayFrom: true, dayTo: true }
    });
  return { event, item, add, rows, pack, packing };
}

describe("zkrácení vícedenní akce (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("řádek končící za novým posledním dnem se zkrátí a sloučí", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma);
    await f.add(10, 1, null);
    await f.add(5, 1, 2);
    await f.add(3, 1, 1);

    const res = await prisma.$transaction((tx) => fitReservationsToDayCountTx(tx, f.event.id, 2));

    expect(res.changed).toBe(true);
    expect(await f.rows()).toEqual([
      { dayFrom: 1, dayTo: 1, reservedQuantity: 3 },
      { dayFrom: 1, dayTo: null, reservedQuantity: 15 }
    ]);
    await disconnect();
  });

  maybe("řádek, který by celý vypadl z akce, zamítne změnu termínu", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma);
    await f.add(4, 3, null);

    const err = await prisma
      .$transaction((tx) => fitReservationsToDayCountTx(tx, f.event.id, 2))
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe("DAYS_OUT_OF_RANGE");
    expect((err as Error & { itemNames?: string[] }).itemNames).toEqual([f.item.name]);
    expect(await f.rows()).toEqual([{ dayFrom: 3, dayTo: null, reservedQuantity: 4 }]);
    await disconnect();
  });

  maybe("prodloužení akce řádky nemění", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma);
    await f.add(10, 1, null);
    await f.add(5, 2, 2);

    const res = await prisma.$transaction((tx) => fitReservationsToDayCountTx(tx, f.event.id, 5));
    expect(res.changed).toBe(false);
    expect(await f.rows()).toEqual([
      { dayFrom: 1, dayTo: null, reservedQuantity: 10 },
      { dayFrom: 2, dayTo: 2, reservedQuantity: 5 }
    ]);
    await disconnect();
  });

  maybe("zahodí balení ořezaného řádku i cíle sloučení, cizí dayFrom nechá", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma);
    await f.add(10, 1, null);
    await f.add(5, 1, 2);
    await f.add(2, 2, null);
    await f.pack(1, null);
    await f.pack(1, 2);
    await f.pack(2, null);

    await prisma.$transaction((tx) => fitReservationsToDayCountTx(tx, f.event.id, 2));

    expect(await f.packing()).toEqual([{ dayFrom: 2, dayTo: null }]);
    await disconnect();
  });

  maybe("dva ořezávané řádky bez existujícího NULL řádku se sloučí do jednoho", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma);
    await f.add(4, 1, 2);
    await f.add(6, 1, 3);

    await prisma.$transaction((tx) => fitReservationsToDayCountTx(tx, f.event.id, 2));

    expect(await f.rows()).toEqual([{ dayFrom: 1, dayTo: null, reservedQuantity: 10 }]);
    await disconnect();
  });
});

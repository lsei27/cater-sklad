import { describe, expect, it } from "vitest";
import { EventStatus, LedgerReason, Role } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { createInventoryLedgerEntry } from "../src/services/ledger.js";
import { getAvailabilityForEventItemTx } from "../src/services/availability.js";
import { issueAdditionalTx } from "../src/services/issueAdditional.js";
import { InsufficientStockError } from "../src/services/reserve.js";

type TestPrisma = ReturnType<typeof createTestPrisma>["prisma"];

// Třídenní akce A: 1. 7. 2030 8:00 až 3. 7. 2030 20:00 (letní čas, UTC+2).
const A_DELIVERY = "2030-07-01T06:00:00Z";
const A_PICKUP = "2030-07-03T18:00:00Z";
// Jednodenní akce v den 2 a den 3 akce A.
const DAY2 = ["2030-07-02T06:00:00Z", "2030-07-02T18:00:00Z"] as const;
const DAY3 = ["2030-07-03T06:00:00Z", "2030-07-03T10:00:00Z"] as const;

async function setup(prisma: TestPrisma, opts: { stock: number; returnDelayDays?: number }) {
  const stamp = fixtureStamp();
  const user = await prisma.user.create({
    data: { email: `days-${stamp}@local`, passwordHash: "x", role: Role.admin }
  });
  const parent = await prisma.category.create({ data: { name: `Inventar-days-${stamp}` } });
  const child = await prisma.category.create({ data: { name: `Stoly-${stamp}`, parentId: parent.id } });
  const item = await prisma.inventoryItem.create({
    data: { name: `Stul-${stamp}`, categoryId: child.id, unit: "ks", returnDelayDays: opts.returnDelayDays ?? 0 }
  });
  await prisma.inventoryLedger.create({
    data: { inventoryItemId: item.id, deltaQuantity: opts.stock, reason: LedgerReason.audit_adjustment, createdById: user.id }
  });
  const makeEvent = (name: string, delivery: string, pickup: string, status: EventStatus = EventStatus.READY_FOR_WAREHOUSE) =>
    prisma.event.create({
      data: {
        name: `${name}-${stamp}`,
        location: "L",
        deliveryDatetime: new Date(delivery),
        pickupDatetime: new Date(pickup),
        status,
        createdById: user.id
      }
    });
  const reserve = (eventId: string, qty: number, dayFrom = 1, dayTo: number | null = null) =>
    prisma.eventReservation.create({
      data: { eventId, inventoryItemId: item.id, reservedQuantity: qty, state: "confirmed", dayFrom, dayTo }
    });
  const availability = (eventId: string, options?: Parameters<typeof getAvailabilityForEventItemTx>[3]) =>
    prisma.$transaction((tx) => getAvailabilityForEventItemTx(tx, eventId, item.id, options));
  return { user, item, makeEvent, reserve, availability };
}

describe("dostupnost po dnech (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("stoly jen na den 1 jsou pro jinou akci volné od dne 2", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP);
    await f.reserve(a.id, 10, 1, 1);
    const b = await f.makeEvent("B", ...DAY2);

    const res = await f.availability(b.id);
    expect(res.blockedTotal).toBe(0);
    expect(res.available).toBe(10);
    await disconnect();
  });

  maybe("řádek na celou akci blokuje i den 2", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP);
    await f.reserve(a.id, 10);
    const b = await f.makeEvent("B", ...DAY2);

    expect((await f.availability(b.id)).available).toBe(0);
    await disconnect();
  });

  maybe("souběžné řádky se sčítají jen tam, kde se překrývají", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 150 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP);
    await f.reserve(a.id, 50);
    await f.reserve(a.id, 70, 2, 2);
    const b = await f.makeEvent("B", ...DAY2);
    const c = await f.makeEvent("C", ...DAY3);

    const onDay2 = await f.availability(b.id);
    expect(onDay2.blockedTotal).toBe(120);
    expect(onDay2.available).toBe(30);
    const onDay3 = await f.availability(c.id);
    expect(onDay3.blockedTotal).toBe(50);
    expect(onDay3.available).toBe(100);
    await disconnect();
  });

  maybe("řádky téže akce si navzájem hlídají kapacitu, vlastní řádek se nepočítá", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 100 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP);
    await f.reserve(a.id, 50);

    expect((await f.availability(a.id, { range: { dayFrom: 2, dayTo: 2 } })).available).toBe(50);
    // Úprava stávajícího řádku (stejný rozsah) jeho původní množství nepočítá.
    expect((await f.availability(a.id)).available).toBe(100);
    // Rozsah zadaný až do posledního dne je tentýž řádek jako „do konce akce“.
    expect((await f.availability(a.id, { range: { dayFrom: 1, dayTo: 3 } })).available).toBe(100);
    await disconnect();
  });

  maybe("excludeWholeEvent nevynechává rezervace vlastní akce", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 100 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP);
    await f.reserve(a.id, 50);
    await f.reserve(a.id, 30, 2, 2);

    // Den 2: 50 + 30 = 80 blokuje dál, doplňkový výdej smí jen zbytek.
    expect((await f.availability(a.id, { excludeWholeEvent: true })).available).toBe(20);
    await disconnect();
  });

  maybe("doplňkový výdej po vydání dne 1 nesáhne na zboží rezervované na den 2", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 100 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP, EventStatus.ISSUED);
    await f.reserve(a.id, 30, 1, 1);
    await f.reserve(a.id, 70, 2, 2);
    const warehouse = await prisma.warehouse.create({ data: { name: `SkladX-${a.id}` } });
    await prisma.eventIssue.create({
      data: {
        eventId: a.id,
        inventoryItemId: f.item.id,
        issuedQuantity: 30,
        type: "issued",
        dayFrom: 1,
        dayTo: 1,
        warehouseId: warehouse.id,
        issuedById: f.user.id,
        idempotencyKey: `d1:${a.id}:${f.item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: f.item.id,
      deltaQuantity: -30,
      reason: LedgerReason.issue,
      eventId: a.id,
      createdById: f.user.id,
      note: "Výdej dne 1"
    });

    // Fyzicky zbývá 70 a všech 70 je rezervovaných na den 2. Dodatečně vydané
    // zboží se vrací až po akci, takže vrácení dne 1 mu nepomůže.
    expect((await f.availability(a.id, { excludeWholeEvent: true })).available).toBe(0);
    await expect(
      prisma.$transaction((tx) =>
        issueAdditionalTx({
          tx,
          eventId: a.id,
          userId: f.user.id,
          idempotencyKey: `add-${a.id}`,
          warehouseId: warehouse.id,
          items: [{ inventoryItemId: f.item.id, qty: 50 }]
        })
      )
    ).rejects.toBeInstanceOf(InsufficientStockError);
    await disconnect();
  });

  maybe("prodleva vrácení prodlužuje blokaci rezervace", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10, returnDelayDays: 1 });
    const a = await f.makeEvent("A", "2030-07-01T06:00:00Z", "2030-07-01T18:00:00Z");
    await f.reserve(a.id, 10);
    const b = await f.makeEvent("B", ...DAY2);

    expect((await f.availability(b.id)).available).toBe(0);
    await disconnect();
  });

  maybe("akce, které se v cílovém okně nepřekrývají, se nesčítají", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 20 });
    const x = await f.makeEvent("X", "2030-07-01T06:00:00Z", "2030-07-01T08:00:00Z");
    const y = await f.makeEvent("Y", "2030-07-01T12:00:00Z", "2030-07-01T14:00:00Z");
    await f.reserve(x.id, 8);
    await f.reserve(y.id, 5);
    const target = await f.makeEvent("T", "2030-07-01T05:00:00Z", "2030-07-01T17:00:00Z");

    const res = await f.availability(target.id);
    expect(res.blockedTotal).toBe(8);
    expect(res.available).toBe(12);
    await disconnect();
  });

  maybe("vydaný řádek dne 1 se virtuálně vrací od konce dne 1", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP, EventStatus.ISSUED);
    await f.reserve(a.id, 10, 1, 1);
    await prisma.eventIssue.create({
      data: {
        eventId: a.id,
        inventoryItemId: f.item.id,
        issuedQuantity: 10,
        type: "issued",
        issuedById: f.user.id,
        dayFrom: 1,
        dayTo: 1,
        idempotencyKey: `vr:${a.id}:${f.item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: f.item.id,
      deltaQuantity: -10,
      reason: LedgerReason.issue,
      eventId: a.id,
      createdById: f.user.id,
      note: "Výdej na akci"
    });
    const b = await f.makeEvent("B", ...DAY2);

    const res = await f.availability(b.id);
    expect(res.physicalTotal).toBe(10);
    expect(res.available).toBe(10);
    await disconnect();
  });

  maybe("doplňkový výdej bez rozsahu se vrací až po svozu akce", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP, EventStatus.ISSUED);
    await prisma.eventIssue.create({
      data: {
        eventId: a.id,
        inventoryItemId: f.item.id,
        issuedQuantity: 5,
        type: "issued",
        issuedById: f.user.id,
        idempotencyKey: `add:${a.id}:${f.item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: f.item.id,
      deltaQuantity: -5,
      reason: LedgerReason.issue,
      eventId: a.id,
      createdById: f.user.id,
      note: "Doplňkový výdej na akci"
    });
    const b = await f.makeEvent("B", ...DAY2);

    const res = await f.availability(b.id);
    expect(res.physicalTotal).toBe(5);
    expect(res.available).toBe(5);
    await disconnect();
  });

  maybe("vydaný řádek neblokuje podruhé, výdej už snížil fyzický stav", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10 });
    const a = await f.makeEvent("A", "2030-07-01T06:00:00Z", "2030-07-02T18:00:00Z", EventStatus.ISSUED);
    await f.reserve(a.id, 5);
    await prisma.eventIssue.create({
      data: {
        eventId: a.id,
        inventoryItemId: f.item.id,
        issuedQuantity: 5,
        type: "issued",
        issuedById: f.user.id,
        dayFrom: 1,
        idempotencyKey: `dbl:${a.id}:${f.item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: f.item.id,
      deltaQuantity: -5,
      reason: LedgerReason.issue,
      eventId: a.id,
      createdById: f.user.id,
      note: "Výdej na akci"
    });
    const b = await f.makeEvent("B", "2030-07-02T06:00:00Z", "2030-07-02T12:00:00Z");

    // Dřív: fyzicky 5, blokováno 5 rezervací A, volné 0. Kusy na akci A se ale
    // odečetly už výdejem, sklad má skutečně 5 volných.
    const res = await f.availability(b.id);
    expect(res.physicalTotal).toBe(5);
    expect(res.blockedTotal).toBe(0);
    expect(res.available).toBe(5);
    await disconnect();
  });

  maybe("nevydaný den vydané akce dál blokuje", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 100 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP, EventStatus.ISSUED);
    await f.reserve(a.id, 50, 1, 1);
    await f.reserve(a.id, 30, 2, 2);
    await prisma.eventIssue.create({
      data: {
        eventId: a.id,
        inventoryItemId: f.item.id,
        issuedQuantity: 50,
        type: "issued",
        issuedById: f.user.id,
        dayFrom: 1,
        dayTo: 1,
        idempotencyKey: `part:${a.id}:${f.item.id}`
      }
    });
    await createInventoryLedgerEntry(prisma, {
      inventoryItemId: f.item.id,
      deltaQuantity: -50,
      reason: LedgerReason.issue,
      eventId: a.id,
      createdById: f.user.id,
      note: "Výdej na akci"
    });
    const b = await f.makeEvent("B", ...DAY2);

    // Den 1 se vrátil virtuálně (konec dne 1 je před B), den 2 ještě nevydaný blokuje 30.
    const res = await f.availability(b.id);
    expect(res.physicalTotal).toBe(100);
    expect(res.blockedTotal).toBe(30);
    expect(res.available).toBe(70);
    await disconnect();
  });

  maybe("neplatný rozsah se odmítne", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, { stock: 10 });
    const a = await f.makeEvent("A", A_DELIVERY, A_PICKUP);

    await expect(f.availability(a.id, { range: { dayFrom: 4, dayTo: null } })).rejects.toThrow("INVALID_DAY_RANGE");
    await disconnect();
  });
});

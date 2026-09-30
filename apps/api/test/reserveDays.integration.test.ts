import { describe, expect, it } from "vitest";
import { EventStatus, LedgerReason, Role } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { InsufficientStockError, reserveItemsTx } from "../src/services/reserve.js";

type TestPrisma = ReturnType<typeof createTestPrisma>["prisma"];

async function setup(prisma: TestPrisma, stock: number) {
  const stamp = fixtureStamp();
  const user = await prisma.user.create({
    data: { email: `resdays-${stamp}@local`, passwordHash: "x", role: Role.admin }
  });
  const parent = await prisma.category.create({ data: { name: `Kuchyn-${stamp}` } });
  const child = await prisma.category.create({ data: { name: `Zidle-${stamp}`, parentId: parent.id } });
  const item = await prisma.inventoryItem.create({ data: { name: `Zidle-${stamp}`, categoryId: child.id, unit: "ks" } });
  await prisma.inventoryLedger.create({
    data: { inventoryItemId: item.id, deltaQuantity: stock, reason: LedgerReason.audit_adjustment, createdById: user.id }
  });
  const event = await prisma.event.create({
    data: {
      name: `Trojdenni-${stamp}`,
      location: "L",
      eventDate: new Date("2030-08-01T00:00:00Z"),
      eventEndDate: new Date("2030-08-03T00:00:00Z"),
      deliveryDatetime: new Date("2030-08-01T06:00:00Z"),
      pickupDatetime: new Date("2030-08-03T18:00:00Z"),
      status: EventStatus.READY_FOR_WAREHOUSE,
      createdById: user.id
    }
  });
  const reserve = (items: Array<{ qty: number; dayFrom?: number; dayTo?: number | null }>) =>
    prisma.$transaction((tx) =>
      reserveItemsTx({
        tx,
        actor: { id: user.id, role: Role.admin },
        eventId: event.id,
        items: items.map((i) => ({ inventoryItemId: item.id, ...i }))
      })
    );
  const rows = () =>
    prisma.eventReservation.findMany({
      where: { eventId: event.id },
      orderBy: [{ dayFrom: "asc" }, { reservedQuantity: "asc" }],
      select: { dayFrom: true, dayTo: true, reservedQuantity: true }
    });
  return { reserve, rows };
}

describe("rezervace po dnech (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("stejná položka může mít víc řádků s různými dny", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, 150);
    await f.reserve([{ qty: 50 }]);
    await f.reserve([{ qty: 70, dayFrom: 2, dayTo: 2 }]);

    expect(await f.rows()).toEqual([
      { dayFrom: 1, dayTo: null, reservedQuantity: 50 },
      { dayFrom: 2, dayTo: 2, reservedQuantity: 70 }
    ]);
    await disconnect();
  });

  maybe("rozsah do posledního dne se uloží jako do konce akce", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, 10);
    await f.reserve([{ qty: 5, dayFrom: 2, dayTo: 3 }]);

    expect(await f.rows()).toEqual([{ dayFrom: 2, dayTo: null, reservedQuantity: 5 }]);
    await disconnect();
  });

  maybe("druhý řádek téže akce nepřekročí sklad", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, 100);
    await f.reserve([{ qty: 60 }]);

    const err = await f.reserve([{ qty: 50, dayFrom: 2, dayTo: 2 }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InsufficientStockError);
    expect((err as InsufficientStockError).available).toBe(40);
    await disconnect();
  });

  maybe("dva řádky v jednom požadavku se kontrolují postupně", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, 100);

    await expect(f.reserve([{ qty: 60 }, { qty: 50, dayFrom: 2, dayTo: 2 }])).rejects.toBeInstanceOf(InsufficientStockError);
    expect(await f.rows()).toEqual([]);
    await disconnect();
  });

  maybe("qty 0 smaže jen řádek daného rozsahu", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, 150);
    await f.reserve([{ qty: 50 }, { qty: 70, dayFrom: 2, dayTo: 2 }]);
    await f.reserve([{ qty: 0, dayFrom: 2, dayTo: 2 }]);

    expect(await f.rows()).toEqual([{ dayFrom: 1, dayTo: null, reservedQuantity: 50 }]);
    await disconnect();
  });

  maybe("neplatný rozsah a duplicitní řádek se odmítnou", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const f = await setup(prisma, 10);

    await expect(f.reserve([{ qty: 1, dayFrom: 4 }])).rejects.toThrow("INVALID_DAY_RANGE");
    await expect(f.reserve([{ qty: 1, dayFrom: 3, dayTo: 2 }])).rejects.toThrow("INVALID_DAY_RANGE");
    // dayTo 3 = do konce akce, tedy stejný řádek jako bez dayTo.
    await expect(f.reserve([{ qty: 1 }, { qty: 2, dayFrom: 1, dayTo: 3 }])).rejects.toThrow("DUPLICATE_ITEMS");
    await disconnect();
  });
});

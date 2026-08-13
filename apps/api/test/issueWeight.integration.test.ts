import { describe, expect, it } from "vitest";
import { Role, EventStatus } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { computeIssuedWeightKg, formatWeightKg, parseWeightValue } from "../src/services/issueWeight.js";

describe("prepocet vahy vydeje", () => {
  it("parsuje desetinnou carku i tecku", () => {
    expect(parseWeightValue("8,5")).toBe(8.5);
    expect(parseWeightValue("8.5")).toBe(8.5);
    expect(parseWeightValue("12 kg")).toBe(12);
    expect(parseWeightValue("")).toBeNull();
    expect(parseWeightValue(null)).toBeNull();
  });

  it("formatuje kilogramy cesky", () => {
    expect(formatWeightKg(17)).toBe("17 kg");
    expect(formatWeightKg(8.5)).toBe("8,5 kg");
  });

  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("pocita baleni ze souctu mnozstvi, ne po davkach", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const stamp = fixtureStamp();
    const user = await prisma.user.create({
      data: { email: `weight-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const warehouse = await prisma.warehouse.create({ data: { name: `SkladW-${stamp}` } });
    const parent = await prisma.category.create({ data: { name: `InventarW-${stamp}` } });
    const child = await prisma.category.create({ data: { name: `SkloW-${stamp}`, parentId: parent.id } });
    // Baleni po 10 kusech, jedno baleni vazi 8.5 kg.
    const item = await prisma.inventoryItem.create({
      data: {
        name: `TalirW-${stamp}`,
        categoryId: child.id,
        unit: "ks",
        warehouseId: warehouse.id,
        masterPackageQty: 10,
        masterPackageWeight: "8.5"
      }
    });
    const event = await prisma.event.create({
      data: {
        name: `AkceW-${stamp}`,
        location: "Praha",
        deliveryDatetime: new Date("2026-09-01T08:00:00Z"),
        pickupDatetime: new Date("2026-09-02T08:00:00Z"),
        status: EventStatus.ISSUED,
        createdById: user.id
      }
    });

    // Dve davky: 6 a 3 kusy. Po davkach by to bylo 1+1 = 2 baleni (17 kg),
    // ze souctu 9 kusu vyjde 1 baleni (8,5 kg).
    for (const [suffix, qty] of [["a", 6], ["b", 3]] as const) {
      await prisma.eventIssue.create({
        data: {
          eventId: event.id,
          inventoryItemId: item.id,
          issuedQuantity: qty,
          type: "issued",
          warehouseId: warehouse.id,
          issuedById: user.id,
          idempotencyKey: `w-${suffix}:${event.id}:${item.id}`
        }
      });
    }

    const kg = await prisma.$transaction((tx) => computeIssuedWeightKg(tx, event.id));
    expect(kg).toBe(8.5);

    await disconnect();
  });

  maybe("polozka bez udaju o baleni do vahy neprispiva", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    await prisma.$connect();

    const stamp = fixtureStamp();
    const user = await prisma.user.create({
      data: { email: `weight2-${stamp}@local`, passwordHash: "x", role: Role.admin }
    });
    const warehouse = await prisma.warehouse.create({ data: { name: `SkladW2-${stamp}` } });
    const cat = await prisma.category.create({ data: { name: `KatW2-${stamp}` } });
    const item = await prisma.inventoryItem.create({
      data: { name: `BezBaleni-${stamp}`, categoryId: cat.id, unit: "ks", warehouseId: warehouse.id }
    });
    const event = await prisma.event.create({
      data: {
        name: `AkceW2-${stamp}`,
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
        issuedQuantity: 5,
        type: "issued",
        warehouseId: warehouse.id,
        issuedById: user.id,
        idempotencyKey: `w2:${event.id}:${item.id}`
      }
    });

    const kg = await prisma.$transaction((tx) => computeIssuedWeightKg(tx, event.id));
    expect(kg).toBe(0);

    await disconnect();
  });
});

import { describe, expect, it } from "vitest";
import { EventStatus, Role } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";
import { createExportTx } from "../src/services/export.js";

describe("export vícedenní akce (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("snapshot nese dny řádků a počet dnů akce", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    const stamp = fixtureStamp();
    const user = await prisma.user.create({ data: { email: `expd-${stamp}@local`, passwordHash: "x", role: Role.admin } });
    const parent = await prisma.category.create({ data: { name: `Kuchyn-exp-${stamp}` } });
    const child = await prisma.category.create({ data: { name: `Zidle-exp-${stamp}`, parentId: parent.id } });
    const item = await prisma.inventoryItem.create({ data: { name: `Zidle-${stamp}`, categoryId: child.id, unit: "ks" } });
    const event = await prisma.event.create({
      data: {
        name: `Exp-${stamp}`,
        location: "L",
        deliveryDatetime: new Date("2030-10-01T06:00:00Z"),
        pickupDatetime: new Date("2030-10-03T16:00:00Z"),
        status: EventStatus.READY_FOR_WAREHOUSE,
        createdById: user.id
      }
    });
    await prisma.eventReservation.create({
      data: { eventId: event.id, inventoryItemId: item.id, reservedQuantity: 70, state: "confirmed", dayFrom: 2, dayTo: 2 }
    });
    await prisma.eventReservation.create({
      data: { eventId: event.id, inventoryItemId: item.id, reservedQuantity: 50, state: "confirmed" }
    });

    const { snapshot } = await prisma.$transaction((tx) => createExportTx({ tx, eventId: event.id, userId: user.id }));

    expect(snapshot.event.dayCount).toBe(3);
    const rows = snapshot.groups.flatMap((g) => g.items).map((i) => [i.qty, i.dayFrom, i.dayTo]);
    expect(rows).toEqual([
      [50, 1, null],
      [70, 2, 2]
    ]);
    await disconnect();
  });
});

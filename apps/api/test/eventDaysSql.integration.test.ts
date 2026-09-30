import { describe, expect, it } from "vitest";
import { EventStatus, Role } from "../generated/prisma/client.js";
import { createTestPrisma } from "./testPrisma.js";
import { fixtureStamp } from "./fixtureStamp.js";

describe("SQL funkce dnů akce nad řádkem akce (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  async function createEvent(input: { eventDate: string | null; eventEndDate: string | null; delivery: string; pickup: string }) {
    const { prisma, disconnect } = createTestPrisma(url!);
    const stamp = fixtureStamp();
    const user = await prisma.user.create({ data: { email: `edsql-${stamp}@local`, passwordHash: "x", role: Role.admin } });
    const event = await prisma.event.create({
      data: {
        name: `EdSql-${stamp}`,
        location: "L",
        eventDate: input.eventDate ? new Date(input.eventDate) : null,
        eventEndDate: input.eventEndDate ? new Date(input.eventEndDate) : null,
        deliveryDatetime: new Date(input.delivery),
        pickupDatetime: new Date(input.pickup),
        status: EventStatus.DRAFT,
        createdById: user.id
      }
    });
    return { prisma, disconnect, eventId: event.id };
  }

  async function probe(prisma: ReturnType<typeof createTestPrisma>["prisma"], eventId: string) {
    const [row] = await prisma.$queryRaw<
      Array<{ n: number; s1: Date; s2: Date; s3: Date; e1: Date; e2: Date; e3: Date; enull: Date; s0: Date }>
    >`
      SELECT
        event_row_day_count(e)::int AS n,
        event_row_day_start(e, NULL) AS s0,
        event_row_day_start(e, 1) AS s1,
        event_row_day_start(e, 2) AS s2,
        event_row_day_start(e, 3) AS s3,
        event_row_day_end(e, 1) AS e1,
        event_row_day_end(e, 2) AS e2,
        event_row_day_end(e, 3) AS e3,
        event_row_day_end(e, NULL) AS enull
      FROM events e WHERE e.id = ${eventId}::uuid
    `;
    return row;
  }

  maybe("hranice dnů jsou půlnoci v Praze i přes změnu času", async () => {
    // Akce 24.-26. 10. 2026 (UTC půlnoc kalendářního dne), závoz 8:00 letního času, svoz 19:00 zimního.
    const { prisma, disconnect, eventId } = await createEvent({
      eventDate: "2026-10-24T00:00:00Z",
      eventEndDate: "2026-10-26T00:00:00Z",
      delivery: "2026-10-24T06:00:00Z",
      pickup: "2026-10-26T18:00:00Z"
    });
    const row = await probe(prisma, eventId);

    expect(row.n).toBe(3);
    expect(row.s0.toISOString()).toBe("2026-10-24T06:00:00.000Z");
    expect(row.s1.toISOString()).toBe("2026-10-24T06:00:00.000Z");
    expect(row.s2.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(row.s3.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(row.e1.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(row.e2.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(row.e3.toISOString()).toBe("2026-10-26T18:00:00.000Z");
    expect(row.enull.toISOString()).toBe("2026-10-26T18:00:00.000Z");
    await disconnect();
  });

  maybe("akce bez data do je jednodenní a interval je závoz až svoz", async () => {
    const { prisma, disconnect, eventId } = await createEvent({
      eventDate: "2026-10-05T00:00:00Z",
      eventEndDate: null,
      delivery: "2026-10-05T06:00:00Z",
      pickup: "2026-10-05T18:00:00Z"
    });
    const row = await probe(prisma, eventId);
    expect(row.n).toBe(1);
    expect(row.s1.toISOString()).toBe("2026-10-05T06:00:00.000Z");
    expect(row.e1.toISOString()).toBe("2026-10-05T18:00:00.000Z");
    await disconnect();
  });

  maybe("svoz druhý den ráno nezvyšuje počet dnů jednodenní akce", async () => {
    const { prisma, disconnect, eventId } = await createEvent({
      eventDate: "2026-10-05T00:00:00Z",
      eventEndDate: null,
      delivery: "2026-10-05T06:00:00Z",
      pickup: "2026-10-06T06:00:00Z"
    });
    const row = await probe(prisma, eventId);
    expect(row.n).toBe(1);
    expect(row.s1.toISOString()).toBe("2026-10-05T06:00:00.000Z");
    expect(row.e1.toISOString()).toBe("2026-10-06T06:00:00.000Z");
    await disconnect();
  });

  maybe("akce bez data akce je jednodenní", async () => {
    const { prisma, disconnect, eventId } = await createEvent({
      eventDate: null,
      eventEndDate: null,
      delivery: "2026-10-05T06:00:00Z",
      pickup: "2026-10-07T06:00:00Z"
    });
    expect((await probe(prisma, eventId)).n).toBe(1);
    await disconnect();
  });

  maybe("SQL a TypeScript počítají stejný počet dnů", async () => {
    const { eventDayCount } = await import("../src/lib/eventDays.js");
    const { prisma, disconnect, eventId } = await createEvent({
      eventDate: "2026-10-05T00:00:00Z",
      eventEndDate: null,
      delivery: "2026-10-05T06:00:00Z",
      pickup: "2026-10-05T18:00:00Z"
    });
    const cases: Array<[string | null, string | null]> = [
      [null, null],
      ["2026-10-05T00:00:00Z", null],
      ["2026-10-05T00:00:00Z", "2026-10-05T00:00:00Z"],
      ["2026-10-05T00:00:00Z", "2026-10-07T00:00:00Z"],
      ["2026-10-07T00:00:00Z", "2026-10-05T00:00:00Z"],
      ["2026-10-24T00:00:00Z", "2026-10-26T00:00:00Z"]
    ];
    for (const [a, b] of cases) {
      await prisma.event.update({
        where: { id: eventId },
        data: { eventDate: a ? new Date(a) : null, eventEndDate: b ? new Date(b) : null }
      });
      const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT event_row_day_count(e)::int AS n FROM events e WHERE e.id = ${eventId}::uuid
      `;
      expect(row.n).toBe(eventDayCount(a ? new Date(a) : null, b ? new Date(b) : null));
    }
    await disconnect();
  });
});

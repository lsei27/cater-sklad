import { describe, expect, it } from "vitest";
import { createTestPrisma } from "./testPrisma.js";

describe("SQL funkce dnů akce (integration)", () => {
  const url = process.env.DATABASE_URL;
  const run = !!url && process.env.RUN_DB_TESTS === "1";
  const maybe = run ? it : it.skip;

  maybe("hranice dnů jsou půlnoci v Praze i přes změnu času", async () => {
    const { prisma, disconnect } = createTestPrisma(url!);
    // Sobota 24. 10. 2026 8:00 letního času, svoz pondělí 26. 10. 19:00 zimního času.
    const delivery = new Date("2026-10-24T06:00:00Z");
    const pickup = new Date("2026-10-26T18:00:00Z");

    const [row] = await prisma.$queryRaw<
      Array<{ n: number; s1: Date; s2: Date; s3: Date; e1: Date; e2: Date; e3: Date; enull: Date }>
    >`
      SELECT
        event_day_count(${delivery}::timestamptz, ${pickup}::timestamptz)::int AS n,
        event_day_start(${delivery}::timestamptz, 1) AS s1,
        event_day_start(${delivery}::timestamptz, 2) AS s2,
        event_day_start(${delivery}::timestamptz, 3) AS s3,
        event_day_end(${delivery}::timestamptz, ${pickup}::timestamptz, 1) AS e1,
        event_day_end(${delivery}::timestamptz, ${pickup}::timestamptz, 2) AS e2,
        event_day_end(${delivery}::timestamptz, ${pickup}::timestamptz, 3) AS e3,
        event_day_end(${delivery}::timestamptz, ${pickup}::timestamptz, NULL) AS enull
    `;

    expect(row.n).toBe(3);
    expect(row.s1.toISOString()).toBe(delivery.toISOString());
    // Neděle 25. 10. 0:00 je ještě letní čas (UTC+2).
    expect(row.s2.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    // Pondělí 26. 10. 0:00 už je zimní čas (UTC+1).
    expect(row.s3.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(row.e1.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(row.e2.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(row.e3.toISOString()).toBe(pickup.toISOString());
    expect(row.enull.toISOString()).toBe(pickup.toISOString());

    await disconnect();
  });

  maybe("SQL a TypeScript počítají stejný počet dnů", async () => {
    const { eventDayCount } = await import("../src/lib/eventDays.js");
    const { prisma, disconnect } = createTestPrisma(url!);
    const cases: Array<[string, string]> = [
      ["2026-10-05T06:00:00Z", "2026-10-05T20:00:00Z"],
      ["2026-10-05T16:00:00Z", "2026-10-05T22:30:00Z"],
      ["2026-10-24T06:00:00Z", "2026-10-26T18:00:00Z"],
      ["2026-03-28T08:00:00Z", "2026-03-30T08:00:00Z"]
    ];
    for (const [d, p] of cases) {
      const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT event_day_count(${new Date(d)}::timestamptz, ${new Date(p)}::timestamptz)::int AS n
      `;
      expect(row.n).toBe(eventDayCount(new Date(d), new Date(p)));
    }
    await disconnect();
  });
});

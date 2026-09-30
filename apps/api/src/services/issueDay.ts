import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

/**
 * Dny akce, jejichž plánovaný výdej už proběhl. Doplňkový výdej nemá rozsah
 * (day_from NULL) a vydaný den nevytváří.
 */
export async function getIssuedDaysTx(
  db: Prisma.TransactionClient | PrismaClient,
  eventId: string
): Promise<number[]> {
  const rows = await db.eventIssue.findMany({
    where: { eventId, type: "issued", dayFrom: { not: null } },
    distinct: ["dayFrom"],
    select: { dayFrom: true },
    orderBy: { dayFrom: "asc" }
  });
  return rows.flatMap((r) => (r.dayFrom === null ? [] : [r.dayFrom]));
}

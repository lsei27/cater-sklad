import type { Prisma } from "../../generated/prisma/client.js";

export function parseWeightValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(",", ".").trim();
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatWeightKg(value: number): string {
  const normalized = Math.round(value * 100) / 100;
  return `${new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: normalized % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2
  }).format(normalized)} kg`;
}

/**
 * Váha celého výdeje akce. Množství se nejdřív sečte po položkách přes
 * všechny řádky výdeje a teprve pak se dopočítají celá master balení.
 * Počítat po dávkách by u víc dávek téže položky nafouklo počet balení.
 */
export async function computeIssuedWeightKg(
  tx: Prisma.TransactionClient,
  eventId: string
): Promise<number> {
  const totals = await tx.$queryRaw<Array<{ inventory_item_id: string; issued: number }>>`
    SELECT inventory_item_id::text AS inventory_item_id, COALESCE(SUM(issued_quantity), 0)::int AS issued
    FROM event_issues
    WHERE event_id = ${eventId}::uuid AND type = 'issued'
    GROUP BY inventory_item_id
  `;
  if (totals.length === 0) return 0;

  const items = await tx.inventoryItem.findMany({
    where: { id: { in: totals.map((t) => t.inventory_item_id) } },
    select: { id: true, masterPackageQty: true, masterPackageWeight: true }
  });
  const metaById = new Map(items.map((i) => [i.id, i]));

  return totals.reduce((sum, row) => {
    const meta = metaById.get(row.inventory_item_id);
    const packageWeightKg = parseWeightValue(meta?.masterPackageWeight);
    const packageQty = meta?.masterPackageQty ?? null;
    if (!packageWeightKg || !packageQty || packageQty <= 0) return sum;
    return sum + Math.ceil(Number(row.issued) / packageQty) * packageWeightKg;
  }, 0);
}

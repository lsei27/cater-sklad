import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

export type IssuedWarehouseItem = {
  inventoryItemId: string;
  name: string;
  unit: string;
  qty: number;
  parentCategory: string;
  category: string;
};

type IssuedRow = {
  inventory_item_id: string;
  issued: number;
  name: string;
  unit: string;
  parent_category: string;
  category: string;
};

/**
 * Skutečně vydané položky akce, sečtené přes všechny řádky výdeje.
 * U vydané akce je tohle pravda o obsahu, ne export: doplňkový výdej
 * přidává další řádky, které v exportu nejsou.
 */
export async function getIssuedWarehouseItems(
  prisma: PrismaClient | Prisma.TransactionClient,
  eventId: string
): Promise<IssuedWarehouseItem[]> {
  const rows = await prisma.$queryRaw<IssuedRow[]>`
    SELECT
      i.inventory_item_id::text AS inventory_item_id,
      COALESCE(SUM(i.issued_quantity), 0)::int AS issued,
      it.name AS name,
      it.unit AS unit,
      COALESCE(cp.name, c.name, 'Nezařazeno') AS parent_category,
      CASE WHEN cp.id IS NULL THEN '' ELSE COALESCE(c.name, '') END AS category
    FROM event_issues i
    JOIN inventory_items it ON it.id = i.inventory_item_id
    LEFT JOIN categories c ON c.id = it.category_id
    LEFT JOIN categories cp ON cp.id = c.parent_id
    WHERE i.event_id = ${eventId}::uuid AND i.type = 'issued'
    GROUP BY i.inventory_item_id, it.name, it.unit, cp.id, cp.name, c.name
    ORDER BY it.name
  `;

  return rows.map((r) => ({
    inventoryItemId: r.inventory_item_id,
    name: r.name,
    unit: r.unit,
    qty: Number(r.issued),
    parentCategory: r.parent_category,
    category: r.category
  }));
}

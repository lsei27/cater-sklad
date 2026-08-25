import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

export type EventItemAvailability = {
  inventoryItemId: string;
  physicalTotal: number;
  blockedTotal: number;
  available: number;
};

type BulkAvailabilityRow = {
  inventory_item_id: string;
  physical_total: number;
  blocked_total: number;
  available: number;
};

export async function getAvailabilityForEventItemsTx(
  tx: Prisma.TransactionClient,
  targetEventId: string,
  inventoryItemIds: string[]
): Promise<EventItemAvailability[]> {
  const uniqueItemIds = Array.from(new Set(inventoryItemIds));
  if (uniqueItemIds.length === 0) return [];

  const rows = await tx.$queryRaw<BulkAvailabilityRow[]>`
WITH target AS (
  SELECT
    e.id AS event_id,
    e.delivery_datetime AS t_start,
    e.pickup_datetime   AS t_end
  FROM events e
  WHERE e.id = ${targetEventId}::uuid
),
items AS (
  SELECT DISTINCT UNNEST(${uniqueItemIds}::uuid[]) AS inventory_item_id
),
physical AS (
  SELECT
    l.inventory_item_id,
    COALESCE(SUM(l.delta_quantity), 0) AS physical_total
  FROM inventory_ledger l
  WHERE l.inventory_item_id = ANY(${uniqueItemIds}::uuid[])
  GROUP BY l.inventory_item_id
),
-- Vratná položka je dostupná až po svozu a své prodlevě. Spotřební zboží
-- se nevrací. Tato pravidla musí zůstat shodná se skladovými přehledy.
virtual_returns AS (
  SELECT
    ei.inventory_item_id,
    COALESCE(SUM(ei.issued_quantity), 0) AS virtual_qty
  FROM event_issues ei
  JOIN events e ON e.id = ei.event_id
  JOIN inventory_items ii ON ii.id = ei.inventory_item_id
  CROSS JOIN target t
  WHERE ei.inventory_item_id = ANY(${uniqueItemIds}::uuid[])
    AND e.status = 'ISSUED'
    AND ei.type = 'issued'
    AND ii.consumable = false
    AND e.pickup_datetime + make_interval(days => ii.return_delay_days) <= t.t_start
  GROUP BY ei.inventory_item_id
),
-- Za každou akci blokuje větší hodnota z rezervace a ruční blokace. Cílovou
-- akci vynecháváme, aby bylo možné její současné množství upravit až do maxima.
per_event_blocked AS (
  SELECT
    i.inventory_item_id,
    e2.id AS event_id,
    GREATEST(
      COALESCE(SUM(r.reserved_quantity), 0),
      COALESCE(MAX(wb.blocked_quantity), 0)
    ) AS blocked_qty
  FROM items i
  CROSS JOIN events e2
  CROSS JOIN target t
  LEFT JOIN event_reservations r
    ON r.event_id = e2.id
    AND r.inventory_item_id = i.inventory_item_id
    AND (r.state = 'confirmed' OR (r.state = 'draft' AND r.expires_at IS NOT NULL AND r.expires_at > NOW()))
    AND e2.status NOT IN ('CLOSED','CANCELLED')
    AND e2.delivery_datetime < t.t_end
    AND t.t_start < e2.pickup_datetime
  LEFT JOIN warehouse_blocks wb
    ON wb.event_id = e2.id
    AND wb.inventory_item_id = i.inventory_item_id
    AND t.t_start < wb.blocked_until
  WHERE e2.id <> t.event_id
    AND (r.id IS NOT NULL OR wb.id IS NOT NULL)
  GROUP BY i.inventory_item_id, e2.id
),
blocked AS (
  SELECT
    inventory_item_id,
    COALESCE(SUM(blocked_qty), 0) AS blocked_total
  FROM per_event_blocked
  GROUP BY inventory_item_id
)
SELECT
  i.inventory_item_id::text,
  (COALESCE(p.physical_total, 0) + COALESCE(vr.virtual_qty, 0)) AS physical_total,
  COALESCE(b.blocked_total, 0) AS blocked_total,
  (COALESCE(p.physical_total, 0) + COALESCE(vr.virtual_qty, 0) - COALESCE(b.blocked_total, 0)) AS available
FROM items i
LEFT JOIN physical p ON p.inventory_item_id = i.inventory_item_id
LEFT JOIN virtual_returns vr ON vr.inventory_item_id = i.inventory_item_id
LEFT JOIN blocked b ON b.inventory_item_id = i.inventory_item_id;
  `;

  const availabilityByItemId = new Map(
    rows.map((row) => [
      row.inventory_item_id,
      {
        inventoryItemId: row.inventory_item_id,
        physicalTotal: Number(row.physical_total),
        blockedTotal: Number(row.blocked_total),
        available: Number(row.available)
      }
    ])
  );

  return uniqueItemIds.map(
    (inventoryItemId) =>
      availabilityByItemId.get(inventoryItemId) ?? {
        inventoryItemId,
        physicalTotal: 0,
        blockedTotal: 0,
        available: 0
      }
  );
}

export async function getAvailabilityForEventItemTx(
  tx: Prisma.TransactionClient,
  targetEventId: string,
  inventoryItemId: string
) {
  const [row] = await getAvailabilityForEventItemsTx(tx, targetEventId, [inventoryItemId]);
  return row
    ? {
        physicalTotal: row.physicalTotal,
        blockedTotal: row.blockedTotal,
        available: row.available
      }
    : { physicalTotal: 0, blockedTotal: 0, available: 0 };
}

export async function getPhysicalTotal(
  prisma: PrismaClient | Prisma.TransactionClient,
  inventoryItemId: string
) {
  const rows = await prisma.$queryRaw<{ physical_total: number }[]>`
    SELECT COALESCE(SUM(delta_quantity),0) AS physical_total
    FROM inventory_ledger
    WHERE inventory_item_id = ${inventoryItemId}::uuid
  `;
  return Number(rows[0]?.physical_total ?? 0);
}

export async function getWarehouseQuantity(
  prisma: PrismaClient | Prisma.TransactionClient,
  inventoryItemId: string,
  warehouseId: string | null
) {
  const result = await prisma.inventoryLedger.aggregate({
    where: { inventoryItemId, warehouseId },
    _sum: { deltaQuantity: true }
  });
  return result._sum.deltaQuantity ?? 0;
}

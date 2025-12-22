import type { Prisma, PrismaClient } from "@prisma/client";

export type AvailabilityRow = { physical_total: number; blocked_total: number; available: number };

export async function getAvailabilityForEventItemTx(
  tx: Prisma.TransactionClient,
  targetEventId: string,
  inventoryItemId: string
) {
  const rows = await tx.$queryRaw<AvailabilityRow[]>`
WITH target AS (
  SELECT
    e.id AS event_id,
    e.delivery_datetime AS t_start,
    e.pickup_datetime   AS t_pickup
  FROM events e
  WHERE e.id = ${targetEventId}::uuid
),
item AS (
  SELECT
    i.id AS item_id,
    i.return_delay_days AS delay_days
  FROM inventory_items i
  WHERE i.id = ${inventoryItemId}::uuid
),
target_interval AS (
  SELECT
    t.event_id,
    t.t_start AS start_at,
    (t.t_pickup + (item.delay_days || ' days')::interval) AS end_at
  FROM target t, item
),
physical AS (
  SELECT COALESCE(SUM(l.delta_quantity),0) AS physical_total
  FROM inventory_ledger l
  WHERE l.inventory_item_id = ${inventoryItemId}::uuid
),
blocked AS (
  SELECT COALESCE(SUM(r.reserved_quantity),0) AS blocked_total
  FROM event_reservations r
  JOIN events e2 ON e2.id = r.event_id
  CROSS JOIN target_interval ti
  CROSS JOIN item
  WHERE r.inventory_item_id = ${inventoryItemId}::uuid
    AND r.event_id <> ${targetEventId}::uuid
    AND e2.status <> 'CLOSED'
    AND (
      r.state = 'confirmed'
      OR (r.state = 'draft' AND r.expires_at IS NOT NULL AND r.expires_at > NOW())
    )
    AND (
      e2.delivery_datetime < (e2.pickup_datetime + (item.delay_days || ' days')::interval)
    )
    AND (
      e2.delivery_datetime < ti.end_at
      AND ti.start_at < (e2.pickup_datetime + (item.delay_days || ' days')::interval)
    )
)
SELECT
  physical.physical_total,
  blocked.blocked_total,
  (physical.physical_total - blocked.blocked_total) AS available
FROM physical, blocked;
  `;

  const row = rows[0] ?? { physical_total: 0, blocked_total: 0, available: 0 };
  return {
    physicalTotal: Number(row.physical_total),
    blockedTotal: Number(row.blocked_total),
    available: Number(row.available)
  };
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

import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

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
    e.pickup_datetime   AS t_end
  FROM events e
  WHERE e.id = ${targetEventId}::uuid
),
physical AS (
  SELECT COALESCE(SUM(l.delta_quantity),0) AS physical_total
  FROM inventory_ledger l
  WHERE l.inventory_item_id = ${inventoryItemId}::uuid
),
-- Per-event: take GREATEST of reservation vs manual block, then sum across events
per_event_blocked AS (
  SELECT
    e2.id AS event_id,
    GREATEST(
      COALESCE(SUM(r.reserved_quantity), 0),
      COALESCE(MAX(wb.blocked_quantity), 0)
    ) AS blocked_qty
  FROM events e2
  CROSS JOIN target t
  LEFT JOIN event_reservations r
    ON r.event_id = e2.id
    AND r.inventory_item_id = ${inventoryItemId}::uuid
    AND (r.state = 'confirmed' OR (r.state = 'draft' AND r.expires_at IS NOT NULL AND r.expires_at > NOW()))
  LEFT JOIN warehouse_blocks wb
    ON wb.event_id = e2.id
    AND wb.inventory_item_id = ${inventoryItemId}::uuid
    AND t.t_start < wb.blocked_until
  WHERE e2.id <> ${targetEventId}::uuid
    AND e2.status NOT IN ('CLOSED','CANCELLED')
    AND e2.delivery_datetime < t.t_end
    AND t.t_start < e2.pickup_datetime
    AND (r.id IS NOT NULL OR wb.id IS NOT NULL)
  GROUP BY e2.id
)
SELECT
  COALESCE((SELECT physical_total FROM physical), 0) AS physical_total,
  COALESCE((SELECT SUM(blocked_qty) FROM per_event_blocked), 0) AS blocked_total,
  (COALESCE((SELECT physical_total FROM physical), 0) - COALESCE((SELECT SUM(blocked_qty) FROM per_event_blocked), 0)) AS available;
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

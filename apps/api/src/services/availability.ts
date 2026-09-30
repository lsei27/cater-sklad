import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { normalizeDayRange, WHOLE_EVENT, type DayRange } from "../lib/eventDays.js";

export type EventItemAvailability = {
  inventoryItemId: string;
  physicalTotal: number;
  blockedTotal: number;
  available: number;
};

/// Koho výpočet vynechá z blokace.
/// - none: skladové přehledy, počítá se všechno.
/// - event: doplňkový výdej. Vynechají se jen ruční blokace vlastní akce.
///   Řádky rezervací vlastní akce blokují dál: vydané dny už blokovat přestaly
///   (párují se s řádkem výdeje), ale rezervace dosud nevydaných dní drží zboží,
///   které se později vydá bez další kontroly.
/// - row: rezervace a „Volné“ u řádku. Vynechá se jen řádek se stejným klíčem
///   (akce, položka, rozsah), ostatní řádky téže akce blokují. Jinak by si dva
///   řádky jedné akce navzájem nekontrolovaly kapacitu.
/// Ruční blokace vlastní akce se vynechávají v režimu event i row.
export type AvailabilityExclusion =
  | { kind: "none" }
  | { kind: "event"; eventId: string }
  | { kind: "row"; eventId: string; range: DayRange };

type BulkAvailabilityRow = {
  inventory_item_id: string;
  physical_total: number;
  blocked_total: number;
  available: number;
};

/**
 * Jediná implementace dostupnosti. Detail akce i skladové přehledy musí počítat
 * stejně, dřív byly tři kopie téhož SQL.
 *
 * Dostupné = fyzický stav + virtuální návraty - špička souběžného vytížení
 * v intervalu <start, end). Vytížení se mění jen tam, kde nějaký blokující úsek
 * začíná, takže špičku stačí hledat v těchto bodech a na začátku intervalu.
 */
export async function getItemsAvailabilityTx(
  tx: Prisma.TransactionClient,
  params: { itemIds: string[]; start: Date; end: Date; exclude: AvailabilityExclusion }
): Promise<EventItemAvailability[]> {
  const uniqueItemIds = Array.from(new Set(params.itemIds));
  if (uniqueItemIds.length === 0) return [];

  const { start, end, exclude } = params;
  const excludeEventId = exclude.kind === "none" ? null : exclude.eventId;
  const excludeDayFrom = exclude.kind === "row" ? exclude.range.dayFrom : null;
  const excludeDayTo = exclude.kind === "row" ? exclude.range.dayTo : null;

  const rows = await tx.$queryRaw<BulkAvailabilityRow[]>`
WITH items AS (
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
-- Vratná položka je dostupná až po konci svého řádku výdeje a prodlevě.
-- Doplňkový výdej nemá rozsah (day_to NULL) a platí do svozu akce.
-- Spotřební zboží se nevrací.
virtual_returns AS (
  SELECT
    ei.inventory_item_id,
    COALESCE(SUM(ei.issued_quantity), 0) AS virtual_qty
  FROM event_issues ei
  JOIN events e ON e.id = ei.event_id
  JOIN inventory_items ii ON ii.id = ei.inventory_item_id
  WHERE ei.inventory_item_id = ANY(${uniqueItemIds}::uuid[])
    AND e.status = 'ISSUED'
    AND ei.type = 'issued'
    AND ii.consumable = false
    AND event_row_day_end(e, ei.day_to)
        + make_interval(days => ii.return_delay_days) <= ${start}::timestamptz
  GROUP BY ei.inventory_item_id
),
-- Blokující úseky: řádek rezervace od začátku svého prvního dne do konce
-- posledního dne plus prodleva vrácení, nebo ruční blokace skladu do blocked_until.
loads AS (
  SELECT
    r.inventory_item_id,
    r.event_id,
    r.reserved_quantity AS res_qty,
    0 AS block_qty,
    event_row_day_start(e, r.day_from) AS s,
    event_row_day_end(e, r.day_to)
      + make_interval(days => ii.return_delay_days) AS f
  FROM event_reservations r
  JOIN events e ON e.id = r.event_id
  JOIN inventory_items ii ON ii.id = r.inventory_item_id
  WHERE r.inventory_item_id = ANY(${uniqueItemIds}::uuid[])
    AND (r.state = 'confirmed' OR (r.state = 'draft' AND r.expires_at IS NOT NULL AND r.expires_at > NOW()))
    AND e.status NOT IN ('CLOSED','CANCELLED')
    -- Vydaný řádek už snížil fyzický stav výdejem a vrací se virtuálním
    -- návratem. Kdyby blokoval i rezervací, odečetl by se dvakrát.
    AND NOT EXISTS (
      SELECT 1 FROM event_issues ei
      WHERE ei.event_id = r.event_id
        AND ei.inventory_item_id = r.inventory_item_id
        AND ei.type = 'issued'
        AND ei.day_from = r.day_from
        AND COALESCE(ei.day_to, 0) = COALESCE(r.day_to, 0)
    )
    AND NOT COALESCE(
      r.event_id = ${excludeEventId}::uuid
      AND r.day_from = ${excludeDayFrom}::int
      AND COALESCE(r.day_to, 0) = COALESCE(${excludeDayTo}::int, 0),
      false
    )
  UNION ALL
  SELECT
    wb.inventory_item_id,
    wb.event_id,
    0,
    wb.blocked_quantity,
    '-infinity'::timestamptz,
    wb.blocked_until
  FROM warehouse_blocks wb
  WHERE wb.inventory_item_id = ANY(${uniqueItemIds}::uuid[])
    AND wb.event_id IS DISTINCT FROM ${excludeEventId}::uuid
),
active AS (
  SELECT * FROM loads
  WHERE s < ${end}::timestamptz AND ${start}::timestamptz < f
),
points AS (
  SELECT inventory_item_id, ${start}::timestamptz AS p FROM items
  UNION
  SELECT inventory_item_id, s FROM active WHERE s > ${start}::timestamptz
),
-- Za každou akci v daném bodě blokuje větší hodnota z rezervací a ruční blokace.
per_event AS (
  SELECT
    pt.inventory_item_id,
    pt.p,
    a.event_id,
    GREATEST(SUM(a.res_qty), MAX(a.block_qty)) AS qty
  FROM points pt
  JOIN active a
    ON a.inventory_item_id = pt.inventory_item_id
    AND a.s <= pt.p
    AND pt.p < a.f
  GROUP BY pt.inventory_item_id, pt.p, a.event_id
),
blocked AS (
  SELECT inventory_item_id, MAX(total) AS blocked_total
  FROM (
    SELECT inventory_item_id, p, SUM(qty) AS total
    FROM per_event
    GROUP BY inventory_item_id, p
  ) x
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

export type EventAvailabilityOptions = {
  /// Rozsah řádku, pro který se dostupnost počítá. Výchozí je celá akce.
  range?: DayRange;
  /// Doplňkový výdej: vynechají se jen ruční blokace vlastní akce, rezervace
  /// dosud nevydaných dní dál blokují.
  excludeWholeEvent?: boolean;
};

export async function getAvailabilityForEventItemsTx(
  tx: Prisma.TransactionClient,
  targetEventId: string,
  inventoryItemIds: string[],
  options: EventAvailabilityOptions = {}
): Promise<EventItemAvailability[]> {
  const [ev] = await tx.$queryRaw<Array<{ day_count: number }>>`
    SELECT event_row_day_count(e)::int AS day_count
    FROM events e WHERE e.id = ${targetEventId}::uuid
  `;
  if (!ev) throw new Error("EVENT_NOT_FOUND");

  const range = normalizeDayRange(options.range ?? WHOLE_EVENT, Number(ev.day_count));
  if (!range) throw new Error("INVALID_DAY_RANGE");

  const [interval] = await tx.$queryRaw<Array<{ t_start: Date; t_end: Date }>>`
    SELECT event_row_day_start(e, ${range.dayFrom}::int) AS t_start,
           event_row_day_end(e, ${range.dayTo}::int) AS t_end
    FROM events e WHERE e.id = ${targetEventId}::uuid
  `;

  return getItemsAvailabilityTx(tx, {
    itemIds: inventoryItemIds,
    start: interval.t_start,
    end: interval.t_end,
    exclude: options.excludeWholeEvent
      ? { kind: "event", eventId: targetEventId }
      : { kind: "row", eventId: targetEventId, range }
  });
}

export async function getAvailabilityForEventItemTx(
  tx: Prisma.TransactionClient,
  targetEventId: string,
  inventoryItemId: string,
  options: EventAvailabilityOptions = {}
) {
  const [row] = await getAvailabilityForEventItemsTx(tx, targetEventId, [inventoryItemId], options);
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

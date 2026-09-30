import type { Role, Prisma } from "../../generated/prisma/client.js";
import { getAvailabilityForEventItemsTx } from "./availability.js";
import { dayRangeKey, normalizeDayRange } from "../lib/eventDays.js";

export class InsufficientStockError extends Error {
  constructor(
    public inventoryItemId: string,
    public available: number
  ) {
    super("INSUFFICIENT_STOCK");
  }
}

/// Řádek rezervace. Bez dayFrom/dayTo platí pro celou akci.
export type ReserveItemInput = { inventoryItemId: string; qty: number; dayFrom?: number; dayTo?: number | null };

export async function reserveItemsTx(params: {
  tx: Prisma.TransactionClient;
  actor: { id: string; role: Role };
  eventId: string;
  items: ReserveItemInput[];
}) {
  const { tx, actor, eventId, items } = params;

  const [event] = await tx.$queryRaw<{ id: string; status: string; export_needs_revision: boolean; day_count: number }[]>`
    SELECT id, status::text, export_needs_revision,
           event_day_count(delivery_datetime, pickup_datetime)::int AS day_count
    FROM events
    WHERE id = ${eventId}::uuid
    FOR UPDATE
  `;
  if (!event) throw new Error("EVENT_NOT_FOUND");
  if (event.status === "ISSUED" || event.status === "CLOSED" || event.status === "CANCELLED") {
    throw new Error("EVENT_READ_ONLY");
  }

  // Rozsah se sjednotí dřív, než se hledají duplicity: „dny 1 až 3“ u třídenní
  // akce je tentýž řádek jako „celá akce“.
  const rows = items.map((item) => {
    const range = normalizeDayRange({ dayFrom: item.dayFrom, dayTo: item.dayTo }, Number(event.day_count));
    if (!range) throw new Error("INVALID_DAY_RANGE");
    return {
      inventoryItemId: item.inventoryItemId,
      qty: item.qty,
      range,
      key: `${item.inventoryItemId}|${dayRangeKey(range)}`
    };
  });
  if (new Set(rows.map((r) => r.key)).size !== rows.length) throw new Error("DUPLICATE_ITEMS");

  const itemIds = Array.from(new Set(rows.map((r) => r.inventoryItemId)));

  // 1. Check Role Category Access
  if (actor.role !== "admin") {
    const allowedAccess = await tx.roleCategoryAccess.findMany({
      where: { role: actor.role },
      select: { categoryId: true }
    });

    // Empty role config means unrestricted access for that role.
    // Restrictions only apply once admin explicitly assigns categories.
    if (allowedAccess.length > 0) {
      const allowedCategoryIds = new Set(allowedAccess.map((a) => a.categoryId));

      const itemCats = await tx.inventoryItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, categoryId: true, category: { select: { parentId: true } } }
      });

      for (const item of itemCats) {
        const isAllowed =
          allowedCategoryIds.has(item.categoryId) ||
          (item.category.parentId && allowedCategoryIds.has(item.category.parentId));

        if (!isAllowed) {
          throw new Error("CATEGORY_ACCESS_DENIED");
        }
      }
    }
  }

  // 2. Master Package roundup — adjust quantities to full master packages
  const itemIdsForLookup = rows.filter((r) => r.qty > 0).map((r) => r.inventoryItemId);
  const masterPackageItems = itemIdsForLookup.length > 0
    ? await tx.inventoryItem.findMany({
        where: { id: { in: itemIdsForLookup }, masterPackageQty: { not: null } },
        select: { id: true, masterPackageQty: true }
      })
    : [];
  const masterPackageMap = new Map(masterPackageItems.map((i) => [i.id, i.masterPackageQty!]));

  const adjustedRows = rows.map((row) => {
    if (row.qty <= 0) return { ...row, originalQty: row.qty };
    const mpq = masterPackageMap.get(row.inventoryItemId);
    if (mpq && mpq > 0) {
      return { ...row, originalQty: row.qty, qty: Math.ceil(row.qty / mpq) * mpq };
    }
    return { ...row, originalQty: row.qty };
  });

  for (const inventoryItemId of [...itemIds].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(2025, hashtext(${inventoryItemId}))`;
  }

  const existingReservations = await tx.eventReservation.findMany({
    where: { eventId, inventoryItemId: { in: itemIds } },
    select: { id: true, inventoryItemId: true, dayFrom: true, dayTo: true, createdById: true, reservedQuantity: true }
  });
  const existingByKey = new Map(
    existingReservations.map((r) => [`${r.inventoryItemId}|${dayRangeKey({ dayFrom: r.dayFrom, dayTo: r.dayTo })}`, r])
  );

  const now = new Date();
  const expiresAt =
    event.status === "DRAFT" ? new Date(now.getTime() + 30 * 60 * 1000) : null;
  const state = event.status === "DRAFT" ? "draft" : "confirmed";

  // Řádky se kontrolují a zapisují postupně, aby druhý řádek téže položky
  // v jednom požadavku viděl první a dohromady nepřekročily sklad.
  for (const row of adjustedRows) {
    const existing = existingByKey.get(row.key);

    if (row.qty <= 0) {
      if (existing) await tx.eventReservation.delete({ where: { id: existing.id } });
      continue;
    }

    const [availability] = await getAvailabilityForEventItemsTx(tx, eventId, [row.inventoryItemId], { range: row.range });
    const available = availability?.available ?? 0;
    if (row.qty > available) throw new InsufficientStockError(row.inventoryItemId, available);

    if (existing) {
      await tx.eventReservation.update({
        where: { id: existing.id },
        data: { reservedQuantity: row.qty, state, expiresAt, createdById: existing.createdById ?? actor.id }
      });
    } else {
      await tx.eventReservation.create({
        data: {
          eventId,
          inventoryItemId: row.inventoryItemId,
          reservedQuantity: row.qty,
          dayFrom: row.range.dayFrom,
          dayTo: row.range.dayTo,
          state,
          expiresAt,
          createdById: actor.id
        }
      });
    }
  }

  if (event.status === "SENT_TO_WAREHOUSE") {
    await tx.event.update({ where: { id: eventId }, data: { exportNeedsRevision: true } });

    // Sklad uz ma balenu v ruce, takze se musi dozvedet, co se v ni zmenilo -
    // ktera polozka, na ktere dny a z kolika na kolik. Priznak exportNeedsRevision
    // sam o sobe rekne jen "neco se stalo".
    const changes = adjustedRows
      .map((row) => ({
        inventoryItemId: row.inventoryItemId,
        dayFrom: row.range.dayFrom,
        dayTo: row.range.dayTo,
        from: existingByKey.get(row.key)?.reservedQuantity ?? 0,
        to: Math.max(0, row.qty)
      }))
      .filter((c) => c.from !== c.to);

    if (changes.length > 0) {
      const names = await tx.inventoryItem.findMany({
        where: { id: { in: changes.map((c) => c.inventoryItemId) } },
        select: { id: true, name: true, unit: true }
      });
      const metaById = new Map(names.map((n) => [n.id, n] as const));
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "event",
          entityId: eventId,
          action: "packing_changed",
          diffJson: {
            changes: changes.map((c) => ({
              ...c,
              name: metaById.get(c.inventoryItemId)?.name ?? c.inventoryItemId,
              unit: metaById.get(c.inventoryItemId)?.unit ?? "ks"
            }))
          }
        }
      });
    }
  }

  // Return adjusted items info so the caller can inform the user about roundups
  const masterPackageAdjustments = adjustedRows
    .filter((r) => r.originalQty !== r.qty && r.qty > 0)
    .map((r) => ({
      inventoryItemId: r.inventoryItemId,
      dayFrom: r.range.dayFrom,
      dayTo: r.range.dayTo,
      requestedQty: r.originalQty,
      adjustedQty: r.qty,
      masterPackageQty: masterPackageMap.get(r.inventoryItemId) ?? null
    }));

  return { state, expiresAt, masterPackageAdjustments };
}

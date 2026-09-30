import { LedgerReason, type Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { itemDayFrom, type ExportSnapshot } from "../pdf/exportPdf.js";
import { splitKnownIssueItems, type SkippedIssueItem } from "../lib/issueSelection.js";
import { computeIssuedWeightKg, formatWeightKg } from "./issueWeight.js";
import { createInventoryLedgerEntry } from "./ledger.js";
import { requireWarehouseId, resolveWarehouseId } from "./warehouse.js";

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

export type IssueDayItemInput = {
  inventory_item_id: string;
  issued_quantity: number;
  /// Konec rozsahu řádku. Chybí-li, vezme se ze snapshotu exportu.
  day_to?: number | null;
  warehouse_id?: string;
  idempotency_key?: string;
};

/**
 * Výdej jednoho dne akce: vydá řádky exportu, které ten den odjíždějí ze
 * skladu. Jednodenní akce má jen den 1, takže se chová jako dřív.
 * První výdej jde jen z předané akce a přepne ji na Vydáno, další dny se
 * vydávají z vydané akce.
 */
export async function issueDayTx(params: {
  tx: Prisma.TransactionClient;
  eventId: string;
  userId: string;
  day: number;
  idempotencyKey?: string;
  warehouseId?: string;
  palletCount?: number | null;
  items?: IssueDayItemInput[];
}) {
  const { tx, eventId, userId, day } = params;

  const [ev] = await tx.$queryRaw<{ status: string; export_needs_revision: boolean; day_count: number }[]>`
    SELECT status::text, export_needs_revision,
           event_day_count(delivery_datetime, pickup_datetime)::int AS day_count
    FROM events WHERE id = ${eventId}::uuid FOR UPDATE
  `;
  if (!ev) throw new Error("NOT_FOUND");
  if (ev.status === "CLOSED" || ev.status === "CANCELLED") throw new Error("READ_ONLY");
  if (!Number.isInteger(day) || day < 1 || day > Number(ev.day_count)) throw new Error("INVALID_DAY");

  const issuedDays = await getIssuedDaysTx(tx, eventId);
  if (issuedDays.includes(day)) {
    const existing = await tx.event.findUnique({ where: { id: eventId } });
    if (!existing) throw new Error("NOT_FOUND");
    return { event: existing, skippedItems: [] as SkippedIssueItem[], alreadyIssued: true };
  }
  if (ev.status !== "ISSUED") {
    if (ev.status !== "SENT_TO_WAREHOUSE") throw new Error("BAD_STATUS");
    if (ev.export_needs_revision) throw new Error("NEEDS_REVISION");
  }

  const latest = await tx.eventExport.findFirst({ where: { eventId }, orderBy: { version: "desc" } });
  if (!latest) throw new Error("NO_EXPORT");
  const snapshot = latest.snapshotJson as unknown as ExportSnapshot;

  const dayRows = snapshot.groups.flatMap((g) => g.items ?? []).filter((i) => itemDayFrom(i) === day);
  const snapshotDayToByItemId = new Map(dayRows.map((i) => [i.inventoryItemId, i.dayTo ?? null] as const));

  const candidates: IssueDayItemInput[] =
    params.items && params.items.length > 0
      ? params.items
      : dayRows.map((i) => ({ inventory_item_id: i.inventoryItemId, issued_quantity: i.qty, day_to: i.dayTo ?? null }));

  const itemsToIssue = candidates
    .filter((i) => i.issued_quantity > 0)
    .map((i) => ({
      ...i,
      day_to: i.day_to !== undefined ? i.day_to : (snapshotDayToByItemId.get(i.inventory_item_id) ?? null)
    }));
  if (itemsToIssue.length === 0) throw new Error("NO_ITEMS_TO_ISSUE");

  // Duplicitní řádek by se do event_issues zapsal jen jednou (stejný
  // idempotency_key), ale ze skladu by se odečetl za každý řádek zvlášť.
  const keys = itemsToIssue.map((i) => `${i.inventory_item_id}|${i.day_to ?? "end"}`);
  if (new Set(keys).size !== keys.length) throw new Error("DUPLICATE_ITEMS");

  const inventoryItems = await tx.inventoryItem.findMany({
    where: { id: { in: itemsToIssue.map((i) => i.inventory_item_id) } },
    select: { id: true, name: true, warehouseId: true }
  });
  const itemMetaById = new Map(inventoryItems.map((item) => [item.id, item] as const));

  // Snapshot exportu drží UUID položek bez FK, takže smazaná položka v něm
  // zůstane viset. Vydat ji nejde, vynechá se a vrátí v odpovědi.
  const snapshotNameById = new Map(
    snapshot.groups.flatMap((g) => (g.items ?? []).map((it) => [it.inventoryItemId, it.name] as const))
  );
  const { known: issuableItems, skipped: skippedItems } = splitKnownIssueItems(
    itemsToIssue,
    new Set(itemMetaById.keys()),
    snapshotNameById
  );
  if (issuableItems.length === 0) throw new Error("NO_ITEMS_TO_ISSUE");

  const withoutWarehouse = issuableItems
    .filter((i) => !resolveWarehouseId({
      explicitWarehouseId: i.warehouse_id ?? params.warehouseId,
      itemWarehouseId: itemMetaById.get(i.inventory_item_id)?.warehouseId
    }))
    .map((i) => itemMetaById.get(i.inventory_item_id)?.name ?? i.inventory_item_id);
  if (withoutWarehouse.length > 0) {
    const err = new Error("WAREHOUSE_REQUIRED") as Error & { itemNames?: string[] };
    err.itemNames = withoutWarehouse;
    throw err;
  }

  const rows = issuableItems.map((i) => {
    const meta = itemMetaById.get(i.inventory_item_id);
    if (!meta) throw new Error("ITEM_NOT_FOUND");
    const warehouseId = requireWarehouseId({
      explicitWarehouseId: i.warehouse_id ?? params.warehouseId,
      itemWarehouseId: meta.warehouseId
    });
    return {
      eventId,
      inventoryItemId: i.inventory_item_id,
      issuedQuantity: i.issued_quantity,
      warehouseId,
      issuedById: userId,
      dayFrom: day,
      dayTo: i.day_to,
      idempotencyKey:
        i.idempotency_key ??
        `${params.idempotencyKey ?? "issue"}:${eventId}:${i.inventory_item_id}:${day}-${i.day_to ?? "end"}`
    };
  });
  await tx.eventIssue.createMany({ data: rows, skipDuplicates: true });

  // Váha se počítá až z uloženého výdeje, aby šla stejnou cestou jako u doplňkového výdeje.
  const computedWeightKg = await computeIssuedWeightKg(tx, eventId);

  for (const row of rows) {
    await createInventoryLedgerEntry(tx, {
      inventoryItemId: row.inventoryItemId,
      deltaQuantity: -row.issuedQuantity,
      reason: LedgerReason.issue,
      eventId,
      warehouseId: row.warehouseId,
      createdById: userId,
      note: "Výdej na akci"
    });
  }

  // Rozpracované balení vydaného dne je bezpředmětné, stav drží event_issues.
  await tx.eventPacking.deleteMany({ where: { eventId, dayFrom: day } });

  const updated = await tx.event.update({
    where: { id: eventId },
    data: {
      status: "ISSUED",
      ...(params.palletCount !== undefined ? { palletCount: params.palletCount } : {}),
      totalWeight: computedWeightKg > 0 ? formatWeightKg(computedWeightKg) : null
    }
  });
  await tx.auditLog.create({
    data: {
      actorUserId: userId,
      entityType: "event",
      entityId: eventId,
      action: "issue",
      diffJson: {
        day,
        count: rows.length,
        pallet_count: params.palletCount ?? null,
        total_weight: computedWeightKg > 0 ? formatWeightKg(computedWeightKg) : null,
        ...(skippedItems.length > 0 ? { skipped_items: skippedItems } : {})
      }
    }
  });

  return { event: updated, skippedItems, alreadyIssued: false };
}

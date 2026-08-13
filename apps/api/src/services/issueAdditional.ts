import { LedgerReason, type Prisma } from "../../generated/prisma/client.js";
import { getAvailabilityForEventItemTx } from "./availability.js";
import { computeIssuedWeightKg, formatWeightKg } from "./issueWeight.js";
import { createInventoryLedgerEntry } from "./ledger.js";
import { InsufficientStockError } from "./reserve.js";
import { requireWarehouseId } from "./warehouse.js";

export type IssueAdditionalItem = { inventoryItemId: string; qty: number };

/**
 * Doplňkový výdej do už vydané akce. Event manager často zavolá z terénu,
 * že do akce potřebuje ještě něco přihodit. Zboží odchází ze skladu teď,
 * takže se zapisuje jako další řádek výdeje, ne jako rezervace.
 */
export async function issueAdditionalTx(params: {
  tx: Prisma.TransactionClient;
  eventId: string;
  userId: string;
  idempotencyKey: string;
  warehouseId?: string;
  palletCount?: number | null;
  items: IssueAdditionalItem[];
}): Promise<{ issuedCount: number; totalWeight: string | null }> {
  const { tx, eventId, userId, idempotencyKey, warehouseId, palletCount, items } = params;

  const [event] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status::text FROM events WHERE id = ${eventId}::uuid FOR UPDATE
  `;
  if (!event) throw new Error("NOT_FOUND");
  if (event.status !== "ISSUED") throw new Error("BAD_STATUS");

  const positiveItems = items.filter((i) => i.qty > 0);
  if (positiveItems.length === 0) throw new Error("NO_ITEMS_TO_ISSUE");

  const duplicateIds = positiveItems
    .map((i) => i.inventoryItemId)
    .filter((id, idx, arr) => arr.indexOf(id) !== idx);
  if (duplicateIds.length > 0) throw new Error("DUPLICATE_ITEMS");

  const inventoryItems = await tx.inventoryItem.findMany({
    where: { id: { in: positiveItems.map((i) => i.inventoryItemId) } },
    select: { id: true, warehouseId: true }
  });
  if (inventoryItems.length !== positiveItems.length) throw new Error("ITEM_NOT_FOUND");
  const itemWarehouseById = new Map(inventoryItems.map((i) => [i.id, i.warehouseId]));

  for (const { inventoryItemId } of positiveItems) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(2025, hashtext(${inventoryItemId}))`;
  }

  for (const { inventoryItemId, qty } of positiveItems) {
    const availability = await getAvailabilityForEventItemTx(tx, eventId, inventoryItemId);
    if (qty > availability.available) {
      throw new InsufficientStockError(inventoryItemId, availability.available);
    }
  }

  for (const { inventoryItemId, qty } of positiveItems) {
    const targetWarehouseId = requireWarehouseId({
      explicitWarehouseId: warehouseId,
      itemWarehouseId: itemWarehouseById.get(inventoryItemId) ?? null
    });

    await tx.eventIssue.create({
      data: {
        eventId,
        inventoryItemId,
        issuedQuantity: qty,
        type: "issued",
        warehouseId: targetWarehouseId,
        issuedById: userId,
        idempotencyKey: `${idempotencyKey}:${eventId}:${inventoryItemId}`
      }
    });

    await createInventoryLedgerEntry(tx, {
      inventoryItemId,
      deltaQuantity: -qty,
      reason: LedgerReason.issue,
      eventId,
      warehouseId: targetWarehouseId,
      createdById: userId,
      note: "Doplňkový výdej na akci"
    });
  }

  const computedWeightKg = await computeIssuedWeightKg(tx, eventId);
  const totalWeight = computedWeightKg > 0 ? formatWeightKg(computedWeightKg) : null;

  await tx.event.update({
    where: { id: eventId },
    data: {
      totalWeight,
      ...(palletCount !== undefined && palletCount !== null ? { palletCount } : {})
    }
  });

  await tx.auditLog.create({
    data: {
      actorUserId: userId,
      entityType: "event",
      entityId: eventId,
      action: "issue_additional",
      diffJson: { items: positiveItems, palletCount: palletCount ?? null }
    }
  });

  return { issuedCount: positiveItems.length, totalWeight };
}

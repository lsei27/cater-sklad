import { EventStatus, LedgerReason, Prisma } from "../../generated/prisma/client.js";
import { createInventoryLedgerEntry } from "./ledger.js";

type ReturnCloseTxClient = Prisma.TransactionClient;

export type ReturnCloseItemInput = {
  inventory_item_id: string;
  returned_quantity: number;
  broken_quantity: number;
  target_warehouse_id?: string;
  idempotency_key?: string;
};

export async function returnCloseTx(params: {
  tx: ReturnCloseTxClient;
  eventId: string;
  userId: string;
  idempotencyKey?: string;
  items: ReturnCloseItemInput[];
}) {
  const { tx, eventId, userId, idempotencyKey, items } = params;

  const [ev] = await tx.$queryRaw<{ status: string }[]>`
    SELECT status::text FROM events WHERE id = ${eventId}::uuid FOR UPDATE
  `;
  if (!ev) throw new Error("NOT_FOUND");
  if (ev.status === EventStatus.CLOSED) return { alreadyClosed: true, changedLedgerItemIds: [] as string[] };
  if (ev.status !== EventStatus.ISSUED) throw new Error("NOT_ISSUED");

  const duplicateIds = items
    .map((item) => item.inventory_item_id)
    .filter((id, index, arr) => arr.indexOf(id) !== index);
  if (duplicateIds.length > 0) throw new Error("DUPLICATE_ITEMS");

  const issuedTotals = await tx.$queryRaw<Array<{ inventory_item_id: string; issued: number }>>`
    SELECT inventory_item_id::text AS inventory_item_id, COALESCE(SUM(issued_quantity), 0)::int AS issued
    FROM event_issues
    WHERE event_id = ${eventId}::uuid AND type = 'issued'
    GROUP BY inventory_item_id
  `;

  const issuedByItemId = new Map(issuedTotals.map((row) => [row.inventory_item_id, Number(row.issued)]));
  const issuedItemIds = Array.from(issuedByItemId.keys());

  if (issuedItemIds.length > 0) {
    if (items.length === 0) throw new Error("ITEMS_REQUIRED");

    const providedIds = new Set(items.map((item) => item.inventory_item_id));
    const missingIds = issuedItemIds.filter((itemId) => !providedIds.has(itemId));
    if (missingIds.length > 0) throw new Error("ITEMS_INCOMPLETE");

    const unexpectedIds = Array.from(providedIds).filter((itemId) => !issuedByItemId.has(itemId));
    if (unexpectedIds.length > 0) throw new Error("ITEMS_UNEXPECTED");

    for (const item of items) {
      const issued = issuedByItemId.get(item.inventory_item_id);
      if (issued === undefined) throw new Error("ITEMS_UNEXPECTED");
      if (item.returned_quantity + item.broken_quantity > issued) {
        throw new Error("ITEMS_EXCEED_ISSUED");
      }
    }
  }

  const rows = items.map((item) => ({
    eventId,
    inventoryItemId: item.inventory_item_id,
    returnedQuantity: item.returned_quantity,
    brokenQuantity: item.broken_quantity,
    targetWarehouseId: item.target_warehouse_id,
    returnedById: userId,
    idempotencyKey: item.idempotency_key ?? `${idempotencyKey ?? "return"}:${eventId}:${item.inventory_item_id}`
  }));

  const changedLedgerItemIds = new Set<string>();
  if (rows.length > 0) {
    await tx.eventReturn.createMany({ data: rows, skipDuplicates: true });

    for (const row of rows) {
      if (row.returnedQuantity > 0) {
        await createInventoryLedgerEntry(tx, {
          inventoryItemId: row.inventoryItemId,
          deltaQuantity: row.returnedQuantity,
          reason: LedgerReason.return,
          eventId,
          warehouseId: row.targetWarehouseId,
          createdById: userId,
          note: "Vráceno z akce"
        });
        changedLedgerItemIds.add(row.inventoryItemId);
      }
    }
  }

  const returnedTotals = await tx.$queryRaw<Array<{ inventory_item_id: string; returned: number; broken: number }>>`
    SELECT inventory_item_id::text AS inventory_item_id,
      COALESCE(SUM(returned_quantity), 0)::int AS returned,
      COALESCE(SUM(broken_quantity), 0)::int AS broken
    FROM event_returns
    WHERE event_id = ${eventId}::uuid
    GROUP BY inventory_item_id
  `;
  const returnedByItemId = new Map(
    returnedTotals.map((row) => [row.inventory_item_id, { returned: Number(row.returned), broken: Number(row.broken) }])
  );
  const targetWarehouseByItemId = new Map(items.map((item) => [item.inventory_item_id, item.target_warehouse_id]));

  for (const [inventoryItemId, issued] of issuedByItemId.entries()) {
    const returned = returnedByItemId.get(inventoryItemId)?.returned ?? 0;
    const broken = returnedByItemId.get(inventoryItemId)?.broken ?? 0;
    const missing = issued - returned - broken;
    const warehouseId = targetWarehouseByItemId.get(inventoryItemId);

    if (broken > 0) {
      await tx.eventIssue.create({
        data: {
          eventId,
          inventoryItemId,
          issuedQuantity: broken,
          type: "broken",
          warehouseId,
          issuedById: userId,
          idempotencyKey: `breakage:${eventId}:${inventoryItemId}:${Date.now()}`
        }
      });
      await createInventoryLedgerEntry(tx, {
        inventoryItemId,
        deltaQuantity: -broken,
        reason: LedgerReason.breakage,
        eventId,
        warehouseId,
        createdById: userId,
        note: "Rozbité při návratu"
      });
      changedLedgerItemIds.add(inventoryItemId);
    }

    if (missing > 0) {
      await tx.eventIssue.create({
        data: {
          eventId,
          inventoryItemId,
          issuedQuantity: missing,
          type: "missing",
          warehouseId,
          issuedById: userId,
          idempotencyKey: `missing:${eventId}:${inventoryItemId}:${Date.now()}`
        }
      });
      await createInventoryLedgerEntry(tx, {
        inventoryItemId,
        deltaQuantity: -missing,
        reason: LedgerReason.missing,
        eventId,
        warehouseId,
        createdById: userId,
        note: "Chybějící při uzavření"
      });
      changedLedgerItemIds.add(inventoryItemId);
    }
  }

  await tx.event.update({ where: { id: eventId }, data: { status: EventStatus.CLOSED } });
  await tx.auditLog.create({
    data: {
      actorUserId: userId,
      entityType: "event",
      entityId: eventId,
      action: "return_close",
      diffJson: { items }
    }
  });

  return { alreadyClosed: false, changedLedgerItemIds: Array.from(changedLedgerItemIds) };
}

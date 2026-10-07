import { EventStatus, LedgerReason, Prisma } from "../../generated/prisma/client.js";
import { createInventoryLedgerEntry } from "./ledger.js";
import { requireWarehouseId } from "./warehouse.js";

type ReturnCloseTxClient = Prisma.TransactionClient;

export type ReturnCloseItemInput = {
  inventory_item_id: string;
  returned_quantity: number;
  broken_quantity: number;
  target_warehouse_id?: string;
  idempotency_key?: string;
};

async function loadIssuedContext(tx: ReturnCloseTxClient, eventId: string, items: ReturnCloseItemInput[]) {
  const issuedTotals = await tx.$queryRaw<Array<{ inventory_item_id: string; issued: number }>>`
    SELECT inventory_item_id::text AS inventory_item_id, COALESCE(SUM(issued_quantity), 0)::int AS issued
    FROM event_issues
    WHERE event_id = ${eventId}::uuid AND type = 'issued'
    GROUP BY inventory_item_id
  `;

  const issuedByItemId = new Map(issuedTotals.map((row) => [row.inventory_item_id, Number(row.issued)]));
  const relevantItemIds = Array.from(new Set([...issuedByItemId.keys(), ...items.map((item) => item.inventory_item_id)]));
  const inventoryItems =
    relevantItemIds.length > 0
      ? await tx.inventoryItem.findMany({
          where: { id: { in: relevantItemIds } },
          select: { id: true, warehouseId: true, consumable: true }
        })
      : [];
  return {
    issuedByItemId,
    itemWarehouseByItemId: new Map(inventoryItems.map((item) => [item.id, item.warehouseId])),
    consumableByItemId: new Map(inventoryItems.map((item) => [item.id, item.consumable]))
  };
}

function validateCloseItems(items: ReturnCloseItemInput[], issuedByItemId: Map<string, number>) {
  const duplicateIds = items
    .map((item) => item.inventory_item_id)
    .filter((id, index, arr) => arr.indexOf(id) !== index);
  if (duplicateIds.length > 0) throw new Error("DUPLICATE_ITEMS");

  const issuedItemIds = Array.from(issuedByItemId.keys());
  if (issuedItemIds.length === 0) return;
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

async function writeLossIssues(
  tx: ReturnCloseTxClient,
  params: {
    eventId: string;
    userId: string;
    issuedByItemId: Map<string, number>;
    consumableByItemId: Map<string, boolean>;
    targetWarehouseByItemId: Map<string, string>;
  }
) {
  const { eventId, userId, issuedByItemId, consumableByItemId, targetWarehouseByItemId } = params;
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

  // Ztráty se do skladu nepromítají znovu: výdej na akci je z evidence odepsal
  // už při vydání (-issued) a zpátky se přičte jen to, co se skutečně vrátilo.
  // Řádky v event_issues jsou záznam ztráty pro reporty, ne skladový pohyb.
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
    }

    if (missing > 0) {
      // U spotřebního zboží není nevrácený zbytek manko, ale spotřeba na akci.
      const isConsumable = consumableByItemId.get(inventoryItemId) ?? false;
      await tx.eventIssue.create({
        data: {
          eventId,
          inventoryItemId,
          issuedQuantity: missing,
          type: isConsumable ? "consumed" : "missing",
          warehouseId,
          issuedById: userId,
          idempotencyKey: `${isConsumable ? "consumed" : "missing"}:${eventId}:${inventoryItemId}:${Date.now()}`
        }
      });
    }
  }
}

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

  const { issuedByItemId, itemWarehouseByItemId, consumableByItemId } = await loadIssuedContext(tx, eventId, items);
  validateCloseItems(items, issuedByItemId);

  const rows = items.map((item) => ({
    eventId,
    inventoryItemId: item.inventory_item_id,
    returnedQuantity: item.returned_quantity,
    brokenQuantity: item.broken_quantity,
    targetWarehouseId: requireWarehouseId({
      explicitWarehouseId: item.target_warehouse_id,
      itemWarehouseId: itemWarehouseByItemId.get(item.inventory_item_id) ?? null
    }),
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

  const targetWarehouseByItemId = new Map(rows.map((row) => [row.inventoryItemId, row.targetWarehouseId]));
  await writeLossIssues(tx, { eventId, userId, issuedByItemId, consumableByItemId, targetWarehouseByItemId });

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

/// Oprava vrácených a rozbitých kusů u už uzavřené akce. Uložené vrácení se
/// nahradí novými čísly a sklad se pohne jen o rozdíl proti původně vrácenému
/// množství, takže se nic neodečte ani nepřičte dvakrát.
export async function correctReturnCloseTx(params: {
  tx: ReturnCloseTxClient;
  eventId: string;
  userId: string;
  items: ReturnCloseItemInput[];
}) {
  const { tx, eventId, userId, items } = params;

  const [ev] = await tx.$queryRaw<{ status: string }[]>`
    SELECT status::text FROM events WHERE id = ${eventId}::uuid FOR UPDATE
  `;
  if (!ev) throw new Error("NOT_FOUND");
  if (ev.status !== EventStatus.CLOSED) throw new Error("NOT_CLOSED");

  const { issuedByItemId, itemWarehouseByItemId, consumableByItemId } = await loadIssuedContext(tx, eventId, items);
  validateCloseItems(items, issuedByItemId);

  const previousRows = await tx.eventReturn.findMany({ where: { eventId }, orderBy: { returnedAt: "asc" } });
  const previousByItemId = new Map<string, { returned: number; broken: number; warehouseId: string | null }>();
  for (const row of previousRows) {
    const prev = previousByItemId.get(row.inventoryItemId) ?? { returned: 0, broken: 0, warehouseId: null };
    previousByItemId.set(row.inventoryItemId, {
      returned: prev.returned + row.returnedQuantity,
      broken: prev.broken + row.brokenQuantity,
      warehouseId: row.targetWarehouseId ?? prev.warehouseId
    });
  }

  const stamp = Date.now();
  const rows = items.map((item) => ({
    eventId,
    inventoryItemId: item.inventory_item_id,
    returnedQuantity: item.returned_quantity,
    brokenQuantity: item.broken_quantity,
    // Rozdíl se musí pohnout ve stejném skladu, kam šlo původní vrácení.
    targetWarehouseId: requireWarehouseId({
      explicitWarehouseId: previousByItemId.get(item.inventory_item_id)?.warehouseId,
      itemWarehouseId: itemWarehouseByItemId.get(item.inventory_item_id) ?? null
    }),
    returnedById: userId,
    idempotencyKey: `return-correct:${eventId}:${item.inventory_item_id}:${stamp}`
  }));

  const changedLedgerItemIds: string[] = [];
  for (const row of rows) {
    const delta = row.returnedQuantity - (previousByItemId.get(row.inventoryItemId)?.returned ?? 0);
    if (delta === 0) continue;
    await createInventoryLedgerEntry(tx, {
      inventoryItemId: row.inventoryItemId,
      deltaQuantity: delta,
      reason: LedgerReason.return,
      eventId,
      warehouseId: row.targetWarehouseId,
      createdById: userId,
      note: "Oprava uzavření akce"
    });
    changedLedgerItemIds.push(row.inventoryItemId);
  }

  await tx.eventReturn.deleteMany({ where: { eventId } });
  if (rows.length > 0) await tx.eventReturn.createMany({ data: rows });

  await tx.eventIssue.deleteMany({ where: { eventId, type: { in: ["broken", "missing", "consumed"] } } });
  const targetWarehouseByItemId = new Map(rows.map((row) => [row.inventoryItemId, row.targetWarehouseId]));
  await writeLossIssues(tx, { eventId, userId, issuedByItemId, consumableByItemId, targetWarehouseByItemId });

  await tx.auditLog.create({
    data: {
      actorUserId: userId,
      entityType: "event",
      entityId: eventId,
      action: "return_close_correct",
      diffJson: {
        before: Array.from(previousByItemId.entries()).map(([inventory_item_id, prev]) => ({
          inventory_item_id,
          returned_quantity: prev.returned,
          broken_quantity: prev.broken
        })),
        after: items
      }
    }
  });

  return { changedLedgerItemIds };
}

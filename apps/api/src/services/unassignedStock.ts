import { LedgerReason, Prisma } from "../../generated/prisma/client.js";
import { getWarehouseQuantity } from "./availability.js";
import { createInventoryLedgerEntry } from "./ledger.js";

export async function moveUnassignedStockTx(params: {
  tx: Prisma.TransactionClient;
  inventoryItemId: string;
  targetWarehouseId: string;
  actorUserId: string;
}) {
  const { tx, inventoryItemId, targetWarehouseId, actorUserId } = params;
  const unassignedQuantity = await getWarehouseQuantity(tx, inventoryItemId, null);

  if (unassignedQuantity < 0) {
    throw new Error("NEGATIVE_UNASSIGNED_STOCK");
  }
  if (unassignedQuantity === 0) {
    return { movedQuantity: 0 };
  }

  const note = "Přiřazení dosavadního stavu do výchozího skladu";
  await createInventoryLedgerEntry(tx, {
    inventoryItemId,
    deltaQuantity: -unassignedQuantity,
    reason: LedgerReason.transfer,
    warehouseId: null,
    createdById: actorUserId,
    note
  });
  await createInventoryLedgerEntry(tx, {
    inventoryItemId,
    deltaQuantity: unassignedQuantity,
    reason: LedgerReason.transfer,
    warehouseId: targetWarehouseId,
    createdById: actorUserId,
    note
  });

  return { movedQuantity: unassignedQuantity };
}

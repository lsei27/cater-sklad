import { describe, expect, it, vi } from "vitest";
import { LedgerReason, Prisma } from "../generated/prisma/client.js";
import { moveUnassignedStockTx } from "../src/services/unassignedStock.js";

function transactionClientWithUnassignedQuantity(quantity: number) {
  const aggregate = vi.fn().mockResolvedValue({ _sum: { deltaQuantity: quantity } });
  const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: crypto.randomUUID(), ...data }));
  const tx = { inventoryLedger: { aggregate, create } } as unknown as Prisma.TransactionClient;
  return { tx, aggregate, create };
}

describe("moveUnassignedStockTx", () => {
  it("přesune celý nepřiřazený stav do cílového skladu bez změny celkového množství", async () => {
    const { tx, create } = transactionClientWithUnassignedQuantity(3);

    const result = await moveUnassignedStockTx({
      tx,
      inventoryItemId: "item-1",
      targetWarehouseId: "warehouse-liboc",
      actorUserId: "user-1"
    });

    expect(result).toEqual({ movedQuantity: 3 });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        inventoryItemId: "item-1",
        deltaQuantity: -3,
        reason: LedgerReason.transfer,
        warehouseId: null
      })
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        inventoryItemId: "item-1",
        deltaQuantity: 3,
        reason: LedgerReason.transfer,
        warehouseId: "warehouse-liboc"
      })
    });
  });

  it("nevytvoří žádný pohyb, pokud už nepřiřazený stav neexistuje", async () => {
    const { tx, create } = transactionClientWithUnassignedQuantity(0);

    const result = await moveUnassignedStockTx({
      tx,
      inventoryItemId: "item-1",
      targetWarehouseId: "warehouse-liboc",
      actorUserId: "user-1"
    });

    expect(result).toEqual({ movedQuantity: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it("odmítne přesun záporného nepřiřazeného stavu", async () => {
    const { tx, create } = transactionClientWithUnassignedQuantity(-1);

    await expect(
      moveUnassignedStockTx({
        tx,
        inventoryItemId: "item-1",
        targetWarehouseId: "warehouse-liboc",
        actorUserId: "user-1"
      })
    ).rejects.toThrow("NEGATIVE_UNASSIGNED_STOCK");
    expect(create).not.toHaveBeenCalled();
  });
});

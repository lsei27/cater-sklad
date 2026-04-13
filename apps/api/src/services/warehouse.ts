export function resolveWarehouseId(params: {
  explicitWarehouseId?: string | null;
  itemWarehouseId?: string | null;
}) {
  return params.explicitWarehouseId ?? params.itemWarehouseId ?? null;
}

export function requireWarehouseId(params: {
  explicitWarehouseId?: string | null;
  itemWarehouseId?: string | null;
}) {
  const warehouseId = resolveWarehouseId(params);
  if (!warehouseId) {
    throw new Error("WAREHOUSE_REQUIRED");
  }
  return warehouseId;
}

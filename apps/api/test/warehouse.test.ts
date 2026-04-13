import { describe, expect, it } from "vitest";
import { requireWarehouseId, resolveWarehouseId } from "../src/services/warehouse.js";

describe("warehouse resolution", () => {
  it("prefers explicitly provided warehouse over item default warehouse", () => {
    expect(
      resolveWarehouseId({
        explicitWarehouseId: "warehouse-explicit",
        itemWarehouseId: "warehouse-item"
      })
    ).toBe("warehouse-explicit");
  });

  it("falls back to item warehouse when request does not provide one", () => {
    expect(
      requireWarehouseId({
        itemWarehouseId: "warehouse-item"
      })
    ).toBe("warehouse-item");
  });

  it("throws when neither explicit nor default warehouse exists", () => {
    expect(() => requireWarehouseId({})).toThrow("WAREHOUSE_REQUIRED");
  });
});

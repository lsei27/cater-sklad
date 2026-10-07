import { describe, expect, it } from "vitest";
import { requireStockAccess } from "../src/lib/rbac.js";

describe("requireStockAccess", () => {
  it("pustí sklad, admina a uživatele s oprávněním na inventuru", () => {
    expect(() => requireStockAccess({ role: "warehouse", canStocktake: false })).not.toThrow();
    expect(() => requireStockAccess({ role: "admin", canStocktake: false })).not.toThrow();
    expect(() => requireStockAccess({ role: "event_manager", canStocktake: true })).not.toThrow();
  });

  it("ostatní odmítne", () => {
    expect(() => requireStockAccess({ role: "event_manager", canStocktake: false })).toThrow("FORBIDDEN");
    expect(() => requireStockAccess({ role: "chef", canStocktake: false })).toThrow("FORBIDDEN");
  });
});

import { describe, expect, it } from "vitest";
import { buildExportPdf, type ExportSnapshot } from "../src/pdf/exportPdf.js";

function snapshot(items: ExportSnapshot["groups"][number]["items"]): ExportSnapshot {
  return {
    event: {
      id: "e1",
      name: "Testovaci akce",
      location: "Praha",
      deliveryDatetime: "2026-07-15T06:30:00.000Z",
      pickupDatetime: "2026-07-16T06:30:00.000Z",
      version: 1,
      exportedAt: "2026-07-14T10:00:00.000Z",
      managerName: "Test"
    },
    groups: [{ parentCategory: "Inventář", category: "Talíře", items }]
  };
}

describe("buildExportPdf", () => {
  it("stary snapshot bez skladu nespadne", async () => {
    const pdf = await buildExportPdf(
      snapshot([{ inventoryItemId: "a", name: "Talíř mělký", unit: "ks", qty: 10 }])
    );
    expect(pdf.byteLength).toBeGreaterThan(0);
  });

  it("polozka z domaciho skladu projde", async () => {
    const pdf = await buildExportPdf(
      snapshot([
        { inventoryItemId: "a", name: "Talíř mělký", unit: "ks", qty: 10, warehouseName: "Liboc", warehouseIsHome: true }
      ])
    );
    expect(pdf.byteLength).toBeGreaterThan(0);
  });

  it("polozka mimo domaci sklad i polozka bez skladu projdou", async () => {
    const pdf = await buildExportPdf(
      snapshot([
        { inventoryItemId: "a", name: "Talíř mělký", unit: "ks", qty: 10, warehouseName: "Liboc", warehouseIsHome: true },
        { inventoryItemId: "b", name: "Karafa", unit: "ks", qty: 2, warehouseName: "Cubex", warehouseIsHome: false },
        { inventoryItemId: "c", name: "Vozík", unit: "ks", qty: 1, warehouseName: null, warehouseIsHome: null }
      ])
    );
    expect(pdf.byteLength).toBeGreaterThan(0);
  });

  it("zvladne dlouhy seznam polozek mimo domaci sklad (zlom stranky)", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      inventoryItemId: `i${i}`,
      name: `Položka ${i}`,
      unit: "ks",
      qty: 1,
      warehouseName: "Břevnov",
      warehouseIsHome: false
    }));
    const pdf = await buildExportPdf(snapshot(many));
    expect(pdf.byteLength).toBeGreaterThan(0);
  });
});

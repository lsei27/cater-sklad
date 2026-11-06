import { PDFPage } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { diffSnapshots } from "../src/lib/snapshotDiff.js";
import { buildExportPdf, type ExportSnapshot } from "../src/pdf/exportPdf.js";

type Item = ExportSnapshot["groups"][number]["items"][number];

function snapshot(items: Item[], version = 1, dayCount?: number): ExportSnapshot {
  return {
    event: {
      id: "e1",
      name: "Testovaci akce",
      location: "Praha",
      deliveryDatetime: "2026-07-15T06:30:00.000Z",
      pickupDatetime: "2026-07-16T06:30:00.000Z",
      version,
      exportedAt: "2026-07-14T10:00:00.000Z",
      managerName: "Test",
      dayCount
    },
    groups: [{ parentCategory: "Inventář", category: "Talíře", items }]
  };
}

describe("diffSnapshots", () => {
  it("najde pridanou, odebranou a zmenenou polozku", () => {
    const base = snapshot([
      { inventoryItemId: "a", name: "Talíř", unit: "ks", qty: 10 },
      { inventoryItemId: "b", name: "Sklenice", unit: "ks", qty: 5 },
      { inventoryItemId: "c", name: "Vidlička", unit: "ks", qty: 20 }
    ]);
    const next = snapshot(
      [
        { inventoryItemId: "a", name: "Talíř", unit: "ks", qty: 12 },
        { inventoryItemId: "c", name: "Vidlička", unit: "ks", qty: 20 },
        { inventoryItemId: "d", name: "Ubrus", unit: "ks", qty: 3 }
      ],
      2
    );

    const changes = diffSnapshots(base, next);
    expect(changes).toEqual([
      { inventoryItemId: "a", name: "Talíř", unit: "ks", dayFrom: 1, dayTo: null, from: 10, to: 12, kind: "changed" },
      { inventoryItemId: "d", name: "Ubrus", unit: "ks", dayFrom: 1, dayTo: null, from: 0, to: 3, kind: "added" },
      { inventoryItemId: "b", name: "Sklenice", unit: "ks", dayFrom: 1, dayTo: null, from: 5, to: 0, kind: "removed" }
    ]);
  });

  it("stejne verze nemaji zadnou zmenu", () => {
    const s = snapshot([{ inventoryItemId: "a", name: "Talíř", unit: "ks", qty: 10 }]);
    expect(diffSnapshots(s, s)).toEqual([]);
  });

  it("radky vicedenni akce se porovnavaji po dnech", () => {
    const base = snapshot([{ inventoryItemId: "a", name: "Talíř", unit: "ks", qty: 10, dayFrom: 1, dayTo: 1 }], 1, 2);
    const next = snapshot(
      [
        { inventoryItemId: "a", name: "Talíř", unit: "ks", qty: 10, dayFrom: 1, dayTo: 1 },
        { inventoryItemId: "a", name: "Talíř", unit: "ks", qty: 4, dayFrom: 2, dayTo: null }
      ],
      2,
      2
    );
    expect(diffSnapshots(base, next)).toEqual([
      { inventoryItemId: "a", name: "Talíř", unit: "ks", dayFrom: 2, dayTo: null, from: 0, to: 4, kind: "added" }
    ]);
  });
});

describe("PDF se zmenami", () => {
  it("vytiskne souhrn zmen a oznaci nove a zmenene radky", async () => {
    const base = snapshot([
      { inventoryItemId: "a", name: "Talíř", unit: "ks", qty: 10 },
      { inventoryItemId: "b", name: "Sklenice", unit: "ks", qty: 5 }
    ]);
    const next = snapshot(
      [
        { inventoryItemId: "a", name: "Talíř", unit: "ks", qty: 12 },
        { inventoryItemId: "d", name: "Ubrus", unit: "ks", qty: 3 }
      ],
      3
    );
    const drawn: string[] = [];
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text: string) {
      drawn.push(text);
      return this;
    });
    try {
      const pdf = await buildExportPdf(next, undefined, false, { baseVersion: 1, changes: diffSnapshots(base, next) });
      expect(pdf.byteLength).toBeGreaterThan(0);
      expect(drawn).toContain("ZMENY OD VERZE v1 (3)");
      expect(drawn).toContain("+ Ubrus: 3 ks");
      expect(drawn).toContain("~ Talir: 10 -> 12 ks");
      expect(drawn).toContain("- Sklenice: odebrano (bylo 5 ks)");
      expect(drawn).toContain("NOVE");
      expect(drawn).toContain("bylo 10");
    } finally {
      spy.mockRestore();
    }
  });

  it("bez zmen se nic navic netiskne", async () => {
    const s = snapshot([{ inventoryItemId: "a", name: "Talíř", unit: "ks", qty: 10 }]);
    const drawn: string[] = [];
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text: string) {
      drawn.push(text);
      return this;
    });
    try {
      await buildExportPdf(s);
      expect(drawn.some((t) => t.startsWith("ZMENY OD VERZE"))).toBe(false);
      expect(drawn).not.toContain("NOVE");
    } finally {
      spy.mockRestore();
    }
  });
});

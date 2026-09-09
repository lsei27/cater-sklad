import { describe, expect, it } from "vitest";
import { splitKnownIssueItems } from "../src/lib/issueSelection.js";

// Snapshot exportu drzi UUID polozek jako holy text bez FK, takze smazana
// polozka v nem zustane viset. Vydej kvuli ni nesmi spadnout cely - polozka
// uz neexistuje, vydat ji nejde a rezervace po ni zadna nezbyla.
describe("splitKnownIssueItems", () => {
  const jmena = new Map([
    ["a", "Talíř mělký"],
    ["b", "Karafa na mléko nerez"]
  ]);

  it("propusti polozky, ktere v inventari existuji", () => {
    const res = splitKnownIssueItems(
      [{ inventory_item_id: "a", issued_quantity: 5 }],
      new Set(["a"]),
      jmena
    );
    expect(res.known).toHaveLength(1);
    expect(res.skipped).toEqual([]);
  });

  it("vynecha smazanou polozku a vrati ji i se jmenem ze snapshotu", () => {
    const res = splitKnownIssueItems(
      [
        { inventory_item_id: "a", issued_quantity: 5 },
        { inventory_item_id: "b", issued_quantity: 2 }
      ],
      new Set(["a"]),
      jmena
    );
    expect(res.known.map((i) => i.inventory_item_id)).toEqual(["a"]);
    expect(res.skipped).toEqual([{ inventoryItemId: "b", name: "Karafa na mléko nerez" }]);
  });

  it("bez jmena ve snapshotu vrati aspon UUID, at je hlaska konkretni", () => {
    const res = splitKnownIssueItems(
      [{ inventory_item_id: "c", issued_quantity: 1 }],
      new Set(),
      jmena
    );
    expect(res.skipped).toEqual([{ inventoryItemId: "c", name: "c" }]);
  });

  it("zachova poradi a nemeni puvodni pole", () => {
    const vstup = [
      { inventory_item_id: "b", issued_quantity: 2 },
      { inventory_item_id: "a", issued_quantity: 5 }
    ];
    const res = splitKnownIssueItems(vstup, new Set(["a", "b"]), jmena);
    expect(res.known.map((i) => i.inventory_item_id)).toEqual(["b", "a"]);
    expect(vstup).toHaveLength(2);
  });

  it("prazdny vstup vrati prazdne vysledky", () => {
    const res = splitKnownIssueItems([], new Set(["a"]), jmena);
    expect(res.known).toEqual([]);
    expect(res.skipped).toEqual([]);
  });
});

import type { ExportSnapshot } from "../pdf/exportPdf.js";

export type SnapshotItemChange = {
  inventoryItemId: string;
  name: string;
  unit: string;
  dayFrom: number;
  dayTo: number | null;
  from: number;
  to: number;
  kind: "added" | "removed" | "changed";
};

type Row = ExportSnapshot["groups"][number]["items"][number];

export function changeKey(inventoryItemId: string, dayFrom: number, dayTo: number | null) {
  return `${inventoryItemId}|${dayFrom}|${dayTo ?? "end"}`;
}

function rowKey(item: Row) {
  return changeKey(item.inventoryItemId, item.dayFrom ?? 1, item.dayTo ?? null);
}

function rowsByKey(snapshot: ExportSnapshot) {
  const map = new Map<string, Row>();
  for (const g of snapshot.groups) for (const it of g.items ?? []) map.set(rowKey(it), it);
  return map;
}

/// Co se v balení změnilo mezi dvěma verzemi exportu. Řádek je položka + rozsah
/// dnů, stejně jako v rezervacích. Pořadí: řádky v pořadí nové verze, odebrané na konci.
export function diffSnapshots(base: ExportSnapshot, next: ExportSnapshot): SnapshotItemChange[] {
  const before = rowsByKey(base);
  const after = rowsByKey(next);
  const changes: SnapshotItemChange[] = [];

  const toChange = (it: Row, from: number, to: number, kind: SnapshotItemChange["kind"]): SnapshotItemChange => ({
    inventoryItemId: it.inventoryItemId,
    name: it.name,
    unit: it.unit,
    dayFrom: it.dayFrom ?? 1,
    dayTo: it.dayTo ?? null,
    from,
    to,
    kind
  });

  for (const [key, it] of after) {
    const prev = before.get(key);
    if (!prev) changes.push(toChange(it, 0, it.qty, "added"));
    else if (prev.qty !== it.qty) changes.push(toChange(it, prev.qty, it.qty, "changed"));
  }
  for (const [key, it] of before) {
    if (!after.has(key)) changes.push(toChange(it, it.qty, 0, "removed"));
  }
  return changes;
}

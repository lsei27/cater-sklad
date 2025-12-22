import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

export default function InventoryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [parents, setParents] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [view, setView] = useState<string>(() => localStorage.getItem("inv_view") ?? "tile");

  const load = async () => {
    const cats = await api<{ parents: any[] }>("/categories/tree");
    setParents(cats.parents);
    const q = new URLSearchParams();
    q.set("active", "true");
    if (search) q.set("search", search);
    if (parentId) q.set("parent_category_id", parentId);
    if (categoryId) q.set("category_id", categoryId);
    const res = await api<{ items: any[] }>(`/inventory/items?${q.toString()}`);
    setItems(res.items);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    localStorage.setItem("inv_view", view);
  }, [view]);

  const subcats = useMemo(() => {
    const p = parents.find((x) => x.id === parentId);
    return p?.children ?? [];
  }, [parents, parentId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Inventář</h1>
        <div className="flex gap-2">
          <button className={`rounded px-3 py-2 text-sm ${view === "tile" ? "bg-slate-900 text-white" : "border bg-white"}`} onClick={() => setView("tile")}>
            Tile
          </button>
          <button className={`rounded px-3 py-2 text-sm ${view === "list" ? "bg-slate-900 text-white" : "border bg-white"}`} onClick={() => setView("list")}>
            List
          </button>
        </div>
      </div>

      <div className="grid gap-2 rounded border bg-white p-4 md:grid-cols-4">
        <label className="text-xs">
          Search
          <input className="mt-1 w-full rounded border px-2 py-2 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="text-xs">
          Parent
          <select className="mt-1 w-full rounded border px-2 py-2 text-sm" value={parentId} onChange={(e) => { setParentId(e.target.value); setCategoryId(""); }}>
            <option value="">— all —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Subcategory
          <select className="mt-1 w-full rounded border px-2 py-2 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!parentId}>
            <option value="">— all —</option>
            {subcats.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button className="w-full rounded bg-slate-900 px-3 py-2 text-sm text-white" onClick={load}>
            Filtrovat
          </button>
        </div>
      </div>

      {view === "tile" ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {items.map((i) => (
            <div key={i.id} className="rounded border bg-white p-3">
              <div className="aspect-video w-full overflow-hidden rounded bg-slate-100">
                {i.imageUrl ? <img className="h-full w-full object-cover" src={i.imageUrl} /> : <div className="flex h-full items-center justify-center text-xs text-slate-500">No image</div>}
              </div>
              <div className="mt-2 text-sm font-medium">{i.name}</div>
              <div className="text-xs text-slate-600">{i.category?.parent?.name} / {i.category?.name}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded border bg-white">
          <div className="grid grid-cols-12 border-b bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
            <div className="col-span-6">Název</div>
            <div className="col-span-4">Kategorie</div>
            <div className="col-span-2">Unit</div>
          </div>
          {items.map((i) => (
            <div key={i.id} className="grid grid-cols-12 border-b px-3 py-2 text-sm">
              <div className="col-span-6">{i.name}</div>
              <div className="col-span-4 text-slate-600">{i.category?.parent?.name} / {i.category?.name}</div>
              <div className="col-span-2 text-slate-600">{i.unit}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


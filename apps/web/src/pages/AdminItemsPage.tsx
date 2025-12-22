import { useEffect, useMemo, useState } from "react";
import { api, getCurrentUser } from "../lib/api";

export default function AdminItemsPage() {
  const role = getCurrentUser()?.role ?? "";
  const [parents, setParents] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const cats = await api<{ parents: any[] }>("/categories/tree");
    setParents(cats.parents);
    const q = new URLSearchParams();
    if (search) q.set("search", search);
    const res = await api<{ items: any[] }>(`/admin/items?${q.toString()}`);
    setItems(res.items);
  };

  useEffect(() => {
    if (role === "admin") load().catch(() => {});
  }, [role]);

  const childCats = useMemo(() => parents.flatMap((p: any) => (p.children ?? []).map((c: any) => ({ ...c, parentName: p.name }))), [parents]);

  if (role !== "admin") return <div className="rounded border bg-white p-4 text-sm">Pouze admin.</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Položky</h1>

      <div className="rounded border bg-white p-4">
        <div className="mb-2 font-medium">Nová položka</div>
        <form
          className="grid gap-2 md:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await api("/admin/items", {
                method: "POST",
                body: JSON.stringify({ name: newName, category_id: newCategoryId })
              });
              setNewName("");
              setNewCategoryId("");
              await load();
            } catch (e: any) {
              setError(e?.error?.message ?? "Create failed");
            }
          }}
        >
          <input className="rounded border px-3 py-2 text-sm" placeholder="Název" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <select className="rounded border px-3 py-2 text-sm" value={newCategoryId} onChange={(e) => setNewCategoryId(e.target.value)}>
            <option value="">— subcategory —</option>
            {childCats.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.parentName} / {c.name}
              </option>
            ))}
          </select>
          <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white" disabled={!newName || !newCategoryId}>
            Vytvořit
          </button>
        </form>
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
      </div>

      <div className="rounded border bg-white p-4">
        <div className="mb-2 flex gap-2">
          <input className="flex-1 rounded border px-3 py-2 text-sm" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white" onClick={load}>
            Hledat
          </button>
        </div>
        <div className="space-y-2">
          {items.map((i) => (
            <ItemRow key={i.id} item={i} onSaved={load} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ItemRow(props: { item: any; onSaved: () => void }) {
  const [imageUrl, setImageUrl] = useState(props.item.imageUrl ?? "");
  const [active, setActive] = useState<boolean>(props.item.active ?? true);
  const [saving, setSaving] = useState(false);

  return (
    <div className="rounded border p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium">{props.item.name}</div>
          <div className="text-xs text-slate-600">
            {props.item.category?.parent?.name} / {props.item.category?.name}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          active
        </label>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-4">
        <label className="md:col-span-3 text-xs">
          image_url
          <input className="mt-1 w-full rounded border px-2 py-2 text-sm" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
        </label>
        <div className="flex items-end">
          <button
            className="w-full rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api(`/admin/items/${props.item.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ image_url: imageUrl ? imageUrl : null, active })
                });
                props.onSaved();
              } finally {
                setSaving(false);
              }
            }}
          >
            Uložit
          </button>
        </div>
      </div>
    </div>
  );
}


import { useEffect, useMemo, useState } from "react";
import { api, getCurrentUser } from "../lib/api";

export default function AdminCategoriesPage() {
  const role = getCurrentUser()?.role ?? "";
  const [parents, setParents] = useState<any[]>([]);
  const [parentName, setParentName] = useState("");
  const [childParentId, setChildParentId] = useState("");
  const [childName, setChildName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await api<{ parents: any[] }>("/categories/tree");
    setParents(res.parents);
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  if (role !== "admin") return <div className="rounded border bg-white p-4 text-sm">Pouze admin.</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Kategorie</h1>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border bg-white p-4">
          <div className="mb-2 font-medium">Přidat parent</div>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                await api("/admin/categories", { method: "POST", body: JSON.stringify({ name: parentName, parent_id: null }) });
                setParentName("");
                await load();
              } catch (e: any) {
                setError(e?.error?.message ?? "Failed");
              }
            }}
          >
            <input className="flex-1 rounded border px-3 py-2 text-sm" value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder="Např. Technika" />
            <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white">Uložit</button>
          </form>
        </div>
        <div className="rounded border bg-white p-4">
          <div className="mb-2 font-medium">Přidat subcategory</div>
          <form
            className="grid gap-2 md:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                await api("/admin/categories", {
                  method: "POST",
                  body: JSON.stringify({ name: childName, parent_id: childParentId || null })
                });
                setChildName("");
                await load();
              } catch (e: any) {
                setError(e?.error?.message ?? "Failed");
              }
            }}
          >
            <select className="rounded border px-3 py-2 text-sm" value={childParentId} onChange={(e) => setChildParentId(e.target.value)}>
              <option value="">— parent —</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input className="md:col-span-2 rounded border px-3 py-2 text-sm" value={childName} onChange={(e) => setChildName(e.target.value)} placeholder="Např. Audio" />
            <div className="md:col-span-3">
              <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white" disabled={!childParentId || !childName}>
                Uložit
              </button>
            </div>
          </form>
        </div>
      </div>
      {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <div className="rounded border bg-white p-4">
        <div className="mb-2 font-medium">Tree</div>
        <div className="space-y-3">
          {parents.map((p) => (
            <div key={p.id}>
              <div className="font-medium">{p.name}</div>
              <div className="mt-1 grid gap-1 pl-4 text-sm text-slate-700">
                {(p.children ?? []).map((c: any) => (
                  <div key={c.id}>- {c.name}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


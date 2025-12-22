import { useEffect, useMemo, useState } from "react";
import { api, getCurrentUser } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Skeleton from "../components/ui/Skeleton";
import toast from "react-hot-toast";
import { Layers3, Plus } from "lucide-react";

export default function AdminCategoriesPage() {
  const role = getCurrentUser()?.role ?? "";
  const [parents, setParents] = useState<any[]>([]);
  const [typeName, setTypeName] = useState("");
  const [parentId, setParentId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api<{ parents: any[] }>("/categories/tree");
      setParents(res.parents);
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Nepodařilo se načíst kategorie.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role !== "admin") return;
    load().catch(() => {});
  }, [role]);

  const typeOptions = useMemo(() => parents.map((p) => ({ id: p.id, name: p.name })), [parents]);

  if (role !== "admin") {
    return (
      <Card>
        <CardContent>
          <div className="text-sm text-slate-700">Správa kategorií je dostupná pouze pro administrátora.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Kategorie</h1>
        <div className="text-sm text-slate-600">Typy (např. Technika) a jejich podkategorie (např. Audio).</div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Plus className="h-4 w-4" /> Nový typ
            </div>
          </CardHeader>
          <CardContent>
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("/admin/categories", { method: "POST", body: JSON.stringify({ name: typeName, parent_id: null }) });
                  setTypeName("");
                  toast.success("Typ vytvořen");
                  await load();
                } catch (e: any) {
                  toast.error(e?.error?.message ?? "Nepodařilo se vytvořit typ.");
                }
              }}
            >
              <Input value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="Např. Technika" />
              <Button disabled={!typeName.trim()}>Uložit</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Plus className="h-4 w-4" /> Nová kategorie
            </div>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-2 md:grid-cols-3"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api("/admin/categories", {
                    method: "POST",
                    body: JSON.stringify({ name: categoryName, parent_id: parentId || null })
                  });
                  setCategoryName("");
                  toast.success("Kategorie vytvořena");
                  await load();
                } catch (e: any) {
                  toast.error(e?.error?.message ?? "Nepodařilo se vytvořit kategorii.");
                }
              }}
            >
              <label className="text-sm">
                Typ
                <Select className="mt-1" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">Vyber typ…</option>
                  {typeOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="text-sm md:col-span-2">
                Název kategorie
                <Input className="mt-1" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="Např. Audio" />
              </label>
              <div className="md:col-span-3">
                <Button full disabled={!parentId || !categoryName.trim()}>
                  Uložit
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Layers3 className="h-4 w-4" /> Přehled
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, idx) => (
                <div key={idx} className="rounded-2xl border border-slate-200 p-3">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="mt-2 h-3 w-2/3" />
                </div>
              ))}
            </div>
          ) : parents.length === 0 ? (
            <div className="text-sm text-slate-600">Zatím žádné kategorie.</div>
          ) : (
            <div className="space-y-3">
              {parents.map((p) => (
                <div key={p.id} className="rounded-2xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">{p.name}</div>
                    <Badge tone="neutral">{(p.children ?? []).length} kategorií</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(p.children ?? []).map((c: any) => (
                      <Badge key={c.id} tone="neutral">
                        {c.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

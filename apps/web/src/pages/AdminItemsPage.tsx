import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, getCurrentUser } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Skeleton from "../components/ui/Skeleton";
import toast from "react-hot-toast";
import { Image as ImageIcon, Plus, Search } from "lucide-react";

export default function AdminItemsPage() {
  const role = getCurrentUser()?.role ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const [parents, setParents] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initial = searchParams.get("search");
    if (initial) setSearch(initial);
  }, []);

  const childCats = useMemo(
    () => parents.flatMap((p: any) => (p.children ?? []).map((c: any) => ({ ...c, parentName: p.name }))),
    [parents]
  );

  const load = async (opts?: { keepLoading?: boolean }) => {
    if (!opts?.keepLoading) setLoading(true);
    try {
      const cats = await api<{ parents: any[] }>("/categories/tree");
      setParents(cats.parents);
      const q = new URLSearchParams();
      if (search) q.set("search", search);
      const res = await api<{ items: any[] }>(`/admin/items?${q.toString()}`);
      setItems(res.items);
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Nepodařilo se načíst položky.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role !== "admin") return;
    load().catch(() => {});
  }, [role]);

  if (role !== "admin") {
    return (
      <Card>
        <CardContent>
          <div className="text-sm text-slate-700">Nastavení položek je dostupné pouze pro administrátora.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Položky</h1>
        <div className="text-sm text-slate-600">Úprava názvů, obrázků a dostupnosti v katalogu.</div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Plus className="h-4 w-4" /> Nová položka
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/admin/items", {
                  method: "POST",
                  body: JSON.stringify({ name: newName, category_id: newCategoryId })
                });
                setNewName("");
                setNewCategoryId("");
                toast.success("Položka vytvořena");
                await load({ keepLoading: true });
              } catch (e: any) {
                toast.error(e?.error?.message ?? "Nepodařilo se vytvořit položku.");
              }
            }}
          >
            <label className="text-sm">
              Název
              <Input className="mt-1" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Např. Sklenice na vodu" />
            </label>
            <label className="text-sm">
              Kategorie
              <Select className="mt-1" value={newCategoryId} onChange={(e) => setNewCategoryId(e.target.value)}>
                <option value="">Vyber kategorii…</option>
                {childCats.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.parentName} / {c.name}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex items-end">
              <Button full disabled={!newName || !newCategoryId}>
                Vytvořit
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Hledání</div>
          <div className="mt-1 text-sm text-slate-600">Najdi položku podle názvu.</div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-3">
            <label className="md:col-span-2 text-sm">
              Dotaz
              <div className="mt-1 flex items-center gap-2">
                <Search className="h-4 w-4 text-slate-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Název položky…" />
              </div>
            </label>
            <div className="flex items-end">
              <Button
                full
                variant="secondary"
                onClick={async () => {
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    if (search.trim()) next.set("search", search.trim());
                    else next.delete("search");
                    return next;
                  });
                  await load();
                }}
                disabled={loading}
              >
                Hledat
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Card key={idx}>
              <CardContent>
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-2 h-3 w-1/3" />
                <Skeleton className="mt-4 h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent>
            <div className="text-sm text-slate-600">Žádné položky pro zvolený dotaz.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((i) => (
            <ItemRow key={i.id} item={i} onSaved={() => load({ keepLoading: true })} />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemRow(props: { item: any; onSaved: () => void }) {
  const [imageUrl, setImageUrl] = useState(props.item.imageUrl ?? "");
  const [active, setActive] = useState<boolean>(props.item.active ?? true);
  const [saving, setSaving] = useState(false);

  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{props.item.name}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge>{props.item.category?.parent?.name ?? "Typ"}</Badge>
              <Badge tone="neutral">{props.item.category?.name ?? "Kategorie"}</Badge>
              {!active ? <Badge tone="danger">Neaktivní</Badge> : null}
            </div>
          </div>
          <div className="shrink-0">
            {imageUrl ? (
              <img className="h-12 w-12 rounded-xl object-cover" src={imageUrl} alt={props.item.name} />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <ImageIcon className="h-5 w-5" />
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="md:col-span-2 text-sm">
            Obrázek (URL)
            <Input className="mt-1" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </label>
          <label className="flex items-center gap-2 text-sm md:items-end">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Aktivní
          </label>
          <div className="md:col-span-3">
            <Button
              full
              variant="secondary"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await api(`/admin/items/${props.item.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ image_url: imageUrl ? imageUrl : null, active })
                  });
                  toast.success("Uloženo");
                  props.onSaved();
                } catch (e: any) {
                  toast.error(e?.error?.message ?? "Nepodařilo se uložit.");
                } finally {
                  setSaving(false);
                }
              }}
            >
              Uložit změny
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

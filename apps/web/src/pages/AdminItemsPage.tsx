import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiBaseUrl, apiUrl, getCurrentUser, getToken } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Skeleton from "../components/ui/Skeleton";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Modal from "../components/ui/Modal";
import toast from "react-hot-toast";
import { Image as ImageIcon, Plus, Search, Trash2, Upload } from "lucide-react";

export default function AdminItemsPage() {
  const role = getCurrentUser()?.role ?? "";
  const [searchParams, setSearchParams] = useSearchParams();
  const [parents, setParents] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);

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
    load().catch(() => { });
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Plus className="h-4 w-4" /> Nová položka
            </div>
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4 mr-2" /> Import CSV
            </Button>
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
            <ItemRow key={i.id} item={i} parents={parents} childCats={childCats} onSaved={() => load({ keepLoading: true })} />
          ))}
        </div>
      )}
      <ImportModal open={importOpen} onOpenChange={setImportOpen} onSaved={() => load()} />
    </div>
  );
}

function ItemRow({ item, parents, childCats, onSaved }: { item: any; parents: any[]; childCats: any[]; onSaved: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);

  return (
    <>
      <Card>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0">
                {item.imageUrl ? (
                  <img className="h-10 w-10 rounded-xl object-cover bg-slate-100" src={apiUrl(item.imageUrl)} alt={item.name} />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{item.name}</div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                  <span>{item.category?.parent?.name ?? "Typ"}</span>
                  <span className="text-slate-300">•</span>
                  <span>{item.category?.name ?? "Kategorie"}</span>
                  {!item.active ? <span className="text-red-600 font-semibold">• Neaktivní</span> : null}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setStockOpen(true)}>
                Sklad
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                Upravit
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <EditItemModal open={editOpen} onOpenChange={setEditOpen} item={item} childCats={childCats} onSaved={onSaved} />
      <StockModal open={stockOpen} onOpenChange={setStockOpen} item={item} onSaved={onSaved} />
    </>
  );
}

function EditItemModal({ open, onOpenChange, item, childCats, onSaved }: any) {
  const [name, setName] = useState(item.name);
  const [categoryId, setCategoryId] = useState(item.category_id);
  const [imageUrl, setImageUrl] = useState(item.imageUrl ?? "");
  const [active, setActive] = useState(item.active ?? true);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(item.name);
    setCategoryId(item.category_id);
    setImageUrl(item.imageUrl ?? "");
    setActive(item.active ?? true);
  }, [open, item]);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/admin/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, category_id: categoryId, image_url: imageUrl ? imageUrl : null, active })
      });
      toast.success("Uloženo");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Nepodařilo se uložit.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Upravit položku" primaryText="Uložit" onPrimary={save} primaryDisabled={saving}>
      <div className="grid gap-4">
        <label className="text-sm">
          Název
          <Input className="mt-1" value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="text-sm">
          Kategorie
          <Select className="mt-1" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            {childCats.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.parentName} / {c.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="text-sm">
          Obrázek (URL)
          <div className="flex gap-2">
            <Input className="mt-1 flex-1" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
            <div className="relative mt-1">
              <Button variant="secondary" className="relative">
                Upload
                <input
                  type="file"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const token = getToken();
                      const fd = new FormData();
                      fd.append("file", file);
                      const res = await fetch(`${apiBaseUrl()}/admin/items/${item.id}/image`, {
                        method: "POST",
                        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                        body: fd
                      });
                      const j = await res.json().catch(() => ({}));
                      if (!res.ok) throw j;
                      setImageUrl(j.imageUrl ?? "");
                      toast.success("Nahráno");
                    } catch (err: any) {
                      toast.error("Chyba nahrávání");
                    }
                  }}
                />
              </Button>
            </div>
          </div>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Aktivní (zobrazovat v katalogu)
        </label>

        <div className="pt-4 border-t border-slate-100">
          <Button variant="danger" full onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4 mr-2" /> Smazat položku
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        tone="danger"
        title="Smazat položku?"
        description="Pokud už byla použita v historii, pouze ji skryjeme."
        confirmText="Smazat"
        onConfirm={async () => {
          try {
            const res = await api<{ mode: "deleted" | "deactivated" }>(`/admin/items/${item.id}`, { method: "DELETE" });
            toast.success(res.mode === "deleted" ? "Smazáno" : "Skryto");
            onSaved();
            onOpenChange(false);
          } catch (e: any) {
            toast.error(e?.error?.message ?? "Chyba mazání.");
          }
        }}
      />
    </Modal>
  );
}

function StockModal({ open, onOpenChange, item, onSaved }: any) {
  const [change, setChange] = useState<string>("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const save = async () => {
    const val = parseInt(change);
    if (isNaN(val) || val === 0) {
      toast.error("Zadej platnou změnu (např. 10 nebo -5)");
      return;
    }
    setLoading(true);
    try {
      await api(`/admin/items/${item.id}/stock`, {
        method: "POST",
        body: JSON.stringify({ change: val, reason })
      });
      toast.success("Sklad upraven");
      onSaved();
      onOpenChange(false);
      setChange("");
      setReason("");
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Nepodařilo se upravit sklad.");
    } finally {
      setLoading(false);
    }
  }


  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Sklad: ${item.name}`} primaryText="Provést změnu" onPrimary={save} primaryDisabled={loading}>
      <div className="grid gap-4">
        <div className="p-3 bg-slate-50 rounded-xl text-sm text-slate-600">
          Aktuální fyzický stav: <span className="font-bold text-slate-900">{item.totalQuantity ?? 0}</span> {item.unit ?? "ks"}
        </div>
        <label className="text-sm">
          Změna (+ naskladnit, - vyskladnit/manko)
          <Input className="mt-1" type="number" value={change} onChange={e => setChange(e.target.value)} placeholder="Např. 10" />
        </label>
        <label className="text-sm">
          Důvod (nepovinné)
          <Input className="mt-1" value={reason} onChange={e => setReason(e.target.value)} placeholder="Např. nákup, rozbití..." />
        </label>
      </div>
    </Modal>
  )
}

function ImportModal({ open, onOpenChange, onSaved }: { open: boolean, onOpenChange: (v: boolean) => void, onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const f = e.dataTransfer.files[0];
      if (f.name.endsWith(".csv")) {
        setFile(f);
        setResult(null);
      } else {
        toast.error("Prosím nahrajte soubor .csv");
      }
    }
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResult(null);
    }
  };

  const upload = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const text = await file.text();
      const res = await api<any>("/admin/import/csv", {
        method: "POST",
        body: text,
        headers: { "Content-Type": "text/plain" }
      });
      setResult(res);
      toast.success("Import dokončen");
      onSaved();
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Chyba importu");
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const headers = ["name", "parent_category", "category", "unit", "quantity", "active", "return_delay_days", "sku", "notes", "image_url"];
    const ex1 = ["Talíř mělký 24cm", "Inventář", "Porcelán", "ks", "100", "1", "0", "TAL24", "Poznámka...", ""];
    const csvContent = [headers.join(";"), ex1.join(";")].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "sablona_import.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    if (!open) {
      setFile(null);
      setResult(null);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Import položek (CSV)"
      primaryText={result ? "Zavřít" : "Nahrát"}
      onPrimary={result ? () => onOpenChange(false) : upload}
      primaryDisabled={loading || !file}
      secondaryText={result ? undefined : "Stáhnout šablonu"}
      onSecondary={result ? undefined : downloadTemplate}
    >
      <div className="space-y-4">
        {!result ? (
          <div
            className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl transition-colors ${dragActive ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-slate-50"
              }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className={`h-8 w-8 mb-3 ${dragActive ? "text-indigo-500" : "text-slate-400"}`} />
            <div className="text-sm font-medium text-slate-700">Přetáhněte sem CSV soubor</div>
            <div className="text-xs text-slate-500 mt-1">nebo</div>
            <label className="mt-3 cursor-pointer">
              <span className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm shadow-sm hover:bg-slate-50 transition-colors">
                Vybrat soubor
              </span>
              <input type="file" accept=".csv" className="hidden" onChange={handleSelect} />
            </label>
            {file && <div className="mt-4 text-sm font-semibold text-indigo-600">{file.name}</div>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">
              <div className="font-semibold">Import úspěšně dokončen!</div>
              <ul className="list-disc pl-4 mt-1 space-y-0.5">
                <li>Vytvořeno položek: {result.created_items?.length ?? 0}</li>
                <li>Aktualizováno položek: {result.updated_items?.length ?? 0}</li>
                <li>Úpravy skladu: {result.ledger_adjustments?.length ?? 0}</li>
              </ul>
            </div>
            {result.errors && result.errors.length > 0 && (
              <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm max-h-40 overflow-y-auto">
                <div className="font-semibold mb-1">Chyby ({result.errors.length}):</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {result.errors.map((e: any, i: number) => (
                    <li key={i}>Řádek {e.row}: {e.error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}


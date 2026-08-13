import { useEffect, useMemo, useState } from "react";
import { api, apiBaseUrl, apiUrl, getToken } from "../lib/api";
import Input from "./ui/Input";
import Select from "./ui/Select";
import Button from "./ui/Button";
import Modal from "./ui/Modal";
import ConfirmDialog from "./ui/ConfirmDialog";
import { Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { compareByCategoryParentName, formatCategoryParentLabel } from "../lib/viewModel";

export default function EditItemModal({ open, onOpenChange, item, allItems, parents, warehouses, onSaved }: any) {
  const [name, setName] = useState(item.name);
  const [parentId, setParentId] = useState(item.category?.parent?.id ?? "");
  const [categoryId, setCategoryId] = useState(item.category_id ?? item.category?.id ?? "");
  const [unit, setUnit] = useState(item.unit ?? "ks");
  const [sku, setSku] = useState(item.sku ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [returnDelayDays, setReturnDelayDays] = useState(String(item.returnDelayDays ?? 0));
  const [masterPackageQty, setMasterPackageQty] = useState(item.masterPackageQty?.toString() ?? "");
  const [masterPackageWeight, setMasterPackageWeight] = useState(item.masterPackageWeight ?? "");
  const [volume, setVolume] = useState(item.volume ?? "");
  const [plateDiameter, setPlateDiameter] = useState(item.plateDiameter ?? "");
  const [warehouseId, setWarehouseId] = useState(item.warehouseId ?? "");
  const [imageUrl, setImageUrl] = useState(item.imageUrl ?? "");
  const [qrCode, setQrCode] = useState(item.qrCode ?? "");
  const [crossSellSearch, setCrossSellSearch] = useState("");
  const [crossSellItemIds, setCrossSellItemIds] = useState<string[]>(item.crossSellItemIds ?? []);
  const [active, setActive] = useState(item.active ?? true);
  const [consumable, setConsumable] = useState(item.consumable ?? false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const subcats = useMemo(
    () =>
      parentId
        ? (parents.find((p: any) => p.id === parentId)?.children ?? [])
        : [],
    [parents, parentId]
  );

  useEffect(() => {
    if (!open) return;
    setName(item.name);
    setParentId(item.category?.parent?.id ?? "");
    setCategoryId(item.category_id ?? item.category?.id ?? "");
    setUnit(item.unit ?? "ks");
    setSku(item.sku ?? "");
    setNotes(item.notes ?? "");
    setReturnDelayDays(String(item.returnDelayDays ?? 0));
    setMasterPackageQty(item.masterPackageQty?.toString() ?? "");
    setMasterPackageWeight(item.masterPackageWeight ?? "");
    setVolume(item.volume ?? "");
    setPlateDiameter(item.plateDiameter ?? "");
    setWarehouseId(item.warehouseId ?? "");
    setImageUrl(item.imageUrl ?? "");
    setQrCode(item.qrCode ?? "");
    setCrossSellSearch("");
    setCrossSellItemIds(item.crossSellItemIds ?? item.crossSellItems?.map((x: any) => x.id) ?? []);
    setActive(item.active ?? true);
    setConsumable(item.consumable ?? false);
  }, [open, item]);

  const crossSellCandidates = useMemo(
    () =>
      (allItems ?? [])
        .filter((candidate: any) => candidate.id !== item.id)
        .filter((candidate: any) => !crossSellItemIds.includes(candidate.id))
        .filter((candidate: any) => {
          const query = crossSellSearch.trim().toLowerCase();
          if (!query) return true;
          return [candidate.name, candidate.sku, candidate.category?.parent?.name, candidate.category?.name]
            .filter(Boolean)
            .some((part: any) => String(part).toLowerCase().includes(query));
        })
        .sort((a: any, b: any) => compareByCategoryParentName(a, b)),
    [allItems, crossSellItemIds, crossSellSearch, item.id]
  );

  const selectedCrossSellItems = useMemo(
    () =>
      crossSellItemIds
        .map((selectedId) => allItems.find((candidate: any) => candidate.id === selectedId))
        .filter(Boolean)
        .sort((a: any, b: any) => compareByCategoryParentName(a, b)),
    [allItems, crossSellItemIds]
  );

  const save = async () => {
    setSaving(true);
    try {
      await api(`/admin/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          category_id: categoryId,
          unit,
          sku: sku.trim() ? sku.trim() : null,
          notes: notes.trim() ? notes.trim() : null,
          return_delay_days: Number.isFinite(Number(returnDelayDays)) ? Number(returnDelayDays) : 0,
          master_package_qty: masterPackageQty.trim() ? Number(masterPackageQty) : null,
          master_package_weight: masterPackageWeight.trim() ? masterPackageWeight.trim() : null,
          volume: volume.trim() ? volume.trim() : null,
          plate_diameter: plateDiameter.trim() ? plateDiameter.trim() : null,
          warehouse_id: warehouseId || null,
          image_url: imageUrl ? imageUrl : null,
          qr_code: qrCode ? qrCode : null,
          cross_sell_item_ids: crossSellItemIds,
          consumable,
          active
        })
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
          Jednotka
          <Input className="mt-1" value={unit} onChange={e => setUnit(e.target.value)} placeholder="ks" />
        </label>
        <label className="text-sm">
          Hlavní kategorie
          <Select
            className="mt-1"
            value={parentId}
            onChange={e => {
              setParentId(e.target.value);
              setCategoryId("");
            }}
          >
            <option value="">Vyber hlavní kategorii…</option>
            {parents.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          Podkategorie
          <Select
            className="mt-1"
            value={categoryId}
            onChange={e => setCategoryId(e.target.value)}
            disabled={!parentId}
          >
            <option value="">{parentId ? "Vyber podkategorii…" : "Nejdřív vyber hlavní kategorii…"}</option>
            {subcats.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          SKU
          <Input className="mt-1" value={sku} onChange={e => setSku(e.target.value)} placeholder="Např. SKLO-001" />
        </label>
        <label className="text-sm">
          Výchozí sklad
          <Select className="mt-1" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
            <option value="">Bez výchozího skladu</option>
            {warehouses.map((w: any) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          Dny návratu
          <Input className="mt-1" type="number" min={0} value={returnDelayDays} onChange={e => setReturnDelayDays(e.target.value)} />
          <span className="mt-1 block text-xs text-slate-500">
            Za kolik dní po svozu je položka zase volná pro další akci.
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            checked={consumable}
            onChange={e => setConsumable(e.target.checked)}
          />
          <span>
            Spotřební zboží
            <span className="mt-0.5 block text-xs text-slate-500">
              Alkohol, mléko, káva. Při uzavření akce se nevrací automaticky celé množství, sklad zadá,
              kolik se skutečně vrátilo, a zbytek se zaúčtuje jako spotřeba, ne jako manko.
            </span>
          </span>
        </label>
        <label className="text-sm">
          Master balení
          <Input className="mt-1" type="number" min={1} value={masterPackageQty} onChange={e => setMasterPackageQty(e.target.value)} placeholder={`Počet ${unit || "ks"}`} />
        </label>
        <label className="text-sm">
          Hmotnost balení (kg, bez jednotky)
          <Input className="mt-1" inputMode="decimal" value={masterPackageWeight} onChange={e => setMasterPackageWeight(e.target.value)} placeholder="Např. 12.5" />
        </label>
        <label className="text-sm">
          Objem
          <Input className="mt-1" value={volume} onChange={e => setVolume(e.target.value)} placeholder="Např. 0.25" />
        </label>
        <label className="text-sm">
          Průměr talíře
          <Input className="mt-1" value={plateDiameter} onChange={e => setPlateDiameter(e.target.value)} placeholder="Např. 27" />
        </label>
        <label className="text-sm md:col-span-2">
          Poznámky
          <Input className="mt-1" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Interní poznámka k položce…" />
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
        <label className="text-sm">
          QR Kód / EAN (pro budoucí čtečky)
          <Input className="mt-1" value={qrCode} onChange={e => setQrCode(e.target.value)} placeholder="Naskenuj nebo zadej kód…" />
        </label>
        <div className="text-sm md:col-span-2">
          Cross-sell produkty
          <div className="mt-1 rounded-xl border border-slate-200 p-3">
            <div className="text-xs text-slate-500">
              Produkty, které se mají doporučovat při přidání této položky do akce.
            </div>

            {selectedCrossSellItems.length > 0 ? (
              <div className="mt-3">
                <div className="text-xs font-semibold text-slate-700 mb-2">Vybrané ({selectedCrossSellItems.length})</div>
                <div className="flex flex-wrap gap-2">
                  {selectedCrossSellItems.map((selected: any) => (
                    <div key={selected.id} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-1.5 pr-2">
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-white flex items-center justify-center">
                        {selected.imageUrl ? (
                          <img className="h-full w-full object-cover" src={apiUrl(selected.imageUrl)} alt={selected.name} />
                        ) : (
                          <ImageIcon className="h-3.5 w-3.5 text-slate-400" />
                        )}
                      </div>
                      <span className="text-xs font-medium text-slate-800 max-w-[120px] truncate">{selected.name}</span>
                      <button
                        type="button"
                        className="ml-1 p-0.5 text-slate-400 hover:text-red-600 transition-colors"
                        onClick={() => setCrossSellItemIds((prev) => prev.filter((id) => id !== selected.id))}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <Input
              className="mt-3"
              value={crossSellSearch}
              onChange={(e) => setCrossSellSearch(e.target.value)}
              placeholder="Hledej podle názvu, SKU nebo kategorie…"
            />
            <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {crossSellCandidates.slice(0, 40).map((candidate: any) => (
                <button
                  key={candidate.id}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-2 text-left hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors"
                  onClick={() => setCrossSellItemIds((prev) => [...prev, candidate.id])}
                >
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-100 flex items-center justify-center">
                    {candidate.imageUrl ? (
                      <img className="h-full w-full object-cover" src={apiUrl(candidate.imageUrl)} alt={candidate.name} />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-slate-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{candidate.name}</div>
                    <div className="truncate text-xs text-slate-500">
                      {formatCategoryParentLabel(candidate.category?.parent?.name, candidate.category?.name)}
                      {candidate.sku ? ` • ${candidate.sku}` : ""}
                    </div>
                  </div>
                  <Plus className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              ))}
              {crossSellCandidates.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-500">Žádné odpovídající položky k přidání.</div>
              ) : null}
            </div>
          </div>
        </div>

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

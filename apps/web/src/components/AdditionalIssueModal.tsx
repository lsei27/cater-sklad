import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Modal from "./ui/Modal";
import Select from "./ui/Select";
import { formatCategoryParentLabel } from "../lib/viewModel";

type CatalogItem = {
  id: string;
  name: string;
  unit: string;
  sku: string | null;
  category?: { name?: string; parent?: { name?: string } };
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  eventId: string;
  warehouses: Array<{ id: string; name: string }>;
  onDone: () => void;
};

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export default function AdditionalIssueModal({ open, onOpenChange, eventId, warehouses, onDone }: Props) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [available, setAvailable] = useState<Map<string, number>>(new Map());
  const [warehouseId, setWarehouseId] = useState("");
  const [palletCount, setPalletCount] = useState<number | "">("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setQty({});
      setAvailable(new Map());
      setWarehouseId("");
      setPalletCount("");
      return;
    }
    api<{ items: CatalogItem[] }>("/admin/items")
      .then((res) => setItems(res.items))
      .catch((e: unknown) => {
        const message = (e as { error?: { message?: string } })?.error?.message;
        toast.error(message ?? "Nepodařilo se načíst katalog.");
      });
  }, [open]);

  const matches = useMemo(() => {
    const tokens = normalizeSearchText(search).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    return items
      .filter((item) => {
        const haystack = normalizeSearchText(
          [item.name, item.sku, item.category?.name, item.category?.parent?.name].filter(Boolean).join(" ")
        );
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 25);
  }, [items, search]);

  // Dostupnost se dotahuje az pro zobrazene polozky, katalog ma stovky radku.
  useEffect(() => {
    if (matches.length === 0) return;
    const missing = matches.map((m) => m.id).filter((id) => !available.has(id));
    if (missing.length === 0) return;
    api<{ rows: Array<{ inventoryItemId: string; available: number }> }>(`/events/${eventId}/availability`, {
      method: "POST",
      body: JSON.stringify({ inventory_item_ids: missing })
    })
      .then((res) => {
        setAvailable((prev) => {
          const next = new Map(prev);
          for (const row of res.rows) next.set(row.inventoryItemId, row.available);
          return next;
        });
      })
      .catch(() => {});
  }, [matches, eventId, available]);

  const basket = Object.entries(qty).filter(([, value]) => value > 0);

  const submit = async () => {
    if (basket.length === 0) {
      toast.error("Zadej u nějaké položky množství.");
      return;
    }
    setSaving(true);
    try {
      await api(`/events/${eventId}/issue-additional`, {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: `additional:${Date.now()}`,
          warehouse_id: warehouseId || undefined,
          pallet_count: palletCount === "" ? undefined : palletCount,
          items: basket.map(([inventoryItemId, value]) => ({
            inventory_item_id: inventoryItemId,
            qty: value
          }))
        })
      });
      toast.success("Doplňkový výdej zapsán");
      onOpenChange(false);
      onDone();
    } catch (e: unknown) {
      const message = (e as { error?: { message?: string } })?.error?.message;
      toast.error(message ?? "Doplňkový výdej se nepodařil.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Vydat navíc">
      <div className="space-y-4">
        <div className="text-sm text-slate-600">
          Zboží se odepíše ze skladu hned a přičte se k už vydanému množství akce.
        </div>

        <label className="block text-sm">
          Vydat ze skladu
          <Select className="mt-1" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">(Výchozí sklad položky)</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="block text-sm">
          Počet palet po doplnění
          <Input
            className="mt-1"
            type="number"
            min={0}
            value={palletCount}
            onChange={(e) => setPalletCount(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))}
            placeholder="Nechat beze změny"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Vyplň jen když přírůstek změnil počet palet. Prázdné pole nechá dosavadní hodnotu.
          </span>
        </label>

        <label className="block text-sm">
          Hledat položku
          <Input
            className="mt-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Název, SKU nebo kategorie…"
          />
        </label>

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {search.trim() && matches.length === 0 ? (
            <div className="text-sm text-slate-500">Nic neodpovídá.</div>
          ) : null}
          {matches.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.name}</div>
                <div className="text-xs text-slate-500">
                  {formatCategoryParentLabel(item.category?.parent?.name, item.category?.name)}
                  {available.has(item.id) ? ` • volné: ${available.get(item.id)} ${item.unit}` : ""}
                </div>
              </div>
              <Input
                className="w-24"
                type="number"
                min={0}
                value={qty[item.id] ?? ""}
                onFocus={(e) => e.target.select()}
                onChange={(e) =>
                  setQty((prev) => ({ ...prev, [item.id]: Math.max(0, Number(e.target.value)) }))
                }
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Zrušit
          </Button>
          <Button onClick={submit} disabled={saving || basket.length === 0}>
            Vydat navíc ({basket.length})
          </Button>
        </div>
      </div>
    </Modal>
  );
}

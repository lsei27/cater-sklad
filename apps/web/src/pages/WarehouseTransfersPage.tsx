import { useState, useEffect, useCallback, useMemo } from "react";
import { api, apiUrl } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Button from "../components/ui/Button";
import Select from "../components/ui/Select";
import ItemDetailModal from "../components/ItemDetailModal";
import { Icons } from "../lib/icons";
import toast from "react-hot-toast";
import { compareByCategoryParentName, formatCategoryParentLabel } from "../lib/viewModel";

type Warehouse = {
  id: string;
  name: string;
  active: boolean;
};

type Item = {
  itemId: string;
  name: string;
  sku?: string | null;
  unit: string;
  imageUrl?: string | null;
  masterPackageQty?: number | null;
  masterPackageWeight?: string | null;
  volume?: string | null;
  plateDiameter?: string | null;
  warehouse?: { id: string; name: string } | null;
  category: {
    parent?: { name: string };
    sub: { name: string };
  };
};

export default function WarehouseTransfersPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [stocks, setStocks] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterWarehouseId, setFilterWarehouseId] = useState("");
  const [detailItem, setDetailItem] = useState<Item | null>(null);

  const [fromWh, setFromWh] = useState("");
  const [toWh, setToWh] = useState("");
  const [transferItems, setTransferItems] = useState<{ itemId: string; name: string; qty: number }[]>([]);
  const [note, setNote] = useState("");
  const [bulkQty, setBulkQty] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  const itemById = useMemo(() => new Map(items.map((item) => [item.itemId, item])), [items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [whRes, itemRes, stockRes] = await Promise.all([
        api<{ warehouses: Warehouse[] }>("/warehouses"),
        api<{ items: Item[] }>("/inventory/items?active=true"),
        api<{ stocks: Record<string, Record<string, number>> }>("/inventory/warehouse-stocks")
      ]);
      setWarehouses(whRes.warehouses);
      setItems(itemRes.items);
      setStocks(stockRes.stocks);
    } catch (e) {
      toast.error("Chyba při načítání dat");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stockForWarehouse = useCallback(
    (itemId: string, warehouseId: string) => stocks[itemId]?.[warehouseId] ?? 0,
    [stocks]
  );

  const filteredItems = useMemo(
    () =>
      items
        .filter(
          (i) =>
            i.name.toLowerCase().includes(search.toLowerCase()) ||
            (i.sku ?? "").toLowerCase().includes(search.toLowerCase()) ||
            (i.category.parent?.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
            (i.category.sub?.name ?? "").toLowerCase().includes(search.toLowerCase())
        )
        .filter((i) => (filterWarehouseId ? stockForWarehouse(i.itemId, filterWarehouseId) > 0 : true))
        .sort(compareByCategoryParentName),
    [filterWarehouseId, items, search, stockForWarehouse]
  );

  const totalStock = (itemId: string) =>
    warehouses.reduce((sum, w) => sum + (stocks[itemId]?.[w.id] ?? 0), 0);

  const sourceStock = useCallback(
    (itemId: string) => (fromWh ? stockForWarehouse(itemId, fromWh) : totalStock(itemId)),
    [fromWh, stockForWarehouse, warehouses, stocks]
  );

  const addItemToTransfer = (i: Item) => {
    if (transferItems.find((x) => x.itemId === i.itemId)) {
      toast("Již přidáno");
      return;
    }
    if (fromWh && sourceStock(i.itemId) <= 0) {
      toast.error(`Na zdrojovém skladu není pro ${i.name} žádný dostupný kus`);
      return;
    }
    setTransferItems([...transferItems, { itemId: i.itemId, name: i.name, qty: 1 }]);
    toast.success(`Přidáno: ${i.name}`);
  };

  const removeTransferItem = (itemId: string) => {
    setTransferItems(transferItems.filter((x) => x.itemId !== itemId));
  };

  const updateQty = (itemId: string, qty: number) => {
    const normalizedQty = Number.isFinite(qty) ? Math.max(1, qty) : 1;
    setTransferItems(
      transferItems.map((x) => {
        if (x.itemId !== itemId) return x;
        const maxQty = fromWh ? sourceStock(itemId) : null;
        if (typeof maxQty === "number" && maxQty > 0) {
          return { ...x, qty: Math.min(normalizedQty, maxQty) };
        }
        return { ...x, qty: normalizedQty };
      })
    );
  };

  const addFilteredItemsToTransfer = () => {
    if (!fromWh) {
      toast.error("Nejdřív vyberte zdrojový sklad");
      return;
    }
    const existingIds = new Set(transferItems.map((item) => item.itemId));
    const candidates = filteredItems.filter((item) => !existingIds.has(item.itemId) && sourceStock(item.itemId) > 0);
    if (candidates.length === 0) {
      toast("Ve filtru nejsou žádné další položky dostupné na zdrojovém skladu");
      return;
    }
    setTransferItems((prev) => [
      ...prev,
      ...candidates.map((item) => ({ itemId: item.itemId, name: item.name, qty: 1 }))
    ]);
    toast.success(`Přidáno ${candidates.length} položek`);
  };

  const applyBulkQty = (mode: "fixed" | "max") => {
    if (transferItems.length === 0) {
      toast.error("Nejdřív přidejte položky k převodu");
      return;
    }
    if (!fromWh) {
      toast.error("Nejdřív vyberte zdrojový sklad");
      return;
    }

    const parsedBulkQty = Math.max(1, Number.parseInt(bulkQty, 10) || 1);
    setTransferItems((prev) =>
      prev.map((item) => {
        const available = sourceStock(item.itemId);
        if (available <= 0) return item;
        return {
          ...item,
          qty: mode === "max" ? available : Math.min(parsedBulkQty, available)
        };
      })
    );
  };

  const invalidTransferItems = useMemo(
    () =>
      transferItems.filter((item) => {
        if (!fromWh) return false;
        const available = sourceStock(item.itemId);
        return available <= 0 || item.qty > available;
      }),
    [fromWh, sourceStock, transferItems]
  );

  const handleTransfer = async () => {
    if (!fromWh || !toWh) {
      toast.error("Vyberte zdrojový a cílový sklad");
      return;
    }
    if (fromWh === toWh) {
      toast.error("Zdrojový a cílový sklad musí být odlišné");
      return;
    }
    if (transferItems.length === 0) {
      toast.error("Přidejte položky k převodu");
      return;
    }
    if (invalidTransferItems.length > 0) {
      const firstInvalid = invalidTransferItems[0];
      const available = sourceStock(firstInvalid.itemId);
      toast.error(
        available <= 0
          ? `Položka ${firstInvalid.name} není na zdrojovém skladu dostupná`
          : `Položka ${firstInvalid.name} má na zdrojovém skladu jen ${available} ks`
      );
      return;
    }

    setSubmitting(true);
    try {
      await api("/inventory/transfers/bulk", {
        method: "POST",
        body: JSON.stringify({
          from_warehouse_id: fromWh,
          to_warehouse_id: toWh,
          note,
          items: transferItems.map((item) => ({
            inventory_item_id: item.itemId,
            quantity: item.qty
          }))
        })
      });
      toast.success("Převod byl úspěšně proveden");
      setTransferItems([]);
      setNote("");
      load();
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Chyba při provádění převodu");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Převody mezi sklady</h1>
          <p className="text-gray-500 text-sm">Manuální přesuny zásob a přehled rozmístění</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Item list — large left column */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="p-4 border-b border-gray-100">
              <div className="space-y-3">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <Icons.Search className="w-4 h-4" />
                  </div>
                  <Input
                    className="pl-10"
                    placeholder="Hledat položku, SKU, kategorii..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Select value={filterWarehouseId} onChange={(e) => setFilterWarehouseId(e.target.value)}>
                    <option value="">Všechny sklady</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        Jen sklad: {w.name}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="secondary" onClick={addFilteredItemsToTransfer} disabled={!fromWh || loading}>
                    Přidat vyfiltrované
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-gray-400">Načítám...</div>
              ) : filteredItems.length === 0 ? (
                <div className="p-8 text-center text-gray-400">Nebylo nic nalezeno</div>
              ) : (
                <div className="divide-y divide-gray-100 max-h-[calc(100vh-220px)] overflow-y-auto">
                  {filteredItems.map((i) => {
                    const alreadyAdded = transferItems.some((x) => x.itemId === i.itemId);
                    const filteredWarehouseStock = filterWarehouseId ? stockForWarehouse(i.itemId, filterWarehouseId) : null;
                    const sourceWarehouseStock = fromWh ? sourceStock(i.itemId) : null;
                    return (
                      <div
                        key={i.itemId}
                        className="flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors group"
                      >
                        <button
                          onClick={() => setDetailItem(i)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left"
                          title="Zobrazit detail"
                        >
                          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100 flex items-center justify-center border border-gray-200">
                            {i.imageUrl ? (
                              <img
                                className="h-full w-full object-contain p-0.5"
                                src={apiUrl(i.imageUrl)}
                                alt={i.name}
                              />
                            ) : (
                              <div className="text-gray-400">
                                <Icons.Image />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-gray-900 truncate group-hover:text-indigo-700">
                              {i.name}
                            </div>
                            <div className="text-[11px] text-gray-500 truncate">
                              {formatCategoryParentLabel(i.category.parent?.name, i.category.sub?.name)}
                              {i.sku ? ` · ${i.sku}` : ""}
                            </div>
                            {filterWarehouseId ? (
                              <div className="mt-1 text-[11px] font-medium text-indigo-700">
                                Ve filtru skladu: {filteredWarehouseStock} {i.unit}
                              </div>
                            ) : null}
                            {fromWh ? (
                              <div className="mt-1 text-[11px] text-slate-600">
                                Na zdrojovém skladu: <span className="font-semibold text-slate-900">{sourceWarehouseStock}</span> {i.unit}
                              </div>
                            ) : null}
                            <div className="flex flex-wrap gap-1 mt-1">
                              {warehouses.map((w) => {
                                const s = stocks[i.itemId]?.[w.id] ?? 0;
                                if (s === 0) return null;
                                return (
                                  <span
                                    key={w.id}
                                    className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded"
                                  >
                                    {w.name}:{" "}
                                    <span className="font-semibold text-gray-900">{s}</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        </button>
                        <div className="shrink-0 flex items-center gap-2">
                          <div className="text-xs text-gray-500 text-right">
                            <div className="font-semibold text-gray-900">
                              {fromWh ? sourceStock(i.itemId) : totalStock(i.itemId)}
                            </div>
                            <div className="text-[10px]">{i.unit}</div>
                          </div>
                          <Button
                            size="sm"
                            variant={alreadyAdded ? "secondary" : "primary"}
                            onClick={() => addItemToTransfer(i)}
                            disabled={alreadyAdded}
                            title={alreadyAdded ? "Již přidáno" : "Přidat do převodu"}
                          >
                            {alreadyAdded ? <Icons.Check className="w-4 h-4" /> : <Icons.Plus />}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Transfer form — compact right sidebar */}
        <div className="space-y-4">
          <Card className="shadow-premium lg:sticky lg:top-20">
            <CardHeader className="bg-indigo-600 text-white rounded-t-xl py-3 px-4">
              <div className="flex items-center gap-2">
                <Icons.History />
                <h2 className="font-semibold text-sm">Nový převod</h2>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                    Z (Odkud)
                  </label>
                  <Select value={fromWh} onChange={(e) => setFromWh(e.target.value)}>
                    <option value="">Vyberte</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                    DO (Kam)
                  </label>
                  <Select value={toWh} onChange={(e) => setToWh(e.target.value)}>
                    <option value="">Vyberte</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="mb-4">
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <Icons.Box className="w-3 h-3" />
                  Položky ({transferItems.length})
                </div>
                {invalidTransferItems.length > 0 ? (
                  <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                    Některé položky nemají na zdrojovém skladu dost kusů. Upravte množství nebo změňte sklad.
                  </div>
                ) : null}
                {transferItems.length === 0 ? (
                  <div className="py-4 text-center text-xs text-gray-400 border-2 border-dashed border-gray-100 rounded-lg">
                    Vyberte položky v seznamu
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {transferItems.map((ti) => (
                      <div
                        key={ti.itemId}
                        className={`flex items-center gap-2 p-2 rounded border ${
                          fromWh && (sourceStock(ti.itemId) <= 0 || ti.qty > sourceStock(ti.itemId))
                            ? "border-amber-300 bg-amber-50"
                            : "border-gray-200 bg-gray-50"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-gray-900 truncate" title={ti.name}>
                            {ti.name}
                          </div>
                          {fromWh ? (
                            <div className="text-[10px] text-gray-500">
                              Na zdroji: {sourceStock(ti.itemId)} {itemById.get(ti.itemId)?.unit ?? "ks"}
                            </div>
                          ) : null}
                        </div>
                        <Input
                          type="number"
                          min="1"
                          value={ti.qty}
                          onChange={(e) => updateQty(ti.itemId, parseInt(e.target.value))}
                          className="bg-white py-1 w-14 text-xs"
                        />
                        <button
                          onClick={() => removeTransferItem(ti.itemId)}
                          className="text-gray-400 hover:text-red-500 p-0.5 rounded"
                        >
                          <Icons.Trash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Hromadné nastavení
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Input
                    type="number"
                    min="1"
                    value={bulkQty}
                    onChange={(e) => setBulkQty(e.target.value)}
                    placeholder="Množství pro všechny"
                  />
                  <Button size="sm" variant="secondary" onClick={() => applyBulkQty("fixed")} disabled={transferItems.length === 0}>
                    Nastavit všem
                  </Button>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => applyBulkQty("max")} disabled={transferItems.length === 0}>
                    Vyplnit maximum
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setTransferItems([])}
                    disabled={transferItems.length === 0}
                  >
                    Vyčistit
                  </Button>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Poznámka
                </label>
                <textarea
                  className="w-full rounded-lg border border-gray-200 p-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Důvod převodu..."
                />
              </div>

              <Button
                variant="primary"
                full
                onClick={handleTransfer}
                disabled={submitting || transferItems.length === 0 || invalidTransferItems.length > 0}
              >
                {submitting ? "Provádím..." : "Potvrdit převod"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <ItemDetailModal
        item={detailItem}
        warehouses={warehouses}
        warehouseStocks={stocks}
        onClose={() => setDetailItem(null)}
        primaryText="Přidat do převodu"
        onPrimary={() => {
          if (detailItem) {
            addItemToTransfer(detailItem);
            setDetailItem(null);
          }
        }}
      />
    </div>
  );
}

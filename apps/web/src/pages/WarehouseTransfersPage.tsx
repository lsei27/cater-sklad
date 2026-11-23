import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { api, apiUrl, type ApiError } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Textarea from "../components/ui/Textarea";
import Badge from "../components/ui/Badge";
import QuantityStepper from "../components/ui/QuantityStepper";
import SegmentedControl from "../components/ui/SegmentedControl";
import { ArrowLeftRight, Check, Search, Truck, Warehouse, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { cn } from "../lib/ui";
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

type Transfer = {
  id: string;
  item: { name: string; unit: string } | null;
  fromWarehouse: { name: string };
  toWarehouse: { name: string };
  quantity: number;
  note: string | null;
  transferredAt: string;
};
const TABS = [
  { value: "new", label: "Nový převod" },
  { value: "history", label: "Historie převodů" },
  { value: "suggestions", label: "Návrhy k vyrovnání" },
] as const;

export default function WarehouseTransfersPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [stocks, setStocks] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [params] = useSearchParams();
  const [search, setSearch] = useState(() => params.get("search") ?? "");
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("new");
  const [history, setHistory] = useState<Transfer[] | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [filterWarehouseId, setFilterWarehouseId] = useState("");
  const [detailItem, setDetailItem] = useState<Item | null>(null);

  const [fromWh, setFromWh] = useState("");
  const [toWh, setToWh] = useState("");
  const [transferItems, setTransferItems] = useState<{ itemId: string; name: string; qty: number }[]>([]);
  const [note, setNote] = useState("");
  const [bulkQty, setBulkQty] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const itemById = useMemo(() => new Map(items.map((item) => [item.itemId, item])), [items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [whRes, itemRes, stockRes] = await Promise.all([
        api<{ warehouses: Warehouse[] }>("/warehouses"),
        api<{ items: Item[] }>("/inventory/items?active=true"),
        api<{ stocks: Record<string, Record<string, number>> }>("/inventory/warehouse-stocks"),
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

  useEffect(() => {
    if (tab !== "history") return;
    const controller = new AbortController();
    setHistoryError("");
    api<{ transfers: Transfer[] }>("/inventory/transfers", { signal: controller.signal })
      .then(({ transfers }) => {
        if (!controller.signal.aborted) setHistory(transfers);
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setHistoryError((err as ApiError)?.error?.message ?? "Historii se nepodařilo načíst.");
      });
    return () => controller.abort();
  }, [tab]);

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

  const totalStock = (itemId: string) => warehouses.reduce((sum, w) => sum + (stocks[itemId]?.[w.id] ?? 0), 0);

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
      ...candidates.map((item) => ({ itemId: item.itemId, name: item.name, qty: 1 })),
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
          qty: mode === "max" ? available : Math.min(parsedBulkQty, available),
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
    if (submittingRef.current) return;
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

    submittingRef.current = true;
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
            quantity: item.qty,
          })),
        }),
      });
      toast.success("Převod byl úspěšně proveden");
      setTransferItems([]);
      setNote("");
      setHistory(null);
      await load();
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Chyba při provádění převodu");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const total = transferItems.reduce((sum, item) => sum + item.qty, 0);
  const from = warehouses.find((warehouse) => warehouse.id === fromWh);
  const to = warehouses.find((warehouse) => warehouse.id === toWh);
  const suggestions = useMemo(() => {
    if (tab !== "suggestions") return [];
    return items.flatMap((item) => {
      const options = warehouses.map((warehouse) => ({
        ...warehouse,
        stock: stockForWarehouse(item.itemId, warehouse.id),
      }));
      const source = options.reduce<(typeof options)[number] | null>(
        (best, option) => (option.stock > (best?.stock ?? 0) ? option : best),
        null
      );
      if (!source) return [];
      return options
        .filter((option) => option.stock < 0)
        .map((destination) => ({
          item,
          source,
          destination,
          qty: Math.min(source.stock, -destination.stock),
        }));
    });
  }, [items, warehouses, stockForWarehouse, tab]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Přesuny</h1>
          <p className="page-description">Převody zásob mezi sklady</p>
        </div>
        <SegmentedControl label="Přesuny mezi sklady" value={tab} onChange={setTab} options={TABS} />
      </div>

      {tab === "new" && (
        <>
          <Card className="grid items-center gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-4 sm:p-4">
            <WarehouseSelect
              label="Z (odkud)"
              value={fromWh}
              onChange={setFromWh}
              warehouses={warehouses}
              disabled={submitting}
            />
            <button
              type="button"
              aria-label="Prohodit sklady"
              title="Prohodit sklady"
              disabled={submitting}
              onClick={() => {
                setFromWh(toWh);
                setToWh(fromWh);
              }}
              className="mx-auto grid size-10 shrink-0 place-items-center rounded-full border border-line bg-canvas hover:bg-indigo-50 disabled:opacity-40"
            >
              <ArrowLeftRight size={17} />
            </button>
            <WarehouseSelect
              label="Do (kam)"
              value={toWh}
              onChange={setToWh}
              warehouses={warehouses}
              disabled={submitting}
            />
          </Card>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(305px,3fr)]">
            <Card className="min-w-0 overflow-hidden">
              <CardHeader className="flex flex-wrap items-center gap-2">
                <label className="relative min-w-40 flex-1">
                  <Search
                    size={16}
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
                  />
                  <Input
                    aria-label="Hledat položky pro převod"
                    className="bg-canvas pl-9"
                    placeholder={
                      from ? `Hledat položku pro převod z: ${from.name}…` : "Hledat položku, SKU, kategorii…"
                    }
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <Select
                  className="w-auto max-w-52"
                  aria-label="Filtrovat podle skladu"
                  value={filterWarehouseId}
                  onChange={(event) => setFilterWarehouseId(event.target.value)}
                >
                  <option value="">Všechny sklady</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={addFilteredItemsToTransfer}
                  disabled={!fromWh || loading || submitting}
                >
                  Přidat vyfiltrované
                </Button>
              </CardHeader>
              {loading || !filteredItems.length ? (
                <p className="p-5 text-sm text-muted">{loading ? "Načítám…" : "Žádné položky neodpovídají filtrům."}</p>
              ) : (
                <div className="max-h-[min(68vh,800px)] overflow-auto">
                  <table className="w-full min-w-[390px] text-sm">
                    <thead className="table-header sticky top-0">
                      <tr>
                        <th scope="col">Položka</th>
                        <th scope="col" className="text-right">
                          {from?.name ?? "Celkem"}
                        </th>
                        {to && (
                          <th scope="col" className="text-right">
                            {to.name}
                          </th>
                        )}
                        <th scope="col" aria-label="Akce" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line border-t border-line">
                      {filteredItems.map((item) => {
                        const selected = transferItems.find((row) => row.itemId === item.itemId);
                        const available = sourceStock(item.itemId);
                        const target = toWh ? stockForWarehouse(item.itemId, toWh) : 0;
                        return (
                          <tr key={item.itemId} className={selected ? "bg-indigo-50/60" : "hover:bg-table"}>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="flex w-full items-center gap-2.5 text-left hover:text-indigo-700"
                                onClick={() => setDetailItem(item)}
                              >
                                <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-[#eceff2] text-slate-400">
                                  {item.imageUrl ? (
                                    <img
                                      className="size-full object-cover"
                                      src={apiUrl(item.imageUrl)}
                                      loading="lazy"
                                      alt=""
                                    />
                                  ) : (
                                    <Icons.Image className="size-4" />
                                  )}
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-[13px] font-medium">{item.name}</span>
                                  <span className="block text-xs text-muted">
                                    {item.sku ||
                                      formatCategoryParentLabel(item.category.parent?.name, item.category.sub?.name)}
                                  </span>
                                </span>
                              </button>
                            </td>
                            <td
                              className={cn(
                                "px-4 py-2 text-right whitespace-nowrap tabular-nums",
                                available < 0 && "text-red-700"
                              )}
                            >
                              {available === 0 ? "–" : `${available} ${item.unit}`}
                            </td>
                            {to && (
                              <td
                                className={cn(
                                  "px-4 py-2 text-right whitespace-nowrap tabular-nums",
                                  target < 0 && "text-red-700"
                                )}
                              >
                                {target === 0 ? "–" : `${target} ${item.unit}`}
                              </td>
                            )}
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              {selected ? (
                                <Badge className="gap-1 bg-indigo-50 text-indigo-700">
                                  <Check size={12} /> {selected.qty} v převodu
                                </Badge>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={submitting || (!!from && available <= 0)}
                                  onClick={() => addItemToTransfer(item)}
                                >
                                  <Icons.Plus className="size-3.5" /> Přidat
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card className="min-w-0 lg:sticky lg:top-20">
              <CardHeader className="p-4">
                <h2 className="text-base font-bold">
                  {from && to ? `Převod ${from.name} → ${to.name}` : "Nový převod"}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {transferItems.length} položek · {total} j.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {invalidTransferItems.length > 0 && (
                  <div className="rounded-lg bg-amber-100 p-2.5 text-xs text-amber-800">
                    Některé položky nemají na zdrojovém skladu dost kusů. Upravte množství nebo změňte sklad.
                  </div>
                )}
                {!transferItems.length ? (
                  <div className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">
                    Vyberte položky v seznamu
                  </div>
                ) : (
                  <ul className="max-h-64 divide-y divide-line overflow-auto">
                    {transferItems.map((item) => (
                      <li key={item.itemId} className="flex items-center gap-2 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium wrap-break-word">{item.name}</div>
                          {from && (
                            <div className="text-xs text-muted">
                              Max. {sourceStock(item.itemId)} {itemById.get(item.itemId)?.unit ?? "ks"}
                            </div>
                          )}
                        </div>
                        <QuantityStepper
                          label={item.name}
                          decreaseDisabled={submitting || item.qty <= 1}
                          increaseDisabled={submitting || (!!from && item.qty >= sourceStock(item.itemId))}
                          onDecrease={() => updateQty(item.itemId, item.qty - 1)}
                          onIncrease={() => updateQty(item.itemId, item.qty + 1)}
                          value={
                            <Input
                              type="number"
                              aria-label={`Množství — ${item.name}`}
                              value={item.qty}
                              min={1}
                              disabled={submitting}
                              onFocus={(event) => event.currentTarget.select()}
                              onChange={(event) => updateQty(item.itemId, Number.parseInt(event.target.value, 10))}
                              className="h-8 w-11 appearance-none rounded-none border-0 px-0 text-center [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          }
                        />
                        <button
                          type="button"
                          aria-label={`Odebrat ${item.name}`}
                          onClick={() => removeTransferItem(item.itemId)}
                          disabled={submitting}
                          className="rounded-md p-1 text-muted hover:bg-red-100 hover:text-red-700"
                        >
                          <X size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {transferItems.length > 0 && (
                  <details className="rounded-lg border border-line bg-table p-2.5 text-sm">
                    <summary className="cursor-pointer font-medium">Hromadné nastavení</summary>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input
                        type="number"
                        min={1}
                        aria-label="Množství pro všechny položky"
                        value={bulkQty}
                        onChange={(event) => setBulkQty(event.target.value)}
                        className="h-9 w-20"
                      />
                      <Button size="sm" variant="secondary" disabled={submitting} onClick={() => applyBulkQty("fixed")}>
                        Nastavit všem
                      </Button>
                      <Button size="sm" variant="ghost" disabled={submitting} onClick={() => applyBulkQty("max")}>
                        Vyplnit maximum
                      </Button>
                      <Button size="sm" variant="ghost" disabled={submitting} onClick={() => setTransferItems([])}>
                        Vyčistit
                      </Button>
                    </div>
                  </details>
                )}
                <Textarea
                  rows={2}
                  aria-label="Důvod převodu"
                  placeholder="Důvod převodu…"
                  value={note}
                  disabled={submitting}
                  onChange={(event) => setNote(event.target.value)}
                />
                <Button
                  full
                  disabled={
                    submitting ||
                    !from ||
                    !to ||
                    fromWh === toWh ||
                    !transferItems.length ||
                    invalidTransferItems.length > 0
                  }
                  onClick={handleTransfer}
                >
                  <Truck size={16} />
                  {submitting ? "Provádím…" : `Potvrdit převod${total ? ` (${total})` : ""}`}
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {tab === "history" && (
        <Card className="overflow-hidden">
          <CardHeader>
            <h2 className="font-bold">Historie převodů</h2>
            <p className="text-xs text-muted">Posledních 100 převedených položek</p>
          </CardHeader>
          {historyError || !history?.length ? (
            <p className="p-4 text-sm text-muted">
              {historyError || (history === null ? "Načítám historii…" : "Zatím neproběhl žádný převod.")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="table-header">
                  <tr>
                    <th scope="col">Termín</th>
                    <th scope="col">Položka</th>
                    <th scope="col">Ze skladu</th>
                    <th scope="col">Do skladu</th>
                    <th scope="col">Množství</th>
                    <th scope="col">Důvod</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line border-t border-line">
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-2 text-muted">{new Date(row.transferredAt).toLocaleString("cs-CZ")}</td>
                      <td className="px-4 py-2 font-medium">{row.item?.name ?? "Položka byla odstraněna"}</td>
                      <td className="px-4 py-2">{row.fromWarehouse.name}</td>
                      <td className="px-4 py-2">{row.toWarehouse.name}</td>
                      <td className="px-4 py-2">
                        {row.quantity} {row.item?.unit}
                      </td>
                      <td className="px-4 py-2 text-muted">{row.note || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === "suggestions" && (
        <Card className="overflow-hidden">
          <CardHeader>
            <h2 className="font-bold">Návrhy k vyrovnání</h2>
            <p className="text-xs text-muted">
              Položky se záporným evidovaným stavem a kladnou zásobou na jiném skladu.
            </p>
          </CardHeader>
          {loading || !suggestions.length ? (
            <p className="p-4 text-sm text-muted">{loading ? "Načítám…" : "Žádné návrhy k vyrovnání."}</p>
          ) : (
            <ul className="divide-y divide-line">
              {suggestions.map(({ item, source, destination, qty }) => (
                <li
                  key={`${item.itemId}/${destination.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <div>
                    <div className="font-semibold">{item.name}</div>
                    <div className="text-xs text-muted">
                      {source.name} → {destination.name} · {qty} {item.unit}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={transferItems.length > 0 || submitting}
                    onClick={() => {
                      setFromWh(source.id);
                      setToWh(destination.id);
                      setTransferItems([{ itemId: item.itemId, name: item.name, qty }]);
                      setTab("new");
                    }}
                  >
                    Připravit převod
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {transferItems.length > 0 && (
            <p className="border-t border-line p-4 text-xs text-muted">
              Nejdřív dokončete nebo vyčistěte rozpracovaný převod.
            </p>
          )}
        </Card>
      )}
      <ItemDetailModal
        item={detailItem}
        warehouses={warehouses}
        warehouseStocks={stocks}
        onClose={() => setDetailItem(null)}
        primaryText="Přidat do převodu"
        onPrimary={() => {
          if (detailItem && !submitting) {
            addItemToTransfer(detailItem);
            setDetailItem(null);
          }
        }}
      />
    </div>
  );
}

function WarehouseSelect({
  label,
  value,
  onChange,
  warehouses,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  warehouses: Warehouse[];
  disabled?: boolean;
}) {
  return (
    <label className="flex min-w-0 items-center gap-3 rounded-xl border border-line p-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700">
        <Warehouse size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold tracking-wide text-muted uppercase">{label}</span>
        <Select
          className="h-7 border-0 px-0 font-semibold"
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Vyberte sklad</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </Select>
      </span>
    </label>
  );
}

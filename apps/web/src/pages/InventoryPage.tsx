import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Barcode, CalendarDays, ImageOff, LayoutGrid, List, Search, TriangleAlert } from "lucide-react";
import CategorySidebar, { type CatalogCategory } from "../components/CategorySidebar";
import SegmentedControl from "../components/ui/SegmentedControl";
import { api, apiUrl, getCurrentUser, hasStockAccess } from "../lib/api";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "../lib/datetime";
import { Card, CardContent } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Skeleton from "../components/ui/Skeleton";
import Modal from "../components/ui/Modal";
import ItemDetailModal from "../components/ItemDetailModal";
import EditItemModal from "../components/EditItemModal";
import { cn } from "../lib/ui";
import { formatCategoryParentLabel, statusBadgeClass, statusLabel, stockTone } from "../lib/viewModel";
import { Icons } from "../lib/icons";
import toast from "react-hot-toast";

type EventRow = {
  id: string;
  name: string;
  location: string;
  deliveryDatetime: string;
  pickupDatetime: string;
  status: string;
  exportNeedsRevision: boolean;
};

export default function InventoryPage() {
  const nav = useNavigate();
  const user = getCurrentUser();
  const role = user?.role ?? "";
  const canEdit = role === "admin" || role === "warehouse";
  const canPrint = role === "admin" || role === "warehouse";
  const [items, setItems] = useState<any[]>([]);
  const [parents, setParents] = useState<CatalogCategory[]>([]);
  const [search, setSearch] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [view, setView] = useState<"tile" | "list">(() => localStorage.getItem("inv_view") === "tile" ? "tile" : "list");
  const [stockFilter, setStockFilter] = useState<"none" | "negative" | "noImage" | "noSku">("none");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [warehouseStocks, setWarehouseStocks] = useState<Record<string, Record<string, number>>>({});

  const [pickOpen, setPickOpen] = useState(false);
  const [pickItem, setPickItem] = useState<any | null>(null);
  const [detailItem, setDetailItem] = useState<any | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [editAllItems, setEditAllItems] = useState<any[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventSearch, setEventSearch] = useState("");

  const [startAt, setStartAt] = useState(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return toDatetimeLocalValue(start);
  });
  const [endAt, setEndAt] = useState(() => toDatetimeLocalValue(new Date(Date.now() + 7 * 24 * 3600 * 1000)));

  const loadVersion = useRef(0);
  const startAtRef = useRef(startAt);
  const endAtRef = useRef(endAt);

  // Aktualizovat refy při změně
  useEffect(() => {
    startAtRef.current = startAt;
  }, [startAt]);

  useEffect(() => {
    endAtRef.current = endAt;
  }, [endAt]);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const cats = await api<{ parents: CatalogCategory[] }>("/categories/tree");
      if (version !== loadVersion.current) return;
      setParents(cats.parents);
      const q = new URLSearchParams();
      q.set("active", "true");
      q.set("with_stock", "true");
      const startIso = fromDatetimeLocalValue(startAtRef.current);
      const endIso = fromDatetimeLocalValue(endAtRef.current);
      if (!startIso || !endIso) {
        setError("Neplatné období dostupnosti.");
        return;
      }
      q.set("start_at", startIso);
      q.set("end_at", endIso);
      if (search.trim()) q.set("search", search.trim());
      if (parentId) q.set("parent_category_id", parentId);
      if (categoryId) q.set("category_id", categoryId);
      const [res, whRes, stockRes] = await Promise.all([
        api<{ items: any[] }>(`/inventory/items?${q.toString()}`),
        api<{ warehouses: any[] }>("/warehouses"),
        api<{ stocks: Record<string, Record<string, number>> }>("/inventory/warehouse-stocks")
      ]);
      if (version !== loadVersion.current) return;
      setItems(res.items);
      setWarehouses(whRes.warehouses);
      setWarehouseStocks(stockRes.stocks);
    } catch (e: any) {
      if (version === loadVersion.current) setError(e?.error?.message ?? "Nepodařilo se načíst sklad.");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [search, parentId, categoryId]);

  useEffect(() => {
    const timer = setTimeout(load, search.trim() ? 300 : 0);
    return () => {
      clearTimeout(timer);
      loadVersion.current++;
    };
  }, [load, search]);

  useEffect(() => {
    localStorage.setItem("inv_view", view);
  }, [view]);

  const loadEvents = async () => {
    setEventsLoading(true);
    try {
      const res = await api<{ events: EventRow[] }>("/events");
      const filtered = res.events
        .filter((e) => !["ISSUED", "CLOSED", "CANCELLED"].includes(e.status))
        .sort((a, b) => new Date(a.deliveryDatetime).getTime() - new Date(b.deliveryDatetime).getTime());
      setEvents(filtered);
    } catch (e: any) {
      toast.error(e?.error?.message ?? "Nepodařilo se načíst akce.");
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    if (!pickOpen) return;
    if (events.length > 0) return;
    loadEvents();
  }, [pickOpen]);

  const subcats = useMemo(() => {
    if (parentId) {
      const p = parents.find((x) => x.id === parentId);
      return (p?.children ?? []).map((c) => ({ ...c, parentName: p?.name ?? "" }));
    }
    return parents.flatMap((p) =>
      (p.children ?? []).map((c) => ({ ...c, parentName: p.name }))
    );
  }, [parents, parentId]);

  const warehouseItems = useMemo(() => (
    warehouseId ? items.filter((item) => (warehouseStocks[item.itemId]?.[warehouseId] ?? 0) !== 0) : items
  ), [items, warehouseId, warehouseStocks]);

  const stockFilters = [
    { id: "negative", label: "v záporném stavu", icon: TriangleAlert, match: (item: { itemId: string; stock?: { total: number } }) => {
      const stock = warehouseStocks[item.itemId] ?? {};
      return warehouseId
        ? (stock[warehouseId] ?? 0) < 0
        : (item.stock?.total ?? 0) < 0 || Object.values(stock).some((quantity) => quantity < 0);
    } },
    { id: "noImage", label: "bez fotky", icon: ImageOff, match: (item: { imageUrl?: string | null }) => !item.imageUrl },
    { id: "noSku", label: "bez kódu SKU", icon: Barcode, match: (item: { sku?: string | null }) => !item.sku },
  ] as const;
  const selectedFilter = stockFilters.find((filter) => filter.id === stockFilter);
  const visibleItems = selectedFilter ? warehouseItems.filter(selectedFilter.match) : warehouseItems;

  const filteredEvents = useMemo(() => {
    const s = eventSearch.trim().toLowerCase();
    if (!s) return events;
    return events.filter((e) => e.name.toLowerCase().includes(s) || e.location.toLowerCase().includes(s));
  }, [events, eventSearch]);

  const onPrimaryAction = async (item: any) => {
    if (canEdit) {
      try {
        const res = await api<{ items: any[] }>("/admin/items");
        const full = res.items.find((x: any) => x.id === item.itemId);
        if (!full) {
          toast.error("Položku se nepodařilo najít.");
          return;
        }
        setEditAllItems(res.items);
        setEditItem(full);
        setEditOpen(true);
      } catch (e: any) {
        toast.error(e?.error?.message ?? "Nepodařilo se načíst položku.");
      }
      return;
    }
    setPickItem(item);
    setPickOpen(true);
  };

  const onPrintLabel = (item: any) => {
    const url = `${apiUrl(`/inventory/items/${item.itemId}/label-pdf`)}?token=${localStorage.getItem("token")}`;
    window.open(url, "_blank");
  };

  const selectedParent = parents.find((category) => category.id === parentId);
  const selectedCategory = subcats.find((category) => category.id === categoryId);
  const chooseParent = (value: string) => {
    setParentId(value);
    setCategoryId("");
  };

  return (
    <div className={cn("-mx-4 -mt-6 grid flex-1 items-start sm:-mx-6 lg:-mx-8 lg:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]", detailItem && "xl:grid-cols-[240px_minmax(0,1fr)_minmax(305px,28%)]")}>
      <aside className="hidden min-h-full border-r border-line bg-white p-4 lg:block">
        <CategorySidebar categories={parents} parentId={parentId} categoryId={categoryId} onParent={chooseParent} onCategory={setCategoryId} />
      </aside>
      <section className="min-w-0 space-y-4 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="page-title">Sklad</h1>
            <p className="page-description">{[selectedParent?.name, selectedCategory?.name].filter(Boolean).join(" › ") || "Přehled dostupnosti a zásob"} · {visibleItems.length} položek</p>
          </div>
          {canEdit && <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => nav("/settings/items?import=true")}><Icons.Upload /> Import</Button>
            <Button onClick={() => nav("/settings/items#new-item")}><Icons.Plus className="size-4" /> Nová položka</Button>
          </div>}
        </div>

        <div className="flex flex-wrap gap-2">
          {stockFilters.map(({ id, label, match, icon: Icon }) => <button key={id} type="button" aria-pressed={stockFilter === id} onClick={() => setStockFilter(stockFilter === id ? "none" : id)}
            className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-semibold text-muted", id === "negative" && "border-transparent bg-red-100 text-red-700", stockFilter === id && "border-indigo-600 ring-1 ring-indigo-600")}>
            <Icon size={14} /> {warehouseItems.filter(match).length} {label}
          </button>)}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block min-w-44 flex-1">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <Input aria-label="Hledat ve skladu" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Hledat název, SKU…" />
          </label>
          <Select className="w-auto max-w-48" aria-label="Sklad" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            <option value="">Všechny sklady</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </Select>
          <details className="relative">
            <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-[9px] border border-line bg-white px-3 text-sm font-medium">
              <CalendarDays size={16} /> Dostupnost
            </summary>
            <div className="absolute left-0 z-10 mt-2 grid w-64 gap-2 rounded-xl border border-line bg-white p-3 shadow-lg sm:right-0 sm:left-auto">
              <label className="text-sm">Od<Input className="mt-1" type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
              <label className="text-sm">Do<Input className="mt-1" type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} /></label>
              <Button type="button" variant="secondary" onClick={load}>Obnovit dostupnost</Button>
            </div>
          </details>
          <SegmentedControl label="Zobrazení skladu" value={view} onChange={setView} options={[
            { value: "tile", label: <><LayoutGrid size={16} /><span className="sr-only">Dlaždice</span></> },
            { value: "list", label: <><List size={16} /><span className="sr-only">Seznam</span></> },
          ]} />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:hidden">
          <Select aria-label="Hlavní kategorie" value={parentId} onChange={(event) => chooseParent(event.target.value)}>
            <option value="">Všechny kategorie</option>
            {parents.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
          <Select aria-label="Podkategorie" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Všechny podkategorie</option>
            {subcats.map((category) => <option key={category.id} value={category.id}>{parentId ? category.name : `${category.parentName} / ${category.name}`}</option>)}
          </Select>
        </div>

      {error ? (
        <Card className="bg-red-50 border-red-100">
          <CardContent className="text-red-700 p-4">{error}</CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className={cn(view === "tile" ? "grid grid-cols-2 gap-4 md:grid-cols-4" : "space-y-2")}>
          {Array.from({ length: 8 }).map((_, idx) =>
            view === "tile" ? (
              <Card key={idx} className="h-64">
                <CardContent className="p-4">
                  <Skeleton className="aspect-video w-full rounded-lg" />
                  <Skeleton className="mt-4 h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                </CardContent>
              </Card>
            ) : (
              <Card key={idx}>
                <CardContent className="p-4 flex gap-4">
                  <Skeleton className="h-12 w-12 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </CardContent>
              </Card>
            )
          )}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300 text-gray-500">
          Žádné položky neodpovídají filtrům.
        </div>
      ) : view === "tile" ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
          {visibleItems.map((i) => {
            const tone = stockTone(i.stock.available);
            return (
              <Card key={i.itemId} className="overflow-hidden group hover:shadow-md transition-shadow border-gray-200 hover:border-indigo-300">
                <button
                  onClick={() => setDetailItem(i)}
                  className="block w-full aspect-[4/3] overflow-hidden bg-white relative border-b border-gray-100 text-left"
                  title="Zobrazit detail"
                >
                  {i.imageUrl ? (
                    <img className="h-full w-full object-contain transition-transform group-hover:scale-105 p-1" src={apiUrl(i.imageUrl)} alt={i.name} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-gray-400">
                      <Icons.Image />
                    </div>
                  )}
                  <div className="absolute top-2 right-2">
                    <Badge tone={tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'danger'}>
                      {i.stock.available} ks
                    </Badge>
                  </div>
                </button>
                <CardContent className="p-3">
                  <button
                    onClick={() => setDetailItem(i)}
                    className="line-clamp-1 text-sm font-semibold text-gray-900 text-left hover:text-indigo-700"
                    title={i.name}
                  >
                    {i.name}
                  </button>
                  <div className="text-xs text-gray-500 mb-1">
                    {formatCategoryParentLabel(i.category.parent?.name, i.category.sub?.name)}
                  </div>
                  {i.warehouse?.name && (
                    <div className="text-[10px] text-indigo-500 font-medium mb-2">📦 {i.warehouse.name}</div>
                  )}

                  <div className="flex flex-col gap-1 text-[11px] text-gray-500 mb-3">
                    <div className="flex justify-between">
                      <span>Celkem:</span>
                      <span className="font-medium text-gray-900">{i.stock.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Rezervováno:</span>
                      <span className="font-medium text-blue-600">{i.stock.reserved}</span>
                    </div>
                  </div>

                  {/* Warehouse breakdown */}
                  {warehouses.length > 1 && (
                    <div className="mb-4 space-y-1 border-t border-gray-100 pt-3">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">Po skladech</div>
                      <div className="grid grid-cols-2 gap-1">
                        {warehouses.map(w => {
                          const stock = warehouseStocks[i.itemId]?.[w.id] ?? 0;
                          if (stock === 0) return null;
                          return (
                            <div key={w.id} className="flex justify-between items-center text-[11px] px-2 py-1 bg-gray-50 rounded">
                              <span className="truncate text-gray-600 mr-2">{w.name}</span>
                              <span className="font-semibold text-gray-900">{stock}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button variant={canEdit ? "secondary" : "primary"} size="sm" className="flex-1" onClick={() => onPrimaryAction(i)}>
                      {canEdit ? "Upravit" : "Přidat"}
                    </Button>
                    {canPrint && (
                      <Button variant="secondary" size="sm" title="Tisk štítku" onClick={() => onPrintLabel(i)}>
                        <Icons.QrCode className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[490px] text-sm">
            <thead className="table-header">
              <tr>
                <th scope="col">Položka</th>
                {warehouses.map((warehouse) => <th key={warehouse.id} scope="col" className="text-right">{warehouse.name}</th>)}
                <th scope="col" className="text-right">Celkem</th>
                <th scope="col" className="text-right whitespace-nowrap">V termínu volné</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-t border-line">
              {visibleItems.map((item) => (
                <tr key={item.itemId} className={cn("hover:bg-table", detailItem?.itemId === item.itemId && "bg-indigo-50 hover:bg-indigo-50")}>
                  <td className="min-w-36 px-3 py-2">
                    <button type="button" onClick={() => setDetailItem(item)} className="flex w-full items-center gap-2.5 text-left hover:text-indigo-700">
                      <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-[#eceff2] text-slate-400">
                        {item.imageUrl ? <img loading="lazy" className="size-full object-cover" src={apiUrl(item.imageUrl)} alt="" /> : <Icons.Image className="size-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium">{item.name}</span>
                        <span className="block font-mono text-xs text-muted">{item.sku || item.unit}</span>
                      </span>
                    </button>
                  </td>
                  {warehouses.map((warehouse) => {
                    const quantity = warehouseStocks[item.itemId]?.[warehouse.id] ?? 0;
                    return <td key={warehouse.id} className={cn("px-4 py-2.5 text-right tabular-nums", quantity < 0 ? "text-red-700" : !quantity && "text-muted")}>{quantity || "–"}</td>;
                  })}
                  <td className={cn("px-4 py-2.5 text-right font-semibold tabular-nums", item.stock.total < 0 && "text-red-700")}>{item.stock.total}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right"><Badge tone={stockTone(item.stock.available)}>{item.stock.available} {item.unit} volné</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      </section>

      <ItemDetailModal
        item={detailItem ? visibleItems.find((item) => item.itemId === detailItem.itemId) ?? detailItem : null}
        warehouses={warehouses}
        warehouseStocks={warehouseStocks}
        inline
        onClose={() => setDetailItem(null)}
        primaryText="Přidat do akce"
        onPrimary={() => {
          if (!detailItem) return;
          setPickItem(detailItem);
          setDetailItem(null);
          setPickOpen(true);
        }}
        onEdit={canEdit && detailItem ? () => void onPrimaryAction(detailItem) : undefined}
        onPrint={canPrint && detailItem ? () => onPrintLabel(detailItem) : undefined}
        onTransfer={hasStockAccess(user) && detailItem ? () => nav("/inventory/transfers?search=" + encodeURIComponent(detailItem.sku || detailItem.name)) : undefined}
      />

      <Modal
        open={pickOpen}
        onOpenChange={setPickOpen}
        title="Vybrat akci"
        description={pickItem ? `Přidáváš: ${pickItem.name}` : "Vyber akci pro přidání položky."}
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <Icons.Search />
              </div>
              <Input
                className="pl-10"
                value={eventSearch}
                onChange={(e) => setEventSearch(e.target.value)}
                placeholder="Hledat akci..."
              />
            </div>
            <Button variant="secondary" onClick={loadEvents} disabled={eventsLoading}>
              <Icons.History />
            </Button>
          </div>

          {eventsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, idx) => (
                <Skeleton key={idx} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-500 border border-dashed rounded-xl">
              Žádné akce k dispozici.
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {filteredEvents.map((e) => (
                <button
                  key={e.id}
                  className="block w-full text-left"
                  onClick={() => {
                    if (!pickItem) return;
                    setPickOpen(false);
                    const q = new URLSearchParams();
                    q.set("addItems", "1");
                    q.set("focusItemId", pickItem.itemId);
                    q.set("q", pickItem.name);
                    nav(`/events/${e.id}?${q.toString()}`);
                    toast.success("Vyber množství a ulož výběr.");
                  }}
                >
                  <div className="p-3 rounded-xl border border-gray-200 hover:border-indigo-500 hover:bg-indigo-50 transition-all group">
                    <div className="flex justify-between items-start mb-1">
                      <div className="font-semibold text-gray-900 group-hover:text-indigo-700">{e.name}</div>
                      <Badge className={statusBadgeClass(e.status)}>{statusLabel(e.status)}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <Icons.MapPin /> {e.location}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                      <Icons.Calendar /> {new Date(e.deliveryDatetime).toLocaleDateString()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {editItem && (
        <EditItemModal
          open={editOpen}
          onOpenChange={setEditOpen}
          item={editItem}
          allItems={editAllItems}
          parents={parents}
          warehouses={warehouses}
          onSaved={() => load()}
        />
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiUrl, getCurrentUser } from "../lib/api";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Skeleton from "../components/ui/Skeleton";
import Modal from "../components/ui/Modal";
import { cn } from "../lib/ui";
import { statusLabel, stockTone } from "../lib/viewModel";
import { Grid2X2, List, Search, SlidersHorizontal } from "lucide-react";
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
  const role = getCurrentUser()?.role ?? "";
  const canEdit = role === "admin";
  const [items, setItems] = useState<any[]>([]);
  const [parents, setParents] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [view, setView] = useState<string>(() => localStorage.getItem("inv_view") ?? "tile");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pickOpen, setPickOpen] = useState(false);
  const [pickItem, setPickItem] = useState<any | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventSearch, setEventSearch] = useState("");

  const [startAt, setStartAt] = useState(() => {
    const d = new Date();
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
    return start.toISOString().slice(0, 16);
  });
  const [endAt, setEndAt] = useState(() => {
    const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    return d.toISOString().slice(0, 16);
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const cats = await api<{ parents: any[] }>("/categories/tree");
      setParents(cats.parents);
      const q = new URLSearchParams();
      q.set("active", "true");
      q.set("with_stock", "true");
      q.set("start_at", new Date(startAt).toISOString());
      q.set("end_at", new Date(endAt).toISOString());
      if (search) q.set("search", search);
      if (parentId) q.set("parent_category_id", parentId);
      if (categoryId) q.set("category_id", categoryId);
      const res = await api<{ items: any[] }>(`/inventory/items?${q.toString()}`);
      setItems(res.items);
    } catch (e: any) {
      setError(e?.error?.message ?? "Nepodařilo se načíst sklad.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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
    const p = parents.find((x) => x.id === parentId);
    return p?.children ?? [];
  }, [parents, parentId]);

  const filteredEvents = useMemo(() => {
    const s = eventSearch.trim().toLowerCase();
    if (!s) return events;
    return events.filter((e) => e.name.toLowerCase().includes(s) || e.location.toLowerCase().includes(s));
  }, [events, eventSearch]);

  const onPrimaryAction = (item: any) => {
    if (canEdit) {
      nav(`/settings/items?search=${encodeURIComponent(item.name)}`);
      return;
    }
    setPickItem(item);
    setPickOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Sklad</h1>
          <div className="text-sm text-slate-600">Přehled dostupnosti pro vybrané období.</div>
        </div>
        {canEdit ? (
          <div className="hidden gap-2 md:flex">
            <Button variant="secondary" size="sm" onClick={() => nav("/settings/items")}>
              Přidat položku
            </Button>
            <Button variant="secondary" size="sm" onClick={() => nav("/settings/categories")}>
              Kategorie
            </Button>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button
            variant={view === "tile" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setView("tile")}
          >
            <Grid2X2 className="h-4 w-4" /> Dlaždice
          </Button>
          <Button
            variant={view === "list" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setView("list")}
          >
            <List className="h-4 w-4" /> Seznam
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-medium">
            <SlidersHorizontal className="h-4 w-4" />
            Filtry
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-6">
            <label className="md:col-span-2 text-sm">
              Hledat
              <div className="mt-1 flex items-center gap-2">
                <Search className="h-4 w-4 text-slate-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Název položky..." />
              </div>
            </label>
            <label className="md:col-span-2 text-sm">
              Typ
              <Select
                className="mt-1"
                value={parentId}
                onChange={(e) => {
                  setParentId(e.target.value);
                  setCategoryId("");
                }}
              >
                <option value="">Vše</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="md:col-span-2 text-sm">
              Kategorie
              <Select className="mt-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!parentId}>
                <option value="">Vše</option>
                {subcats.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </label>

            <label className="md:col-span-3 text-sm">
              Od
              <Input className="mt-1" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </label>
            <label className="md:col-span-3 text-sm">
              Do
              <Input className="mt-1" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </label>

            <div className="md:col-span-6 flex justify-end">
              <Button onClick={load}>Použít</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent>
            <div className="text-sm text-red-700">{error}</div>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className={cn(view === "tile" ? "grid grid-cols-2 gap-3 md:grid-cols-4" : "space-y-2")}>
          {Array.from({ length: 8 }).map((_, idx) =>
            view === "tile" ? (
              <Card key={idx}>
                <CardContent>
                  <Skeleton className="aspect-video w-full" />
                  <Skeleton className="mt-3 h-4 w-3/4" />
                  <Skeleton className="mt-2 h-3 w-1/2" />
                  <Skeleton className="mt-4 h-8 w-full" />
                </CardContent>
              </Card>
            ) : (
              <Card key={idx}>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10" />
                    <div className="flex-1">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="mt-2 h-3 w-1/3" />
                    </div>
                    <Skeleton className="h-8 w-20" />
                  </div>
                </CardContent>
              </Card>
            )
          )}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent>
            <div className="text-sm text-slate-600">Žádné položky pro zvolené filtry.</div>
          </CardContent>
        </Card>
      ) : view === "tile" ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
	          {items.map((i) => {
	            const tone = stockTone(i.stock.available);
	            return (
	              <Card key={i.itemId} className="overflow-hidden">
	                <div className="aspect-video w-full overflow-hidden bg-slate-100">
	                  {i.imageUrl ? (
	                    <img className="h-full w-full object-cover" src={apiUrl(i.imageUrl)} alt={i.name} />
	                  ) : (
	                    <div className="flex h-full items-center justify-center text-xs text-slate-500">Bez obrázku</div>
	                  )}
	                </div>
                <CardContent>
                  <div className="line-clamp-2 text-sm font-semibold">{i.name}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge>{i.category.parent?.name ?? "Kategorie"}</Badge>
                    <Badge tone="neutral">{i.category.sub.name}</Badge>
                  </div>

                  <div className="mt-3">
                    <div className={cn("text-sm font-semibold", tone === "ok" && "text-emerald-700", tone === "danger" && "text-red-700", tone === "warn" && "text-amber-800")}>
                      Volné: {i.stock.available} {i.unit}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      Celkem: {i.stock.total} · Rezervováno: {i.stock.reserved}
                    </div>
	                  </div>

	                  <div className="mt-4">
	                    <Button variant={canEdit ? "secondary" : "primary"} size="sm" full onClick={() => onPrimaryAction(i)}>
	                      {canEdit ? "Upravit" : "Přidat k akci"}
	                    </Button>
	                    {!canEdit ? (
	                      <div className="mt-2 text-[11px] text-slate-500">Vyber akci a nastav množství podle dostupnosti.</div>
	                    ) : null}
	                  </div>
	                </CardContent>
	              </Card>
	            );
	          })}
        </div>
      ) : (
        <Card>
          <div className="hidden grid-cols-12 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-700 md:grid">
            <div className="col-span-5">Položka</div>
            <div className="col-span-3">Kategorie</div>
            <div className="col-span-1 text-right">Celkem</div>
            <div className="col-span-1 text-right">Rezerv.</div>
            <div className="col-span-1 text-right">Volné</div>
            <div className="col-span-1 text-right">Akce</div>
          </div>
          <div className="divide-y divide-slate-100">
            {items.map((i) => {
              const tone = stockTone(i.stock.available);
	              return (
	                <div key={i.itemId} className="px-4 py-3">
	                  <div className="md:hidden">
	                    <div className="flex items-center gap-3">
	                      <div className="h-10 w-10 overflow-hidden rounded-xl bg-slate-100">
	                        {i.imageUrl ? <img className="h-full w-full object-cover" src={apiUrl(i.imageUrl)} alt={i.name} /> : null}
	                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{i.name}</div>
                        <div className="mt-0.5 text-xs text-slate-600">
                          {i.category.parent?.name ?? ""} / {i.category.sub.name}
                        </div>
                      </div>
                      <Badge tone={tone === "ok" ? "ok" : tone === "warn" ? "warn" : "danger"}>
                        Volné: {i.stock.available}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-slate-600">
                      Celkem: {i.stock.total} · Rezervováno: {i.stock.reserved}
                    </div>
                  </div>

	                  <div className="hidden grid-cols-12 items-center gap-2 md:grid">
	                    <div className="col-span-5 flex items-center gap-3">
	                      <div className="h-10 w-10 overflow-hidden rounded-xl bg-slate-100">
	                        {i.imageUrl ? <img className="h-full w-full object-cover" src={apiUrl(i.imageUrl)} alt={i.name} /> : null}
	                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{i.name}</div>
                        <div className="mt-0.5 text-xs text-slate-600">{i.unit}</div>
                      </div>
                    </div>
                    <div className="col-span-3 text-sm text-slate-700">
                      {i.category.parent?.name ?? ""} / {i.category.sub.name}
                    </div>
                    <div className="col-span-1 text-right text-sm">{i.stock.total}</div>
                    <div className="col-span-1 text-right text-sm">{i.stock.reserved}</div>
                    <div className="col-span-1 text-right">
                      <Badge tone={tone === "ok" ? "ok" : tone === "warn" ? "warn" : "danger"}>
                        {i.stock.available}
                      </Badge>
	                    </div>
	                    <div className="col-span-1 text-right">
	                      <Button size="sm" variant={canEdit ? "secondary" : "primary"} onClick={() => onPrimaryAction(i)}>
	                        {canEdit ? "Upravit" : "Přidat"}
	                      </Button>
	                    </div>
	                  </div>
	                </div>
	              );
	            })}
	          </div>
	        </Card>
	      )}

        <Modal
          open={pickOpen}
          onOpenChange={setPickOpen}
          title="Vybrat akci"
          description={pickItem ? `Přidáváš: ${pickItem.name}` : "Vyber akci pro přidání položky."}
        >
	        <div className="space-y-3">
	          <div className="grid gap-2 md:grid-cols-2">
	            <label className="text-sm">
	              Hledat akci
	              <Input className="mt-1" value={eventSearch} onChange={(e) => setEventSearch(e.target.value)} placeholder="Název nebo místo…" />
	            </label>
	            <div className="flex items-end">
	              <Button variant="secondary" full onClick={loadEvents} disabled={eventsLoading}>
	                Obnovit
	              </Button>
	            </div>
	          </div>

	          {eventsLoading ? (
	            <div className="space-y-2">
	              {Array.from({ length: 4 }).map((_, idx) => (
	                <Card key={idx}>
	                  <CardContent>
	                    <Skeleton className="h-4 w-2/3" />
	                    <Skeleton className="mt-2 h-3 w-1/3" />
	                  </CardContent>
	                </Card>
	              ))}
	            </div>
          ) : filteredEvents.length === 0 ? (
            <Card>
              <CardContent>
                <div className="text-sm text-slate-600">Žádné rozpracované akce.</div>
              </CardContent>
            </Card>
          ) : (
	            <div className="space-y-2">
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
	                  <Card className="hover:border-slate-300">
	                    <CardContent>
	                      <div className="flex items-start justify-between gap-3">
	                        <div className="min-w-0">
	                          <div className="truncate text-sm font-semibold">{e.name}</div>
	                          <div className="mt-1 text-sm text-slate-600">{e.location}</div>
	                          <div className="mt-2 text-xs text-slate-500">
	                            {new Date(e.deliveryDatetime).toLocaleString()} → {new Date(e.pickupDatetime).toLocaleString()}
	                          </div>
	                        </div>
	                        <div className="shrink-0 text-right">
	                          <Badge>{statusLabel(e.status)}</Badge>
	                          {e.exportNeedsRevision ? <div className="mt-1 text-[11px] text-amber-700">nutná revize</div> : null}
	                        </div>
	                      </div>
	                    </CardContent>
	                  </Card>
	                </button>
	              ))}
	            </div>
	          )}
	        </div>
	      </Modal>
	    </div>
	  );
	}

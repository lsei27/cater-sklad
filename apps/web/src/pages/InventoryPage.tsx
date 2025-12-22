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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sklad</h1>
          <p className="text-gray-500 mt-1">Přehled dostupnosti a zásob.</p>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {canEdit && (
            <>
              <Button variant="secondary" size="sm" onClick={() => nav("/settings/items")}>
                <Icons.Plus /> Položka
              </Button>
              <Button variant="secondary" size="sm" onClick={() => nav("/settings/categories")}>
                Kategorie
              </Button>
            </>
          )}
          <div className="flex bg-gray-100 rounded-lg p-1 border border-gray-200">
            <button
              onClick={() => setView("tile")}
              className={cn(
                "p-1.5 rounded transition-all",
                view === "tile" ? "bg-white shadow-sm text-indigo-600" : "text-gray-500 hover:text-gray-700"
              )}
              title="Dlaždice"
            >
              <Icons.Grid />
            </button>
            <button
              onClick={() => setView("list")}
              className={cn(
                "p-1.5 rounded transition-all",
                view === "list" ? "bg-white shadow-sm text-indigo-600" : "text-gray-500 hover:text-gray-700"
              )}
              title="Seznam"
            >
              <Icons.List />
            </button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <div className="text-gray-400"><Icons.Sliders /></div>
            Filtry
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-6 lg:grid-cols-12">
            <div className="md:col-span-3 lg:col-span-4">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Hledat</label>
              <div className="relative mt-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <Icons.Search />
                </div>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Název položky..."
                  className="pl-10"
                />
              </div>
            </div>

            <div className="md:col-span-3 lg:col-span-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Typ</label>
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
            </div>

            <div className="md:col-span-3 lg:col-span-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Kategorie</label>
              <Select className="mt-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!parentId}>
                <option value="">Vše</option>
                {subcats.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="md:col-span-3 lg:col-span-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Od</label>
              <Input className="mt-1" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div className="md:col-span-3 lg:col-span-2">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Do</label>
              <Input className="mt-1" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>

            <div className="md:col-span-6 lg:col-span-12 flex justify-end">
              <Button onClick={load}>Použít filtry</Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
      ) : items.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300 text-gray-500">
          Žádné položky neodpovídají filtrům.
        </div>
      ) : view === "tile" ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
          {items.map((i) => {
            const tone = stockTone(i.stock.available);
            return (
              <Card key={i.itemId} className="overflow-hidden group hover:shadow-md transition-shadow border-gray-200 hover:border-indigo-300">
                <div className="aspect-[4/3] w-full overflow-hidden bg-gray-50 relative">
                  {i.imageUrl ? (
                    <img className="h-full w-full object-cover transition-transform group-hover:scale-105" src={apiUrl(i.imageUrl)} alt={i.name} />
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
                </div>
                <CardContent className="p-3">
                  <div className="line-clamp-1 text-sm font-semibold text-gray-900" title={i.name}>{i.name}</div>
                  <div className="text-xs text-gray-500 mb-3">{i.category.sub.name}</div>

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

                  <Button variant={canEdit ? "secondary" : "primary"} size="sm" full onClick={() => onPrimaryAction(i)}>
                    {canEdit ? "Upravit" : "Přidat"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Položka</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Kategorie</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Celkem</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider text-blue-700 bg-blue-50/50">Rezervováno</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider text-green-700 bg-green-50/50">Volné</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Akce</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {items.map((i) => {
                const tone = stockTone(i.stock.available);
                return (
                  <tr key={i.itemId} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 overflow-hidden rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                          {i.imageUrl ? (
                            <img className="h-full w-full object-cover" src={apiUrl(i.imageUrl)} alt={i.name} />
                          ) : (
                            <div className="text-gray-400"><Icons.Image /></div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-gray-900">{i.name}</div>
                          <div className="text-xs text-gray-500">{i.unit}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-500">
                      {i.category.parent?.name ?? ""} / {i.category.sub.name}
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-sm text-gray-900 text-right font-medium bg-gray-50/50">
                      {i.stock.total}
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-sm text-blue-600 text-right font-medium bg-blue-50/30">
                      {i.stock.reserved}
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-sm text-right font-bold">
                      <span className={cn(
                        tone === 'ok' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-red-600'
                      )}>
                        {i.stock.available}
                      </span>
                    </td>
                    <td className="px-6 py-3 whitespace-nowrap text-right text-sm">
                      <Button size="sm" variant={canEdit ? "secondary" : "primary"} onClick={() => onPrimaryAction(i)}>
                        {canEdit ? "Upravit" : "Přidat"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
                      <Badge>{statusLabel(e.status)}</Badge>
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
    </div>
  );
}

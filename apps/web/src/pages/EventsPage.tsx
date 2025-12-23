import { useEffect, useState } from "react";
import { api, getCurrentUser } from "../lib/api";
import { Link, Navigate } from "react-router-dom";
import { startSSE } from "../lib/sse";
import { Card, CardContent, CardHeader } from "../components/ui/Card";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Badge from "../components/ui/Badge";
import Skeleton from "../components/ui/Skeleton";
import toast from "react-hot-toast";
import { statusLabel } from "../lib/viewModel";
import { Icons } from "../lib/icons";
import EventFilters, { EventFiltersData } from "../components/EventFilters";

type EventRow = {
  id: string;
  name: string;
  location: string;
  deliveryDatetime: string;
  pickupDatetime: string;
  status: string;
  exportNeedsRevision: boolean;
  chefConfirmedAt: string | null;
};

export default function EventsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<EventFiltersData>({
    year: new Date().getFullYear(),
  });
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const role = getCurrentUser()?.role ?? "";

  if (role === "warehouse") return <Navigate to="/warehouse" replace />;

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.append("status", filters.status);
      if (filters.month) params.append("month", String(filters.month));
      if (filters.year) params.append("year", String(filters.year));

      const res = await api<{ events: EventRow[] }>(`/events?${params.toString()}`);
      setEvents(res.events);
    } catch (e: any) {
      setError(e?.error?.message ?? "Failed");
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const off = startSSE((ev: any) => {
      if (["event_status_changed", "export_created", "reservation_changed"].includes(ev?.type)) load();
    });
    const interval = setInterval(load, 15000);
    return () => {
      off();
      clearInterval(interval);
    };
  }, [filters]);

  const filtered = events.filter((e) => {
    if (!search.trim()) return true;
    const s = search.trim().toLowerCase();
    return e.name.toLowerCase().includes(s) || e.location.toLowerCase().includes(s);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Akce</h1>
          <p className="text-gray-500 mt-1">Plánování a předání do skladu.</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <div className="relative flex-1 sm:flex-initial">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <Icons.Search />
              </div>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Hledat..."
                className="pl-10 h-10"
              />
            </div>
            {["admin", "event_manager"].includes(role) ? <CreateEventButton onCreated={load} /> : null}
          </div>
          <EventFilters activeRole={role} filters={filters} onChange={setFilters} />
        </div>
      </div>

      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={viewMode === "grid" ? "primary" : "secondary"}
            onClick={() => setViewMode("grid")}
            className="flex items-center gap-1"
          >
            <Icons.Grid className="h-4 w-4" /> Dlaždice
          </Button>
          <Button
            size="sm"
            variant={viewMode === "list" ? "primary" : "secondary"}
            onClick={() => setViewMode("list")}
            className="flex items-center gap-1"
          >
            <Icons.List className="h-4 w-4" /> Seznam
          </Button>
        </div>
        <div className="text-xs text-gray-500 font-medium">
          {filtered.length} {filtered.length === 1 ? 'akce' : filtered.length < 5 && filtered.length > 0 ? 'akce' : 'akcí'}
        </div>
      </div>

      {error ? (
        <Card className="bg-red-50 border-red-100">
          <CardContent className="text-red-700 p-4">
            <div className="flex gap-2">
              <Icons.Alert />
              {error}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Card key={idx} className="h-40">
              <CardContent className="p-5">
                <Skeleton className="h-6 w-2/3 mb-4" />
                <Skeleton className="h-4 w-1/2 mb-2" />
                <Skeleton className="h-4 w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300 text-gray-500">
          {search ? 'Žádná akce neodpovídá vyhledávání.' : 'Zatím žádné naplánované akce.'}
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => (
            <Link key={e.id} to={`/events/${e.id}`} className="block group">
              <Card className="h-full hover:shadow-md transition-shadow border-gray-200 group-hover:border-indigo-300">
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex flex-col gap-1">
                      <Badge
                        tone={
                          e.status === "SENT_TO_WAREHOUSE"
                            ? "ok"
                            : e.status === "ISSUED"
                              ? "warn"
                              : e.status === "CANCELLED" || e.status === "CLOSED"
                                ? "neutral"
                                : "neutral"
                        }
                      >
                        {statusLabel(e.status)}
                      </Badge>
                      {e.status === "SENT_TO_WAREHOUSE" && !e.chefConfirmedAt ? (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 flex items-center gap-1">
                          <Icons.Clock className="h-3 w-3" /> Čeká na kuchyň
                        </span>
                      ) : null}
                    </div>
                    {e.exportNeedsRevision ? (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 flex items-center gap-1">
                        <Icons.Alert /> Revize
                      </span>
                    ) : null}
                  </div>

                  <h3 className="font-bold text-gray-900 text-lg mb-1 group-hover:text-indigo-700 transition-colors">{e.name}</h3>

                  <div className="text-sm text-gray-500 space-y-2 mt-2">
                    <div className="flex items-center gap-2">
                      <div className="text-gray-400"><Icons.MapPin /></div>
                      <span className="truncate text-gray-700">{e.location}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-gray-400"><Icons.Calendar /></div>
                      <span className="text-xs">
                        {new Date(e.deliveryDatetime).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => (
            <Link key={e.id} to={`/events/${e.id}`} className="block group">
              <Card className="hover:shadow-sm transition-shadow border-gray-200 group-hover:border-indigo-300">
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-bold text-gray-900 truncate group-hover:text-indigo-700 transition-colors">
                        {e.name}
                      </h3>
                      <Badge
                        tone={
                          e.status === "SENT_TO_WAREHOUSE"
                            ? "ok"
                            : e.status === "ISSUED"
                              ? "warn"
                              : e.status === "CANCELLED" || e.status === "CLOSED"
                                ? "neutral"
                                : "neutral"
                        }
                        className="scale-90"
                      >
                        {statusLabel(e.status)}
                      </Badge>
                      {e.status === "SENT_TO_WAREHOUSE" && !e.chefConfirmedAt ? (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 flex items-center gap-1">
                          <Icons.Clock className="h-3 w-3" /> Čeká na kuchyň
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <div className="flex items-center gap-1">
                        <Icons.MapPin className="h-3 w-3" /> {e.location}
                      </div>
                      <div className="flex items-center gap-1 font-medium">
                        <Icons.Calendar className="h-3 w-3" /> {new Date(e.deliveryDatetime).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  {e.exportNeedsRevision ? (
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 flex items-center gap-1">
                      <Icons.Alert /> Revize
                    </span>
                  ) : null}
                  <Icons.ChevronRight className="h-5 w-5 text-gray-300 group-hover:text-indigo-500" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateEventButton(props: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Icons.Plus /> Nová akce
      </Button>
    );
  }

  return <CreateEventForm onClose={() => setOpen(false)} onCreated={props.onCreated} />;
}

function CreateEventForm(props: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("Akce");
  const [location, setLocation] = useState("Praha");
  const [address, setAddress] = useState("");
  const [eventDate, setEventDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [delivery, setDelivery] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  const [pickup, setPickup] = useState(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16));
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <div className="text-sm font-semibold">Nová akce</div>
        <div className="mt-1 text-sm text-slate-600">Založ základní informace a poté doplň položky.</div>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await api("/events", {
                method: "POST",
                body: JSON.stringify({
                  name,
                  location,
                  address: address || null,
                  event_date: eventDate ? new Date(eventDate).toISOString() : null,
                  delivery_datetime: new Date(delivery).toISOString(),
                  pickup_datetime: new Date(pickup).toISOString()
                })
              });
              toast.success("Akce vytvořena");
              props.onClose();
              props.onCreated();
            } catch (e: any) {
              const msg = e?.error?.message ?? "Nepodařilo se vytvořit akci.";
              setError(msg);
              toast.error(msg);
            }
          }}
        >
          <label className="text-sm">
            Název
            <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-sm">
            Místo konání
            <Input className="mt-1" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label className="text-sm">
            Adresa
            <Input className="mt-1" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ulice, město" />
          </label>
          <label className="text-sm">
            Datum akce
            <Input className="mt-1" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </label>
          <label className="text-sm">
            Začátek (doručení)
            <Input className="mt-1" type="datetime-local" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
          </label>
          <label className="text-sm">
            Svoz
            <Input className="mt-1" type="datetime-local" value={pickup} onChange={(e) => setPickup(e.target.value)} />
          </label>
          {error ? <div className="md:col-span-2 text-sm text-red-600">{error}</div> : null}
          <div className="md:col-span-2 flex gap-2">
            <Button>Vytvořit</Button>
            <Button type="button" variant="secondary" onClick={props.onClose}>
              Zrušit
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

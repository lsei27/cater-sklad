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
import { CalendarPlus, MapPin } from "lucide-react";

type EventRow = {
  id: string;
  name: string;
  location: string;
  deliveryDatetime: string;
  pickupDatetime: string;
  status: string;
  exportNeedsRevision: boolean;
};

export default function EventsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const role = getCurrentUser()?.role ?? "";

  if (role === "warehouse") return <Navigate to="/warehouse" replace />;

  const load = async () => {
    setLoading(true);
    try {
      const res = await api<{ events: EventRow[] }>("/events");
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
  }, []);

  const filtered = events.filter((e) => {
    if (!search.trim()) return true;
    const s = search.trim().toLowerCase();
    return e.name.toLowerCase().includes(s) || e.location.toLowerCase().includes(s);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Akce</h1>
          <div className="text-sm text-slate-600">Plánování a předání do skladu.</div>
        </div>
        {["admin", "event_manager"].includes(role) ? <CreateEventButton onCreated={load} /> : null}
      </div>

      <Card>
        <CardHeader>
          <div className="text-sm font-semibold">Vyhledávání</div>
        </CardHeader>
        <CardContent>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Název nebo místo…" />
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
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Card key={idx}>
              <CardContent>
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-2 h-3 w-1/3" />
                <Skeleton className="mt-4 h-3 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent>
            <div className="text-sm text-slate-600">Žádné akce.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => (
            <Link key={e.id} to={`/events/${e.id}`} className="block">
              <Card className="hover:border-slate-300">
                <CardContent>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{e.name}</div>
                      <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
                        <MapPin className="h-4 w-4" />
                        <span className="truncate">{e.location}</span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {new Date(e.deliveryDatetime).toLocaleString()} → {new Date(e.pickupDatetime).toLocaleString()}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
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
                      {e.exportNeedsRevision ? <div className="mt-1 text-[11px] text-amber-700">nutná revize exportu</div> : null}
                    </div>
                  </div>
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
        <CalendarPlus className="h-4 w-4" /> Nová akce
      </Button>
    );
  }

  return <CreateEventForm onClose={() => setOpen(false)} onCreated={props.onCreated} />;
}

function CreateEventForm(props: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("Akce");
  const [location, setLocation] = useState("Praha");
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
            Místo
            <Input className="mt-1" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label className="text-sm">
            Doručení
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

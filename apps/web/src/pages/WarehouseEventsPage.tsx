import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getCurrentUser } from "../lib/api";
import { Card, CardContent } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Skeleton from "../components/ui/Skeleton";
import { statusLabel } from "../lib/viewModel";
import EventFilters, { EventFiltersData } from "../components/EventFilters";
import { Icons } from "../lib/icons";

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

export default function WarehouseEventsPage() {
  const role = getCurrentUser()?.role ?? "";
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<EventFiltersData>({
    year: new Date().getFullYear(),
  });
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.append("status", filters.status);
      if (filters.month) params.append("month", String(filters.month));
      if (filters.year) params.append("year", String(filters.year));

      const res = await api<{ events: EventRow[] }>(`/events?${params.toString()}`);
      setEvents(res.events);
    } catch (e: any) {
      setError(e?.error?.message ?? "Nepodařilo se načíst akce.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [filters]);

  if (!["warehouse", "admin"].includes(role)) {
    return (
      <Card>
        <CardContent>
          <div className="text-sm text-slate-700">Sekce Sklad je dostupná pouze pro sklad a administrátora.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Sklad</h1>
          <div className="text-sm text-slate-600">Akce připravené k výdeji nebo uzavření.</div>
        </div>
        <EventFilters activeRole={role} filters={filters} onChange={setFilters} />
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
          {events.length} {events.length === 1 ? 'akce' : events.length < 5 && events.length > 0 ? 'akce' : 'akcí'}
        </div>
      </div>

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
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="mt-2 h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-7 w-24" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <Link key={e.id} to={`/warehouse/${e.id}`} className="block group">
              <Card className="h-full hover:shadow-md transition-shadow border-slate-200 group-hover:border-indigo-300">
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex flex-col gap-1">
                      <Badge tone={e.status === "ISSUED" ? "warn" : e.status === "CLOSED" ? "neutral" : "ok"}>
                        {statusLabel(e.status)}
                      </Badge>
                      {e.status === "SENT_TO_WAREHOUSE" && !e.chefConfirmedAt ? (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 flex items-center gap-1">
                          <Icons.Clock className="h-3 w-3" /> Čeká na kuchyň
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <h3 className="font-bold text-slate-900 text-lg mb-1 group-hover:text-indigo-700 transition-colors">{e.name}</h3>

                  <div className="text-sm text-slate-500 space-y-2 mt-2">
                    <div className="flex items-center gap-2">
                      <div className="text-slate-400"><Icons.MapPin /></div>
                      <span className="truncate text-slate-700">{e.location}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-slate-400"><Icons.Calendar /></div>
                      <span className="text-xs">
                        {new Date(e.deliveryDatetime).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : events.length === 0 ? (
        <Card>
          <CardContent>
            <div className="text-sm text-slate-600">Žádné akce k vyřízení.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <Link key={e.id} to={`/warehouse/${e.id}`} className="block group">
              <Card className="hover:shadow-sm transition-shadow border-slate-200 group-hover:border-indigo-300">
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-bold text-slate-900 truncate group-hover:text-indigo-700 transition-colors">
                        {e.name}
                      </h3>
                      <Badge tone={e.status === "ISSUED" ? "warn" : e.status === "CLOSED" ? "neutral" : "ok"} className="scale-90">
                        {statusLabel(e.status)}
                      </Badge>
                      {e.status === "SENT_TO_WAREHOUSE" && !e.chefConfirmedAt ? (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 flex items-center gap-1">
                          <Icons.Clock className="h-3 w-3" /> Čeká na kuchyň
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <div className="flex items-center gap-1">
                        <Icons.MapPin className="h-3 w-3" /> {e.location}
                      </div>
                      <div className="flex items-center gap-1 font-medium">
                        <Icons.Calendar className="h-3 w-3" /> {new Date(e.deliveryDatetime).toLocaleString()}
                      </div>
                    </div>
                  </div>
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


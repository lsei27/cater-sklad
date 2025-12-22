import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getCurrentUser } from "../lib/api";
import { Card, CardContent } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Skeleton from "../components/ui/Skeleton";
import { statusLabel } from "../lib/viewModel";

type EventRow = {
  id: string;
  name: string;
  location: string;
  deliveryDatetime: string;
  pickupDatetime: string;
  status: string;
  exportNeedsRevision: boolean;
};

export default function WarehouseEventsPage() {
  const role = getCurrentUser()?.role ?? "";
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ events: EventRow[] }>("/events");
      const filtered = res.events.filter((e) => ["SENT_TO_WAREHOUSE", "ISSUED"].includes(e.status));
      setEvents(filtered);
    } catch (e: any) {
      setError(e?.error?.message ?? "Nepodařilo se načíst akce.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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
      <div>
        <h1 className="text-xl font-semibold">Sklad</h1>
        <div className="text-sm text-slate-600">Akce připravené k výdeji nebo uzavření.</div>
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
      ) : events.length === 0 ? (
        <Card>
          <CardContent>
            <div className="text-sm text-slate-600">Žádné akce k vyřízení.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <Link key={e.id} to={`/warehouse/${e.id}`} className="block">
              <Card className="hover:border-slate-300">
                <CardContent>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{e.name}</div>
                      <div className="mt-0.5 text-sm text-slate-600">{e.location}</div>
                      <div className="mt-2 text-xs text-slate-500">
                        {new Date(e.deliveryDatetime).toLocaleString()} → {new Date(e.pickupDatetime).toLocaleString()}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge tone={e.status === "ISSUED" ? "warn" : "ok"}>{statusLabel(e.status)}</Badge>
                      {e.exportNeedsRevision ? <div className="mt-1 text-[11px] text-amber-700">nutná revize</div> : null}
                      <div className="mt-2 text-sm font-medium text-slate-900">Otevřít</div>
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


import { useEffect, useMemo, useState } from "react";
import { api, getCurrentUser } from "../lib/api";
import { Link } from "react-router-dom";
import { startSSE } from "../lib/sse";

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
  const [error, setError] = useState<string | null>(null);
  const role = getCurrentUser()?.role ?? "";

  const load = async () => {
    try {
      const res = await api<{ events: EventRow[] }>("/events");
      setEvents(res.events);
    } catch (e: any) {
      setError(e?.error?.message ?? "Failed");
    }
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Akce</h1>
        {["admin", "event_manager"].includes(role) ? <CreateEventButton onCreated={load} /> : null}
      </div>
      {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <div className="grid gap-3">
        {events.map((e) => (
          <Link key={e.id} to={`/events/${e.id}`} className="rounded border bg-white p-4 hover:border-slate-400">
            <div className="flex items-center justify-between">
              <div className="font-medium">{e.name}</div>
              <div className="text-xs text-slate-600">{e.status}{e.exportNeedsRevision ? " • needs revision" : ""}</div>
            </div>
            <div className="mt-1 text-sm text-slate-600">{e.location}</div>
            <div className="mt-1 text-xs text-slate-500">
              {new Date(e.deliveryDatetime).toLocaleString()} → {new Date(e.pickupDatetime).toLocaleString()}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CreateEventButton(props: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => setOpen(true)}>
        + Nová akce
      </button>
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
    <div className="rounded border bg-white p-4">
      <div className="mb-2 font-medium">Nová akce</div>
      <form
        className="grid gap-2 md:grid-cols-2"
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
            props.onClose();
            props.onCreated();
          } catch (e: any) {
            setError(e?.error?.message ?? "Create failed");
          }
        }}
      >
        <label className="text-sm">
          Název
          <input className="mt-1 w-full rounded border px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="text-sm">
          Místo
          <input className="mt-1 w-full rounded border px-3 py-2" value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="text-sm">
          Delivery
          <input className="mt-1 w-full rounded border px-3 py-2" type="datetime-local" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
        </label>
        <label className="text-sm">
          Pickup
          <input className="mt-1 w-full rounded border px-3 py-2" type="datetime-local" value={pickup} onChange={(e) => setPickup(e.target.value)} />
        </label>
        {error ? <div className="col-span-2 text-sm text-red-600">{error}</div> : null}
        <div className="col-span-2 flex gap-2">
          <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white">Vytvořit</button>
          <button type="button" className="rounded border px-3 py-2 text-sm" onClick={props.onClose}>
            Zrušit
          </button>
        </div>
      </form>
    </div>
  );
}

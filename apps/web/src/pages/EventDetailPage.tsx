import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, getCurrentUser } from "../lib/api";
import { startSSE } from "../lib/sse";

type EventDetail = any;

export default function EventDetailPage() {
  const { id } = useParams();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    try {
      const res = await api<{ event: EventDetail }>(`/events/${id}`);
      setEvent(res.event);
    } catch (e: any) {
      setError(e?.error?.message ?? "Failed");
    }
  };

  useEffect(() => {
    load();
    const off = startSSE((ev: any) => {
      if (ev?.eventId === id) load();
    });
    const interval = setInterval(load, 15000);
    return () => {
      off();
      clearInterval(interval);
    };
  }, [id]);

  if (!event) return <div className="text-sm text-slate-600">{error ?? "Načítám..."}</div>;
  const user = getCurrentUser();
  const role = user?.role ?? "";

  return (
    <div className="space-y-4">
      <div className="rounded border bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xl font-semibold">{event.name}</div>
            <div className="text-sm text-slate-600">{event.location}</div>
          </div>
          <div className="text-right text-sm">
            <div className="font-medium">{event.status}</div>
            {event.exportNeedsRevision ? <div className="text-xs text-amber-700">export needs revision</div> : null}
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-600">
          {new Date(event.deliveryDatetime).toLocaleString()} → {new Date(event.pickupDatetime).toLocaleString()}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {["chef", "admin"].includes(role) ? (
            <button
              className="rounded bg-slate-900 px-3 py-2 text-sm text-white"
              onClick={async () => {
                await api(`/events/${event.id}/confirm-chef`, { method: "POST", body: "{}" });
                load();
              }}
            >
              Potvrdit (Chef)
            </button>
          ) : null}
          {["event_manager", "admin"].includes(role) ? (
            <button
              className="rounded bg-indigo-600 px-3 py-2 text-sm text-white"
              onClick={async () => {
                const res = await api<{ pdfUrl: string }>(`/events/${event.id}/export`, { method: "POST", body: "{}" });
                window.open(res.pdfUrl, "_blank");
                load();
              }}
            >
              Export PDF
            </button>
          ) : null}
          {["warehouse", "admin"].includes(role) ? (
            <button
              className="rounded bg-emerald-600 px-3 py-2 text-sm text-white"
              onClick={async () => {
                await api(`/events/${event.id}/issue`, {
                  method: "POST",
                  body: JSON.stringify({ idempotency_key: `issue:${Date.now()}` })
                });
                load();
              }}
            >
              Vydáno
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-medium">Rezervace</div>
          <ReserveInline eventId={event.id} onSaved={load} />
        </div>
        <div className="grid gap-2">
          {(event.reservations ?? []).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between rounded border px-3 py-2">
              <div>
                <div className="text-sm font-medium">{r.item?.name}</div>
                <div className="text-xs text-slate-600">
                  {r.item?.category?.parent?.name} / {r.item?.category?.name}
                </div>
              </div>
              <div className="text-sm">
                {r.reservedQuantity} {r.item?.unit}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded border bg-white p-4">
        <div className="mb-2 font-medium">Vráceno / Uzavřít</div>
        {["warehouse", "admin"].includes(role) ? <ReturnCloseInline eventId={event.id} onSaved={load} /> : <div className="text-sm text-slate-600">Pouze sklad / admin</div>}
      </div>
    </div>
  );
}

function ReserveInline(props: { eventId: string; onSaved: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: any[] }>("/inventory/items?active=true")
      .then((r: any) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api(`/events/${props.eventId}/reserve`, {
            method: "POST",
            body: JSON.stringify({ items: [{ inventory_item_id: itemId, qty }] })
          });
          setItemId("");
          setQty(1);
          props.onSaved();
        } catch (e: any) {
          setError(e?.error?.message ?? "Reserve failed");
        }
      }}
    >
      <label className="text-xs">
        Položka
        <select className="mt-1 w-72 rounded border px-2 py-2 text-sm" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">— vyber —</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.category?.parent?.name}/{i.category?.name})
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        Qty
        <input className="mt-1 w-20 rounded border px-2 py-2 text-sm" type="number" min={0} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
      </label>
      <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white" disabled={!itemId}>
        Uložit
      </button>
      {error ? <div className="w-full text-xs text-red-600">{error}</div> : null}
    </form>
  );
}

function ReturnCloseInline(props: { eventId: string; onSaved: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [returnedById, setReturnedById] = useState<any[]>([]);
  const [rows, setRows] = useState<Array<{ inventory_item_id: string; returned_quantity: number; broken_quantity: number }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ event: any }>(`/events/${props.eventId}`)
      .then((r: any) => {
        const res = r.event?.reservations ?? [];
        setRows(res.map((x: any) => ({ inventory_item_id: x.inventoryItemId, returned_quantity: 0, broken_quantity: 0 })));
      })
      .catch(() => {});
    api<{ items: any[] }>("/inventory/items?active=true")
      .then((r: any) => setItems(r.items))
      .catch(() => setItems([]));
  }, [props.eventId]);

  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await api(`/events/${props.eventId}/return-close`, {
            method: "POST",
            body: JSON.stringify({ idempotency_key: `close:${Date.now()}`, items: rows })
          });
          props.onSaved();
        } catch (e: any) {
          setError(e?.error?.message ?? "Close failed");
        }
      }}
    >
      {rows.map((r, idx) => (
        <div key={r.inventory_item_id} className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="text-sm">
            {items.find((i: any) => i.id === r.inventory_item_id)?.name ?? r.inventory_item_id}
          </div>
          <label className="text-xs">
            Returned
            <input
              className="mt-1 w-full rounded border px-2 py-2 text-sm"
              type="number"
              min={0}
              value={r.returned_quantity}
              onChange={(e) => {
                const v = Number(e.target.value);
                setRows((prev) => prev.map((x, j) => (j === idx ? { ...x, returned_quantity: v } : x)));
              }}
            />
          </label>
          <label className="text-xs">
            Broken
            <input
              className="mt-1 w-full rounded border px-2 py-2 text-sm"
              type="number"
              min={0}
              value={r.broken_quantity}
              onChange={(e) => {
                const v = Number(e.target.value);
                setRows((prev) => prev.map((x, j) => (j === idx ? { ...x, broken_quantity: v } : x)));
              }}
            />
          </label>
        </div>
      ))}
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      <button className="rounded bg-emerald-700 px-3 py-2 text-sm text-white">Vrátit + Uzavřít</button>
    </form>
  );
}

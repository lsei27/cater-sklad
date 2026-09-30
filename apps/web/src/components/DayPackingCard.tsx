import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api, apiBaseUrl } from "../lib/api";
import { cn } from "../lib/ui";
import { dayRangeLabel, eventDayDateLabel, reservationRowKey } from "../lib/eventDays";
import { Card, CardContent, CardHeader } from "./ui/Card";
import Button from "./ui/Button";
import ConfirmDialog from "./ui/ConfirmDialog";

export type DayPackingItem = {
  inventoryItemId: string;
  name: string;
  unit: string;
  qty: number;
  dayFrom?: number;
  dayTo?: number | null;
};

type PackingState = "idle" | "armed" | "confirmed";
type PackingRow = { inventoryItemId: string; dayFrom: number; dayTo: number | null; state: PackingState };

function errorMessage(e: unknown, fallback: string): string {
  const message = (e as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" ? message : fallback;
}

/**
 * Balení a výdej vícedenní akce po dnech. Den N obsahuje řádky, které ten den
 * odjíždějí ze skladu. Jednodenní akce tuhle kartu nepoužívá.
 */
export default function DayPackingCard(props: {
  eventId: string;
  dayCount: number;
  deliveryDatetime: string;
  exportVersion: number | null;
  items: DayPackingItem[];
  issuedDays: number[];
  warehouses: Array<{ id: string; name: string }>;
  onIssued: () => Promise<void> | void;
}) {
  const daysWithItems = useMemo(
    () => Array.from(new Set(props.items.map((i) => i.dayFrom ?? 1))).sort((a, b) => a - b),
    [props.items]
  );
  const firstPendingDay = daysWithItems.find((d) => !props.issuedDays.includes(d)) ?? daysWithItems[0] ?? 1;
  const [day, setDay] = useState(firstPendingDay);
  const [states, setStates] = useState<Record<string, PackingState>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");

  useEffect(() => {
    setDay(firstPendingDay);
  }, [firstPendingDay]);

  useEffect(() => {
    api<{ packing: PackingRow[] }>(`/events/${props.eventId}/packing`)
      .then((res) => setStates(Object.fromEntries(res.packing.map((p) => [reservationRowKey(p), p.state]))))
      .catch(() => {});
  }, [props.eventId, props.issuedDays.length]);

  const dayItems = useMemo(
    () => props.items.filter((i) => (i.dayFrom ?? 1) === day).sort((a, b) => a.name.localeCompare(b.name, "cs")),
    [props.items, day]
  );
  const dayIssued = props.issuedDays.includes(day);
  const confirmedCount = dayItems.filter((i) => states[reservationRowKey(i)] === "confirmed").length;

  const toggle = async (item: DayPackingItem) => {
    const key = reservationRowKey(item);
    const previous = states[key] ?? "idle";
    const next: PackingState = previous === "confirmed" ? "idle" : "confirmed";
    setStates((s) => ({ ...s, [key]: next }));
    try {
      await api(`/events/${props.eventId}/packing`, {
        method: "PUT",
        body: JSON.stringify({
          inventory_item_id: item.inventoryItemId,
          day_from: item.dayFrom ?? 1,
          day_to: item.dayTo ?? null,
          state: next
        })
      });
    } catch (e: unknown) {
      setStates((s) => ({ ...s, [key]: previous }));
      toast.error(errorMessage(e, "Nepodařilo se uložit stav balení."));
    }
  };

  const issueDay = async () => {
    try {
      const res = await api<{ skippedItems?: Array<{ name: string }> }>(`/events/${props.eventId}/issue`, {
        method: "POST",
        body: JSON.stringify({
          day,
          idempotency_key: `day${day}:${Date.now()}`,
          warehouse_id: warehouseId || undefined
        })
      });
      toast.success(`Den ${day} vydán`);
      if (res?.skippedItems?.length) {
        toast.error(`Nevydáno (položka už není v inventáři): ${res.skippedItems.map((i) => i.name).join(", ")}`, {
          duration: 12000
        });
      }
      await props.onIssued();
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Nepodařilo se vydat den."));
    }
  };

  const openDayPdf = () => {
    const token = localStorage.getItem("token");
    window.open(
      `${apiBaseUrl()}/events/${props.eventId}/exports/${props.exportVersion}/pdf?day=${day}&token=${encodeURIComponent(token ?? "")}`,
      "_blank"
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="text-sm font-semibold">Balení po dnech</div>
        <div className="mt-1 text-sm text-slate-600">
          Vícedenní akce se balí a vydává po dnech. Každý den obsahuje položky, které ten den odjíždějí ze skladu.
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {daysWithItems.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                d === day ? "border-indigo-300 bg-indigo-50 text-indigo-900" : "border-slate-200 text-slate-700 hover:bg-slate-50"
              )}
            >
              Den {d} ({eventDayDateLabel(props.deliveryDatetime, d)}){props.issuedDays.includes(d) ? " · vydáno" : ""}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {dayItems.length === 0 ? (
          <div className="text-sm text-slate-600">Na tento den nic neodjíždí.</div>
        ) : (
          <div className="space-y-2">
            {dayItems.map((item) => {
              const confirmed = states[reservationRowKey(item)] === "confirmed";
              return (
                <div
                  key={reservationRowKey(item)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-2xl border p-3",
                    confirmed ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200"
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{item.name}</div>
                    <div className="mt-0.5 text-xs text-slate-600">
                      {item.qty} {item.unit} · {dayRangeLabel({ dayFrom: item.dayFrom ?? 1, dayTo: item.dayTo ?? null }, props.dayCount)}
                    </div>
                  </div>
                  {!dayIssued ? (
                    <Button size="sm" variant={confirmed ? "secondary" : undefined} onClick={() => toggle(item)}>
                      {confirmed ? "Vrátit" : "Zabaleno"}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {dayIssued ? (
          <div className="mt-3 text-sm font-medium text-emerald-700">Den {day} je vydaný.</div>
        ) : dayItems.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {props.exportVersion ? (
              <Button variant="secondary" onClick={openDayPdf}>
                PDF na den {day}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
              Vydat podle PDF
            </Button>
            <Button disabled={confirmedCount < dayItems.length} onClick={() => setConfirmOpen(true)}>
              Vydat den {day} ({confirmedCount}/{dayItems.length})
            </Button>
          </div>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Vydat den ${day}?`}
        description="Položky tohoto dne se odečtou ze skladu. Ostatní dny zůstanou k vydání."
        confirmText={`Vydat den ${day}`}
        onConfirm={issueDay}
      >
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-gray-500">Vydáváno ze skladu</span>
          <select
            className="block w-full rounded-md border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">(Výchozí sklad položky)</option>
            {props.warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>
      </ConfirmDialog>
    </Card>
  );
}

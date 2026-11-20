import { useEffect, useState } from "react";
import { ArrowLeftRight, Pencil, Plus, QrCode, X } from "lucide-react";
import Button from "./ui/Button";
import { cn } from "../lib/ui";
import Modal from "./ui/Modal";
import { Icons } from "../lib/icons";
import { api, apiUrl } from "../lib/api";
import { formatCategoryParentLabel } from "../lib/viewModel";

export type ItemDetail = {
  itemId: string;
  name: string;
  sku?: string | null;
  unit: string;
  imageUrl?: string | null;
  masterPackageQty?: number | null;
  masterPackageWeight?: string | null;
  volume?: string | null;
  plateDiameter?: string | null;
  warehouse?: { id: string; name: string } | null;
  category: {
    parent?: { name: string } | null;
    sub?: { name: string } | null;
  };
  stock?: {
    total: number;
    reserved: number;
    available: number;
  };
};

type ItemEvent = {
  eventId: string;
  name: string;
  location: string;
  status: string;
  deliveryDatetime: string;
  pickupDatetime: string;
  quantity: number;
};

type Props = {
  item: ItemDetail | null;
  warehouses: Array<{ id: string; name: string }>;
  warehouseStocks: Record<string, Record<string, number>>;
  onClose: () => void;
  primaryText?: string;
  onPrimary?: () => void;
  inline?: boolean;
  onEdit?: () => void;
  onPrint?: () => void;
  onTransfer?: () => void;
};

export default function ItemDetailModal({
  item,
  warehouses,
  warehouseStocks,
  onClose,
  primaryText,
  onPrimary,
  inline = false,
  onEdit,
  onPrint,
  onTransfer,
}: Props) {
  const itemId = item?.itemId ?? null;
  const [events, setEvents] = useState<ItemEvent[] | null>(null);
  const [eventsError, setEventsError] = useState(false);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1280px)").matches);

  useEffect(() => {
    if (!inline) return;
    const query = window.matchMedia("(min-width: 1280px)");
    const onChange = () => setWide(query.matches);
    query.addEventListener("change", onChange);
    onChange();
    return () => query.removeEventListener("change", onChange);
  }, [inline]);

  useEffect(() => {
    setEvents(null);
    setEventsError(false);
    if (!itemId) return;
    let cancelled = false;
    api<{ events: ItemEvent[] }>(`/inventory/items/${itemId}/events`)
      .then((res) => {
        if (!cancelled) setEvents(res.events);
      })
      .catch(() => {
        if (!cancelled) setEventsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (!item) return null;

  const category = formatCategoryParentLabel(item.category.parent?.name, item.category.sub?.name);
  const metadata = [item.sku, category, item.masterPackageQty ? `balení ${item.masterPackageQty} ${item.unit}` : null]
    .filter(Boolean)
    .join(" · ");
  const photo = (
    <div className="relative grid h-48 place-items-center overflow-hidden bg-[#eceff2] text-slate-400">
      {item.imageUrl ? (
        <img className="size-full object-contain" src={apiUrl(item.imageUrl)} alt={item.name} />
      ) : (
        <Icons.Image className="size-8" />
      )}
    </div>
  );
  const content = (
    <div className="space-y-4">
      {item.stock && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Celkem", quantity: item.stock.total, color: "text-ink" },
            { label: "Rezervováno", quantity: item.stock.reserved, color: "text-amber-800" },
            {
              label: "Volné",
              quantity: item.stock.available,
              color: item.stock.available > 0 ? "text-emerald-700" : "text-red-700",
            },
          ].map(({ label, quantity, color }) => (
            <div key={label} className="rounded-lg bg-canvas p-2.5">
              <div className="text-[11px] text-muted sm:text-xs">{label}</div>
              <div className={cn("text-xl font-bold tabular-nums", color)}>{quantity}</div>
            </div>
          ))}
        </div>
      )}

      <section aria-label="Nadcházející rezervace">
        <h3 className="mb-1.5 text-sm font-bold">Nadcházející rezervace</h3>
        {eventsError ? (
          <p className="text-xs text-red-700">Nepodařilo se načíst akce.</p>
        ) : events === null ? (
          <p className="text-xs text-muted">Načítám…</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-muted">Položka nemá nadcházející rezervace.</p>
        ) : (
          <ul className="max-h-52 divide-y divide-line overflow-y-auto">
            {events.map((event, index) => (
              <li key={`${event.eventId}/${index}`} className="flex items-center gap-2 py-2 text-sm">
                <time
                  className="shrink-0 rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700"
                  dateTime={event.deliveryDatetime}
                >
                  {new Date(event.deliveryDatetime).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" })}
                </time>
                <span className="min-w-0 flex-1 wrap-break-word">{event.name}</span>
                <strong className="shrink-0">
                  {event.quantity} {item.unit}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {onPrimary && (
          <Button size="sm" onClick={onPrimary}>
            <Plus size={15} /> {primaryText ?? "Uložit"}
          </Button>
        )}
        {onTransfer && (
          <Button size="sm" variant="secondary" onClick={onTransfer}>
            <ArrowLeftRight size={15} /> Přesunout
          </Button>
        )}
        {onEdit && (
          <Button size="sm" variant="secondary" onClick={onEdit}>
            <Pencil size={14} /> Upravit
          </Button>
        )}
        {onPrint && (
          <Button size="sm" variant="secondary" onClick={onPrint}>
            <QrCode size={14} /> Štítek
          </Button>
        )}
      </div>

      <details className="rounded-lg border border-line bg-table p-3 text-sm">
        <summary className="cursor-pointer font-medium">Parametry a rozmístění po skladech</summary>
        <dl className="mt-2 space-y-1 text-xs">
          <DetailRow label="SKU" value={item.sku || "—"} />
          <DetailRow label="Jednotka" value={item.unit} />
          <DetailRow label="Kategorie" value={category || "—"} />
          <DetailRow label="Výchozí sklad" value={item.warehouse?.name ?? "—"} />
          <DetailRow
            label="Master balení"
            value={item.masterPackageQty ? `${item.masterPackageQty} ${item.unit}` : "—"}
          />
          {item.masterPackageWeight && <DetailRow label="Hmotnost balení" value={`${item.masterPackageWeight} kg`} />}
          {item.volume && <DetailRow label="Objem" value={`${item.volume} l`} />}
          {item.plateDiameter && <DetailRow label="Průměr" value={`${item.plateDiameter} cm`} />}
          {warehouses.map((warehouse) => (
            <DetailRow
              key={warehouse.id}
              label={warehouse.name}
              value={`${warehouseStocks[item.itemId]?.[warehouse.id] ?? 0} ${item.unit}`}
            />
          ))}
        </dl>
      </details>
    </div>
  );

  if (inline && wide)
    return (
      <aside
        aria-label={`Detail položky ${item.name}`}
        className="sticky top-[60px] flex max-h-[calc(100dvh-60px-2rem)] min-w-0 self-start flex-col border-l border-line bg-white"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Zavřít detail položky"
          className="absolute top-3 right-3 z-10 grid size-8 place-items-center rounded-full border border-line bg-white hover:bg-canvas"
        >
          <X size={17} />
        </button>
        <div key={itemId} className="min-h-0 overflow-y-auto overscroll-y-contain">
          {photo}
          <div className="space-y-4 p-5">
            <div>
              <h2 className="text-lg font-bold wrap-break-word">{item.name}</h2>
              <p className="mt-1 text-xs text-muted">{metadata}</p>
            </div>
            {content}
          </div>
        </div>
      </aside>
    );

  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={item.name} description={metadata}>
      <div className="space-y-4">
        <div className="overflow-hidden rounded-lg">{photo}</div>
        {content}
      </div>
    </Modal>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

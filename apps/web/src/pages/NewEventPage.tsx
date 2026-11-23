import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Copy, FilePlus, MapPin, Truck, User } from "lucide-react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { api, getCurrentUser, type ApiError } from "../lib/api";
import { fromDateInputValue, fromDatetimeLocalValue, toDatetimeLocalValue } from "../lib/datetime";
import { defaultDeliveryPickup, eventRangeLabel } from "../lib/eventDays";
import { cn } from "../lib/ui";
import EventDateFields from "../components/EventDateFields";
import Button from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Textarea from "../components/ui/Textarea";
import type { EventListRow } from "./EventsPage";

type CopyAdjustment = {
  inventoryItemId: string;
  name: string;
  dayFrom: number;
  dayTo: number | null;
  sourceQty: number;
  copiedQty: number;
  unit: string;
};
const dateTimeFormat = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "short" });

function formatDateTime(value: string) {
  return fromDatetimeLocalValue(value) ? dateTimeFormat.format(new Date(value)) : "–";
}

export default function NewEventPage() {
  const user = getCurrentUser();
  const canCreate = ["admin", "event_manager", "chef", "warehouse"].includes(user?.role ?? "");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = params.get("from") === "warehouse" ? "/warehouse" : "/events";
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [number, setNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [eventDate, setEventDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return toDatetimeLocalValue(tomorrow).slice(0, 10);
  });
  const [eventEnd, setEventEnd] = useState("");
  const [delivery, setDelivery] = useState(() => defaultDeliveryPickup(eventDate, "")?.delivery ?? "");
  const [pickup, setPickup] = useState(() => defaultDeliveryPickup(eventDate, "")?.pickup ?? "");
  const [mode, setMode] = useState<"empty" | "copy">("empty");
  const [source, setSource] = useState("");
  const [sources, setSources] = useState<EventListRow[] | null>(null);
  const [sourceError, setSourceError] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: string; adjustments: CopyAdjustment[] } | null>(null);

  useEffect(() => {
    if (!canCreate || mode !== "copy") return;
    const controller = new AbortController();
    api<{ events: EventListRow[] }>("/events", { signal: controller.signal })
      .then(({ events }) => {
        if (controller.signal.aborted) return;
        setSources([...events].reverse());
        setSourceError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSourceError(true);
      });
    return () => controller.abort();
  }, [mode, canCreate]);

  if (!canCreate) return <Navigate to="/events" replace />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current || result) return;
    setError("");
    const deliveryIso = fromDatetimeLocalValue(delivery);
    const pickupIso = fromDatetimeLocalValue(pickup);
    if (!deliveryIso || !pickupIso || new Date(deliveryIso) >= new Date(pickupIso)) {
      setError("Závoz musí být dříve než svoz.");
      return;
    }
    if (!name.trim() || !location.trim() || (mode === "copy" && !source)) {
      setError("Vyplňte název, místo a případně vyberte akci ke kopírování.");
      return;
    }

    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const openCatalog = !(submitter instanceof HTMLButtonElement) || submitter.value !== "draft";
    pending.current = true;
    setSaving(true);
    try {
      const response = await api<{ event: { id: string }; adjustments?: CopyAdjustment[] }>(
        mode === "copy" ? `/events/${source}/duplicate` : "/events",
        {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            location: location.trim(),
            address: address.trim() || null,
            registration_number: number.trim() || null,
            notes: notes.trim() || null,
            event_date: fromDateInputValue(eventDate),
            event_end_date: fromDateInputValue(eventEnd),
            delivery_datetime: deliveryIso,
            pickup_datetime: pickupIso,
          }),
        }
      );
      toast.success(mode === "copy" ? "Akce zkopírována" : "Akce vytvořena");
      if (response.adjustments?.length) {
        setResult({ id: response.event.id, adjustments: response.adjustments });
        window.scrollTo({ top: 0 });
      } else {
        navigate(openCatalog ? `/events/${response.event.id}?addItems=1` : from, { replace: true });
      }
    } catch (err) {
      setError((err as ApiError)?.error?.message ?? "Nepodařilo se vytvořit akci.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const sourceEvent = sources?.find((event) => event.id === source);

  return (
    <div className="mx-auto w-full max-w-[1120px]">
      <Link to={from} className="mb-2 inline-flex items-center gap-2 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> {from === "/warehouse" ? "Výdej" : "Akce"}
      </Link>
      <h1 className="page-title mb-5">{result ? "Akce zkopírována" : "Nová akce"}</h1>
      {result ? (
        <Card className="space-y-3 p-5">
          <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-800">
            U těchto položek se při kopírování upravilo množství podle dostupnosti nebo počtu dní.
          </p>
          <ul className="divide-y divide-line">
            {result.adjustments.map((row) => (
              <li
                key={`${row.inventoryItemId}/${row.dayFrom}/${row.dayTo}`}
                className="flex justify-between gap-2 py-2 text-sm"
              >
                <span>{row.name}</span>
                <strong>
                  {row.sourceQty} → {row.copiedQty} {row.unit}
                </strong>
              </li>
            ))}
          </ul>
          <Link
            to={`/events/${result.id}`}
            replace
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Otevřít kopii <ArrowRight size={16} />
          </Link>
        </Card>
      ) : (
        <form onSubmit={submit} className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <FormSection number={1} title="Základní údaje">
              <label className="text-sm font-medium sm:col-span-2">
                Název akce
                <Input
                  autoFocus
                  required
                  className="mt-1.5"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="text-sm font-medium">
                Místo konání
                <Input
                  required
                  className="mt-1.5"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                />
              </label>
              <label className="text-sm font-medium">
                Evidenční číslo <span className="font-normal text-muted">(nepovinné)</span>
                <Input
                  className="mt-1.5"
                  maxLength={64}
                  placeholder="Např. 2026-0142"
                  value={number}
                  onChange={(event) => setNumber(event.target.value)}
                />
              </label>
              <label className="text-sm font-medium">
                Adresa
                <Input
                  className="mt-1.5"
                  placeholder="Ulice, město"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
              </label>
              <div className="text-sm font-medium">
                Manažer
                <div className="mt-1.5 flex min-h-10 items-center gap-2 wrap-break-word rounded-[9px] border border-line bg-table px-3 font-normal">
                  <User size={15} className="shrink-0 text-muted" /> {user?.email}
                </div>
              </div>
            </FormSection>
            <FormSection
              number={2}
              title="Termín a logistika"
              description="Podle termínu závozu a svozu se počítá dostupnost položek."
            >
              <EventDateFields
                from={eventDate}
                to={eventEnd}
                onChange={(start, end) => {
                  setEventDate(start);
                  setEventEnd(end);
                  const dates = defaultDeliveryPickup(start, end);
                  if (dates) {
                    setDelivery(dates.delivery);
                    setPickup(dates.pickup);
                  }
                }}
              />
              <label className="text-sm font-medium">
                Závoz (doručení)
                <Input
                  className="mt-1.5"
                  type="datetime-local"
                  required
                  value={delivery}
                  onChange={(event) => setDelivery(event.target.value)}
                />
              </label>
              <label className="text-sm font-medium">
                Svoz
                <Input
                  className="mt-1.5"
                  type="datetime-local"
                  required
                  value={pickup}
                  onChange={(event) => setPickup(event.target.value)}
                />
              </label>
              <label className="text-sm font-medium sm:col-span-2">
                Poznámka pro sklad a řidiče <span className="font-normal text-muted">(nepovinné)</span>
                <Textarea
                  className="mt-1.5"
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Např. omezený vjezd, nástup přes dvůr…"
                />
              </label>
            </FormSection>
            <FormSection number={3} title="Položky" description="Čím chcete začít?">
              {(
                [
                  { id: "empty", title: "Prázdná akce", description: "Položky přidáte z katalogu", icon: FilePlus },
                  {
                    id: "copy",
                    title: "Kopie minulé akce",
                    description: "Převezmete položky z vybrané akce",
                    icon: Copy,
                  },
                ] as const
              ).map(({ id, title, description, icon: Icon }) => (
                <label
                  key={id}
                  className={cn(
                    "cursor-pointer rounded-xl border border-line p-3 text-sm",
                    id === mode && "border-indigo-600 bg-indigo-50/60 ring-1 ring-indigo-600"
                  )}
                >
                  <span className="mb-2 flex items-center justify-between text-indigo-700">
                    <Icon size={18} />
                    <input type="radio" name="event-start" checked={mode === id} onChange={() => setMode(id)} />
                  </span>
                  <span className="block font-semibold">{title}</span>
                  <span className="mt-1 block text-xs text-muted">{description}</span>
                </label>
              ))}
              {mode === "copy" && (
                <label className="text-sm font-medium sm:col-span-2">
                  Akce ke kopírování
                  <Select
                    className="mt-1.5"
                    required
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                  >
                    <option value="">
                      {sourceError ? "Akce se nepodařilo načíst" : sources === null ? "Načítám akce…" : "Vyberte akci"}
                    </option>
                    {sources?.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name} · {formatDateTime(toDatetimeLocalValue(event.deliveryDatetime))}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
            </FormSection>
          </div>

          <Card className="space-y-4 p-5 lg:sticky lg:top-20">
            <h2 className="text-base font-bold">Shrnutí</h2>
            <ul className="space-y-3 text-sm">
              <li className="flex gap-2">
                <CalendarDays size={16} className="shrink-0 text-muted" />{" "}
                {eventRangeLabel(fromDateInputValue(eventDate), fromDateInputValue(eventEnd)) ||
                  (eventDate ? new Date(`${eventDate}T12:00:00`).toLocaleDateString("cs-CZ") : "Termín akce")}
              </li>
              <li className="flex gap-2">
                <Truck size={16} className="shrink-0 text-muted" />
                <span>
                  Závoz {formatDateTime(delivery)}
                  <br />
                  Svoz {formatDateTime(pickup)}
                </span>
              </li>
              <li className="flex gap-2">
                <MapPin size={16} className="shrink-0 text-muted" />{" "}
                <span className="min-w-0 wrap-break-word">{location || "Místo konání"}</span>
              </li>
              {sourceEvent && (
                <li className="flex gap-2">
                  <Copy size={16} className="shrink-0 text-muted" /> {sourceEvent.name}
                </li>
              )}
            </ul>
            {error && (
              <p role="alert" className="rounded-lg bg-red-100 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="grid gap-2 pt-2">
              <Button type="submit" value="catalog" full disabled={saving}>
                {saving ? "Ukládám…" : "Založit a upravit položky"} <ArrowRight size={16} />
              </Button>
              <Button type="submit" value="draft" full variant="secondary" disabled={saving}>
                Uložit jako koncept
              </Button>
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}

function FormSection({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span
          className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700"
          aria-hidden="true"
        >
          {number}
        </span>
        <div>
          <h2 className="font-bold">{title}</h2>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

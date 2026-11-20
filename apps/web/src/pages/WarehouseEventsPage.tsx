import { useEffect, useState } from "react";
import { ArrowRight, CalendarClock, PackageCheck, Play } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { api, getCurrentUser, type ApiError } from "../lib/api";
import { toDatetimeLocalValue } from "../lib/datetime";
import { cn } from "../lib/ui";
import { managerLabel, statusBadgeClass, statusLabel } from "../lib/viewModel";
import { startSSE } from "../lib/sse";
import EventFilters, { emptyEventFilters, EventSearch, matchesEventFilters, type EventFiltersData } from "../components/EventFilters";
import { Card, CardContent } from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Skeleton from "../components/ui/Skeleton";
import SegmentedControl from "../components/ui/SegmentedControl";
import { CreateEventLink, type EventListRow } from "./EventsPage";

const PERIODS = [
  { value: "today", label: "Dnes" },
  { value: "tomorrow", label: "Zítra" },
  { value: "week", label: "Tento týden" },
  { value: "all", label: "Vše" },
] as const;
type Period = (typeof PERIODS)[number]["value"];

const LANES = [
  { id: "waiting", label: "Čeká na vychystání", status: "K vychystání", tone: "bg-white text-muted" },
  { id: "packing", label: "Vychystává se", status: "Vychystává se", tone: "bg-indigo-50 text-indigo-700" },
  { id: "issued", label: "Vydáno, na akci", status: "Vydáno", tone: "bg-emerald-100 text-emerald-700" },
  { id: "returning", label: "Vrací se", status: "Vrací se", tone: "bg-amber-100 text-amber-800" },
] as const;
type Lane = (typeof LANES)[number]["id"];
const STATUS_FILTERS = [
  { value: "all", label: "Všechny stavy" },
  ...LANES.map(({ id, label }) => ({ value: id, label: id === "packing" ? "Rozpracováno" : label })),
  { value: "DRAFT", label: "Koncept akce" },
  ...["READY_FOR_WAREHOUSE", "CLOSED", "CANCELLED"].map((value) => ({ value, label: statusLabel(value) }))
];

const schedule = new Intl.DateTimeFormat("cs-CZ", {
  weekday: "short",
  day: "numeric",
  month: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function laneFor(event: EventListRow, now: Date): Lane | null {
  if (event.status === "SENT_TO_WAREHOUSE") return event.packingProgress?.started ? "packing" : "waiting";
  if (event.status === "ISSUED") {
    if (event.packingProgress?.total) return "packing";
    return new Date(event.pickupDatetime) <= now ? "returning" : "issued";
  }
  return null;
}

function inPeriod(event: EventListRow, lane: Lane | null, period: Period, now: Date) {
  if (period === "all") return true;
  const offset = period === "week" ? -((now.getDay() + 6) % 7) : Number(period === "tomorrow");
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (period === "week" ? 7 : 1));
  const delivery = new Date(event.deliveryDatetime);
  const pickup = new Date(event.pickupDatetime);
  if (lane === "returning" && period !== "tomorrow") return pickup < end;
  if (lane === "issued") return delivery < end && pickup >= start;
  if ((lane === "waiting" || lane === "packing") && period !== "tomorrow" && delivery < now) return true;
  return delivery >= start && delivery < end;
}

export default function WarehouseEventsPage() {
  const user = getCurrentUser();
  const role = user?.role ?? "";
  const canIssue = ["admin", "warehouse"].includes(role);
  const nav = useNavigate();
  const [events, setEvents] = useState<EventListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<Period>("week");
  const [archive, setArchive] = useState(false);
  const [filters, setFilters] = useState(emptyEventFilters);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!canIssue) return;
    let active = true;
    let requestId = 0;
    const load = async () => {
      const id = ++requestId;
      try {
        const res = await api<{ events: EventListRow[] }>("/events?view=warehouse");
        if (!active || id !== requestId) return;
        setEvents(res.events);
        setError("");
      } catch (err) {
        if (active && id === requestId) setError((err as ApiError)?.error?.message ?? "Nepodařilo se načíst výdej.");
      } finally {
        if (active && id === requestId) setLoading(false);
      }
    };

    void load();
    const off = startSSE((event) => {
      if (["event_status_changed", "event_packing_changed", "export_created", "reservation_changed"].includes(event.type)) void load();
    });
    const interval = setInterval(load, 15_000);
    return () => {
      active = false;
      off();
      clearInterval(interval);
    };
  }, [canIssue]);

  if (!canIssue)
    return (
      <Card>
        <CardContent className="text-sm text-muted">
          Sekce Výdej je dostupná pouze pro sklad a administrátora.
        </CardContent>
      </Card>
    );

  const now = new Date();
  const scoped = events
    .map((event) => ({ event, lane: laneFor(event, now) }))
    .filter(({ event, lane }) => matchesEventFilters(event, filters, user?.id) && (filters.period
      ? toDatetimeLocalValue(event.deliveryDatetime).startsWith(filters.period)
      : inPeriod(event, lane, period, now)));
  const { status } = filters;
  const entries = scoped.filter(({ event, lane }) => status === "all" || (lane ?? event.status) === status);
  const waiting = scoped.filter(({ lane }) => lane === "waiting");
  const packing = scoped.filter(({ lane }) => lane === "packing");
  const issued = scoped.filter(({ lane }) => lane === "issued" || lane === "returning");
  const problems = scoped.filter(
    ({ event, lane }) =>
      lane &&
      (event.exportNeedsRevision ||
        event.hasUnseenChanges || Boolean(event.packingProgress?.missing) ||
        (event.status === "SENT_TO_WAREHOUSE" && !event.chefConfirmedAt))
  );
  const other = entries.filter(({ lane }) => !lane).reverse();
  const visibleLanes = LANES.filter(({ id }) => status === "all" || status === id);

  const changeFilters = (next: EventFiltersData) => {
    if (next.period !== filters.period) setPeriod("all");
    setFilters(next);
  };

  const startPacking = async (eventId: string) => {
    if (starting) return;
    setStarting(true);
    try {
      await api(`/events/${eventId}/packing/start`, { method: "POST" });
      nav(`/warehouse/${eventId}`);
    } catch (err) {
      toast.error((err as ApiError)?.error?.message ?? "Vychystávání se nepodařilo zahájit.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Výdej</h1>
          <p className="page-description">Akce k vychystání, výdeji a vrácení. Seřazeno podle času závozu.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <EventSearch value={filters.search} onChange={(search) => setFilters((current) => ({ ...current, search }))} />
          <CreateEventLink fromWarehouse />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <EventFilters events={events} activeRole={role} filters={filters} statuses={STATUS_FILTERS} onChange={changeFilters} />
        </div>
        <SegmentedControl label="Období výdeje" options={PERIODS} value={period} onChange={(next) => {
          setPeriod(next);
          setFilters((current) => ({ ...current, period: "" }));
        }} />
      </div>
      {error && (
        <Card className="border-red-100 bg-red-50 p-4 text-sm text-red-700" role="alert">
          {error}
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric
          title="K vychystání"
          count={waiting.length}
          description={
            waiting[0] ? `Nejbližší ${schedule.format(new Date(waiting[0].event.deliveryDatetime))}` : undefined
          }
          loading={loading}
        />
        <Metric
          title="Rozpracováno"
          count={packing.length}
          description={
            packing.length
              ? `${packing.reduce((sum, { event }) => sum + (event.packingProgress?.confirmed ?? 0), 0)} / ${packing.reduce((sum, { event }) => sum + (event.packingProgress?.total ?? 0), 0)} položek`
              : undefined
          }
          color="text-indigo-700"
          loading={loading}
        />
        <Metric title="Vydáno" count={issued.length} description="Čeká na návrat nebo uzavření" loading={loading} />
        <Metric
          title="K prověření"
          count={problems.length}
          description="Změny, chybějící položky nebo čekání na kuchyň"
          color="text-red-700"
          loading={loading}
        />
      </div>
      {visibleLanes.length > 0 && <div className={cn("grid items-stretch gap-4", status === "all" && "sm:grid-cols-2 xl:grid-cols-4")}>
        {visibleLanes.map(({ id, label, tone }) => {
          const cards = entries.filter(({ lane }) => lane === id);
          return (
            <section key={id} className="min-w-0 space-y-3 rounded-xl bg-[#eceff2] p-3" aria-label={label}>
              <h2 className="flex items-center justify-between gap-2 px-1 text-sm font-semibold">
                {label}
                <Badge className={tone}>{cards.length}</Badge>
              </h2>
              {loading ? (
                <Skeleton className="h-36 bg-white" />
              ) : cards.length ? (
                <div className={status === "all" ? "space-y-3" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-4"}>
                  {cards.map(({ event }) => <WarehouseCard key={event.id} event={event} lane={id} starting={starting} onStart={() => void startPacking(event.id)} />)}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-line p-3 text-xs text-muted">Žádné akce</p>
              )}
            </section>
          );
        })}
      </div>}
      {(status === "all" || visibleLanes.length === 0) && <Card className="overflow-hidden">
        <button
          type="button"
          aria-expanded={status !== "all" || archive}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold hover:bg-table"
          onClick={status === "all" ? () => setArchive(!archive) : undefined}
          disabled={status !== "all"}
        >
          Ostatní akce <Badge>{other.length}</Badge>
        </button>
        {(status !== "all" || archive) && (
          <ul className="divide-y divide-line border-t border-line">
            {other.length ? (
              other.map(({ event }) => (
                <li key={event.id}>
                  <Link
                    className="flex items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-indigo-50"
                    to={`/warehouse/${event.id}`}
                  >
                    <span className="min-w-0 wrap-break-word">
                      {event.name}{" "}
                      <span className="text-xs text-muted">{schedule.format(new Date(event.deliveryDatetime))}</span>
                    </span>
                    <Badge className={statusBadgeClass(event.status)}>{statusLabel(event.status)}</Badge>
                  </Link>
                </li>
              ))
            ) : (
              <li className="px-4 py-3 text-sm text-muted">Žádné další akce v období.</li>
            )}
          </ul>
        )}
      </Card>}
    </div>
  );
}

function Metric({
  title,
  count,
  description,
  color,
  loading,
}: {
  title: string;
  count: number;
  description?: string;
  color?: string;
  loading: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="text-[13px] font-medium text-muted">{title}</div>
      {loading ? (
        <Skeleton className="mt-1 h-7 w-16" />
      ) : (
        <div className={cn("mt-1 text-[23px] leading-8 font-bold", color)}>
          {count} {count === 1 ? "akce" : count >= 2 && count < 5 ? "akce" : "akcí"}
        </div>
      )}
      {description && <div className="mt-1 text-xs text-muted">{description}</div>}
    </Card>
  );
}

function WarehouseCard({ event, lane, starting, onStart }: { event: EventListRow; lane: Lane; starting: boolean; onStart: () => void }) {
  const progress = event.packingProgress;
  const needsKitchen = event.status === "SENT_TO_WAREHOUSE" && !event.chefConfirmedAt;
  const hasChange = event.exportNeedsRevision || event.hasUnseenChanges;
  const href = `/warehouse/${event.id}`;
  const badge = LANES.find(({ id }) => id === lane);
  const action =
    lane === "packing"
        ? "Pokračovat"
        : lane === "returning"
          ? "Přijmout zpět"
          : null;
  const Icon = lane === "returning" ? PackageCheck : ArrowRight;
  return (
    <Card className={cn("space-y-2.5 p-3.5", needsKitchen && "border-red-300")}>
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs font-semibold text-muted">
        <time dateTime={event.deliveryDatetime} className="inline-flex items-center gap-1.5 first-letter:uppercase">
          <CalendarClock size={14} />
          {schedule.format(new Date(event.deliveryDatetime))}
        </time>
        {needsKitchen && <Badge tone="danger">Čeká na kuchyň</Badge>}
        {hasChange && <Badge tone="warn">Změna v akci</Badge>}
        {Boolean(progress?.missing) && <Badge tone="danger">Chybí položky ({progress?.missing})</Badge>}
      </div>
      {badge && <Badge className={badge.tone}>{badge.status}</Badge>}
      <div>
        <Link to={href} className="block text-sm font-semibold wrap-break-word hover:text-indigo-700">
          {event.name}
        </Link>
        <p className="mt-0.5 text-xs text-muted">
          {[managerLabel(event.createdBy), event.location].filter(Boolean).join(" · ")}
        </p>
      </div>
      {progress && progress.total > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted">
            <span>Vychystáno</span>
            <strong className="text-ink">
              {progress.confirmed} / {progress.total}
            </strong>
          </div>
          <progress
            className="block h-1.5 w-full overflow-hidden rounded-full bg-canvas accent-indigo-600 [&::-webkit-progress-bar]:bg-canvas [&::-webkit-progress-value]:bg-indigo-600"
            value={progress.confirmed}
            max={progress.total}
            aria-label="Vychystáno"
          />
        </div>
      )}
      {lane === "returning" && (
        <div className="text-xs text-muted">Svoz {schedule.format(new Date(event.pickupDatetime))}</div>
      )}
      {lane === "waiting" && (event.exportNeedsRevision || !progress?.total ? (
        <Link to={href} className="flex min-h-9 items-center justify-center gap-2 rounded-lg border border-line text-[13px] font-semibold hover:bg-table">
          <ArrowRight size={15} /> Otevřít výdej
        </Link>
      ) : (
        <Button type="button" size="sm" variant="dark" full disabled={starting} onClick={onStart}>
          <Play size={15} /> Začít vychystávat
        </Button>
      ))}
      {action && (
        <Link
          to={href}
          className={cn(
            "flex min-h-9 items-center justify-center gap-2 rounded-lg px-2 text-center text-[13px] font-semibold",
            lane === "packing"
                ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                : "bg-amber-100 text-amber-800 hover:bg-amber-200"
          )}
        >
          <Icon size={15} />
          {action}
        </Link>
      )}
    </Card>
  );
}

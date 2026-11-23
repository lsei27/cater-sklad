import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, List, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { api, getCurrentUser, type ApiError } from "../lib/api";
import { toDateInputValue, toDatetimeLocalValue } from "../lib/datetime";
import { startSSE } from "../lib/sse";
import { Card, CardContent } from "../components/ui/Card";
import EventFilters, { emptyEventFilters, EventSearch, matchesEventFilters } from "../components/EventFilters";
import Badge from "../components/ui/Badge";
import Select from "../components/ui/Select";
import Skeleton from "../components/ui/Skeleton";
import SegmentedControl from "../components/ui/SegmentedControl";
import {
  EVENT_SORT_OPTIONS,
  groupEventsForList,
  managerLabel,
  statusBadgeClass,
  statusLabel,
  type EventSortMode,
} from "../lib/viewModel";
import { cn } from "../lib/ui";
import { eventRangeLabel } from "../lib/eventDays";

export type EventListRow = {
  id: string;
  name: string;
  location: string;
  eventDate?: string | null;
  eventEndDate?: string | null;
  deliveryDatetime: string;
  pickupDatetime: string;
  status: string;
  exportNeedsRevision: boolean;
  chefConfirmedAt: string | null;
  hasUnseenChanges?: boolean;
  itemCount?: number;
  packingProgress?: { total: number; confirmed: number; started: boolean; missing?: number };
  createdBy?: { id?: string; name?: string | null; email?: string };
};

const STATUS_FILTERS = [
  { value: "active", label: "Aktivní" },
  ...["DRAFT", "SENT_TO_WAREHOUSE", "ISSUED", "CLOSED", "CANCELLED", "READY_FOR_WAREHOUSE"].map((value) => ({
    value,
    label: statusLabel(value),
  })),
  { value: "all", label: "Vše" },
];

const VIEW_OPTIONS = [
  {
    value: "list",
    label: (
      <>
        <List size={15} /> Seznam
      </>
    ),
  },
  {
    value: "calendar",
    label: (
      <>
        <CalendarDays size={15} /> Kalendář
      </>
    ),
  },
  {
    value: "grid",
    label: (
      <>
        <LayoutGrid size={15} /> Dlaždice
      </>
    ),
  },
] as const;

const isActive = (event: EventListRow) => !["CLOSED", "CANCELLED"].includes(event.status);
const dateKey = (event: EventListRow) =>
  event.eventDate ? toDateInputValue(event.eventDate) : toDatetimeLocalValue(event.deliveryDatetime).slice(0, 10);

const eventEndKey = (event: EventListRow) => toDateInputValue(event.eventEndDate) || dateKey(event);

function matchesPeriod(event: EventListRow, period: string, calendar: boolean) {
  if (!period) return true;
  if (!calendar) return toDatetimeLocalValue(event.deliveryDatetime).startsWith(period);
  const first = period.length === 4 ? `${period}-01-01` : `${period}-01`;
  const last = period.length === 4 ? `${period}-12-31` : `${period}-31`;
  return dateKey(event) <= last && eventEndKey(event) >= first;
}

function weekStart(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function groupedEvents(events: EventListRow[], sort: EventSortMode) {
  const sections = groupEventsForList(events, sort);
  if (sort === "status") return sections;
  const weeks = new Map<string, { status: string; label: string; events: EventListRow[] }>();
  const currentWeek = weekStart(new Date());
  const nextWeek = new Date(currentWeek);
  nextWeek.setDate(nextWeek.getDate() + 7);
  for (const event of sections[0]?.events ?? []) {
    const start = weekStart(new Date(event.deliveryDatetime));
    const key = toDatetimeLocalValue(start).slice(0, 10);
    const label =
      +start === +currentWeek
        ? "Tento týden"
        : +start === +nextWeek
          ? "Příští týden"
          : `Týden od ${start.toLocaleDateString("cs-CZ")}`;
    if (!weeks.has(key)) weeks.set(key, { status: key, label, events: [] });
    weeks.get(key)?.events.push(event);
  }
  return [...weeks.values()];
}

function eventNextStep(event: EventListRow) {
  if (event.exportNeedsRevision) return { label: "Změna po předání", color: "text-amber-800" };
  if (event.status === "DRAFT")
    return { label: event.itemCount ? "Doplnit položky" : "Přidat položky", color: "text-indigo-700" };
  if (event.status === "SENT_TO_WAREHOUSE" && !event.chefConfirmedAt)
    return { label: "Čeká na kuchyň", color: "text-muted" };
  return { label: "Otevřít detail", color: "text-muted" };
}

const dateFormat = new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" });
const timeFormat = new Intl.DateTimeFormat("cs-CZ", { hour: "numeric", minute: "2-digit" });

export default function EventsPage() {
  const user = getCurrentUser();
  const role = user?.role ?? "";
  const [events, setEvents] = useState<EventListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ ...emptyEventFilters, status: "active" });
  const { status, period } = filters;
  const [view, setView] = useState<(typeof VIEW_OPTIONS)[number]["value"]>("list");
  const [sort, setSort] = useState<EventSortMode>("date_asc");

  useEffect(() => {
    let active = true;
    let revision = 0;
    const load = async () => {
      const request = ++revision;
      try {
        const res = await api<{ events: EventListRow[] }>("/events");
        if (!active || request !== revision) return;
        setEvents(res.events);
        setError("");
      } catch (err) {
        if (active && request === revision) setError((err as ApiError)?.error?.message ?? "Nepodařilo se načíst akce.");
      } finally {
        if (active && request === revision) setLoading(false);
      }
    };

    void load();
    const off = startSSE((event) => {
      if (["event_status_changed", "export_created", "reservation_changed"].includes(event.type)) void load();
    });
    const interval = setInterval(load, 15_000);
    return () => {
      active = false;
      off();
      clearInterval(interval);
    };
  }, []);

  const availableStatuses = STATUS_FILTERS.filter(
    (option) => option.value !== "READY_FOR_WAREHOUSE" || status === option.value || events.some((event) => event.status === option.value)
  );
  const scoped = events.filter((event) =>
    matchesEventFilters(event, filters, user?.id) && matchesPeriod(event, period, view === "calendar")
  );
  const filtered = scoped.filter(
    (event) => status === "all" || (status === "active" ? isActive(event) : event.status === status)
  );
  const sections = groupedEvents(filtered, sort);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Akce</h1>
          <p className="page-description">Plánování a předání do skladu.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <EventSearch value={filters.search} onChange={(search) => setFilters((current) => ({ ...current, search }))} />
          {["admin", "event_manager", "chef"].includes(role) && <CreateEventLink />}
        </div>
      </div>

      <div role="group" aria-label="Stav akce" className="flex gap-1 overflow-x-auto border-b border-line">
        {availableStatuses.map((option) => {
          const count = scoped.filter(
            (event) =>
              option.value === "all" || (option.value === "active" ? isActive(event) : event.status === option.value)
          ).length;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={status === option.value}
              onClick={() => setFilters((current) => ({ ...current, status: option.value }))}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium whitespace-nowrap text-muted hover:text-ink focus-visible:outline-offset-[-2px]",
                status === option.value && "border-indigo-600 text-indigo-700"
              )}
            >
              {option.label}
              <span
                className={cn(
                  "rounded-full bg-slate-200/60 px-2 text-xs tabular-nums",
                  status === option.value && "bg-indigo-50"
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <EventFilters
            events={events}
            activeRole={role}
            filters={filters}
            statuses={availableStatuses.map((option) => option.value === "all" ? { ...option, label: "Všechny stavy" } : option)}
            onChange={setFilters}
          />
          {view !== "calendar" && (
            <Select
              className="h-9 w-auto max-w-full rounded-full"
              aria-label="Řazení akcí"
              value={sort}
              onChange={(event) => setSort(event.target.value as EventSortMode)}
            >
              {EVENT_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </div>
        <SegmentedControl label="Zobrazení akcí" value={view} onChange={setView} options={VIEW_OPTIONS} />
      </div>

      {error && (
        <Card className="bg-red-50">
          <CardContent role="alert" className="text-sm text-red-700">
            {error}
          </CardContent>
        </Card>
      )}
      {loading ? (
        <Card className="space-y-4 p-4">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton className="h-9 w-full" key={index} />
          ))}
        </Card>
      ) : view === "calendar" ? (
        <EventCalendar events={filtered} period={period} onMonthChange={(period) => setFilters((current) => ({ ...current, period }))} />
      ) : !filtered.length ? (
        <Card className="py-12 text-center text-sm text-muted">Žádná akce neodpovídá zvoleným filtrům.</Card>
      ) : view === "list" ? (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[.72fr_2.35fr_1.13fr_.87fr_.97fr_1fr_16px] gap-3 border-b border-line bg-table px-4 py-2.5 text-[11px] font-semibold tracking-wide text-muted uppercase lg:grid">
            <span>Termín</span>
            <span>Akce</span>
            <span>Místo</span>
            <span>Stav</span>
            <span>Položky</span>
            <span>Další krok</span>
          </div>
          {sections.map((section) => (
            <section key={section.status} aria-label={section.label}>
              <h2 className="border-b border-line bg-table px-4 py-2 text-xs font-semibold text-muted">
                {section.label}
              </h2>
              <ul className="divide-y divide-line">
                {section.events.map((event) => (
                  <li key={event.id}>
                    <EventListLink event={event} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Card>
      ) : (
        <div className="space-y-4">
          {sections.map((section) => (
            <section key={section.status}>
              <h2 className="mb-2 text-sm font-semibold text-muted">{section.label}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {section.events.map((event) => (
                  <Link
                    key={event.id}
                    to={`/events/${event.id}`}
                    className="block rounded-xl border border-line bg-white p-4 hover:border-indigo-400"
                  >
                    <Badge className={statusBadgeClass(event.status)}>{statusLabel(event.status)}</Badge>
                    <h3 className="mt-2 text-base font-semibold">{event.name}</h3>
                    <div className="mt-1 text-sm text-muted">{event.location}</div>
                    <div className="mt-2 text-xs text-muted">
                      {dateFormat.format(new Date(event.deliveryDatetime))} ·{" "}
                      {timeFormat.format(new Date(event.deliveryDatetime))}
                    </div>
                    {managerLabel(event.createdBy) && (
                      <div className="mt-1 text-xs text-muted">{managerLabel(event.createdBy)}</div>
                    )}
                    <div className={cn("mt-2 text-sm font-medium", eventNextStep(event).color)}>
                      {eventNextStep(event).label}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export function CreateEventLink({ fromWarehouse = false }: { fromWarehouse?: boolean }) {
  return (
    <Link
      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[9px] bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
      to={fromWarehouse ? "/events/new?from=warehouse" : "/events/new"}
    >
      <Plus size={16} /> Nová akce
    </Link>
  );
}

function EventListLink({ event }: { event: EventListRow }) {
  const next = eventNextStep(event);
  const delivery = new Date(event.deliveryDatetime);
  const pickup = new Date(event.pickupDatetime);
  const sameDay = delivery.toDateString() === pickup.toDateString();
  const range = eventRangeLabel(event.eventDate, event.eventEndDate);
  return (
    <Link
      to={`/events/${event.id}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 text-[13px] last:border-b-0 hover:bg-indigo-50/45 focus-visible:outline-offset-[-2px] lg:min-h-[57px] lg:grid-cols-[.72fr_2.35fr_1.13fr_.87fr_.97fr_1fr_16px]"
    >
      <div className="order-2 text-muted lg:order-0">
        <div className="font-semibold text-ink first-letter:uppercase">{dateFormat.format(delivery)}</div>
        <div className="text-xs">
          {timeFormat.format(delivery)} – {sameDay ? timeFormat.format(pickup) : dateFormat.format(pickup)}
        </div>
        {range && <div className="text-xs">{range}</div>}
      </div>
      <div className="min-w-0">
        <h3 className="wrap-break-word text-sm font-semibold">{event.name}</h3>
        <div className="break-all text-xs text-muted">{managerLabel(event.createdBy)}</div>
      </div>
      <div className="order-3 min-w-0 wrap-break-word text-muted lg:order-0">{event.location}</div>
      <div className="justify-self-end lg:justify-self-start">
        <Badge className={statusBadgeClass(event.status)}>{statusLabel(event.status)}</Badge>
      </div>
      <div className="order-4 text-xs text-muted lg:order-0 lg:text-[13px]">
        {event.itemCount === undefined
          ? "–"
          : event.itemCount === 0
            ? "Žádné položky"
            : `${event.itemCount} ${event.itemCount === 1 ? "položka" : event.itemCount < 5 ? "položky" : "položek"}`}
      </div>
      <div className={cn("order-last font-medium lg:order-0", next.color)}>{next.label}</div>
      <ChevronRight
        className="col-start-2 row-start-3 justify-self-end text-slate-400 lg:col-auto lg:row-auto"
        size={16}
        aria-hidden="true"
      />
    </Link>
  );
}

function EventCalendar({ events, period, onMonthChange }: {
  events: EventListRow[];
  period: string;
  onMonthChange: (period: string) => void;
}) {
  const now = new Date();
  const [year, selectedMonth] = period.split("-").map(Number);
  const month = new Date(year || now.getFullYear(), (selectedMonth || now.getMonth() + 1) - 1, 1);
  const moveMonth = (step: number) => {
    const target = new Date(month.getFullYear(), month.getMonth() + step, 1);
    onMonthChange(toDatetimeLocalValue(target).slice(0, 7));
  };
  const first = weekStart(month);
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const days = Math.ceil((length + ((month.getDay() + 6) % 7)) / 7) * 7;
  const displayEvents = useMemo(
    () =>
      events.map((event) => ({
        event,
        start: dateKey(event),
        end: eventEndKey(event),
      })),
    [events]
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line p-3">
        <button
          type="button"
          className="grid size-8 place-items-center rounded-lg hover:bg-canvas"
          aria-label="Předchozí měsíc"
          onClick={() => moveMonth(-1)}
        >
          <ChevronLeft size={18} />
        </button>
        <h2 className="font-semibold capitalize">
          {month.toLocaleDateString("cs-CZ", { month: "long", year: "numeric" })}
        </h2>
        <button
          type="button"
          className="grid size-8 place-items-center rounded-lg hover:bg-canvas"
          aria-label="Další měsíc"
          onClick={() => moveMonth(1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[600px] grid-cols-7">
          {["Po", "Út", "St", "Čt", "Pá", "So", "Ne"].map((day) => (
            <div key={day} className="border-b border-line bg-table p-2 text-xs font-semibold text-muted">
              {day}
            </div>
          ))}
          {Array.from({ length: days }, (_, index) => {
            const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
            const key = toDatetimeLocalValue(day).slice(0, 10);
            return (
              <div
                key={key}
                className={cn(
                  "min-h-24 min-w-0 space-y-1 border-r border-b border-line p-2 text-xs",
                  day.getMonth() !== month.getMonth() && "bg-canvas text-muted"
                )}
              >
                <time dateTime={key} className="font-semibold">
                  {day.getDate()}
                </time>
                {displayEvents
                  .filter(({ start, end }) => key >= start && key <= end)
                  .map(({ event }) => (
                    <Link
                      key={event.id}
                      to={`/events/${event.id}`}
                      title={event.name}
                      className={cn("block truncate rounded-md px-1.5 py-1", statusBadgeClass(event.status))}
                    >
                      {event.name}
                    </Link>
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

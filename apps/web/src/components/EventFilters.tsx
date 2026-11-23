import { Search, User } from "lucide-react";
import { toDateInputValue, toDatetimeLocalValue } from "../lib/datetime";
import { cn } from "../lib/ui";
import { managerLabel } from "../lib/viewModel";
import Input from "./ui/Input";
import Select from "./ui/Select";

export const emptyEventFilters = { search: "", status: "all", onlyMine: false, period: "", manager: "", location: "" };
export type EventFiltersData = typeof emptyEventFilters;
export type StatusFilterOption = { value: string; label: string };

type FilterableEvent = {
  name: string;
  location: string;
  deliveryDatetime: string;
  eventDate?: string | null;
  eventEndDate?: string | null;
  createdBy?: { id?: string; name?: string | null; email?: string };
};

export function matchesEventFilters(event: FilterableEvent, filters: EventFiltersData, userId?: string) {
  const term = filters.search.trim().toLocaleLowerCase("cs");
  return (!term || [event.name, event.location, managerLabel(event.createdBy)].some((value) =>
    value.toLocaleLowerCase("cs").includes(term)
  )) &&
    (!filters.onlyMine || event.createdBy?.id === userId) &&
    (!filters.manager || event.createdBy?.id === filters.manager) &&
    (!filters.location || event.location === filters.location);
}

export function EventSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="relative block min-w-40 flex-1 sm:w-80">
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
      <Input
        className="pl-9"
        aria-label="Hledat akce"
        placeholder="Hledat akci, manažera, místo…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export default function EventFilters({
  events, activeRole, filters, statuses, onChange
}: {
  events: FilterableEvent[];
  activeRole: string;
  filters: EventFiltersData;
  statuses: readonly StatusFilterOption[];
  onChange: (filters: EventFiltersData) => void;
}) {
  const managers = new Map<string, string>();
  for (const event of events) {
    if (event.createdBy?.id) managers.set(event.createdBy.id, managerLabel(event.createdBy));
  }
  const places = [...new Set(events.map((event) => event.location).filter(Boolean))].sort((a, b) => a.localeCompare(b, "cs"));
  const year = new Date().getFullYear();
  const years = [...new Set([
    String(year),
    String(year + 1),
    filters.period.slice(0, 4),
    ...events.flatMap((event) => [
      toDatetimeLocalValue(event.deliveryDatetime), toDateInputValue(event.eventDate), toDateInputValue(event.eventEndDate)
    ]).map((date) => date.slice(0, 4))
  ])].filter(Boolean).sort().reverse();

  return (
    <>
      {["admin", "event_manager", "chef", "warehouse"].includes(activeRole) && (
        <button
          type="button"
          aria-pressed={filters.onlyMine}
          onClick={() => onChange({ ...filters, onlyMine: !filters.onlyMine })}
          className={cn(
            "inline-flex min-h-9 items-center gap-2 rounded-full border border-line bg-white px-3 text-[13px] font-medium",
            filters.onlyMine && "border-ink bg-ink text-white"
          )}
        >
          <User size={14} /> Moje akce
        </button>
      )}
      <Select
        className="h-9 w-auto max-w-full rounded-full"
        aria-label="Stav"
        value={filters.status}
        onChange={(event) => onChange({ ...filters, status: event.target.value })}
      >
        {statuses.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </Select>
      <Select
        className="h-9 w-auto max-w-full rounded-full"
        aria-label="Období"
        value={filters.period}
        onChange={(event) => onChange({ ...filters, period: event.target.value })}
      >
        <option value="">Všechna období</option>
        {years.map((year) => (
          <optgroup label={year} key={year}>
            <option value={year}>Celý rok {year}</option>
            {Array.from({ length: 12 }, (_, index) => {
              const month = `${year}-${String(index + 1).padStart(2, "0")}`;
              return (
                <option key={month} value={month}>
                  {new Date(Number(year), index).toLocaleDateString("cs-CZ", { month: "long", year: "numeric" })}
                </option>
              );
            })}
          </optgroup>
        ))}
      </Select>
      <Select
        className="h-9 w-auto max-w-48 rounded-full"
        aria-label="Manažer"
        value={filters.manager}
        onChange={(event) => onChange({ ...filters, manager: event.target.value })}
      >
        <option value="">Všichni manažeři</option>
        {[...managers].sort(([, a], [, b]) => a.localeCompare(b, "cs")).map(([id, name]) => (
          <option key={id} value={id}>{name}</option>
        ))}
      </Select>
      <Select
        className="h-9 w-auto max-w-44 rounded-full"
        aria-label="Místo"
        value={filters.location}
        onChange={(event) => onChange({ ...filters, location: event.target.value })}
      >
        <option value="">Místo</option>
        {places.map((place) => <option key={place}>{place}</option>)}
      </Select>
    </>
  );
}

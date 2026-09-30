// Dny vícedenní akce na webu. Stejná pravidla jako apps/api/src/lib/eventDays.ts:
// den 1 je datum akce (event_date), dayTo === null znamená „do konce akce“.

export type DayRange = { dayFrom: number; dayTo: number | null };

export function dayRangeKey(range: DayRange): string {
  return `${range.dayFrom}-${range.dayTo ?? "end"}`;
}

export function sameDayRange(a: DayRange, b: DayRange): boolean {
  return a.dayFrom === b.dayFrom && (a.dayTo ?? null) === (b.dayTo ?? null);
}

export function dayRangeLabel(range: DayRange, dayCount: number): string {
  const to = range.dayTo ?? dayCount;
  if (range.dayFrom === 1 && to === dayCount) return "Celá akce";
  if (range.dayFrom === to) return `Den ${range.dayFrom}`;
  return `Dny ${range.dayFrom}-${to}`;
}

/// Klíc řádku položky v akci. Jedna položka může mít víc řádků s různými dny.
export function reservationRowKey(row: { inventoryItemId: string; dayFrom?: number; dayTo?: number | null }): string {
  return `${row.inventoryItemId}|${dayRangeKey({ dayFrom: row.dayFrom ?? 1, dayTo: row.dayTo ?? null })}`;
}

const DAY_MS = 86_400_000;

function utcDay(iso: string): number {
  return Math.floor(new Date(iso).getTime() / DAY_MS);
}

/// Kalendární datum N-tého dne akce, např. "7. 10.". event_date je UTC půlnoc kalendářního dne.
export function eventDayDateLabel(eventDateIso: string, day: number): string {
  const date = new Date((utcDay(eventDateIso) + day - 1) * DAY_MS);
  return `${date.getUTCDate()}. ${date.getUTCMonth() + 1}.`;
}

/// Počet dnů akce: kalendární dny od data akce do konce akce včetně. Bez obou dat
/// nebo s koncem ne později než začátek je akce jednodenní. Stejné pravidlo jako v API.
export function eventDayCount(eventDateIso: string | null | undefined, eventEndDateIso: string | null | undefined): number {
  if (!eventDateIso || !eventEndDateIso) return 1;
  const days = utcDay(eventEndDateIso) - utcDay(eventDateIso);
  return days > 0 ? days + 1 : 1;
}

function addDays(dateValue: string, days: number): string {
  return new Date(utcDay(dateValue) * DAY_MS + days * DAY_MS).toISOString().slice(0, 10);
}

/// Výchozí závoz a svoz (hodnoty datetime-local) podle data akce od-do: závoz v den "od" v 8:00,
/// svoz den po "do" (nebo po "od", když "do" chybí) v 8:00. Bez data "od" null.
/// Když už jsou časy vyplněné (current), zachová se jejich HH:mm a mění se jen kalendární den.
export function defaultDeliveryPickup(
  fromDate: string,
  toDate: string,
  current?: { delivery: string; pickup: string }
): { delivery: string; pickup: string } | null {
  if (!fromDate) return null;
  const last = toDate && toDate > fromDate ? toDate : fromDate;
  const timeOf = (value: string | undefined) => (value && /T\d{2}:\d{2}$/.test(value) ? value.slice(-5) : "08:00");
  return {
    delivery: `${fromDate}T${timeOf(current?.delivery)}`,
    pickup: `${addDays(last, 1)}T${timeOf(current?.pickup)}`
  };
}

/// Text pod poli data akce, jen pro vícedenní akci. Hodnoty jsou z inputů type="date" (YYYY-MM-DD).
export function multiDayLabel(fromDate: string, toDate: string): string | null {
  if (!fromDate || !toDate) return null;
  const n = eventDayCount(`${fromDate}T00:00:00Z`, `${toDate}T00:00:00Z`);
  if (n <= 1) return null;
  const word = n <= 4 ? "dny" : "dní";
  const range = `${eventDayDateLabel(`${fromDate}T00:00:00Z`, 1)} - ${eventDayDateLabel(`${fromDate}T00:00:00Z`, n)}`;
  return `Vícedenní akce: ${n} ${word} (${range})`;
}

/// Rozsah dat vícedenní akce do seznamu, např. "5. 10. - 7. 10.". Jednodenní akce null.
export function eventRangeLabel(eventDateIso: string | null | undefined, eventEndDateIso: string | null | undefined): string | null {
  const n = eventDayCount(eventDateIso, eventEndDateIso);
  if (n <= 1 || !eventDateIso) return null;
  return `${eventDayDateLabel(eventDateIso, 1)} - ${eventDayDateLabel(eventDateIso, n)}`;
}

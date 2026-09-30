// Dny vícedenní akce. Počet dnů určuje datum akce od-do (event_date a
// event_end_date, kalendářní data uložená jako půlnoc UTC). Stejná pravidla
// drží SQL funkce event_row_day_* z migrace 20260930150000_event_end_date.
// Hranice dnů uvnitř akce jsou půlnoci v Europe/Prague a počítá je SQL.

/// Rozsah řádku akce. dayTo === null znamená „do konce akce“.
export type DayRange = { dayFrom: number; dayTo: number | null };

export const WHOLE_EVENT: DayRange = { dayFrom: 1, dayTo: null };

const DAY_MS = 86_400_000;

function utcDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

/// Počet kalendářních dnů od data akce do konce akce včetně. Bez obou dat
/// nebo s koncem ne později než začátek je akce jednodenní.
export function eventDayCount(eventDate: Date | null, eventEndDate: Date | null): number {
  if (!eventDate || !eventEndDate) return 1;
  const days = utcDay(eventEndDate) - utcDay(eventDate);
  return days > 0 ? days + 1 : 1;
}

const pragueHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", hour12: false });

/// Půlnoc v Europe/Prague kalendářního dne zadaného jako UTC půlnoc, posunutá o dny.
function pragueMidnight(calendarDay: Date, plusDays: number): number {
  const utcMidnight = Date.UTC(calendarDay.getUTCFullYear(), calendarDay.getUTCMonth(), calendarDay.getUTCDate() + plusDays);
  // Praha je UTC+1 (zima) nebo UTC+2 (léto): půlnoc je o 1 nebo 2 hodiny před UTC půlnocí.
  for (const offsetHours of [1, 2]) {
    const candidate = utcMidnight - offsetHours * 3_600_000;
    if (Number(pragueHour.format(new Date(candidate))) % 24 === 0) return candidate;
  }
  return utcMidnight - 3_600_000;
}

export const EVENT_END_BEFORE_START_ERROR = "Konec akce musí být stejný nebo pozdější den než začátek.";
export const EVENT_DELIVERY_PICKUP_ERROR = "Závoz musí být nejpozději první den akce a svoz nejdříve poslední den akce.";

/// Ověří data akce proti závozu a svozu. Vrací český text chyby, nebo null.
/// U vícedenní akce musí závoz vyjít před koncem prvního dne a svoz po začátku
/// posledního dne, jinak by řádky pozdějších dnů měly obrácený interval a nic neblokovaly.
export function eventDatesError(input: {
  eventDate: Date | null;
  eventEndDate: Date | null;
  delivery: Date;
  pickup: Date;
}): string | null {
  const { eventDate, eventEndDate, delivery, pickup } = input;
  if (!eventEndDate) return null;
  if (!eventDate || eventEndDate.getTime() < eventDate.getTime()) return EVENT_END_BEFORE_START_ERROR;
  if (eventDayCount(eventDate, eventEndDate) <= 1) return null;
  if (delivery.getTime() >= pragueMidnight(eventDate, 1) || pickup.getTime() <= pragueMidnight(eventEndDate, 0)) {
    return EVENT_DELIVERY_PICKUP_ERROR;
  }
  return null;
}

/// Akce je v minulosti, až když skončil její poslední den. today je půlnoc dneška.
export function eventIsPast(eventDate: Date | null, eventEndDate: Date | null, today: Date): boolean {
  const lastDay = eventEndDate ?? eventDate;
  return !!lastDay && lastDay.getTime() < today.getTime();
}

/**
 * Ověří rozsah proti délce akce a sjednotí zápis: rozsah končící posledním
 * dnem se ukládá jako „do konce akce“ (null), aby se při prodloužení akce
 * prodloužil s ní a aby dva zápisy téhož rozsahu nevedly na dva řádky.
 */
export function normalizeDayRange(
  input: { dayFrom?: number; dayTo?: number | null },
  dayCount: number
): DayRange | null {
  const dayFrom = input.dayFrom ?? 1;
  const dayTo = input.dayTo ?? null;
  if (!Number.isInteger(dayFrom) || dayFrom < 1 || dayFrom > dayCount) return null;
  if (dayTo === null) return { dayFrom, dayTo: null };
  if (!Number.isInteger(dayTo) || dayTo < dayFrom || dayTo > dayCount) return null;
  return { dayFrom, dayTo: dayTo === dayCount ? null : dayTo };
}

export function dayRangeKey(range: DayRange): string {
  return `${range.dayFrom}-${range.dayTo ?? "end"}`;
}

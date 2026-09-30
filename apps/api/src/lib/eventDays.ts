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

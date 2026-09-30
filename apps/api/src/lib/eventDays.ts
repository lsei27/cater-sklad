// Dny vícedenní akce. Hranice dne je půlnoc v Praze: API běží na Renderu
// v UTC, takže kalendářní datum se musí brát napevno v Europe/Prague.
// Stejná pravidla drží SQL funkce event_day_* z migrace 20260930090000.

const PRAGUE = "Europe/Prague";

/// Rozsah řádku akce. dayTo === null znamená „do konce akce“.
export type DayRange = { dayFrom: number; dayTo: number | null };

export const WHOLE_EVENT: DayRange = { dayFrom: 1, dayTo: null };

const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRAGUE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function pragueDateAsUtcMs(d: Date): number {
  const [y, m, day] = ymd.format(d).split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

export function eventDayCount(delivery: Date, pickup: Date): number {
  return Math.round((pragueDateAsUtcMs(pickup) - pragueDateAsUtcMs(delivery)) / 86_400_000) + 1;
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

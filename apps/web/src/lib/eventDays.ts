// Dny vicedenni akce na webu. Stejne pravidla jako apps/api/src/lib/eventDays.ts:
// den 1 je datum zavozn v Praze, dayTo === null znamena "do konce akce".

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

const pragueYmd = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

/// Kalendární datum N-tého dne akce, např. "7. 10.".
export function eventDayDateLabel(deliveryIso: string, day: number): string {
  const [y, m, d] = pragueYmd.format(new Date(deliveryIso)).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + day - 1));
  return `${date.getUTCDate()}. ${date.getUTCMonth() + 1}.`;
}

// Formatovani datumu a casu do PDF. Musi byt napevno v Europe/Prague - API bezi
// na Renderu v UTC, takze getDate()/getHours() by tisklo o 1-2 h min.
const PRAGUE = "Europe/Prague";

const dateParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: PRAGUE,
  year: "numeric",
  month: "numeric",
  day: "numeric"
});

const timeParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: PRAGUE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function partsOf(formatter: Intl.DateTimeFormat, d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of formatter.formatToParts(d)) out[p.type] = p.value;
  return out;
}

export function formatCzechDate(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const p = partsOf(dateParts, new Date(isoString));
  return `${Number(p.day)}. ${Number(p.month)}. ${p.year}`;
}

export function formatCzechTime(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const p = partsOf(timeParts, new Date(isoString));
  return `${p.hour}:${p.minute}`;
}

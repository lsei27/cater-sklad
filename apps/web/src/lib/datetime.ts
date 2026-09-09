// Prevody mezi ISO okamzikem z API a hodnotou <input type="datetime-local">.
//
// Input pracuje s LOKALNIM nastennym casem, ale toISOString() vraci UTC. Kdyz
// se cetlo pres toISOString().slice(0, 16) a zpet zapisovalo pres
// new Date(hodnota).toISOString(), posunul se cas pri kazdem ulozeni o offset
// Prahy (v lete 2 h, v zime 1 h) a posuny se scitaly.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO okamzik -> "YYYY-MM-DDTHH:mm" v lokalnim case (hodnota pro datetime-local). */
export function toDatetimeLocalValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" v lokalnim case -> ISO okamzik. Prazdna/neplatna hodnota -> null. */
export function fromDatetimeLocalValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// event_date je kalendarni datum, ne okamzik. Drzi se konvence "UTC pulnoc"
// (to same, co znamena holy ISO retezec "2026-09-09"). Nemenit na lokalni
// pulnoc bez soucasne upravy kontroly EVENT_IN_PAST v apps/api/src/routes/
// events.ts - ta porovnava ulozeny okamzik s pulnoci v pasmu procesu (UTC).

/** ISO okamzik -> "YYYY-MM-DD" (hodnota pro input type="date"). */
export function toDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" -> ISO okamzik (UTC pulnoc). Prazdna/neplatna hodnota -> null. */
export function fromDateInputValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

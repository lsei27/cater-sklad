/**
 * Jedinečný rozlišovač pro názvy v testovacích datech.
 *
 * Samotné `Date.now()` nestačí: vitest pouští testovací soubory paralelně
 * a `warehouses.name` má v databázi unikátní index, takže dvě sady založené
 * ve stejné milisekundě se srazí a test spadne na cizí chybu.
 */
export function fixtureStamp() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

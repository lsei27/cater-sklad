import { describe, expect, it } from "vitest";
import { dayRangeKey, eventDayCount, normalizeDayRange } from "../src/lib/eventDays.js";

describe("eventDayCount", () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it("bez data akce nebo konce je akce jednodenní", () => {
    expect(eventDayCount(null, null)).toBe(1);
    expect(eventDayCount(d("2026-10-05"), null)).toBe(1);
    expect(eventDayCount(null, d("2026-10-07"))).toBe(1);
  });

  it("stejný den je jeden den", () => {
    expect(eventDayCount(d("2026-10-05"), d("2026-10-05"))).toBe(1);
  });

  it("počítá dny včetně obou krajních", () => {
    expect(eventDayCount(d("2026-10-05"), d("2026-10-07"))).toBe(3);
  });

  it("konec před začátkem je jednodenní akce", () => {
    expect(eventDayCount(d("2026-10-07"), d("2026-10-05"))).toBe(1);
  });

  it("přechod na zimní čas nerozbije počet dnů", () => {
    expect(eventDayCount(d("2026-10-24"), d("2026-10-26"))).toBe(3);
  });
});

describe("normalizeDayRange", () => {
  it("bez zadání je celá akce", () => {
    expect(normalizeDayRange({}, 3)).toEqual({ dayFrom: 1, dayTo: null });
  });

  it("rozsah do posledního dne se ukládá jako do konce akce", () => {
    expect(normalizeDayRange({ dayFrom: 2, dayTo: 3 }, 3)).toEqual({ dayFrom: 2, dayTo: null });
  });

  it("nechá rozsah uvnitř akce", () => {
    expect(normalizeDayRange({ dayFrom: 2, dayTo: 2 }, 3)).toEqual({ dayFrom: 2, dayTo: 2 });
  });

  it("odmítne den mimo akci a obrácený rozsah", () => {
    expect(normalizeDayRange({ dayFrom: 4 }, 3)).toBeNull();
    expect(normalizeDayRange({ dayFrom: 0 }, 3)).toBeNull();
    expect(normalizeDayRange({ dayFrom: 3, dayTo: 2 }, 3)).toBeNull();
    expect(normalizeDayRange({ dayFrom: 1, dayTo: 4 }, 3)).toBeNull();
  });
});

describe("dayRangeKey", () => {
  it("rozliší konec akce od konkrétního dne", () => {
    expect(dayRangeKey({ dayFrom: 1, dayTo: null })).toBe("1-end");
    expect(dayRangeKey({ dayFrom: 2, dayTo: 2 })).toBe("2-2");
  });
});

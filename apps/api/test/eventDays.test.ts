import { describe, expect, it } from "vitest";
import { dayRangeKey, eventDayCount, normalizeDayRange } from "../src/lib/eventDays.js";

describe("eventDayCount", () => {
  it("jednodenní akce má 1 den", () => {
    expect(eventDayCount(new Date("2026-10-05T06:00:00Z"), new Date("2026-10-05T20:00:00Z"))).toBe(1);
  });

  it("počítá kalendářní dny v Praze, ne v UTC", () => {
    // Závoz 5. 10. 18:00 Praha, svoz 6. 10. 00:30 Praha. V UTC je to pořád 5. 10.
    expect(eventDayCount(new Date("2026-10-05T16:00:00Z"), new Date("2026-10-05T22:30:00Z"))).toBe(2);
  });

  it("přechod na zimní čas nerozbije počet dnů", () => {
    expect(eventDayCount(new Date("2026-10-24T06:00:00Z"), new Date("2026-10-26T18:00:00Z"))).toBe(3);
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

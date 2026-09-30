import { describe, expect, it } from "vitest";
import { dayRangeKey, eventDatesError, eventDayCount, eventIsPast, normalizeDayRange } from "../src/lib/eventDays.js";

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

describe("eventDatesError", () => {
  const d = (iso: string) => new Date(iso);
  const base = {
    eventDate: d("2026-10-05T00:00:00Z"),
    eventEndDate: d("2026-10-07T00:00:00Z"),
    delivery: d("2026-10-04T16:00:00Z"),
    pickup: d("2026-10-08T06:00:00Z")
  };

  it("konec před začátkem je chyba", () => {
    expect(eventDatesError({ ...base, eventEndDate: d("2026-10-04T00:00:00Z") })).toMatch(/Konec akce/);
  });

  it("konec bez začátku je chyba", () => {
    expect(eventDatesError({ ...base, eventDate: null })).toMatch(/Konec akce/);
  });

  it("bez konce je v pořádku cokoli", () => {
    expect(eventDatesError({ ...base, eventEndDate: null, pickup: d("2026-10-06T06:00:00Z") })).toBeNull();
  });

  it("jednodenní akce se svozem druhý den ráno je v pořádku", () => {
    expect(
      eventDatesError({ ...base, eventEndDate: d("2026-10-05T00:00:00Z"), delivery: d("2026-10-05T06:00:00Z"), pickup: d("2026-10-06T06:00:00Z") })
    ).toBeNull();
  });

  it("vícedenní akce se svozem před posledním dnem je chyba", () => {
    // 6. 10. 18:00 Praha, poslední den začíná 7. 10. 0:00.
    expect(eventDatesError({ ...base, pickup: d("2026-10-06T16:00:00Z") })).toMatch(/Závoz musí/);
  });

  it("vícedenní akce se závozem po konci prvního dne je chyba", () => {
    expect(eventDatesError({ ...base, delivery: d("2026-10-05T22:30:00Z") })).toMatch(/Závoz musí/);
  });

  it("platná vícedenní akce projde", () => {
    expect(eventDatesError(base)).toBeNull();
    expect(eventDatesError({ ...base, delivery: d("2026-10-05T06:00:00Z"), pickup: d("2026-10-07T18:00:00Z") })).toBeNull();
  });

  it("hranice dnů přes změnu času (24.-26. 10. 2026)", () => {
    const dst = { eventDate: d("2026-10-24T00:00:00Z"), eventEndDate: d("2026-10-26T00:00:00Z") };
    // Konec prvního dne 25. 10. 0:00 letního času = 24. 10. 22:00Z.
    expect(eventDatesError({ ...dst, delivery: d("2026-10-24T21:59:00Z"), pickup: d("2026-10-26T18:00:00Z") })).toBeNull();
    expect(eventDatesError({ ...dst, delivery: d("2026-10-24T22:00:00Z"), pickup: d("2026-10-26T18:00:00Z") })).not.toBeNull();
    // Začátek posledního dne 26. 10. 0:00 zimního času = 25. 10. 23:00Z.
    expect(eventDatesError({ ...dst, delivery: d("2026-10-24T06:00:00Z"), pickup: d("2026-10-25T23:01:00Z") })).toBeNull();
    expect(eventDatesError({ ...dst, delivery: d("2026-10-24T06:00:00Z"), pickup: d("2026-10-25T23:00:00Z") })).not.toBeNull();
  });
});

describe("eventIsPast", () => {
  const today = new Date("2026-10-06T00:00:00Z");
  it("probíhající vícedenní akce (začátek v minulosti, konec dnes) není v minulosti", () => {
    expect(eventIsPast(new Date("2026-10-04T00:00:00Z"), new Date("2026-10-06T00:00:00Z"), today)).toBe(false);
  });
  it("skončená akce je v minulosti", () => {
    expect(eventIsPast(new Date("2026-10-04T00:00:00Z"), new Date("2026-10-05T00:00:00Z"), today)).toBe(true);
    expect(eventIsPast(new Date("2026-10-05T00:00:00Z"), null, today)).toBe(true);
  });
  it("akce bez data není v minulosti", () => {
    expect(eventIsPast(null, null, today)).toBe(false);
  });
});

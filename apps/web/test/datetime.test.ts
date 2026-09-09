import { describe, expect, it } from "vitest";
import {
  fromDateInputValue,
  fromDatetimeLocalValue,
  toDateInputValue,
  toDatetimeLocalValue
} from "../src/lib/datetime";

// Testy predpokladaji TZ=Europe/Prague (viz "test" skript v package.json),
// aby se offset choval jako u uzivatelu.
describe("datetime-local helpery", () => {
  it("zobrazi ulozeny okamzik v lokalnim case (leto, +2)", () => {
    expect(toDatetimeLocalValue("2026-07-15T12:00:00.000Z")).toBe("2026-07-15T14:00");
  });

  it("zobrazi ulozeny okamzik v lokalnim case (zima, +1)", () => {
    expect(toDatetimeLocalValue("2026-01-15T12:00:00.000Z")).toBe("2026-01-15T13:00");
  });

  it("zapise hodnotu z inputu jako lokalni cas", () => {
    expect(fromDatetimeLocalValue("2026-07-15T14:00")).toBe("2026-07-15T12:00:00.000Z");
  });

  it("necha cas beze zmeny i po opakovanem ulozeni (zadny drift)", () => {
    let value = "2026-07-15T14:00";
    for (let i = 0; i < 5; i++) {
      value = toDatetimeLocalValue(fromDatetimeLocalValue(value));
    }
    expect(value).toBe("2026-07-15T14:00");
  });

  it("nepreskoci den u casu tesne po pulnoci", () => {
    const iso = fromDatetimeLocalValue("2026-07-15T00:30");
    expect(iso).toBe("2026-07-14T22:30:00.000Z");
    expect(toDatetimeLocalValue(iso)).toBe("2026-07-15T00:30");
  });

  it("vraci prazdno / null pro chybejici a neplatne hodnoty", () => {
    expect(toDatetimeLocalValue(null)).toBe("");
    expect(toDatetimeLocalValue("")).toBe("");
    expect(toDatetimeLocalValue("nesmysl")).toBe("");
    expect(fromDatetimeLocalValue(null)).toBeNull();
    expect(fromDatetimeLocalValue("")).toBeNull();
    expect(fromDatetimeLocalValue("nesmysl")).toBeNull();
  });
});

describe("date helpery (event_date, konvence UTC pulnoc)", () => {
  it("round-trip nemeni datum ani po opakovanem ulozeni", () => {
    let value = "2026-09-09";
    for (let i = 0; i < 5; i++) {
      value = toDateInputValue(fromDateInputValue(value));
    }
    expect(value).toBe("2026-09-09");
  });

  it("zapisuje UTC pulnoc, na ktere stoji kontrola EVENT_IN_PAST", () => {
    expect(fromDateInputValue("2026-09-09")).toBe("2026-09-09T00:00:00.000Z");
  });

  it("vraci prazdno / null pro chybejici a neplatne hodnoty", () => {
    expect(toDateInputValue(null)).toBe("");
    expect(toDateInputValue("nesmysl")).toBe("");
    expect(fromDateInputValue(null)).toBeNull();
    expect(fromDateInputValue("nesmysl")).toBeNull();
  });
});

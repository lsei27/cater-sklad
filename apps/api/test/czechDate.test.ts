import { describe, expect, it } from "vitest";
import { formatCzechDate, formatCzechTime } from "../src/lib/czechDate.js";

// Formatovani do PDF musi byt vzdy v Europe/Prague, nezavisle na pasmu procesu.
// API bezi na Renderu v UTC, lokalne na Macu v Europe/Prague - bez pevneho
// pasma se bug projevi jen na produkci.
describe("formatCzechDate / formatCzechTime", () => {
  it("formatuje letni cas (CEST, +2) v pasmu Prahy", () => {
    const iso = "2026-07-15T06:30:00.000Z";
    expect(formatCzechDate(iso)).toBe("15. 7. 2026");
    expect(formatCzechTime(iso)).toBe("08:30");
  });

  it("formatuje zimni cas (CET, +1) v pasmu Prahy", () => {
    const iso = "2026-01-15T06:30:00.000Z";
    expect(formatCzechDate(iso)).toBe("15. 1. 2026");
    expect(formatCzechTime(iso)).toBe("07:30");
  });

  it("prepne na dalsi den u casu pred pulnoci UTC", () => {
    const iso = "2026-07-15T23:00:00.000Z";
    expect(formatCzechDate(iso)).toBe("16. 7. 2026");
    expect(formatCzechTime(iso)).toBe("01:00");
  });

  it("pulnoc v Praze zustava na spravnem dni", () => {
    const iso = "2026-07-14T22:00:00.000Z";
    expect(formatCzechDate(iso)).toBe("15. 7. 2026");
    expect(formatCzechTime(iso)).toBe("00:00");
  });

  it("vraci prazdny retezec pro null a undefined", () => {
    expect(formatCzechDate(null)).toBe("");
    expect(formatCzechDate(undefined)).toBe("");
    expect(formatCzechTime(null)).toBe("");
    expect(formatCzechTime(undefined)).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { dayRangeLabel, eventDayCount, eventDayDateLabel, reservationRowKey, sameDayRange } from "../src/lib/eventDays";

describe("dny akce na webu", () => {
  it("popisek rozsahu", () => {
    expect(dayRangeLabel({ dayFrom: 1, dayTo: null }, 3)).toBe("Celá akce");
    expect(dayRangeLabel({ dayFrom: 2, dayTo: 2 }, 3)).toBe("Den 2");
    expect(dayRangeLabel({ dayFrom: 2, dayTo: null }, 3)).toBe("Dny 2-3");
    expect(dayRangeLabel({ dayFrom: 1, dayTo: 2 }, 3)).toBe("Dny 1-2");
  });

  it("datum dne se bere v Praze", () => {
    // 5. 10. 2026 22:30 UTC je v Praze už 6. 10.
    expect(eventDayDateLabel("2026-10-05T22:30:00Z", 1)).toBe("6. 10.");
    expect(eventDayDateLabel("2026-10-05T22:30:00Z", 2)).toBe("7. 10.");
    expect(eventDayDateLabel("2026-10-31T08:00:00Z", 2)).toBe("1. 11.");
  });

  it("klíč řádku rozliší rozsahy jedné položky", () => {
    expect(reservationRowKey({ inventoryItemId: "a" })).toBe("a|1-end");
    expect(reservationRowKey({ inventoryItemId: "a", dayFrom: 2, dayTo: 2 })).toBe("a|2-2");
  });

  it("porovnání rozsahů", () => {
    expect(sameDayRange({ dayFrom: 1, dayTo: null }, { dayFrom: 1, dayTo: null })).toBe(true);
    expect(sameDayRange({ dayFrom: 1, dayTo: 1 }, { dayFrom: 1, dayTo: null })).toBe(false);
  });

  it("počet dnů akce se počítá z pražských kalendářních dat", () => {
    expect(eventDayCount("2026-10-05T07:00:00Z", "2026-10-05T17:00:00Z")).toBe(1);
    expect(eventDayCount("2026-10-05T07:00:00Z", "2026-10-07T17:00:00Z")).toBe(3);
    // 23:30 UTC je v Praze už další den, svoz o půlnoc UTC je ještě týž den.
    expect(eventDayCount("2026-10-05T22:30:00Z", "2026-10-06T10:00:00Z")).toBe(1);
    expect(eventDayCount("2026-10-05T10:00:00Z", "2026-10-05T22:30:00Z")).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  dayRangeLabel,
  defaultDeliveryPickup,
  eventDayCount,
  eventDayDateLabel,
  eventRangeLabel,
  multiDayLabel,
  reservationRowKey,
  sameDayRange
} from "../src/lib/eventDays";

describe("dny akce na webu", () => {
  it("popisek rozsahu", () => {
    expect(dayRangeLabel({ dayFrom: 1, dayTo: null }, 3)).toBe("Celá akce");
    expect(dayRangeLabel({ dayFrom: 2, dayTo: 2 }, 3)).toBe("Den 2");
    expect(dayRangeLabel({ dayFrom: 2, dayTo: null }, 3)).toBe("Dny 2-3");
    expect(dayRangeLabel({ dayFrom: 1, dayTo: 2 }, 3)).toBe("Dny 1-2");
  });

  it("datum dne se bere z data akce (UTC půlnoc)", () => {
    expect(eventDayDateLabel("2026-10-05T00:00:00Z", 1)).toBe("5. 10.");
    expect(eventDayDateLabel("2026-10-05T00:00:00Z", 3)).toBe("7. 10.");
    expect(eventDayDateLabel("2026-10-31T00:00:00Z", 2)).toBe("1. 11.");
  });

  it("klíč řádku rozliší rozsahy jedné položky", () => {
    expect(reservationRowKey({ inventoryItemId: "a" })).toBe("a|1-end");
    expect(reservationRowKey({ inventoryItemId: "a", dayFrom: 2, dayTo: 2 })).toBe("a|2-2");
  });

  it("porovnání rozsahů", () => {
    expect(sameDayRange({ dayFrom: 1, dayTo: null }, { dayFrom: 1, dayTo: null })).toBe(true);
    expect(sameDayRange({ dayFrom: 1, dayTo: 1 }, { dayFrom: 1, dayTo: null })).toBe(false);
  });

  it("počet dnů akce se počítá z data od-do", () => {
    expect(eventDayCount(null, null)).toBe(1);
    expect(eventDayCount("2026-10-05T00:00:00Z", null)).toBe(1);
    expect(eventDayCount(undefined, "2026-10-07T00:00:00Z")).toBe(1);
    expect(eventDayCount("2026-10-05T00:00:00Z", "2026-10-05T00:00:00Z")).toBe(1);
    expect(eventDayCount("2026-10-05T00:00:00Z", "2026-10-07T00:00:00Z")).toBe(3);
    expect(eventDayCount("2026-10-07T00:00:00Z", "2026-10-05T00:00:00Z")).toBe(1);
  });

  it("závoz a svoz se předvyplní podle data od-do", () => {
    expect(defaultDeliveryPickup("2026-10-05", "2026-10-07")).toEqual({
      delivery: "2026-10-05T08:00",
      pickup: "2026-10-08T08:00"
    });
    expect(defaultDeliveryPickup("2026-10-05", "")).toEqual({ delivery: "2026-10-05T08:00", pickup: "2026-10-06T08:00" });
    expect(defaultDeliveryPickup("2026-10-31", "")).toEqual({ delivery: "2026-10-31T08:00", pickup: "2026-11-01T08:00" });
    expect(defaultDeliveryPickup("", "2026-10-07")).toBeNull();
  });

  it("rozsah do seznamu akcí jen u vícedenní akce", () => {
    expect(eventRangeLabel("2026-10-05T00:00:00Z", "2026-10-07T00:00:00Z")).toBe("5. 10. - 7. 10.");
    expect(eventRangeLabel("2026-10-05T00:00:00Z", null)).toBeNull();
    expect(eventRangeLabel(null, null)).toBeNull();
  });

  it("text o vícedenní akci jen pro víc než jeden den a se správným skloňováním", () => {
    expect(multiDayLabel("2026-10-05", "")).toBeNull();
    expect(multiDayLabel("2026-10-05", "2026-10-05")).toBeNull();
    expect(multiDayLabel("2026-10-05", "2026-10-04")).toBeNull();
    expect(multiDayLabel("2026-10-05", "2026-10-06")).toBe("Vícedenní akce: 2 dny (5. 10. - 6. 10.)");
    expect(multiDayLabel("2026-10-05", "2026-10-09")).toBe("Vícedenní akce: 5 dní (5. 10. - 9. 10.)");
  });
});

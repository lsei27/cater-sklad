import { describe, expect, it } from "vitest";
import { intervalsOverlap } from "../src/lib/overlap.js";

describe("intervalsOverlap", () => {
  it("treats [) end as non-overlapping", () => {
    const aStart = new Date("2025-01-01T10:00:00Z");
    const aEnd = new Date("2025-01-01T11:00:00Z");
    const bStart = new Date("2025-01-01T11:00:00Z");
    const bEnd = new Date("2025-01-01T12:00:00Z");
    expect(intervalsOverlap(aStart, aEnd, bStart, bEnd)).toBe(false);
  });

  it("overlaps when ranges intersect", () => {
    const aStart = new Date("2025-01-01T10:00:00Z");
    const aEnd = new Date("2025-01-01T11:00:00Z");
    const bStart = new Date("2025-01-01T10:30:00Z");
    const bEnd = new Date("2025-01-01T12:00:00Z");
    expect(intervalsOverlap(aStart, aEnd, bStart, bEnd)).toBe(true);
  });
});


import { describe, expect, it } from "vitest";
import { addDays, daysBetweenInclusive, eachDay, financialYear, isoDate, monthRange, toDateOnly, weekStart } from "./dates";

describe("dates", () => {
  it("normalises to UTC midnight", () => {
    expect(isoDate(toDateOnly("2026-09-17"))).toBe("2026-09-17");
    expect(toDateOnly(new Date("2026-09-17T23:59:59Z")).toISOString()).toBe("2026-09-17T00:00:00.000Z");
  });
  it("counts inclusive days and iterates", () => {
    expect(daysBetweenInclusive(toDateOnly("2026-01-30"), toDateOnly("2026-02-02"))).toBe(4);
    expect([...eachDay(toDateOnly("2026-02-27"), toDateOnly("2026-03-01"))].map(isoDate)).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(isoDate(addDays(toDateOnly("2026-12-31"), 1))).toBe("2027-01-01");
  });
  it("computes month ranges and week starts", () => {
    expect(monthRange(2026, 2).days).toBe(28);
    expect(monthRange(2028, 2).days).toBe(29);
    expect(isoDate(weekStart(toDateOnly("2026-09-17")))).toBe("2026-09-14"); // Thursday → Monday
    expect(isoDate(weekStart(toDateOnly("2026-09-14")))).toBe("2026-09-14");
    expect(isoDate(weekStart(toDateOnly("2026-09-13")))).toBe("2026-09-07"); // Sunday → previous Monday
  });
  it("labels Indian financial years", () => {
    expect(financialYear(toDateOnly("2026-03-31"))).toBe("2025-26");
    expect(financialYear(toDateOnly("2026-04-01"))).toBe("2026-27");
  });
});

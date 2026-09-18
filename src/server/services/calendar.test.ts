import { describe, expect, it } from "vitest";
import { countLeaveDays, countWorkingDays, dayKind, isHoliday, isWeekOff, isWorkingDay, yearsInRange, type CalendarContext } from "@/server/services/calendar";
import { toDateOnly } from "@/lib/dates";

const d = (s: string) => toDateOnly(s);

// January 2026: 1 Jan = Thursday. Sat/Sun off, 1 Jan mandatory holiday, 14 Jan optional, 26 Jan (Mon) mandatory.
const ctx: CalendarContext = {
  weeklyOffDays: [0, 6],
  holidays: new Map([
    ["2026-01-01", { name: "New Year", isOptional: false }],
    ["2026-01-14", { name: "Sankranti", isOptional: true }],
    ["2026-01-26", { name: "Republic Day", isOptional: false }],
  ]),
};

describe("calendar helpers", () => {
  it("detects weekly offs from the shift", () => {
    expect(isWeekOff(d("2026-01-03"), ctx)).toBe(true); // Saturday
    expect(isWeekOff(d("2026-01-04"), ctx)).toBe(true); // Sunday
    expect(isWeekOff(d("2026-01-05"), ctx)).toBe(false); // Monday
    expect(isWeekOff(d("2026-01-04"), { weeklyOffDays: [5] })).toBe(false);
  });

  it("treats only mandatory holidays as non-working", () => {
    expect(isHoliday(d("2026-01-01"), ctx)).toBe(true);
    expect(isHoliday(d("2026-01-14"), ctx)).toBe(false);
    expect(isWorkingDay(d("2026-01-14"), ctx)).toBe(true);
    expect(isWorkingDay(d("2026-01-26"), ctx)).toBe(false);
    expect(dayKind(d("2026-01-26"), ctx)).toBe("HOLIDAY");
    expect(dayKind(d("2026-01-03"), ctx)).toBe("WEEK_OFF");
    expect(dayKind(d("2026-01-05"), ctx)).toBe(null);
  });

  it("counts working days in January 2026", () => {
    // 31 days − 9 weekend days (3,4,10,11,17,18,24,25,31) − 2 mandatory holidays (1, 26) = 20
    expect(countWorkingDays(d("2026-01-01"), d("2026-01-31"), ctx)).toBe(20);
    expect(countWorkingDays(d("2026-01-03"), d("2026-01-04"), ctx)).toBe(0);
    expect(countWorkingDays(d("2026-01-05"), d("2026-01-09"), ctx)).toBe(5);
    expect(countWorkingDays(d("2026-01-09"), d("2026-01-05"), ctx)).toBe(0);
  });

  it("counts leave days with half-day trimming", () => {
    expect(countLeaveDays(d("2026-01-05"), d("2026-01-06"), ctx)).toBe(2);
    expect(countLeaveDays(d("2026-01-05"), d("2026-01-06"), ctx, { startHalf: true })).toBe(1.5);
    expect(countLeaveDays(d("2026-01-05"), d("2026-01-06"), ctx, { startHalf: true, endHalf: true })).toBe(1);
    expect(countLeaveDays(d("2026-01-05"), d("2026-01-05"), ctx, { startHalf: true })).toBe(0.5);
    // Range spanning a weekend and a holiday: Fri 23 → Tue 27 = Fri 23 + Tue 27 (Mon 26 is a holiday)
    expect(countLeaveDays(d("2026-01-23"), d("2026-01-27"), ctx)).toBe(2);
    // Half flag on a non-working boundary day is ignored
    expect(countLeaveDays(d("2026-01-24"), d("2026-01-27"), ctx, { startHalf: true })).toBe(1);
    expect(countLeaveDays(d("2026-01-03"), d("2026-01-04"), ctx, { startHalf: true })).toBe(0);
  });

  it("lists years touched by a range", () => {
    expect(yearsInRange(d("2026-12-30"), d("2027-01-02"))).toEqual([2026, 2027]);
    expect(yearsInRange(d("2026-03-01"), d("2026-03-05"))).toEqual([2026]);
  });
});

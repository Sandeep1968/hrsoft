/**
 * Date helpers. All "date-only" values (attendance dates, leave dates,
 * joining dates) are stored as UTC midnight `Date` objects mapped to
 * Postgres DATE columns. Use these helpers instead of ad-hoc arithmetic.
 */

export function toDateOnly(input: Date | string): Date {
  const d = typeof input === "string" ? new Date(input.length === 10 ? `${input}T00:00:00.000Z` : input) : input;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export function daysBetweenInclusive(a: Date, b: Date): number {
  return Math.round((toDateOnly(b).getTime() - toDateOnly(a).getTime()) / 86_400_000) + 1;
}

export function* eachDay(from: Date, to: Date): Generator<Date> {
  for (let d = toDateOnly(from); d.getTime() <= toDateOnly(to).getTime(); d = addDays(d, 1)) yield d;
}

export function monthRange(year: number, month: number): { start: Date; end: Date; days: number } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start, end, days: end.getUTCDate() };
}

/** Monday of the week containing `d` (UTC). */
export function weekStart(d: Date, weekStartsOn = 1): Date {
  const day = toDateOnly(d);
  const diff = (day.getUTCDay() - weekStartsOn + 7) % 7;
  return addDays(day, -diff);
}

/** Indian financial year label for a date, e.g. "2026-27". */
export function financialYear(d = new Date(), startMonth = 4): string {
  const y = d.getUTCMonth() + 1 >= startMonth ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String(y + 1).slice(-2)}`;
}

export function todayUtc(): Date {
  return toDateOnly(new Date());
}

/** Convert "HH:MM" on a given date-only value to a UTC Date in the given IANA timezone offset (minutes). */
export function atTime(date: Date, hhmm: string, tzOffsetMinutes = 330): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(date.getTime() + ((h * 60 + m) - tzOffsetMinutes) * 60_000);
}

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

export const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

export const fmtMoney = (n: number | string | null | undefined, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(n ?? 0));

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

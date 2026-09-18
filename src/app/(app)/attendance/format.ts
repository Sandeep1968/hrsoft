/** Small formatting helpers shared by attendance/leave client components (no server imports). */

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

export const fmtMinutes = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

export const fmtShortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });

export const STATUS_LABEL: Record<string, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  HALF_DAY: "Half day",
  ON_LEAVE: "On leave",
  HOLIDAY: "Holiday",
  WEEK_OFF: "Week off",
  WFH: "WFH",
  NO_RECORD: "No record",
};

/** Calendar-cell tones per attendance status. */
export const STATUS_CELL: Record<string, string> = {
  PRESENT: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  WFH: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  HALF_DAY: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  ABSENT: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  ON_LEAVE: "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100",
  HOLIDAY: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-100",
  WEEK_OFF: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local wall-clock (IST) "YYYY-MM-DDTHH:MM" → ISO string in UTC. */
export function istLocalToIso(dateIso: string, hhmm: string) {
  return new Date(`${dateIso}T${hhmm}:00+05:30`).toISOString();
}

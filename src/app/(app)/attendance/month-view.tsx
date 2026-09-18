"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MONTHS } from "@/lib/dates";
import { apiFetch, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { fmtMinutes, fmtShortDate, fmtTime, istLocalToIso, STATUS_CELL, STATUS_LABEL, WEEKDAYS } from "./format";

export interface MonthDayDto {
  date: string;
  dow: number;
  status: string | null;
  isWorkingDay: boolean;
  holiday: { name: string; isOptional: boolean } | null;
  leave: { code: string; name: string; color: string; status: string; half: boolean } | null;
  firstIn: string | null;
  lastOut: string | null;
  workMinutes: number;
  lateMinutes: number;
  isRegularized: boolean;
  remarks: string | null;
  recordId: string | null;
  isFuture: boolean;
}

export interface MonthDto {
  employee: { id: string; displayName: string; employeeCode: string; photoUrl: string | null; joiningDate: string };
  year: number;
  month: number;
  days: MonthDayDto[];
  summary: Record<string, number> & { lateDays: number; workMinutes: number };
  workingDays: number;
}

const CHIPS: [string, string][] = [
  ["PRESENT", "Present"],
  ["WFH", "WFH"],
  ["HALF_DAY", "Half days"],
  ["ON_LEAVE", "On leave"],
  ["ABSENT", "Absent"],
  ["HOLIDAY", "Holidays"],
  ["WEEK_OFF", "Week offs"],
];

export function MonthView({ initial, today, readOnly = false, basePath = "/attendance" }: { initial: MonthDto; today: string; readOnly?: boolean; basePath?: string }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MonthDayDto | null>(null);
  const [wfhOpen, setWfhOpen] = useState(false);

  // Server re-rendered with a new month (e.g. back/forward navigation): adopt it.
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setData(initial);
  }

  async function go(delta: number) {
    let { year, month } = data;
    month += delta;
    if (month < 1) {
      month = 12;
      year--;
    } else if (month > 12) {
      month = 1;
      year++;
    }
    setLoading(true);
    try {
      const next = await apiFetch<MonthDto>(`/api/v1/attendance/month?employeeId=${data.employee.id}&year=${year}&month=${month}`);
      setData(next);
      router.replace(`${basePath}?year=${year}&month=${month}`, { scroll: false });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not load month");
    } finally {
      setLoading(false);
    }
  }

  const leading = data.days[0]?.dow ?? 0;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {CHIPS.map(([k, label]) => (
          <span key={k} className={cn("rounded-full px-2.5 py-1 text-xs font-medium", STATUS_CELL[k])}>
            {label} <span className="tabular-nums">{data.summary[k] ?? 0}</span>
          </span>
        ))}
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">Late {data.summary.lateDays}</span>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">Worked {fmtMinutes(data.summary.workMinutes)}</span>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">Working days {data.workingDays}</span>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            {MONTHS[data.month - 1]} {data.year}
          </CardTitle>
          <div className="flex items-center gap-1">
            {!readOnly && (
              <Button size="sm" variant="outline" onClick={() => setWfhOpen(true)}>
                <Home /> Request WFH
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" aria-label="Previous month" disabled={loading} onClick={() => go(-1)}>
              <ChevronLeft />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Next month" disabled={loading} onClick={() => go(1)}>
              <ChevronRight />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1">{w}</div>
            ))}
          </div>
          <div className={cn("grid grid-cols-7 gap-1", loading && "opacity-50")}>
            {Array.from({ length: leading }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {data.days.map((d) => {
              const tone = d.status ? STATUS_CELL[d.status] : "bg-background";
              const clickable = !d.isFuture;
              return (
                <button
                  key={d.date}
                  type="button"
                  disabled={!clickable}
                  onClick={() => setSelected(d)}
                  title={d.holiday?.name ?? (d.leave ? `${d.leave.name}${d.leave.status === "PENDING" ? " (pending)" : ""}` : undefined)}
                  className={cn(
                    "flex min-h-14 flex-col items-start justify-between rounded-md border p-1.5 text-left text-xs transition-colors sm:min-h-16",
                    tone,
                    d.isFuture && "opacity-50",
                    d.date === today && "ring-2 ring-primary",
                    clickable && "hover:ring-1 hover:ring-ring",
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <span className="font-semibold tabular-nums">{Number(d.date.slice(-2))}</span>
                    {d.isRegularized && <span className="text-[9px] uppercase">R</span>}
                    {d.lateMinutes > 0 && <span className="text-[9px] uppercase text-amber-700 dark:text-amber-300">L</span>}
                  </span>
                  <span className="hidden truncate text-[10px] sm:block">
                    {d.holiday ? d.holiday.name : d.leave && d.status !== "ON_LEAVE" ? `${d.leave.code}${d.leave.status === "PENDING" ? "?" : ""}` : d.firstIn ? `${fmtTime(d.firstIn)}–${d.lastOut ? fmtTime(d.lastOut) : "…"}` : d.status ? STATUS_LABEL[d.status] : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <DayDialog key={selected?.date ?? "none"} day={selected} onClose={() => setSelected(null)} readOnly={readOnly} />
      {!readOnly && <WfhDialog open={wfhOpen} onClose={() => setWfhOpen(false)} today={today} />}
    </div>
  );
}

const hhmmIst = (iso: string | null | undefined, fallback: string) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : fallback);

/** Keyed by `day.date` in the parent so state resets per day. */
function DayDialog({ day, onClose, readOnly }: { day: MonthDayDto | null; onClose: () => void; readOnly: boolean }) {
  const router = useRouter();
  const [inTime, setInTime] = useState(() => hhmmIst(day?.firstIn, "09:00"));
  const [outTime, setOutTime] = useState(() => hhmmIst(day?.lastOut, "18:00"));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"view" | "regularize">("view");

  async function submit() {
    if (!day) return;
    setBusy(true);
    try {
      await apiFetch("/api/v1/regularizations", { method: "POST", body: { date: day.date, requestedIn: istLocalToIso(day.date, inTime), requestedOut: istLocalToIso(day.date, outTime), reason } });
      toast.success("Regularisation request sent to your manager");
      onClose();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not submit request");
    } finally {
      setBusy(false);
    }
  }

  const canRegularize = !readOnly && day && !day.isFuture && day.isWorkingDay && day.status !== "ON_LEAVE" && day.status !== "WFH";

  return (
    <Dialog open={day !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {day && (
          <>
            <DialogHeader>
              <DialogTitle>{new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" })}</DialogTitle>
              <DialogDescription>
                {day.status ? STATUS_LABEL[day.status] : "No record"}
                {day.holiday ? ` · ${day.holiday.name}${day.holiday.isOptional ? " (optional)" : ""}` : ""}
                {day.leave ? ` · ${day.leave.name}${day.leave.half ? " (half day)" : ""}${day.leave.status === "PENDING" ? " — pending approval" : ""}` : ""}
              </DialogDescription>
            </DialogHeader>
            {mode === "view" ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">First in</div>
                  <div className="tabular-nums">{fmtTime(day.firstIn)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Last out</div>
                  <div className="tabular-nums">{fmtTime(day.lastOut)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Worked</div>
                  <div className="tabular-nums">{fmtMinutes(day.workMinutes)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Late by</div>
                  <div className="tabular-nums">{day.lateMinutes ? `${day.lateMinutes} min` : "—"}</div>
                </div>
                {day.remarks && (
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">Remarks</div>
                    <div>{day.remarks}</div>
                  </div>
                )}
                {day.isRegularized && <div className="col-span-2 text-xs text-muted-foreground">This day was regularised.</div>}
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="reg-in">In time (IST)</Label>
                    <Input id="reg-in" type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="reg-out">Out time (IST)</Label>
                    <Input id="reg-out" type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="reg-reason">Reason</Label>
                  <Textarea id="reg-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Forgot to punch, client visit, system issue…" maxLength={500} />
                </div>
              </div>
            )}
            <DialogFooter>
              {mode === "view" ? (
                <>
                  <Button variant="outline" onClick={onClose}>Close</Button>
                  {canRegularize && <Button onClick={() => setMode("regularize")}>Request regularisation</Button>}
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setMode("view")} disabled={busy}>Back</Button>
                  <Button onClick={submit} disabled={busy || reason.trim().length < 3}>{busy ? "Sending…" : "Submit request"}</Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WfhDialog({ open, onClose, today }: { open: boolean; onClose: () => void; today: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await apiFetch("/api/v1/remote-work-requests", { method: "POST", body: { fromDate: from, toDate: to, reason } });
      toast.success("Work-from-home request sent to your manager");
      setReason("");
      onClose();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not submit request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request work from home</DialogTitle>
          <DialogDescription>Approved days are marked WFH with a full day&apos;s credit.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="wfh-from">From</Label>
              <Input id="wfh-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wfh-to">To</Label>
              <Input id="wfh-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wfh-reason">Reason</Label>
            <Textarea id="wfh-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          <p className="text-xs text-muted-foreground">
            {from && to ? `${fmtShortDate(from)} → ${fmtShortDate(to)}` : ""}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || reason.trim().length < 3 || !from || !to}>{busy ? "Sending…" : "Submit"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

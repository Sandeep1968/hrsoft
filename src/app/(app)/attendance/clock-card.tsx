"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogIn, LogOut, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/common";
import { apiFetch, ApiError } from "@/lib/client/api";
import { fmtMinutes, fmtTime } from "./format";

export interface TodayDto {
  date: string;
  record: { status: string; firstIn: string | null; lastOut: string | null; workMinutes: number; lateMinutes: number; isRegularized: boolean } | null;
  punches: { id: string; time: string; type: "IN" | "OUT"; source: string }[];
  clockedIn: boolean;
  shift: { name: string; startTime: string; endTime: string; fullDayMinutes: number; halfDayMinutes: number; graceMinutes: number };
  serverTime: string;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function getPosition(): Promise<{ latitude: number; longitude: number } | undefined> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(undefined);
    const done = (v?: { latitude: number; longitude: number }) => resolve(v);
    navigator.geolocation.getCurrentPosition((p) => done({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => done(undefined), { timeout: 4000, maximumAge: 60_000 });
  });
}

export function ClockCard({ initial }: { initial: TodayDto }) {
  const router = useRouter();
  const [data, setData] = useState<TodayDto>(initial);
  const [busy, setBusy] = useState(false);
  const now = useClock();

  const refresh = useCallback(async () => {
    try {
      setData(await apiFetch<TodayDto>("/api/v1/attendance/today"));
    } catch {
      /* keep the last known state */
    }
  }, []);

  useEffect(() => {
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function punch(type: "IN" | "OUT") {
    setBusy(true);
    try {
      const pos = await getPosition();
      const res = await apiFetch<TodayDto>("/api/v1/attendance/punch", { method: "POST", body: { type, ...(pos ?? {}) } });
      setData(res);
      toast.success(type === "IN" ? "Clocked in" : "Clocked out");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not record punch");
    } finally {
      setBusy(false);
    }
  }

  // Live elapsed minutes while clocked in.
  const lastIn = data.clockedIn ? data.punches.filter((p) => p.type === "IN").at(-1) : null;
  const liveMinutes = (data.record?.workMinutes ?? 0) + (lastIn ? Math.max(0, Math.floor((now.getTime() - new Date(lastIn.time).getTime()) / 60_000)) : 0);
  const progress = Math.min(100, Math.round((liveMinutes / data.shift.fullDayMinutes) * 100));

  return (
    <Card>
      <CardContent className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {now.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", timeZone: "Asia/Kolkata" })}
          </div>
          <div className="mt-1 text-4xl font-semibold tabular-nums tracking-tight" suppressHydrationWarning>{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Kolkata" })}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>
              Shift <span className="font-medium text-foreground">{data.shift.name}</span> · {data.shift.startTime}–{data.shift.endTime}
            </span>
            {data.record && <StatusBadge status={data.record.status} />}
            {data.record?.lateMinutes ? <span className="text-amber-700 dark:text-amber-300">Late by {data.record.lateMinutes} min</span> : null}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">First in</div>
              <div className="font-medium tabular-nums">{fmtTime(data.record?.firstIn)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Last out</div>
              <div className="font-medium tabular-nums">{fmtTime(data.record?.lastOut)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Worked</div>
              <div className="font-medium tabular-nums">{fmtMinutes(liveMinutes)}</div>
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{progress}% of {fmtMinutes(data.shift.fullDayMinutes)} full day</div>
        </div>
        <div className="flex flex-col items-stretch gap-2 md:w-48">
          {data.clockedIn ? (
            <Button size="lg" variant="destructive" disabled={busy} onClick={() => punch("OUT")} className="h-12 text-base">
              <LogOut /> Clock out
            </Button>
          ) : (
            <Button size="lg" disabled={busy} onClick={() => punch("IN")} className="h-12 text-base">
              <LogIn /> Clock in
            </Button>
          )}
          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3" /> Location shared when available
          </div>
          {data.punches.length > 0 && (
            <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
              {data.punches.map((p) => (
                <li key={p.id} className="flex justify-between tabular-nums">
                  <span>{p.type === "IN" ? "In" : "Out"}</span>
                  <span>{fmtTime(p.time)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

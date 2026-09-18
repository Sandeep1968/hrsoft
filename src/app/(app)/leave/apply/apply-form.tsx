"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch, ApiError } from "@/lib/client/api";

interface TypeDto { id: string; name: string; code: string; color: string; allowHalfDay: boolean; isPaid: boolean; minNoticeDays: number; requiresDocAfterDays: number | null; maxConsecutiveDays: number | null }
interface BalanceDto { leaveTypeId: string; available: number }
interface Preview { days: number; workingDays: number; available: number | null; warnings: string[]; errors: string[] }

export function ApplyLeaveForm({ types, balances, today }: { types: TypeDto[]; balances: BalanceDto[]; today: string }) {
  const router = useRouter();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [startHalf, setStartHalf] = useState<"" | "FIRST_HALF" | "SECOND_HALF">("");
  const [endHalf, setEndHalf] = useState<"" | "FIRST_HALF" | "SECOND_HALF">("");
  const [reason, setReason] = useState("");
  const [attachmentKey, setAttachmentKey] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const type = useMemo(() => types.find((t) => t.id === typeId), [types, typeId]);
  const balance = balances.find((b) => b.leaveTypeId === typeId)?.available;
  const sameDay = start === end;

  useEffect(() => {
    if (!typeId || !start || !end) return;
    const q = new URLSearchParams({ leaveTypeId: typeId, startDate: start, endDate: end });
    if (startHalf) q.set("startHalf", startHalf);
    if (endHalf && !sameDay) q.set("endHalf", endHalf);
    const t = setTimeout(() => {
      apiFetch<Preview>(`/api/v1/leave/preview?${q.toString()}`).then(setPreview).catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [typeId, start, end, startHalf, endHalf, sameDay]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/api/v1/leave-requests", {
        method: "POST",
        body: { leaveTypeId: typeId, startDate: start, endDate: end, startHalf: startHalf || null, endHalf: !sameDay && endHalf ? endHalf : null, reason, attachmentKey: attachmentKey || undefined },
      });
      toast.success("Leave request sent for approval");
      router.push("/leave");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not apply");
    } finally {
      setBusy(false);
    }
  }

  const needsDoc = Boolean(type?.requiresDocAfterDays && preview && preview.days > type.requiresDocAfterDays);
  const blocked = !preview || preview.errors.length > 0 || reason.trim().length < 3 || (needsDoc && !attachmentKey.trim());

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="lt">Leave type</Label>
            <NativeSelect id="lt" value={typeId} onChange={(e) => { setTypeId(e.target.value); setStartHalf(""); setEndHalf(""); }}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.code}){balances.find((b) => b.leaveTypeId === t.id) ? ` · ${balances.find((b) => b.leaveTypeId === t.id)!.available} available` : ""}</option>
              ))}
            </NativeSelect>
            {type && (
              <p className="text-xs text-muted-foreground">
                {type.isPaid ? "Paid" : "Unpaid"}{type.minNoticeDays ? ` · ${type.minNoticeDays} days notice` : ""}{type.maxConsecutiveDays ? ` · max ${type.maxConsecutiveDays} consecutive days` : ""}{type.requiresDocAfterDays ? ` · document required beyond ${type.requiresDocAfterDays} days` : ""}{!type.allowHalfDay ? " · no half days" : ""}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="start">From</Label>
              <Input id="start" type="date" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} required />
              {type?.allowHalfDay && (
                <div className="flex items-center gap-2 text-sm">
                  <Switch checked={startHalf !== ""} onCheckedChange={(c) => setStartHalf(c ? "SECOND_HALF" : "")} size="sm" /> Half day
                  {startHalf && (
                    <NativeSelect value={startHalf} onChange={(e) => setStartHalf(e.target.value as "FIRST_HALF" | "SECOND_HALF")} className="w-32">
                      <option value="FIRST_HALF">First half</option>
                      <option value="SECOND_HALF">Second half</option>
                    </NativeSelect>
                  )}
                </div>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="end">To</Label>
              <Input id="end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
              {type?.allowHalfDay && !sameDay && (
                <div className="flex items-center gap-2 text-sm">
                  <Switch checked={endHalf !== ""} onCheckedChange={(c) => setEndHalf(c ? "FIRST_HALF" : "")} size="sm" /> Half day
                  {endHalf && (
                    <NativeSelect value={endHalf} onChange={(e) => setEndHalf(e.target.value as "FIRST_HALF" | "SECOND_HALF")} className="w-32">
                      <option value="FIRST_HALF">First half</option>
                      <option value="SECOND_HALF">Second half</option>
                    </NativeSelect>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={1000} placeholder="Shared with your approver" />
          </div>
          {(needsDoc || type?.requiresDocAfterDays) && (
            <div className="grid gap-1.5">
              <Label htmlFor="doc">Supporting document reference {needsDoc ? "(required)" : "(optional)"}</Label>
              <Input id="doc" value={attachmentKey} onChange={(e) => setAttachmentKey(e.target.value)} placeholder="Document key or link, e.g. documents/medical-cert.pdf" />
              <p className="text-xs text-muted-foreground">Upload the file under My Profile → Documents and paste its key here.</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.push("/leave")} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || blocked}>{busy ? "Submitting…" : "Submit request"}</Button>
          </div>
        </CardContent>
      </Card>
      <Card size="sm">
        <CardContent className="grid gap-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Days requested</div>
            <div className="text-3xl font-semibold tabular-nums">{preview ? preview.days : "—"}</div>
            {preview && <div className="text-xs text-muted-foreground">{preview.workingDays} working day{preview.workingDays === 1 ? "" : "s"} in range (week-offs and holidays skipped)</div>}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Balance</div>
            <div className="tabular-nums">{balance === undefined ? "No balance row" : balance}{preview && balance !== undefined ? ` → ${balance - preview.days}` : ""}</div>
          </div>
          {preview?.errors.map((m) => <div key={m} className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">{m}</div>)}
          {preview?.warnings.map((m) => <div key={m} className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{m}</div>)}
        </CardContent>
      </Card>
    </form>
  );
}

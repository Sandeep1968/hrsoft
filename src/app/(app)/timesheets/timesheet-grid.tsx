"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/common/native-select";
import { StatusBadge } from "@/components/common";
import { apiFetch, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export interface GridEntry { projectId: string; taskId: string | null; date: string; hours: number; note: string | null; isBillable: boolean }
export interface GridProject { id: string; code: string; name: string; isBillable: boolean; tasks: { id: string; name: string; isBillable: boolean }[] }
export interface GridSheet { id: string | null; weekStart: string; weekEnd: string; status: string; totalHours: number; submittedAt: string | null; approverName: string | null; decidedAt: string | null; decisionNote: string | null; entries: GridEntry[] }

interface Line { key: string; projectId: string; taskId: string | null; isBillable: boolean; hours: (number | "")[]; note: string }

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDaysIso(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtShort(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
}

function toLines(entries: GridEntry[], weekStart: string): Line[] {
  const map = new Map<string, Line>();
  for (const e of entries) {
    const key = `${e.projectId}:${e.taskId ?? ""}`;
    const line = map.get(key) ?? { key, projectId: e.projectId, taskId: e.taskId, isBillable: e.isBillable, hours: Array(7).fill("") as (number | "")[], note: e.note ?? "" };
    const idx = Math.round((new Date(`${e.date}T00:00:00.000Z`).getTime() - new Date(`${weekStart}T00:00:00.000Z`).getTime()) / 86_400_000);
    if (idx >= 0 && idx < 7) line.hours[idx] = (Number(line.hours[idx] || 0) + e.hours) || "";
    if (e.note && !line.note) line.note = e.note;
    map.set(key, line);
  }
  return [...map.values()];
}

export function TimesheetGrid({ sheet, projects, canEdit, employeeId }: { sheet: GridSheet; projects: GridProject[]; canEdit: boolean; employeeId?: string }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(() => toLines(sheet.entries, sheet.weekStart));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [newProject, setNewProject] = useState(projects[0]?.id ?? "");
  const [newTask, setNewTask] = useState("");
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysIso(sheet.weekStart, i)), [sheet.weekStart]);
  const today = new Date().toISOString().slice(0, 10);

  const dayTotals = days.map((_, i) => lines.reduce((a, l) => a + Number(l.hours[i] || 0), 0));
  const weekTotal = dayTotals.reduce((a, b) => a + b, 0);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  function addLine() {
    if (!newProject) return;
    const key = `${newProject}:${newTask}`;
    if (lines.some((l) => l.key === key)) return toast.error("That project/task line already exists");
    const p = projectById.get(newProject);
    const t = p?.tasks.find((x) => x.id === newTask);
    setLines([...lines, { key, projectId: newProject, taskId: newTask || null, isBillable: t ? t.isBillable : (p?.isBillable ?? true), hours: Array(7).fill("") as (number | "")[], note: "" }]);
    setDirty(true);
  }
  function setHours(li: number, di: number, v: string) {
    const n = v === "" ? "" : Math.max(0, Math.min(24, Number(v)));
    setLines(lines.map((l, i) => (i === li ? { ...l, hours: l.hours.map((h, j) => (j === di ? (Number.isNaN(n) ? "" : n) : h)) } : l)));
    setDirty(true);
  }
  function update(li: number, patch: Partial<Line>) {
    setLines(lines.map((l, i) => (i === li ? { ...l, ...patch } : l)));
    setDirty(true);
  }
  function removeLine(li: number) {
    setLines(lines.filter((_, i) => i !== li));
    setDirty(true);
  }

  function toEntries(): GridEntry[] {
    const out: GridEntry[] = [];
    for (const l of lines) l.hours.forEach((h, i) => { if (h !== "" && Number(h) > 0) out.push({ projectId: l.projectId, taskId: l.taskId, date: days[i], hours: Number(h), note: l.note || null, isBillable: l.isBillable }); });
    return out;
  }

  async function save(): Promise<boolean> {
    if (!sheet.id) return false;
    setBusy("save");
    try {
      await apiFetch(`/api/v1/timesheets/${sheet.id}`, { method: "PUT", body: { entries: toEntries() } });
      setDirty(false);
      toast.success("Draft saved");
      router.refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save");
      return false;
    } finally {
      setBusy(null);
    }
  }
  async function submit() {
    if (!sheet.id) return;
    if (weekTotal === 0) return toast.error("Log some hours before submitting");
    if (dirty && !(await save())) return;
    if (!confirm(`Submit ${weekTotal}h for the week of ${fmtShort(sheet.weekStart)}? You will not be able to edit it unless it is rejected.`)) return;
    setBusy("submit");
    try {
      await apiFetch(`/api/v1/timesheets/${sheet.id}/submit`, { method: "POST" });
      toast.success("Timesheet submitted");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not submit");
    } finally {
      setBusy(null);
    }
  }

  const overDay = dayTotals.some((t) => t > 24);
  const weekHref = (iso: string) => `/timesheets?weekStart=${iso}${employeeId ? `&employeeId=${employeeId}` : ""}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="outline" aria-label="Previous week" nativeButton={false} render={<Link href={weekHref(addDaysIso(sheet.weekStart, -7))} />}><ChevronLeft /></Button>
          <div className="px-2 text-sm font-medium tabular-nums">{fmtShort(sheet.weekStart)} – {fmtShort(sheet.weekEnd)}</div>
          <Button size="icon-sm" variant="outline" aria-label="Next week" nativeButton={false} render={<Link href={weekHref(addDaysIso(sheet.weekStart, 7))} />}><ChevronRight /></Button>
          <Button size="sm" variant="ghost" nativeButton={false} render={<Link href={weekHref(addDaysIso(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)))} />}>This week</Button>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={sheet.status} />
          <span className="text-sm tabular-nums text-muted-foreground">{weekTotal}h this week</span>
        </div>
      </div>

      {(sheet.status === "REJECTED" || sheet.status === "APPROVED" || sheet.status === "SUBMITTED") && (
        <div className={cn("mb-3 rounded-lg border px-3 py-2 text-sm", sheet.status === "REJECTED" ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100" : sheet.status === "APPROVED" ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100")}>
          {sheet.status === "SUBMITTED" && <>Submitted{sheet.approverName ? ` to ${sheet.approverName}` : ""} — waiting for approval.</>}
          {sheet.status === "APPROVED" && <>Approved{sheet.approverName ? ` by ${sheet.approverName}` : ""}.{sheet.decisionNote ? ` “${sheet.decisionNote}”` : ""}</>}
          {sheet.status === "REJECTED" && <>Rejected{sheet.approverName ? ` by ${sheet.approverName}` : ""}.{sheet.decisionNote ? ` Note: “${sheet.decisionNote}”` : ""} Edit and resubmit.</>}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="w-72 px-2 py-2 text-left font-medium">Project / task</th>
              {days.map((d, i) => (
                <th key={d} className={cn("px-1 py-2 text-center font-medium", (i >= 5) && "text-muted-foreground", d === today && "text-primary")}>
                  {DAY_LABELS[i]}<div className="font-normal text-muted-foreground">{fmtShort(d).slice(0, 6)}</div>
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Total</th>
              {canEdit && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">{canEdit ? "No lines yet — add a project below." : "No time logged this week."}</td></tr>
            )}
            {lines.map((l, li) => {
              const p = projectById.get(l.projectId);
              const t = p?.tasks.find((x) => x.id === l.taskId);
              const lineTotal = l.hours.reduce<number>((a, h) => a + Number(h || 0), 0);
              return (
                <tr key={l.key} className="border-t">
                  <td className="px-2 py-1.5 align-top">
                    <div className="font-medium">{p ? `${p.code} · ${p.name}` : "Project"}</div>
                    <div className="text-xs text-muted-foreground">{t?.name ?? (l.taskId ? "Task" : "No task")}</div>
                    {canEdit ? (
                      <div className="mt-1 flex items-center gap-2">
                        <label className="flex items-center gap-1 text-xs"><Checkbox checked={l.isBillable} onCheckedChange={(v) => update(li, { isBillable: Boolean(v) })} /> Billable</label>
                        <Input className="h-6 text-xs" placeholder="Note" value={l.note} onChange={(e) => update(li, { note: e.target.value })} maxLength={500} />
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">{l.isBillable ? "Billable" : "Non-billable"}{l.note ? ` · ${l.note}` : ""}</div>
                    )}
                  </td>
                  {l.hours.map((h, di) => (
                    <td key={di} className={cn("px-1 py-1.5 text-center align-top", di >= 5 && "bg-muted/30")}>
                      {canEdit ? (
                        <Input type="number" min={0} max={24} step={0.25} value={h} onChange={(e) => setHours(li, di, e.target.value)} className="h-8 w-16 px-1 text-center tabular-nums" aria-label={`${DAY_LABELS[di]} hours`} />
                      ) : (
                        <span className="tabular-nums">{h === "" ? "·" : h}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right align-top font-medium tabular-nums">{lineTotal}</td>
                  {canEdit && <td className="py-1.5 pr-1 align-top"><Button size="icon-xs" variant="ghost" aria-label="Remove line" onClick={() => removeLine(li)}><Trash2 /></Button></td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-muted/50 font-medium">
            <tr>
              <td className="px-2 py-2">Daily total</td>
              {dayTotals.map((t, i) => <td key={i} className={cn("px-1 py-2 text-center tabular-nums", t > 24 && "text-red-600")}>{t || "·"}</td>)}
              <td className="px-2 py-2 text-right tabular-nums">{weekTotal}</td>
              {canEdit && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {canEdit && (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs">
              Project
              <NativeSelect className="w-64" value={newProject} onChange={(e) => { setNewProject(e.target.value); setNewTask(""); }}>
                {projects.length === 0 && <option value="">No projects assigned</option>}
                {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
              </NativeSelect>
            </label>
            <label className="grid gap-1 text-xs">
              Task
              <NativeSelect className="w-48" value={newTask} onChange={(e) => setNewTask(e.target.value)}>
                <option value="">No task</option>
                {projectById.get(newProject)?.tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </NativeSelect>
            </label>
            <Button variant="outline" size="sm" onClick={addLine} disabled={!newProject}><Plus /> Add line</Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={save} disabled={busy !== null || !dirty || overDay}><Save /> {busy === "save" ? "Saving…" : "Save draft"}</Button>
            <Button onClick={submit} disabled={busy !== null || overDay || weekTotal === 0}><Send /> {busy === "submit" ? "Submitting…" : "Submit"}</Button>
          </div>
        </div>
      )}
      {overDay && <p className="mt-2 text-sm text-red-600">A day exceeds 24 hours — fix it before saving.</p>}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { StatusBadge } from "@/components/common";
import { apiFetch, ApiError } from "@/lib/client/api";
import { fmtDate } from "@/lib/dates";
import { DecideButtons } from "../../approvals/decide-dialog";
import { fmtMinutes, fmtTime, istLocalToIso, STATUS_LABEL, WEEKDAYS } from "../format";

export interface ShiftDto { id: string; name: string; startTime: string; endTime: string; breakMinutes: number; graceMinutes: number; fullDayMinutes: number; halfDayMinutes: number; weeklyOffDays: number[]; isDefault: boolean; isActive: boolean; employeeCount: number }
export interface CalendarDto { id: string; name: string; year: number; locationId: string | null; location: { id: string; name: string } | null; holidays: { id: string; date: string; name: string; isOptional: boolean }[] }
export interface QueueReg { id: string; date: string; requestedIn: string; requestedOut: string; reason: string; status: string; employee: { id: string; displayName: string; employeeCode: string; department: { name: string } | null } }
export interface QueueRemote { id: string; fromDate: string; toDate: string; reason: string; status: string; employee: { id: string; displayName: string; employeeCode: string; department: { name: string } | null } }
interface Opt { id: string; name: string }

export function AttendanceAdminTabs({ shifts, departments, locations, calendars, regularizations, remote, defaultTab }: { shifts: ShiftDto[]; departments: Opt[]; locations: Opt[]; calendars: CalendarDto[]; regularizations: QueueReg[]; remote: QueueRemote[]; defaultTab?: string }) {
  return (
    <Tabs defaultValue={defaultTab && ["shifts", "calendars", "queue", "corrections"].includes(defaultTab) ? defaultTab : "shifts"}>
      <TabsList>
        <TabsTrigger value="shifts">Shifts</TabsTrigger>
        <TabsTrigger value="calendars">Holiday calendars</TabsTrigger>
        <TabsTrigger value="queue">Queue{regularizations.length + remote.length > 0 ? ` (${regularizations.length + remote.length})` : ""}</TabsTrigger>
        <TabsTrigger value="corrections">Corrections</TabsTrigger>
      </TabsList>
      <TabsContent value="shifts"><ShiftsTab shifts={shifts} departments={departments} /></TabsContent>
      <TabsContent value="calendars"><CalendarsTab calendars={calendars} locations={locations} /></TabsContent>
      <TabsContent value="queue"><QueueTab regularizations={regularizations} remote={remote} /></TabsContent>
      <TabsContent value="corrections"><CorrectionsTab /></TabsContent>
    </Tabs>
  );
}

function err(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : "Something went wrong");
}

// ── Shifts ───────────────────────────────────────────────────────────────

const emptyShift = { name: "", startTime: "09:00", endTime: "18:00", breakMinutes: 60, graceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240, weeklyOffDays: [0, 6], isDefault: false, isActive: true };

function ShiftsTab({ shifts, departments }: { shifts: ShiftDto[]; departments: Opt[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<(typeof emptyShift & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [assign, setAssign] = useState({ shiftId: shifts[0]?.id ?? "", departmentId: departments[0]?.id ?? "", employeeCodes: "" });

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const { id, ...body } = editing;
      if (id) await apiFetch(`/api/v1/shifts/${id}`, { method: "PATCH", body });
      else await apiFetch("/api/v1/shifts", { method: "POST", body });
      toast.success("Shift saved");
      setEditing(null);
      router.refresh();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove(s: ShiftDto) {
    if (!confirm(`Delete shift "${s.name}"?${s.employeeCount ? ` It has ${s.employeeCount} employees and will be deactivated instead.` : ""}`)) return;
    try {
      const r = await apiFetch<{ deleted: boolean; deactivated: boolean }>(`/api/v1/shifts/${s.id}`, { method: "DELETE" });
      toast.success(r.deleted ? "Shift deleted" : "Shift deactivated");
      router.refresh();
    } catch (e) {
      err(e);
    }
  }
  async function bulkAssign() {
    setBusy(true);
    try {
      const codes = assign.employeeCodes.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean);
      const body = codes.length ? { shiftId: assign.shiftId, employeeCodes: codes } : { shiftId: assign.shiftId, departmentId: assign.departmentId };
      const r = await apiFetch<{ updated: number }>("/api/v1/shifts/assign", { method: "POST", body });
      toast.success(`Shift assigned to ${r.updated} employee(s)`);
      router.refresh();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Shifts</CardTitle>
          <Button size="sm" onClick={() => setEditing({ ...emptyShift })}><Plus /> New shift</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Grace</TableHead>
                <TableHead>Full / half day</TableHead>
                <TableHead>Week off</TableHead>
                <TableHead>Employees</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.map((s) => (
                <TableRow key={s.id} className={!s.isActive ? "opacity-50" : undefined}>
                  <TableCell className="font-medium">{s.name}{s.isDefault && <span className="ml-2 rounded bg-primary/10 px-1.5 text-[10px] uppercase text-primary">Default</span>}{!s.isActive && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}</TableCell>
                  <TableCell className="tabular-nums">{s.startTime}–{s.endTime} · {s.breakMinutes}m break</TableCell>
                  <TableCell>{s.graceMinutes}m</TableCell>
                  <TableCell>{fmtMinutes(s.fullDayMinutes)} / {fmtMinutes(s.halfDayMinutes)}</TableCell>
                  <TableCell>{s.weeklyOffDays.map((d) => WEEKDAYS[d]).join(", ") || "None"}</TableCell>
                  <TableCell className="tabular-nums">{s.employeeCount}</TableCell>
                  <TableCell className="text-right">
                    <Button size="xs" variant="ghost" onClick={() => setEditing({ ...s })}>Edit</Button>
                    <Button size="icon-xs" variant="ghost" aria-label="Delete" onClick={() => remove(s)}><Trash2 /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Bulk assign</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Shift</Label>
            <NativeSelect value={assign.shiftId} onChange={(e) => setAssign({ ...assign, shiftId: e.target.value })}>
              {shifts.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label>Department</Label>
            <NativeSelect value={assign.departmentId} onChange={(e) => setAssign({ ...assign, departmentId: e.target.value })}>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label>…or employee codes (overrides department)</Label>
            <Textarea value={assign.employeeCodes} onChange={(e) => setAssign({ ...assign, employeeCodes: e.target.value })} placeholder="EMP0001, EMP0002" />
          </div>
          <Button onClick={bulkAssign} disabled={busy || !assign.shiftId}>Assign shift</Button>
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <>
              <DialogHeader><DialogTitle>{editing.id ? "Edit shift" : "New shift"}</DialogTitle></DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5 sm:col-span-2"><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                <div className="grid gap-1.5"><Label>Start (IST)</Label><Input type="time" value={editing.startTime} onChange={(e) => setEditing({ ...editing, startTime: e.target.value })} /></div>
                <div className="grid gap-1.5"><Label>End (IST)</Label><Input type="time" value={editing.endTime} onChange={(e) => setEditing({ ...editing, endTime: e.target.value })} /></div>
                <div className="grid gap-1.5"><Label>Break minutes</Label><Input type="number" min={0} value={editing.breakMinutes} onChange={(e) => setEditing({ ...editing, breakMinutes: Number(e.target.value) })} /></div>
                <div className="grid gap-1.5"><Label>Grace minutes</Label><Input type="number" min={0} value={editing.graceMinutes} onChange={(e) => setEditing({ ...editing, graceMinutes: Number(e.target.value) })} /></div>
                <div className="grid gap-1.5"><Label>Full day minutes</Label><Input type="number" min={60} value={editing.fullDayMinutes} onChange={(e) => setEditing({ ...editing, fullDayMinutes: Number(e.target.value) })} /></div>
                <div className="grid gap-1.5"><Label>Half day minutes</Label><Input type="number" min={30} value={editing.halfDayMinutes} onChange={(e) => setEditing({ ...editing, halfDayMinutes: Number(e.target.value) })} /></div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Weekly off days</Label>
                  <div className="flex flex-wrap gap-3">
                    {WEEKDAYS.map((w, i) => (
                      <label key={w} className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={editing.weeklyOffDays.includes(i)} onCheckedChange={(c) => setEditing({ ...editing, weeklyOffDays: c ? [...editing.weeklyOffDays, i].sort() : editing.weeklyOffDays.filter((d) => d !== i) })} />
                        {w}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm"><Switch checked={editing.isDefault} onCheckedChange={(c) => setEditing({ ...editing, isDefault: c })} /> Default shift</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={editing.isActive} onCheckedChange={(c) => setEditing({ ...editing, isActive: c })} /> Active</label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
                <Button onClick={save} disabled={busy || !editing.name.trim()}>{busy ? "Saving…" : "Save"}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Holiday calendars ────────────────────────────────────────────────────

function CalendarsTab({ calendars, locations }: { calendars: CalendarDto[]; locations: Opt[] }) {
  const router = useRouter();
  const thisYear = new Date().getUTCFullYear();
  const [selectedId, setSelectedId] = useState(calendars[0]?.id ?? "");
  const selected = calendars.find((c) => c.id === selectedId) ?? calendars[0];
  const [newCal, setNewCal] = useState({ name: `India ${thisYear + 1}`, year: thisYear + 1, locationId: "" });
  const [newHol, setNewHol] = useState({ date: "", name: "", isOptional: false });
  const [busy, setBusy] = useState(false);

  async function createCalendar() {
    setBusy(true);
    try {
      const c = await apiFetch<{ id: string }>("/api/v1/holiday-calendars", { method: "POST", body: { name: newCal.name, year: newCal.year, locationId: newCal.locationId || null } });
      toast.success("Calendar created");
      setSelectedId(c.id);
      router.refresh();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  }
  async function addHoliday() {
    if (!selected) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/holiday-calendars/${selected.id}/holidays`, { method: "POST", body: { holidays: [newHol] } });
      setNewHol({ date: "", name: "", isOptional: false });
      toast.success("Holiday added");
      router.refresh();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  }
  async function removeHoliday(id: string) {
    try {
      await apiFetch(`/api/v1/holidays/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      err(e);
    }
  }
  async function clone() {
    if (!selected) return;
    const target = Number(prompt("Copy this calendar into which year?", String(selected.year + 1)));
    if (!target) return;
    try {
      const c = await apiFetch<{ id: string }>(`/api/v1/holiday-calendars/${selected.id}/clone`, { method: "POST", body: { targetYear: target } });
      toast.success(`Copied into ${target}`);
      setSelectedId(c.id);
      router.refresh();
    } catch (e) {
      err(e);
    }
  }
  async function removeCalendar() {
    if (!selected || !confirm(`Delete "${selected.name}" and all its holidays?`)) return;
    try {
      await apiFetch(`/api/v1/holiday-calendars/${selected.id}`, { method: "DELETE" });
      setSelectedId("");
      router.refresh();
    } catch (e) {
      err(e);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle>Calendars</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {calendars.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setSelectedId(c.id)} className={`flex w-full items-center justify-between py-2 text-left text-sm ${selected?.id === c.id ? "font-semibold" : ""}`}>
                    <span>{c.name}<span className="block text-xs text-muted-foreground">{c.location?.name ?? "All locations (fallback)"} · {c.year}</span></span>
                    <span className="text-xs text-muted-foreground">{c.holidays.length}</span>
                  </button>
                </li>
              ))}
              {calendars.length === 0 && <li className="py-2 text-sm text-muted-foreground">No calendars yet.</li>}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>New calendar</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5"><Label>Name</Label><Input value={newCal.name} onChange={(e) => setNewCal({ ...newCal, name: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label>Year</Label><Input type="number" value={newCal.year} onChange={(e) => setNewCal({ ...newCal, year: Number(e.target.value) })} /></div>
            <div className="grid gap-1.5">
              <Label>Location</Label>
              <NativeSelect value={newCal.locationId} onChange={(e) => setNewCal({ ...newCal, locationId: e.target.value })}>
                <option value="">All locations (fallback)</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </NativeSelect>
            </div>
            <Button onClick={createCalendar} disabled={busy || !newCal.name.trim()}>Create</Button>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{selected ? `${selected.name} · ${selected.location?.name ?? "All locations"}` : "Select a calendar"}</CardTitle>
          {selected && (
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={clone}><Copy /> Copy to next year</Button>
              <Button size="icon-sm" variant="ghost" aria-label="Delete calendar" onClick={removeCalendar}><Trash2 /></Button>
            </div>
          )}
        </CardHeader>
        {selected && (
          <CardContent className="grid gap-4">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Date</TableHead><TableHead>Holiday</TableHead><TableHead>Type</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {selected.holidays.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{fmtDate(h.date)}</TableCell>
                    <TableCell>{h.name}</TableCell>
                    <TableCell>{h.isOptional ? <span className="text-xs text-muted-foreground">Optional</span> : "Mandatory"}</TableCell>
                    <TableCell className="text-right"><Button size="icon-xs" variant="ghost" aria-label="Remove" onClick={() => removeHoliday(h.id)}><Trash2 /></Button></TableCell>
                  </TableRow>
                ))}
                {selected.holidays.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No holidays yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
            <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
              <div className="grid gap-1"><span className="text-xs text-muted-foreground">Date</span><Input type="date" value={newHol.date} onChange={(e) => setNewHol({ ...newHol, date: e.target.value })} className="w-40" /></div>
              <div className="grid flex-1 gap-1"><span className="text-xs text-muted-foreground">Name</span><Input value={newHol.name} onChange={(e) => setNewHol({ ...newHol, name: e.target.value })} /></div>
              <label className="flex items-center gap-1.5 pb-2 text-sm"><Checkbox checked={newHol.isOptional} onCheckedChange={(c) => setNewHol({ ...newHol, isOptional: Boolean(c) })} /> Optional</label>
              <Button onClick={addHoliday} disabled={busy || !newHol.date || !newHol.name.trim()}><Plus /> Add</Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

// ── Queue ────────────────────────────────────────────────────────────────

function QueueTab({ regularizations, remote }: { regularizations: QueueReg[]; remote: QueueRemote[] }) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader><CardTitle>Pending regularisations</CardTitle></CardHeader>
        <CardContent>
          {regularizations.length === 0 ? <p className="text-sm text-muted-foreground">Queue is empty.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Date</TableHead><TableHead>Requested</TableHead><TableHead>Reason</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {regularizations.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><span className="font-medium">{r.employee.displayName}</span><span className="block text-xs text-muted-foreground">{r.employee.employeeCode} · {r.employee.department?.name ?? "—"}</span></TableCell>
                    <TableCell>{fmtDate(r.date)}</TableCell>
                    <TableCell className="tabular-nums">{fmtTime(r.requestedIn)} – {fmtTime(r.requestedOut)}</TableCell>
                    <TableCell className="max-w-64 whitespace-normal">{r.reason}</TableCell>
                    <TableCell className="text-right"><DecideButtons size="xs" decideUrl={`/api/v1/regularizations/${r.id}/decide`} title={`${r.employee.displayName} · ${fmtDate(r.date)}`} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Pending work-from-home requests</CardTitle></CardHeader>
        <CardContent>
          {remote.length === 0 ? <p className="text-sm text-muted-foreground">Queue is empty.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Dates</TableHead><TableHead>Reason</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {remote.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><span className="font-medium">{r.employee.displayName}</span><span className="block text-xs text-muted-foreground">{r.employee.employeeCode} · {r.employee.department?.name ?? "—"}</span></TableCell>
                    <TableCell>{fmtDate(r.fromDate)}{r.fromDate !== r.toDate ? ` → ${fmtDate(r.toDate)}` : ""}</TableCell>
                    <TableCell className="max-w-64 whitespace-normal">{r.reason}</TableCell>
                    <TableCell className="text-right"><DecideButtons size="xs" decideUrl={`/api/v1/remote-work-requests/${r.id}/decide`} title={`${r.employee.displayName} · WFH`} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Corrections ──────────────────────────────────────────────────────────

interface RecordLookup { employee: { id: string; displayName: string; employeeCode: string }; date: string; record: { status: string; firstIn: string | null; lastOut: string | null; workMinutes: number; lateMinutes: number; remarks: string | null; isRegularized: boolean; punches: { id: string; time: string; type: string; source: string }[] } | null }

function CorrectionsTab() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  const [found, setFound] = useState<RecordLookup | null>(null);
  const [form, setForm] = useState({ status: "PRESENT", inTime: "", outTime: "", remarks: "" });
  const [busy, setBusy] = useState(false);

  async function lookup() {
    setBusy(true);
    try {
      const r = await apiFetch<RecordLookup>(`/api/v1/attendance/records?employeeCode=${encodeURIComponent(code.trim())}&date=${date}`);
      setFound(r);
      const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "");
      setForm({ status: r.record?.status ?? "PRESENT", inTime: t(r.record?.firstIn ?? null), outTime: t(r.record?.lastOut ?? null), remarks: r.record?.remarks ?? "" });
    } catch (e) {
      setFound(null);
      err(e);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!found) return;
    setBusy(true);
    try {
      await apiFetch("/api/v1/attendance/records", {
        method: "PATCH",
        body: {
          employeeId: found.employee.id,
          date: found.date,
          status: form.status,
          firstIn: form.inTime ? istLocalToIso(found.date, form.inTime) : null,
          lastOut: form.outTime ? istLocalToIso(found.date, form.outTime) : null,
          remarks: form.remarks || null,
          isRegularized: true,
        },
      });
      toast.success("Record saved");
      await lookup();
      router.refresh();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Correct an attendance record</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1"><span className="text-xs text-muted-foreground">Employee code or work email</span><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="EMP0001" className="w-56" onKeyDown={(e) => e.key === "Enter" && lookup()} /></div>
          <div className="grid gap-1"><span className="text-xs text-muted-foreground">Date</span><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" /></div>
          <Button onClick={lookup} disabled={busy || !code.trim() || !date}>Look up</Button>
        </div>
        {found && (
          <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <div className="font-medium">{found.employee.displayName} <span className="text-muted-foreground">· {found.employee.employeeCode}</span></div>
              <div className="text-sm text-muted-foreground">{fmtDate(found.date)} · {found.record ? <>Current: <StatusBadge status={found.record.status} /> {found.record.firstIn && `${fmtTime(found.record.firstIn)} – ${fmtTime(found.record.lastOut)}`} · {fmtMinutes(found.record.workMinutes)}</> : "No record for this day"}</div>
              {found.record && found.record.punches.length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">Punches: {found.record.punches.map((p) => `${p.type} ${fmtTime(p.time)} (${p.source.toLowerCase()})`).join(" · ")}</div>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <NativeSelect value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {Object.entries(STATUS_LABEL).filter(([k]) => k !== "NO_RECORD").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label>In (IST)</Label><Input type="time" value={form.inTime} onChange={(e) => setForm({ ...form, inTime: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label>Out (IST)</Label><Input type="time" value={form.outTime} onChange={(e) => setForm({ ...form, outTime: e.target.value })} /></div>
            </div>
            <div className="grid gap-1.5 md:col-span-2"><Label>Remarks</Label><Textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} placeholder="Why this record was corrected" /></div>
            <div className="md:col-span-2 flex justify-end"><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save correction"}</Button></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

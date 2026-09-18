"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/common/native-select";
import { DL, StatusBadge } from "@/components/common";
import { apiFetch } from "@/lib/client/api";
import { fmtDate, fmtMoney } from "@/lib/dates";
import { Field, EMPLOYMENT_OPTIONS } from "./field";
import { ManagerPicker } from "./manager-picker";
import type { EmployeeProfile } from "@/server/services/employees";
import type { OrgLookups } from "@/server/services/org";
import type { ExitRequestDto } from "@/server/services/exits";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function JobTab({ profile, lookups, canEdit, canExit, isSelf, myExit }: { profile: EmployeeProfile; lookups: OrgLookups; canEdit: boolean; canExit: boolean; isSelf: boolean; myExit: ExitRequestDto | null }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Job details</CardTitle>
          <div className="flex gap-2">
            {canEdit && <JobChangeDialog profile={profile} lookups={lookups} />}
            {isSelf && profile.status !== "EXITED" && <ResignDialog profile={profile} myExit={myExit} />}
            {canExit && profile.status !== "EXITED" && <ExitDialog profile={profile} />}
          </div>
        </CardHeader>
        <CardContent>
          <DL
            items={[
              { label: "Employee code", value: profile.employeeCode },
              { label: "Status", value: <StatusBadge status={profile.status} /> },
              { label: "Designation", value: profile.designation?.name },
              { label: "Department", value: profile.department?.name },
              { label: "Location", value: profile.location?.name },
              { label: "Legal entity", value: profile.legalEntity?.name },
              { label: "Reports to", value: profile.manager ? <Link className="hover:underline" href={`/employees/${profile.manager.id}`}>{profile.manager.displayName}</Link> : "—" },
              { label: "Direct reports", value: profile.reportCount > 0 ? <Link className="hover:underline" href={`/org-chart?root=${profile.id}`}>{profile.reportCount}</Link> : "0" },
              { label: "Joining date", value: fmtDate(profile.joiningDate) },
              { label: "Confirmation date", value: profile.confirmationDate ? fmtDate(profile.confirmationDate) : `Probation ${profile.probationMonths} months` },
              { label: "Employment type", value: profile.employmentType.replaceAll("_", " ") },
              { label: "Shift", value: profile.shift?.name },
              { label: "Notice period", value: `${profile.noticePeriodDays} days` },
              ...(profile.exitDate ? [{ label: "Exit date", value: `${fmtDate(profile.exitDate)}${profile.exitReason ? ` · ${profile.exitReason}` : ""}` }] : []),
            ]}
          />
          {myExit && (
            <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">Resignation <StatusBadge status={myExit.status} /></div>
              <div className="mt-1 text-muted-foreground">Submitted {fmtDate(myExit.resignationDate)} · proposed last working day {fmtDate(myExit.lastWorkingDay)}</div>
              {myExit.decisionNote && <div className="mt-1">Note: {myExit.decisionNote}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Job history</CardTitle></CardHeader>
        <CardContent>
          {profile.jobHistory.length === 0 && <p className="text-sm text-muted-foreground">No history yet.</p>}
          <ol className="relative ml-2 space-y-4 border-l pl-4">
            {profile.jobHistory.map((h) => (
              <li key={h.id} className="text-sm">
                <span className="absolute -left-[5px] mt-1.5 size-2 rounded-full bg-primary" />
                <div className="font-medium">{h.reason}</div>
                <div className="text-xs text-muted-foreground">{fmtDate(h.effectiveFrom)}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {[h.designation, h.department, h.manager ? `→ ${h.manager}` : null, h.employmentType?.replaceAll("_", " "), h.annualCtc ? `CTC ${fmtMoney(h.annualCtc)}` : null].filter(Boolean).join(" · ")}
                </div>
                {h.note && <div className="mt-0.5 text-xs">{h.note}</div>}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function JobChangeDialog({ profile, lookups }: { profile: EmployeeProfile; lookups: OrgLookups }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    departmentId: profile.departmentId ?? "",
    designationId: profile.designationId ?? "",
    locationId: profile.locationId ?? "",
    legalEntityId: profile.legalEntityId ?? "",
    shiftId: profile.shiftId ?? "",
    employmentType: profile.employmentType,
    manager: profile.manager ? { id: profile.manager.id, displayName: profile.manager.displayName } : null,
    joiningDate: profile.joiningDate,
    confirmationDate: profile.confirmationDate ?? "",
    probationMonths: String(profile.probationMonths),
    noticePeriodDays: String(profile.noticePeriodDays),
    status: profile.status,
    effectiveFrom: iso(new Date()),
    reason: "",
    note: "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      const cmp = (k: string, next: string | null, prev: string | null) => { if ((next || null) !== (prev || null)) patch[k] = next || null; };
      cmp("departmentId", f.departmentId, profile.departmentId);
      cmp("designationId", f.designationId, profile.designationId);
      cmp("locationId", f.locationId, profile.locationId);
      cmp("legalEntityId", f.legalEntityId, profile.legalEntityId);
      cmp("shiftId", f.shiftId, profile.shiftId);
      cmp("managerId", f.manager?.id ?? null, profile.managerId);
      if (f.employmentType !== profile.employmentType) patch.employmentType = f.employmentType;
      if (f.joiningDate !== profile.joiningDate) patch.joiningDate = f.joiningDate;
      cmp("confirmationDate", f.confirmationDate, profile.confirmationDate);
      if (Number(f.probationMonths) !== profile.probationMonths) patch.probationMonths = Number(f.probationMonths);
      if (Number(f.noticePeriodDays) !== profile.noticePeriodDays) patch.noticePeriodDays = Number(f.noticePeriodDays);
      if (f.status !== profile.status && (f.status === "ACTIVE" || f.status === "ONBOARDING")) patch.status = f.status;
      if (Object.keys(patch).length === 0) { toast.info("Nothing changed"); return; }
      patch.effectiveFrom = f.effectiveFrom;
      if (f.reason) patch.reason = f.reason;
      if (f.note) patch.note = f.note;
      await apiFetch(`/api/v1/employees/${profile.id}`, { method: "PATCH", body: patch });
      toast.success("Job details updated");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Change job details</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Change job details</DialogTitle>
            <DialogDescription>Changes to department, designation, manager, location or employment type are recorded in job history.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            <Field label="Department">
              <NativeSelect value={f.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
                <option value="">—</option>{lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Designation">
              <NativeSelect value={f.designationId} onChange={(e) => set("designationId", e.target.value)}>
                <option value="">—</option>{lookups.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Reports to" className="sm:col-span-2"><ManagerPicker value={f.manager} onChange={(v) => set("manager", v)} excludeId={profile.id} /></Field>
            <Field label="Location">
              <NativeSelect value={f.locationId} onChange={(e) => set("locationId", e.target.value)}>
                <option value="">—</option>{lookups.locations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Employment type">
              <NativeSelect value={f.employmentType} onChange={(e) => set("employmentType", e.target.value as typeof f.employmentType)}>
                {EMPLOYMENT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Legal entity">
              <NativeSelect value={f.legalEntityId} onChange={(e) => set("legalEntityId", e.target.value)}>
                <option value="">—</option>{lookups.legalEntities.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Shift">
              <NativeSelect value={f.shiftId} onChange={(e) => set("shiftId", e.target.value)}>
                <option value="">—</option>{lookups.shifts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Joining date"><Input type="date" value={f.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} /></Field>
            <Field label="Confirmation date"><Input type="date" value={f.confirmationDate} onChange={(e) => set("confirmationDate", e.target.value)} /></Field>
            <Field label="Probation (months)"><Input type="number" min={0} max={24} value={f.probationMonths} onChange={(e) => set("probationMonths", e.target.value)} /></Field>
            <Field label="Notice period (days)"><Input type="number" min={0} max={365} value={f.noticePeriodDays} onChange={(e) => set("noticePeriodDays", e.target.value)} /></Field>
            {(profile.status === "ONBOARDING" || profile.status === "ACTIVE") && (
              <Field label="Status">
                <NativeSelect value={f.status} onChange={(e) => set("status", e.target.value as typeof f.status)}>
                  <option value="ONBOARDING">Onboarding</option><option value="ACTIVE">Active</option>
                </NativeSelect>
              </Field>
            )}
            <Field label="Effective from" required><Input type="date" required value={f.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} /></Field>
            <Field label="Reason" className="sm:col-span-2"><Input placeholder="Promotion, transfer, re-org…" value={f.reason} onChange={(e) => set("reason", e.target.value)} /></Field>
            <Field label="Note" className="sm:col-span-2"><Textarea rows={2} value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResignDialog({ profile, myExit }: { profile: EmployeeProfile; myExit: ExitRequestDto | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = new Date();
  const [f, setF] = useState({ resignationDate: iso(today), lastWorkingDay: iso(new Date(today.getTime() + profile.noticePeriodDays * 86_400_000)), reason: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/api/v1/exit-requests", { method: "POST", body: f });
      toast.success("Resignation submitted");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit");
    } finally {
      setBusy(false);
    }
  }
  async function withdraw() {
    if (!myExit) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/exit-requests/${myExit.id}`, { method: "PATCH", body: { status: "CANCELLED" } });
      toast.success("Resignation withdrawn");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not withdraw");
    } finally {
      setBusy(false);
    }
  }

  if (myExit?.status === "PENDING") return <Button variant="outline" size="sm" disabled={busy} onClick={withdraw}>Withdraw resignation</Button>;
  if (myExit?.status === "APPROVED" || profile.status === "ON_NOTICE") return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>Resign</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Submit resignation</DialogTitle>
            <DialogDescription>Your notice period is {profile.noticePeriodDays} days. Your manager and HR will be notified.</DialogDescription>
          </DialogHeader>
          <Field label="Resignation date" required><Input type="date" required value={f.resignationDate} onChange={(e) => setF({ ...f, resignationDate: e.target.value })} /></Field>
          <Field label="Proposed last working day" required><Input type="date" required value={f.lastWorkingDay} onChange={(e) => setF({ ...f, lastWorkingDay: e.target.value })} /></Field>
          <Field label="Reason" required><Textarea rows={3} required minLength={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <DialogFooter showCloseButton>
            <Button type="submit" variant="destructive" disabled={busy}>{busy ? "Submitting…" : "Submit resignation"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExitDialog({ profile }: { profile: EmployeeProfile }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ exitDate: profile.exitDate ?? iso(new Date()), reason: profile.exitReason ?? "" });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/api/v1/employees/${profile.id}/exit`, { method: "POST", body: f });
      toast.success("Exit recorded");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record exit");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>Exit employee</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Exit {profile.displayName}</DialogTitle>
            <DialogDescription>An exit date today or earlier marks the employee as exited immediately, suspends their login and signs them out everywhere. A future date puts them on notice.</DialogDescription>
          </DialogHeader>
          <Field label="Exit date" required><Input type="date" required value={f.exitDate} onChange={(e) => setF({ ...f, exitDate: e.target.value })} /></Field>
          <Field label="Reason" required><Textarea rows={3} required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <DialogFooter showCloseButton>
            <Button type="submit" variant="destructive" disabled={busy}>{busy ? "Saving…" : "Confirm exit"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";
import { EMPLOYMENT_OPTIONS, Field, GENDER_OPTIONS } from "./field";
import { ManagerPicker } from "./manager-picker";
import type { OrgLookups } from "@/server/services/org";
import type { CreateEmployeeResult } from "@/server/services/employees";

const ROLE_OPTIONS = ["EMPLOYEE", "MANAGER", "HR_ADMIN", "PAYROLL_ADMIN", "FINANCE", "RECRUITER", "IT_ADMIN", "PROJECT_MANAGER"];

export function EmployeeForm({ lookups }: { lookups: OrgLookups }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreateEmployeeResult | null>(null);
  const [f, setF] = useState({
    firstName: "", middleName: "", lastName: "", workEmail: "", personalEmail: "", phone: "", dateOfBirth: "", gender: "UNDISCLOSED",
    joiningDate: new Date().toISOString().slice(0, 10), employmentType: "FULL_TIME",
    departmentId: "", designationId: "", locationId: "", legalEntityId: lookups.legalEntities.find((l) => l.isDefault)?.id ?? "", shiftId: lookups.shifts.find((s) => s.isDefault)?.id ?? "",
    manager: null as { id: string; displayName: string } | null,
    annualCtc: "", probationMonths: "6", noticePeriodDays: "60",
    createUser: true, roleKeys: ["EMPLOYEE"] as string[], sendInvite: true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await apiFetch<CreateEmployeeResult>("/api/v1/employees", {
        method: "POST",
        body: {
          firstName: f.firstName, lastName: f.lastName, middleName: f.middleName || null, workEmail: f.workEmail, personalEmail: f.personalEmail || null, phone: f.phone || null,
          dateOfBirth: f.dateOfBirth || undefined, gender: f.gender, joiningDate: f.joiningDate, employmentType: f.employmentType,
          departmentId: f.departmentId || null, designationId: f.designationId || null, locationId: f.locationId || null, legalEntityId: f.legalEntityId || null, shiftId: f.shiftId || null, managerId: f.manager?.id ?? null,
          annualCtc: f.annualCtc ? Number(f.annualCtc) : undefined, probationMonths: Number(f.probationMonths), noticePeriodDays: Number(f.noticePeriodDays),
          createUser: f.createUser, roleKeys: f.roleKeys, sendInvite: f.createUser && f.sendInvite,
        },
      });
      setResult(r);
      toast.success(`Created ${r.employeeCode}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create employee");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Alert>
        <AlertTitle>Employee {result.employeeCode} created</AlertTitle>
        <AlertDescription className="space-y-3">
          {result.tempPassword ? (
            <div>
              <p>Temporary password (shown once — share it securely; the employee must change it at first sign-in):</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 font-mono text-sm">{result.tempPassword}</code>
                <Button variant="outline" size="xs" onClick={() => { navigator.clipboard.writeText(result.tempPassword!); toast.success("Copied"); }}><Copy /> Copy</Button>
              </div>
            </div>
          ) : (
            <p>No login was created for this employee.</p>
          )}
          <div className="flex gap-2">
            <Button nativeButton={false} render={<Link href={`/employees/${result.id}`} />}>Open profile</Button>
            <Button variant="outline" onClick={() => { setResult(null); setF({ ...f, firstName: "", lastName: "", middleName: "", workEmail: "", personalEmail: "", phone: "", annualCtc: "" }); }}>Add another</Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Personal</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" required><Input required value={f.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
          <Field label="Last name" required><Input required value={f.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
          <Field label="Middle name"><Input value={f.middleName} onChange={(e) => set("middleName", e.target.value)} /></Field>
          <Field label="Gender">
            <NativeSelect value={f.gender} onChange={(e) => set("gender", e.target.value)}>{GENDER_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
          </Field>
          <Field label="Date of birth"><Input type="date" value={f.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91…" /></Field>
          <Field label="Work email" required><Input type="email" required value={f.workEmail} onChange={(e) => set("workEmail", e.target.value)} /></Field>
          <Field label="Personal email"><Input type="email" value={f.personalEmail} onChange={(e) => set("personalEmail", e.target.value)} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Job</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Joining date" required><Input type="date" required value={f.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} /></Field>
          <Field label="Employment type">
            <NativeSelect value={f.employmentType} onChange={(e) => set("employmentType", e.target.value)}>{EMPLOYMENT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
          </Field>
          <Field label="Department">
            <NativeSelect value={f.departmentId} onChange={(e) => set("departmentId", e.target.value)}><option value="">—</option>{lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Designation">
            <NativeSelect value={f.designationId} onChange={(e) => set("designationId", e.target.value)}><option value="">—</option>{lookups.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Location">
            <NativeSelect value={f.locationId} onChange={(e) => set("locationId", e.target.value)}><option value="">—</option>{lookups.locations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Legal entity">
            <NativeSelect value={f.legalEntityId} onChange={(e) => set("legalEntityId", e.target.value)}><option value="">Default</option>{lookups.legalEntities.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Shift">
            <NativeSelect value={f.shiftId} onChange={(e) => set("shiftId", e.target.value)}><option value="">Default</option>{lookups.shifts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect>
          </Field>
          <Field label="Reports to" className="sm:col-span-2"><ManagerPicker value={f.manager} onChange={(v) => set("manager", v)} /></Field>
          <Field label="Annual CTC (INR)" hint="Creates a salary from the default structure"><Input type="number" min={0} step={1000} value={f.annualCtc} onChange={(e) => set("annualCtc", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Probation (months)"><Input type="number" min={0} max={24} value={f.probationMonths} onChange={(e) => set("probationMonths", e.target.value)} /></Field>
            <Field label="Notice (days)"><Input type="number" min={0} max={365} value={f.noticePeriodDays} onChange={(e) => set("noticePeriodDays", e.target.value)} /></Field>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Account</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.createUser} onCheckedChange={(c) => set("createUser", Boolean(c))} /> Create login</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox disabled={!f.createUser} checked={f.sendInvite} onCheckedChange={(c) => set("sendInvite", Boolean(c))} /> Email temporary password</label>
          <Field label="Roles" hint="MANAGER is added automatically when someone reports to them">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {ROLE_OPTIONS.map((r) => (
                <label key={r} className="flex items-center gap-1.5 text-xs">
                  <Checkbox disabled={!f.createUser} checked={f.roleKeys.includes(r)} onCheckedChange={(c) => set("roleKeys", c ? [...f.roleKeys, r] : f.roleKeys.filter((x) => x !== r))} /> {r.replaceAll("_", " ")}
                </label>
              ))}
            </div>
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 lg:col-span-2">
        <Button variant="outline" nativeButton={false} render={<Link href="/employees" />}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create employee"}</Button>
      </div>
    </form>
  );
}

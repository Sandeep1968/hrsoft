"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";
import { Field, GENDER_OPTIONS } from "./field";
import type { Address, EmergencyContact, EmployeeProfile } from "@/server/services/employees";
import type { OrgLookups } from "@/server/services/org";

const emptyAddr: Address = { line1: "", line2: "", city: "", state: "", pincode: "", country: "IN" };

export function OverviewTab({ profile, lookups, canEditAll, canEditSelf }: { profile: EmployeeProfile; lookups: OrgLookups; canEditAll: boolean; canEditSelf: boolean }) {
  const router = useRouter();
  const editable = canEditAll || canEditSelf;
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    firstName: profile.firstName,
    middleName: profile.middleName ?? "",
    lastName: profile.lastName,
    workEmail: profile.workEmail,
    personalEmail: profile.personalEmail ?? "",
    phone: profile.phone ?? "",
    dateOfBirth: profile.dateOfBirth ?? "",
    gender: profile.gender,
    maritalStatus: profile.maritalStatus ?? "",
    bloodGroup: profile.bloodGroup ?? "",
    photoUrl: profile.photoUrl ?? "",
    currentAddress: { ...emptyAddr, ...(profile.currentAddress ?? {}) },
    permanentAddress: { ...emptyAddr, ...(profile.permanentAddress ?? {}) },
    emergencyContact: { name: "", relation: "", phone: "", ...(profile.emergencyContact ?? {}) } as EmergencyContact,
    customFields: { ...profile.customFields } as Record<string, unknown>,
  });
  const [same, setSame] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const setAddr = (which: "currentAddress" | "permanentAddress", k: keyof Address, v: string) => setF((s) => ({ ...s, [which]: { ...s[which], [k]: v } }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const selfPatch = {
        personalEmail: f.personalEmail,
        phone: f.phone,
        maritalStatus: f.maritalStatus,
        bloodGroup: f.bloodGroup,
        photoUrl: f.photoUrl,
        currentAddress: f.currentAddress,
        permanentAddress: same ? f.currentAddress : f.permanentAddress,
        emergencyContact: f.emergencyContact,
      };
      const patch = canEditAll ? { ...selfPatch, firstName: f.firstName, middleName: f.middleName, lastName: f.lastName, workEmail: f.workEmail, dateOfBirth: f.dateOfBirth, gender: f.gender, customFields: f.customFields } : selfPatch;
      await apiFetch(`/api/v1/employees/${profile.id}`, { method: "PATCH", body: patch });
      toast.success("Profile updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Personal</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" required><Input disabled={!canEditAll} value={f.firstName} onChange={(e) => set("firstName", e.target.value)} /></Field>
          <Field label="Middle name"><Input disabled={!canEditAll} value={f.middleName} onChange={(e) => set("middleName", e.target.value)} /></Field>
          <Field label="Last name" required><Input disabled={!canEditAll} value={f.lastName} onChange={(e) => set("lastName", e.target.value)} /></Field>
          <Field label="Date of birth"><Input type="date" disabled={!canEditAll} value={f.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} /></Field>
          <Field label="Gender">
            <NativeSelect disabled={!canEditAll} value={f.gender} onChange={(e) => set("gender", e.target.value as typeof f.gender)}>
              {GENDER_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Marital status">
            <NativeSelect disabled={!editable} value={f.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)}>
              <option value="">—</option>
              {["Single", "Married", "Divorced", "Widowed"].map((s) => <option key={s}>{s}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Blood group">
            <NativeSelect disabled={!editable} value={f.bloodGroup} onChange={(e) => set("bloodGroup", e.target.value)}>
              <option value="">—</option>
              {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((s) => <option key={s}>{s}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Photo URL" hint="Link to a profile picture"><Input disabled={!editable} value={f.photoUrl} onChange={(e) => set("photoUrl", e.target.value)} placeholder="https://…" /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Contact</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Work email" className="sm:col-span-2"><Input type="email" disabled={!canEditAll} value={f.workEmail} onChange={(e) => set("workEmail", e.target.value)} /></Field>
          <Field label="Personal email"><Input type="email" disabled={!editable} value={f.personalEmail} onChange={(e) => set("personalEmail", e.target.value)} /></Field>
          <Field label="Phone"><Input disabled={!editable} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91…" /></Field>
          <div className="sm:col-span-2 mt-2 text-sm font-medium">Emergency contact</div>
          <Field label="Name"><Input disabled={!editable} value={f.emergencyContact.name ?? ""} onChange={(e) => set("emergencyContact", { ...f.emergencyContact, name: e.target.value })} /></Field>
          <Field label="Relation"><Input disabled={!editable} value={f.emergencyContact.relation ?? ""} onChange={(e) => set("emergencyContact", { ...f.emergencyContact, relation: e.target.value })} /></Field>
          <Field label="Phone" className="sm:col-span-2"><Input disabled={!editable} value={f.emergencyContact.phone ?? ""} onChange={(e) => set("emergencyContact", { ...f.emergencyContact, phone: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Current address</CardTitle></CardHeader>
        <CardContent><AddressFields addr={f.currentAddress} editable={editable} onChange={(k, v) => setAddr("currentAddress", k, v)} /></CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Permanent address</CardTitle>
          {editable && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={same} onCheckedChange={(c) => setSame(Boolean(c))} /> Same as current
            </label>
          )}
        </CardHeader>
        <CardContent><AddressFields addr={f.permanentAddress} editable={editable && !same} onChange={(k, v) => setAddr("permanentAddress", k, v)} /></CardContent>
      </Card>

      {canEditAll && lookups.customFields.length > 0 && (
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Additional fields</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lookups.customFields.map((cf) => (
              <Field key={cf.id} label={cf.label} required={cf.required}>
                {cf.type === "SELECT" ? (
                  <NativeSelect value={String(f.customFields[cf.key] ?? "")} onChange={(e) => set("customFields", { ...f.customFields, [cf.key]: e.target.value })}>
                    <option value="">—</option>
                    {cf.options.map((o) => <option key={o}>{o}</option>)}
                  </NativeSelect>
                ) : cf.type === "BOOLEAN" ? (
                  <NativeSelect value={f.customFields[cf.key] === true ? "yes" : f.customFields[cf.key] === false ? "no" : ""} onChange={(e) => set("customFields", { ...f.customFields, [cf.key]: e.target.value === "" ? null : e.target.value === "yes" })}>
                    <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                  </NativeSelect>
                ) : (
                  <Input type={cf.type === "NUMBER" ? "number" : cf.type === "DATE" ? "date" : "text"} value={String(f.customFields[cf.key] ?? "")} onChange={(e) => set("customFields", { ...f.customFields, [cf.key]: cf.type === "NUMBER" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value })} />
                )}
              </Field>
            ))}
          </CardContent>
        </Card>
      )}

      {editable && (
        <div className="flex justify-end lg:col-span-2">
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      )}
    </form>
  );
}

function AddressFields({ addr, editable, onChange }: { addr: Address; editable: boolean; onChange: (k: keyof Address, v: string) => void }) {
  const fields: [keyof Address, string, string][] = [["line1", "Line 1", "sm:col-span-2"], ["line2", "Line 2", "sm:col-span-2"], ["city", "City", ""], ["state", "State", ""], ["pincode", "PIN code", ""], ["country", "Country", ""]];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map(([k, label, cls]) => (
        <Field key={k} label={label} className={cls}><Input disabled={!editable} value={addr[k] ?? ""} onChange={(e) => onChange(k, e.target.value)} /></Field>
      ))}
    </div>
  );
}

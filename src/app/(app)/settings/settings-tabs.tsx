"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";
import { Field } from "@/components/employees/field";
import { ManagerPicker } from "@/components/employees/manager-picker";
import type { getOrganization, LegalEntityDto } from "@/server/services/org";

type Org = Awaited<ReturnType<typeof getOrganization>>;
type Loc = { id: string; name: string; address: string | null; city: string | null; state: string | null; country: string; timezone: string; latitude: number | null; longitude: number | null; geoRadiusM: number | null; isActive: boolean; employeeCount: number };
type Dept = { id: string; name: string; code: string; parentId: string | null; headId: string | null; head: { id: string; displayName: string; employeeCode: string } | null; isActive: boolean; employeeCount: number; depth: number };
type Desig = { id: string; name: string; level: number; isActive: boolean; employeeCount: number };
type CField = { id: string; entity: string; key: string; label: string; type: string; options: string[]; required: boolean; order: number };

const TABS = ["organisation", "entities", "locations", "departments", "designations", "custom-fields"];

export function SettingsTabs(props: { readOnly: boolean; initialTab?: string; org: Org; entities: LegalEntityDto[]; locations: Loc[]; departments: Dept[]; designations: Desig[]; customFields: CField[] }) {
  const [tab, setTab] = useState(TABS.includes(props.initialTab ?? "") ? props.initialTab! : "organisation");
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
      <TabsList className="mb-4 flex-wrap">
        <TabsTrigger value="organisation">Organisation</TabsTrigger>
        <TabsTrigger value="entities">Legal entities</TabsTrigger>
        <TabsTrigger value="locations">Locations</TabsTrigger>
        <TabsTrigger value="departments">Departments</TabsTrigger>
        <TabsTrigger value="designations">Designations</TabsTrigger>
        <TabsTrigger value="custom-fields">Custom fields</TabsTrigger>
      </TabsList>
      <TabsContent value="organisation"><OrgForm org={props.org} readOnly={props.readOnly} /></TabsContent>
      <TabsContent value="entities"><Entities rows={props.entities} readOnly={props.readOnly} /></TabsContent>
      <TabsContent value="locations"><Locations rows={props.locations} readOnly={props.readOnly} /></TabsContent>
      <TabsContent value="departments"><Departments rows={props.departments} readOnly={props.readOnly} /></TabsContent>
      <TabsContent value="designations"><Designations rows={props.designations} readOnly={props.readOnly} /></TabsContent>
      <TabsContent value="custom-fields"><CustomFields rows={props.customFields} readOnly={props.readOnly} /></TabsContent>
    </Tabs>
  );
}

/** Shared save helper: PATCH when id, POST otherwise. */
function useSave(base: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function save(id: string | null, body: unknown, onDone?: () => void) {
    setBusy(true);
    try {
      await apiFetch(id ? `${base}/${id}` : base, { method: id ? "PATCH" : "POST", body });
      toast.success("Saved");
      onDone?.();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string, label: string, onDone?: () => void) {
    if (!confirm(`Remove ${label}?`)) return;
    setBusy(true);
    try {
      await apiFetch(`${base}/${id}`, { method: "DELETE" });
      toast.success("Removed");
      onDone?.();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove");
    } finally {
      setBusy(false);
    }
  }
  return { busy, save, remove };
}

function OrgForm({ org, readOnly }: { org: Org; readOnly: boolean }) {
  const { busy, save } = useSave("/api/v1/org");
  const [f, setF] = useState({ name: org.name, legalName: org.legalName ?? "", domain: org.domain ?? "", logoUrl: org.logoUrl ?? "", timezone: org.timezone, currency: org.currency, financialYearStartMonth: String(org.financialYearStartMonth), weekStartsOn: String(org.weekStartsOn) });
  const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/api/v1/org", { method: "PATCH", body: { ...f, financialYearStartMonth: Number(f.financialYearStartMonth), weekStartsOn: Number(f.weekStartsOn) } });
      toast.success("Saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    }
  }
  void save;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Company profile</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:max-w-3xl">
          <Field label="Name" required><Input disabled={readOnly} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Legal name"><Input disabled={readOnly} value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} /></Field>
          <Field label="Email domain"><Input disabled={readOnly} value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="acme.example" /></Field>
          <Field label="Logo URL"><Input disabled={readOnly} value={f.logoUrl} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} /></Field>
          <Field label="Timezone"><Input disabled={readOnly} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
          <Field label="Currency"><Input disabled={readOnly} maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
          <Field label="Financial year starts">
            <NativeSelect disabled={readOnly} value={f.financialYearStartMonth} onChange={(e) => setF({ ...f, financialYearStartMonth: e.target.value })}>
              {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Week starts on">
            <NativeSelect disabled={readOnly} value={f.weekStartsOn} onChange={(e) => setF({ ...f, weekStartsOn: e.target.value })}>
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <option key={d} value={i}>{d}</option>)}
            </NativeSelect>
          </Field>
          {!readOnly && <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Save</Button></div>}
        </form>
      </CardContent>
    </Card>
  );
}

function Entities({ rows, readOnly }: { rows: LegalEntityDto[]; readOnly: boolean }) {
  const { busy, save } = useSave("/api/v1/org/legal-entities");
  const [edit, setEdit] = useState<Partial<LegalEntityDto> | null>(null);
  const f = edit ?? {};
  const set = (k: keyof LegalEntityDto, v: unknown) => setEdit({ ...f, [k]: v });
  const num = (k: keyof LegalEntityDto) => <Input type="number" step="0.01" value={String(f[k] ?? "")} onChange={(e) => set(k, e.target.value === "" ? undefined : Number(e.target.value))} />;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Legal entities</CardTitle>{!readOnly && <Button size="sm" onClick={() => setEdit({ pfEmployeePct: 12, pfEmployerPct: 12, pfWageCeiling: 15000, esiEmployeePct: 0.75, esiEmployerPct: 3.25, esiWageCeiling: 21000 })}><Plus /> Add</Button>}</CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>PAN / TAN</TableHead><TableHead>GSTIN</TableHead><TableHead>PT state</TableHead><TableHead>PF (EE/ER)</TableHead><TableHead>ESI (EE/ER)</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}{r.isDefault && <span className="ml-2 rounded bg-primary/10 px-1 text-[10px] uppercase text-primary">Default</span>}</TableCell>
                <TableCell>{r.pan ?? "—"} / {r.tan ?? "—"}</TableCell>
                <TableCell>{r.gstin ?? "—"}</TableCell>
                <TableCell>{r.ptState ?? "—"}</TableCell>
                <TableCell>{r.pfEmployeePct}% / {r.pfEmployerPct}% <span className="text-xs text-muted-foreground">≤ {r.pfWageCeiling.toLocaleString("en-IN")}</span></TableCell>
                <TableCell>{r.esiEmployeePct}% / {r.esiEmployerPct}% <span className="text-xs text-muted-foreground">≤ {r.esiWageCeiling.toLocaleString("en-IN")}</span></TableCell>
                <TableCell className="text-right">{!readOnly && <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEdit(r)}><Pencil /></Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{f.id ? "Edit legal entity" : "New legal entity"}</DialogTitle></DialogHeader>
          <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
            <Field label="Name" required className="sm:col-span-3"><Input value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="PAN"><Input value={f.pan ?? ""} onChange={(e) => set("pan", e.target.value.toUpperCase())} /></Field>
            <Field label="TAN"><Input value={f.tan ?? ""} onChange={(e) => set("tan", e.target.value.toUpperCase())} /></Field>
            <Field label="GSTIN"><Input value={f.gstin ?? ""} onChange={(e) => set("gstin", e.target.value.toUpperCase())} /></Field>
            <Field label="CIN"><Input value={f.cin ?? ""} onChange={(e) => set("cin", e.target.value)} /></Field>
            <Field label="PF code"><Input value={f.pfCode ?? ""} onChange={(e) => set("pfCode", e.target.value)} /></Field>
            <Field label="ESI code"><Input value={f.esiCode ?? ""} onChange={(e) => set("esiCode", e.target.value)} /></Field>
            <Field label="PT state" hint="2-letter code, e.g. TS, KA, MH"><Input maxLength={2} value={f.ptState ?? ""} onChange={(e) => set("ptState", e.target.value.toUpperCase())} /></Field>
            <label className="flex items-center gap-2 self-end text-sm sm:col-span-2"><Checkbox checked={Boolean(f.isDefault)} onCheckedChange={(c) => set("isDefault", Boolean(c))} /> Default entity for new employees</label>
            <div className="mt-1 text-sm font-medium sm:col-span-3">Statutory (India)</div>
            <Field label="PF employee %">{num("pfEmployeePct")}</Field>
            <Field label="PF employer %">{num("pfEmployerPct")}</Field>
            <Field label="PF wage ceiling">{num("pfWageCeiling")}</Field>
            <Field label="ESI employee %">{num("esiEmployeePct")}</Field>
            <Field label="ESI employer %">{num("esiEmployerPct")}</Field>
            <Field label="ESI wage ceiling">{num("esiWageCeiling")}</Field>
          </div>
          <DialogFooter showCloseButton>
            <Button disabled={busy || !f.name} onClick={() => save(f.id ?? null, { name: f.name, pan: f.pan ?? null, tan: f.tan ?? null, gstin: f.gstin ?? null, cin: f.cin ?? null, pfCode: f.pfCode ?? null, esiCode: f.esiCode ?? null, ptState: f.ptState ?? null, isDefault: Boolean(f.isDefault), pfEmployeePct: f.pfEmployeePct, pfEmployerPct: f.pfEmployerPct, pfWageCeiling: f.pfWageCeiling, esiEmployeePct: f.esiEmployeePct, esiEmployerPct: f.esiEmployerPct, esiWageCeiling: f.esiWageCeiling }, () => setEdit(null))}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Locations({ rows, readOnly }: { rows: Loc[]; readOnly: boolean }) {
  const { busy, save, remove } = useSave("/api/v1/org/locations");
  const [edit, setEdit] = useState<Partial<Loc> | null>(null);
  const f = edit ?? {};
  const set = (k: keyof Loc, v: unknown) => setEdit({ ...f, [k]: v });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Locations</CardTitle>{!readOnly && <Button size="sm" onClick={() => setEdit({ country: "IN", timezone: "Asia/Kolkata", isActive: true })}><Plus /> Add</Button>}</CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>City / State</TableHead><TableHead>Timezone</TableHead><TableHead>Geo-fence</TableHead><TableHead>Employees</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={r.isActive ? "" : "opacity-60"}>
                <TableCell className="font-medium">{r.name}{!r.isActive && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}</TableCell>
                <TableCell>{[r.city, r.state].filter(Boolean).join(", ") || "—"}</TableCell>
                <TableCell>{r.timezone}</TableCell>
                <TableCell>{r.latitude != null && r.longitude != null ? `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}${r.geoRadiusM ? ` · ${r.geoRadiusM} m` : ""}` : "—"}</TableCell>
                <TableCell>{r.employeeCount}</TableCell>
                <TableCell className="text-right">{!readOnly && <><Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEdit(r)}><Pencil /></Button>{r.isActive && <Button variant="ghost" size="icon-sm" aria-label="Deactivate" disabled={busy} onClick={() => remove(r.id, r.name)}><Trash2 /></Button>}</>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{f.id ? "Edit location" : "New location"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required className="sm:col-span-2"><Input value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Address" className="sm:col-span-2"><Input value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field label="City"><Input value={f.city ?? ""} onChange={(e) => set("city", e.target.value)} /></Field>
            <Field label="State"><Input value={f.state ?? ""} onChange={(e) => set("state", e.target.value)} /></Field>
            <Field label="Country"><Input maxLength={2} value={f.country ?? "IN"} onChange={(e) => set("country", e.target.value.toUpperCase())} /></Field>
            <Field label="Timezone"><Input value={f.timezone ?? ""} onChange={(e) => set("timezone", e.target.value)} /></Field>
            <Field label="Latitude"><Input type="number" step="any" value={f.latitude ?? ""} onChange={(e) => set("latitude", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="Longitude"><Input type="number" step="any" value={f.longitude ?? ""} onChange={(e) => set("longitude", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="Geo-fence radius (m)"><Input type="number" value={f.geoRadiusM ?? ""} onChange={(e) => set("geoRadiusM", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <label className="flex items-center gap-2 self-end text-sm"><Checkbox checked={f.isActive !== false} onCheckedChange={(c) => set("isActive", Boolean(c))} /> Active</label>
          </div>
          <DialogFooter showCloseButton>
            <Button disabled={busy || !f.name} onClick={() => save(f.id ?? null, { name: f.name, address: f.address ?? null, city: f.city ?? null, state: f.state ?? null, country: f.country ?? "IN", timezone: f.timezone ?? "Asia/Kolkata", latitude: f.latitude ?? null, longitude: f.longitude ?? null, geoRadiusM: f.geoRadiusM ?? null, isActive: f.isActive !== false }, () => setEdit(null))}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Departments({ rows, readOnly }: { rows: Dept[]; readOnly: boolean }) {
  const { busy, save, remove } = useSave("/api/v1/org/departments");
  const [edit, setEdit] = useState<(Omit<Partial<Dept>, "head"> & { head?: { id: string; displayName: string } | null }) | null>(null);
  const f = edit ?? {};
  const set = (k: string, v: unknown) => setEdit({ ...f, [k]: v });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Departments</CardTitle>{!readOnly && <Button size="sm" onClick={() => setEdit({ isActive: true })}><Plus /> Add</Button>}</CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Department</TableHead><TableHead>Code</TableHead><TableHead>Head</TableHead><TableHead>Employees</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={r.isActive ? "" : "opacity-60"}>
                <TableCell className="font-medium" style={{ paddingLeft: `${8 + r.depth * 20}px` }}>{r.depth > 0 && <span className="mr-1 text-muted-foreground">└</span>}{r.name}{!r.isActive && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}</TableCell>
                <TableCell><code className="text-xs">{r.code}</code></TableCell>
                <TableCell>{r.head?.displayName ?? "—"}</TableCell>
                <TableCell>{r.employeeCount}</TableCell>
                <TableCell className="text-right">{!readOnly && <><Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEdit(r)}><Pencil /></Button>{r.isActive && <Button variant="ghost" size="icon-sm" aria-label="Deactivate" disabled={busy} onClick={() => remove(r.id, r.name)}><Trash2 /></Button>}</>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{f.id ? "Edit department" : "New department"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required><Input value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Code" required><Input value={f.code ?? ""} onChange={(e) => set("code", e.target.value.toUpperCase())} /></Field>
            <Field label="Parent department" className="sm:col-span-2">
              <NativeSelect value={f.parentId ?? ""} onChange={(e) => set("parentId", e.target.value || null)}>
                <option value="">— none (top level)</option>
                {rows.filter((d) => d.id !== f.id).map((d) => <option key={d.id} value={d.id}>{"  ".repeat(d.depth)}{d.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Department head" className="sm:col-span-2"><ManagerPicker value={f.head ?? null} onChange={(v) => setEdit({ ...f, head: v, headId: v?.id ?? null })} /></Field>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive !== false} onCheckedChange={(c) => set("isActive", Boolean(c))} /> Active</label>
          </div>
          <DialogFooter showCloseButton>
            <Button disabled={busy || !f.name || !f.code} onClick={() => save(f.id ?? null, { name: f.name, code: f.code, parentId: f.parentId ?? null, headId: f.headId ?? null, isActive: f.isActive !== false }, () => setEdit(null))}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Designations({ rows, readOnly }: { rows: Desig[]; readOnly: boolean }) {
  const { busy, save, remove } = useSave("/api/v1/org/designations");
  const [edit, setEdit] = useState<Partial<Desig> | null>(null);
  const f = edit ?? {};
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Designations</CardTitle>{!readOnly && <Button size="sm" onClick={() => setEdit({ level: 1, isActive: true })}><Plus /> Add</Button>}</CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Level</TableHead><TableHead>Employees</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={r.isActive ? "" : "opacity-60"}>
                <TableCell className="font-medium">{r.name}{!r.isActive && <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}</TableCell>
                <TableCell>{r.level}</TableCell>
                <TableCell>{r.employeeCount}</TableCell>
                <TableCell className="text-right">{!readOnly && <><Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEdit(r)}><Pencil /></Button>{r.isActive && <Button variant="ghost" size="icon-sm" aria-label="Deactivate" disabled={busy} onClick={() => remove(r.id, r.name)}><Trash2 /></Button>}</>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{f.id ? "Edit designation" : "New designation"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Field label="Name" required><Input value={f.name ?? ""} onChange={(e) => setEdit({ ...f, name: e.target.value })} /></Field>
            <Field label="Level" hint="1 = entry level; higher is more senior"><Input type="number" min={1} max={20} value={f.level ?? 1} onChange={(e) => setEdit({ ...f, level: Number(e.target.value) })} /></Field>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive !== false} onCheckedChange={(c) => setEdit({ ...f, isActive: Boolean(c) })} /> Active</label>
          </div>
          <DialogFooter showCloseButton>
            <Button disabled={busy || !f.name} onClick={() => save(f.id ?? null, { name: f.name, level: f.level ?? 1, isActive: f.isActive !== false }, () => setEdit(null))}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CustomFields({ rows, readOnly }: { rows: CField[]; readOnly: boolean }) {
  const { busy, save, remove } = useSave("/api/v1/org/custom-fields");
  const [edit, setEdit] = useState<(Partial<CField> & { optionsText?: string }) | null>(null);
  const f = edit ?? {};
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Custom employee fields</CardTitle>{!readOnly && <Button size="sm" onClick={() => setEdit({ entity: "EMPLOYEE", type: "TEXT", required: false, order: rows.length + 1, optionsText: "" })}><Plus /> Add</Button>}</CardHeader>
      <CardContent>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No custom fields yet. They appear on the employee Overview tab for HR.</p>}
        {rows.length > 0 && (
          <Table>
            <TableHeader><TableRow><TableHead>Label</TableHead><TableHead>Key</TableHead><TableHead>Type</TableHead><TableHead>Required</TableHead><TableHead>Order</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell><code className="text-xs">{r.key}</code></TableCell>
                  <TableCell>{r.type}{r.type === "SELECT" && <span className="ml-1 text-xs text-muted-foreground">({r.options.join(", ")})</span>}</TableCell>
                  <TableCell>{r.required ? "Yes" : "No"}</TableCell>
                  <TableCell>{r.order}</TableCell>
                  <TableCell className="text-right">{!readOnly && <><Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEdit({ ...r, optionsText: r.options.join(", ") })}><Pencil /></Button><Button variant="ghost" size="icon-sm" aria-label="Delete" disabled={busy} onClick={() => remove(r.id, r.label)}><Trash2 /></Button></>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{f.id ? "Edit field" : "New field"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Label" required><Input value={f.label ?? ""} onChange={(e) => setEdit({ ...f, label: e.target.value, key: f.id ? f.key : e.target.value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f$1") })} /></Field>
            <Field label="Key" required hint="Identifier stored on the record"><Input disabled={Boolean(f.id)} value={f.key ?? ""} onChange={(e) => setEdit({ ...f, key: e.target.value })} /></Field>
            <Field label="Type">
              <NativeSelect value={f.type ?? "TEXT"} onChange={(e) => setEdit({ ...f, type: e.target.value })}>{["TEXT", "NUMBER", "DATE", "SELECT", "BOOLEAN"].map((t) => <option key={t}>{t}</option>)}</NativeSelect>
            </Field>
            <Field label="Order"><Input type="number" min={0} value={f.order ?? 0} onChange={(e) => setEdit({ ...f, order: Number(e.target.value) })} /></Field>
            {f.type === "SELECT" && <Field label="Options" hint="Comma-separated" className="sm:col-span-2"><Input value={f.optionsText ?? ""} onChange={(e) => setEdit({ ...f, optionsText: e.target.value })} /></Field>}
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(f.required)} onCheckedChange={(c) => setEdit({ ...f, required: Boolean(c) })} /> Required</label>
          </div>
          <DialogFooter showCloseButton>
            <Button disabled={busy || !f.label || !f.key} onClick={() => save(f.id ?? null, { entity: f.entity ?? "EMPLOYEE", key: f.key, label: f.label, type: f.type ?? "TEXT", options: (f.optionsText ?? "").split(",").map((s) => s.trim()).filter(Boolean), required: Boolean(f.required), order: f.order ?? 0 }, () => setEdit(null))}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

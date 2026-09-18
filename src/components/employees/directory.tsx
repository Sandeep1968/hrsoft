"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Plus, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/common/native-select";
import { EmptyState, StatusBadge } from "@/components/common";
import type { Page } from "@/lib/api";
import type { EmployeeListItem } from "@/server/services/employees";
import type { OrgLookups } from "@/server/services/org";

export interface DirectoryParams {
  q: string;
  departmentId: string;
  locationId: string;
  status: string;
  page: number;
}

export function Directory({ page, lookups, params, canWrite, canImport, canExport }: { page: Page<EmployeeListItem>; lookups: OrgLookups; params: DirectoryParams; canWrite: boolean; canImport: boolean; canExport: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState(params.q);
  const [exporting, setExporting] = useState(false);

  function push(next: Partial<DirectoryParams>) {
    const p = { ...params, ...next };
    const sp = new URLSearchParams();
    if (p.q) sp.set("q", p.q);
    if (p.departmentId) sp.set("departmentId", p.departmentId);
    if (p.locationId) sp.set("locationId", p.locationId);
    if (p.status) sp.set("status", p.status);
    if (p.page > 1) sp.set("page", String(p.page));
    router.push(`/employees${sp.toString() ? `?${sp}` : ""}`);
  }
  function query() {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.departmentId) sp.set("departmentId", params.departmentId);
    if (params.locationId) sp.set("locationId", params.locationId);
    if (params.status) sp.set("status", params.status);
    return sp;
  }
  async function exportCsv() {
    setExporting(true);
    try {
      const sp = query();
      sp.set("format", "csv");
      const res = await fetch(`/api/v1/employees?${sp}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message ?? "Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <form className="relative flex-1" onSubmit={(e) => { e.preventDefault(); push({ q, page: 1 }); }}>
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, code or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <NativeSelect className="md:w-44" value={params.departmentId} onChange={(e) => push({ departmentId: e.target.value, page: 1 })}>
          <option value="">All departments</option>{lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </NativeSelect>
        <NativeSelect className="md:w-40" value={params.locationId} onChange={(e) => push({ locationId: e.target.value, page: 1 })}>
          <option value="">All locations</option>{lookups.locations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </NativeSelect>
        <NativeSelect className="md:w-36" value={params.status} onChange={(e) => push({ status: e.target.value, page: 1 })}>
          <option value="">Not exited</option><option value="ACTIVE">Active</option><option value="ONBOARDING">Onboarding</option><option value="ON_NOTICE">On notice</option><option value="EXITED">Exited</option>
        </NativeSelect>
        <div className="flex gap-2">
          {canExport && <Button variant="outline" disabled={exporting} onClick={exportCsv}><Download /> {exporting ? "Exporting…" : "Export"}</Button>}
          {canImport && <Button variant="outline" nativeButton={false} render={<Link href="/employees/import" />}><Upload /> Import CSV</Button>}
          {canWrite && <Button nativeButton={false} render={<Link href="/employees/new" />}><Plus /> Add employee</Button>}
        </div>
      </div>

      {page.items.length === 0 ? (
        <EmptyState title="No employees match" description="Try a different search or clear the filters." />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Employee</TableHead><TableHead>Designation</TableHead><TableHead>Department</TableHead><TableHead>Location</TableHead><TableHead>Manager</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Link href={`/employees/${e.id}`} className="flex items-center gap-3 hover:underline">
                      <Avatar className="size-8">{e.photoUrl && <AvatarImage src={e.photoUrl} alt="" />}<AvatarFallback>{e.displayName.split(" ").map((s) => s[0]).slice(0, 2).join("")}</AvatarFallback></Avatar>
                      <span className="min-w-0"><span className="block truncate font-medium">{e.displayName}</span><span className="block text-xs text-muted-foreground">{e.employeeCode} · {e.workEmail}</span></span>
                    </Link>
                  </TableCell>
                  <TableCell>{e.designation ?? "—"}</TableCell>
                  <TableCell>{e.department ?? "—"}</TableCell>
                  <TableCell>{e.location ?? "—"}</TableCell>
                  <TableCell>{e.manager ? <Link href={`/employees/${e.manager.id}`} className="hover:underline">{e.manager.displayName}</Link> : "—"}</TableCell>
                  <TableCell><StatusBadge status={e.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{page.total.toLocaleString("en-IN")} employees · page {page.page} of {page.pages}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page.page <= 1} onClick={() => push({ page: page.page - 1 })}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page.page >= page.pages} onClick={() => push({ page: page.page + 1 })}>Next</Button>
        </div>
      </div>
    </div>
  );
}

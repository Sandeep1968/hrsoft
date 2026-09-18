"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/common/native-select";
import { EmptyState } from "@/components/common";
import { apiFetch } from "@/lib/client/api";
import { fmtDate } from "@/lib/dates";
import { DOC_TYPE_OPTIONS, Field, fmtBytes } from "./field";
import type { DocumentDto } from "@/server/services/documents";

export function DocumentsTab({ employeeId, documents, canWrite, isHr }: { employeeId: string; documents: DocumentDto[]; canWrite: boolean; isHr: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ type: "OTHER", name: "", expiresAt: "", visibility: "EMPLOYEE_AND_HR" });

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error("Choose a file");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("type", f.type);
      if (f.name) fd.set("name", f.name);
      if (f.expiresAt) fd.set("expiresAt", f.expiresAt);
      fd.set("visibility", f.visibility);
      const res = await fetch(`/api/v1/employees/${employeeId}/documents`, { method: "POST", body: fd, credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? "Upload failed");
      toast.success("Document uploaded");
      setF({ type: "OTHER", name: "", expiresAt: "", visibility: "EMPLOYEE_AND_HR" });
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }
  async function download(d: DocumentDto) {
    try {
      const r = await apiFetch<{ url: string }>(`/api/v1/employees/${employeeId}/documents/${d.id}`);
      window.open(r.url, "_blank", "noopener");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open");
    }
  }
  async function remove(d: DocumentDto) {
    if (!confirm(`Delete "${d.name}"?`)) return;
    try {
      await apiFetch(`/api/v1/employees/${employeeId}/documents/${d.id}`, { method: "DELETE" });
      toast.success("Deleted");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Documents</CardTitle></CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <EmptyState title="No documents yet" description="Upload ID proofs, letters and certificates." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Size</TableHead><TableHead>Uploaded</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="max-w-[240px] truncate font-medium">{d.name}{d.visibility === "HR_ONLY" && <span className="ml-2 rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">HR only</span>}</TableCell>
                    <TableCell>{d.type.replaceAll("_", " ")}</TableCell>
                    <TableCell>{fmtBytes(d.sizeBytes)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(d.createdAt)}{d.uploadedBy ? ` · ${d.uploadedBy}` : ""}{d.expiresAt ? ` · expires ${fmtDate(d.expiresAt)}` : ""}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon-sm" aria-label="Download" onClick={() => download(d)}><Download /></Button>
                      {d.canDelete && <Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={() => remove(d)}><Trash2 /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {canWrite && (
        <Card>
          <CardHeader><CardTitle className="text-base">Upload</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={upload} className="grid gap-3">
              <Field label="File" required hint="PDF, PNG, JPEG, WEBP, DOCX, XLSX up to 10 MB"><Input ref={fileRef} type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.csv" /></Field>
              <Field label="Type">
                <NativeSelect value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{DOC_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
              </Field>
              <Field label="Name" hint="Defaults to the file name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Expires on"><Input type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
              {isHr && (
                <Field label="Visibility">
                  <NativeSelect value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value })}><option value="EMPLOYEE_AND_HR">Employee and HR</option><option value="HR_ONLY">HR only</option></NativeSelect>
                </Field>
              )}
              <Button type="submit" disabled={busy}><Upload /> {busy ? "Uploading…" : "Upload"}</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/client/api";
import { Field } from "./field";
import type { ImportRowResult } from "@/server/services/employees";

const COLUMNS = ["firstName", "lastName", "workEmail", "joiningDate", "departmentCode", "designationName", "locationName", "managerEmail", "annualCtc", "phone", "gender", "employmentType"];
const TEMPLATE = `${COLUMNS.join(",")}\nPriya,Sharma,priya.sharma@acme.example,2026-10-01,ENGINE,Software Engineer,Hyderabad HQ,manager@acme.example,900000,+919876543210,FEMALE,FULL_TIME\n`;

type Result = { rows: ImportRowResult[]; valid: number; invalid: number; created: number; committed: boolean };

export function ImportCsv() {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState<"validate" | "commit" | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  function downloadTemplate() {
    const a = document.createElement("a");
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;
    a.download = "employees-template.csv";
    a.click();
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setCsv(await file.text());
      setResult(null);
    }
  }
  async function run(commit: boolean) {
    if (!csv.trim()) return toast.error("Paste or upload a CSV first");
    setBusy(commit ? "commit" : "validate");
    try {
      const r = await apiFetch<Result>("/api/v1/employees/import", { method: "POST", body: { csv, commit } });
      setResult(r);
      if (commit) toast.success(`Created ${r.created} employees`);
      else toast[r.invalid ? "warning" : "success"](`${r.valid} valid, ${r.invalid} invalid`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader><CardTitle className="text-base">1. Prepare the file</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">Columns (header row required): <code className="text-xs">{COLUMNS.join(", ")}</code>. Dates as YYYY-MM-DD. Department by code or name; manager by work email. Each row creates a login with a temporary password (not emailed).</p>
          <Button variant="outline" size="sm" onClick={downloadTemplate}><Download /> Download template</Button>
          <Field label="Upload CSV"><Input type="file" accept=".csv,text/csv" onChange={onFile} /></Field>
          <Field label="…or paste CSV"><Textarea rows={8} className="font-mono text-xs" value={csv} onChange={(e) => { setCsv(e.target.value); setResult(null); }} placeholder={TEMPLATE} /></Field>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy !== null} onClick={() => run(false)}>{busy === "validate" ? "Validating…" : "Validate"}</Button>
            <Button disabled={busy !== null || !result || result.committed || result.valid === 0} onClick={() => run(true)}>{busy === "commit" ? "Importing…" : `Import ${result?.valid ?? 0} rows`}</Button>
          </div>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">2. Review {result ? `· ${result.valid} valid, ${result.invalid} invalid${result.committed ? `, ${result.created} created` : ""}` : ""}</CardTitle></CardHeader>
        <CardContent>
          {!result ? (
            <p className="text-sm text-muted-foreground">Validation results will appear here. Rows with errors are skipped on import; fix them and re-run.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
              <TableBody>
                {result.rows.map((r) => (
                  <TableRow key={r.row}>
                    <TableCell>{r.row}</TableCell>
                    <TableCell>{r.id ? <Link href={`/employees/${r.id}`} className="hover:underline">{r.name}</Link> : r.name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.workEmail}</TableCell>
                    <TableCell className="whitespace-normal">
                      {r.ok ? <span className="text-emerald-700">{r.employeeCode ? `Created ${r.employeeCode}` : "Valid"}</span> : <span className="text-destructive">{r.errors.join("; ")}</span>}
                    </TableCell>
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

"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common";
import { fmtDate, fmtMoney } from "@/lib/dates";
import type { ClaimDto, ExpenseSummary } from "@/server/services/expenses";
import { ReimburseDialog } from "./reimburse-dialog";

export function FinanceView({ approved, summary }: { approved: ClaimDto[]; summary: ExpenseSummary }) {
  const [sel, setSel] = useState<ClaimDto | null>(null);
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader><CardTitle className="text-base">Approved — awaiting reimbursement</CardTitle></CardHeader>
        <CardContent className="p-0">
          {approved.length === 0 ? (
            <div className="p-4"><EmptyState title="All caught up" description="No approved claims are waiting for payment." /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Claim</TableHead>
                  <TableHead>Approved</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {approved.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell><div className="font-medium">{c.displayName}</div><div className="text-xs text-muted-foreground">{c.employeeCode}</div></TableCell>
                    <TableCell><Link href={`/expenses/${c.id}`} className="hover:underline">{c.title}</Link><div className="text-xs text-muted-foreground">{c.itemCount} items · by {c.approverName ?? "—"}</div></TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(c.decidedAt)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{fmtMoney(c.totalAmount, c.currency)}</TableCell>
                    <TableCell className="text-right"><Button size="sm" onClick={() => setSel(c)}>Reimburse</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">By category (12 months)</CardTitle></CardHeader>
          <CardContent>
            {summary.byCategory.length === 0 ? <p className="text-sm text-muted-foreground">No approved spend yet.</p> : (
              <ul className="divide-y text-sm">
                {summary.byCategory.map((c) => <li key={c.code} className="flex justify-between py-1.5"><span>{c.category} <span className="text-xs text-muted-foreground">· {c.claims}</span></span><span className="tabular-nums">{fmtMoney(c.amount)}</span></li>)}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">By month</CardTitle></CardHeader>
          <CardContent>
            {summary.byMonth.length === 0 ? <p className="text-sm text-muted-foreground">No claims in the last 12 months.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted-foreground"><th className="text-left font-medium">Month</th><th className="text-right font-medium">Submitted</th><th className="text-right font-medium">Approved</th><th className="text-right font-medium">Paid</th></tr></thead>
                <tbody className="[&_td]:py-1 [&_td:not(:first-child)]:text-right [&_td:not(:first-child)]:tabular-nums">
                  {summary.byMonth.map((m) => <tr key={m.month}><td>{m.month}</td><td>{fmtMoney(m.submitted)}</td><td>{fmtMoney(m.approved)}</td><td>{fmtMoney(m.reimbursed)}</td></tr>)}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
      <ReimburseDialog open={sel !== null} onOpenChange={(o) => !o && setSel(null)} claim={sel} />
    </div>
  );
}

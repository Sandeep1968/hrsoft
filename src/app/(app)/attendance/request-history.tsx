import { StatusBadge } from "@/components/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/dates";
import { fmtTime } from "./format";

interface Reg { id: string; date: string; requestedIn: string; requestedOut: string; reason: string; status: string; decisionNote: string | null; approver?: { displayName: string } | null }
interface Remote { id: string; fromDate: string; toDate: string; reason: string; status: string; decisionNote: string | null; approver?: { displayName: string } | null }

export function RequestHistory({ regularizations, remote }: { regularizations: Reg[]; remote: Remote[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Regularisation requests</CardTitle>
        </CardHeader>
        <CardContent>
          {regularizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No regularisation requests yet. Click a past day in the calendar to raise one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {regularizations.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDate(r.date)}</TableCell>
                    <TableCell className="tabular-nums">{fmtTime(r.requestedIn)} – {fmtTime(r.requestedOut)}</TableCell>
                    <TableCell className="max-w-48 truncate whitespace-normal" title={r.decisionNote ?? undefined}>{r.reason}{r.decisionNote ? <span className="block text-xs text-muted-foreground">Note: {r.decisionNote}</span> : null}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Work-from-home requests</CardTitle>
        </CardHeader>
        <CardContent>
          {remote.length === 0 ? (
            <p className="text-sm text-muted-foreground">No work-from-home requests yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dates</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remote.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDate(r.fromDate)}{r.fromDate !== r.toDate ? ` → ${fmtDate(r.toDate)}` : ""}</TableCell>
                    <TableCell className="max-w-48 truncate whitespace-normal">{r.reason}{r.decisionNote ? <span className="block text-xs text-muted-foreground">Note: {r.decisionNote}</span> : null}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
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

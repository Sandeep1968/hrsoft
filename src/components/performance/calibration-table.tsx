"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/common/native-select";
import { StatusBadge } from "@/components/common";
import { apiFetch } from "@/lib/client/api";
import type { ReviewDto } from "@/server/services/performance";

export function CalibrationTable({ reviews, scale, editable }: { reviews: ReviewDto[]; scale: number; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function calibrate(id: string, finalRating: number) {
    setBusy(id);
    try {
      await apiFetch(`/api/v1/reviews/${id}/calibrate`, { method: "POST", body: { finalRating } });
      toast.success("Final rating saved");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead className="hidden md:table-cell">Department</TableHead>
          <TableHead className="hidden sm:table-cell">Reviewer</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Self</TableHead>
          <TableHead className="text-right">Manager</TableHead>
          <TableHead className="text-right">Final</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reviews.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <div className="font-medium">{r.employeeName}</div>
              <div className="text-xs text-muted-foreground">{r.designation ?? r.employeeCode}</div>
            </TableCell>
            <TableCell className="hidden md:table-cell">{r.departmentName ?? "—"}</TableCell>
            <TableCell className="hidden sm:table-cell">{r.reviewerName ?? "—"}</TableCell>
            <TableCell><StatusBadge status={r.status} /></TableCell>
            <TableCell className="text-right tabular-nums">{r.selfRating ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{r.managerRating ?? "—"}</TableCell>
            <TableCell className="text-right">
              {editable ? (
                <NativeSelect className="h-7 w-20 text-xs" value={r.finalRating ?? ""} disabled={busy === r.id} onChange={(e) => e.target.value && calibrate(r.id, Number(e.target.value))} aria-label={`Final rating for ${r.employeeName}`}>
                  <option value="">—</option>
                  {Array.from({ length: scale }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                </NativeSelect>
              ) : (
                <span className="tabular-nums">{r.finalRating ?? "—"}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ShareResultsButton({ cycleId, status }: { cycleId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (status === "COMPLETED") return null;
  async function share() {
    if (!confirm("Share results with every employee in this cycle? This completes the cycle.")) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/review-cycles/${cycleId}/complete`, { method: "POST" });
      toast.success("Results shared");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <Button onClick={share} disabled={busy}>Share results</Button>;
}

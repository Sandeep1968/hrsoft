import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatusBadge } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/dates";
import { ProgressBar } from "@/components/performance/progress-bar";
import { CreateCycleDialog, CycleActions } from "@/components/performance/cycles-admin";
import { listCycles } from "@/server/services/performance";

export const metadata = { title: "Review cycles" };

export default async function CyclesPage() {
  const actor = await requireActor();
  if (!can(actor, "performance:manage")) return <EmptyState title="Not available" description="Managing review cycles requires the performance:manage permission." />;
  const [cycles, departments] = await Promise.all([listCycles(actor), db.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  return (
    <div>
      <PageHeader title="Review cycles" description="Create, launch, calibrate and share performance reviews." breadcrumb={[{ label: "Performance", href: "/performance" }, { label: "Cycles" }]} actions={<CreateCycleDialog departments={departments} />} />
      {cycles.length === 0 && <EmptyState title="No cycles yet" description="Create a cycle to start a review period." />}
      <div className="grid gap-4">
        {cycles.map((c) => {
          const s: { total: number; byStatus: Partial<Record<string, number>> } = c.stats ?? { total: 0, byStatus: {} };
          const selfDone = (s.byStatus.SELF_SUBMITTED ?? 0) + (s.byStatus.MANAGER_SUBMITTED ?? 0) + (s.byStatus.CALIBRATED ?? 0) + (s.byStatus.SHARED ?? 0);
          const mgrDone = (s.byStatus.MANAGER_SUBMITTED ?? 0) + (s.byStatus.CALIBRATED ?? 0) + (s.byStatus.SHARED ?? 0);
          const calDone = (s.byStatus.CALIBRATED ?? 0) + (s.byStatus.SHARED ?? 0);
          return (
            <Card key={c.id}>
              <CardContent className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/performance/cycles/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{fmtDate(c.periodStart)} – {fmtDate(c.periodEnd)} · scale 1–{c.ratingScale} · {c.questions.length} questions · {s.total} reviews{c.includeDepartmentIds.length ? ` · ${c.includeDepartmentIds.length} departments` : ""}</div>
                  {s.total > 0 && (
                    <div className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
                      <div>Self-reviews<ProgressBar value={(selfDone / s.total) * 100} tone="neutral" /></div>
                      <div>Manager reviews<ProgressBar value={(mgrDone / s.total) * 100} tone="neutral" /></div>
                      <div>Calibrated<ProgressBar value={(calDone / s.total) * 100} tone="neutral" /></div>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="xs" variant="outline" nativeButton={false} render={<Link href={`/performance/cycles/${c.id}`} />}>Calibration</Button>
                  <CycleActions id={c.id} status={c.status} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

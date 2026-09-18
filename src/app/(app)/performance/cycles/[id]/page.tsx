import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NotFoundError } from "@/lib/errors";
import { fmtDate } from "@/lib/dates";
import { CalibrationTable, ShareResultsButton } from "@/components/performance/calibration-table";
import { CycleActions } from "@/components/performance/cycles-admin";
import { calibrationGrid, getCycle, listTeamReviews } from "@/server/services/performance";

export const metadata = { title: "Calibration" };

export default async function CycleCalibrationPage({ params, searchParams }: PageProps<"/performance/cycles/[id]">) {
  const actor = await requireActor();
  if (!can(actor, "performance:manage")) return <EmptyState title="Not available" description="Calibration requires the performance:manage permission." />;
  const { id } = await params;
  const sp = await searchParams;
  const page = Number(sp.page ?? 1) || 1;
  const departmentId = typeof sp.departmentId === "string" && sp.departmentId ? sp.departmentId : undefined;
  let cycle, grid, reviews;
  try {
    [cycle, grid, reviews] = await Promise.all([getCycle(actor, id), calibrationGrid(actor, id), listTeamReviews(actor, id, { page, pageSize: 50, order: "asc", departmentId })]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const ratings = grid.byRating.map((r) => r.rating);
  const editable = cycle.status === "CALIBRATION" || cycle.status === "ACTIVE";
  const qs = (p: number) => `/performance/cycles/${id}?page=${p}${departmentId ? `&departmentId=${departmentId}` : ""}`;
  return (
    <div>
      <PageHeader
        title={cycle.name}
        description={`${fmtDate(cycle.periodStart)} – ${fmtDate(cycle.periodEnd)} · rating scale 1–${cycle.ratingScale}`}
        breadcrumb={[{ label: "Performance", href: "/performance" }, { label: "Cycles", href: "/performance/cycles" }, { label: cycle.name }]}
        actions={<><StatusBadge status={cycle.status} className="text-sm" /><CycleActions id={cycle.id} status={cycle.status} size="sm" /><ShareResultsButton cycleId={cycle.id} status={cycle.status} /></>}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Reviews" value={cycle.stats.total} />
        <StatCard label="Self-reviews" value={`${cycle.stats.selfCompletion}%`} hint={`${cycle.stats.byStatus.NOT_STARTED ?? 0} not started`} />
        <StatCard label="Manager reviews" value={`${cycle.stats.managerCompletion}%`} hint={`${cycle.stats.byStatus.SELF_SUBMITTED ?? 0} awaiting manager`} />
        <StatCard label="Calibrated" value={(cycle.stats.byStatus.CALIBRATED ?? 0) + (cycle.stats.byStatus.SHARED ?? 0)} hint={`${grid.unrated} unrated`} />
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">Rating distribution by department</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                {ratings.map((r) => <TableHead key={r} className="text-center">{r}</TableHead>)}
                <TableHead className="text-right">Unrated</TableHead>
                <TableHead className="text-right">Avg</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grid.byDepartment.map((d) => {
                const rated = Object.values(d.counts).reduce((a, b) => a + b, 0);
                return (
                  <TableRow key={d.departmentId ?? "none"}>
                    <TableCell><Link href={qs(1) + (d.departmentId ? `&departmentId=${d.departmentId}` : "")} className="hover:underline">{d.departmentName}</Link></TableCell>
                    {ratings.map((r) => {
                      const c = d.counts[r] ?? 0;
                      const pct = rated ? c / rated : 0;
                      return <TableCell key={r} className="text-center tabular-nums" style={{ backgroundColor: c ? `color-mix(in oklch, var(--primary) ${Math.round(pct * 60)}%, transparent)` : undefined }}>{c || ""}</TableCell>;
                    })}
                    <TableCell className="text-right tabular-nums">{d.total - rated || ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.avg ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.total}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-medium">
                <TableCell>All</TableCell>
                {grid.byRating.map((r) => <TableCell key={r.rating} className="text-center tabular-nums">{r.count || ""}</TableCell>)}
                <TableCell className="text-right tabular-nums">{grid.unrated}</TableCell>
                <TableCell className="text-right">—</TableCell>
                <TableCell className="text-right tabular-nums">{grid.total}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Reviews {departmentId && <span className="font-normal text-muted-foreground">· filtered by department</span>}</CardTitle>
          {departmentId && <Button size="xs" variant="ghost" nativeButton={false} render={<Link href={`/performance/cycles/${id}`} />}>Clear filter</Button>}
        </CardHeader>
        <CardContent>
          <CalibrationTable reviews={reviews.items} scale={cycle.ratingScale} editable={editable} />
          {reviews.pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
              <span>Page {reviews.page} of {reviews.pages} · {reviews.total} reviews</span>
              <div className="flex gap-2">
                {reviews.page > 1 && <Button size="xs" variant="outline" nativeButton={false} render={<Link href={qs(reviews.page - 1)} />}>Previous</Button>}
                {reviews.page < reviews.pages && <Button size="xs" variant="outline" nativeButton={false} render={<Link href={qs(reviews.page + 1)} />}>Next</Button>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatCard } from "@/components/common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthlyLineChart, SourceBarChart, StageBarChart } from "@/components/hiring/funnel-charts";
import { hiringFunnel } from "@/server/services/hiring";
import { HiringNav } from "@/components/hiring/hiring-nav";

export const metadata = { title: "Hiring analytics" };

export default async function HiringAnalyticsPage() {
  const actor = await requireActor();
  if (!can(actor, "hiring:read")) return <EmptyState title="Not available" description="Hiring analytics require the hiring:read permission." />;
  const f = await hiringFunnel(actor);
  const funnelStages = f.stages.filter((s) => s.stage !== "REJECTED");
  const openJobs = f.jobs.find((j) => j.status === "OPEN");
  return (
    <div>
      <PageHeader title="Hiring analytics" description="Funnel health, time to hire and where candidates come from." />
      <HiringNav active="/hiring/analytics" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Applications" value={f.totalApplications.toLocaleString("en-IN")} hint={`${f.stages.find((s) => s.stage === "REJECTED")?.count ?? 0} rejected`} />
        <StatCard label="Hired" value={f.hired} hint={f.timeToHireDays != null ? `avg ${f.timeToHireDays} days to hire` : "no hires yet"} />
        <StatCard label="Offer acceptance" value={f.offers.acceptanceRate != null ? `${f.offers.acceptanceRate}%` : "—"} hint={`${f.offers.byStatus.ACCEPTED ?? 0} accepted · ${f.offers.byStatus.DECLINED ?? 0} declined · ${f.offers.byStatus.SENT ?? 0} pending`} />
        <StatCard label="Open jobs" value={openJobs?.count ?? 0} hint={`${openJobs?.openings ?? 0} openings`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Funnel by stage</CardTitle></CardHeader>
          <CardContent>
            <StageBarChart data={funnelStages} />
            <ol className="mt-3 grid grid-cols-5 gap-1 text-center text-xs text-muted-foreground">
              {funnelStages.map((s, i) => {
                const prev = i === 0 ? null : funnelStages[i - 1].count;
                const conv = prev ? Math.round((s.count / prev) * 100) : null;
                return <li key={s.stage}><div className="font-medium text-foreground">{s.count}</div>{conv !== null ? `${conv}% of prev` : " "}</li>;
              })}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Candidate sources</CardTitle></CardHeader>
          <CardContent>{f.sources.length ? <SourceBarChart data={f.sources} /> : <p className="text-sm text-muted-foreground">No candidates yet.</p>}</CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Applications and hires · last 6 months</CardTitle></CardHeader>
          <CardContent>{f.monthly.length ? <MonthlyLineChart data={f.monthly} /> : <p className="text-sm text-muted-foreground">No applications in the last 6 months.</p>}</CardContent>
        </Card>
      </div>
    </div>
  );
}

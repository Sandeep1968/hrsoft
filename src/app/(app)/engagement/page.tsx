import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { NotFoundError, ForbiddenError } from "@/lib/errors";
import { LinkTabs } from "@/components/performance/link-tabs";
import { ProgressBar } from "@/components/performance/progress-bar";
import { AnnouncementActions, AnnouncementDialog } from "@/components/engagement/announcement-dialog";
import { SurveyActions, SurveyBuilderDialog } from "@/components/engagement/survey-builder";
import { SurveyRespondForm } from "@/components/engagement/survey-respond";
import { DistributionChart, NpsGauge, NpsTrendChart, TimelineChart } from "@/components/engagement/survey-charts";
import { engagementDashboard, engagementLookups, getSurveyForRespondent, listAnnouncements, listSurveys, surveyResults } from "@/server/services/engagement";

export const metadata = { title: "Engagement" };

export default async function EngagementPage({ searchParams }: PageProps<"/engagement">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const manage = can(actor, "engagement:manage");
  const tabs = [{ key: "announcements", label: "Announcements" }, { key: "surveys", label: "Surveys" }, ...(manage ? [{ key: "dashboard", label: "Dashboard" }] : [])];
  const tab = typeof sp.tab === "string" && tabs.some((t) => t.key === sp.tab) ? sp.tab : "announcements";
  const surveyId = typeof sp.survey === "string" ? sp.survey : undefined;
  const view = typeof sp.view === "string" ? sp.view : undefined;
  const { departments } = await engagementLookups(actor);

  return (
    <div>
      <PageHeader
        title="Engagement"
        description="Company news, pulse surveys and how people feel."
        actions={manage && (tab === "announcements" ? <AnnouncementDialog departments={departments} /> : tab === "surveys" ? <SurveyBuilderDialog departments={departments} /> : null)}
      />
      <LinkTabs tabs={tabs} active={tab} hrefFor={(k) => `/engagement?tab=${k}`} />
      {tab === "announcements" ? <Announcements /> : tab === "surveys" ? (surveyId ? <SurveyDetail id={surveyId} results={view === "results" && manage} /> : <Surveys />) : <Dashboard />}
    </div>
  );

  async function Announcements() {
    const page = await listAnnouncements(actor, { page: Number(sp.page ?? 1) || 1, pageSize: 20, order: "desc" });
    if (page.items.length === 0) return <EmptyState title="No announcements" description={manage ? "Publish your first company update." : "Announcements from HR will appear here."} />;
    return (
      <div className="grid gap-3">
        {page.items.map((a) => {
          const expired = a.expiresAt ? new Date(a.expiresAt).getTime() < Date.now() : false;
          return (
            <Card key={a.id} size="sm" className={expired ? "opacity-60" : ""}>
              <CardContent>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {a.isPinned && <span className="rounded bg-primary/10 px-1.5 text-[10px] uppercase text-primary">Pinned</span>}
                      {a.title}
                      {expired && <span className="rounded bg-muted px-1.5 text-[10px] uppercase">Expired</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{a.authorName} · {fmtDateTime(a.publishedAt)}{a.expiresAt ? ` · until ${fmtDate(a.expiresAt)}` : ""}{a.audienceDepartmentIds.length ? ` · ${a.audienceDepartmentIds.map((id) => departments.find((d) => d.id === id)?.name ?? "?").join(", ")}` : " · Everyone"}</div>
                  </div>
                  {manage && (
                    <div className="flex shrink-0 items-center gap-1">
                      <AnnouncementDialog departments={departments} announcement={{ id: a.id, title: a.title, body: a.body, audienceDepartmentIds: a.audienceDepartmentIds, isPinned: a.isPinned, expiresAt: a.expiresAt }} />
                      <AnnouncementActions id={a.id} isPinned={a.isPinned} />
                    </div>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{a.body}</p>
              </CardContent>
            </Card>
          );
        })}
        {page.pages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Page {page.page} of {page.pages}</span>
            <div className="flex gap-2">
              {page.page > 1 && <Button size="xs" variant="outline" nativeButton={false} render={<Link href={`/engagement?tab=announcements&page=${page.page - 1}`} />}>Previous</Button>}
              {page.page < page.pages && <Button size="xs" variant="outline" nativeButton={false} render={<Link href={`/engagement?tab=announcements&page=${page.page + 1}`} />}>Next</Button>}
            </div>
          </div>
        )}
      </div>
    );
  }

  async function Surveys() {
    const surveys = await listSurveys(actor);
    if (surveys.length === 0) return <EmptyState title="No surveys" description={manage ? "Build a pulse or eNPS survey to hear from the team." : "You have no open surveys right now."} />;
    if (!manage) {
      return (
        <div className="grid gap-3 lg:grid-cols-2">
          {surveys.map((s) => (
            <Card key={s.id} size="sm">
              <CardContent className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{s.title}</div>
                  <div className="text-xs text-muted-foreground">{s.type} · {s.questions.length} questions{s.endsAt ? ` · closes ${fmtDate(s.endsAt)}` : ""} · {s.isAnonymous ? "anonymous" : "named"}</div>
                </div>
                {s.responded ? <StatusBadge status="COMPLETED" /> : <Button size="sm" nativeButton={false} render={<Link href={`/engagement?tab=surveys&survey=${s.id}`} />}>Respond</Button>}
              </CardContent>
            </Card>
          ))}
        </div>
      );
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Survey</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Window</TableHead>
            <TableHead className="text-right">Responses</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {surveys.map((s) => (
            <TableRow key={s.id}>
              <TableCell>
                <Link href={`/engagement?tab=surveys&survey=${s.id}&view=results`} className="font-medium hover:underline">{s.title}</Link>
                <div className="text-xs text-muted-foreground">{s.type} · {s.questions.length} questions · {s.isAnonymous ? "anonymous" : "named"}{s.targetDepartmentIds.length ? ` · ${s.targetDepartmentIds.length} departments` : " · everyone"}</div>
              </TableCell>
              <TableCell><StatusBadge status={s.status} /></TableCell>
              <TableCell className="hidden text-xs sm:table-cell">{s.startsAt ? fmtDate(s.startsAt) : "—"} → {s.endsAt ? fmtDate(s.endsAt) : "open"}</TableCell>
              <TableCell className="text-right tabular-nums">{s.responses ?? 0}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {s.status === "DRAFT" && <SurveyBuilderDialog departments={departments} survey={{ id: s.id, title: s.title, description: s.description, type: s.type, isAnonymous: s.isAnonymous, startsAt: s.startsAt, endsAt: s.endsAt, targetDepartmentIds: s.targetDepartmentIds, questions: s.questions.map((q) => ({ text: q.text, type: q.type, options: q.options, required: q.required })) }} />}
                  {s.status !== "DRAFT" && <Button size="xs" variant="outline" nativeButton={false} render={<Link href={`/engagement?tab=surveys&survey=${s.id}&view=results`} />}>Results</Button>}
                  <SurveyActions id={s.id} status={s.status} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  async function SurveyDetail({ id, results }: { id: string; results: boolean }) {
    try {
      if (results) return <Results id={id} />;
      const s = await getSurveyForRespondent(actor, id);
      return (
        <Card className="mx-auto max-w-2xl">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">{s.title} <StatusBadge status={s.status} /></CardTitle>
            {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
          </CardHeader>
          <CardContent>
            {s.responded ? <p className="text-sm text-muted-foreground">You have already responded to this survey. Thank you!</p> : !s.open ? <p className="text-sm text-muted-foreground">This survey is not open for responses.</p> : !actor.employeeId ? <p className="text-sm text-muted-foreground">Only employees can respond.</p> : <SurveyRespondForm survey={s} />}
            <div className="mt-4"><Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/engagement?tab=surveys" />}>← Back to surveys</Button></div>
          </CardContent>
        </Card>
      );
    } catch (e) {
      if (e instanceof NotFoundError || e instanceof ForbiddenError) return <EmptyState title="Survey unavailable" description={e.message} action={<Button variant="outline" nativeButton={false} render={<Link href="/engagement?tab=surveys" />}>Back</Button>} />;
      throw e;
    }
  }

  async function Results({ id }: { id: string }) {
    const r = await surveyResults(actor, id);
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">{r.survey.title} <StatusBadge status={r.survey.status} /></h2>
            <p className="text-xs text-muted-foreground">{r.survey.type} · {r.survey.isAnonymous ? "anonymous" : "named"} · {r.survey.startsAt ? fmtDate(r.survey.startsAt) : "—"} → {r.survey.endsAt ? fmtDate(r.survey.endsAt) : "open"}</p>
          </div>
          <div className="flex gap-2"><SurveyActions id={id} status={r.survey.status} size="sm" /><Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/engagement?tab=surveys" />}>← All surveys</Button></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Responses" value={r.responses} hint={`of ${r.population} targeted`} />
          <StatCard label="Response rate" value={r.responseRate != null ? `${r.responseRate}%` : "—"} />
          {r.nps !== null && <StatCard label="eNPS" value={r.nps} hint="% promoters − % detractors" />}
          <StatCard label="Departments shown" value={r.departments.length} hint={r.suppressedDepartments ? `${r.suppressedDepartments} hidden (< 5 responses)` : "5+ responses each"} />
        </div>
        {r.responses === 0 && <EmptyState title="No responses yet" description="Results appear as people respond." />}
        {r.responses > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            {r.nps !== null && (
              <Card>
                <CardHeader><CardTitle className="text-base">Employee net promoter score</CardTitle></CardHeader>
                <CardContent><NpsGauge value={r.nps} /></CardContent>
              </Card>
            )}
            {r.timeline.length > 1 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Responses per day</CardTitle></CardHeader>
                <CardContent><TimelineChart data={r.timeline} /></CardContent>
              </Card>
            )}
            {r.questions.map((q, i) => (
              <Card key={q.id}>
                <CardHeader>
                  <CardTitle className="text-sm">{i + 1}. {q.text}</CardTitle>
                  <p className="text-xs text-muted-foreground">{q.type} · {q.answered} answered{q.average !== null ? ` · avg ${q.average}` : ""}{q.nps !== null ? ` · NPS ${q.nps}` : ""}</p>
                </CardHeader>
                <CardContent>
                  {q.type === "TEXT" ? (
                    <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm">
                      {q.texts.length === 0 && <li className="text-muted-foreground">No answers.</li>}
                      {q.texts.map((t, k) => <li key={k} className="rounded bg-muted/50 p-2">“{t}”</li>)}
                    </ul>
                  ) : (
                    <DistributionChart data={q.distribution} tone={q.type === "NPS" ? "nps" : q.type === "RATING" ? "rating" : "choice"} />
                  )}
                </CardContent>
              </Card>
            ))}
            {r.departments.length > 0 && (
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="text-base">By department</CardTitle><p className="text-xs text-muted-foreground">Only departments with at least 5 responses are shown to protect anonymity.</p></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>Department</TableHead><TableHead className="text-right">Responses</TableHead><TableHead className="text-right">Avg rating</TableHead><TableHead className="text-right">eNPS</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {r.departments.map((d) => (
                        <TableRow key={d.departmentId}><TableCell>{d.departmentName}</TableCell><TableCell className="text-right tabular-nums">{d.responses}</TableCell><TableCell className="text-right tabular-nums">{d.averageRating ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{d.nps ?? "—"}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    );
  }

  async function Dashboard() {
    const d = await engagementDashboard(actor);
    return (
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Latest eNPS" value={d.latestNps ?? "—"} hint={d.previousNps !== null && d.latestNps !== null ? `${d.latestNps - d.previousNps >= 0 ? "+" : ""}${d.latestNps - d.previousNps} vs previous` : "run an eNPS survey to start"} />
          <StatCard label="Avg participation" value={d.participation !== null ? `${d.participation}%` : "—"} hint="across recent surveys" />
          <StatCard label="Praise · 30 days" value={d.praiseLast30Days} hint={d.praiseBadges.slice(0, 3).map((b) => `${b.badge} ${b.count}`).join(" · ") || "no badges yet"} />
          <StatCard label="Active employees" value={d.activeEmployees.toLocaleString("en-IN")} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">eNPS and participation trend</CardTitle></CardHeader>
            <CardContent>{d.trend.length ? <NpsTrendChart data={d.trend} /> : <p className="text-sm text-muted-foreground">Launch surveys to build a trend.</p>}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Latest eNPS</CardTitle></CardHeader>
            <CardContent><NpsGauge value={d.latestNps} /></CardContent>
          </Card>
          <Card className="lg:col-span-3">
            <CardHeader><CardTitle className="text-base">Recent surveys</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y">
                {d.trend.length === 0 && <li className="py-2 text-sm text-muted-foreground">No surveys yet.</li>}
                {[...d.trend].reverse().map((t) => (
                  <li key={t.surveyId} className="grid gap-1 py-2 sm:grid-cols-[1fr_auto_10rem] sm:items-center sm:gap-4">
                    <div><Link href={`/engagement?tab=surveys&survey=${t.surveyId}&view=results`} className="text-sm font-medium hover:underline">{t.title}</Link><div className="text-xs text-muted-foreground">{fmtDate(t.date)} · {t.responses} responses{t.nps !== null ? ` · eNPS ${t.nps}` : ""}</div></div>
                    <StatusBadge status={t.status} />
                    <ProgressBar value={t.responseRate ?? 0} tone="neutral" />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
}

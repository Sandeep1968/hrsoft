import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can, teamIds } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate, fmtDateTime, isoDate } from "@/lib/dates";
import { LinkTabs } from "@/components/performance/link-tabs";
import { ObjectiveCard } from "@/components/performance/objective-card";
import { AddObjectiveDialog } from "@/components/performance/add-objective-dialog";
import { OkrTree } from "@/components/performance/okr-tree";
import { SelfReviewForm, ManagerReviewDialog, ReviewQuestionFields } from "@/components/performance/review-forms";
import { FeedbackSummaryPanel, RequestFeedbackDialog, SubmitFeedbackDialog } from "@/components/performance/feedback";
import { GivePraiseDialog } from "@/components/performance/praise";
import {
  PRAISE_BADGES,
  getMyReview,
  listCycles,
  listFeedbackRequestsAboutMe,
  listMyFeedbackRequests,
  listObjectives,
  listPraise,
  listTeamReviews,
  okrTree,
  parsePeriod,
  praiseLeaderboard,
} from "@/server/services/performance";

export const metadata = { title: "Performance" };

const TABS = [
  { key: "my", label: "My OKRs" },
  { key: "team", label: "Team OKRs" },
  { key: "company", label: "Company" },
  { key: "reviews", label: "Reviews" },
  { key: "feedback", label: "360° Feedback" },
  { key: "praise", label: "Praise" },
];

function periodOptions() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const out: string[] = [];
  for (const year of [y + 1, y, y - 1]) {
    out.push(String(year));
    for (const h of [2, 1]) out.push(`${year}-H${h}`);
    for (const q of [4, 3, 2, 1]) out.push(`${year}-Q${q}`);
  }
  return out;
}

export default async function PerformancePage({ searchParams }: PageProps<"/performance">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" && TABS.some((t) => t.key === sp.tab) ? sp.tab : "my";
  const period = parsePeriod(typeof sp.period === "string" ? sp.period : undefined);
  const hrefFor = (key: string) => `/performance?tab=${key}&period=${period.label}`;
  const me = actor.employeeId;
  const manage = can(actor, "performance:manage");
  const hasTeam = me ? (await teamIds(actor)).size > 0 : false;
  const canReviewTeam = manage || (can(actor, "performance:review", "TEAM") && hasTeam);

  const allowedLevels = manage ? ["COMPANY", "DEPARTMENT", "TEAM", "INDIVIDUAL"] : can(actor, "performance:write", "TEAM") ? ["TEAM", "INDIVIDUAL"] : ["INDIVIDUAL"];
  const parents = tab === "my" || tab === "team" ? (await listObjectives(actor, { page: 1, pageSize: 200, order: "asc", period: period.label })).items.filter((o) => o.level !== "INDIVIDUAL").map((o) => ({ id: o.id, title: o.title, level: o.level })) : [];
  const addDialog = me && can(actor, "performance:write") ? <AddObjectiveDialog allowedLevels={allowedLevels} defaultStart={isoDate(period.start)} defaultEnd={isoDate(period.end)} parents={parents} canPickOwner={manage || can(actor, "performance:write", "TEAM")} /> : null;

  return (
    <div>
      <PageHeader
        title="Performance"
        description="Objectives, reviews, 360° feedback and recognition."
        actions={
          <>
            <form className="flex items-center gap-2" action="/performance">
              <input type="hidden" name="tab" value={tab} />
              <select name="period" defaultValue={period.label} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30" aria-label="Period">
                {periodOptions().map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <Button type="submit" variant="outline" size="sm">Go</Button>
            </form>
            {manage && <Button variant="outline" nativeButton={false} render={<Link href="/performance/cycles" />}>Manage cycles</Button>}
            {(tab === "my" || tab === "team") && addDialog}
            {tab === "praise" && me && <GivePraiseDialog badges={PRAISE_BADGES} />}
          </>
        }
      />
      <LinkTabs tabs={TABS.filter((t) => t.key !== "team" || hasTeam || manage)} active={tab} hrefFor={hrefFor} />

      {!me && tab !== "company" && tab !== "praise" ? (
        <EmptyState title="No employee profile" description="This account is not linked to an employee record, so personal OKRs and reviews are not available." />
      ) : tab === "my" ? (
        <MyOkrs actorId={me!} period={period.label} />
      ) : tab === "team" ? (
        <TeamOkrs period={period.label} manage={manage} />
      ) : tab === "company" ? (
        <CompanyOkrs period={period.label} />
      ) : tab === "reviews" ? (
        <Reviews cycleParam={typeof sp.cycle === "string" ? sp.cycle : undefined} canReviewTeam={canReviewTeam} manage={manage} />
      ) : tab === "feedback" ? (
        <Feedback selfId={me!} canReviewTeam={canReviewTeam} />
      ) : (
        <Praise period={period.label} me={me} />
      )}
    </div>
  );

  async function MyOkrs({ actorId, period }: { actorId: string; period: string }) {
    const page = await listObjectives(actor, { page: 1, pageSize: 50, order: "desc", ownerId: actorId, period });
    if (page.items.length === 0) return <EmptyState title="No objectives this period" description="Create your first objective with two or three measurable key results." action={addDialog} />;
    const avg = Math.round(page.items.reduce((a, o) => a + o.progress, 0) / page.items.length);
    return (
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Objectives" value={page.total} />
          <StatCard label="Average progress" value={`${avg}%`} />
          <StatCard label="At risk / off track" value={page.items.filter((o) => o.status === "AT_RISK" || o.status === "OFF_TRACK").length} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">{page.items.map((o) => <ObjectiveCard key={o.id} objective={o} canEdit />)}</div>
      </div>
    );
  }

  async function TeamOkrs({ period, manage }: { period: string; manage: boolean }) {
    const page = await listObjectives(actor, { page: 1, pageSize: 100, order: "desc", period, team: "1" });
    if (page.items.length === 0) return <EmptyState title="No team objectives" description="Your reports have not created objectives for this period yet." />;
    const byOwner = new Map<string, typeof page.items>();
    for (const o of page.items) byOwner.set(o.ownerName, [...(byOwner.get(o.ownerName) ?? []), o]);
    return (
      <div className="grid gap-6">
        {[...byOwner.entries()].map(([owner, objs]) => (
          <section key={owner}>
            <h2 className="mb-2 text-sm font-semibold">{owner} <span className="font-normal text-muted-foreground">· {objs.length} objective{objs.length === 1 ? "" : "s"} · avg {Math.round(objs.reduce((a, o) => a + o.progress, 0) / objs.length)}%</span></h2>
            <div className="grid gap-4 lg:grid-cols-2">{objs.map((o) => <ObjectiveCard key={o.id} objective={o} canEdit={manage || can(actor, "performance:write", "TEAM")} />)}</div>
          </section>
        ))}
      </div>
    );
  }

  async function CompanyOkrs({ period }: { period: string }) {
    const tree = await okrTree(actor, period);
    if (tree.roots.length === 0) return <EmptyState title="No objectives in this period" description="Company and department objectives will appear here once created." />;
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">OKR explorer · {tree.period}</CardTitle></CardHeader>
        <CardContent><OkrTree nodes={tree.roots} /></CardContent>
      </Card>
    );
  }

  async function Reviews({ cycleParam, canReviewTeam, manage }: { cycleParam?: string; canReviewTeam: boolean; manage: boolean }) {
    const cycles = await listCycles(actor);
    const visibleCycles = cycles.filter((c) => c.status !== "DRAFT");
    const selected = (cycleParam && visibleCycles.find((c) => c.id === cycleParam)) || visibleCycles[0];
    const mine = selected ? await getMyReview(actor, selected.id) : null;
    const team = canReviewTeam && selected ? await listTeamReviews(actor, selected.id, { page: 1, pageSize: 100, order: "asc" }) : null;
    if (!selected) return <EmptyState title="No review cycle yet" description={manage ? "Create and launch a cycle from Manage cycles." : "HR has not launched a review cycle yet."} />;
    const steps = ["NOT_STARTED", "SELF_SUBMITTED", "MANAGER_SUBMITTED", "CALIBRATED", "SHARED"];
    return (
      <div className="grid gap-4">
        {visibleCycles.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {visibleCycles.map((c) => (
              <Button key={c.id} size="sm" variant={c.id === selected.id ? "default" : "outline"} nativeButton={false} render={<Link href={`/performance?tab=reviews&cycle=${c.id}`} />}>{c.name}</Button>
            ))}
          </div>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">{selected.name} <StatusBadge status={selected.status} /></CardTitle>
            <p className="text-xs text-muted-foreground">Period {fmtDate(selected.periodStart)} – {fmtDate(selected.periodEnd)} · self-review due {fmtDate(selected.selfReviewDue)} · manager review due {fmtDate(selected.managerReviewDue)}</p>
          </CardHeader>
          <CardContent>
            {!mine ? (
              <p className="text-sm text-muted-foreground">You are not part of this cycle (new joiners are excluded for their first 90 days).</p>
            ) : (
              <div className="grid gap-4">
                <ol className="flex flex-wrap gap-2 text-xs">
                  {steps.map((s, i) => {
                    const idx = steps.indexOf(mine.status);
                    const done = i <= idx;
                    return <li key={s} className={`rounded-full border px-2.5 py-1 ${done ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"}`}>{i + 1}. {s.replaceAll("_", " ")}</li>;
                  })}
                </ol>
                {mine.status === "NOT_STARTED" && selected.status === "ACTIVE" ? (
                  <SelfReviewForm reviewId={mine.id} questions={selected.questions} scale={selected.ratingScale} />
                ) : mine.status === "NOT_STARTED" ? (
                  <p className="text-sm text-muted-foreground">Self-review window has closed.</p>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <section>
                      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Your self-review · rated {mine.selfRating}/{selected.ratingScale} · {fmtDateTime(mine.selfSubmittedAt)}</h4>
                      <ReviewQuestionFields questions={selected.questions} scale={selected.ratingScale} readOnlyAnswers={mine.selfAnswers} prefix="ro." />
                    </section>
                    <section>
                      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Manager review {mine.reviewerName ? `by ${mine.reviewerName}` : ""}</h4>
                      {mine.status === "SHARED" ? (
                        <>
                          <div className="mb-3 grid grid-cols-2 gap-3">
                            <StatCard label="Manager rating" value={mine.managerRating ?? "—"} />
                            <StatCard label="Final rating" value={mine.finalRating ?? mine.managerRating ?? "—"} hint={`out of ${selected.ratingScale}`} />
                          </div>
                          <ReviewQuestionFields questions={selected.questions} scale={selected.ratingScale} readOnlyAnswers={mine.managerAnswers} prefix="rom." />
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">Results are shared when HR completes the cycle.</p>
                      )}
                    </section>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        {team && (
          <Card>
            <CardHeader><CardTitle className="text-base">Your team&apos;s reviews · {team.total}</CardTitle></CardHeader>
            <CardContent>
              {team.items.length === 0 && <p className="text-sm text-muted-foreground">No reports are part of this cycle.</p>}
              <ul className="divide-y">
                {team.items.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <div className="text-sm font-medium">{r.employeeName}</div>
                      <div className="text-xs text-muted-foreground">{r.designation ?? r.employeeCode}{r.selfRating !== null ? ` · self ${r.selfRating}` : ""}{r.managerRating !== null ? ` · manager ${r.managerRating}` : ""}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      <ManagerReviewDialog review={r} questions={selected.questions} scale={selected.ratingScale} cycleOpen={selected.status === "ACTIVE" || selected.status === "CALIBRATION"} />
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  async function Feedback({ selfId, canReviewTeam }: { selfId: string; canReviewTeam: boolean }) {
    const [toFill, aboutMe, cycles] = await Promise.all([listMyFeedbackRequests(actor), listFeedbackRequestsAboutMe(actor), listCycles(actor)]);
    const pending = toFill.filter((r) => r.status === "PENDING");
    return (
      <div className="grid gap-4">
        <div className="flex justify-end"><RequestFeedbackDialog selfId={selfId} canPickSubject={canReviewTeam} cycles={cycles.filter((c) => c.status === "ACTIVE").map((c) => ({ id: c.id, name: c.name }))} /></div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Requests for you {pending.length > 0 && <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-xs text-primary">{pending.length}</span>}</CardTitle></CardHeader>
            <CardContent>
              {toFill.length === 0 && <p className="text-sm text-muted-foreground">Nobody has asked for your feedback yet.</p>}
              <ul className="divide-y">
                {toFill.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <div>
                      <div className="text-sm font-medium">{r.subjectName}</div>
                      <div className="text-xs text-muted-foreground">{r.subjectDesignation ?? ""}{r.cycleName ? ` · ${r.cycleName}` : ""} · asked {fmtDate(r.createdAt)}</div>
                    </div>
                    {r.status === "PENDING" ? <SubmitFeedbackDialog request={r} /> : <StatusBadge status="SUBMITTED" />}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Feedback about you</CardTitle></CardHeader>
            <CardContent>
              {aboutMe.length === 0 && <p className="text-sm text-muted-foreground">Request feedback from colleagues to get started. Summaries are shared with your manager.</p>}
              <ul className="divide-y">
                {aboutMe.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span>{r.providerName}<span className="text-xs text-muted-foreground"> · {r.isAnonymous ? "anonymous" : "named"} · {fmtDate(r.createdAt)}</span></span>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
        {canReviewTeam && <FeedbackSummaryPanel />}
      </div>
    );
  }

  async function Praise({ period, me }: { period: string; me: string | null }) {
    const [wall, board] = await Promise.all([listPraise(actor, { page: 1, pageSize: 40, order: "desc" }), praiseLeaderboard(actor, period)]);
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-3 lg:col-span-2">
          {wall.items.length === 0 && <EmptyState title="The wall is empty" description="Be the first to recognise a colleague." action={me ? <GivePraiseDialog badges={PRAISE_BADGES} /> : undefined} />}
          {wall.items.map((p) => (
            <Card key={p.id} size="sm">
              <CardContent className="flex gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{p.toName.split(" ").map((s) => s[0]).slice(0, 2).join("")}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-medium">{p.fromName}</span>
                    <span className="text-muted-foreground">{p.kind === "PRAISE" ? "praised" : "gave private feedback to"}</span>
                    <span className="font-medium">{p.toName}</span>
                    {p.badge && <span className="rounded-full bg-amber-100 px-2 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{p.badge}</span>}
                    {!p.isPublic && <span className="rounded-full bg-zinc-100 px-2 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">private</span>}
                  </div>
                  <p className="mt-1 text-sm">{p.message}</p>
                  <div className="mt-1 text-xs text-muted-foreground">{fmtDateTime(p.createdAt)}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="self-start">
          <CardHeader><CardTitle className="text-base">Most praised · {board.period}</CardTitle></CardHeader>
          <CardContent>
            {board.items.length === 0 && <p className="text-sm text-muted-foreground">No praise in this period yet.</p>}
            <ol className="space-y-2">
              {board.items.map((b, i) => (
                <li key={b.employeeId} className="flex items-center justify-between text-sm">
                  <span><span className="mr-2 text-muted-foreground">{i + 1}.</span>{b.name}<span className="text-xs text-muted-foreground">{b.department ? ` · ${b.department}` : ""}</span></span>
                  <span className="tabular-nums">{b.count}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    );
  }
}

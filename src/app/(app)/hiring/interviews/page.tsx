import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatusBadge } from "@/components/common";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/dates";
import { InterviewFeedbackDialog } from "@/components/hiring/interview-feedback";
import { listMyInterviews } from "@/server/services/hiring";
import { HiringNav } from "@/components/hiring/hiring-nav";

export const metadata = { title: "My interviews" };

export default async function MyInterviewsPage() {
  const actor = await requireActor();
  if (!actor.employeeId || !can(actor, "hiring:interview")) return <div><PageHeader title="My interviews" /><EmptyState title="No employee profile" description="Interviews are assigned to employees." /></div>;
  const interviews = await listMyInterviews(actor);
  const upcoming = interviews.filter((i) => i.upcoming).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const past = interviews.filter((i) => !i.upcoming);
  const canRead = can(actor, "hiring:read");
  const Item = ({ i }: { i: (typeof interviews)[number] }) => (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {canRead ? <Link href={`/hiring/jobs/${i.jobId}?application=${i.applicationId}`} className="hover:underline">{i.candidateName}</Link> : i.candidateName}
            <span className="text-muted-foreground">· {i.jobTitle}</span>
            <StatusBadge status={i.status} />
          </div>
          <div className="text-xs text-muted-foreground">
            R{i.round} {i.title} · {fmtDateTime(i.scheduledAt)} IST · {i.durationMinutes} min · {i.mode}{i.candidateCompany ? ` · ${i.candidateCompany}` : ""} · {i.interviewerCount} interviewer{i.interviewerCount === 1 ? "" : "s"}
            {i.meetingLink && <> · <a href={i.meetingLink} target="_blank" rel="noreferrer" className="hover:underline">Join</a></>}
            {i.resumeUrl && <> · <a href={i.resumeUrl} target="_blank" rel="noreferrer" className="hover:underline">Resume</a></>}
          </div>
          {i.myFeedback && <div className="mt-1 text-xs">Your feedback: {"★".repeat(i.myFeedback.rating)} · {i.myFeedback.recommendation.replaceAll("_", " ")}</div>}
        </div>
        <InterviewFeedbackDialog interviewId={i.id} candidateName={i.candidateName} existing={i.myFeedback} />
      </CardContent>
    </Card>
  );
  return (
    <div>
      <PageHeader title="My interviews" description="Interviews where you are on the panel. Submit feedback after each round." />
      <HiringNav active="/hiring/interviews" />
      {interviews.length === 0 && <EmptyState title="No interviews" description="You will be notified when you are added to an interview panel." />}
      {upcoming.length > 0 && <section className="mb-6"><h2 className="mb-2 text-sm font-semibold">Upcoming · {upcoming.length}</h2><div className="grid gap-2">{upcoming.map((i) => <Item key={i.id} i={i} />)}</div></section>}
      {past.length > 0 && <section><h2 className="mb-2 text-sm font-semibold">Past · {past.length}</h2><div className="grid gap-2">{past.map((i) => <Item key={i.id} i={i} />)}</div></section>}
    </div>
  );
}

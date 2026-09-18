import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { NotFoundError } from "@/lib/errors";
import { fmtDate, fmtMoney } from "@/lib/dates";
import { JobActions, JobDialog } from "@/components/hiring/job-dialog";
import { AddCandidateDialog } from "@/components/hiring/add-candidate-dialog";
import { PipelineBoard } from "@/components/hiring/pipeline-board";
import { hiringLookups, pipeline } from "@/server/services/hiring";

export const metadata = { title: "Pipeline" };

export default async function JobPipelinePage({ params, searchParams }: PageProps<"/hiring/jobs/[id]">) {
  const actor = await requireActor();
  if (!can(actor, "hiring:read")) return <EmptyState title="Not available" description="Viewing pipelines requires the hiring:read permission." />;
  const { id } = await params;
  const sp = await searchParams;
  let data, lookups;
  try {
    [data, lookups] = await Promise.all([pipeline(actor, id), hiringLookups(actor)]);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { job } = data;
  const canWrite = can(actor, "hiring:write");
  const canManage = can(actor, "hiring:manage");
  return (
    <div>
      <PageHeader
        title={job.title}
        description={[job.departmentName, job.designationName, job.locationName, job.employmentType.replace("_", " "), `${job.openings} opening${job.openings === 1 ? "" : "s"}`, job.salaryMin || job.salaryMax ? `${job.salaryMin ? fmtMoney(job.salaryMin) : "—"} – ${job.salaryMax ? fmtMoney(job.salaryMax) : "—"}` : null].filter(Boolean).join(" · ")}
        breadcrumb={[{ label: "Hiring", href: "/hiring" }, { label: job.title }]}
        actions={
          <>
            <StatusBadge status={job.status} className="text-sm" />
            {job.status === "OPEN" && <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/careers/${job.slug}`} target="_blank" />}>Public page</Button>}
            {canWrite && <JobDialog lookups={lookups} job={{ id: job.id, title: job.title, departmentId: job.departmentId, designationId: job.designationId, locationId: job.locationId, employmentType: job.employmentType, openings: job.openings, description: job.description, requirements: job.requirements, minExperience: job.minExperience, maxExperience: job.maxExperience, salaryMin: job.salaryMin, salaryMax: job.salaryMax, hiringManagerId: job.hiringManagerId, hiringManagerName: job.hiringManagerName }} />}
            {canManage && <JobActions id={job.id} status={job.status} size="sm" />}
            {canWrite && job.status !== "CLOSED" && <AddCandidateDialog jobId={job.id} />}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Hiring manager: {job.hiringManagerName ?? "—"}</span>
        <span>Recruiter: {job.recruiterName ?? "—"}</span>
        <span>Created {fmtDate(job.createdAt)}</span>
        {job.publishedAt && <span>Published {fmtDate(job.publishedAt)}</span>}
        {data.withdrawn > 0 && <span>{data.withdrawn} withdrawn</span>}
        <span>{job.totalApplications} applications</span>
      </div>
      <PipelineBoard columns={data.columns} lookups={lookups} canWrite={canWrite} canManage={canManage} initialApplicationId={typeof sp.application === "string" ? sp.application : undefined} />
      <details className="mt-4 rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Job description</summary>
        <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{job.description}</p>
        {job.requirements && <><h4 className="mt-3 font-medium">Requirements</h4><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{job.requirements}</p></>}
      </details>
    </div>
  );
}

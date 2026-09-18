import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/dates";
import { JobActions, JobDialog } from "@/components/hiring/job-dialog";
import { hiringLookups, listJobs, PIPELINE_STAGES } from "@/server/services/hiring";
import { HiringNav } from "@/components/hiring/hiring-nav";

export const metadata = { title: "Hiring" };

export default async function HiringPage({ searchParams }: PageProps<"/hiring">) {
  const actor = await requireActor();
  const sp = await searchParams;
  if (!can(actor, "hiring:read")) {
    return (
      <div>
        <PageHeader title="Hiring" />
        <HiringNav active="/hiring" />
        <EmptyState title="Interviewer view" description="You can see interviews assigned to you under My interviews." action={<Button nativeButton={false} render={<Link href="/hiring/interviews" />}>My interviews</Button>} />
      </div>
    );
  }
  const status = typeof sp.status === "string" && ["DRAFT", "OPEN", "ON_HOLD", "CLOSED"].includes(sp.status) ? (sp.status as "DRAFT" | "OPEN" | "ON_HOLD" | "CLOSED") : undefined;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const page = Number(sp.page ?? 1) || 1;
  const [jobs, lookups] = await Promise.all([listJobs(actor, { page, pageSize: 25, order: "desc", status, q }), hiringLookups(actor)]);
  const open = jobs.items.filter((j) => j.status === "OPEN");
  const canWrite = can(actor, "hiring:write");
  const canManage = can(actor, "hiring:manage");
  return (
    <div>
      <PageHeader title="Hiring" description="Job openings, candidate pipeline and offers." actions={<>{canWrite && <JobDialog lookups={lookups} />}<Button variant="outline" nativeButton={false} render={<Link href="/careers" target="_blank" />}>Careers page</Button></>} />
      <HiringNav active="/hiring" />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Open jobs" value={open.length} hint={`${open.reduce((a, j) => a + j.openings, 0)} openings`} />
        <StatCard label="Active applications" value={jobs.items.reduce((a, j) => a + (j.counts.APPLIED ?? 0) + (j.counts.SCREENING ?? 0) + (j.counts.INTERVIEW ?? 0) + (j.counts.OFFER ?? 0), 0)} />
        <StatCard label="Hired" value={jobs.items.reduce((a, j) => a + (j.counts.HIRED ?? 0), 0)} hint="from jobs on this page" />
      </div>
      <form className="mb-3 flex flex-wrap gap-2" action="/hiring">
        <Input name="q" defaultValue={q} placeholder="Search title or department…" className="w-56" />
        <select name="status" defaultValue={status ?? ""} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30">
          <option value="">All statuses</option>
          {["OPEN", "DRAFT", "ON_HOLD", "CLOSED"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <Button type="submit" variant="outline" size="sm">Filter</Button>
      </form>
      {jobs.items.length === 0 ? (
        <EmptyState title="No jobs" description="Create a job opening to start hiring." action={canWrite ? <JobDialog lookups={lookups} /> : undefined} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Status</TableHead>
              {PIPELINE_STAGES.map((s) => <TableHead key={s} className="hidden text-center lg:table-cell">{s.charAt(0) + s.slice(1).toLowerCase()}</TableHead>)}
              <TableHead className="text-center lg:hidden">Apps</TableHead>
              <TableHead className="hidden md:table-cell">Recruiter</TableHead>
              {canManage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.items.map((j) => (
              <TableRow key={j.id}>
                <TableCell>
                  <Link href={`/hiring/jobs/${j.id}`} className="font-medium hover:underline">{j.title}</Link>
                  <div className="text-xs text-muted-foreground">{[j.departmentName, j.locationName, j.employmentType.replace("_", " ")].filter(Boolean).join(" · ")} · {j.openings} opening{j.openings === 1 ? "" : "s"}{j.publishedAt ? ` · published ${fmtDate(j.publishedAt)}` : ""}</div>
                </TableCell>
                <TableCell><StatusBadge status={j.status} /></TableCell>
                {PIPELINE_STAGES.map((s) => <TableCell key={s} className="hidden text-center tabular-nums lg:table-cell">{j.counts[s] ?? ""}</TableCell>)}
                <TableCell className="text-center tabular-nums lg:hidden">{j.totalApplications}</TableCell>
                <TableCell className="hidden md:table-cell">{j.recruiterName ?? "—"}</TableCell>
                {canManage && <TableCell><JobActions id={j.id} status={j.status} /></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {jobs.pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {jobs.page} of {jobs.pages}</span>
          <div className="flex gap-2">
            {jobs.page > 1 && <Button size="xs" variant="outline" nativeButton={false} render={<Link href={`/hiring?page=${jobs.page - 1}${status ? `&status=${status}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`} />}>Previous</Button>}
            {jobs.page < jobs.pages && <Button size="xs" variant="outline" nativeButton={false} render={<Link href={`/hiring?page=${jobs.page + 1}${status ? `&status=${status}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`} />}>Next</Button>}
          </div>
        </div>
      )}
    </div>
  );
}

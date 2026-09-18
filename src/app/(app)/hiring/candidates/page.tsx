import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/dates";
import { AddCandidateDialog } from "@/components/hiring/add-candidate-dialog";
import { listCandidates, listJobs } from "@/server/services/hiring";
import { HiringNav } from "@/components/hiring/hiring-nav";

export const metadata = { title: "Candidates" };

export default async function CandidatesPage({ searchParams }: PageProps<"/hiring/candidates">) {
  const actor = await requireActor();
  if (!can(actor, "hiring:read")) return <EmptyState title="Not available" description="Viewing candidates requires the hiring:read permission." />;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const page = Number(sp.page ?? 1) || 1;
  const [candidates, openJobs] = await Promise.all([listCandidates(actor, { page, pageSize: 25, order: "desc", q }), listJobs(actor, { page: 1, pageSize: 100, order: "desc", status: "OPEN" })]);
  const canWrite = can(actor, "hiring:write");
  return (
    <div>
      <PageHeader title="Candidates" description={`${candidates.total} in the talent pool`} actions={canWrite && <AddCandidateDialog jobs={openJobs.items.map((j) => ({ id: j.id, title: j.title }))} />} />
      <HiringNav active="/hiring/candidates" />
      <form className="mb-3 flex gap-2" action="/hiring/candidates">
        <Input name="q" defaultValue={q} placeholder="Search name, email, company or skill…" className="w-72" />
        <Button type="submit" variant="outline" size="sm">Search</Button>
      </form>
      {candidates.items.length === 0 ? (
        <EmptyState title="No candidates" description={q ? "Try a different search." : "Candidates appear here when they apply or are added."} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Candidate</TableHead>
              <TableHead className="hidden md:table-cell">Company</TableHead>
              <TableHead className="hidden lg:table-cell">Expected CTC</TableHead>
              <TableHead className="hidden sm:table-cell">Source</TableHead>
              <TableHead>Applications</TableHead>
              <TableHead className="hidden md:table-cell">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.items.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="font-medium">{c.firstName} {c.lastName}</div>
                  <div className="text-xs text-muted-foreground">{c.email}{c.phone ? ` · ${c.phone}` : ""}</div>
                  {c.skills.length > 0 && <div className="mt-0.5 flex flex-wrap gap-1">{c.skills.slice(0, 5).map((s) => <span key={s} className="rounded-full bg-secondary px-1.5 text-[10px]">{s}</span>)}</div>}
                </TableCell>
                <TableCell className="hidden md:table-cell">{c.currentCompany ?? "—"}</TableCell>
                <TableCell className="hidden lg:table-cell">{c.expectedCtc != null ? fmtMoney(c.expectedCtc) : "—"}</TableCell>
                <TableCell className="hidden sm:table-cell">{c.source ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {c.applications.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                    {c.applications.map((a) => (
                      <Link key={a.id} href={`/hiring/jobs/${a.jobId}?application=${a.id}`} className="inline-flex items-center gap-1 text-xs hover:underline">
                        {a.jobTitle} <StatusBadge status={a.stage} />
                      </Link>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{fmtDate(c.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {candidates.pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {candidates.page} of {candidates.pages}</span>
          <div className="flex gap-2">
            {candidates.page > 1 && <Button size="xs" variant="outline" nativeButton={false} render={<Link href={`/hiring/candidates?page=${candidates.page - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`} />}>Previous</Button>}
            {candidates.page < candidates.pages && <Button size="xs" variant="outline" nativeButton={false} render={<Link href={`/hiring/candidates?page=${candidates.page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`} />}>Next</Button>}
          </div>
        </div>
      )}
    </div>
  );
}

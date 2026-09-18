import Link from "next/link";
import { MapPin, Briefcase, Clock } from "lucide-react";
import { listPublicJobs } from "@/server/services/hiring";

export const metadata = { title: "Open roles" };

export default async function CareersPage() {
  const jobs = await listPublicJobs();
  const byDept = new Map<string, typeof jobs>();
  for (const j of jobs) byDept.set(j.department ?? "Other", [...(byDept.get(j.department ?? "Other") ?? []), j]);
  return (
    <div>
      <section className="mb-10 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Build the future of work with us</h1>
        <p className="mt-3 text-muted-foreground">We are a 2,000-strong team across India. Browse {jobs.length} open role{jobs.length === 1 ? "" : "s"} and apply in under two minutes.</p>
      </section>
      {jobs.length === 0 && <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No open roles right now. Check back soon.</div>}
      {[...byDept.entries()].map(([dept, list]) => (
        <section key={dept} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{dept}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.map((j) => (
              <li key={j.id}>
                <Link href={`/careers/${j.slug}`} className="block rounded-xl border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-muted/40">
                  <div className="font-medium">{j.title}</div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {j.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3" /> {j.location}</span>}
                    <span className="inline-flex items-center gap-1"><Briefcase className="size-3" /> {j.employmentType.replace("_", " ").toLowerCase()}</span>
                    {(j.minExperience != null || j.maxExperience != null) && <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {j.minExperience ?? 0}{j.maxExperience != null ? `–${j.maxExperience}` : "+"} yrs</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

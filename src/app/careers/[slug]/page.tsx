import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, Briefcase, Clock, Users } from "lucide-react";
import { NotFoundError } from "@/lib/errors";
import { getPublicJob } from "@/server/services/hiring";
import { ApplyForm } from "./apply-form";

export async function generateMetadata({ params }: PageProps<"/careers/[slug]">) {
  const { slug } = await params;
  try {
    const job = await getPublicJob(slug);
    return { title: job.title, description: job.description.slice(0, 160) };
  } catch {
    return { title: "Job not found" };
  }
}

export default async function CareerJobPage({ params }: PageProps<"/careers/[slug]">) {
  const { slug } = await params;
  let job;
  try {
    job = await getPublicJob(slug);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
      <article>
        <Link href="/careers" className="text-sm text-muted-foreground hover:text-foreground">← All roles</Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{job.title}</h1>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {job.department && <span>{job.department}</span>}
          {job.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> {job.location}</span>}
          <span className="inline-flex items-center gap-1"><Briefcase className="size-3.5" /> {job.employmentType.replace("_", " ").toLowerCase()}</span>
          {(job.minExperience != null || job.maxExperience != null) && <span className="inline-flex items-center gap-1"><Clock className="size-3.5" /> {job.minExperience ?? 0}{job.maxExperience != null ? `–${job.maxExperience}` : "+"} years</span>}
          {job.openings > 1 && <span className="inline-flex items-center gap-1"><Users className="size-3.5" /> {job.openings} openings</span>}
        </div>
        <section className="prose prose-sm mt-6 max-w-none dark:prose-invert">
          <h2 className="text-base font-semibold">About the role</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{job.description}</p>
          {job.requirements && (
            <>
              <h2 className="mt-6 text-base font-semibold">What we are looking for</h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{job.requirements}</p>
            </>
          )}
        </section>
      </article>
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-base font-semibold">Apply for this role</h2>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">We will reach out on email within a week.</p>
          <ApplyForm slug={job.slug} />
        </div>
      </aside>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client/api";

/** Create (or reuse by email) a candidate, optionally upload a resume, and optionally apply them to `jobId`. */
export function AddCandidateDialog({ jobId, jobs }: { jobId?: string; jobs?: { id: string; title: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const resume = fd.get("resume");
    const targetJob = jobId ?? (fd.get("jobId") ? String(fd.get("jobId")) : null);
    setBusy(true);
    try {
      const c = await apiFetch<{ id: string; reused: boolean }>("/api/v1/candidates", {
        method: "POST",
        body: {
          firstName: fd.get("firstName"),
          lastName: fd.get("lastName"),
          email: fd.get("email"),
          phone: fd.get("phone") || null,
          linkedinUrl: fd.get("linkedinUrl") || null,
          currentCompany: fd.get("currentCompany") || null,
          currentCtc: fd.get("currentCtc") ? Number(fd.get("currentCtc")) : null,
          expectedCtc: fd.get("expectedCtc") ? Number(fd.get("expectedCtc")) : null,
          noticePeriodDays: fd.get("noticePeriodDays") ? Number(fd.get("noticePeriodDays")) : null,
          source: fd.get("source") || "MANUAL",
          skills: String(fd.get("skills") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
      if (resume instanceof File && resume.size > 0) {
        const up = new FormData();
        up.append("resume", resume);
        const res = await fetch(`/api/v1/candidates/${c.id}/resume`, { method: "POST", body: up });
        if (!res.ok) toast.warning("Candidate saved but the resume upload failed");
      }
      if (targetJob) await apiFetch("/api/v1/applications", { method: "POST", body: { jobId: targetJob, candidateId: c.id } });
      toast.success(c.reused ? "Existing candidate reused" : "Candidate added");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={jobId ? "default" : "outline"} />}><Plus /> Add candidate</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid max-h-[85vh] gap-4 overflow-y-auto pr-1">
          <DialogHeader>
            <DialogTitle>Add candidate</DialogTitle>
            <DialogDescription>Candidates are matched by email, so re-adding someone links to their existing profile.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="c-fn">First name</Label><Input id="c-fn" name="firstName" required /></div>
            <div className="grid gap-1.5"><Label htmlFor="c-ln">Last name</Label><Input id="c-ln" name="lastName" required /></div>
            <div className="grid gap-1.5"><Label htmlFor="c-email">Email</Label><Input id="c-email" name="email" type="email" required /></div>
            <div className="grid gap-1.5"><Label htmlFor="c-phone">Phone</Label><Input id="c-phone" name="phone" /></div>
            <div className="grid gap-1.5"><Label htmlFor="c-company">Current company</Label><Input id="c-company" name="currentCompany" /></div>
            <div className="grid gap-1.5"><Label htmlFor="c-linkedin">LinkedIn URL</Label><Input id="c-linkedin" name="linkedinUrl" type="url" placeholder="https://linkedin.com/in/…" /></div>
            <div className="grid gap-1.5"><Label htmlFor="c-cctc">Current CTC (₹)</Label><Input id="c-cctc" name="currentCtc" type="number" min={0} /></div>
            <div className="grid gap-1.5"><Label htmlFor="c-ectc">Expected CTC (₹)</Label><Input id="c-ectc" name="expectedCtc" type="number" min={0} /></div>
            <div className="grid gap-1.5"><Label htmlFor="c-notice">Notice period (days)</Label><Input id="c-notice" name="noticePeriodDays" type="number" min={0} /></div>
            <div className="grid gap-1.5"><Label htmlFor="c-source">Source</Label><Input id="c-source" name="source" placeholder="REFERRAL, LINKEDIN, AGENCY…" /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="c-skills">Skills (comma separated)</Label><Input id="c-skills" name="skills" placeholder="TypeScript, PostgreSQL" /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="c-resume">Resume (PDF/DOCX, max 10 MB)</Label><Input id="c-resume" name="resume" type="file" accept=".pdf,.docx,image/*" /></div>
            {!jobId && jobs && jobs.length > 0 && (
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="c-job">Apply to job (optional)</Label>
                <select id="c-job" name="jobId" defaultValue="" className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30">
                  <option value="">—</option>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
                </select>
              </div>
            )}
          </div>
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>{jobId ? "Add & apply" : "Add candidate"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ApplyForm({ slug }: { slug: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData(e.currentTarget);
      const res = await fetch(`/api/v1/public/jobs/${encodeURIComponent(slug)}/apply`, { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = (json?.error?.details as { path: string; message: string }[] | undefined)?.map((d) => `${d.path}: ${d.message}`).join("; ");
        throw new Error(details || json?.error?.message || "Something went wrong");
      }
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100">
        <div className="font-medium">Application received</div>
        <p className="mt-1">Thanks for applying. Our recruiting team will review your profile and get in touch by email.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label htmlFor="ap-fn">First name</Label><Input id="ap-fn" name="firstName" required autoComplete="given-name" /></div>
        <div className="grid gap-1.5"><Label htmlFor="ap-ln">Last name</Label><Input id="ap-ln" name="lastName" required autoComplete="family-name" /></div>
      </div>
      <div className="grid gap-1.5"><Label htmlFor="ap-email">Email</Label><Input id="ap-email" name="email" type="email" required autoComplete="email" /></div>
      <div className="grid gap-1.5"><Label htmlFor="ap-phone">Phone</Label><Input id="ap-phone" name="phone" type="tel" autoComplete="tel" /></div>
      <div className="grid gap-1.5"><Label htmlFor="ap-company">Current company</Label><Input id="ap-company" name="currentCompany" /></div>
      <div className="grid gap-1.5"><Label htmlFor="ap-linkedin">LinkedIn URL</Label><Input id="ap-linkedin" name="linkedinUrl" type="url" placeholder="https://linkedin.com/in/…" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5"><Label htmlFor="ap-ctc">Expected CTC (₹ p.a.)</Label><Input id="ap-ctc" name="expectedCtc" type="number" min={0} /></div>
        <div className="grid gap-1.5"><Label htmlFor="ap-notice">Notice period (days)</Label><Input id="ap-notice" name="noticePeriodDays" type="number" min={0} /></div>
      </div>
      <div className="grid gap-1.5"><Label htmlFor="ap-resume">Resume (PDF or DOCX, up to 10 MB)</Label><Input id="ap-resume" name="resume" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /></div>
      {error && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-900 dark:bg-red-900/30 dark:text-red-100">{error}</p>}
      <Button type="submit" disabled={busy} className="mt-1">{busy ? "Submitting…" : "Submit application"}</Button>
      <p className="text-[11px] text-muted-foreground">By applying you agree to us storing your details for recruitment purposes.</p>
    </form>
  );
}

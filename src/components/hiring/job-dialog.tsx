"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";
import { EmployeePicker, type PickedEmployee } from "@/components/performance/employee-picker";

export interface Lookups { departments: { id: string; name: string }[]; designations: { id: string; name: string }[]; locations: { id: string; name: string }[] }
const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "CONSULTANT"];

interface JobFormValues {
  id?: string;
  title: string;
  departmentId: string | null;
  designationId: string | null;
  locationId: string | null;
  employmentType: string;
  openings: number;
  description: string;
  requirements: string | null;
  minExperience: number | null;
  maxExperience: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  hiringManagerId: string | null;
  hiringManagerName: string | null;
}

export function JobDialog({ lookups, job }: { lookups: Lookups; job?: JobFormValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hm, setHm] = useState<PickedEmployee[]>(job?.hiringManagerId ? [{ id: job.hiringManagerId, name: job.hiringManagerName ?? "Hiring manager", code: "", designation: null }] : []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const num = (k: string) => (fd.get(k) === "" || fd.get(k) === null ? null : Number(fd.get(k)));
    const body = {
      title: fd.get("title"),
      departmentId: fd.get("departmentId") || null,
      designationId: fd.get("designationId") || null,
      locationId: fd.get("locationId") || null,
      employmentType: fd.get("employmentType"),
      openings: Number(fd.get("openings")),
      description: fd.get("description"),
      requirements: fd.get("requirements") || null,
      minExperience: num("minExperience"),
      maxExperience: num("maxExperience"),
      salaryMin: num("salaryMin"),
      salaryMax: num("salaryMax"),
      hiringManagerId: hm[0]?.id ?? null,
    };
    setBusy(true);
    try {
      if (job?.id) await apiFetch(`/api/v1/jobs/${job.id}`, { method: "PATCH", body });
      else await apiFetch("/api/v1/jobs", { method: "POST", body });
      toast.success(job?.id ? "Job updated" : "Job created as draft");
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
      <DialogTrigger render={job ? <Button variant="outline" size="sm" /> : <Button />}>{job ? "Edit" : <><Plus /> New job</>}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid max-h-[85vh] gap-4 overflow-y-auto pr-1">
          <DialogHeader><DialogTitle>{job ? "Edit job" : "New job opening"}</DialogTitle></DialogHeader>
          <div className="grid gap-1.5"><Label htmlFor="job-title">Title</Label><Input id="job-title" name="title" required defaultValue={job?.title} placeholder="Senior Backend Engineer" /></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label htmlFor="job-dept">Department</Label><NativeSelect id="job-dept" name="departmentId" defaultValue={job?.departmentId ?? ""}><option value="">—</option>{lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></div>
            <div className="grid gap-1.5"><Label htmlFor="job-desig">Designation</Label><NativeSelect id="job-desig" name="designationId" defaultValue={job?.designationId ?? ""}><option value="">—</option>{lookups.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></div>
            <div className="grid gap-1.5"><Label htmlFor="job-loc">Location</Label><NativeSelect id="job-loc" name="locationId" defaultValue={job?.locationId ?? ""}><option value="">—</option>{lookups.locations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></div>
            <div className="grid gap-1.5"><Label htmlFor="job-type">Employment type</Label><NativeSelect id="job-type" name="employmentType" defaultValue={job?.employmentType ?? "FULL_TIME"}>{EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}</NativeSelect></div>
            <div className="grid gap-1.5"><Label htmlFor="job-openings">Openings</Label><Input id="job-openings" name="openings" type="number" min={1} defaultValue={job?.openings ?? 1} required /></div>
            <div className="grid gap-1.5"><Label>Hiring manager</Label><EmployeePicker value={hm} onChange={setHm} placeholder="Search…" /></div>
            <div className="grid gap-1.5"><Label htmlFor="job-minexp">Min experience (yrs)</Label><Input id="job-minexp" name="minExperience" type="number" min={0} defaultValue={job?.minExperience ?? ""} /></div>
            <div className="grid gap-1.5"><Label htmlFor="job-maxexp">Max experience (yrs)</Label><Input id="job-maxexp" name="maxExperience" type="number" min={0} defaultValue={job?.maxExperience ?? ""} /></div>
            <div />
            <div className="grid gap-1.5"><Label htmlFor="job-smin">Salary min (₹ p.a.)</Label><Input id="job-smin" name="salaryMin" type="number" min={0} defaultValue={job?.salaryMin ?? ""} /></div>
            <div className="grid gap-1.5"><Label htmlFor="job-smax">Salary max (₹ p.a.)</Label><Input id="job-smax" name="salaryMax" type="number" min={0} defaultValue={job?.salaryMax ?? ""} /></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="job-desc">Description</Label><Textarea id="job-desc" name="description" required minLength={10} rows={5} defaultValue={job?.description} /></div>
          <div className="grid gap-1.5"><Label htmlFor="job-req">Requirements</Label><Textarea id="job-req" name="requirements" rows={4} defaultValue={job?.requirements ?? ""} /></div>
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>{job ? "Save" : "Create draft"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function JobActions({ id, status, size = "xs" }: { id: string; status: string; size?: "xs" | "sm" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(path: string, confirmText: string, done: string) {
    if (!confirm(confirmText)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/jobs/${id}${path}`, { method: "POST" });
      toast.success(done);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex gap-1.5">
      {(status === "DRAFT" || status === "ON_HOLD") && <Button size={size} disabled={busy} onClick={() => act("/publish", "Publish this job on the public careers page?", "Job published")}>Publish</Button>}
      {status !== "CLOSED" && <Button size={size} variant="outline" disabled={busy} onClick={() => act("/close", "Close this job? It will be removed from the careers page.", "Job closed")}>Close</Button>}
    </div>
  );
}

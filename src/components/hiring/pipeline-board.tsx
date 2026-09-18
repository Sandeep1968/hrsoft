"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/common/native-select";
import { StatusBadge, DL } from "@/components/common";
import { apiFetch } from "@/lib/client/api";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { EmployeePicker, type PickedEmployee } from "@/components/performance/employee-picker";
import type { Lookups } from "./job-dialog";
import type { ApplicationDto } from "@/server/services/hiring";

export interface PipelineCard {
  id: string;
  stage: string;
  rating: number | null;
  appliedAt: string;
  name: string;
  email: string;
  currentCompany: string | null;
  expectedCtc: number | null;
  source: string | null;
  hasResume: boolean;
  interviews: number;
  offerStatus: string | null;
}
export interface PipelineColumn { stage: string; items: PipelineCard[] }

const MOVABLE = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"];
const COLUMN_TONE: Record<string, string> = {
  APPLIED: "border-t-blue-500",
  SCREENING: "border-t-amber-500",
  INTERVIEW: "border-t-purple-500",
  OFFER: "border-t-teal-500",
  HIRED: "border-t-emerald-500",
  REJECTED: "border-t-red-400",
};

export function PipelineBoard({ columns, lookups, canWrite, canManage, initialApplicationId }: { columns: PipelineColumn[]; lookups: Lookups; canWrite: boolean; canManage: boolean; initialApplicationId?: string }) {
  const [openId, setOpenId] = useState<string | null>(initialApplicationId ?? null);
  const close = useCallback(() => setOpenId(null), []);
  return (
    <>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 md:mx-0 md:px-0">
        {columns.map((col) => (
          <section key={col.stage} className={cn("w-64 shrink-0 snap-start rounded-xl border border-t-4 bg-muted/30", COLUMN_TONE[col.stage])}>
            <header className="flex items-center justify-between px-3 py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide">{col.stage}</h3>
              <span className="rounded-full bg-background px-2 text-xs tabular-nums">{col.items.length}</span>
            </header>
            <div className="grid gap-2 px-2 pb-2">
              {col.items.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Empty</p>}
              {col.items.map((a) => (
                <button key={a.id} type="button" onClick={() => setOpenId(a.id)} className="rounded-lg border bg-card p-2.5 text-left shadow-xs transition-colors hover:border-primary/50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{a.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{a.currentCompany ?? a.email}</div>
                    </div>
                    {a.rating !== null && <span className="shrink-0 text-xs text-amber-600">{"★".repeat(a.rating)}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5">{fmtDate(a.appliedAt)}</span>
                    {a.source && <span className="rounded bg-muted px-1.5 py-0.5">{a.source}</span>}
                    {a.interviews > 0 && <span className="rounded bg-muted px-1.5 py-0.5">{a.interviews} interview{a.interviews === 1 ? "" : "s"}</span>}
                    {a.offerStatus && <span className="rounded bg-teal-100 px-1.5 py-0.5 text-teal-900 dark:bg-teal-900/40 dark:text-teal-100">offer {a.offerStatus.toLowerCase()}</span>}
                    {a.hasResume && <span className="rounded bg-muted px-1.5 py-0.5">resume</span>}
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {openId && <ApplicationDrawer id={openId} lookups={lookups} canWrite={canWrite} canManage={canManage} onClose={close} />}
    </>
  );
}

function ApplicationDrawer({ id, lookups, canWrite, canManage, onClose }: { id: string; lookups: Lookups; canWrite: boolean; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [app, setApp] = useState<ApplicationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    try {
      const a = await apiFetch<ApplicationDto>(`/api/v1/applications/${id}`);
      setApp(a);
      setNotes(a.notes ?? "");
    } catch (err) {
      toast.error((err as Error).message);
      onClose();
    }
  }, [id, onClose]);
  useEffect(() => {
    let cancelled = false;
    apiFetch<ApplicationDto>(`/api/v1/applications/${id}`)
      .then((a) => {
        if (cancelled) return;
        setApp(a);
        setNotes(a.notes ?? "");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        toast.error(err.message);
        onClose();
      });
    return () => {
      cancelled = true;
    };
  }, [id, onClose]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
      await load();
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function moveStage(stage: string) {
    if (!app || stage === app.stage) return;
    let rejectionReason: string | null = null;
    if (stage === "REJECTED") {
      rejectionReason = prompt("Reason for rejection (optional)");
      if (rejectionReason === null) return;
    }
    await run(() => apiFetch(`/api/v1/applications/${id}/stage`, { method: "POST", body: { stage, rejectionReason: rejectionReason || null } }), `Moved to ${stage}`);
  }

  const c = app?.candidate;
  const terminal = app ? ["HIRED", "REJECTED", "WITHDRAWN"].includes(app.stage) : true;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-xl">
        {!app || !c ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid gap-5">
            <SheetHeader className="p-0">
              <SheetTitle className="flex flex-wrap items-center gap-2">{c.firstName} {c.lastName} <StatusBadge status={app.stage} /></SheetTitle>
              <SheetDescription>{app.jobTitle} · applied {fmtDate(app.appliedAt)}{c.source ? ` via ${c.source}` : ""}</SheetDescription>
            </SheetHeader>

            <section className="grid gap-2">
              <DL items={[
                { label: "Email", value: <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a> },
                { label: "Phone", value: c.phone ?? "—" },
                { label: "Current company", value: c.currentCompany ?? "—" },
                { label: "Notice period", value: c.noticePeriodDays != null ? `${c.noticePeriodDays} days` : "—" },
                { label: "Current CTC", value: c.currentCtc != null ? fmtMoney(c.currentCtc) : "—" },
                { label: "Expected CTC", value: c.expectedCtc != null ? fmtMoney(c.expectedCtc) : "—" },
                { label: "LinkedIn", value: c.linkedinUrl ? <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="hover:underline">Profile</a> : "—" },
                { label: "Resume", value: c.resumeUrl ? <a href={c.resumeUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">Download</a> : "Not uploaded" },
              ]} />
              {c.skills.length > 0 && <div className="flex flex-wrap gap-1">{c.skills.map((s) => <span key={s} className="rounded-full bg-secondary px-2 py-0.5 text-xs">{s}</span>)}</div>}
              {app.rejectionReason && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-900 dark:bg-red-900/30 dark:text-red-100">Rejected: {app.rejectionReason}</p>}
            </section>

            {canWrite && (
              <section className="grid gap-3 rounded-lg border p-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="stage">Stage</Label>
                  <NativeSelect id="stage" value={app.stage} disabled={busy || app.stage === "HIRED"} onChange={(e) => moveStage(e.target.value)}>
                    {(app.stage === "HIRED" ? ["HIRED"] : MOVABLE.filter((s) => s !== "OFFER" || canManage || app.stage === "OFFER")).map((s) => <option key={s} value={s}>{s}</option>)}
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label>Rating</Label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" disabled={busy} onClick={() => run(() => apiFetch(`/api/v1/applications/${id}`, { method: "PATCH", body: { rating: n } }))} className={cn("text-xl leading-none", (app.rating ?? 0) >= n ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-400")} aria-label={`Rate ${n}`}>★</button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                  {notes !== (app.notes ?? "") && <div><Button size="xs" variant="outline" disabled={busy} onClick={() => run(() => apiFetch(`/api/v1/applications/${id}`, { method: "PATCH", body: { notes } }), "Notes saved")}>Save notes</Button></div>}
                </div>
              </section>
            )}

            <section className="grid gap-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Interviews</h4>
                {canWrite && !terminal && <ScheduleInterviewDialog applicationId={id} nextRound={app.interviews.length + 1} onDone={load} />}
              </div>
              {app.interviews.length === 0 && <p className="text-xs text-muted-foreground">No interviews scheduled.</p>}
              {app.interviews.map((i) => (
                <div key={i.id} className="rounded-lg border p-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-medium">R{i.round} · {i.title}</span>
                    <StatusBadge status={i.status} />
                  </div>
                  <div className="text-xs text-muted-foreground">{fmtDateTime(i.scheduledAt)} · {i.durationMinutes} min · {i.mode}{i.meetingLink && <> · <a href={i.meetingLink} className="hover:underline" target="_blank" rel="noreferrer">Join</a></>}</div>
                  <div className="mt-1 text-xs">Interviewers: {i.interviewers.map((x) => x.name).join(", ")}</div>
                  {i.feedback.length > 0 && (
                    <ul className="mt-2 space-y-1.5 border-t pt-2">
                      {i.feedback.map((f) => (
                        <li key={f.id} className="text-xs">
                          <span className="font-medium">{f.interviewerName}</span> · {"★".repeat(f.rating)} · <span className={cn(f.recommendation.includes("NO") ? "text-red-600" : "text-emerald-600")}>{f.recommendation.replaceAll("_", " ")}</span>
                          {f.notes && <p className="mt-0.5 text-muted-foreground">{f.notes}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>

            <section className="grid gap-2">
              <h4 className="text-sm font-semibold">Offer</h4>
              {app.offer ? (
                <div className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-medium">{app.offer.designationName ?? app.jobTitle}</span>
                    <StatusBadge status={app.offer.status} />
                  </div>
                  <div className="text-xs text-muted-foreground">{fmtMoney(app.offer.annualCtc)} p.a. · joining {fmtDate(app.offer.joiningDate)}{app.offer.sentAt ? ` · sent ${fmtDate(app.offer.sentAt)}` : ""}{app.offer.respondedAt ? ` · responded ${fmtDate(app.offer.respondedAt)}` : ""}</div>
                  {canManage && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {app.offer.status === "DRAFT" && <Button size="xs" disabled={busy} onClick={() => run(() => apiFetch(`/api/v1/offers/${app.offer!.id}/send`, { method: "POST" }), "Offer emailed to candidate")}>Send offer</Button>}
                      {app.offer.status === "SENT" && (
                        <>
                          <Button size="xs" disabled={busy} onClick={() => run(() => apiFetch(`/api/v1/offers/${app.offer!.id}/respond`, { method: "POST", body: { response: "ACCEPTED" } }), "Recorded: accepted")}>Record accepted</Button>
                          <Button size="xs" variant="outline" disabled={busy} onClick={() => run(() => apiFetch(`/api/v1/offers/${app.offer!.id}/respond`, { method: "POST", body: { response: "DECLINED" } }), "Recorded: declined")}>Record declined</Button>
                        </>
                      )}
                      {app.offer.status === "ACCEPTED" && app.stage !== "HIRED" && <ConvertDialog applicationId={id} candidateName={`${c.firstName} ${c.lastName}`} lookups={lookups} onDone={load} />}
                      {app.offer.status === "DECLINED" && <OfferDialog applicationId={id} lookups={lookups} onDone={load} label="New offer" />}
                    </div>
                  )}
                  {app.stage === "HIRED" && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">Converted to employee.</p>}
                </div>
              ) : canManage && !terminal ? (
                <OfferDialog applicationId={id} lookups={lookups} onDone={load} label="Create offer" />
              ) : (
                <p className="text-xs text-muted-foreground">No offer yet.</p>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ScheduleInterviewDialog({ applicationId, nextRound, onDone }: { applicationId: string; nextRound: number; onDone: () => Promise<void> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [interviewers, setInterviewers] = useState<PickedEmployee[]>([]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (interviewers.length === 0) return toast.error("Add at least one interviewer");
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await apiFetch(`/api/v1/applications/${applicationId}/interviews`, {
        method: "POST",
        body: { title: fd.get("title"), round: Number(fd.get("round")), scheduledAt: new Date(String(fd.get("scheduledAt"))).toISOString(), durationMinutes: Number(fd.get("durationMinutes")), mode: fd.get("mode"), meetingLink: fd.get("meetingLink") || null, interviewerIds: interviewers.map((i) => i.id) },
      });
      toast.success("Interview scheduled; interviewers notified");
      setOpen(false);
      setInterviewers([]);
      await onDone();
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="outline" />}>Schedule</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-3">
          <DialogHeader><DialogTitle>Schedule interview</DialogTitle></DialogHeader>
          <div className="grid gap-1.5"><Label htmlFor="iv-title">Title</Label><Input id="iv-title" name="title" required placeholder="Technical round" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="iv-round">Round</Label><Input id="iv-round" name="round" type="number" min={1} defaultValue={nextRound} /></div>
            <div className="grid gap-1.5"><Label htmlFor="iv-dur">Duration (min)</Label><Input id="iv-dur" name="durationMinutes" type="number" min={15} step={15} defaultValue={60} /></div>
            <div className="grid gap-1.5 col-span-2"><Label htmlFor="iv-at">When</Label><Input id="iv-at" name="scheduledAt" type="datetime-local" required /></div>
            <div className="grid gap-1.5"><Label htmlFor="iv-mode">Mode</Label><NativeSelect id="iv-mode" name="mode" defaultValue="VIDEO"><option value="VIDEO">Video</option><option value="ONSITE">Onsite</option><option value="PHONE">Phone</option></NativeSelect></div>
            <div className="grid gap-1.5"><Label htmlFor="iv-link">Meeting link</Label><Input id="iv-link" name="meetingLink" type="url" placeholder="https://meet…" /></div>
          </div>
          <div className="grid gap-1.5"><Label>Interviewers</Label><EmployeePicker value={interviewers} onChange={setInterviewers} multiple /></div>
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>Schedule</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OfferDialog({ applicationId, lookups, onDone, label }: { applicationId: string; lookups: Lookups; onDone: () => Promise<void>; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await apiFetch(`/api/v1/applications/${applicationId}/offer`, { method: "POST", body: { designationId: fd.get("designationId") || null, annualCtc: Number(fd.get("annualCtc")), joiningDate: fd.get("joiningDate") } });
      toast.success("Offer drafted");
      setOpen(false);
      await onDone();
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" />}>{label}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-3">
          <DialogHeader><DialogTitle>{label}</DialogTitle></DialogHeader>
          <div className="grid gap-1.5"><Label htmlFor="of-desig">Designation</Label><NativeSelect id="of-desig" name="designationId" defaultValue=""><option value="">—</option>{lookups.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></div>
          <div className="grid gap-1.5"><Label htmlFor="of-ctc">Annual CTC (₹)</Label><Input id="of-ctc" name="annualCtc" type="number" min={1} required /></div>
          <div className="grid gap-1.5"><Label htmlFor="of-date">Joining date</Label><Input id="of-date" name="joiningDate" type="date" required /></div>
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>Save draft</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({ applicationId, candidateName, lookups, onDone }: { applicationId: string; candidateName: string; lookups: Lookups; onDone: () => Promise<void> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manager, setManager] = useState<PickedEmployee[]>([]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await apiFetch<{ employeeCode: string; jobClosed: boolean }>(`/api/v1/applications/${applicationId}/convert`, { method: "POST", body: { workEmail: fd.get("workEmail"), departmentId: fd.get("departmentId") || null, locationId: fd.get("locationId") || null, managerId: manager[0]?.id ?? null } });
      toast.success(`Employee ${r.employeeCode} created${r.jobClosed ? " · job closed (all openings filled)" : ""}`);
      setOpen(false);
      await onDone();
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" />}>Convert to employee</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-3">
          <DialogHeader><DialogTitle>Convert {candidateName} to employee</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">Designation, CTC and joining date come from the accepted offer. A user account and invite email are created.</p>
          <div className="grid gap-1.5"><Label htmlFor="cv-email">Work email</Label><Input id="cv-email" name="workEmail" type="email" required placeholder="first.last@acme.example" /></div>
          <div className="grid gap-1.5"><Label htmlFor="cv-dept">Department (defaults to the job&apos;s)</Label><NativeSelect id="cv-dept" name="departmentId" defaultValue=""><option value="">—</option>{lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></div>
          <div className="grid gap-1.5"><Label htmlFor="cv-loc">Location (defaults to the job&apos;s)</Label><NativeSelect id="cv-loc" name="locationId" defaultValue=""><option value="">—</option>{lookups.locations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></div>
          <div className="grid gap-1.5"><Label>Manager (defaults to the hiring manager)</Label><EmployeePicker value={manager} onChange={setManager} /></div>
          <DialogFooter showCloseButton><Button type="submit" disabled={busy}>Create employee</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

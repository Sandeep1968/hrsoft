"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState, StatusBadge } from "@/components/common";
import { apiFetch } from "@/lib/client/api";
import { fmtDate } from "@/lib/dates";
import type { OnboardingTaskDto } from "@/server/services/onboarding";

export function OnboardingTaskList({ tasks, title = "Onboarding checklist", showEmployee = false }: { tasks: OnboardingTaskDto[]; title?: string; showEmployee?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const done = tasks.filter((t) => t.status === "COMPLETED" || t.status === "SKIPPED").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const today = new Date().toISOString().slice(0, 10);

  async function complete(t: OnboardingTaskDto, status: "COMPLETED" | "SKIPPED") {
    setBusy(t.id);
    try {
      await apiFetch(`/api/v1/onboarding/tasks/${t.id}/complete`, { method: "POST", body: { status } });
      toast.success(status === "COMPLETED" ? "Task completed" : "Task skipped");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    } finally {
      setBusy(null);
    }
  }

  if (tasks.length === 0) return <EmptyState title="No onboarding tasks" />;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Progress value={pct} className="w-28" /> {done}/{tasks.length}</div>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {tasks.map((t) => {
            const open = t.status === "PENDING" || t.status === "IN_PROGRESS";
            const overdue = open && t.dueDate && t.dueDate < today;
            return (
              <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {!open && <CheckCircle2 className="size-4 text-emerald-600" />}
                    <span className={!open ? "text-muted-foreground line-through" : ""}>{t.title}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {showEmployee && <span className="font-medium text-foreground">{t.employeeName} · </span>}
                    {t.assigneeType} · {t.dueDate ? <span className={overdue ? "text-destructive" : ""}>due {fmtDate(t.dueDate)}</span> : "no due date"}
                    {t.description && <span> · {t.description}</span>}
                  </div>
                </div>
                {t.canComplete && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" disabled={busy === t.id} onClick={() => complete(t, "COMPLETED")}>Mark done</Button>
                    <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => complete(t, "SKIPPED")}>Skip</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

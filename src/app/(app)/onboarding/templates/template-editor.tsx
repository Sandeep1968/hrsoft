"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/common/native-select";
import { apiFetch } from "@/lib/client/api";
import { Field } from "@/components/employees/field";
import type { listTemplates } from "@/server/services/onboarding";

type Template = Awaited<ReturnType<typeof listTemplates>>[number];
type TaskRow = { title: string; description: string; assigneeType: string; dueDaysAfterJoining: number };
const ASSIGNEES = ["EMPLOYEE", "MANAGER", "HR", "IT", "FINANCE"];
const blank = (): { id: string | null; name: string; isDefault: boolean; tasks: TaskRow[] } => ({ id: null, name: "", isDefault: false, tasks: [{ title: "", description: "", assigneeType: "EMPLOYEE", dueDaysAfterJoining: 7 }] });

export function TemplateEditor({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [sel, setSel] = useState(templates[0] ? toForm(templates[0]) : blank());
  const [busy, setBusy] = useState(false);

  function toForm(t: Template) {
    return { id: t.id, name: t.name, isDefault: t.isDefault, tasks: t.tasks.map((x) => ({ title: x.title, description: x.description ?? "", assigneeType: x.assigneeType, dueDaysAfterJoining: x.dueDaysAfterJoining })) };
  }
  const setTask = (i: number, patch: Partial<TaskRow>) => setSel((s) => ({ ...s, tasks: s.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: sel.name, isDefault: sel.isDefault, tasks: sel.tasks.filter((t) => t.title.trim()).map((t, i) => ({ ...t, order: i + 1 })) };
      const r = sel.id ? await apiFetch<Template>(`/api/v1/onboarding/templates/${sel.id}`, { method: "PUT", body }) : await apiFetch<Template>("/api/v1/onboarding/templates", { method: "POST", body });
      setSel(toForm(r));
      toast.success("Template saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!sel.id || !confirm(`Delete template "${sel.name}"?`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/onboarding/templates/${sel.id}`, { method: "DELETE" });
      toast.success("Deleted");
      setSel(blank());
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <Card className="lg:col-span-1">
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Templates</CardTitle><Button size="xs" variant="outline" onClick={() => setSel(blank())}><Plus /> New</Button></CardHeader>
        <CardContent>
          <ul className="space-y-1">
            {templates.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setSel(toForm(t))} className={`w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${sel.id === t.id ? "bg-muted font-medium" : ""}`}>
                  {t.name} {t.isDefault && <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] uppercase text-primary">Default</span>}
                  <span className="block text-xs text-muted-foreground">{t.tasks.length} tasks</span>
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card className="lg:col-span-3">
        <CardHeader><CardTitle className="text-base">{sel.id ? "Edit template" : "New template"}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="Name" required><Input required value={sel.name} onChange={(e) => setSel({ ...sel, name: e.target.value })} /></Field>
              <label className="flex h-8 items-center gap-2 text-sm"><Checkbox checked={sel.isDefault} onCheckedChange={(c) => setSel({ ...sel, isDefault: Boolean(c) })} /> Default template</label>
            </div>
            <div className="space-y-2">
              <div className="hidden grid-cols-[1fr_1fr_130px_90px_32px] gap-2 text-xs text-muted-foreground sm:grid"><span>Task</span><span>Description</span><span>Assignee</span><span>Due (days)</span><span /></div>
              {sel.tasks.map((t, i) => (
                <div key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_1fr_130px_90px_32px] sm:border-0 sm:p-0">
                  <Input placeholder="Task title" value={t.title} onChange={(e) => setTask(i, { title: e.target.value })} />
                  <Input placeholder="Description (optional)" value={t.description} onChange={(e) => setTask(i, { description: e.target.value })} />
                  <NativeSelect value={t.assigneeType} onChange={(e) => setTask(i, { assigneeType: e.target.value })}>{ASSIGNEES.map((a) => <option key={a}>{a}</option>)}</NativeSelect>
                  <Input type="number" min={-30} max={365} value={t.dueDaysAfterJoining} onChange={(e) => setTask(i, { dueDaysAfterJoining: Number(e.target.value) })} />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove task" onClick={() => setSel({ ...sel, tasks: sel.tasks.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setSel({ ...sel, tasks: [...sel.tasks, { title: "", description: "", assigneeType: "EMPLOYEE", dueDaysAfterJoining: 7 }] })}><Plus /> Add task</Button>
            </div>
            <div className="flex justify-between">
              {sel.id ? <Button type="button" variant="destructive" disabled={busy || sel.isDefault} onClick={remove}>Delete</Button> : <span />}
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save template"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

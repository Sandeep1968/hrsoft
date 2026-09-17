import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Page title row with optional actions on the right. */
export function PageHeader({ title, description, actions, breadcrumb }: { title: string; description?: string; actions?: React.ReactNode; breadcrumb?: { label: string; href?: string }[] }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && (
          <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                {b.href ? <Link href={b.href} className="hover:underline">{b.label}</Link> : <span>{b.label}</span>}
              </span>
            ))}
          </div>
        )}
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center">
      <div className="text-sm font-medium">{title}</div>
      {description && <div className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const STATUS_TONES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  SUBMITTED: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  APPROVED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  ACTIVE: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  PRESENT: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  PAID: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  FINALIZED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  COMPLETED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  REIMBURSED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  HIRED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  ON_TRACK: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  REJECTED: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  ABSENT: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  SUSPENDED: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  OFF_TRACK: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  CANCELLED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  EXITED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  CLOSED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  AT_RISK: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  ON_NOTICE: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  ONBOARDING: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  IN_PROGRESS: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  PROCESSING: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  REVIEW: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  OPEN: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  WFH: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  ON_LEAVE: "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100",
  HOLIDAY: "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100",
  WEEK_OFF: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  HALF_DAY: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("font-medium", STATUS_TONES[status] ?? "", className)}>
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

/** Simple definition list for detail views. */
export function DL({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{it.label}</dt>
          <dd className="truncate text-sm">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

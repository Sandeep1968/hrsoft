import { StatusBadge } from "@/components/common";
import { ProgressBar } from "./progress-bar";
import type { OkrTreeNode } from "@/server/services/performance";

const LEVEL_TONE: Record<string, string> = {
  COMPANY: "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100",
  DEPARTMENT: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100",
  TEAM: "bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-100",
  INDIVIDUAL: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};

export function OkrTree({ nodes, depth = 0 }: { nodes: OkrTreeNode[]; depth?: number }) {
  return (
    <ul className={depth ? "ml-3 border-l pl-3 sm:ml-4 sm:pl-4" : ""}>
      {nodes.map((n) => (
        <li key={n.id} className="py-1.5">
          <details open={depth < 2} className="group">
            <summary className="flex cursor-pointer list-none flex-col gap-1 rounded-lg px-2 py-1.5 hover:bg-muted/60 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className={`shrink-0 rounded px-1.5 text-[10px] font-medium uppercase tracking-wide ${LEVEL_TONE[n.level] ?? ""}`}>{n.level}</span>
                <span className="truncate text-sm font-medium">{n.title}</span>
                {n.children.length > 0 && <span className="text-xs text-muted-foreground">({n.children.length})</span>}
              </div>
              <div className="flex items-center gap-3 sm:w-72">
                <span className="hidden truncate text-xs text-muted-foreground sm:block sm:w-28">{n.ownerName}</span>
                <ProgressBar value={n.progress} className="flex-1" />
                <StatusBadge status={n.status} className="hidden sm:inline-flex" />
              </div>
            </summary>
            {n.keyResults.length > 0 && (
              <ul className="ml-6 mt-1 space-y-1 text-xs text-muted-foreground">
                {n.keyResults.map((k) => (
                  <li key={k.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{k.title}</span>
                    <span className="w-24 shrink-0"><ProgressBar value={k.progress} tone="neutral" /></span>
                  </li>
                ))}
              </ul>
            )}
            {n.children.length > 0 && <OkrTree nodes={n.children} depth={depth + 1} />}
          </details>
        </li>
      ))}
    </ul>
  );
}

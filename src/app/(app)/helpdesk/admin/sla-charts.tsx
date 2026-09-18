"use client";

import { SimpleBarChart } from "@/components/psa/charts";

export function SlaCharts({ resolution, volume }: { resolution: { category: string; avgHours: number | null; slaPct: number | null }[]; volume: Record<string, string | number>[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Avg resolution time (hours)</div>
        <SimpleBarChart data={resolution.map((r) => ({ category: r.category, hours: r.avgHours ?? 0 }))} x="category" series={[{ key: "hours", label: "Avg hours" }]} height={220} formatValue={(v) => `${v}h`} />
      </div>
      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Volume by category & status</div>
        <SimpleBarChart data={volume} x="category" series={[{ key: "OPEN", stack: "s" }, { key: "IN_PROGRESS", label: "In progress", stack: "s" }, { key: "WAITING_ON_EMPLOYEE", label: "Waiting", stack: "s" }, { key: "RESOLVED", stack: "s" }, { key: "CLOSED", stack: "s" }]} height={220} />
      </div>
    </div>
  );
}

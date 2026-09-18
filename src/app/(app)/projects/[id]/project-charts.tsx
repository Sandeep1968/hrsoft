"use client";

import { SimpleBarChart, SimplePieChart } from "@/components/psa/charts";

export function ProjectCharts({ byMember, byTask, billable, nonBillable }: { byMember: { name: string; hours: number; billable: number }[]; byTask: { name: string; hours: number }[]; billable: number; nonBillable: number }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Hours by member</div>
        <SimpleBarChart data={byMember.map((m) => ({ name: m.name, Billable: m.billable, "Non-billable": Math.max(0, m.hours - m.billable) }))} x="name" series={[{ key: "Billable", stack: "h" }, { key: "Non-billable", stack: "h" }]} horizontal height={Math.max(160, byMember.length * 34)} formatValue={(v) => `${v}h`} />
      </div>
      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Billable split</div>
        <SimplePieChart data={[{ name: "Billable", value: billable }, { name: "Non-billable", value: nonBillable }]} nameKey="name" valueKey="value" height={200} />
      </div>
      {byTask.length > 0 && (
        <div className="lg:col-span-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Hours by task</div>
          <SimpleBarChart data={byTask} x="name" series={[{ key: "hours", label: "Hours" }]} height={220} formatValue={(v) => `${v}h`} />
        </div>
      )}
    </div>
  );
}

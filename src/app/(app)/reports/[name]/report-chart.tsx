"use client";

import { SimpleBarChart, SimpleLineChart, SimplePieChart } from "@/components/psa/charts";
import type { ReportResult } from "@/server/services/reports";

type Row = Record<string, string | number | null | undefined>;
const money = (v: number) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(v);

export function ReportChart({ report }: { report: ReportResult }) {
  const rows = report.table as Row[];
  const x = report.columns[0];
  switch (report.name) {
    case "headcount":
      return rows.length > 6 ? <SimpleBarChart data={rows} x={x} series={[{ key: "headcount", label: "Headcount" }]} horizontal height={Math.max(220, rows.length * 28)} /> : <SimplePieChart data={rows} nameKey={x} valueKey="headcount" />;
    case "headcount-trend":
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          <SimpleLineChart data={rows} x="month" series={[{ key: "headcount", label: "Closing headcount" }]} />
          <SimpleBarChart data={rows} x="month" series={[{ key: "joins", label: "Joiners", color: "var(--chart-2, #10b981)" }, { key: "exits", label: "Exits", color: "var(--chart-5, #ef4444)" }]} />
        </div>
      );
    case "attrition":
      return <SimpleBarChart data={rows} x="department" series={[{ key: "attritionPct", label: "Attrition %" }]} horizontal height={Math.max(220, rows.length * 28)} formatValue={(v) => `${v}%`} />;
    case "tenure-diversity": {
      const bands = (report.extras.ageBands as Row[]) ?? [];
      const tenure = (report.extras.tenureBands as Row[]) ?? [];
      return (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-1"><div className="mb-1 text-xs text-muted-foreground">Age bands</div><SimpleBarChart data={bands} x="band" series={[{ key: "count", label: "Employees" }]} height={220} /></div>
          <div className="lg:col-span-1"><div className="mb-1 text-xs text-muted-foreground">Tenure bands</div><SimpleBarChart data={tenure} x="band" series={[{ key: "count", label: "Employees" }]} height={220} /></div>
          <div className="lg:col-span-1"><div className="mb-1 text-xs text-muted-foreground">Gender by department</div><SimpleBarChart data={rows.slice(0, 12)} x="department" series={[{ key: "male", label: "Male", stack: "g" }, { key: "female", label: "Female", stack: "g" }, { key: "other", label: "Other", stack: "g" }, { key: "undisclosed", label: "Undisclosed", stack: "g" }]} height={220} /></div>
        </div>
      );
    }
    case "attendance-summary":
      return <SimpleBarChart data={rows} x="department" series={[{ key: "PRESENT", label: "Present", stack: "a" }, { key: "WFH", label: "WFH", stack: "a" }, { key: "HALF_DAY", label: "Half day", stack: "a" }, { key: "ON_LEAVE", label: "On leave", stack: "a" }, { key: "ABSENT", label: "Absent", stack: "a" }]} height={280} />;
    case "leave-utilisation":
      return <SimpleBarChart data={rows} x="leaveType" series={[{ key: "entitledDays", label: "Entitled" }, { key: "usedDays", label: "Used" }]} />;
    case "payroll-cost":
      return <SimpleBarChart data={rows} x="month" series={[{ key: "net", label: "Net pay", stack: "p" }, { key: "deductions", label: "Deductions", stack: "p" }]} formatValue={money} />;
    case "expenses": {
      const byStatus = (report.extras.byStatus as Row[]) ?? [];
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          <SimpleBarChart data={rows} x="category" series={[{ key: "amount", label: "Amount" }]} formatValue={money} />
          <SimplePieChart data={byStatus} nameKey="status" valueKey="amount" />
        </div>
      );
    }
    default:
      return null;
  }
}

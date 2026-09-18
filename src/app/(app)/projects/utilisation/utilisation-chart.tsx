"use client";

import { SimpleBarChart } from "@/components/psa/charts";

export function UtilisationChart({ data }: { data: { name: string; Billable: number; "Non-billable": number }[] }) {
  return <div className="mb-4"><SimpleBarChart data={data} x="name" series={[{ key: "Billable", stack: "h" }, { key: "Non-billable", stack: "h" }]} height={220} formatValue={(v) => `${v}h`} /></div>;
}

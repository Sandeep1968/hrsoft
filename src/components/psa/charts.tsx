"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Chart palette derived from the theme; falls back to a neutral ramp. */
export const CHART_COLORS = ["var(--chart-1, #2563eb)", "var(--chart-2, #10b981)", "var(--chart-3, #f59e0b)", "var(--chart-4, #8b5cf6)", "var(--chart-5, #ef4444)", "#0ea5e9", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

type Row = Record<string, string | number | null | undefined>;
interface Series { key: string; label?: string; color?: string; stack?: string }

const axisStyle = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltipStyle = { borderRadius: 8, border: "1px solid var(--border)", background: "var(--popover)", color: "var(--popover-foreground)", fontSize: 12 };

export function SimpleBarChart({ data, x, series, height = 260, horizontal = false, formatValue }: { data: Row[]; x: string; series: Series[]; height?: number; horizontal?: boolean; formatValue?: (v: number) => string }) {
  if (data.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No data for this selection.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 8, left: horizontal ? 24 : 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={!horizontal} horizontal={horizontal} />
        {horizontal ? <XAxis type="number" tick={axisStyle} tickFormatter={formatValue} /> : <XAxis dataKey={x} tick={axisStyle} interval={0} angle={data.length > 8 ? -30 : 0} textAnchor={data.length > 8 ? "end" : "middle"} height={data.length > 8 ? 60 : 30} />}
        {horizontal ? <YAxis type="category" dataKey={x} tick={axisStyle} width={120} /> : <YAxis tick={axisStyle} tickFormatter={formatValue} width={48} />}
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => (formatValue ? formatValue(Number(v)) : v)} cursor={{ fill: "var(--muted)" }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} stackId={s.stack} radius={[3, 3, 0, 0]} maxBarSize={48} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SimpleLineChart({ data, x, series, height = 260, formatValue }: { data: Row[]; x: string; series: Series[]; height?: number; formatValue?: (v: number) => string }) {
  if (data.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No data for this selection.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={x} tick={axisStyle} />
        <YAxis tick={axisStyle} tickFormatter={formatValue} width={48} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => (formatValue ? formatValue(Number(v)) : v)} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={data.length <= 24} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SimplePieChart({ data, nameKey, valueKey, height = 240 }: { data: Row[]; nameKey: string; valueKey: string; height?: number }) {
  const rows = data.filter((d) => Number(d[valueKey]) > 0);
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No data for this selection.</p>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={rows} dataKey={valueKey} nameKey={nameKey} innerRadius="50%" outerRadius="80%" paddingAngle={2} stroke="var(--background)">
          {rows.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

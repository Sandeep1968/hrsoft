"use client";

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const tick = { fontSize: 12 };
const tooltip = { borderRadius: 8, fontSize: 12 };

export function DistributionChart({ data, tone = "rating" }: { data: { label: string; count: number }[]; tone?: "rating" | "nps" | "choice" }) {
  const color = (label: string, i: number) => {
    if (tone === "nps") {
      const n = Number(label);
      return n >= 9 ? "var(--chart-2)" : n >= 7 ? "var(--chart-4)" : "var(--destructive)";
    }
    if (tone === "rating") return `color-mix(in oklch, var(--primary) ${40 + i * 15}%, transparent)`;
    return "var(--primary)";
  };
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ left: -20, right: 8, top: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={tick} interval={0} />
        <YAxis tick={tick} allowDecimals={false} />
        <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={tooltip} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={d.label} fill={color(d.label, i)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** eNPS gauge: −100…100 rendered as a half ring. */
export function NpsGauge({ value }: { value: number | null }) {
  const v = value ?? 0;
  const fill = v >= 30 ? "var(--chart-2)" : v >= 0 ? "var(--chart-4)" : "var(--destructive)";
  return (
    <div className="relative mx-auto h-36 w-56">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart cx="50%" cy="80%" innerRadius="70%" outerRadius="100%" startAngle={180} endAngle={0} data={[{ value: v + 100, fill }]} barSize={18}>
          <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "var(--muted)" }} isAnimationActive={false} />
          <text x="50%" y="72%" textAnchor="middle" className="fill-foreground text-3xl font-semibold">{value === null ? "—" : v}</text>
          <text x="50%" y="88%" textAnchor="middle" className="fill-muted-foreground text-xs">eNPS</text>
          <text x="6%" y="88%" textAnchor="start" className="fill-muted-foreground text-[10px]">-100</text>
          <text x="94%" y="88%" textAnchor="end" className="fill-muted-foreground text-[10px]">100</text>
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function NpsTrendChart({ data }: { data: { date: string; title: string; nps: number | null; responseRate: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ left: -16, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tick={tick} />
        <YAxis yAxisId="nps" domain={[-100, 100]} tick={tick} />
        <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={tick} unit="%" />
        <Tooltip contentStyle={tooltip} labelFormatter={(_, p) => (p?.[0]?.payload as { title?: string } | undefined)?.title ?? ""} />
        <Line yAxisId="nps" type="monotone" dataKey="nps" name="eNPS" stroke="var(--primary)" strokeWidth={2} connectNulls />
        <Line yAxisId="rate" type="monotone" dataKey="responseRate" name="Participation %" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="4 3" connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TimelineChart({ data }: { data: { date: string; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ left: -20, right: 8 }}>
        <XAxis dataKey="date" tick={tick} />
        <YAxis tick={tick} allowDecimals={false} />
        <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={tooltip} />
        <Bar dataKey="count" fill="var(--primary)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

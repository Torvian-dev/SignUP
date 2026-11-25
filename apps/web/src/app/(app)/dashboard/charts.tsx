"use client";
/**
 * Dashboard charts. Colours come from the validated reference palette (CSS vars in globals.css):
 *   succeeded/failed are STATUS (good/critical, with legend labels — never colour alone),
 *   confidence is a single-hue magnitude, learning uses categorical slots 1–2 on one 0–100% axis.
 */
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { stroke: "var(--viz-text-2)", fontSize: 11, tickLine: false, axisLine: false } as const;
const grid = <CartesianGrid stroke="var(--viz-grid)" vertical={false} />;
const tooltipStyle = { contentStyle: { background: "var(--viz-surface)", border: "1px solid var(--viz-grid)", borderRadius: 8, fontSize: 12, color: "var(--viz-text)" } };
const fmtDay = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function RunsChart({ data }: { data: { day: string; succeeded: number; failed: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data.map((d) => ({ ...d, succeeded: Number(d.succeeded), failed: Number(d.failed) }))} barCategoryGap={4} maxBarSize={48}>
        {grid}
        <XAxis dataKey="day" tickFormatter={fmtDay} {...axis} />
        <YAxis allowDecimals={false} width={28} {...axis} />
        <Tooltip {...tooltipStyle} labelFormatter={fmtDay} cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "var(--viz-text-2)" }} />
        <Bar dataKey="succeeded" name="Succeeded" stackId="a" fill="var(--viz-good)" stroke="var(--viz-surface)" strokeWidth={2} />
        <Bar dataKey="failed" name="Failed" stackId="a" fill="var(--viz-critical)" stroke="var(--viz-surface)" strokeWidth={2} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ConfidenceChart({ data }: { data: { bucket: number; n: number }[] }) {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    label: `${i * 10}–${i * 10 + 10}%`,
    n: Number(data.find((d) => Number(d.bucket) === i + 1)?.n ?? 0),
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} barCategoryGap={2}>
        {grid}
        <XAxis dataKey="label" {...axis} interval={1} />
        <YAxis allowDecimals={false} width={28} {...axis} />
        <Tooltip {...tooltipStyle} formatter={(v) => [v, "Fields"]} cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }} />
        <Bar dataKey="n" name="Fields" fill="var(--viz-series-1)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LearningChart({ data }: { data: { week: string; acceptance_pct: number; memory_hit_pct: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data.map((d) => ({ ...d, acceptance_pct: Number(d.acceptance_pct), memory_hit_pct: Number(d.memory_hit_pct) }))}>
        {grid}
        <XAxis dataKey="week" tickFormatter={fmtDay} {...axis} />
        <YAxis domain={[0, 100]} unit="%" width={40} {...axis} />
        <Tooltip {...tooltipStyle} labelFormatter={(l) => `Week of ${fmtDay(String(l))}`} formatter={(v: number) => `${v.toFixed(1)}%`} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "var(--viz-text-2)" }} />
        <Line type="monotone" dataKey="acceptance_pct" name="Mappings accepted" stroke="var(--viz-series-1)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} />
        <Line type="monotone" dataKey="memory_hit_pct" name="Answered from memory" stroke="var(--viz-series-2)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

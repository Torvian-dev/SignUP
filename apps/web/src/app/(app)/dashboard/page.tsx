import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleX } from "lucide-react";
import { api } from "@/lib/api";
import { pct } from "@/lib/utils";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, Td, Th } from "@/components/ui";
import { RunsChart, ConfidenceChart, LearningChart } from "./charts";

interface Dashboard {
  kpis: { total_runs?: number; successful_runs?: number; failed_runs?: number; active_sessions?: number; avg_confidence?: number; ai_accuracy_pct?: number; avg_duration_ms?: number };
  runsByDay: { day: string; succeeded: number; failed: number }[];
  captcha: { provider: string; kind: string; attempts: number; success_rate_pct: number; avg_solve_ms: number; cost_per_solve_usd: number }[];
  confidenceHist: { bucket: number; n: number }[];
  learning: { week: string; acceptance_pct: number; memory_hit_pct: number }[];
  providerUsage: { provider: string; category: string; calls: number; ok: number; failovers: number; avg_ms: number; cost_usd: number }[];
  apiStatus: { provider: string; category: string; label: string; status: string }[];
  profiles: number;
  recent: { run_id: string; type: string; level: string; message: string; created_at: string; domain: string }[];
  timeSaved: { fields_filled: number; manual_minutes_estimate: number; agent_minutes: number };
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardHeader><CardDescription>{label}</CardDescription></CardHeader>
      <CardContent><div className="text-2xl font-semibold tabular-nums">{value}</div>{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</CardContent>
    </Card>
  );
}

const STATUS_ICON = { healthy: CheckCircle2, degraded: CircleAlert, down: CircleX, unknown: CircleAlert } as const;
const STATUS_TONE = { healthy: "good", degraded: "warning", down: "critical", unknown: "neutral" } as const;

export default async function DashboardPage() {
  const d = await api<Dashboard>("/analytics/dashboard");
  const k = d.kpis;
  const saved = d.timeSaved.manual_minutes_estimate > 0
    ? Math.round(100 * (1 - d.timeSaved.agent_minutes / d.timeSaved.manual_minutes_estimate)) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h1 className="text-2xl font-semibold">Dashboard</h1><p className="text-sm text-muted-foreground">Last 30 days</p></div>
        <Link href="/runs/new" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">New automation</Link>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label="Total automations" value={k.total_runs ?? 0} />
        <Stat label="Successful runs" value={k.successful_runs ?? 0} />
        <Stat label="Failed runs" value={k.failed_runs ?? 0} />
        <Stat label="Active sessions" value={k.active_sessions ?? 0} />
        <Stat label="AI accuracy" value={pct(k.ai_accuracy_pct)} hint="Fields not corrected by reviewers" />
        <Stat label="Time saved" value={saved == null ? "—" : `${saved}%`} hint={`${d.timeSaved.fields_filled} fields auto-filled`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Runs per day</CardTitle><CardDescription>Succeeded vs failed</CardDescription></CardHeader>
          <CardContent><RunsChart data={d.runsByDay} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Confidence scores</CardTitle><CardDescription>Distribution of field-mapping confidence</CardDescription></CardHeader>
          <CardContent><ConfidenceChart data={d.confidenceHist} /></CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Learning improvements</CardTitle><CardDescription>Weekly acceptance rate and share of fields answered from learned memory</CardDescription></CardHeader>
          <CardContent><LearningChart data={[...d.learning].reverse()} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>API status</CardTitle><CardDescription>{d.profiles} saved profiles</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {d.apiStatus.length === 0 && <p className="text-sm text-muted-foreground">No providers configured. <Link className="underline" href="/admin/api-keys">Add API keys</Link></p>}
            {d.apiStatus.map((p) => {
              const Icon = STATUS_ICON[p.status as keyof typeof STATUS_ICON] ?? CircleAlert;
              return (
                <div key={`${p.provider}-${p.label}`} className="flex items-center justify-between text-sm">
                  <span>{p.provider} <span className="text-xs text-muted-foreground">({p.category})</span></span>
                  <Badge tone={STATUS_TONE[p.status as keyof typeof STATUS_TONE] ?? "neutral"}><Icon className="h-3 w-3" aria-hidden />{p.status}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>CAPTCHA performance</CardTitle></CardHeader>
          <CardContent>
            <Table><thead><tr><Th>Provider</Th><Th>Type</Th><Th className="text-right">Attempts</Th><Th className="text-right">Success</Th><Th className="text-right">Avg time</Th><Th className="text-right">Cost/solve</Th></tr></thead>
              <tbody>{d.captcha.map((c) => (
                <tr key={c.provider + c.kind}><Td>{c.provider}</Td><Td>{c.kind}</Td><Td className="text-right tabular-nums">{c.attempts}</Td>
                  <Td className="text-right tabular-nums">{pct(c.success_rate_pct)}</Td><Td className="text-right tabular-nums">{(c.avg_solve_ms / 1000).toFixed(1)}s</Td>
                  <Td className="text-right tabular-nums">${Number(c.cost_per_solve_usd ?? 0).toFixed(4)}</Td></tr>))}
                {d.captcha.length === 0 && <tr><Td colSpan={6} className="py-6 text-center text-muted-foreground">No provider solves yet. Challenges without a provider go to the reviewer's live view.</Td></tr>}
              </tbody></Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Provider usage</CardTitle></CardHeader>
          <CardContent>
            <Table><thead><tr><Th>Provider</Th><Th className="text-right">Calls</Th><Th className="text-right">Success</Th><Th className="text-right">Failovers</Th><Th className="text-right">Cost</Th></tr></thead>
              <tbody>{d.providerUsage.map((p) => (
                <tr key={p.provider + p.category}><Td>{p.provider}</Td><Td className="text-right tabular-nums">{p.calls}</Td>
                  <Td className="text-right tabular-nums">{pct((100 * p.ok) / Math.max(1, p.calls))}</Td><Td className="text-right tabular-nums">{p.failovers}</Td>
                  <Td className="text-right tabular-nums">${Number(p.cost_usd ?? 0).toFixed(2)}</Td></tr>))}
                {d.providerUsage.length === 0 && <tr><Td colSpan={5} className="py-6 text-center text-muted-foreground">No provider calls yet. <Link className="underline" href="/admin/api-keys">Add an AI key</Link> to enable semantic mapping.</Td></tr>}
              </tbody></Table>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {d.recent.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/runs/${e.run_id}`} className="min-w-0 truncate"><span className="font-medium">{e.domain}</span> — {e.message}</Link>
                <time className="shrink-0 text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("en-GB")}</time>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { api } from "@/lib/api";
import { Badge, Card, CardContent, Table, Td, Th } from "@/components/ui";

interface Row { id: string; domain: string; intent: string; status: string; completion_confidence: string | null; fields_filled: number; fields_total: number;
  fields_corrected: number; cost_usd: string; duration_ms: number | null; created_at: string; profile_label: string }

export default async function RunsPage({ searchParams }: { searchParams: Promise<{ status?: string; cursor?: string }> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
  const { data, nextCursor } = await api<{ data: Row[]; nextCursor: string | null }>(`/runs?${qs}`);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Submission history</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        {["", "succeeded", "failed", "awaiting_review", "paused"].map((s) => (
          <Link key={s} href={s ? `/runs?status=${s}` : "/runs"} className={`rounded-full border px-3 py-1 ${sp.status === s || (!sp.status && !s) ? "bg-secondary" : ""}`}>{s || "all"}</Link>
        ))}
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <thead><tr><Th>Website</Th><Th>Profile</Th><Th>Status</Th><Th className="text-right">Fields</Th><Th className="text-right">Corrected</Th><Th className="text-right">Confidence</Th><Th className="text-right">Time</Th><Th className="text-right">Cost</Th><Th>Started</Th></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.id} className="hover:bg-muted/40">
              <Td><Link className="font-medium hover:underline" href={`/runs/${r.id}`}>{r.domain}</Link><div className="text-xs text-muted-foreground">{r.intent}</div></Td>
              <Td>{r.profile_label}</Td>
              <Td><Badge tone={r.status === "succeeded" ? "good" : r.status === "failed" ? "critical" : r.status.startsWith("awaiting") ? "warning" : "neutral"}>{r.status.replace("_", " ")}</Badge></Td>
              <Td className="text-right tabular-nums">{r.fields_filled}/{r.fields_total}</Td>
              <Td className="text-right tabular-nums">{r.fields_corrected}</Td>
              <Td className="text-right tabular-nums">{r.completion_confidence ? `${(Number(r.completion_confidence) * 100).toFixed(0)}%` : "—"}</Td>
              <Td className="text-right tabular-nums">{r.duration_ms ? `${Math.round(r.duration_ms / 1000)}s` : "—"}</Td>
              <Td className="text-right tabular-nums">${Number(r.cost_usd).toFixed(3)}</Td>
              <Td className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("en-GB")}</Td>
            </tr>))}
          </tbody>
        </Table>
      </CardContent></Card>
      {nextCursor && <Link className="text-sm underline" href={`/runs?${new URLSearchParams({ ...(sp.status ? { status: sp.status } : {}), cursor: nextCursor })}`}>Older runs →</Link>}
    </div>
  );
}

import Link from "next/link";
import { api } from "@/lib/api";
import { Badge, Card, CardContent, Table, Td, Th } from "@/components/ui";

interface SiteRow { domain: string; fields: number; avg_confidence: string | null; last_used: string | null; accounts: number; succeeded_runs: number }
const tone = (c: number) => (c >= 0.9 ? "good" : c >= 0.7 ? "warning" : "critical");

export default async function SitesPage() {
  const { data } = await api<{ data: SiteRow[] }>("/sites");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Remembered sites</h1>
        <p className="text-sm text-muted-foreground">Websites the agent has learned. Once a site is fully remembered, batches run on it hands-off — no AI, no review.</p>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <thead><tr><Th>Website</Th><Th className="text-right">Fields remembered</Th><Th className="text-right">Confidence</Th><Th className="text-right">Accounts made</Th><Th className="text-right">Successful runs</Th><Th>Last used</Th></tr></thead>
          <tbody>
            {data.map((s) => {
              const c = Number(s.avg_confidence ?? 0);
              return (
                <tr key={s.domain} className="hover:bg-muted/40">
                  <Td><Link href={`/sites/${encodeURIComponent(s.domain)}`} className="font-medium hover:underline">{s.domain}</Link></Td>
                  <Td className="text-right tabular-nums">{s.fields}</Td>
                  <Td className="text-right"><Badge tone={tone(c)}>{(c * 100).toFixed(0)}%</Badge></Td>
                  <Td className="text-right tabular-nums">{s.accounts}</Td>
                  <Td className="text-right tabular-nums">{s.succeeded_runs}</Td>
                  <Td className="text-xs text-muted-foreground">{s.last_used ? new Date(s.last_used).toLocaleDateString("en-GB") : "—"}</Td>
                </tr>
              );
            })}
            {data.length === 0 && <tr><Td colSpan={6} className="py-8 text-center text-muted-foreground">No sites learned yet. Run the agent on a website and approve a form to teach it.</Td></tr>}
          </tbody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

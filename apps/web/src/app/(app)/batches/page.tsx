import Link from "next/link";
import { api } from "@/lib/api";
import { Badge, Card, CardContent, Table, Td, Th } from "@/components/ui";

interface Row { id: string; url: string; domain: string; status: string; quantity: number; processed: number; succeeded: number; failed: number; roster_size: number; created_at: string }

export default async function BatchesPage() {
  const { data } = await api<{ data: Row[] }>("/batches");
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div><h1 className="text-2xl font-semibold">Batch sign-ups</h1><p className="text-sm text-muted-foreground">One website, a roster of profiles, one account each.</p></div>
        <Link href="/batches/new" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">New batch</Link>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <thead><tr><Th>Website</Th><Th>Status</Th><Th className="text-right">Done</Th><Th className="text-right">Succeeded</Th><Th className="text-right">Failed</Th><Th>Started</Th></tr></thead>
          <tbody>
            {data.map((b) => (
              <tr key={b.id} className="hover:bg-muted/40">
                <Td><Link className="font-medium hover:underline" href={`/batches/${b.id}`}>{b.domain}</Link></Td>
                <Td><Badge tone={b.status === "completed" ? "good" : b.status === "cancelled" ? "neutral" : b.status === "paused" ? "warning" : "info"}>{b.status}</Badge></Td>
                <Td className="text-right tabular-nums">{b.processed}/{Math.min(b.quantity, b.roster_size)}</Td>
                <Td className="text-right tabular-nums">{b.succeeded}</Td>
                <Td className="text-right tabular-nums">{b.failed}</Td>
                <Td className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString("en-GB")}</Td>
              </tr>
            ))}
            {data.length === 0 && <tr><Td colSpan={6} className="py-8 text-center text-muted-foreground">No batches yet.</Td></tr>}
          </tbody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

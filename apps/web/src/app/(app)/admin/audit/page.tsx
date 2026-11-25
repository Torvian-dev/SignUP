import { api } from "@/lib/api";
import { Card, CardContent, Table, Td, Th } from "@/components/ui";

export default async function AuditPage() {
  const { data } = await api<{ data: any[] }>("/analytics/audit?limit=100");
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">Audit log</h1><p className="text-sm text-muted-foreground">Append-only and hash-chained. Values are never logged — only which fields changed.</p></div>
      <Card><CardContent className="p-0">
        <Table>
          <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Target</Th><Th>Details</Th><Th>Hash</Th></tr></thead>
          <tbody>{data.map((a) => (
            <tr key={a.id}>
              <Td className="whitespace-nowrap text-xs">{new Date(a.created_at).toLocaleString("en-GB")}</Td>
              <Td className="text-xs">{a.actor_email ?? "system"}<div className="text-muted-foreground">{a.actor_ip}</div></Td>
              <Td className="font-mono text-xs">{a.action}</Td>
              <Td className="text-xs">{a.target_type} {a.target_id?.slice(0, 8)}</Td>
              <Td className="max-w-sm truncate font-mono text-xs">{JSON.stringify(a.metadata)}</Td>
              <Td className="font-mono text-xs text-muted-foreground">{a.hash.slice(0, 10)}…</Td>
            </tr>))}
          </tbody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

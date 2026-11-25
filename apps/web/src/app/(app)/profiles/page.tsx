import Link from "next/link";
import { Globe } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Card, CardContent, Table, Td, Th } from "@/components/ui";
import { ImportCsv } from "./ImportCsv";

interface ProfileRow { id: string; label: string; isDefault: boolean; displayName: string; email?: string; customFieldCount: number; proxy: { host: string; health: string } | null; updatedAt: string }

export default async function ProfilesPage() {
  const { data } = await api<{ data: ProfileRow[] }>("/profiles");
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div><h1 className="text-2xl font-semibold">Profiles</h1><p className="text-sm text-muted-foreground">Enter your details once; every automation reuses them. One proxy per profile.</p></div>
        <div className="flex gap-2"><ImportCsv /><Link href="/profiles/new" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">New profile</Link></div>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <thead><tr><Th>Profile</Th><Th>Name</Th><Th>Email</Th><Th>Custom fields</Th><Th>Proxy</Th><Th>Updated</Th></tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} className="hover:bg-muted/40">
                <Td><Link href={`/profiles/${p.id}`} className="font-medium underline-offset-2 hover:underline">{p.label}</Link> {p.isDefault && <Badge tone="info">default</Badge>}</Td>
                <Td>{p.displayName}</Td>
                <Td>{p.email ?? "—"}</Td>
                <Td className="tabular-nums">{p.customFieldCount}</Td>
                <Td>{p.proxy ? <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" aria-hidden />{p.proxy.host} <Badge tone={p.proxy.health === "healthy" ? "good" : p.proxy.health === "down" ? "critical" : "neutral"}>{p.proxy.health}</Badge></span> : "Direct"}</Td>
                <Td className="text-xs text-muted-foreground">{new Date(p.updatedAt).toLocaleDateString("en-GB")}</Td>
              </tr>
            ))}
            {data.length === 0 && <tr><Td colSpan={6} className="py-8 text-center text-muted-foreground">No profiles yet — create one to start automating.</Td></tr>}
          </tbody>
        </Table>
      </CardContent></Card>
    </div>
  );
}

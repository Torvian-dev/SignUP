"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, Td, Th } from "@/components/ui";
import { send } from "@/lib/utils";

export interface SiteField {
  id: string; signature_text: string; profile_path: string; transform: string | null;
  successes: number; failures: number; corrections: number; confidence: string | null; last_used_at: string | null;
}

// The profile fields a remembered box can point at. "custom.*" values are kept as-is if already set.
const PROFILE_PATHS = [
  "personal.firstName", "personal.lastName", "personal.fullName", "personal.email", "personal.phone",
  "address.primary.line1", "address.primary.line2", "address.primary.city", "address.primary.region", "address.primary.postcode", "address.primary.country",
  "generated.password", "site_account.username", "site_account.password", "consent.terms", "consent.marketing",
];
const tone = (c: number) => (c >= 0.9 ? "good" : c >= 0.7 ? "warning" : "critical");

export function SiteDetail({ domain, fields: initial, accounts }: { domain: string; fields: SiteField[]; accounts: number }) {
  const router = useRouter();
  const [fields, setFields] = useState(initial);
  const [busy, setBusy] = useState(false);

  const changePath = async (id: string, profilePath: string) => {
    setFields((fs) => fs.map((f) => (f.id === id ? { ...f, profile_path: profilePath, confidence: "0.990", failures: 0, corrections: 0 } : f)));
    await send(`/api/v1/sites/field/${id}`, "PATCH", { profilePath, transform: null }).catch(() => router.refresh());
  };
  const forgetField = async (id: string) => {
    setFields((fs) => fs.filter((f) => f.id !== id));
    await send(`/api/v1/sites/field/${id}`, "DELETE").catch(() => router.refresh());
  };
  const forgetSite = async () => {
    setBusy(true);
    await send(`/api/v1/sites/${encodeURIComponent(domain)}`, "DELETE");
    router.push("/sites"); router.refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{domain}</h1>
          <p className="text-sm text-muted-foreground">{fields.length} field{fields.length === 1 ? "" : "s"} remembered · {accounts} account{accounts === 1 ? "" : "s"} made here</p>
        </div>
        <Button variant="outline" onClick={forgetSite} disabled={busy}><Trash2 className="h-4 w-4" />Forget this site</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What the agent remembers for this site</CardTitle>
          <CardDescription>Each row is a form field it learned, and which of your profile fields it fills from. Change the match if it&apos;s wrong, or remove a field to re-learn it on the next run.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <thead><tr><Th>Form field (as it appears on the site)</Th><Th>Fills from your profile</Th><Th className="text-right">Confidence</Th><Th className="text-right">Confirmed</Th><Th></Th></tr></thead>
            <tbody>
              {fields.map((f) => {
                const c = Number(f.confidence ?? 0);
                const known = PROFILE_PATHS.includes(f.profile_path);
                return (
                  <tr key={f.id}>
                    <Td className="max-w-md"><div className="truncate text-sm" title={f.signature_text}>{f.signature_text || <span className="text-muted-foreground">(unlabelled field)</span>}</div></Td>
                    <Td>
                      <select aria-label={`Profile field for ${f.signature_text}`} className="h-8 w-56 rounded-md border bg-transparent px-1 text-xs"
                        value={f.profile_path} onChange={(e) => changePath(f.id, e.target.value)}>
                        {!known && <option value={f.profile_path}>{f.profile_path}</option>}
                        {PROFILE_PATHS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </Td>
                    <Td className="text-right"><Badge tone={tone(c)}>{(c * 100).toFixed(0)}%</Badge></Td>
                    <Td className="text-right text-xs tabular-nums">{f.successes}×{f.failures + f.corrections > 0 ? ` · ${f.failures + f.corrections} corrected` : ""}</Td>
                    <Td className="text-right"><Button variant="ghost" size="icon" aria-label="Forget field" onClick={() => forgetField(f.id)}><Trash2 className="h-4 w-4" /></Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

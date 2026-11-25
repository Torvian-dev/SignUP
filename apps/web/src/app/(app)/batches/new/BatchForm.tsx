"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Globe } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/components/ui";
import { send } from "@/lib/utils";

interface Profile { id: string; label: string; displayName: string; proxy: { host: string } | null }

export function BatchForm({ profiles, autoSubmitEnabled }: { profiles: Profile[]; autoSubmitEnabled: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [intent, setIntent] = useState("signup");
  const [onFailure, setOnFailure] = useState("skip");
  const [quantity, setQuantity] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const cap = quantity ? Math.min(Number(quantity), selected.length) : selected.length;

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const { id } = await send<{ id: string }>("/api/v1/batches", "POST", {
        url, profileIds: selected, intent, onFailure, quantity: quantity ? Number(quantity) : undefined,
      });
      router.push(`/batches/${id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Batch sign-up</h1>

      {!autoSubmitEnabled && (
        <Card className="border-[var(--viz-warning)]">
          <CardContent className="flex items-start gap-2 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--viz-warning)]" aria-hidden />
            <span>Automatic submission is turned off. A batch submits each account without a review click, so turn it on under{" "}
              <Link href="/admin/policy" className="underline">Policy &amp; guardrails</Link> first.</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Website</CardTitle>
          <CardDescription>One account is created per profile. Each profile keeps its own email and its own proxy.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1"><Label htmlFor="url">Website URL</Label>
            <Input id="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://portal.example.com/register" /></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1"><Label htmlFor="intent">Task</Label>
              <select id="intent" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={intent} onChange={(e) => setIntent(e.target.value)}>
                <option value="signup">Create an account</option><option value="application">Application</option><option value="onboarding">Onboarding</option>
              </select></div>
            <div className="space-y-1"><Label htmlFor="qty">Quantity (optional)</Label>
              <Input id="qty" type="number" min={1} max={selected.length || 1} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={`all ${selected.length}`} /></div>
            <div className="space-y-1"><Label htmlFor="onf">If one fails</Label>
              <select id="onf" className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" value={onFailure} onChange={(e) => setOnFailure(e.target.value)}>
                <option value="skip">Skip &amp; continue</option><option value="pause">Pause the batch</option>
              </select></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Profiles ({selected.length} selected)</CardTitle>
          <CardDescription>The agent works through them one at a time, in the order shown.</CardDescription></CardHeader>
        <CardContent className="space-y-1">
          <div className="mb-2 flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setSelected(profiles.map((p) => p.id))}>Select all</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])}>Clear</Button>
          </div>
          {profiles.map((p) => (
            <label key={p.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
              <span className="flex-1"><span className="font-medium">{p.label}</span> <span className="text-muted-foreground">{p.displayName}</span></span>
              {p.proxy
                ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Globe className="h-3 w-3" aria-hidden />{p.proxy.host}</span>
                : <span className="text-xs text-[var(--viz-warning)]">no proxy</span>}
            </label>
          ))}
          {profiles.length === 0 && <p className="text-sm text-muted-foreground">No profiles yet. <Link href="/profiles/new" className="underline">Create one</Link>.</p>}
        </CardContent>
      </Card>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{cap > 0 ? `Will create up to ${cap} account${cap > 1 ? "s" : ""}.` : "Select at least one profile."}</p>
        <Button disabled={busy || !autoSubmitEnabled || selected.length === 0 || !url} onClick={start}>{busy ? "Starting…" : "Start batch"}</Button>
      </div>
    </div>
  );
}

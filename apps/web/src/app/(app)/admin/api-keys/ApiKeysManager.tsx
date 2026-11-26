"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, CircleAlert, CircleX, RotateCw } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@/components/ui";
import { send } from "@/lib/utils";

interface Cred { id: string; category: string; provider: string; label: string; masked: string; config: Record<string, unknown>; priority: number;
  is_active: boolean; status: string; last_tested_at: string | null; last_test_error: string | null; rotated_at: string | null }

const NAMES: Record<string, string> = {
  claude: "Claude (Anthropic)", openai: "OpenAI", gemini: "Google Gemini",
  "2captcha": "2Captcha", capsolver: "CapSolver", anticaptcha: "Anti-Captcha", capmonster: "CapMonster", deathbycaptcha: "DeathByCaptcha",
  bestcaptchasolver: "BestCaptchaSolver", dispurcaptcha: "DispurCaptcha", resolvr: "Resolvr", compatible: "Other (Anti-Captcha-compatible)",
  browserless: "Browserless", browserbase: "Browserbase", brightdata: "Bright Data", oxylabs: "Oxylabs", smartproxy: "Smartproxy",
  m365: "Microsoft 365", smtp: "SMTP / IMAP", sendgrid: "SendGrid",
};
const CATEGORY_TITLES: Record<string, string> = { ai: "AI providers", captcha: "CAPTCHA providers", browser: "Browser services", proxy: "Proxy providers", email: "Email services" };

/** Which secret fields each provider needs (all write-only). */
function secretFields(provider: string): { key: string; label: string; secret: boolean }[] {
  if (provider === "deathbycaptcha") return [{ key: "username", label: "Username", secret: false }, { key: "password", label: "Password", secret: true }];
  if (provider === "smtp") return [{ key: "username", label: "Username", secret: false }, { key: "password", label: "Password", secret: true }];
  if (provider === "m365") return [{ key: "tenantId", label: "Tenant ID", secret: false }, { key: "clientId", label: "Client ID", secret: false }, { key: "clientSecret", label: "Client secret", secret: true }];
  if (["brightdata", "oxylabs", "smartproxy"].includes(provider)) return [{ key: "username", label: "Username", secret: false }, { key: "password", label: "Password", secret: true }];
  return [{ key: "apiKey", label: "API key", secret: true }];
}
function configFields(provider: string): { key: string; label: string; placeholder?: string }[] {
  if (["claude", "openai", "gemini"].includes(provider)) return [{ key: "model", label: "Model", placeholder: provider === "claude" ? "claude-opus-5-5" : provider === "openai" ? "gpt-4.1" : "gemini-2.5-pro" }];
  if (provider === "compatible") return [{ key: "baseUrl", label: "API base URL (https, from the provider's docs)", placeholder: "https://api.provider.example" }];
  if (provider === "dispurcaptcha") return [{ key: "baseUrl", label: "API base URL (optional — defaults to api.dispurcaptcha.com)", placeholder: "https://api.dispurcaptcha.com" }];
  if (provider === "resolvr") return [{ key: "baseUrl", label: "API base URL (optional — defaults to api.resolvr.com)", placeholder: "https://api.resolvr.com" }];
  if (provider === "smtp") return [{ key: "host", label: "SMTP host" }, { key: "port", label: "SMTP port", placeholder: "587" }, { key: "imapHost", label: "IMAP host (for verification emails)" }];
  if (provider === "m365") return [{ key: "mailbox", label: "Mailbox (UPN)" }];
  if (provider === "sendgrid") return [{ key: "fromAddress", label: "From address" }];
  return [];
}

const STATUS = { healthy: ["good", CheckCircle2], down: ["critical", CircleX], degraded: ["warning", CircleAlert], unknown: ["neutral", CircleAlert] } as const;

export function ApiKeysManager({ initial, catalog }: { initial: Cred[]; catalog: Record<string, string[]> }) {
  const router = useRouter();
  const [adding, setAdding] = useState<{ category: string; provider: string; label?: string } | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const move = async (list: Cred[], i: number, dir: -1 | 1) => {
    const a = list[i]!, b = list[i + dir]!;
    await Promise.all([send(`/api/v1/providers/${a.id}`, "PATCH", { priority: b.priority }), send(`/api/v1/providers/${b.id}`, "PATCH", { priority: a.priority === b.priority ? a.priority + dir : a.priority })]);
    router.refresh();
  };
  const test = async (id: string) => {
    setTestResult((t) => ({ ...t, [id]: "Testing…" }));
    const r = await send<{ ok: boolean; latencyMs: number; error?: string; balanceUsd?: number }>(`/api/v1/providers/${id}/test`, "POST");
    setTestResult((t) => ({ ...t, [id]: r.ok ? `Connected in ${r.latencyMs} ms${r.balanceUsd !== undefined ? ` · balance $${r.balanceUsd.toFixed(2)}` : ""}` : `Failed: ${r.error}` }));
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold">API keys</h1>
        <p className="text-sm text-muted-foreground">Keys are encrypted (AES-256-GCM) and never shown again after saving. Order sets the failover chain — the top provider is tried first.</p></div>

      {Object.entries(catalog).map(([category, providers]) => {
        const list = initial.filter((c) => c.category === category).sort((a, b) => a.priority - b.priority);
        return (
          <Card key={category}>
            <CardHeader><CardTitle>{CATEGORY_TITLES[category]}</CardTitle>
              {list.length > 1 && <CardDescription>Failover: {list.map((c) => NAMES[c.provider]).join(" → ")}</CardDescription>}</CardHeader>
            <CardContent className="space-y-3">
              {list.map((c, i) => {
                const [tone, Icon] = STATUS[c.status as keyof typeof STATUS] ?? STATUS.unknown;
                return (
                  <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                    <div className="flex flex-col"><Button variant="ghost" size="icon" className="h-5" disabled={i === 0} aria-label="Move up" onClick={() => move(list, i, -1)}><ArrowUp className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-5" disabled={i === list.length - 1} aria-label="Move down" onClick={() => move(list, i, 1)}><ArrowDown className="h-3 w-3" /></Button></div>
                    <div className="min-w-40 flex-1"><div className="font-medium">{NAMES[c.provider] ?? c.provider} <span className="text-xs text-muted-foreground">({c.label})</span></div>
                      <div className="font-mono text-xs text-muted-foreground">{c.masked}{c.rotated_at && ` · rotated ${new Date(c.rotated_at).toLocaleDateString("en-GB")}`}</div>
                      {testResult[c.id] && <div className="text-xs">{testResult[c.id]}</div>}</div>
                    <Badge tone={tone}><Icon className="h-3 w-3" aria-hidden />{c.status}</Badge>
                    <Button variant="outline" size="sm" onClick={() => test(c.id)}>Test connection</Button>
                    <Button variant="outline" size="sm" onClick={() => setAdding({ category, provider: c.provider, label: c.label })}><RotateCw className="h-3 w-3" />Replace key</Button>
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" defaultChecked={c.is_active} onChange={(e) => send(`/api/v1/providers/${c.id}`, "PATCH", { isActive: e.target.checked }).then(() => router.refresh())} />Active</label>
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2">
                {providers.map((p) => <Button key={p} variant="secondary" size="sm" onClick={() => setAdding({ category, provider: p })}>+ {NAMES[p] ?? p}</Button>)}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {adding && <AddKeyDialog {...adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); router.refresh(); }} />}
    </div>
  );
}

function AddKeyDialog({ category, provider, label, onClose, onSaved }: { category: string; provider: string; label?: string; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const submit = async (fd: FormData) => {
    const secret: Record<string, string> = {}; const config: Record<string, string> = {};
    secretFields(provider).forEach((f) => { secret[f.key] = String(fd.get(`s_${f.key}`) ?? ""); });
    configFields(provider).forEach((f) => { const v = String(fd.get(`c_${f.key}`) ?? ""); if (v) config[f.key] = v; });
    try {
      await send("/api/v1/providers", "POST", { category, provider, label: String(fd.get("label") || "primary"), secret, config, priority: Number(fd.get("priority") || 100) });
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="add-key-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle id="add-key-title">{label ? "Replace" : "Add"} {NAMES[provider] ?? provider} key</CardTitle>
          {label && <CardDescription>The previous key keeps working for 24 hours so in-flight runs don't fail.</CardDescription>}</CardHeader>
        <CardContent>
          <form action={submit} className="space-y-3" autoComplete="off">
            <div className="space-y-1"><Label htmlFor="label">Label</Label><Input id="label" name="label" defaultValue={label ?? "primary"} readOnly={!!label} /></div>
            {secretFields(provider).map((f) => (
              <div key={f.key} className="space-y-1"><Label htmlFor={`s_${f.key}`}>{f.label}</Label><Input id={`s_${f.key}`} name={`s_${f.key}`} type={f.secret ? "password" : "text"} required autoComplete="off" /></div>))}
            {configFields(provider).map((f) => (
              <div key={f.key} className="space-y-1"><Label htmlFor={`c_${f.key}`}>{f.label}</Label><Input id={`c_${f.key}`} name={`c_${f.key}`} placeholder={f.placeholder} required={f.key === "baseUrl"} /></div>))}
            <div className="space-y-1"><Label htmlFor="priority">Priority (lower = tried first)</Label><Input id="priority" name="priority" type="number" defaultValue={100} /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button>Save key</Button></div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Globe, Pencil, X } from "lucide-react";
import { Badge, Button, Card, CardContent, Input, Label, Table, Td, Th } from "@/components/ui";
import { send } from "@/lib/utils";

export interface ProfileRow {
  id: string; label: string; isDefault: boolean; displayName: string; email?: string;
  customFieldCount: number; proxy: { host: string; health: string } | null; updatedAt: string;
}
type Modal = null | "proxy" | "field" | "delete";

/** Mask the password in an ip:port:user:pass line for display. */
function maskProxy(s: string) {
  const parts = s.split(":");
  if (parts.length >= 4) parts[3] = "••••";
  return parts.join(":");
}

export function ProfilesTable({ data }: { data: ProfileRow[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedRows = useMemo(() => data.filter((p) => sel.has(p.id)), [data, sel]);
  const ids = selectedRows.map((p) => p.id);
  const allSelected = data.length > 0 && sel.size === data.length;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(data.map((p) => p.id)));

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null);
    try { await fn(); setModal(null); setSel(new Set()); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {sel.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 shadow-sm">
          <span className="px-2 text-sm font-medium">{sel.size} selected</span>
          <Button variant="outline" onClick={() => { setErr(null); setModal("proxy"); }}>Assign proxies</Button>
          <Button variant="outline" onClick={() => { setErr(null); setModal("field"); }}>Edit field</Button>
          <Button variant="outline" className="text-destructive" onClick={() => { setErr(null); setModal("delete"); }}>Delete</Button>
          <button className="ml-auto px-2 text-xs underline" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      <Card><CardContent className="p-0">
        <Table>
          <thead><tr>
            <Th><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all profiles" className="h-4 w-4 align-middle accent-[hsl(var(--primary))]" /></Th>
            <Th>Profile</Th><Th>Name</Th><Th>Email</Th><Th>Custom</Th><Th>Proxy</Th><Th>Updated</Th><Th></Th>
          </tr></thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} className={sel.has(p.id) ? "bg-primary/5" : "hover:bg-muted/40"}>
                <Td><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.label}`} className="h-4 w-4 align-middle accent-[hsl(var(--primary))]" /></Td>
                <Td><Link href={`/profiles/${p.id}`} className="font-medium underline-offset-2 hover:underline">{p.label}</Link> {p.isDefault && <Badge tone="info">default</Badge>}</Td>
                <Td>{p.displayName}</Td>
                <Td>{p.email ?? "—"}</Td>
                <Td className="tabular-nums">{p.customFieldCount}</Td>
                <Td>{p.proxy ? <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" aria-hidden />{p.proxy.host} <Badge tone={p.proxy.health === "healthy" ? "good" : p.proxy.health === "down" ? "critical" : "neutral"}>{p.proxy.health}</Badge></span> : "Direct"}</Td>
                <Td className="text-xs text-muted-foreground">{new Date(p.updatedAt).toLocaleDateString("en-GB")}</Td>
                <Td><Link href={`/profiles/${p.id}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Pencil className="h-3 w-3" aria-hidden />Edit</Link></Td>
              </tr>
            ))}
            {data.length === 0 && <tr><Td colSpan={8} className="py-8 text-center text-muted-foreground">No profiles yet — create one to start automating.</Td></tr>}
          </tbody>
        </Table>
      </CardContent></Card>

      {modal && (
        <Overlay onClose={() => !busy && setModal(null)}>
          {modal === "proxy" && <ProxyModal rows={selectedRows} busy={busy} err={err}
            onApply={(items) => run(() => send("/api/v1/profiles/bulk/proxy", "POST", { items }))} />}
          {modal === "field" && <FieldModal count={ids.length} busy={busy} err={err}
            onApply={(body) => run(() => send("/api/v1/profiles/bulk/field", "POST", { profileIds: ids, ...body }))} />}
          {modal === "delete" && <DeleteModal rows={selectedRows} busy={busy} err={err}
            onConfirm={() => run(() => send("/api/v1/profiles/bulk/delete", "POST", { profileIds: ids }))} />}
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end"><button onClick={onClose} aria-label="Close"><X className="h-4 w-4 text-muted-foreground" /></button></div>
        {children}
      </div>
    </div>
  );
}

function ProxyModal({ rows, busy, err, onApply }: { rows: ProfileRow[]; busy: boolean; err: string | null; onApply: (items: { profileId: string; proxy: string }[]) => void }) {
  const [text, setText] = useState("");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pairs = rows.map((r, i) => ({ row: r, proxy: lines[i] }));
  const matched = pairs.filter((p) => p.proxy);
  const mismatch = lines.length !== rows.length;
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">Assign proxies to {rows.length} profile{rows.length !== 1 ? "s" : ""}</h2>
      <p className="text-xs text-muted-foreground">Paste one proxy per line as <code>ip:port:user:pass</code>. Line 1 goes to the first profile, line 2 to the second, and so on.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder={"1.2.3.4:8080:user:pass\n5.6.7.8:8080:user:pass"}
        className="w-full rounded-md border bg-transparent p-2 font-mono text-xs" />
      {text && (
        <div className="max-h-48 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="p-1">Profile</th><th className="p-1">Proxy</th></tr></thead>
            <tbody>{pairs.map((p) => (
              <tr key={p.row.id} className="border-t">
                <td className="p-1">{p.row.label}</td>
                <td className="p-1 font-mono">{p.proxy ? maskProxy(p.proxy) : <span className="text-destructive">— no proxy for this profile —</span>}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {mismatch && text && <p className="text-xs text-amber-600">You pasted {lines.length} proxies for {rows.length} profiles — only the first {matched.length} will be assigned; the rest are left as-is.</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button disabled={busy || matched.length === 0} onClick={() => onApply(matched.map((p) => ({ profileId: p.row.id, proxy: p.proxy! })))}>
          {busy ? "Assigning…" : `Assign ${matched.length} prox${matched.length === 1 ? "y" : "ies"}`}
        </Button>
      </div>
    </div>
  );
}

const FIELD_GROUPS: { group: string; items: [string, string][] }[] = [
  { group: "Personal", items: [["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"]] },
  { group: "Address", items: [["address.line1", "Address line 1"], ["address.line2", "Address line 2"], ["address.city", "City / Town"], ["address.region", "County / Region"], ["address.postcode", "Postcode / ZIP"], ["country", "Country (2-letter)"]] },
  { group: "Settings", items: [["timezone", "Timezone"], ["locale", "Locale"]] },
];

function FieldModal({ count, busy, err, onApply }: { count: number; busy: boolean; err: string | null; onApply: (b: { field: string; value: string }) => void }) {
  const [field, setField] = useState("firstName");
  const [customLabel, setCustomLabel] = useState("");
  const [value, setValue] = useState("");
  const isCustom = field === "__custom";
  const effectiveField = isCustom ? `custom:${customLabel.trim()}` : field;
  const placeholder = field === "country" ? "GB" : field === "timezone" ? "Europe/London" : field === "locale" ? "en-GB" : "";
  const identityWarn = field === "email" || field === "firstName" || field === "lastName";
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">Edit a field on {count} profile{count !== 1 ? "s" : ""}</h2>
      <p className="text-xs text-muted-foreground">Sets the chosen field to the same value on every selected profile. Leave the value blank to clear it.</p>
      <div><Label>Field</Label>
        <select value={field} onChange={(e) => setField(e.target.value)} className="h-9 w-full rounded-md border bg-transparent px-2 text-sm">
          {FIELD_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </optgroup>
          ))}
          <option value="__custom">Custom field…</option>
        </select>
      </div>
      {isCustom && <div><Label>Custom field name</Label><Input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Business Name" /></div>}
      <div><Label>Value</Label><Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} /></div>
      {identityWarn && <p className="text-xs text-amber-600">Heads up: this is a per-person field — setting it the same on many profiles makes them identical. Usually you want these unique.</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end gap-2"><Button disabled={busy || (isCustom && !customLabel.trim())} onClick={() => onApply({ field: effectiveField, value })}>{busy ? "Applying…" : "Apply"}</Button></div>
    </div>
  );
}

function DeleteModal({ rows, busy, err, onConfirm }: { rows: ProfileRow[]; busy: boolean; err: string | null; onConfirm: () => void }) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-destructive">Delete {rows.length} profile{rows.length !== 1 ? "s" : ""}?</h2>
      <p className="text-sm text-muted-foreground">This permanently removes {rows.length === 1 ? "this profile" : "these profiles"} and their saved accounts. It cannot be undone.</p>
      <div className="max-h-32 overflow-auto rounded-md border p-2 text-xs">{rows.map((r) => r.label).join(", ")}</div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" className="text-destructive" disabled={busy} onClick={onConfirm}>{busy ? "Deleting…" : "Delete permanently"}</Button></div>
    </div>
  );
}

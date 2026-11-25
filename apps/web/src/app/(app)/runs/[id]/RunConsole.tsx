"use client";
/**
 * Live run console:
 *   left  — activity stream (SSE) + status
 *   right — Review screen (awaiting_review) or Live View (awaiting_manual, e.g. CAPTCHA escalation)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Table, Td, Th } from "@/components/ui";
import { fetcher, send } from "@/lib/utils";

interface RunEvent { id: number; type: string; level: string; message: string; at: string; data?: any }
interface ReviewField {
  id: string; kind: string; label: string | null; name_attr: string | null; required: boolean; options: { value: string; label: string }[] | null;
  decision_id: string | null; profile_path: string | null; transform: string | null; confidence: string | null; reasoning: string | null; source: string | null; provider: string | null;
  fill: { status: string; valid: boolean; validationMessage?: string; displayValue?: string } | null;
}


function confTone(c: number) { return c >= 0.9 ? "good" : c >= 0.7 ? "warning" : "critical"; }

export function RunConsole({ runId }: { runId: string }) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<string>("queued");
  const { data: run, mutate: refreshRun } = useSWR<any>(`/api/v1/runs/${runId}`, fetcher, { refreshInterval: 0 });

  useEffect(() => { if (run?.status) setStatus(run.status); }, [run?.status]);

  // Activity stream
  useEffect(() => {
    const es = new EventSource(`/api/v1/runs/${runId}/events`);
    es.addEventListener("run", (m) => {
      const e = JSON.parse((m as MessageEvent).data) as RunEvent;
      setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [...prev, e]));
      if (e.type === "status") { setStatus(e.message); refreshRun(); }
    });
    return () => es.close();
  }, [runId, refreshRun]);

  const terminal = ["succeeded", "failed", "cancelled"].includes(status);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="truncate">{run?.domain ?? "Run"}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <Badge tone={status === "succeeded" ? "good" : status === "failed" ? "critical" : status.startsWith("awaiting") ? "warning" : "info"}>{status.replace("_", " ")}</Badge>
            {run?.completion_confidence && <span>Completion confidence {(Number(run.completion_confidence) * 100).toFixed(0)}%</span>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="max-h-[60vh] space-y-2 overflow-y-auto text-sm" aria-live="polite">
            {events.map((e) => (
              <li key={e.id} className="flex gap-2">
                {e.level === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--viz-warning)]" aria-label="warning" />
                  : e.type === "done" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--viz-good)]" aria-label="done" />
                  : <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="min-w-0"><span className="text-xs text-muted-foreground">{new Date(e.at).toLocaleTimeString("en-GB")}</span> {e.message}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex gap-2">
            {!terminal && <Button variant="outline" size="sm" onClick={() => send(`/api/v1/runs/${runId}/cancel`, "POST")}><XCircle className="h-4 w-4" />Cancel</Button>}
            {["paused", "failed"].includes(status) && <Button size="sm" onClick={() => send(`/api/v1/runs/${runId}/resume`, "POST")}>Resume</Button>}
          </div>
        </CardContent>
      </Card>

      {status === "awaiting_review" && <ReviewPanel runId={runId} />}
      {status === "awaiting_manual" && <LiveView runId={runId} />}
      {!["awaiting_review", "awaiting_manual"].includes(status) && (
        <Card><CardContent className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
          {terminal ? `Run ${status}.` : "The agent is working — the review screen appears here when the form is ready."}
        </CardContent></Card>
      )}
    </div>
  );
}

function ReviewPanel({ runId }: { runId: string }) {
  const { data } = useSWR<{ run: any; fields: ReviewField[]; slots: { path: string; label: string; hasValue: boolean }[] }>(`/api/v1/runs/${runId}/review`, fetcher);
  const [overrides, setOverrides] = useState<Record<string, { profilePath?: string | null; value?: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issues = useMemo(() => (data?.fields ?? []).filter((f) => !overrides[f.id] && (
    f.profile_path !== "consent.terms" &&
    ((f.required && f.fill?.status !== "filled") || f.fill?.valid === false ||
     // low confidence only matters for fields we actually filled, or required ones
     ((f.profile_path || f.required) && Number(f.confidence ?? 0) < 0.7)))), [data, overrides]);

  if (!data) return <Card><CardContent className="p-8 text-sm text-muted-foreground">Loading review…</CardContent></Card>;

  const approve = async () => {
    setSubmitting(true); setError(null);
    try {
      await send(`/api/v1/runs/${runId}/approve`, "POST", {
        overrides: Object.entries(overrides).map(([fieldId, o]) => ({ fieldId, ...o })),
      });
    } catch (e) { setError((e as Error).message); setSubmitting(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review before submitting</CardTitle>
        <CardDescription>
          {issues.length ? `${issues.length} field(s) need your attention.` : "Everything looks complete."} Correct anything below; the agent learns from every change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.run.captcha && (
          <div role="status" className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            {data.run.captcha.solvedBy === "unsolved"
              ? <AlertTriangle className="h-4 w-4 text-[var(--viz-warning)]" aria-hidden />
              : <CheckCircle2 className="h-4 w-4 text-[var(--viz-good)]" aria-hidden />}
            <span>CAPTCHA ({String(data.run.captcha.kind).replace(/_/g, " ")}):{" "}
              {data.run.captcha.solvedBy === "unsolved" ? "may still be unsolved — check the screenshot before approving"
                : data.run.captcha.solvedBy === "reviewer" ? "solved by you" : `solved via ${data.run.captcha.solvedBy}`}</span>
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/v1/runs/${runId}/screenshot?step=${data.run.stepId}`} alt="Screenshot of the completed form (passwords masked)" className="max-h-80 w-full rounded-md border object-contain object-top" />
        <Table>
          <thead><tr><Th>Field</Th><Th>Filled with</Th><Th>Confidence</Th><Th>Why</Th><Th>Correct it</Th></tr></thead>
          <tbody>
            {data.fields.map((f) => {
              const c = Number(f.confidence ?? 0);
              const flagged = issues.includes(f);
              return (
                <tr key={f.id} className={flagged ? "bg-[color-mix(in_srgb,var(--viz-warning)_10%,transparent)]" : ""}>
                  <Td><div className="font-medium">{f.label ?? f.name_attr ?? f.kind}{f.required && <span aria-label="required"> *</span>}</div>
                    <div className="text-xs text-muted-foreground">{f.kind}</div></Td>
                  <Td><div className="font-mono text-xs">{f.fill?.displayValue ?? <span className="text-muted-foreground">empty</span>}</div>
                    <div className="text-xs text-muted-foreground">{f.profile_path ?? "unmapped"}</div>
                    {f.profile_path === "consent.terms"
                      ? <div className="text-xs text-muted-foreground">Ticked only when you approve</div>
                      : f.fill?.valid === false && <div className="text-xs text-destructive">{f.fill.validationMessage ?? "Site reports this field as invalid"}</div>}</Td>
                  <Td>{f.decision_id ? <Badge tone={confTone(c)}>{(c * 100).toFixed(0)}%</Badge> : "—"}<div className="mt-1 text-xs text-muted-foreground">{f.source}{f.provider ? ` · ${f.provider}` : ""}</div></Td>
                  <Td className="max-w-xs text-xs text-muted-foreground">{f.reasoning}</Td>
                  <Td className="min-w-48 space-y-1">
                    <select aria-label={`Profile field for ${f.label ?? f.name_attr}`} className="h-8 w-full rounded-md border bg-transparent px-1 text-xs"
                      value={overrides[f.id]?.value !== undefined ? "__custom" : overrides[f.id]?.profilePath ?? f.profile_path ?? ""}
                      onChange={(e) => setOverrides((o) => ({ ...o, [f.id]: e.target.value === "__custom" ? { value: "" } : { profilePath: e.target.value || null } }))}>
                      <option value="">Leave empty</option>
                      {data.slots.filter((sl) => !sl.path.startsWith("site_account.")).map((sl) => (
                        <option key={sl.path} value={sl.path}>{sl.label}{sl.hasValue ? "" : " (empty)"}</option>))}
                      {f.profile_path && !data.slots.some((sl) => sl.path === f.profile_path) && <option value={f.profile_path}>{f.profile_path}</option>}
                      <option value="__custom">Type a value…</option>
                    </select>
                    {overrides[f.id]?.value !== undefined && (
                      f.options?.length
                        ? <select className="h-8 w-full rounded-md border bg-transparent px-1 text-xs" onChange={(e) => setOverrides((o) => ({ ...o, [f.id]: { value: e.target.value } }))}>
                            <option value="">Choose…</option>{f.options.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                          </select>
                        : <Input className="h-8 text-xs" value={overrides[f.id]?.value ?? ""} onChange={(e) => setOverrides((o) => ({ ...o, [f.id]: { value: e.target.value } }))} />
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Approving ticks any terms checkbox and clicks “{data.run.submitButton ?? "Submit"}”.</p>
          <Button onClick={approve} disabled={submitting}>{submitting ? "Submitting…" : "Approve & submit"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LiveView({ runId }: { runId: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    const es = new EventSource(`/api/v1/runs/${runId}/events?screen=1`);
    es.addEventListener("frame", (m) => { if (imgRef.current) imgRef.current.src = `data:image/jpeg;base64,${(m as MessageEvent).data}`; });
    return () => es.close();
  }, [runId]);

  const input = (event: any) => send(`/api/v1/runs/${runId}/manual`, "POST", { type: "input", event });
  const onClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    input({ kind: "click", x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  return (
    <Card>
      <CardHeader><CardTitle>Your turn</CardTitle><CardDescription>Complete the challenge in the live browser below, then press “Done”.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} alt="Live view of the agent's browser" onClick={onClick} className="w-full cursor-crosshair rounded-md border bg-muted" />
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type into the focused field" />
          <Button variant="outline" onClick={() => { input({ kind: "type", text }); setText(""); }}>Send text</Button>
          <Button variant="outline" onClick={() => input({ kind: "key", key: "Enter" })}>Enter</Button>
          <Button variant="outline" onClick={() => input({ kind: "scroll", dy: 400 })}>Scroll ↓</Button>
          <Button onClick={() => send(`/api/v1/runs/${runId}/manual`, "POST", { type: "manual_done" })}>Done</Button>
        </div>
      </CardContent>
    </Card>
  );
}

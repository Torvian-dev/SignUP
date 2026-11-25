"use client";
import Link from "next/link";
import useSWR from "swr";
import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, Td, Th } from "@/components/ui";
import { fetcher, send } from "@/lib/utils";

interface BatchRun { id: string; batch_seq: number; status: string; completion_confidence: string | null; fields_filled: number; error_message: string | null; profile_label: string }
interface Batch {
  id: string; url: string; domain: string; status: string; quantity: number; processed: number; succeeded: number; failed: number;
  profile_ids: string[]; runs: BatchRun[];
}

const ACTIVE = ["queued", "running", "paused"];

export function BatchConsole({ batchId }: { batchId: string }) {
  // Poll while the batch is still working; a batch runs server-side, so no SSE is needed here.
  const { data, mutate } = useSWR<Batch>(`/api/v1/batches/${batchId}`, fetcher, { refreshInterval: 3000 });
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const total = Math.min(data.quantity, data.profile_ids.length);
  const act = (verb: string) => send(`/api/v1/batches/${batchId}/${verb}`, "POST").then(() => mutate());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Batch · {data.domain}</h1>
          <p className="text-sm text-muted-foreground">{data.url}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={data.status === "completed" ? "good" : data.status === "cancelled" ? "neutral" : data.status === "paused" ? "warning" : "info"}>{data.status}</Badge>
          {ACTIVE.includes(data.status) && <Button variant="outline" size="sm" onClick={() => act("cancel")}>Cancel</Button>}
          {data.status === "paused" && <Button size="sm" onClick={() => act("resume")}>Resume</Button>}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[["Planned", total], ["Done", data.processed], ["Succeeded", data.succeeded], ["Failed", data.failed]].map(([l, v]) => (
          <Card key={l as string}><CardHeader><CardDescription>{l}</CardDescription></CardHeader>
            <CardContent><div className="text-2xl font-semibold tabular-nums">{v as number}</div></CardContent></Card>
        ))}
      </section>

      <Card>
        <CardHeader><CardTitle>Progress</CardTitle>
          <CardDescription>One account per profile, in order. Each uses that profile&apos;s own email and proxy.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <Table>
            <thead><tr><Th>#</Th><Th>Profile</Th><Th>Status</Th><Th className="text-right">Filled</Th><Th className="text-right">Confidence</Th><Th>Detail</Th></tr></thead>
            <tbody>
              {data.runs.map((r) => {
                const Icon = r.status === "succeeded" ? CheckCircle2 : r.status === "failed" ? XCircle
                  : r.status === "cancelled" ? CircleDashed : Loader2;
                const spin = ["queued", "launching", "analysing", "mapping", "filling", "solving_captcha", "submitting"].includes(r.status);
                return (
                  <tr key={r.id}>
                    <Td className="tabular-nums">{r.batch_seq + 1}</Td>
                    <Td className="font-medium">{r.profile_label}</Td>
                    <Td><span className="inline-flex items-center gap-1">
                      <Icon className={`h-4 w-4 ${spin ? "animate-spin" : ""} ${r.status === "succeeded" ? "text-[var(--viz-good)]" : r.status === "failed" ? "text-[var(--viz-critical)]" : "text-muted-foreground"}`} aria-hidden />
                      <Link href={`/runs/${r.id}`} className="hover:underline">{r.status.replace("_", " ")}</Link></span></Td>
                    <Td className="text-right tabular-nums">{r.fields_filled}</Td>
                    <Td className="text-right tabular-nums">{r.completion_confidence ? `${(Number(r.completion_confidence) * 100).toFixed(0)}%` : "—"}</Td>
                    <Td className="text-xs text-muted-foreground">{r.error_message ?? ""}</Td>
                  </tr>
                );
              })}
              {data.runs.length === 0 && <tr><Td colSpan={6} className="py-6 text-center text-muted-foreground">Starting…</Td></tr>}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

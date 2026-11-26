"use client";
import { useState } from "react";
import { ShieldCheck, Loader2 } from "lucide-react";
import { send } from "@/lib/utils";

type Status = "pass" | "warn" | "fail" | "info";
interface Check { id: string; label: string; status: Status; detail: string }
interface Report { generatedAt: string; checks: Check[] }

const DOT: Record<Status, string> = {
  pass: "bg-emerald-500", warn: "bg-amber-500", fail: "bg-red-500", info: "bg-slate-400",
};
const WORD: Record<Status, string> = { pass: "Pass", warn: "Check", fail: "Fail", info: "Info" };

export function IdentityCheck({ id }: { id: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true); setError(null);
    try { setReport(await send<Report>(`/api/v1/profiles/${id}/identity-check`, "POST")); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  const fails = report?.checks.filter((c) => c.status === "fail").length ?? 0;
  const warns = report?.checks.filter((c) => c.status === "warn").length ?? 0;

  return (
    <div className="mt-8 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold">Identity self-test</h2>
        </div>
        <button onClick={run} disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {loading ? "Launching browser…" : report ? "Re-run check" : "Run identity check"}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Opens a real browser session for this profile and reports what a detection script would see — automation flag, fingerprint, WebRTC leak and proxy. Run it before a batch.
      </p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {report && (
        <>
          <div className="mt-3 text-xs text-muted-foreground">
            {fails === 0 ? (warns === 0 ? "All clear." : `${warns} item(s) to check.`) : `${fails} failing, ${warns} to check.`}
            {" "}Ran {new Date(report.generatedAt).toLocaleString()}.
          </div>
          <ul className="mt-2 divide-y">
            {report.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-3 py-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[c.status]}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">{WORD[c.status]}</span>
                  </div>
                  <div className="break-words text-xs text-muted-foreground">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * CAPTCHA routing: policy gate → provider failover chain → retries → manual escalation.
 *
 *   policy.captcha_solving_enabled?  ── no ──► escalate to manual (user solves in live view)
 *   daily spend < cap?               ── no ──► escalate to manual
 *   for provider in chain (2Captcha → CapSolver → Anti-Captcha → CapMonster → DBC → BCS → DispurCaptcha → Resolvr → compatible):
 *       skip if breaker open or !supports(kind)
 *       up to 2 attempts per provider (timeout 120s each)
 *       success → record + return token
 *   all failed ──► escalate to manual
 *
 * Every attempt is written to captcha_events (provider, kind, result, ms, cost) which feeds
 * the captcha_provider_stats materialised view on the dashboard.
 */
import { withOrg } from "../../lib/db.js";
import { redis } from "../../lib/redis.js";
import { logger } from "../../lib/logger.js";
import { audit } from "../../middleware/audit.js";
import { chain, type ResolvedCredential } from "../secrets/providerSecrets.js";
import { BestCaptchaSolverProvider } from "./providers/bestcaptchasolver.js";
import { CapSolverProvider } from "./providers/capsolver.js";
import { ResolvrProvider } from "./providers/resolvr.js";
import { CreateTaskProvider } from "./providers/createTaskApi.js";
import { DeathByCaptchaProvider } from "./providers/deathbycaptcha.js";
import { CaptchaProviderError, type CaptchaChallenge, type CaptchaProvider, type CaptchaSolution } from "./types.js";

const ATTEMPTS_PER_PROVIDER = 2;
const SOLVE_TIMEOUT_MS = 120_000;

export function buildCaptchaProvider(c: ResolvedCredential): CaptchaProvider {
  switch (c.provider) {
    case "2captcha":
    case "anticaptcha":
    case "capmonster":
      return new CreateTaskProvider(c.provider, c.secret.apiKey!);
    case "capsolver":
      return new CapSolverProvider(c.secret.apiKey!);
    case "resolvr":
      // Resolvr's own async REST API (verified against https://resolvr.com/docs). Base URL is fixed;
      // config.baseUrl only overrides it if the account uses a custom endpoint.
      return new ResolvrProvider(c.secret.apiKey!, c.config.baseUrl ? String(c.config.baseUrl) : undefined);
    case "dispurcaptcha":
      // Named provider on the Anti-Captcha-style createTask protocol; admin supplies the base URL
      // (unverified — give it a dedicated adapter if its API differs).
      if (!c.config.baseUrl) throw new Error(`${c.provider}: set the API base URL in Admin → API Keys`);
      return new CreateTaskProvider(c.provider, c.secret.apiKey!, String(c.config.baseUrl));
    case "compatible":
      // Any Anti-Captcha-protocol service: admin supplies config.baseUrl (https) and the key.
      return new CreateTaskProvider(String(c.config.name ?? "compatible"), c.secret.apiKey!, String(c.config.baseUrl));
    case "deathbycaptcha":
      return new DeathByCaptchaProvider(c.secret.username!, c.secret.password!);
    case "bestcaptchasolver":
      return new BestCaptchaSolverProvider(c.secret.apiKey!);
    default:
      throw new Error(`unknown captcha provider ${c.provider}`);
  }
}

export type CaptchaOutcome =
  | { status: "solved"; solution: CaptchaSolution; provider: string }
  | { status: "manual"; reason: string };

export async function solveCaptcha(orgId: string, runId: string, domain: string, ch: CaptchaChallenge): Promise<CaptchaOutcome> {
  const policy = await withOrg(orgId, async (tx) => (await tx.query(
    "SELECT captcha_solving_enabled, captcha_max_spend_daily_usd FROM org_policies WHERE org_id=$1", [orgId])).rows[0]);
  if (!policy?.captcha_solving_enabled) return escalate(orgId, runId, domain, ch, "automatic solving disabled by organisation policy");

  const spent = await withOrg(orgId, async (tx) => Number((await tx.query(
    "SELECT coalesce(sum(cost_usd),0) AS s FROM captcha_events WHERE created_at > date_trunc('day', now())")).rows[0].s));
  if (spent >= Number(policy.captcha_max_spend_daily_usd))
    return escalate(orgId, runId, domain, ch, `daily CAPTCHA budget of $${policy.captcha_max_spend_daily_usd} reached`);

  const creds = await chain(orgId, "captcha");
  for (const cred of creds) {
    const provider = buildCaptchaProvider(cred);
    if (!provider.supports(ch.kind)) continue;
    if (await redis.exists(`cb:${orgId}:${cred.provider}:open`)) continue;

    for (let attempt = 1; attempt <= ATTEMPTS_PER_PROVIDER; attempt++) {
      const started = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), SOLVE_TIMEOUT_MS);
      try {
        const solution = await provider.solve(ch, ctrl.signal);
        await record(orgId, runId, domain, ch, cred.provider, attempt, "solved", Date.now() - started, solution.costUsd, solution.providerTaskId);
        await redis.del(`cb:${orgId}:${cred.provider}:fails`);
        await audit({ orgId, action: "captcha.solve", targetType: "run", targetId: runId, metadata: { provider: cred.provider, kind: ch.kind, domain } });
        return { status: "solved", solution, provider: cred.provider };
      } catch (err) {
        const timeout = ctrl.signal.aborted;
        const msg = err instanceof Error ? err.message : String(err);
        await record(orgId, runId, domain, ch, cred.provider, attempt, timeout ? "timeout" : "failed", Date.now() - started, 0, undefined, msg);
        logger.warn({ runId, provider: cred.provider, attempt, err: msg }, "captcha attempt failed");
        const fails = await redis.incr(`cb:${orgId}:${cred.provider}:fails`);
        await redis.expire(`cb:${orgId}:${cred.provider}:fails`, 600);
        if (fails >= 5) await redis.set(`cb:${orgId}:${cred.provider}:open`, "1", "EX", 300);
        if (err instanceof CaptchaProviderError && !err.retryable) break; // bad key / zero balance → next provider
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return escalate(orgId, runId, domain, ch, creds.length ? "all configured providers failed" : "no CAPTCHA provider configured");
}

/** Called by the worker when the site rejects a token we injected (e.g. form re-renders with the error). */
export async function reportRejected(orgId: string, runId: string, domain: string, ch: CaptchaChallenge, providerName: string, taskId: string) {
  const cred = (await chain(orgId, "captcha")).find((c) => c.provider === providerName);
  if (cred) await buildCaptchaProvider(cred).reportBad?.(taskId);
  await record(orgId, runId, domain, ch, providerName, 1, "rejected_by_site", 0, 0, taskId);
}

async function escalate(orgId: string, runId: string, domain: string, ch: CaptchaChallenge, reason: string): Promise<CaptchaOutcome> {
  await record(orgId, runId, domain, ch, null, 1, "escalated_manual", 0, 0, undefined, reason);
  return { status: "manual", reason };
}

async function record(orgId: string, runId: string, domain: string, ch: CaptchaChallenge, provider: string | null, attempt: number,
                      result: string, ms: number, cost: number, taskId?: string, error?: string) {
  await withOrg(orgId, async (tx) => {
    await tx.query(
      `INSERT INTO captcha_events (org_id, run_id, kind, domain, provider, attempt, result, provider_task_id, solve_ms, cost_usd, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [orgId, runId, ch.kind, domain, provider, attempt, result, taskId ?? null, ms, cost, error?.slice(0, 500) ?? null]);
    if (cost) await tx.query("UPDATE automation_runs SET captcha_cost_usd = captcha_cost_usd + $2 WHERE id=$1", [runId, cost]);
  });
}

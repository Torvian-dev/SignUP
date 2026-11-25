/**
 * AI failover router: Claude → OpenAI → Gemini (order from org policy).
 * - Per-provider circuit breaker in Redis (opens after 3 consecutive failures for 60s).
 * - Every attempt recorded in provider_usage for the "Provider Usage" dashboard.
 */
import { redis } from "../../lib/redis.js";
import { withOrg } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { chain, type ResolvedCredential } from "../secrets/providerSecrets.js";
import { ClaudeProvider } from "./providers/claude.js";
import { GeminiProvider } from "./providers/gemini.js";
import { OpenAIProvider } from "./providers/openai.js";
import type { LlmProvider, LlmUsage, MappingResult } from "./types.js";

const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_SEC = 60;

export function buildProvider(cred: ResolvedCredential): LlmProvider {
  const model = cred.config.model as string | undefined;
  switch (cred.provider) {
    case "claude": return new ClaudeProvider(cred.secret.apiKey!, model);
    case "openai": return new OpenAIProvider(cred.secret.apiKey!, model);
    case "gemini": return new GeminiProvider(cred.secret.apiKey!, model);
    default: throw new Error(`unknown AI provider ${cred.provider}`);
  }
}

async function breakerOpen(orgId: string, provider: string) {
  return (await redis.exists(`cb:${orgId}:${provider}:open`)) === 1;
}
async function recordFailure(orgId: string, provider: string) {
  const k = `cb:${orgId}:${provider}:fails`;
  const n = await redis.incr(k);
  await redis.expire(k, 300);
  if (n >= BREAKER_THRESHOLD) await redis.set(`cb:${orgId}:${provider}:open`, "1", "EX", BREAKER_OPEN_SEC);
}
async function recordSuccess(orgId: string, provider: string) {
  await redis.del(`cb:${orgId}:${provider}:fails`);
}

export interface RoutedMapping { result: MappingResult; usage: LlmUsage; provider: string; failoverFrom?: string }

export async function routeMapping(orgId: string, runId: string, system: string, user: string): Promise<RoutedMapping> {
  const creds = await chain(orgId, "ai");
  if (creds.length === 0) throw new Error("no AI provider configured — add one under Admin → API Keys");
  let firstFailed: string | undefined;
  const errors: string[] = [];

  for (const cred of creds) {
    if (await breakerOpen(orgId, cred.provider)) { errors.push(`${cred.provider}: circuit open`); continue; }
    const started = Date.now();
    try {
      const { result, usage } = await buildProvider(cred).mapFields(system, user);
      await recordSuccess(orgId, cred.provider);
      await logUsage(orgId, runId, cred.provider, true, Date.now() - started, usage, firstFailed);
      return { result, usage, provider: cred.provider, failoverFrom: firstFailed };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ provider: cred.provider, err: msg, runId }, "AI provider failed, failing over");
      errors.push(`${cred.provider}: ${msg}`);
      firstFailed ??= cred.provider;
      await recordFailure(orgId, cred.provider);
      await logUsage(orgId, runId, cred.provider, false, Date.now() - started, undefined, undefined);
    }
  }
  throw new Error(`all AI providers failed — ${errors.join("; ")}`);
}

async function logUsage(orgId: string, runId: string, provider: string, success: boolean, latencyMs: number,
                        usage?: LlmUsage, failoverFrom?: string) {
  await withOrg(orgId, (tx) => tx.query(
    `INSERT INTO provider_usage (org_id, provider, category, run_id, operation, success, failover_from, latency_ms, units_in, units_out, cost_usd)
     VALUES ($1,$2,'ai',$3,'map_fields',$4,$5,$6,$7,$8,$9)`,
    [orgId, provider, runId, success, failoverFrom ?? null, latencyMs, usage?.inputTokens ?? null, usage?.outputTokens ?? null, usage?.costUsd ?? 0],
  ));
}

/**
 * Smart Mapping Engine — three tiers, cheapest first:
 *
 *   1. Learned domain memory (posterior ≥ 0.85, n ≥ 2)  → no LLM call
 *   2. Deterministic heuristics (autocomplete tokens)   → no LLM call
 *   3. LLM semantic mapping with failover + few-shot hints from semantic memory
 *
 * Output: one decision per field with path, transform, calibrated confidence and reasoning.
 */
import { withOrg } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { sha256 } from "../../lib/crypto.js";
import { buildVocabulary, flattenValues } from "../profiles/profileVocabulary.js";
import type { DecryptedProfile } from "../profiles/profileService.js";
import { calibrate, domainMemory, semanticHints } from "../learning/learningService.js";
import { heuristicMap } from "./heuristics.js";
import { mappingSystemPrompt, mappingUserPrompt } from "./prompts.js";
import { routeMapping } from "./router.js";
import type { FieldDescriptor, MappingResult } from "./types.js";

export interface Decision {
  decisionId?: string;
  fieldId: string;
  profilePath: string | null;
  transform: string | null;
  confidence: number;
  reasoning: string;
  source: "memory" | "heuristic" | "llm";
  provider?: string;
}

export interface MapPageInput {
  orgId: string;
  runId: string;
  domain: string;
  url: string;
  pageTitle: string;
  profile: DecryptedProfile;
  fields: (FieldDescriptor & { fieldKey: string })[];
}

export interface MapPageOutput {
  decisions: Decision[];
  pageKind: MappingResult["pageKind"];
  submitLocatorHint: string | null;
  completionConfidence: number;
}

const MEMORY_MIN_POSTERIOR = 0.75; // Beta(3,1) = two human confirmations, no failures
const MEMORY_MIN_N = 2;

export async function mapPage(input: MapPageInput): Promise<MapPageOutput> {
  const { orgId, runId, domain, profile } = input;
  const fillable = input.fields.filter((f) => f.kind !== "hidden");
  const slots = buildVocabulary(profile);
  const paths = new Set(slots.map((s) => s.path));
  const decided = new Map<string, Decision>();

  // Tier 1 — learned memory for this exact site
  const memory = await withOrg(orgId, (tx) => domainMemory(tx, domain, fillable));
  for (const m of memory) {
    if (m.posterior >= MEMORY_MIN_POSTERIOR && m.n >= MEMORY_MIN_N && paths.has(m.profilePath)) {
      decided.set(m.fieldId, { fieldId: m.fieldId, profilePath: m.profilePath, transform: m.transform,
        confidence: Number(m.posterior.toFixed(3)), reasoning: `Confirmed ${m.n}× on ${domain}`, source: "memory" });
    }
  }

  // Tier 2 — deterministic heuristics
  for (const h of heuristicMap(fillable.filter((f) => !decided.has(f.id)), paths)) {
    decided.set(h.fieldId, { ...h, source: "heuristic" });
  }

  // Tier 3 — LLM for everything still open (also gives us page kind + submit button)
  const open = fillable.filter((f) => !decided.has(f.id));
  let pageKind: MappingResult["pageKind"] = "other";
  let submitLocatorHint: string | null = null;
  if (open.length > 0 || decided.size === 0) {
    const hints = await semanticHints(orgId, open).catch(() => "");
    let routed: Awaited<ReturnType<typeof routeMapping>>;
    try {
      routed = await routeMapping(orgId, runId,
        mappingSystemPrompt(slots),
        mappingUserPrompt(input.url, input.pageTitle, open.length ? open : fillable, hints));
    } catch (err) {
      // Degraded mode: no AI configured or every provider failed. Keep what memory + heuristics found
      // and hand the remaining fields to the reviewer instead of failing the whole run.
      const why = (err as Error).message.slice(0, 160);
      logger.warn({ runId, err: why }, "AI mapping unavailable — degraded to memory + heuristics");
      const weakMemory = new Map(memory.filter((m) => m.posterior > 0.5 && paths.has(m.profilePath)).map((m) => [m.fieldId, m]));
      for (const f of open) {
        const m = weakMemory.get(f.id);
        decided.set(f.id, m
          ? { fieldId: f.id, profilePath: m.profilePath, transform: m.transform, confidence: Number(m.posterior.toFixed(3)),
              reasoning: `Confirmed ${m.n}× on ${domain} before (AI unavailable, using memory)`, source: "memory" }
          : { fieldId: f.id, profilePath: null, transform: null, confidence: 0,
              reasoning: /no AI provider/.test(why) ? "No AI key set up — choose the right field" : "AI unavailable — choose the right field",
              source: "heuristic" });
      }
      return persistAndReturn(input, decided, "other", null);
    }
    pageKind = routed.result.pageKind;
    submitLocatorHint = routed.result.submitLocatorHint;
    await withOrg(orgId, async (tx) => {
      for (const m of routed.result.mappings) {
        if (decided.has(m.fieldId) || !fillable.some((f) => f.id === m.fieldId)) continue;
        const valid = m.profilePath === null || paths.has(m.profilePath);
        decided.set(m.fieldId, {
          fieldId: m.fieldId,
          profilePath: valid ? m.profilePath : null,
          transform: m.transform,
          confidence: valid ? await calibrate(tx, orgId, m.confidence) : 0,
          reasoning: valid ? m.reasoning : `Model proposed unknown slot "${m.profilePath}" — discarded`,
          source: "llm",
          provider: routed.provider,
        });
      }
      await tx.query(
        `UPDATE automation_runs SET ai_provider_used=$2, ai_tokens_in = ai_tokens_in + $3,
                ai_tokens_out = ai_tokens_out + $4, ai_cost_usd = ai_cost_usd + $5 WHERE id=$1`,
        [runId, routed.provider, routed.usage.inputTokens, routed.usage.outputTokens, routed.usage.costUsd]);
    });
  }

  return persistAndReturn(input, decided, pageKind, submitLocatorHint);
}

async function persistAndReturn(input: MapPageInput, decided: Map<string, Decision>,
                                pageKind: MappingResult["pageKind"], submitLocatorHint: string | null): Promise<MapPageOutput> {
  const { orgId, runId, profile } = input;
  // Persist decisions (value hash only — never the PII value)
  const values = flattenValues(profile);
  const decisions = [...decided.values()];
  await withOrg(orgId, async (tx) => {
    for (const d of decisions) {
      const v = d.profilePath ? values[d.profilePath] : undefined;
      const r = await tx.query<{ id: string }>(
        `INSERT INTO ai_decisions (org_id, run_id, field_id, source, provider, profile_path, transform, proposed_value_hash, confidence, reasoning)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [orgId, runId, d.fieldId, d.source, d.provider ?? null, d.profilePath, d.transform, v ? sha256(v) : null, d.confidence, d.reasoning]);
      d.decisionId = r.rows[0]!.id;
    }
  });

  return { decisions, pageKind, submitLocatorHint, completionConfidence: completionConfidence(input.fields, decisions) };
}

/**
 * Completion confidence = required-field coverage × mean confidence of mapped fields.
 * A required field left unmapped drags the score down hard so the reviewer looks at it.
 */
export function completionConfidence(fields: FieldDescriptor[], decisions: Decision[]): number {
  const byField = new Map(decisions.map((d) => [d.fieldId, d]));
  const required = fields.filter((f) => f.required && f.kind !== "hidden");
  const covered = required.filter((f) => byField.get(f.id)?.profilePath).length;
  const coverage = required.length ? covered / required.length : 1;
  const mapped = decisions.filter((d) => d.profilePath);
  const meanConf = mapped.length ? mapped.reduce((s, d) => s + d.confidence, 0) / mapped.length : 0;
  return Number((coverage ** 2 * meanConf).toFixed(3));
}

/**
 * Learning system.
 *
 * Three feedback loops, all driven by the review screen:
 *  1. Domain memory  — exact (domain, field_key) → profile_path with a Beta(α,β) success posterior.
 *                      After ≥2 confirmations at ≥0.75 posterior, the LLM is skipped for that field.
 *  2. Semantic memory — embeddings of normalised field signatures. Nearest confirmed neighbours are
 *                      injected into the LLM prompt as few-shot evidence for *new* sites.
 *  3. Calibration    — per-org reliability buckets map raw model confidence → observed accuracy, so
 *                      "0.9" really means ~90% of such mappings were accepted.
 */
import OpenAI from "openai";
import { withOrg, type Tx } from "../../lib/db.js";
import { chain } from "../secrets/providerSecrets.js";
import type { FieldDescriptor } from "../ai/types.js";

export interface MemoryHit { fieldId: string; profilePath: string; transform: string | null; posterior: number; n: number }

export function signatureText(f: FieldDescriptor): string {
  return [f.label, f.ariaLabel, f.placeholder, f.name, f.autocomplete, f.section, f.kind]
    .filter(Boolean).join(" | ").toLowerCase().replace(/\s+/g, " ").slice(0, 400);
}

const posterior = (a: number, b: number) => a / (a + b);

export async function domainMemory(tx: Tx, orgId: string, domain: string, fields: (FieldDescriptor & { fieldKey: string })[]): Promise<MemoryHit[]> {
  if (!fields.length) return [];
  const { rows } = await tx.query(
    `SELECT DISTINCT ON (field_key) field_key, profile_path, transform, alpha::float, beta::float,
            failures, corrections, successes + failures + corrections AS n
     FROM mapping_memory WHERE scope='domain' AND org_id=$1 AND domain=$2 AND field_key = ANY($3)
     ORDER BY field_key, (alpha / (alpha + beta)) DESC`,
    [orgId, domain, fields.map((f) => f.fieldKey)],
  );
  const byKey = new Map(rows.map((r) => [r.field_key, r]));
  return fields.flatMap((f) => {
    const r = byKey.get(f.fieldKey);
    if (!r) return [];
    // A mapping a person has confirmed with nothing ever contradicting it is treated as certain —
    // the only question was which box, and that was answered. Any failure/correction reverts to the
    // Beta posterior so a shaky mapping stays visibly uncertain.
    const clean = Number(r.failures) === 0 && Number(r.corrections) === 0;
    const conf = clean ? 0.99 : posterior(r.alpha, r.beta);
    return [{ fieldId: f.id, profilePath: r.profile_path, transform: r.transform, posterior: conf, n: Number(r.n) }];
  });
}

async function embedder(orgId: string): Promise<((texts: string[]) => Promise<number[][]>) | null> {
  const openai = (await chain(orgId, "ai")).find((c) => c.provider === "openai");
  if (!openai) return null;
  const client = new OpenAI({ apiKey: openai.secret.apiKey });
  return async (texts) => (await client.embeddings.create({ model: "text-embedding-3-small", input: texts })).data.map((d) => d.embedding);
}

/** Few-shot hints from semantically similar, previously confirmed fields (any domain in this org). */
export async function semanticHints(orgId: string, fields: FieldDescriptor[]): Promise<string> {
  const embed = await embedder(orgId);
  if (!embed || !fields.length) return "";
  const vectors = await embed(fields.map(signatureText));
  return withOrg(orgId, async (tx) => {
    const lines: string[] = [];
    for (const [i, f] of fields.entries()) {
      const { rows } = await tx.query(
        `SELECT signature_text, profile_path, transform, alpha / (alpha + beta) AS p
         FROM mapping_memory WHERE (org_id=$1 OR org_id IS NULL) AND embedding IS NOT NULL
           AND alpha / (alpha + beta) >= 0.8
         ORDER BY embedding <=> $2::vector LIMIT 2`,
        [orgId, JSON.stringify(vectors[i])],
      );
      for (const r of rows) lines.push(`- field ${f.id} resembles "${r.signature_text}" → ${r.profile_path}${r.transform ? ` [${r.transform}]` : ""}`);
    }
    return lines.join("\n");
  });
}

/** Map raw model confidence through the org's observed reliability curve. */
export async function calibrate(tx: Tx, orgId: string, raw: number): Promise<number> {
  const bucket = Math.min(0.95, Math.max(0.5, Math.floor(raw * 20) / 20));
  const { rows } = await tx.query(
    "SELECT predictions, correct FROM confidence_calibration WHERE org_id=$1 AND bucket=$2", [orgId, bucket]);
  const r = rows[0];
  if (!r || r.predictions < 20) return raw;            // not enough evidence yet — trust the model
  const observed = (r.correct + 1) / (r.predictions + 2); // Laplace-smoothed accuracy for this bucket
  const w = Math.min(1, r.predictions / 200);          // blend in as evidence accumulates
  return Number(((1 - w) * raw + w * observed).toFixed(3));
}

export type Outcome = "accepted" | "corrected" | "rejected" | "skipped" | "validation_failed";

/**
 * Called once per decision when the user approves the review screen (or a field fails validation).
 * Updates domain memory, semantic memory, calibration and the decision row itself — atomically.
 */
export async function recordOutcome(orgId: string, userId: string, args: {
  decisionId: string; outcome: Outcome; finalPath: string | null; finalTransform: string | null;
}) {
  const embed = await embedder(orgId);
  await withOrg(orgId, async (tx) => {
    const d = (await tx.query(
      `SELECT d.*, f.field_key, f.label, f.aria_label, f.placeholder, f.name_attr, f.autocomplete, f.kind, r.domain
       FROM ai_decisions d JOIN detected_fields f ON f.id=d.field_id JOIN automation_runs r ON r.id=d.run_id
       WHERE d.id=$1`, [args.decisionId])).rows[0];
    if (!d) return;

    await tx.query("UPDATE ai_decisions SET outcome=$2, final_profile_path=$3 WHERE id=$1", [d.id, args.outcome, args.finalPath]);

    if (args.outcome === "corrected") {
      await tx.query(
        `INSERT INTO user_corrections (org_id, decision_id, user_id, from_profile_path, to_profile_path, from_transform, to_transform)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [orgId, d.id, userId, d.profile_path, args.finalPath, d.transform, args.finalTransform]);
      await tx.query("UPDATE automation_runs SET fields_corrected = fields_corrected + 1 WHERE id=$1", [d.run_id]);
    }

    // Only a human verdict (accepted / corrected / rejected) is evidence about the mapping.
    // "skipped" (not filled, e.g. terms left for approval) and "validation_failed" (a site/format issue) are not.
    const judged = ["accepted", "corrected", "rejected"].includes(args.outcome);
    const correct = args.outcome === "accepted";
    if (!judged) return;
    const bucket = Math.min(0.95, Math.max(0.5, Math.floor(Number(d.confidence) * 20) / 20));
    await tx.query(
      `INSERT INTO confidence_calibration (org_id, bucket, predictions, correct) VALUES ($1,$2,1,$3)
       ON CONFLICT (org_id, bucket) DO UPDATE SET predictions = confidence_calibration.predictions + 1,
         correct = confidence_calibration.correct + EXCLUDED.correct, updated_at = now()`,
      [orgId, bucket, correct ? 1 : 0]);

    // Penalise the proposed mapping when it was wrong.
    if (!correct && d.profile_path) {
      await tx.query(
        `UPDATE mapping_memory SET beta = beta + 1, failures = failures + 1, corrections = corrections + $4
         WHERE org_id=$1 AND scope='domain' AND domain=$2 AND field_key=$3 AND profile_path=$5`,
        [orgId, d.domain, d.field_key, args.outcome === "corrected" ? 1 : 0, d.profile_path]);
    }
    // Reinforce the final (human-confirmed) mapping.
    if (args.finalPath && args.outcome !== "validation_failed") {
      const sig = signatureText({ id: "", kind: d.kind, label: d.label, ariaLabel: d.aria_label, placeholder: d.placeholder,
                                   name: d.name_attr, autocomplete: d.autocomplete, required: false });
      const vec = embed ? JSON.stringify((await embed([sig]))[0]) : null;
      await tx.query(
        `INSERT INTO mapping_memory (org_id, scope, domain, field_key, signature_text, embedding, profile_path, transform, successes, alpha, beta)
         VALUES ($1,'domain',$2,$3,$4,$5::vector,$6,$7,1,2,1)
         ON CONFLICT (org_id, domain, field_key, profile_path) WHERE scope='domain'
         DO UPDATE SET alpha = mapping_memory.alpha + 1, successes = mapping_memory.successes + 1,
                       transform = EXCLUDED.transform, last_used_at = now(),
                       embedding = COALESCE(EXCLUDED.embedding, mapping_memory.embedding)`,
        [orgId, d.domain, d.field_key, sig, vec, args.finalPath, args.finalTransform]);
    }
  });
}

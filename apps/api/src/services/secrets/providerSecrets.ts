/**
 * Provider credential vault: AI, CAPTCHA, browser, proxy and email providers.
 * - Secrets encrypted with the org DEK (AES-256-GCM), only last4 is ever returned to the UI.
 * - Rotation keeps the previous secret for a grace window so in-flight jobs don't fail.
 * - `chain(category)` returns active credentials in failover order (org policy order, then priority).
 */
import { z } from "zod";
import { decryptForOrg, encryptForOrg, last4 } from "../../lib/crypto.js";
import { withOrg } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";

export const PROVIDERS = {
  ai: ["claude", "openai", "gemini"],
  captcha: ["2captcha", "capsolver", "anticaptcha", "capmonster", "deathbycaptcha", "bestcaptchasolver", "dispurcaptcha", "resolvr", "compatible"],
  browser: ["browserless", "browserbase"],
  proxy: ["brightdata", "oxylabs", "smartproxy"],
  email: ["m365", "smtp", "sendgrid"],
} as const;
export type Category = keyof typeof PROVIDERS;

export const CredentialInput = z.object({
  category: z.enum(["ai", "captcha", "browser", "proxy", "email"]),
  provider: z.string(),
  label: z.string().max(60).default("primary"),
  /** Provider-specific secret payload. apiKey for most; {username,password} for DBC/SMTP; {tenantId,clientId,clientSecret} for M365. */
  secret: z.record(z.string(), z.string()).refine((s) => Object.keys(s).length > 0, "secret required"),
  config: z.record(z.string(), z.unknown()).default({}), // non-secret: { model, endpoint, region, fromAddress }
  priority: z.number().int().min(0).max(1000).default(100),
}).refine((v) => (PROVIDERS[v.category] as readonly string[]).includes(v.provider), { message: "unknown provider for category" });
export type CredentialInput = z.infer<typeof CredentialInput>;

export interface ResolvedCredential {
  id: string;
  provider: string;
  label: string;
  secret: Record<string, string>;
  config: Record<string, unknown>;
}

const GRACE_MS = 24 * 3600_000;

export async function upsertCredential(orgId: string, userId: string, input: CredentialInput) {
  const json = JSON.stringify(input.secret);
  const primary = input.secret.apiKey ?? input.secret.password ?? input.secret.clientSecret ?? json;
  return withOrg(orgId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO provider_credentials (org_id, category, provider, label, secret_enc, secret_last4, config, priority, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (org_id, provider, label) DO UPDATE SET
         previous_secret_enc = provider_credentials.secret_enc,
         previous_expires_at = now() + interval '24 hours',
         secret_enc = EXCLUDED.secret_enc, secret_last4 = EXCLUDED.secret_last4,
         config = EXCLUDED.config, priority = EXCLUDED.priority, rotated_at = now(), status = 'unknown'
       RETURNING id`,
      [orgId, input.category, input.provider, input.label, await encryptForOrg(orgId, json), last4(primary),
       input.config, input.priority, userId],
    );
    return rows[0]!.id;
  });
}

/** Safe listing for the admin UI — never includes secrets. */
export async function listCredentials(orgId: string) {
  return withOrg(orgId, async (tx) => (await tx.query(
    `SELECT id, category, provider, label, '••••' || secret_last4 AS masked, config, priority, is_active, status,
            last_tested_at, last_test_error, rotated_at, created_at
     FROM provider_credentials ORDER BY category, priority, provider`)).rows);
}

export async function getCredential(orgId: string, id: string): Promise<ResolvedCredential> {
  return withOrg(orgId, async (tx) => {
    const r = (await tx.query("SELECT * FROM provider_credentials WHERE id=$1", [id])).rows[0];
    if (!r) throw notFound("credential");
    return { id: r.id, provider: r.provider, label: r.label, config: r.config, secret: JSON.parse((await decryptForOrg(orgId, r.secret_enc))!) };
  });
}

/** Active credentials for a category, in failover order. */
export async function chain(orgId: string, category: Category): Promise<ResolvedCredential[]> {
  return withOrg(orgId, async (tx) => {
    const policy = (await tx.query("SELECT ai_provider_order, captcha_provider_order FROM org_policies WHERE org_id=$1", [orgId])).rows[0];
    const order: string[] = category === "ai" ? policy?.ai_provider_order ?? [] : category === "captcha" ? policy?.captcha_provider_order ?? [] : [];
    const rows = (await tx.query(
      "SELECT * FROM provider_credentials WHERE category=$1 AND is_active AND status <> 'down' ORDER BY priority", [category])).rows;
    rows.sort((a, b) => rank(order, a.provider) - rank(order, b.provider) || a.priority - b.priority);
    return Promise.all(rows.map(async (r) => ({
      id: r.id, provider: r.provider, label: r.label, config: r.config,
      secret: JSON.parse((await decryptForOrg(orgId, r.secret_enc))!),
    })));
  });
}
const rank = (order: string[], p: string) => (order.indexOf(p) === -1 ? 999 : order.indexOf(p));

export async function markStatus(orgId: string, id: string, ok: boolean, error?: string) {
  await withOrg(orgId, (tx) => tx.query(
    `UPDATE provider_credentials SET status=$2, last_tested_at=now(), last_test_error=$3 WHERE id=$1`,
    [id, ok ? "healthy" : "down", error?.slice(0, 500) ?? null]));
}

export async function purgeExpiredPreviousSecrets(orgId: string) {
  await withOrg(orgId, (tx) => tx.query(
    "UPDATE provider_credentials SET previous_secret_enc=NULL, previous_expires_at=NULL WHERE previous_expires_at < now()"));
}
export { GRACE_MS };

/**
 * Guardrails evaluated before a run is queued AND again in the worker before launch.
 *   - URL must be http(s), public (no internal/RFC1918 hosts → SSRF protection for our network)
 *   - Domain not blocked (platform-wide or org rule)
 *   - Per-domain daily run cap and org concurrency cap
 *   - One site account per profile per domain: a second "signup" becomes a "login"
 */
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { parse as parseDomain } from "tldts";
import { env } from "../../config/env.js";
import { withOrg } from "../../lib/db.js";
import { policyViolation, badRequest } from "../../lib/errors.js";

const PRIVATE = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^::1$/, /^f[cd]/i, /^fe80/i];

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw badRequest("invalid URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw badRequest("only http(s) URLs are allowed");
  const host = url.hostname;
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw badRequest("host does not resolve");
  if (env.ALLOW_PRIVATE_TARGETS !== "true" && addrs.some((a) => PRIVATE.some((r) => r.test(a)))) throw policyViolation("private / internal addresses cannot be automated");
  return url;
}

export function registrableDomain(url: URL): string {
  return parseDomain(url.hostname).domain ?? url.hostname;
}

export async function checkRunAllowed(orgId: string, profileId: string, url: URL, intent: string): Promise<{ domain: string; intent: string }> {
  const domain = registrableDomain(url);
  return withOrg(orgId, async (tx) => {
    const rule = (await tx.query(
      `SELECT rule, reason FROM domain_rules WHERE domain = ANY($1) AND (org_id = $2 OR org_id IS NULL)
       ORDER BY (org_id IS NULL), rule = 'block' DESC LIMIT 1`,
      [[url.hostname, domain], orgId])).rows[0];
    if (rule?.rule === "block") throw policyViolation(`automation is blocked for ${domain}${rule.reason ? `: ${rule.reason}` : ""}`);

    const pol = (await tx.query("SELECT * FROM org_policies WHERE org_id=$1", [orgId])).rows[0];
    const today = Number((await tx.query(
      "SELECT count(*) AS n FROM automation_runs WHERE domain=$1 AND created_at > date_trunc('day', now())", [domain])).rows[0].n);
    if (today >= (pol?.max_runs_per_domain_per_day ?? 20)) throw policyViolation(`daily limit for ${domain} reached`);

    const active = Number((await tx.query(
      `SELECT count(*) AS n FROM automation_runs WHERE status NOT IN ('succeeded','failed','cancelled','paused','queued')`)).rows[0].n);
    if (active >= (pol?.max_concurrent_runs ?? 3)) throw policyViolation("concurrent run limit reached — try again shortly");

    // Proxy quarantine: if this profile's proxy was blocked/rate-limited recently, skip it until it clears.
    const cooled = (await tx.query(
      "SELECT cooldown_until, last_block_reason FROM profile_proxies WHERE profile_id=$1 AND cooldown_until > now()", [profileId])).rows[0];
    if (cooled) {
      const mins = Math.ceil((new Date(cooled.cooldown_until).getTime() - Date.now()) / 60000);
      throw policyViolation(`proxy is quarantined for ~${mins} min${cooled.last_block_reason ? ` (${cooled.last_block_reason})` : ""}`);
    }

    const existing = (await tx.query("SELECT 1 FROM site_accounts WHERE profile_id=$1 AND domain=$2", [profileId, domain])).rowCount;
    const effective = intent === "signup" && existing ? "login" : intent;
    return { domain, intent: effective };
  });
}

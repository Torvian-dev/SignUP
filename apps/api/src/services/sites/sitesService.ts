/**
 * "Remembered sites" — the per-website field-maps the agent has learned (teach-once).
 * mapping_memory has no RLS (it also holds opt-in global rows), so every query filters org_id explicitly.
 */
import { withOrg } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";

// confidence: a clean confirmed mapping (no failures/corrections) is certain; otherwise the Beta posterior.
const CONF = "(CASE WHEN failures=0 AND corrections=0 THEN 0.99 ELSE alpha/(alpha+beta) END)";

export async function listSites(orgId: string) {
  return withOrg(orgId, async (tx) => (await tx.query(
    `SELECT m.domain,
            count(*)::int AS fields,
            round(avg(${CONF})::numeric, 3) AS avg_confidence,
            max(m.last_used_at) AS last_used,
            (SELECT count(*) FROM site_accounts sa WHERE sa.org_id=m.org_id AND sa.domain=m.domain)::int AS accounts,
            (SELECT count(*) FROM automation_runs r WHERE r.org_id=m.org_id AND r.domain=m.domain AND r.status='succeeded')::int AS succeeded_runs
     FROM mapping_memory m
     WHERE m.scope='domain' AND m.org_id=$1
     GROUP BY m.domain, m.org_id
     ORDER BY max(m.last_used_at) DESC NULLS LAST`, [orgId])).rows);
}

export async function getSite(orgId: string, domain: string) {
  return withOrg(orgId, async (tx) => {
    const fields = (await tx.query(
      `SELECT id, signature_text, profile_path, transform, successes, failures, corrections,
              round(${CONF}::numeric, 3) AS confidence, last_used_at
       FROM mapping_memory WHERE scope='domain' AND org_id=$1 AND domain=$2
       ORDER BY ${CONF} DESC, signature_text`, [orgId, domain])).rows;
    if (fields.length === 0) throw notFound("site");
    const accounts = (await tx.query("SELECT count(*)::int AS n FROM site_accounts WHERE org_id=$1 AND domain=$2", [orgId, domain])).rows[0].n;
    return { domain, fields, accounts };
  });
}

/** Forget everything learned for a website. */
export async function forgetSite(orgId: string, domain: string) {
  const r = await withOrg(orgId, (tx) => tx.query("DELETE FROM mapping_memory WHERE scope='domain' AND org_id=$1 AND domain=$2", [orgId, domain]));
  if (!r.rowCount) throw notFound("site");
}

/** Forget one remembered field. */
export async function forgetField(orgId: string, id: string) {
  const r = await withOrg(orgId, (tx) => tx.query("DELETE FROM mapping_memory WHERE id=$1 AND org_id=$2 AND scope='domain'", [id, orgId]));
  if (!r.rowCount) throw notFound("field");
}

/** Change what a remembered field maps to (and reset its confidence to a clean confirmed state). */
export async function editField(orgId: string, id: string, profilePath: string, transform: string | null) {
  const r = await withOrg(orgId, (tx) => tx.query(
    "UPDATE mapping_memory SET profile_path=$3, transform=$4, alpha=2, beta=1, failures=0, corrections=0, successes=1 WHERE id=$1 AND org_id=$2 AND scope='domain'",
    [id, orgId, profilePath, transform]));
  if (!r.rowCount) throw notFound("field");
}

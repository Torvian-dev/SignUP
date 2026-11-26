/**
 * Bulk operations over many profiles at once. Each writes only the sub-tables it needs (proxy,
 * address, custom field) rather than re-saving the whole profile, so there are no version
 * conflicts and unrelated fields are never touched. One bad row is reported, the rest still apply.
 */
import { withOrg } from "../../lib/db.js";
import { encryptForOrg } from "../../lib/crypto.js";
import { parseProxyString } from "../../lib/proxy.js";

const enc = encryptForOrg;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").replace(/^(\d)/, "f_$1").slice(0, 63) || "field";

export interface BulkResult { updated: number; failed: { profileId: string; error: string }[] }

/** Assign/replace the proxy on each profile. items pair a profile with its proxy string. */
export async function bulkSetProxies(orgId: string, items: { profileId: string; proxy: string }[]): Promise<BulkResult> {
  const res: BulkResult = { updated: 0, failed: [] };
  await withOrg(orgId, async (tx) => {
    for (const it of items) {
      try {
        const p = parseProxyString(it.proxy);
        if (!p) throw new Error(`cannot parse "${it.proxy}" — use ip:port or ip:port:user:pass`);
        await tx.query(
          `INSERT INTO profile_proxies (profile_id, org_id, type, host, port, username_enc, password_enc, credentials_rotated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7, now())
           ON CONFLICT (profile_id) DO UPDATE SET type=EXCLUDED.type, host=EXCLUDED.host, port=EXCLUDED.port,
             username_enc=EXCLUDED.username_enc, password_enc=EXCLUDED.password_enc,
             credentials_rotated_at = CASE WHEN profile_proxies.password_enc IS DISTINCT FROM EXCLUDED.password_enc
                                           THEN now() ELSE profile_proxies.credentials_rotated_at END,
             health_status='unknown', cooldown_until=NULL, block_count=0, last_block_reason=NULL`,
          [it.profileId, orgId, p.type, p.host, p.port, await enc(orgId, p.username), await enc(orgId, p.password)]);
        res.updated++;
      } catch (e) {
        res.failed.push({ profileId: it.profileId, error: (e as Error).message.slice(0, 160) });
      }
    }
  });
  return res;
}

/** Crypto-shred + soft-delete several profiles (same as the single delete). */
export async function bulkDelete(orgId: string, profileIds: string[]): Promise<BulkResult> {
  return withOrg(orgId, async (tx) => {
    const r = await tx.query(
      `UPDATE profiles SET deleted_at=now(), first_name_enc=NULL, last_name_enc=NULL, email_enc=NULL, phone_enc=NULL, email_blind_idx=NULL
       WHERE id = ANY($1) AND deleted_at IS NULL`, [profileIds]);
    for (const t of ["profile_addresses", "profile_proxies", "profile_custom_fields", "site_accounts", "browser_profiles"])
      await tx.query(`DELETE FROM ${t} WHERE profile_id = ANY($1)`, [profileIds]);
    return { updated: r.rowCount ?? 0, failed: [] };
  });
}

/** Apply the same country / timezone / locale to several profiles. */
export async function bulkSetLocation(orgId: string, profileIds: string[],
  loc: { countryCode?: string; timezone?: string; locale?: string }): Promise<BulkResult> {
  return withOrg(orgId, async (tx) => {
    if (loc.timezone || loc.locale) {
      await tx.query(
        `UPDATE profiles SET timezone=COALESCE($2,timezone), locale=COALESCE($3,locale), version=version+1
         WHERE id = ANY($1) AND deleted_at IS NULL`,
        [profileIds, loc.timezone ?? null, loc.locale ?? null]);
    }
    if (loc.countryCode) {
      // Only existing primary addresses are updated; profiles without one are left unchanged.
      await tx.query(`UPDATE profile_addresses SET country_code=$2 WHERE profile_id = ANY($1) AND kind='primary'`,
        [profileIds, loc.countryCode.toUpperCase()]);
    }
    return { updated: profileIds.length, failed: [] };
  });
}

/** Set one custom field (same key/label/value) across several profiles. */
export async function bulkSetCustomField(orgId: string, profileIds: string[],
  f: { label: string; value: string; type?: string }): Promise<BulkResult> {
  const res: BulkResult = { updated: 0, failed: [] };
  const key = slug(f.label);
  await withOrg(orgId, async (tx) => {
    for (const pid of profileIds) {
      try {
        await tx.query(
          `INSERT INTO profile_custom_fields (profile_id, org_id, key, label, type, value_enc)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (profile_id, key) DO UPDATE SET label=EXCLUDED.label, type=EXCLUDED.type,
             value_enc=EXCLUDED.value_enc, updated_at=now()`,
          [pid, orgId, key, f.label, (f.type as string) ?? "text", await enc(orgId, f.value)]);
        res.updated++;
      } catch (e) {
        res.failed.push({ profileId: pid, error: (e as Error).message.slice(0, 160) });
      }
    }
  });
  return res;
}

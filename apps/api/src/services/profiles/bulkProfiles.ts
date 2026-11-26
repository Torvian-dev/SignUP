/**
 * Bulk operations over many profiles at once. Each writes only the sub-tables it needs (proxy,
 * address, custom field) rather than re-saving the whole profile, so there are no version
 * conflicts and unrelated fields are never touched. One bad row is reported, the rest still apply.
 */
import { withOrg } from "../../lib/db.js";
import { encryptForOrg, blindIndex } from "../../lib/crypto.js";
import { parseProxyString } from "../../lib/proxy.js";
import { badRequest } from "../../lib/errors.js";

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

/**
 * General bulk field editor — set ANY profile column to the same value across the selection.
 * `field` is one of the keys below (personal/settings/address) or "custom:<Field name>".
 * Address sub-fields update only existing primary addresses; `country` creates one if missing.
 */
const PERSONAL_ENC: Record<string, string> = { firstName: "first_name_enc", lastName: "last_name_enc", phone: "phone_enc" };
const ADDRESS_ENC: Record<string, string> = { line1: "line1_enc", line2: "line2_enc", city: "city_enc", region: "region_enc", postcode: "postcode_enc" };

export async function bulkSetField(orgId: string, profileIds: string[], field: string, value: string): Promise<BulkResult> {
  return withOrg(orgId, async (tx) => {
    // Personal encrypted columns
    if (field in PERSONAL_ENC) {
      const r = await tx.query(`UPDATE profiles SET ${PERSONAL_ENC[field]}=$2, version=version+1 WHERE id = ANY($1) AND deleted_at IS NULL`,
        [profileIds, await enc(orgId, value)]);
      return { updated: r.rowCount ?? 0, failed: [] };
    }
    if (field === "email") {
      const r = await tx.query(`UPDATE profiles SET email_enc=$2, email_blind_idx=$3, version=version+1 WHERE id = ANY($1) AND deleted_at IS NULL`,
        [profileIds, await enc(orgId, value), value ? blindIndex(value) : null]);
      return { updated: r.rowCount ?? 0, failed: [] };
    }
    if (field === "locale" || field === "timezone") {
      const r = await tx.query(`UPDATE profiles SET ${field}=$2, version=version+1 WHERE id = ANY($1) AND deleted_at IS NULL`, [profileIds, value]);
      return { updated: r.rowCount ?? 0, failed: [] };
    }
    if (field === "country") {
      await tx.query(
        `INSERT INTO profile_addresses (profile_id, org_id, kind, country_code)
         SELECT id, $2, 'primary', $3 FROM profiles WHERE id = ANY($1) AND deleted_at IS NULL
         ON CONFLICT (profile_id, kind) DO UPDATE SET country_code=EXCLUDED.country_code`,
        [profileIds, orgId, value.toUpperCase().slice(0, 2)]);
      return { updated: profileIds.length, failed: [] };
    }
    if (field.startsWith("address.")) {
      const col = ADDRESS_ENC[field.slice(8)];
      if (!col) throw badRequest(`unknown field ${field}`);
      const r = await tx.query(`UPDATE profile_addresses SET ${col}=$2 WHERE profile_id = ANY($1) AND kind='primary'`,
        [profileIds, await enc(orgId, value)]);
      return { updated: r.rowCount ?? 0, failed: [] };
    }
    if (field.startsWith("custom:")) {
      const label = field.slice(7).trim();
      if (!label) throw badRequest("custom field needs a name");
      const key = slug(label);
      let updated = 0;
      for (const pid of profileIds) {
        await tx.query(
          `INSERT INTO profile_custom_fields (profile_id, org_id, key, label, type, value_enc)
           VALUES ($1,$2,$3,$4,'text',$5)
           ON CONFLICT (profile_id, key) DO UPDATE SET label=EXCLUDED.label, value_enc=EXCLUDED.value_enc, updated_at=now()`,
          [pid, orgId, key, label, await enc(orgId, value)]);
        updated++;
      }
      return { updated, failed: [] };
    }
    throw badRequest(`unknown field ${field}`);
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

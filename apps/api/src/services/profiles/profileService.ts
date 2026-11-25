import { z } from "zod";
import { blindIndex, decryptForOrg, encryptForOrg } from "../../lib/crypto.js";
import { withOrg, type Tx } from "../../lib/db.js";
import { conflict, notFound } from "../../lib/errors.js";

// ---------------------------------------------------------------------------
// Validation schemas (shared with the web app via the OpenAPI spec)
// ---------------------------------------------------------------------------
export const AddressInput = z.object({
  kind: z.enum(["primary", "billing", "shipping", "registered_office"]).default("primary"),
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(), // County / State
  postcode: z.string().max(20).optional(),
  countryCode: z.string().length(2).toUpperCase(),
});

export const ProxyInput = z.object({
  type: z.enum(["http", "https", "socks5"]),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(255).optional(),
  password: z.string().max(255).optional(),
  credentialRotateDays: z.number().int().min(1).max(365).optional(),
  stickySessionId: z.string().max(120).optional(),
});

export const CustomFieldInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "snake_case key"),
  label: z.string().min(1).max(120),
  type: z.enum(["text", "date", "number", "email", "phone", "url", "secret", "file"]).default("text"),
  value: z.string().max(5000).optional(),
  documentId: z.string().uuid().optional(), // for type=file
  synonyms: z.array(z.string().max(60)).max(20).default([]),
});

export const ProfileInput = z.object({
  label: z.string().min(1).max(120),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  locale: z.string().default("en-GB"),
  timezone: z.string().default("Europe/London"),
  isDefault: z.boolean().default(false),
  addresses: z.array(AddressInput).max(4).default([]),
  proxy: ProxyInput.nullable().optional(), // exactly one proxy per profile, or none
  customFields: z.array(CustomFieldInput).max(500).default([]),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

/** Fully decrypted profile — only ever held in memory inside the API / worker. */
export interface DecryptedProfile {
  id: string;
  orgId: string;
  label: string;
  locale: string;
  timezone: string;
  personal: { firstName?: string; lastName?: string; email?: string; phone?: string };
  addresses: Record<string, { line1?: string; line2?: string; city?: string; region?: string; postcode?: string; countryCode: string }>;
  proxy: null | { type: string; host: string; port: number; username?: string; password?: string; stickySessionId?: string };
  custom: Record<string, { label: string; type: string; value?: string; documentId?: string; synonyms: string[] }>;
}

const enc = encryptForOrg;
const dec = async (orgId: string, b: Buffer | null) => (await decryptForOrg(orgId, b)) ?? undefined;

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
export async function createProfile(orgId: string, userId: string, input: ProfileInput): Promise<string> {
  return withOrg(orgId, async (tx) => {
    if (input.isDefault) await tx.query("UPDATE profiles SET is_default=false WHERE org_id=$1", [orgId]);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO profiles (org_id, owner_user_id, label, first_name_enc, last_name_enc, email_enc, phone_enc,
                             email_blind_idx, locale, timezone, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        orgId, userId, input.label,
        await enc(orgId, input.firstName), await enc(orgId, input.lastName),
        await enc(orgId, input.email), await enc(orgId, input.phone),
        input.email ? blindIndex(input.email) : null,
        input.locale, input.timezone, input.isDefault,
      ],
    );
    const profileId = rows[0]!.id;
    await writeChildren(tx, orgId, profileId, input);
    return profileId;
  });
}

export async function updateProfile(orgId: string, profileId: string, expectedVersion: number, input: ProfileInput) {
  return withOrg(orgId, async (tx) => {
    const r = await tx.query(
      `UPDATE profiles SET label=$3, first_name_enc=$4, last_name_enc=$5, email_enc=$6, phone_enc=$7,
              email_blind_idx=$8, locale=$9, timezone=$10, is_default=$11, version=version+1
       WHERE id=$1 AND version=$2 AND deleted_at IS NULL`,
      [
        profileId, expectedVersion, input.label,
        await enc(orgId, input.firstName), await enc(orgId, input.lastName),
        await enc(orgId, input.email), await enc(orgId, input.phone),
        input.email ? blindIndex(input.email) : null,
        input.locale, input.timezone, input.isDefault,
      ],
    );
    if (r.rowCount === 0) throw conflict("profile was modified by someone else — reload and retry");
    if (input.isDefault)
      await tx.query("UPDATE profiles SET is_default=false WHERE org_id=$1 AND id<>$2", [orgId, profileId]);
    await tx.query("DELETE FROM profile_addresses WHERE profile_id=$1", [profileId]);
    await tx.query("DELETE FROM profile_custom_fields WHERE profile_id=$1", [profileId]);
    if (input.proxy === null) await tx.query("DELETE FROM profile_proxies WHERE profile_id=$1", [profileId]);
    await writeChildren(tx, orgId, profileId, input);
  });
}

async function writeChildren(tx: Tx, orgId: string, profileId: string, input: ProfileInput) {
  for (const a of input.addresses) {
    await tx.query(
      `INSERT INTO profile_addresses (profile_id, org_id, kind, line1_enc, line2_enc, city_enc, region_enc, postcode_enc, country_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [profileId, orgId, a.kind, await enc(orgId, a.line1), await enc(orgId, a.line2), await enc(orgId, a.city),
       await enc(orgId, a.region), await enc(orgId, a.postcode), a.countryCode],
    );
  }
  if (input.proxy) {
    const p = input.proxy;
    // UPSERT on the UNIQUE(profile_id) constraint: one proxy per profile, always.
    await tx.query(
      `INSERT INTO profile_proxies (profile_id, org_id, type, host, port, username_enc, password_enc,
                                    credential_rotate_days, sticky_session_id, credentials_rotated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (profile_id) DO UPDATE SET type=EXCLUDED.type, host=EXCLUDED.host, port=EXCLUDED.port,
         username_enc=EXCLUDED.username_enc, password_enc=EXCLUDED.password_enc,
         credential_rotate_days=EXCLUDED.credential_rotate_days, sticky_session_id=EXCLUDED.sticky_session_id,
         credentials_rotated_at = CASE WHEN profile_proxies.password_enc IS DISTINCT FROM EXCLUDED.password_enc
                                       THEN now() ELSE profile_proxies.credentials_rotated_at END,
         health_status='unknown'`,
      [profileId, orgId, p.type, p.host, p.port, await enc(orgId, p.username), await enc(orgId, p.password),
       p.credentialRotateDays ?? null, p.stickySessionId ?? null],
    );
  }
  for (const [i, f] of input.customFields.entries()) {
    await tx.query(
      `INSERT INTO profile_custom_fields (profile_id, org_id, key, label, type, value_enc, blob_path, synonyms, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,(SELECT blob_path FROM documents WHERE id=$7),$8,$9)`,
      [profileId, orgId, f.key, f.label, f.type, await enc(orgId, f.value), f.documentId ?? null, f.synonyms, i],
    );
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function getDecryptedProfile(orgId: string, profileId: string): Promise<DecryptedProfile> {
  return withOrg(orgId, async (tx) => {
    const p = (await tx.query("SELECT * FROM profiles WHERE id=$1 AND deleted_at IS NULL", [profileId])).rows[0];
    if (!p) throw notFound("profile");
    const addrRows = (await tx.query("SELECT * FROM profile_addresses WHERE profile_id=$1", [profileId])).rows;
    const proxyRow = (await tx.query("SELECT * FROM profile_proxies WHERE profile_id=$1", [profileId])).rows[0];
    const cfRows = (await tx.query(
      `SELECT cf.*, d.id AS document_id FROM profile_custom_fields cf
       LEFT JOIN documents d ON d.blob_path = cf.blob_path WHERE cf.profile_id=$1 ORDER BY sort_order`, [profileId])).rows;

    const addresses: DecryptedProfile["addresses"] = {};
    for (const a of addrRows) {
      addresses[a.kind] = {
        line1: await dec(orgId, a.line1_enc), line2: await dec(orgId, a.line2_enc), city: await dec(orgId, a.city_enc),
        region: await dec(orgId, a.region_enc), postcode: await dec(orgId, a.postcode_enc), countryCode: a.country_code,
      };
    }
    const custom: DecryptedProfile["custom"] = {};
    for (const c of cfRows) {
      custom[c.key] = { label: c.label, type: c.type, value: await dec(orgId, c.value_enc), documentId: c.document_id ?? undefined, synonyms: c.synonyms };
    }
    return {
      id: p.id, orgId, label: p.label, locale: p.locale, timezone: p.timezone,
      personal: {
        firstName: await dec(orgId, p.first_name_enc), lastName: await dec(orgId, p.last_name_enc),
        email: await dec(orgId, p.email_enc), phone: await dec(orgId, p.phone_enc),
      },
      addresses,
      proxy: proxyRow
        ? { type: proxyRow.type, host: proxyRow.host, port: proxyRow.port, username: await dec(orgId, proxyRow.username_enc),
            password: await dec(orgId, proxyRow.password_enc), stickySessionId: proxyRow.sticky_session_id ?? undefined }
        : null,
      custom,
    };
  });
}

/** List view: masked values only (e.g. "J*** S****", "j***@email.com"). */
export async function listProfiles(orgId: string) {
  return withOrg(orgId, async (tx) => {
    const { rows } = await tx.query(
      `SELECT p.id, p.label, p.is_default, p.version, p.updated_at, p.first_name_enc, p.last_name_enc, p.email_enc,
              (SELECT count(*) FROM profile_custom_fields cf WHERE cf.profile_id=p.id)::int AS custom_field_count,
              pp.host AS proxy_host, pp.health_status AS proxy_health
       FROM profiles p LEFT JOIN profile_proxies pp ON pp.profile_id = p.id
       WHERE p.deleted_at IS NULL ORDER BY p.is_default DESC, p.label`,
    );
    return Promise.all(rows.map(async (r) => ({
      id: r.id, label: r.label, isDefault: r.is_default, version: r.version, updatedAt: r.updated_at,
      displayName: mask(`${(await dec(orgId, r.first_name_enc)) ?? ""} ${(await dec(orgId, r.last_name_enc)) ?? ""}`.trim()),
      email: maskEmail(await dec(orgId, r.email_enc)),
      customFieldCount: r.custom_field_count,
      proxy: r.proxy_host ? { host: r.proxy_host, health: r.proxy_health } : null,
    })));
  });
}

const mask = (s: string) => s.split(" ").map((w) => (w ? w[0] + "*".repeat(Math.max(1, w.length - 1)) : w)).join(" ");
const maskEmail = (e?: string) => (e ? e.replace(/^(.)[^@]*(@.*)$/, "$1***$2") : undefined);

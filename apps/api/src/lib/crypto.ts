/**
 * Envelope encryption (AES-256-GCM).
 *
 *   KEK  (Azure Key Vault, RSA-HSM 3072, never leaves the HSM)
 *     └─ wraps → per-organisation DEK (32 random bytes), stored wrapped in organizations.dek_wrapped
 *                  └─ encrypts → every [ENC] column + provider API keys + browser storage blobs
 *
 * Ciphertext envelope (bytea):  v(1) | keyIdLen(1) | keyId | iv(12) | tag(16) | ciphertext
 * The org id is bound as AAD so a ciphertext copied into another tenant's row fails to decrypt.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DefaultAzureCredential } from "@azure/identity";
import { CryptographyClient, KeyClient } from "@azure/keyvault-keys";
import { env } from "../config/env.js";
import { db } from "./db.js";

const VERSION = 1;
const DEK_CACHE_TTL_MS = 5 * 60_000;
const dekCache = new Map<string, { key: Buffer; keyId: string; expires: number }>();

interface KekClient {
  wrap(dek: Buffer): Promise<{ wrapped: Buffer; keyVersion: string }>;
  unwrap(wrapped: Buffer, keyVersion: string): Promise<Buffer>;
}

class AzureKek implements KekClient {
  private cred = new DefaultAzureCredential();
  private keys = new KeyClient(env.KEY_VAULT_URL!, this.cred);
  async wrap(dek: Buffer) {
    const key = await this.keys.getKey(env.KEK_NAME);
    const crypto = new CryptographyClient(key, this.cred);
    const r = await crypto.wrapKey("RSA-OAEP-256", dek);
    return { wrapped: Buffer.from(r.result), keyVersion: key.properties.version! };
  }
  async unwrap(wrapped: Buffer, keyVersion: string) {
    const key = await this.keys.getKey(env.KEK_NAME, { version: keyVersion });
    const crypto = new CryptographyClient(key, this.cred);
    const r = await crypto.unwrapKey("RSA-OAEP-256", wrapped);
    return Buffer.from(r.result);
  }
}

/** Dev-only KEK: AES-256-GCM with a local key. Refuses to run in production. */
class LocalKek implements KekClient {
  private kek = Buffer.from(env.DEV_LOCAL_KEK_HEX ?? "", "hex");
  constructor() {
    if (env.NODE_ENV === "production") throw new Error("LocalKek is not permitted in production");
    if (this.kek.length !== 32) throw new Error("DEV_LOCAL_KEK_HEX must be 32 bytes");
  }
  async wrap(dek: Buffer) {
    return { wrapped: aesGcmEncrypt(this.kek, dek, Buffer.from("kek")), keyVersion: "local" };
  }
  async unwrap(wrapped: Buffer) {
    return aesGcmDecrypt(this.kek, wrapped, Buffer.from("kek"));
  }
}

const kek: KekClient = env.KEY_VAULT_URL ? new AzureKek() : new LocalKek();

function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function aesGcmDecrypt(key: Buffer, blob: Buffer, aad: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAAD(aad);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

/** Create and wrap a fresh DEK for a new organisation. */
export async function createOrgDek(): Promise<{ wrapped: Buffer; keyVersion: string }> {
  return kek.wrap(randomBytes(32));
}

async function getOrgDek(orgId: string): Promise<{ key: Buffer; keyId: string }> {
  const hit = dekCache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit;
  const { rows } = await db.query<{ dek_wrapped: Buffer; dek_key_version: string }>(
    "SELECT dek_wrapped, dek_key_version FROM organizations WHERE id = $1",
    [orgId],
  );
  if (!rows[0]) throw new Error("organisation not found");
  const key = await kek.unwrap(rows[0].dek_wrapped, rows[0].dek_key_version);
  const entry = { key, keyId: `${orgId}:${rows[0].dek_key_version}`, expires: Date.now() + DEK_CACHE_TTL_MS };
  dekCache.set(orgId, entry);
  return entry;
}

export async function encryptForOrg(orgId: string, value: string | Buffer | null | undefined): Promise<Buffer | null> {
  if (value === null || value === undefined || value === "") return null;
  const { key, keyId } = await getOrgDek(orgId);
  const keyIdBuf = Buffer.from(keyId);
  const body = aesGcmEncrypt(key, Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"), Buffer.from(orgId));
  return Buffer.concat([Buffer.from([VERSION, keyIdBuf.length]), keyIdBuf, body]);
}

export async function decryptForOrg(orgId: string, blob: Buffer | null | undefined): Promise<string | null> {
  const buf = await decryptBufferForOrg(orgId, blob);
  return buf ? buf.toString("utf8") : null;
}

export async function decryptBufferForOrg(orgId: string, blob: Buffer | null | undefined): Promise<Buffer | null> {
  if (!blob) return null;
  if (blob[0] !== VERSION) throw new Error(`unsupported envelope version ${blob[0]}`);
  const keyIdLen = blob[1]!;
  const { key } = await getOrgDek(orgId);
  return aesGcmDecrypt(key, blob.subarray(2 + keyIdLen), Buffer.from(orgId));
}

/** Deterministic keyed hash for equality lookups on encrypted columns (e.g. find profile by email). */
export function blindIndex(value: string): Buffer {
  return createHmac("sha256", Buffer.from(env.BLIND_INDEX_KEY_HEX, "hex"))
    .update(value.trim().toLowerCase())
    .digest();
}

export function sha256(value: string | Buffer): Buffer {
  return createHmac("sha256", "formagent-value-fingerprint").update(value).digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Mask a secret for display: "sk-ant-…a1B2" → "••••a1B2". */
export function last4(secret: string): string {
  return secret.slice(-4);
}

/** Strong password for site accounts the agent creates on the user's behalf. */
export function generateSitePassword(length = 20): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%^&*-_=+"];
  const all = sets.join("");
  const bytes = randomBytes(length);
  const chars = sets.map((s, i) => s[bytes[i]! % s.length]!); // at least one from every class
  for (let i = chars.length; i < length; i++) chars.push(all[bytes[i]! % all.length]!);
  // Fisher–Yates shuffle with fresh randomness
  const r = randomBytes(length);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = r[i]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

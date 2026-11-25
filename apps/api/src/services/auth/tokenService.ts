/**
 * API token service.
 *  - Access token: ES256 JWT, 15 min, claims {sub, org, role, sid}.
 *  - Refresh token: opaque 256-bit random, stored as sha256, rotated on every use.
 *    Reusing an already-rotated token revokes the whole family (token theft detection).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { env } from "../../config/env.js";
import { db } from "../../lib/db.js";
import { HttpError } from "../../lib/errors.js";
import type { Role } from "../../middleware/rbac.js";

const privateKey = importPKCS8(env.JWT_PRIVATE_KEY_PEM, "ES256");
const hash = (t: string) => createHash("sha256").update(t).digest();

export async function issueAccessToken(userId: string, orgId: string, role: Role, sid: string) {
  return new SignJWT({ org: orgId, role, sid })
    .setProtectedHeader({ alg: "ES256", kid: "v1" })
    .setSubject(userId).setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE)
    .setIssuedAt().setExpirationTime(`${env.ACCESS_TOKEN_TTL_SEC}s`).setJti(randomUUID())
    .sign(await privateKey);
}

export async function issueTokenPair(userId: string, orgId: string, role: Role, familyId: string = randomUUID()) {
  const refresh = randomBytes(32).toString("base64url");
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(secs => $4)) RETURNING id`,
    [userId, familyId, hash(refresh), env.REFRESH_TOKEN_TTL_SEC]);
  return {
    accessToken: await issueAccessToken(userId, orgId, role, familyId),
    refreshToken: refresh, refreshId: rows[0]!.id, expiresIn: env.ACCESS_TOKEN_TTL_SEC,
  };
}

export async function rotateRefreshToken(token: string, orgId: string) {
  const row = (await db.query("SELECT * FROM refresh_tokens WHERE token_hash=$1", [hash(token)])).rows[0];
  if (!row || row.expires_at < new Date()) throw new HttpError(401, "unauthenticated", "refresh token invalid");
  if (row.revoked_at) {
    await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE family_id=$1 AND revoked_at IS NULL", [row.family_id]);
    throw new HttpError(401, "token_reuse", "refresh token reuse detected — session revoked");
  }
  const m = (await db.query(
    `SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.org_id=$2 AND NOT u.is_disabled`,
    [row.user_id, orgId])).rows[0];
  if (!m) throw new HttpError(403, "forbidden", "no membership");
  const pair = await issueTokenPair(row.user_id, orgId, m.role, row.family_id);
  await db.query("UPDATE refresh_tokens SET revoked_at=now(), replaced_by=$2 WHERE id=$1", [row.id, pair.refreshId]);
  return pair;
}

export async function revokeFamily(familyId: string) {
  await db.query("UPDATE refresh_tokens SET revoked_at=now() WHERE family_id=$1 AND revoked_at IS NULL", [familyId]);
}

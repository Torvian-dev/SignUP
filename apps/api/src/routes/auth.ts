/**
 * Auth endpoints. Interactive sign-in (Google / Microsoft Entra ID / email+password + TOTP) is handled
 * by Auth.js in the Next.js app. The Next.js *server* then exchanges the verified Auth.js session for
 * API tokens here, authenticated with a shared secret (never exposed to the browser).
 */
import { Router } from "express";
import argon2 from "argon2";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { createOrgDek } from "../lib/crypto.js";
import { db } from "../lib/db.js";
import { HttpError } from "../lib/errors.js";
import { audit } from "../middleware/audit.js";
import { auth, requireAuth } from "../middleware/auth.js";
import { ah, parse } from "../middleware/http.js";
import { issueTokenPair, revokeFamily, rotateRefreshToken } from "../services/auth/tokenService.js";

export const authRouter = Router();

function requireInternal(secret: string | undefined) {
  const a = Buffer.from(secret ?? "");
  const b = Buffer.from(env.INTERNAL_EXCHANGE_SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "unauthenticated", "bad internal secret");
}

/** Used by the Auth.js Credentials provider. Constant-time-ish: always runs argon2. */
authRouter.post("/verify-password", ah(async (req, res) => {
  requireInternal(req.get("x-internal-secret"));
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
  const u = (await db.query("SELECT id, password_hash, is_disabled, mfa_enabled FROM users WHERE email=$1", [email])).rows[0];
  const ok = await argon2.verify(u?.password_hash ?? "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG", password).catch(() => false);
  if (!u || !ok || u.is_disabled) {
    await audit({ orgId: null, action: "auth.login_failed", metadata: { email_domain: email.split("@")[1] }, ip: req.ip });
    throw new HttpError(401, "invalid_credentials", "invalid email or password");
  }
  res.json({ userId: u.id, mfaRequired: u.mfa_enabled });
}));

/** Next.js server → API: exchange a verified Auth.js identity for API tokens. Creates org on first login. */
authRouter.post("/exchange", ah(async (req, res) => {
  requireInternal(req.get("x-internal-secret"));
  const body = parse(z.object({ userId: z.string().uuid(), orgId: z.string().uuid().optional() }), req.body);
  let m = (await db.query(
    `SELECT m.org_id, m.role FROM memberships m WHERE m.user_id=$1 ${body.orgId ? "AND m.org_id=$2" : ""} ORDER BY m.created_at LIMIT 1`,
    body.orgId ? [body.userId, body.orgId] : [body.userId])).rows[0];
  if (!m) {
    // First login: personal organisation with its own DEK, default guardrail policy.
    const user = (await db.query("SELECT email, name FROM users WHERE id=$1", [body.userId])).rows[0];
    if (!user) throw new HttpError(404, "not_found", "user not found");
    const dek = await createOrgDek();
    const org = (await db.query(
      `INSERT INTO organizations (name, slug, dek_wrapped, dek_key_version) VALUES ($1, $2, $3, $4) RETURNING id`,
      [user.name ?? user.email, `${user.email.split("@")[0]}-${Date.now().toString(36)}`, dek.wrapped, dek.keyVersion])).rows[0];
    await db.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,'owner')", [org.id, body.userId]);
    await db.query("INSERT INTO org_policies (org_id) VALUES ($1)", [org.id]);
    m = { org_id: org.id, role: "owner" };
  }
  await db.query("UPDATE users SET last_login_at=now() WHERE id=$1", [body.userId]);
  await audit({ orgId: m.org_id, actorUserId: body.userId, action: "auth.login", ip: req.get("x-forwarded-for") ?? req.ip, userAgent: req.get("x-client-ua") });
  res.json(await issueTokenPair(body.userId, m.org_id, m.role));
}));

authRouter.post("/refresh", ah(async (req, res) => {
  const { refreshToken, orgId } = parse(z.object({ refreshToken: z.string().min(20), orgId: z.string().uuid() }), req.body);
  res.json(await rotateRefreshToken(refreshToken, orgId));
}));

authRouter.post("/logout", requireAuth, ah(async (req, res) => {
  const a = auth(req);
  await revokeFamily(a.sessionId);
  await audit({ orgId: a.orgId, actorUserId: a.userId, action: "auth.logout", ip: req.ip });
  res.status(204).end();
}));

authRouter.get("/me", requireAuth, ah(async (req, res) => {
  const a = auth(req);
  const u = (await db.query("SELECT id, email, name, image_url, mfa_enabled FROM users WHERE id=$1", [a.userId])).rows[0];
  const orgs = (await db.query(
    "SELECT o.id, o.name, m.role FROM memberships m JOIN organizations o ON o.id=m.org_id WHERE m.user_id=$1", [a.userId])).rows;
  res.json({ user: u, currentOrgId: a.orgId, role: a.role, organizations: orgs });
}));

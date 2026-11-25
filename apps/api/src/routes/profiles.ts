import { Router } from "express";
import { z } from "zod";
import { withOrg } from "../lib/db.js";
import { notFound } from "../lib/errors.js";
import { audit, auditFromReq } from "../middleware/audit.js";
import { auth } from "../middleware/auth.js";
import { ah, parse } from "../middleware/http.js";
import { requirePermission } from "../middleware/rbac.js";
import { createProfile, getDecryptedProfile, listProfiles, ProfileInput, updateProfile } from "../services/profiles/profileService.js";

export const profilesRouter = Router();

profilesRouter.get("/", requirePermission("profile:read"), ah(async (req, res) => {
  res.json({ data: await listProfiles(auth(req).orgId) });
}));

profilesRouter.post("/", requirePermission("profile:write"), ah(async (req, res) => {
  const a = auth(req);
  const input = parse(ProfileInput, req.body);
  const id = await createProfile(a.orgId, a.userId, input);
  await audit(auditFromReq(req, { action: "profile.create", targetType: "profile", targetId: id,
    metadata: { fields: Object.keys(input).filter((k) => (input as any)[k] !== undefined), customFields: input.customFields.length, proxy: !!input.proxy } }));
  res.status(201).json({ id });
}));

/** Full decrypted profile — explicit "reveal" permission + audit, because it returns PII. */
profilesRouter.get("/:id", requirePermission("profile:reveal"), ah(async (req, res) => {
  const a = auth(req);
  const p = await getDecryptedProfile(a.orgId, req.params.id!);
  const version = await withOrg(a.orgId, async (tx) => (await tx.query("SELECT version FROM profiles WHERE id=$1", [p.id])).rows[0]?.version);
  await audit(auditFromReq(req, { action: "profile.secret_read", targetType: "profile", targetId: p.id }));
  // Proxy password is write-only: never returned, only "set: true".
  res.json({ ...p, version, proxy: p.proxy ? { ...p.proxy, password: undefined, passwordSet: !!p.proxy.password } : null });
}));

profilesRouter.put("/:id", requirePermission("profile:write"), ah(async (req, res) => {
  const a = auth(req);
  const { version, ...rest } = parse(ProfileInput.extend({ version: z.number().int() }), req.body);
  if (rest.proxy && rest.proxy.password === undefined) {
    // Keep existing proxy password when the UI sends it blank (write-only field).
    const existing = await getDecryptedProfile(a.orgId, req.params.id!);
    rest.proxy.password = existing.proxy?.password;
  }
  await updateProfile(a.orgId, req.params.id!, version, rest);
  await audit(auditFromReq(req, { action: "profile.update", targetType: "profile", targetId: req.params.id }));
  res.status(204).end();
}));

profilesRouter.delete("/:id", requirePermission("profile:delete"), ah(async (req, res) => {
  const a = auth(req);
  const r = await withOrg(a.orgId, (tx) => tx.query(
    // Crypto-shred: wipe ciphertext columns, then soft-delete the shell row for audit integrity.
    `UPDATE profiles SET deleted_at=now(), first_name_enc=NULL, last_name_enc=NULL, email_enc=NULL, phone_enc=NULL, email_blind_idx=NULL
     WHERE id=$1 AND deleted_at IS NULL`, [req.params.id]));
  if (!r.rowCount) throw notFound("profile");
  await withOrg(a.orgId, async (tx) => {
    for (const t of ["profile_addresses", "profile_proxies", "profile_custom_fields", "site_accounts", "browser_profiles"])
      await tx.query(`DELETE FROM ${t} WHERE profile_id=$1`, [req.params.id]);
  });
  await audit(auditFromReq(req, { action: "profile.delete", targetType: "profile", targetId: req.params.id }));
  res.status(204).end();
}));

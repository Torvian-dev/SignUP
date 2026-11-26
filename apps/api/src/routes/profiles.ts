import { Router } from "express";
import { z } from "zod";
import { withOrg } from "../lib/db.js";
import { notFound } from "../lib/errors.js";
import { audit, auditFromReq } from "../middleware/audit.js";
import { auth } from "../middleware/auth.js";
import { ah, parse } from "../middleware/http.js";
import { requirePermission } from "../middleware/rbac.js";
import { createProfile, getDecryptedProfile, listProfiles, ProfileInput, updateProfile } from "../services/profiles/profileService.js";
import { CSV_TEMPLATE_HEADERS, importProfiles } from "../services/profiles/importProfiles.js";
import { runIdentityCheck } from "../services/identity/identityCheck.js";
import { bulkSetProxies, bulkDelete, bulkSetLocation, bulkSetCustomField } from "../services/profiles/bulkProfiles.js";
import { parseCsv } from "../lib/csv.js";

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

profilesRouter.get("/import/template", requirePermission("profile:read"), (_req, res) => {
  const example = ["Sample Person","Sample","Person","sample@example.com","07700900000","1 High Street","","Leeds","West Yorkshire","LS1 1AA","GB","http","gb.proxy.example","8080","user","pass","1990-03-07","Sample Ltd"];
  res.set("content-type", "text/csv").set("content-disposition", "attachment; filename=profiles-template.csv")
     .send(CSV_TEMPLATE_HEADERS.map((h) => /[",\n]/.test(h) ? `"${h}"` : h).join(",") + "\n" + example.map((v) => /[",\n]/.test(v) ? `"${v}"` : v).join(",") + "\n");
});

/** Bulk import profiles from CSV text. Body: { csv: string }. Each row is validated independently. */
profilesRouter.post("/import", requirePermission("profile:write"), ah(async (req, res) => {
  const a = auth(req);
  const { csv } = parse(z.object({ csv: z.string().min(1).max(2_000_000) }), req.body);
  const rows = parseCsv(csv);
  if (rows.length === 0) throw (await import("../lib/errors.js")).badRequest("no data rows found in the CSV");
  if (rows.length > 1000) throw (await import("../lib/errors.js")).badRequest("import is limited to 1000 profiles at a time");
  const result = await importProfiles(a.orgId, a.userId, rows);
  await audit(auditFromReq(req, { action: "profile.create", targetType: "profile_import",
    metadata: { created: result.created, failed: result.failed.length } }));
  res.status(result.created ? 201 : 400).json(result);
}));

// ---- Bulk actions over selected profiles (registered before "/:id") ----
const ProfileIds = z.array(z.string().uuid()).min(1).max(1000);

profilesRouter.post("/bulk/proxy", requirePermission("profile:write"), ah(async (req, res) => {
  const a = auth(req);
  const { items } = parse(z.object({ items: z.array(z.object({ profileId: z.string().uuid(), proxy: z.string().min(3) })).min(1).max(1000) }), req.body);
  const result = await bulkSetProxies(a.orgId, items);
  await audit(auditFromReq(req, { action: "profile.update", targetType: "profile_bulk", metadata: { op: "proxy", updated: result.updated, failed: result.failed.length } }));
  res.json(result);
}));

profilesRouter.post("/bulk/location", requirePermission("profile:write"), ah(async (req, res) => {
  const a = auth(req);
  const body = parse(z.object({
    profileIds: ProfileIds,
    countryCode: z.string().length(2).optional(),
    timezone: z.string().min(1).max(64).optional(),
    locale: z.string().min(2).max(10).optional(),
  }).refine((b) => b.countryCode || b.timezone || b.locale, "set at least one of country, timezone or locale"), req.body);
  const result = await bulkSetLocation(a.orgId, body.profileIds, body);
  await audit(auditFromReq(req, { action: "profile.update", targetType: "profile_bulk", metadata: { op: "location", count: body.profileIds.length } }));
  res.json(result);
}));

profilesRouter.post("/bulk/custom-field", requirePermission("profile:write"), ah(async (req, res) => {
  const a = auth(req);
  const body = parse(z.object({ profileIds: ProfileIds, label: z.string().min(1).max(80), value: z.string().max(2000) }), req.body);
  const result = await bulkSetCustomField(a.orgId, body.profileIds, { label: body.label, value: body.value });
  await audit(auditFromReq(req, { action: "profile.update", targetType: "profile_bulk", metadata: { op: "custom_field", count: body.profileIds.length } }));
  res.json(result);
}));

profilesRouter.post("/bulk/delete", requirePermission("profile:delete"), ah(async (req, res) => {
  const a = auth(req);
  const { profileIds } = parse(z.object({ profileIds: ProfileIds }), req.body);
  const result = await bulkDelete(a.orgId, profileIds);
  await audit(auditFromReq(req, { action: "profile.delete", targetType: "profile_bulk", metadata: { deleted: result.updated } }));
  res.json(result);
}));

/** Identity self-test: launch a real session and report what a detection script would see. */
profilesRouter.post("/:id/identity-check", requirePermission("profile:read"), ah(async (req, res) => {
  const a = auth(req);
  const report = await runIdentityCheck(a.orgId, req.params.id!);
  await audit(auditFromReq(req, { action: "profile.update", targetType: "profile", targetId: req.params.id, metadata: { identityCheck: true } }));
  res.json(report);
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

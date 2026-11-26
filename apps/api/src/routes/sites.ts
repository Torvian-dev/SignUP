import { Router } from "express";
import { z } from "zod";
import { audit, auditFromReq } from "../middleware/audit.js";
import { auth } from "../middleware/auth.js";
import { ah, parse } from "../middleware/http.js";
import { requirePermission } from "../middleware/rbac.js";
import { editField, forgetField, forgetSite, getSite, listSites } from "../services/sites/sitesService.js";

export const sitesRouter = Router();

/** Websites the agent has learned (teach-once field-maps). */
sitesRouter.get("/", requirePermission("site:read"), ah(async (req, res) => {
  res.json({ data: await listSites(auth(req).orgId) });
}));

sitesRouter.get("/:domain", requirePermission("site:read"), ah(async (req, res) => {
  res.json(await getSite(auth(req).orgId, req.params.domain!));
}));

/** Forget everything learned for a website. */
sitesRouter.delete("/:domain", requirePermission("site:write"), ah(async (req, res) => {
  await forgetSite(auth(req).orgId, req.params.domain!);
  await audit(auditFromReq(req, { action: "policy.update", targetType: "site", targetId: req.params.domain, metadata: { action: "forget_site" } }));
  res.status(204).end();
}));

/** Edit one remembered field's mapping. */
sitesRouter.patch("/field/:id", requirePermission("site:write"), ah(async (req, res) => {
  const body = parse(z.object({ profilePath: z.string().min(1).max(200), transform: z.string().max(100).nullable().default(null) }), req.body);
  await editField(auth(req).orgId, req.params.id!, body.profilePath, body.transform);
  res.status(204).end();
}));

/** Forget one remembered field. */
sitesRouter.delete("/field/:id", requirePermission("site:write"), ah(async (req, res) => {
  await forgetField(auth(req).orgId, req.params.id!);
  res.status(204).end();
}));

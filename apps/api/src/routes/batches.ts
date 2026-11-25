import { Router } from "express";
import { z } from "zod";
import { audit, auditFromReq } from "../middleware/audit.js";
import { auth } from "../middleware/auth.js";
import { ah, parse } from "../middleware/http.js";
import { requirePermission } from "../middleware/rbac.js";
import { cancelBatch, createBatch, getBatch, listBatches, resumeBatch } from "../services/batch/batchService.js";

export const batchesRouter = Router();

const CreateBatch = z.object({
  url: z.string().url().max(2048),
  profileIds: z.array(z.string().uuid()).min(1).max(1000),
  quantity: z.number().int().min(1).max(1000).optional(),
  intent: z.enum(["signup", "application", "onboarding"]).default("signup"),
  onFailure: z.enum(["skip", "pause"]).default("skip"),
});

batchesRouter.post("/", requirePermission("run:create"), ah(async (req, res) => {
  const a = auth(req);
  const input = parse(CreateBatch, req.body);
  const id = await createBatch(a.orgId, a.userId, input);
  await audit(auditFromReq(req, { action: "run.create", targetType: "batch", targetId: id,
    metadata: { roster: input.profileIds.length, quantity: input.quantity ?? input.profileIds.length, onFailure: input.onFailure } }));
  res.status(202).json({ id });
}));

batchesRouter.get("/", requirePermission("run:read"), ah(async (req, res) => {
  res.json({ data: await listBatches(auth(req).orgId) });
}));

batchesRouter.get("/:id", requirePermission("run:read"), ah(async (req, res) => {
  res.json(await getBatch(auth(req).orgId, req.params.id!));
}));

batchesRouter.post("/:id/cancel", requirePermission("run:cancel"), ah(async (req, res) => {
  await cancelBatch(auth(req).orgId, req.params.id!);
  await audit(auditFromReq(req, { action: "run.cancel", targetType: "batch", targetId: req.params.id }));
  res.status(202).json({ ok: true });
}));

batchesRouter.post("/:id/resume", requirePermission("run:create"), ah(async (req, res) => {
  await resumeBatch(auth(req).orgId, req.params.id!);
  res.status(202).json({ ok: true });
}));

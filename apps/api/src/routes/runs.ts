import { Router } from "express";
import { z } from "zod";
import { withOrg } from "../lib/db.js";
import { HttpError, notFound } from "../lib/errors.js";
import { channels, redis, redisSub } from "../lib/redis.js";
import { getDecrypted } from "../lib/blob.js";
import { env } from "../config/env.js";
import { audit, auditFromReq } from "../middleware/audit.js";
import { auth } from "../middleware/auth.js";
import { ah, parse } from "../middleware/http.js";
import { requirePermission } from "../middleware/rbac.js";
import { enqueueRun } from "../queue/queues.js";
import { assertPublicUrl, checkRunAllowed } from "../services/policy/policyGuard.js";
import { screenChannel } from "../automation/liveView.js";

export const runsRouter = Router();
const control = (runId: string) => `run:${runId}:control`;

const CreateRun = z.object({
  url: z.string().url().max(2048),
  profileId: z.string().uuid(),
  intent: z.enum(["auto", "signup", "login", "application", "contact", "onboarding"]).default("auto"),
});

runsRouter.post("/", requirePermission("run:create"), ah(async (req, res) => {
  const a = auth(req);
  const body = parse(CreateRun, req.body);
  const url = await assertPublicUrl(body.url);
  const { domain, intent } = await checkRunAllowed(a.orgId, body.profileId, url, body.intent);
  const run = await withOrg(a.orgId, async (tx) => (await tx.query(
    `INSERT INTO automation_runs (org_id, profile_id, created_by, url, domain, intent) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status, created_at`,
    [a.orgId, body.profileId, a.userId, url.toString(), domain, intent])).rows[0]);
  await enqueueRun({ orgId: a.orgId, runId: run.id });
  await audit(auditFromReq(req, { action: "run.create", targetType: "run", targetId: run.id, metadata: { domain, intent } }));
  res.status(202).json(run);
}));

runsRouter.get("/", requirePermission("run:read"), ah(async (req, res) => {
  const a = auth(req);
  const q = parse(z.object({ status: z.string().optional(), domain: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().max(100).default(25) }), req.query);
  const rows = await withOrg(a.orgId, async (tx) => (await tx.query(
    `SELECT r.id, r.url, r.domain, r.intent, r.status, r.completion_confidence, r.fields_filled, r.fields_total, r.fields_corrected,
            r.ai_provider_used, r.ai_cost_usd + r.captcha_cost_usd AS cost_usd, r.duration_ms, r.created_at, p.label AS profile_label
     FROM automation_runs r JOIN profiles p ON p.id=r.profile_id
     WHERE ($1::text IS NULL OR r.status::text = $1) AND ($2::text IS NULL OR r.domain = $2) AND ($3::timestamptz IS NULL OR r.created_at < $3)
     ORDER BY r.created_at DESC LIMIT $4`, [q.status ?? null, q.domain ?? null, q.cursor ?? null, q.limit])).rows);
  res.json({ data: rows, nextCursor: rows.length === q.limit ? rows.at(-1)!.created_at : null });
}));

runsRouter.get("/:id", requirePermission("run:read"), ah(async (req, res) => {
  const a = auth(req);
  const run = await withOrg(a.orgId, async (tx) => (await tx.query("SELECT * FROM automation_runs WHERE id=$1", [req.params.id])).rows[0]);
  if (!run) throw notFound("run");
  res.json(run);
}));

/** Review payload for the current step: each field with AI mapping, confidence, reasoning, fill result. */
runsRouter.get("/:id/review", requirePermission("run:review"), ah(async (req, res) => {
  const a = auth(req);
  const data = await withOrg(a.orgId, async (tx) => {
    const run = (await tx.query("SELECT id, status, url, domain, checkpoint, completion_confidence FROM automation_runs WHERE id=$1", [req.params.id])).rows[0];
    if (!run) throw notFound("run");
    const stepId = run.checkpoint?.review?.stepId;
    if (!stepId) return { run, fields: [] };
    const fields = (await tx.query(
      `SELECT f.id, f.kind, f.label, f.name_attr, f.placeholder, f.required, f.options,
              d.id AS decision_id, d.profile_path, d.transform, d.confidence, d.reasoning, d.source, d.provider
       FROM detected_fields f LEFT JOIN ai_decisions d ON d.field_id=f.id
       WHERE f.step_id=$1 AND f.visible ORDER BY f.id`, [stepId])).rows;
    const results = new Map<string, any>((run.checkpoint.review.results ?? []).map((r: any) => [r.fieldId, r]));
    return { run: { ...run, checkpoint: undefined, submitButton: run.checkpoint.review.submit?.text },
             fields: fields.map((f) => ({ ...f, fill: results.get(f.id) ?? null })) };
  });
  res.json(data);
}));

runsRouter.get("/:id/screenshot", requirePermission("run:review"), ah(async (req, res) => {
  const a = auth(req);
  const key = await withOrg(a.orgId, async (tx) => (await tx.query(
    "SELECT screenshot_path FROM run_steps WHERE run_id=$1 AND screenshot_path IS NOT NULL ORDER BY step_index DESC LIMIT 1", [req.params.id])).rows[0]?.screenshot_path);
  const png = key ? await getDecrypted(a.orgId, env.BLOB_CONTAINER_ARTIFACTS, key) : null;
  if (!png) throw notFound("screenshot");
  res.type("png").set("cache-control", "private, no-store").send(png);
}));

const Approve = z.object({
  overrides: z.array(z.object({
    fieldId: z.string().uuid(),
    profilePath: z.string().max(200).nullable().optional(),
    transform: z.string().max(100).nullable().optional(),
    value: z.string().max(5000).optional(),
  })).max(500).default([]),
});

runsRouter.post("/:id/approve", requirePermission("run:approve"), ah(async (req, res) => {
  const a = auth(req);
  const body = parse(Approve, req.body);
  const run = await withOrg(a.orgId, async (tx) => (await tx.query("SELECT status FROM automation_runs WHERE id=$1", [req.params.id])).rows[0]);
  if (!run) throw notFound("run");
  if (run.status !== "awaiting_review") throw new HttpError(409, "invalid_state", `run is ${run.status}`);
  await redis.rpush(control(req.params.id!), JSON.stringify({ type: "approve", userId: a.userId, overrides: body.overrides }));
  await audit(auditFromReq(req, { action: "run.approve", targetType: "run", targetId: req.params.id, metadata: { overrides: body.overrides.length } }));
  res.status(202).json({ ok: true });
}));

runsRouter.post("/:id/resume", requirePermission("run:create"), ah(async (req, res) => {
  const a = auth(req);
  const run = await withOrg(a.orgId, async (tx) => (await tx.query("SELECT status FROM automation_runs WHERE id=$1", [req.params.id])).rows[0]);
  if (!run) throw notFound("run");
  if (!["paused", "failed"].includes(run.status)) throw new HttpError(409, "invalid_state", `run is ${run.status}`);
  await withOrg(a.orgId, (tx) => tx.query("UPDATE automation_runs SET status='queued', error_code=NULL, error_message=NULL WHERE id=$1", [req.params.id]));
  const { runQueue } = await import("../queue/queues.js");
  await (await runQueue.getJob(req.params.id!))?.remove().catch(() => undefined);
  await enqueueRun({ orgId: a.orgId, runId: req.params.id! }, { priority: 1 });
  res.status(202).json({ ok: true });
}));

runsRouter.post("/:id/cancel", requirePermission("run:cancel"), ah(async (req, res) => {
  await redis.rpush(control(req.params.id!), JSON.stringify({ type: "cancel" }));
  await audit(auditFromReq(req, { action: "run.cancel", targetType: "run", targetId: req.params.id }));
  res.status(202).json({ ok: true });
}));

/** Manual takeover input (CAPTCHA/unknown page) and "I'm done" signal. */
runsRouter.post("/:id/manual", requirePermission("run:review"), ah(async (req, res) => {
  const body = parse(z.discriminatedUnion("type", [
    z.object({ type: z.literal("manual_done") }),
    z.object({ type: z.literal("input"), event: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("click"), x: z.number(), y: z.number() }),
      z.object({ kind: z.literal("type"), text: z.string().max(500) }),
      z.object({ kind: z.literal("key"), key: z.enum(["Enter", "Tab", "Backspace", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) }),
      z.object({ kind: z.literal("scroll"), dy: z.number().min(-3000).max(3000) }),
    ]) }),
  ]), req.body);
  await redis.rpush(control(req.params.id!), JSON.stringify(body));
  res.status(202).json({ ok: true });
}));

/** Server-Sent Events: live activity + (optional) screencast frames. */
runsRouter.get("/:id/events", requirePermission("run:read"), ah(async (req, res) => {
  const a = auth(req);
  const runId = req.params.id!;
  const exists = await withOrg(a.orgId, async (tx) => (await tx.query("SELECT 1 FROM automation_runs WHERE id=$1", [runId])).rowCount);
  if (!exists) throw notFound("run");
  res.set({ "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
  res.flushHeaders();

  const backlog = await withOrg(a.orgId, async (tx) => (await tx.query(
    "SELECT id, type, level, message, data, created_at AS at FROM run_events WHERE run_id=$1 ORDER BY id DESC LIMIT 100", [runId])).rows.reverse());
  for (const e of backlog) res.write(`event: run\ndata: ${JSON.stringify(e)}\n\n`);

  const sub = redisSub.duplicate();
  const chans = [channels.runEvents(runId), ...(req.query.screen === "1" ? [screenChannel(runId)] : [])];
  await sub.subscribe(...chans);
  sub.on("message", (ch, msg) => {
    res.write(ch === screenChannel(runId) ? `event: frame\ndata: ${msg}\n\n` : `event: run\ndata: ${msg}\n\n`);
  });
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => { clearInterval(ping); sub.disconnect(); });
}));

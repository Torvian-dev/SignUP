import { Router } from "express";
import { z } from "zod";
import { withOrg } from "../lib/db.js";
import { audit, auditFromReq } from "../middleware/audit.js";
import { auth } from "../middleware/auth.js";
import { ah, parse } from "../middleware/http.js";
import { requirePermission } from "../middleware/rbac.js";

export const analyticsRouter = Router();

/** Single round-trip for the dashboard home page. */
analyticsRouter.get("/dashboard", requirePermission("dashboard:read"), ah(async (req, res) => {
  const { orgId } = auth(req);
  const data = await withOrg(orgId, async (tx) => {
    const q = async (sql: string, p: unknown[] = []) => (await tx.query(sql, p)).rows;
    const [kpis] = await q("SELECT * FROM v_dashboard_kpis WHERE org_id=$1", [orgId]);
    const runsByDay = await q(`SELECT date_trunc('day', created_at)::date AS day,
        count(*) FILTER (WHERE status='succeeded') AS succeeded, count(*) FILTER (WHERE status='failed') AS failed
      FROM automation_runs WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`);
    const captcha = await q("SELECT provider, kind, attempts, solved, failed, success_rate_pct, avg_solve_ms, cost_per_solve_usd, total_cost_usd FROM captcha_provider_stats WHERE org_id=$1 ORDER BY attempts DESC", [orgId]);
    const confidenceHist = await q(`SELECT width_bucket(confidence, 0, 1, 10) AS bucket, count(*) AS n
      FROM ai_decisions WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`);
    const learning = await q("SELECT week, decisions, acceptance_pct, memory_hit_pct FROM v_learning_trend WHERE org_id=$1 ORDER BY week DESC LIMIT 12", [orgId]);
    const providerUsage = await q(`SELECT provider, category, count(*) AS calls, count(*) FILTER (WHERE success) AS ok,
        count(*) FILTER (WHERE failover_from IS NOT NULL) AS failovers, round(avg(latency_ms)) AS avg_ms, sum(cost_usd) AS cost_usd
      FROM provider_usage WHERE created_at > now() - interval '30 days' GROUP BY 1,2 ORDER BY calls DESC`);
    const apiStatus = await q("SELECT provider, category, label, status, last_tested_at FROM provider_credentials WHERE is_active ORDER BY category, priority");
    const [{ profiles }] = await q("SELECT count(*)::int AS profiles FROM profiles WHERE deleted_at IS NULL");
    const recent = await q(`SELECT e.run_id, e.type, e.level, e.message, e.created_at, r.domain FROM run_events e
      JOIN automation_runs r ON r.id=e.run_id ORDER BY e.id DESC LIMIT 20`);
    const timeSaved = await q(`SELECT coalesce(sum(fields_filled),0)::int AS fields_filled,
        -- benchmark: ~9s per field typed manually (look-up + typing + checking)
        round(coalesce(sum(fields_filled),0) * 9 / 60.0) AS manual_minutes_estimate,
        round(coalesce(sum(duration_ms),0) / 60000.0) AS agent_minutes
      FROM automation_runs WHERE status='succeeded' AND created_at > now() - interval '30 days'`);
    return { kpis: kpis ?? {}, runsByDay, captcha, confidenceHist, learning, providerUsage, apiStatus, profiles, recent, timeSaved: timeSaved[0] };
  });
  res.json(data);
}));

analyticsRouter.get("/audit", requirePermission("audit:read"), ah(async (req, res) => {
  const { orgId } = auth(req);
  const q = parse(z.object({ action: z.string().optional(), before: z.coerce.number().optional(), limit: z.coerce.number().max(200).default(50) }), req.query);
  const rows = await withOrg(orgId, async (tx) => (await tx.query(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.actor_ip, a.created_at, u.email AS actor_email, encode(a.row_hash,'hex') AS hash
     FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
     WHERE a.org_id=$1 AND ($2::text IS NULL OR a.action::text=$2) AND ($3::bigint IS NULL OR a.id < $3)
     ORDER BY a.id DESC LIMIT $4`, [orgId, q.action ?? null, q.before ?? null, q.limit])).rows);
  res.json({ data: rows });
}));

const PolicyInput = z.object({
  requireReviewEveryStep: z.boolean().optional(),
  captchaSolvingEnabled: z.boolean().optional(),
  captchaMaxSpendDailyUsd: z.number().min(0).max(500).optional(),
  maxRunsPerDomainPerDay: z.number().int().min(1).max(200).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(50).optional(),
  aiProviderOrder: z.array(z.enum(["claude", "openai", "gemini"])).optional(),
  captchaProviderOrder: z.array(z.string()).optional(),
  autoAcceptConfidence: z.number().min(0.7).max(0.99).optional(),
  allowAutoSubmit: z.boolean().optional(),
});

analyticsRouter.get("/policy", requirePermission("dashboard:read"), ah(async (req, res) => {
  const { orgId } = auth(req);
  res.json(await withOrg(orgId, async (tx) => (await tx.query("SELECT * FROM org_policies WHERE org_id=$1", [orgId])).rows[0]));
}));

analyticsRouter.put("/policy", requirePermission("policy:write"), ah(async (req, res) => {
  const { orgId } = auth(req);
  const p = parse(PolicyInput, req.body);
  const cols: Record<string, unknown> = {
    require_review_every_step: p.requireReviewEveryStep, captcha_solving_enabled: p.captchaSolvingEnabled,
    captcha_max_spend_daily_usd: p.captchaMaxSpendDailyUsd, max_runs_per_domain_per_day: p.maxRunsPerDomainPerDay,
    max_concurrent_runs: p.maxConcurrentRuns, ai_provider_order: p.aiProviderOrder, captcha_provider_order: p.captchaProviderOrder,
    auto_accept_confidence: p.autoAcceptConfidence, allow_auto_submit: p.allowAutoSubmit,
  };
  const entries = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (entries.length) {
    await withOrg(orgId, (tx) => tx.query(
      `UPDATE org_policies SET ${entries.map(([k], i) => `${k}=$${i + 2}`).join(", ")} WHERE org_id=$1`, [orgId, ...entries.map(([, v]) => v)]));
  }
  await audit(auditFromReq(req, { action: "policy.update", targetType: "org_policies", targetId: orgId, metadata: { changed: entries.map(([k]) => k) } }));
  res.status(204).end();
}));

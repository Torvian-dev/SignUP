import { withOrg } from "../lib/db.js";
import { channels, redis } from "../lib/redis.js";

export type RunStatus =
  | "queued" | "launching" | "analysing" | "mapping" | "filling" | "solving_captcha" | "awaiting_manual"
  | "awaiting_review" | "submitting" | "succeeded" | "failed" | "cancelled" | "paused";

/** Persist + fan out a run event (SSE subscribers listen on the Redis channel). */
export async function emit(orgId: string, runId: string, type: string, message: string, data?: Record<string, unknown>, level = "info") {
  const row = await withOrg(orgId, async (tx) => (await tx.query(
    `INSERT INTO run_events (run_id, org_id, level, type, message, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
    [runId, orgId, level, type, message, data ?? null])).rows[0]);
  await redis.publish(channels.runEvents(runId), JSON.stringify({ id: row.id, type, level, message, data, at: row.created_at }));
}

export async function setStatus(orgId: string, runId: string, status: RunStatus, extra: Record<string, unknown> = {}) {
  const sets = ["status=$2"];
  const vals: unknown[] = [runId, status];
  for (const [k, v] of Object.entries(extra)) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
  if (status === "launching") sets.push("started_at = coalesce(started_at, now())");
  if (["succeeded", "failed", "cancelled"].includes(status)) sets.push("finished_at = now()");
  if (status === "awaiting_review") sets.push("review_ready_at = now()");
  await withOrg(orgId, (tx) => tx.query(`UPDATE automation_runs SET ${sets.join(", ")} WHERE id=$1`, vals));
  await emit(orgId, runId, "status", status);
}

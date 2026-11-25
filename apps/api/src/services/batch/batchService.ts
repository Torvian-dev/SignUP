/**
 * Batch sign-ups: one URL × a roster of profiles, processed one at a time.
 *
 *   createBatch → startNext (profile[0]) ─┐
 *                                         ├─ run finishes → onRunFinished → startNext (profile[1]) …
 *   until cursor == quantity, the roster is exhausted, a failure with on_failure='pause', or cancel.
 *
 * Sequential by design: exactly one in-flight run per batch (batches.current_run_id), so each account
 * is fully created (including email verification) before the next profile's email and proxy are used.
 * A Postgres advisory lock serialises advancement, so duplicate BullMQ completion events are idempotent.
 */
import { withOrg, db } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { badRequest, notFound, policyViolation } from "../../lib/errors.js";
import { enqueueRun } from "../../queue/queues.js";
import { assertPublicUrl, checkRunAllowed, registrableDomain } from "../policy/policyGuard.js";

export interface CreateBatchInput {
  url: string;
  profileIds: string[];
  quantity?: number;
  intent?: string;
  onFailure?: "skip" | "pause";
}

export async function createBatch(orgId: string, userId: string, input: CreateBatchInput): Promise<string> {
  const url = await assertPublicUrl(input.url);
  const domain = registrableDomain(url);
  // De-duplicate while preserving order; one account per profile per site is enforced per-run anyway.
  const profileIds = [...new Set(input.profileIds)];
  if (profileIds.length === 0) throw badRequest("select at least one profile");

  const policy = await withOrg(orgId, async (tx) => (await tx.query("SELECT allow_auto_submit FROM org_policies WHERE org_id=$1", [orgId])).rows[0]);
  if (!policy?.allow_auto_submit)
    throw policyViolation("automatic submission is turned off — enable it under Policy & guardrails before running a batch");

  // All profiles must belong to this org (RLS also enforces this).
  const valid = await withOrg(orgId, async (tx) => (await tx.query(
    "SELECT id FROM profiles WHERE id = ANY($1) AND deleted_at IS NULL", [profileIds])).rows.map((r) => r.id as string));
  const roster = profileIds.filter((id) => valid.includes(id));
  if (roster.length === 0) throw badRequest("none of the selected profiles exist");

  const quantity = Math.min(input.quantity ?? roster.length, roster.length);

  const batchId = await withOrg(orgId, async (tx) => (await tx.query<{ id: string }>(
    `INSERT INTO batches (org_id, created_by, url, domain, intent, profile_ids, quantity, on_failure, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued') RETURNING id`,
    [orgId, userId, url.toString(), domain, input.intent ?? "signup", roster, quantity, input.onFailure ?? "skip"])).rows[0]!.id);

  await startNext(orgId, batchId);
  return batchId;
}

/** Create and enqueue the run for the batch's next profile, or complete the batch. Lock-protected. */
async function startNext(orgId: string, batchId: string): Promise<void> {
  await withOrg(orgId, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`batch:${batchId}`]);
    const b = (await tx.query("SELECT * FROM batches WHERE id=$1", [batchId])).rows[0];
    if (!b || b.status === "cancelled" || b.status === "completed" || b.current_run_id) return;

    if (b.cursor >= b.quantity || b.cursor >= b.profile_ids.length) {
      await tx.query("UPDATE batches SET status='completed' WHERE id=$1", [batchId]);
      return;
    }
    const profileId: string = b.profile_ids[b.cursor];
    const seq: number = b.cursor;

    // Pre-check guardrails (blocked domain, one-account-per-site, caps). A failure here skips this
    // profile without ever launching a browser.
    let skipReason: string | null = null;
    try {
      await checkRunAllowed(orgId, profileId, new URL(b.url), b.intent);
    } catch (err) {
      skipReason = (err as Error).message;
    }

    if (skipReason) {
      await tx.query("UPDATE batches SET cursor = cursor + 1, processed = processed + 1, failed = failed + 1 WHERE id=$1", [batchId]);
      const run = (await tx.query(
        `INSERT INTO automation_runs (org_id, profile_id, created_by, url, domain, intent, status, auto_submit, batch_id, batch_seq, error_code, error_message, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,'failed',true,$7,$8,'skipped',$9, now()) RETURNING id`,
        [orgId, profileId, b.created_by, b.url, b.domain, b.intent, batchId, seq, skipReason.slice(0, 500)])).rows[0];
      logger.info({ batchId, profileId, reason: skipReason }, "batch profile skipped pre-flight");
      // Re-enter to continue with the next profile (new transaction via setImmediate avoids lock re-entrancy).
      setImmediate(() => startNext(orgId, batchId).catch((e) => logger.error({ e, batchId }, "startNext failed")));
      void run;
      return;
    }

    const run = (await tx.query<{ id: string }>(
      `INSERT INTO automation_runs (org_id, profile_id, created_by, url, domain, intent, auto_submit, batch_id, batch_seq)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8) RETURNING id`,
      [orgId, profileId, b.created_by, b.url, b.domain, b.intent, batchId, seq])).rows[0]!;
    await tx.query("UPDATE batches SET status='running', cursor = cursor + 1, current_run_id=$2 WHERE id=$1", [batchId, run.id]);
    await enqueueRun({ orgId, runId: run.id });
  });
}

/**
 * Called when any run reaches a terminal state. If the run belongs to a batch and is the batch's
 * current in-flight run, tally it and either pause (on_failure='pause' + failed) or start the next.
 */
export async function onRunFinished(orgId: string, runId: string): Promise<void> {
  const run = await withOrg(orgId, async (tx) => (await tx.query(
    "SELECT id, batch_id, status FROM automation_runs WHERE id=$1", [runId])).rows[0]);
  if (!run?.batch_id || !["succeeded", "failed", "cancelled"].includes(run.status)) return;

  const advance = await withOrg(orgId, async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`batch:${run.batch_id}`]);
    const b = (await tx.query("SELECT * FROM batches WHERE id=$1", [run.batch_id])).rows[0];
    if (!b || b.current_run_id !== runId) return false; // already handled (duplicate event)

    const ok = run.status === "succeeded";
    await tx.query(
      `UPDATE batches SET current_run_id=NULL, processed = processed + 1,
              succeeded = succeeded + $2, failed = failed + $3 WHERE id=$1`,
      [run.batch_id, ok ? 1 : 0, ok ? 0 : 1]);

    if (b.status === "cancelled") return false;
    if (!ok && b.on_failure === "pause") {
      await tx.query("UPDATE batches SET status='paused' WHERE id=$1", [run.batch_id]);
      return false;
    }
    return true;
  });

  if (advance) await startNext(orgId, run.batch_id);
}

export async function cancelBatch(orgId: string, batchId: string): Promise<void> {
  const currentRunId = await withOrg(orgId, async (tx) => {
    const b = (await tx.query("SELECT current_run_id, status FROM batches WHERE id=$1 FOR UPDATE", [batchId])).rows[0];
    if (!b) throw notFound("batch");
    await tx.query("UPDATE batches SET status='cancelled' WHERE id=$1", [batchId]);
    return b.current_run_id as string | null;
  });
  if (currentRunId) {
    const { redis } = await import("../../lib/redis.js");
    await redis.rpush(`run:${currentRunId}:control`, JSON.stringify({ type: "cancel" }));
  }
}

export async function resumeBatch(orgId: string, batchId: string): Promise<void> {
  await withOrg(orgId, (tx) => tx.query("UPDATE batches SET status='queued' WHERE id=$1 AND status='paused'", [batchId]));
  await startNext(orgId, batchId);
}

export async function getBatch(orgId: string, batchId: string) {
  return withOrg(orgId, async (tx) => {
    const b = (await tx.query("SELECT * FROM batches WHERE id=$1", [batchId])).rows[0];
    if (!b) throw notFound("batch");
    const runs = (await tx.query(
      `SELECT r.id, r.batch_seq, r.status, r.completion_confidence, r.fields_filled, r.fields_corrected,
              r.error_message, r.created_at, r.finished_at, p.label AS profile_label
       FROM automation_runs r JOIN profiles p ON p.id=r.profile_id
       WHERE r.batch_id=$1 ORDER BY r.batch_seq`, [batchId])).rows;
    return { ...b, runs };
  });
}

export async function listBatches(orgId: string) {
  return withOrg(orgId, async (tx) => (await tx.query(
    `SELECT id, url, domain, status, quantity, processed, succeeded, failed,
            array_length(profile_ids, 1) AS roster_size, created_at
     FROM batches ORDER BY created_at DESC LIMIT 50`)).rows);
}
void db;

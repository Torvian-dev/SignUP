import { Queue, QueueEvents } from "bullmq";
import { redis } from "../lib/redis.js";

export interface RunJob { orgId: string; runId: string }

/** One queue for runs; the job id = run id, so a run can never be double-scheduled. */
export const runQueue = new Queue<RunJob>("automation-runs", {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,                       // one infra retry (pod eviction, browser crash); resumes from checkpoint
    backoff: { type: "exponential", delay: 15_000 },
    removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
});

/** Maintenance: refresh materialised views, purge rotated secrets, proxy health checks. */
export const maintenanceQueue = new Queue("maintenance", { connection: redis });

export const runQueueEvents = new QueueEvents("automation-runs", { connection: redis });

export async function enqueueRun(job: RunJob, opts: { priority?: number } = {}) {
  await runQueue.add("run", job, { jobId: job.runId, priority: opts.priority ?? 5 });
}

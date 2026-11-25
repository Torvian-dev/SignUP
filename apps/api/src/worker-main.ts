/**
 * Automation worker process (separate Deployment from the API; Playwright image).
 * Each job holds one Chromium context. Concurrency per pod is deliberately low (2–4) because a run
 * may hold its browser open while it waits for a reviewer.
 */
import { Worker } from "bullmq";
import { env } from "./config/env.js";
import { db } from "./lib/db.js";
import { logger } from "./lib/logger.js";
import { redis } from "./lib/redis.js";
import { executeRun } from "./automation/runOrchestrator.js";
import { maintenanceQueue, type RunJob } from "./queue/queues.js";

const runWorker = new Worker<RunJob>(
  "automation-runs",
  async (job) => {
    logger.info({ runId: job.data.runId, attempt: job.attemptsMade + 1 }, "run started");
    await executeRun(job.data.orgId, job.data.runId);
  },
  { connection: redis, concurrency: env.WORKER_CONCURRENCY, lockDuration: 120_000, stalledInterval: 60_000 },
);

const maintenanceWorker = new Worker(
  "maintenance",
  async (job) => {
    switch (job.name) {
      case "refresh-captcha-stats":
        await db.query("REFRESH MATERIALIZED VIEW CONCURRENTLY captcha_provider_stats");
        break;
      case "purge-rotated-secrets":
        await db.query("UPDATE provider_credentials SET previous_secret_enc=NULL, previous_expires_at=NULL WHERE previous_expires_at < now()");
        break;
    }
  },
  { connection: redis, concurrency: 1 },
);

await maintenanceQueue.upsertJobScheduler("refresh-captcha-stats", { every: 15 * 60_000 }, { name: "refresh-captcha-stats" });
await maintenanceQueue.upsertJobScheduler("purge-rotated-secrets", { every: 60 * 60_000 }, { name: "purge-rotated-secrets" });

runWorker.on("failed", (job, err) => logger.error({ runId: job?.data.runId, err: err.message }, "run job failed"));

const shutdown = async () => {
  logger.info("worker draining");
  await Promise.all([runWorker.close(), maintenanceWorker.close()]); // waits for in-flight jobs
  await db.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
logger.info({ concurrency: env.WORKER_CONCURRENCY }, "worker ready");

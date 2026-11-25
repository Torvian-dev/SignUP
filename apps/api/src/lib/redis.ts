import { Redis } from "ioredis";
import { env } from "../config/env.js";

/** BullMQ requires maxRetriesPerRequest: null on its connections. */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
export const redisSub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const channels = {
  runEvents: (runId: string) => `run:${runId}:events`,
};

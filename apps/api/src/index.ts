import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { RedisStore } from "rate-limit-redis";
import { env } from "./config/env.js";
import { db } from "./lib/db.js";
import { logger } from "./lib/logger.js";
import { redis } from "./lib/redis.js";
import { ensureBootstrapAdmin } from "./services/auth/adminSetup.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/http.js";
import { analyticsRouter } from "./routes/analytics.js";
import { authRouter } from "./routes/auth.js";
import { profilesRouter } from "./routes/profiles.js";
import { providersRouter } from "./routes/providers.js";
import { batchesRouter } from "./routes/batches.js";
import { runsRouter } from "./routes/runs.js";
import { sitesRouter } from "./routes/sites.js";

const app = express();
app.set("trust proxy", 1); // behind Azure Front Door / App Gateway
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
app.use(cors({ origin: env.PUBLIC_WEB_ORIGIN, credentials: true, maxAge: 600 }));
app.use(compression({ filter: (req, res) => !req.path.endsWith("/events") && compression.filter(req, res) }));
app.use(express.json({ limit: "4mb" }));
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/healthz" } }));

const limiter = (windowMs: number, limit: number, prefix: string) =>
  rateLimit({ windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false,
              store: new RedisStore({ prefix, sendCommand: (...args: string[]) => redis.call(args[0]!, ...args.slice(1)) as any }),
              keyGenerator: (req) => req.auth?.userId ?? req.ip ?? "anon" });

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", async (_req, res) => {
  try { await db.query("SELECT 1"); await redis.ping(); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.use("/v1/auth", limiter(60_000, 20, "rl:auth:"), authRouter);
app.use("/v1", requireAuth, limiter(60_000, 300, "rl:api:"));
app.use("/v1/profiles", profilesRouter);
app.use("/v1/runs", runsRouter);
app.use("/v1/sites", sitesRouter);
app.use("/v1/batches", batchesRouter);
app.use("/v1/providers", providersRouter);
app.use("/v1/analytics", analyticsRouter);
app.use(errorHandler);

await ensureBootstrapAdmin().catch((e) => logger.error({ e }, "bootstrap failed"));
const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, "api listening"));
const shutdown = () => server.close(async () => { await db.end(); redis.disconnect(); process.exit(0); });
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

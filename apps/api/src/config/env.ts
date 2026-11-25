import { z } from "zod";

/** Make a PEM robust to how .env files and Docker env_file pass multi-line values. */
function normalizePem(v: string): string {
  return v.trim().replace(/^["']|["']$/g, "").replace(/\\r/g, "").replace(/\\n/g, "\n");
}

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  PUBLIC_WEB_ORIGIN: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // JWT: API access tokens are signed with ES256. Auth.js (web) exchanges its session for these.
  // .env / Docker env_file may keep surrounding quotes and literal "\n" — strip and normalise both.
  JWT_PRIVATE_KEY_PEM: z.string().transform(normalizePem),
  JWT_PUBLIC_KEY_PEM: z.string().transform(normalizePem),
  JWT_ISSUER: z.string().default("formagent-api"),
  JWT_AUDIENCE: z.string().default("formagent"),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().default(60 * 60 * 24 * 14),
  INTERNAL_EXCHANGE_SECRET: z.string().min(32), // shared between Next.js server and API for session→JWT exchange

  // Encryption: KEK lives in Azure Key Vault (HSM-backed). In dev a local 32-byte hex key is allowed.
  KEY_VAULT_URL: z.string().url().optional(),
  KEK_NAME: z.string().default("formagent-kek"),
  DEV_LOCAL_KEK_HEX: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  BLIND_INDEX_KEY_HEX: z.string().regex(/^[0-9a-f]{64}$/),

  AZURE_STORAGE_ACCOUNT_URL: z.string().url().optional(),
  BLOB_CONTAINER_ARTIFACTS: z.string().default("run-artifacts"),
  BLOB_CONTAINER_BROWSER_STATE: z.string().default("browser-state"),
  BLOB_CONTAINER_DOCUMENTS: z.string().default("documents"),

  // Remote browser (optional). If unset, the worker launches local Chromium.
  BROWSER_WS_ENDPOINT: z.string().optional(),

  // Browser-Use navigator sidecar for open-ended navigation fallback
  NAVIGATOR_URL: z.string().url().default("http://navigator:8088"),

  // Local Chromium binary override (e.g. a preinstalled browser). Unset = Playwright's bundled browser.
  CHROMIUM_EXECUTABLE_PATH: z.string().optional(),
  // DEVELOPMENT ONLY: allow runs against localhost / private IPs (practice site, E2E tests). Refused in production.
  ALLOW_PRIVATE_TARGETS: z.enum(["true", "false"]).default("false"),

  // First-boot admin bootstrap (Docker). Ignored once any user exists.
  BOOTSTRAP_ADMIN_EMAIL: z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional()),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().optional(),
  BOOTSTRAP_ADMIN_ORG: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().default(2),
  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof Env>;
export const env: Env = Env.parse(process.env);
export const isProd = env.NODE_ENV === "production";
if (isProd && env.ALLOW_PRIVATE_TARGETS === "true") throw new Error("ALLOW_PRIVATE_TARGETS must not be enabled in production");

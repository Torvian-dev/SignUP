import pino from "pino";
import { env } from "../config/env.js";

/** Structured logger. PII and secret paths are redacted before they reach Log Analytics. */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.apiKey",
      "*.secret",
      "*.token",
      "*.value",
      "*.email",
      "*.phone",
      "*.firstName",
      "*.lastName",
    ],
    censor: "[REDACTED]",
  },
  base: { service: process.env.SERVICE_NAME ?? "formagent-api" },
});

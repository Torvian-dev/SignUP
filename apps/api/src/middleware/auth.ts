import type { NextFunction, Request, Response } from "express";
import { importSPKI, jwtVerify, type JWTPayload } from "jose";
import { env } from "../config/env.js";
import { HttpError } from "../lib/errors.js";
import type { Role } from "./rbac.js";

export interface AuthContext {
  userId: string;
  orgId: string;
  role: Role;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const publicKey = importSPKI(env.JWT_PUBLIC_KEY_PEM, "ES256");

interface AccessClaims extends JWTPayload {
  org: string;
  role: Role;
  sid: string;
}

/** Verifies the short-lived ES256 access token (Authorization: Bearer …). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new HttpError(401, "unauthenticated", "missing bearer token");
    const { payload } = await jwtVerify<AccessClaims>(header.slice(7), await publicKey, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ["ES256"],
      clockTolerance: 5,
    });
    if (!payload.sub || !payload.org || !payload.role) throw new HttpError(401, "unauthenticated", "malformed token");
    req.auth = { userId: payload.sub, orgId: payload.org, role: payload.role, sessionId: payload.sid };
    next();
  } catch (err) {
    next(err instanceof HttpError ? err : new HttpError(401, "unauthenticated", "invalid or expired token"));
  }
}

export function auth(req: Request): AuthContext {
  if (!req.auth) throw new HttpError(401, "unauthenticated", "not authenticated");
  return req.auth;
}

import type { Request } from "express";
import { db, type Tx } from "../lib/db.js";
import { logger } from "../lib/logger.js";

export type AuditAction =
  | "auth.login" | "auth.logout" | "auth.login_failed" | "auth.mfa"
  | "profile.create" | "profile.update" | "profile.delete" | "profile.secret_read"
  | "provider.create" | "provider.update" | "provider.rotate" | "provider.delete" | "provider.test"
  | "run.create" | "run.approve" | "run.submit" | "run.cancel"
  | "captcha.solve" | "user.invite" | "user.role_change" | "policy.update";

export interface AuditEntry {
  orgId: string | null;
  actorUserId?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  /** Never put secret or PII values here — field NAMES only. */
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** Append to the hash-chained audit log. Pass `tx` to make the audit row atomic with the change. */
export async function audit(entry: AuditEntry, tx?: Tx): Promise<void> {
  const q = tx ?? db;
  try {
    await q.query(
      `INSERT INTO audit_logs (org_id, actor_user_id, actor_ip, actor_ua, action, target_type, target_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        entry.orgId, entry.actorUserId ?? null, entry.ip ?? null, entry.userAgent ?? null,
        entry.action, entry.targetType ?? null, entry.targetId ?? null, entry.metadata ?? {},
      ],
    );
  } catch (err) {
    // An audit failure inside a transaction must abort the change; outside one we log loudly.
    if (tx) throw err;
    logger.error({ err, action: entry.action }, "audit write failed");
  }
}

export function auditFromReq(req: Request, e: Omit<AuditEntry, "orgId" | "actorUserId" | "ip" | "userAgent">): AuditEntry {
  return {
    ...e,
    orgId: req.auth?.orgId ?? null,
    actorUserId: req.auth?.userId ?? null,
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

import type { NextFunction, Request, Response } from "express";
import { forbidden } from "../lib/errors.js";

export type Role = "owner" | "admin" | "operator" | "reviewer" | "viewer";

/**
 * Permission matrix. Roles are additive: owner ⊃ admin ⊃ operator ⊃ reviewer ⊃ viewer,
 * except provider secrets which only owner/admin may touch.
 */
export const PERMISSIONS = {
  "dashboard:read": ["owner", "admin", "operator", "reviewer", "viewer"],
  "profile:read": ["owner", "admin", "operator", "reviewer"],
  "profile:write": ["owner", "admin", "operator"],
  "profile:delete": ["owner", "admin"],
  "profile:reveal": ["owner", "admin", "operator"], // reveal decrypted values in UI
  "run:create": ["owner", "admin", "operator"],
  "run:read": ["owner", "admin", "operator", "reviewer", "viewer"],
  "run:review": ["owner", "admin", "operator", "reviewer"],
  "run:approve": ["owner", "admin", "operator", "reviewer"],
  "run:cancel": ["owner", "admin", "operator"],
  "provider:read": ["owner", "admin"],
  "provider:write": ["owner", "admin"],
  "policy:write": ["owner", "admin"],
  "audit:read": ["owner", "admin"],
  "user:manage": ["owner", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, perm: Permission): boolean {
  return (PERMISSIONS[perm] as readonly Role[]).includes(role);
}

export const requirePermission =
  (perm: Permission) => (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !can(req.auth.role, perm)) return next(forbidden(`missing permission ${perm}`));
    next();
  };

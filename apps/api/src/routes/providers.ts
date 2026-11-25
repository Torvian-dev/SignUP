import { Router } from "express";
import { z } from "zod";
import { withOrg } from "../lib/db.js";
import { audit, auditFromReq } from "../middleware/audit.js";
import { auth } from "../middleware/auth.js";
import { ah, parse } from "../middleware/http.js";
import { requirePermission } from "../middleware/rbac.js";
import { buildProvider } from "../services/ai/router.js";
import { buildCaptchaProvider } from "../services/captcha/captchaRouter.js";
import { CredentialInput, getCredential, listCredentials, markStatus, PROVIDERS, upsertCredential } from "../services/secrets/providerSecrets.js";

export const providersRouter = Router();

providersRouter.get("/catalog", requirePermission("provider:read"), (_req, res) => res.json(PROVIDERS));

providersRouter.get("/", requirePermission("provider:read"), ah(async (req, res) => {
  res.json({ data: await listCredentials(auth(req).orgId) });
}));

/** Create or rotate (same provider+label replaces the secret; old one kept 24h for in-flight jobs). */
providersRouter.post("/", requirePermission("provider:write"), ah(async (req, res) => {
  const a = auth(req);
  const input = parse(CredentialInput, req.body);
  const id = await upsertCredential(a.orgId, a.userId, input);
  await audit(auditFromReq(req, { action: "provider.create", targetType: "provider_credential", targetId: id,
    metadata: { provider: input.provider, label: input.label, category: input.category } }));
  res.status(201).json({ id });
}));

providersRouter.patch("/:id", requirePermission("provider:write"), ah(async (req, res) => {
  const a = auth(req);
  const body = parse(z.object({ priority: z.number().int().min(0).max(1000).optional(), isActive: z.boolean().optional(),
                                config: z.record(z.string(), z.unknown()).optional() }), req.body);
  await withOrg(a.orgId, (tx) => tx.query(
    `UPDATE provider_credentials SET priority=coalesce($2,priority), is_active=coalesce($3,is_active), config=coalesce($4,config) WHERE id=$1`,
    [req.params.id, body.priority ?? null, body.isActive ?? null, body.config ?? null]));
  await audit(auditFromReq(req, { action: "provider.update", targetType: "provider_credential", targetId: req.params.id, metadata: { changed: Object.keys(body) } }));
  res.status(204).end();
}));

providersRouter.delete("/:id", requirePermission("provider:write"), ah(async (req, res) => {
  const a = auth(req);
  await withOrg(a.orgId, (tx) => tx.query("DELETE FROM provider_credentials WHERE id=$1", [req.params.id]));
  await audit(auditFromReq(req, { action: "provider.delete", targetType: "provider_credential", targetId: req.params.id }));
  res.status(204).end();
}));

/** "Test connection": live call to the provider (model lookup / balance check / SMTP verify). */
providersRouter.post("/:id/test", requirePermission("provider:write"), ah(async (req, res) => {
  const a = auth(req);
  const cred = await getCredential(a.orgId, req.params.id!);
  const category = await withOrg(a.orgId, async (tx) => (await tx.query("SELECT category FROM provider_credentials WHERE id=$1", [cred.id])).rows[0].category);
  const started = Date.now();
  let detail: Record<string, unknown> = {};
  try {
    if (category === "ai") await buildProvider(cred).ping();
    else if (category === "captcha") detail = { balanceUsd: await buildCaptchaProvider(cred).balance() };
    else if (category === "email" && cred.provider === "sendgrid") {
      const r = await fetch("https://api.sendgrid.com/v3/scopes", { headers: { authorization: `Bearer ${cred.secret.apiKey}` } });
      if (!r.ok) throw new Error(`SendGrid HTTP ${r.status}`);
    } else if (category === "browser" && cred.provider === "browserless") {
      const r = await fetch(`https://production-sfo.browserless.io/pressure?token=${encodeURIComponent(cred.secret.apiKey!)}`);
      if (!r.ok) throw new Error(`Browserless HTTP ${r.status}`);
    } else if (category === "browser" && cred.provider === "browserbase") {
      const r = await fetch("https://api.browserbase.com/v1/projects", { headers: { "x-bb-api-key": cred.secret.apiKey! } });
      if (!r.ok) throw new Error(`Browserbase HTTP ${r.status}`);
    }
    await markStatus(a.orgId, cred.id, true);
    await audit(auditFromReq(req, { action: "provider.test", targetType: "provider_credential", targetId: cred.id, metadata: { ok: true } }));
    res.json({ ok: true, latencyMs: Date.now() - started, ...detail });
  } catch (err) {
    const message = (err as Error).message.replace(/(key|token)=[^&\s]+/gi, "$1=•••");
    await markStatus(a.orgId, cred.id, false, message);
    res.status(200).json({ ok: false, latencyMs: Date.now() - started, error: message });
  }
}));

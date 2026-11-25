/**
 * Email verification. After a sign-up a site either emails a confirmation LINK or a one-time CODE.
 * This service connects to the profile's mailbox over Microsoft 365 (Graph, app-only) or IMAP, finds
 * the most recent message from the site's domain, and returns the link or the code.
 * Credentials come from provider_credentials (category=email).
 *
 * Mailbox note: Graph reads the named mailbox directly. IMAP connects to the one configured account,
 * so it only sees a profile's code if that account receives the profile's mail (a dedicated mailbox
 * per profile, or a catch-all domain). The connection is TLS; credentials are never logged.
 */
import { ImapFlow } from "imapflow";
import { chain } from "../secrets/providerSecrets.js";
import { extractCode, extractLink } from "./emailParse.js";

type Extractor = (text: string) => string | null;
const linkOf: Extractor = (t) => extractLink(t);

async function graphToken(tenantId: string, clientId: string, clientSecret: string) {
  const r = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  return ((await r.json()) as { access_token: string }).access_token;
}

async function findViaGraph(secret: Record<string, string>, mailbox: string, domain: string, since: Date, pick: Extractor): Promise<string | null> {
  const token = await graphToken(secret.tenantId!, secret.clientId!, secret.clientSecret!);
  const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages?$filter=${filter}&$orderby=receivedDateTime desc&$top=15&$select=from,subject,body,bodyPreview`,
    { headers: { authorization: `Bearer ${token}` } });
  const { value = [] } = (await r.json()) as { value?: { from?: { emailAddress?: { address?: string } }; subject?: string; body?: { content?: string }; bodyPreview?: string }[] };
  const root = domain.split(".").slice(-2).join(".");
  for (const m of value) {
    if (!m.from?.emailAddress?.address?.toLowerCase().includes(root)) continue;
    const hit = pick(`${m.subject ?? ""} ${m.body?.content ?? m.bodyPreview ?? ""}`);
    if (hit) return hit;
  }
  return null;
}

async function findViaImap(secret: Record<string, string>, cfg: Record<string, unknown>, domain: string, since: Date, pick: Extractor): Promise<string | null> {
  const client = new ImapFlow({ host: String(cfg.imapHost), port: Number(cfg.imapPort ?? 993), secure: true,
                                auth: { user: secret.username!, pass: secret.password! }, logger: false });
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    const ids = await client.search({ since, from: domain.split(".").slice(-2).join(".") });
    for (const id of (ids || []).reverse()) {
      const msg = await client.fetchOne(String(id), { source: true });
      const hit = msg && msg.source ? pick(msg.source.toString("utf8")) : null;
      if (hit) return hit;
    }
    return null;
  } finally {
    await client.logout().catch(() => undefined);
  }
}

async function poll(orgId: string, mailbox: string, domain: string, since: Date, timeoutMs: number, pick: Extractor): Promise<string | null> {
  const creds = (await chain(orgId, "email")).filter((c) => c.provider === "m365" || (c.provider === "smtp" && c.config.imapHost));
  if (!creds.length) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const c of creds) {
      const hit = c.provider === "m365"
        ? await findViaGraph(c.secret, mailbox, domain, since, pick).catch(() => null)
        : await findViaImap(c.secret, c.config, domain, since, pick).catch(() => null);
      if (hit) return hit;
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return null;
}

export { extractCode } from "./emailParse.js";

export const waitForVerificationLink = (orgId: string, mailbox: string, domain: string, since: Date, timeoutMs = 5 * 60_000) =>
  poll(orgId, mailbox, domain, since, timeoutMs, linkOf);

export const waitForVerificationCode = (orgId: string, mailbox: string, domain: string, since: Date, timeoutMs = 3 * 60_000) =>
  poll(orgId, mailbox, domain, since, timeoutMs, extractCode);

/** Is an email provider that can read codes configured for this org? */
export async function hasInbox(orgId: string): Promise<boolean> {
  return (await chain(orgId, "email")).some((c) => c.provider === "m365" || (c.provider === "smtp" && c.config.imapHost));
}

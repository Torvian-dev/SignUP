/**
 * Email verification: after a sign-up, poll the profile's mailbox for the site's verification
 * email and return the confirmation link. Supports Microsoft 365 (Graph, app-only) and IMAP.
 * Credentials come from provider_credentials (category=email).
 */
import { ImapFlow } from "imapflow";
import { chain } from "../secrets/providerSecrets.js";

const LINK_RE = /https?:\/\/[^\s"'<>]+(verify|confirm|activate|validation|token|email)[^\s"'<>]*/i;

async function graphToken(tenantId: string, clientId: string, clientSecret: string) {
  const r = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  return ((await r.json()) as { access_token: string }).access_token;
}

async function findViaGraph(secret: Record<string, string>, mailbox: string, domain: string, since: Date): Promise<string | null> {
  const token = await graphToken(secret.tenantId!, secret.clientId!, secret.clientSecret!);
  const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages?$filter=${filter}&$orderby=receivedDateTime desc&$top=15&$select=from,subject,body`,
    { headers: { authorization: `Bearer ${token}` } });
  const { value = [] } = (await r.json()) as { value?: { from?: { emailAddress?: { address?: string } }; body?: { content?: string } }[] };
  for (const m of value) {
    if (!m.from?.emailAddress?.address?.toLowerCase().includes(domain.split(".").slice(-2).join("."))) continue;
    const link = m.body?.content?.match(LINK_RE)?.[0];
    if (link) return link.replace(/&amp;/g, "&");
  }
  return null;
}

async function findViaImap(secret: Record<string, string>, cfg: Record<string, unknown>, domain: string, since: Date): Promise<string | null> {
  const client = new ImapFlow({ host: String(cfg.imapHost), port: Number(cfg.imapPort ?? 993), secure: true,
                                auth: { user: secret.username!, pass: secret.password! }, logger: false });
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
    const ids = await client.search({ since, from: domain.split(".").slice(-2).join(".") });
    for (const id of (ids || []).reverse()) {
      const msg = await client.fetchOne(String(id), { source: true });
      const link = msg && msg.source?.toString("utf8").match(LINK_RE)?.[0];
      if (link) return link.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
    }
    return null;
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function waitForVerificationLink(orgId: string, mailbox: string, domain: string, since: Date, timeoutMs = 5 * 60_000): Promise<string | null> {
  const creds = (await chain(orgId, "email")).filter((c) => c.provider === "m365" || (c.provider === "smtp" && c.config.imapHost));
  if (!creds.length) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const c of creds) {
      const link = c.provider === "m365"
        ? await findViaGraph(c.secret, mailbox, domain, since).catch(() => null)
        : await findViaImap(c.secret, c.config, domain, since).catch(() => null);
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  return null;
}

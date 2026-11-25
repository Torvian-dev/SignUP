/**
 * One persistent, stable browser identity per profile.
 *
 *  - Egress through the profile's single proxy (profile_proxies, UNIQUE per profile).
 *  - Fixed user agent / viewport / locale / timezone stored in browser_profiles and reused
 *    for every run, like an employee's own browser — no per-run randomisation.
 *  - Cookies + localStorage persisted (encrypted) to Blob between runs → logged-in sessions
 *    and half-finished applications survive restarts and can be resumed.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { env } from "../config/env.js";
import { BLOB, getDecrypted, putEncrypted } from "./blobPaths.js";
import { withOrg } from "../lib/db.js";
import type { DecryptedProfile } from "../services/profiles/profileService.js";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  userAgent: string;
  save(): Promise<void>;
  close(): Promise<void>;
}

async function identity(profile: DecryptedProfile) {
  return withOrg(profile.orgId, async (tx) => {
    const existing = (await tx.query("SELECT * FROM browser_profiles WHERE profile_id=$1", [profile.id])).rows[0];
    if (existing) return existing;
    const created = (await tx.query(
      `INSERT INTO browser_profiles (profile_id, org_id, user_agent, locale, timezone)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [profile.id, profile.orgId, DEFAULT_UA, profile.locale, profile.timezone])).rows[0];
    return created;
  });
}

export async function openSession(profile: DecryptedProfile): Promise<BrowserSession> {
  const id = await identity(profile);
  const proxy = profile.proxy
    ? {
        server: `${profile.proxy.type === "socks5" ? "socks5" : "http"}://${profile.proxy.host}:${profile.proxy.port}`,
        username: profile.proxy.username,
        password: profile.proxy.password,
      }
    : undefined;

  // Remote browser (Browserless/Browserbase) or local Chromium in the worker pod.
  const browser = env.BROWSER_WS_ENDPOINT
    ? await chromium.connectOverCDP(env.BROWSER_WS_ENDPOINT)
    : await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });

  const storage = id.storage_blob_path
    ? await getDecrypted(profile.orgId, BLOB.browserState, id.storage_blob_path)
    : null;

  const context = await browser.newContext({
    userAgent: id.user_agent,
    viewport: { width: id.viewport_w, height: id.viewport_h },
    locale: id.locale,
    timezoneId: id.timezone,
    proxy,
    storageState: storage ? JSON.parse(storage.toString("utf8")) : undefined,
    acceptDownloads: false,
    permissions: [],
  });
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(45_000);

  // Block heavy third-party media to speed up runs; never block scripts (SPAs need them).
  await context.route("**/*.{mp4,webm,avi,mov}", (r) => r.abort());

  const page = await context.newPage();

  const save = async () => {
    const state = await context.storageState();
    const key = await putEncrypted(profile.orgId, BLOB.browserState, `${profile.id}/storage.json.enc`, Buffer.from(JSON.stringify(state)));
    await withOrg(profile.orgId, (tx) => tx.query(
      "UPDATE browser_profiles SET storage_blob_path=$2, updated_at=now() WHERE profile_id=$1", [profile.id, key]));
  };

  return {
    browser, context, page, userAgent: id.user_agent, save,
    close: async () => {
      await save().catch(() => undefined);
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

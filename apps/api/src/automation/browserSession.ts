/**
 * One persistent, stable browser identity per profile.
 *
 *  - Egress through the profile's single proxy (profile_proxies, UNIQUE per profile).
 *  - A per-profile fingerprint (OS, GPU, screen, cores, memory, UA) generated once and reused
 *    for every run, like an employee's own machine — distinct between profiles, stable within one.
 *  - A stealth init-script removes the automation flag (navigator.webdriver) and the other
 *    headless tells before any site code runs.
 *  - Cookies + localStorage persisted (encrypted) to Blob between runs → logged-in sessions
 *    and half-finished applications survive restarts and can be resumed.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { env } from "../config/env.js";
import { BLOB, getDecrypted, putEncrypted } from "./blobPaths.js";
import { withOrg } from "../lib/db.js";
import type { DecryptedProfile } from "../services/profiles/profileService.js";
import { FP_VERSION, buildUserAgent, engineMajor, generateFingerprint, type Fingerprint } from "./fingerprint.js";
import { stealthScript } from "./stealth.js";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  userAgent: string;
  save(): Promise<void>;
  close(): Promise<void>;
}

interface Identity {
  fingerprint: Fingerprint;
  locale: string;
  timezone: string;
  storage_blob_path: string | null;
}

/** Load the profile's fingerprint, generating (or regenerating on version bump) and persisting it. */
async function identity(profile: DecryptedProfile): Promise<Identity> {
  return withOrg(profile.orgId, async (tx) => {
    const row = (await tx.query("SELECT * FROM browser_profiles WHERE profile_id=$1", [profile.id])).rows[0];
    if (row && row.fingerprint && row.fp_version === FP_VERSION) {
      return { fingerprint: row.fingerprint as Fingerprint, locale: row.locale, timezone: row.timezone, storage_blob_path: row.storage_blob_path };
    }
    const fp = generateFingerprint(profile.id, profile.locale);
    const saved = (await tx.query(
      `INSERT INTO browser_profiles (profile_id, org_id, user_agent, viewport_w, viewport_h, locale, timezone, fingerprint, fp_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (profile_id) DO UPDATE SET
         user_agent=EXCLUDED.user_agent, viewport_w=EXCLUDED.viewport_w, viewport_h=EXCLUDED.viewport_h,
         locale=EXCLUDED.locale, timezone=EXCLUDED.timezone, fingerprint=EXCLUDED.fingerprint,
         fp_version=EXCLUDED.fp_version, updated_at=now()
       RETURNING storage_blob_path`,
      [profile.id, profile.orgId, buildUserAgent(fp.osToken, 0), fp.viewport.width, fp.viewport.height,
       profile.locale, profile.timezone, JSON.stringify(fp), FP_VERSION])).rows[0];
    return { fingerprint: fp, locale: profile.locale, timezone: profile.timezone, storage_blob_path: saved?.storage_blob_path ?? null };
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
  // --disable-blink-features=AutomationControlled stops navigator.webdriver being set to true;
  // the stealth init-script below covers the remaining vectors.
  const stealthArgs = ["--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"];
  const browser = env.BROWSER_WS_ENDPOINT
    ? await chromium.connectOverCDP(env.BROWSER_WS_ENDPOINT)
    : await chromium.launch({ headless: true, executablePath: env.CHROMIUM_EXECUTABLE_PATH, args: stealthArgs });

  const fp = id.fingerprint;
  // Match the UA's Chrome version to the live engine so it agrees with the Sec-CH-UA headers.
  const major = engineMajor(browser.version());
  const userAgent = buildUserAgent(fp.osToken, major);

  const storage = id.storage_blob_path
    ? await getDecrypted(profile.orgId, BLOB.browserState, id.storage_blob_path)
    : null;

  const context = await browser.newContext({
    userAgent,
    viewport: fp.viewport,
    screen: fp.screen,
    deviceScaleFactor: fp.deviceScaleFactor,
    locale: id.locale,
    timezoneId: id.timezone,
    proxy,
    storageState: storage ? JSON.parse(storage.toString("utf8")) : undefined,
    acceptDownloads: false,
    permissions: [],
  });
  // Stealth first, so it runs before any site script in every page and frame.
  await context.addInitScript(stealthScript(fp, userAgent, major));
  // Dev runners (tsx/esbuild keepNames) wrap functions in __name(); functions passed to page.evaluate
  // would throw in the page without this no-op shim. Harmless in production builds.
  await context.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
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
    browser, context, page, userAgent, save,
    close: async () => {
      await save().catch(() => undefined);
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

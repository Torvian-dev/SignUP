/**
 * Batch E2E: one URL × a roster of profiles, fully automatic.
 * Signs in, creates N profiles (each with its own email + proxy host), enables auto-submit,
 * starts a batch and watches it create one account per profile with no human click.
 *
 *   E2E_PASSWORD=... node test/e2e/batch-run.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = process.env.E2E_OUT ?? path.join(process.cwd(), "e2e-screenshots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "admin@formagent.test";
const PW = process.env.E2E_PASSWORD;
if (!PW) { console.error("set E2E_PASSWORD"); process.exit(1); }
// A no-CAPTCHA registration form (CAPTCHA-gated sites need a solving provider in batch mode).
const TARGET = process.env.E2E_TARGET ?? "http://localhost:5055/register?captcha=off";

const ROSTER = [
  { label: "Sarah Bell", firstName: "Sarah", lastName: "Bell", email: "sarah.bell@example.com", phone: "07933322211", business: "Bell Design Co", dob: "1988-06-14", proxyHost: "127.0.0.1", proxyPort: 8899 },
  { label: "Tom Ford", firstName: "Tom", lastName: "Ford", email: "tom.ford@example.com", phone: "07700900123", business: "Ford Logistics Ltd", dob: "1979-11-02", proxyHost: "127.0.0.1", proxyPort: 8899 },
  { label: "Amara Khan", firstName: "Amara", lastName: "Khan", email: "amara.khan@example.com", phone: "07811456789", business: "Khan Consulting", dob: "1992-03-21", proxyHost: "127.0.0.1", proxyPort: 8899 },
];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 })).newPage();
  const shot = async (n, o = {}) => { await page.screenshot({ path: path.join(OUT, `${n}.png`), ...o }); log("shot", n); };

  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL); await page.fill("#password", PW);
  await page.click("form:has(#password) button");
  await page.waitForURL("**/dashboard", { timeout: 30000 });

  // Create the roster via the API (each profile encrypted server-side), one proxy each.
  const existing = await (await page.request.get(`${BASE}/api/v1/profiles`)).json();
  const have = new Set(existing.data.map((p) => p.label));
  for (const [i, m] of ROSTER.entries()) {
    if (have.has(m.label)) continue;
    const r = await page.request.post(`${BASE}/api/v1/profiles`, {
      data: {
        label: m.label, firstName: m.firstName, lastName: m.lastName, email: m.email, phone: m.phone,
        addresses: [{ kind: "primary", line1: `${i + 1} Market Street`, city: "Manchester", region: "Greater Manchester", postcode: `M${i + 1} 2AB`, countryCode: "GB" }],
        proxy: { type: "http", host: m.proxyHost, port: m.proxyPort, username: `u${i + 1}`, password: "secret" },
        customFields: [{ key: "business_name", label: "Business Name", type: "text", value: m.business, synonyms: ["Trading name", "Company name"] }, { key: "date_of_birth", label: "Date of Birth", type: "date", value: m.dob, synonyms: ["DOB", "Birthday"] }],
      },
    });
    if (!r.ok()) throw new Error(`create ${m.label}: ${await r.text()}`);
    log("created profile", m.label);
  }
  const profiles = (await (await page.request.get(`${BASE}/api/v1/profiles`)).json()).data.filter((p) => ROSTER.some((m) => m.label === p.label));

  // Build the batch in the UI
  await page.goto(`${BASE}/batches/new`);
  await page.fill("#url", TARGET);
  for (const p of profiles) await page.getByText(p.label, { exact: false }).locator("..").locator("input[type=checkbox]").check().catch(async () => {
    await page.locator(`label:has-text("${p.label}") input[type=checkbox]`).check();
  });
  await shot("batch-01-new", { fullPage: true });
  await page.getByRole("button", { name: "Start batch" }).click();
  await page.waitForURL(/\/batches\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const batchId = page.url().split("/").pop();
  log("batch", batchId);

  const deadline = Date.now() + 10 * 60_000; let last = "";
  while (Date.now() < deadline) {
    const b = await (await page.request.get(`${BASE}/api/v1/batches/${batchId}`)).json();
    const line = `${b.status} processed=${b.processed} ok=${b.succeeded} fail=${b.failed}`;
    if (line !== last) { log(" ", line); last = line; }
    if (["completed", "cancelled"].includes(b.status)) break;
    await page.waitForTimeout(2500);
  }
  await page.reload(); await page.waitForTimeout(1000);
  await shot("batch-02-progress", { fullPage: true });

  const submissions = await (await page.request.get("http://localhost:5055/submissions")).json();
  log("practice site received", submissions.length, "registrations:");
  for (const s of submissions.filter((x) => x.work_mail)) log("   ", s.contact_fn, s.contact_ln, "|", s.work_mail, "|", s.trading_name, "|", s.pc);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

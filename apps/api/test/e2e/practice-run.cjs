/**
 * End-to-end test: acts as a human user in the real web UI against the practice site.
 * Signs in, creates a profile, runs the agent N times on http://localhost:5055, solves the practice
 * CAPTCHA through the live view, corrects fields on review, approves, and saves screenshots.
 *
 *   E2E_EMAIL=admin@formagent.test E2E_PASSWORD=... RUNS=3 node test/e2e/practice-run.cjs
 * Requires: web on :3000, api + worker running with ALLOW_PRIVATE_TARGETS=true, practice site on :5055.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = process.env.E2E_OUT ?? path.join(process.cwd(), "e2e-screenshots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "admin@formagent.test";
const PW = process.env.E2E_PASSWORD;
if (!PW) { console.error("set E2E_PASSWORD (the password you gave npm run create-admin)"); process.exit(1); }
const RUNS = Number(process.env.RUNS ?? 3);
const START = Number(process.env.START ?? 1);

// What a human reviewer would pick for each practice-site field.
const HUMAN = [
  [/forename/i, "personal.firstName"], [/family name/i, "personal.lastName"], [/work e-?mail/i, "personal.email"],
  [/mobile/i, "personal.phone"], [/company|trading/i, "custom.business_name"], [/house number|street/i, "address.primary.line1"],
  [/^town/i, "address.primary.city"], [/county/i, "address.primary.region"], [/postcode/i, "address.primary.postcode"],
  [/country/i, "address.primary.country"], [/date of birth/i, "custom.date_of_birth"], [/accept the supplier terms/i, "consent.terms"],
  [/password/i, "generated.password"], [/tender alerts|marketing/i, ""],
];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const shot = async (name, opts = {}) => { await page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts }); log("shot", name); };

  // Where the practice CAPTCHA widget sits in the agent's 1440x900 viewport on step 3.
  const helper = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await helper.goto("http://localhost:5055/register");
  for (const [sel, v] of [["#fn", "a"], ["#ln", "b"], ["#em", "a@b.co"], ["#mob", "0"], ["#co", "c"]]) await helper.fill(sel, v);
  await helper.click("text=Continue");
  for (const [sel, v] of [["#a1", "a"], ["#town", "b"], ["#pc", "c"], ["#dob", "01/01/2000"]]) await helper.fill(sel, v);
  await helper.selectOption("#ctry", "GB");
  await helper.click("text=Continue");
  const wb = await helper.locator(".g-recaptcha").boundingBox();
  const widget = { x: (wb.x + 40) / 1440, y: (wb.y + wb.height / 2) / 900 };
  await helper.close();
  log("widget fraction", widget);

  // 1. Sign in
  await page.goto(`${BASE}/login`);
  await shot("01-login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PW);
  await page.click("form:has(#password) button");
  await page.waitForURL("**/dashboard", { timeout: 30000 });
  await shot("02-dashboard-empty", { fullPage: true });

  // 2. Create a profile through the UI
  const existing = await (await page.request.get(`${BASE}/api/v1/profiles`)).json();
  if (!existing.data.length) {
    await page.goto(`${BASE}/profiles/new`);
    await page.getByLabel("Profile name").fill("Profile A – John Smith");
    await page.getByLabel("First name").fill("John");
    await page.getByLabel("Last name").fill("Smith");
    await page.getByLabel("Email address").fill("john.smith@example.com");
    await page.getByLabel("Phone number").fill("07123456789");
    await page.getByLabel("Address line 1").fill("14 Park Row");
    await page.getByLabel("City").fill("Leeds");
    await page.getByLabel("County / State").fill("West Yorkshire");
    await page.getByLabel("Postcode / ZIP").fill("LS1 5HD");
    await page.getByLabel("Country (ISO code, e.g. GB)").fill("GB");
    await page.getByRole("button", { name: "Date of Birth" }).click();
    await page.getByRole("button", { name: "Business Name" }).click();
    await page.fill('input[name="customFields.0.value"]', "1985-03-07");
    await page.fill('input[name="customFields.1.value"]', "Smith Engineering Ltd");
    await page.fill('input[name="customFields.1.synonyms"]', "Trading name, Company name");
    await shot("03-profile-form", { fullPage: true });
    await page.getByRole("button", { name: "Save profile" }).click();
    await page.waitForURL("**/profiles", { timeout: 20000 });
    await shot("04-profiles");
  }

  for (let n = START; n <= RUNS; n++) {
    // 3. Start a run
    await page.goto(`${BASE}/runs/new`);
    await page.fill("#url", "http://localhost:5055/");
    await page.selectOption("#intent", "auto");
    if (n === START) await shot("05-new-run");
    await page.getByRole("button", { name: "Start agent" }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 20000 });
    const runId = page.url().split("/").pop();
    log(`run ${n}: ${runId}`);

    let reviews = 0, manual = 0, last = "", stableSince = Date.now();
    const deadline = Date.now() + 8 * 60_000;
    while (Date.now() < deadline) {
      const run = await (await page.request.get(`${BASE}/api/v1/runs/${runId}`)).json();
      if (run.status !== last) { log(`  status ${run.status}`); last = run.status; stableSince = Date.now(); }
      if (["succeeded", "failed", "cancelled"].includes(run.status)) {
        await page.waitForTimeout(1500);
        await shot(`run${n}-z-${run.status}`, { fullPage: true });
        if (run.status !== "succeeded") log("  error:", run.error_message);
        break;
      }
      if (run.status === "awaiting_manual") {
        manual++;
        await page.waitForFunction(() => document.querySelector("img[alt^='Live view']")?.getAttribute("src")?.startsWith("data:"), null, { timeout: 30000 });
        await page.waitForTimeout(800);
        if (n === START) await shot(`run${n}-manual-${manual}-before`);
        const img = page.locator("img[alt^='Live view']");
        const box = await img.boundingBox();
        await page.mouse.click(box.x + widget.x * box.width, box.y + widget.y * box.height);
        await page.waitForTimeout(3000);
        if (n === START) await shot(`run${n}-manual-${manual}-after`);
        await page.getByRole("button", { name: "Done" }).click();
        await page.waitForFunction(() => !document.querySelector("img[alt^='Live view']"), null, { timeout: 30000 });
        continue;
      }
      if (run.status === "awaiting_review") {
        reviews++;
        await page.waitForSelector("text=Review before submitting", { timeout: 30000 });
        await page.waitForSelector("table tbody tr", { timeout: 30000 });
        await page.waitForTimeout(500);
        await shot(`run${n}-review-${reviews}-a-as-filled`, { fullPage: true });
        // Act as the reviewer: correct anything that's empty or wrong.
        const rows = page.locator("table tbody tr");
        let corrected = 0;
        for (let i = 0; i < await rows.count(); i++) {
          const row = rows.nth(i);
          const label = (await row.locator("td").first().innerText()).split("\n")[0];
          const want = HUMAN.find(([re]) => re.test(label))?.[1];
          if (want === undefined) continue;
          const select = row.locator("select").first();
          const current = await select.inputValue();
          if (current !== want) { await select.selectOption(want); corrected++; }
        }
        log(`  review ${reviews}: corrected ${corrected} field(s)`);
        if (corrected) await shot(`run${n}-review-${reviews}-b-corrected`, { fullPage: true });
        await page.getByRole("button", { name: "Approve & submit" }).click();
        await page.waitForFunction(() => !document.body.innerText.includes("Review before submitting"), null, { timeout: 60000 });
        continue;
      }
      if (Date.now() - stableSince > 3 * 60_000) { log("  stuck in", run.status); break; }
      await page.waitForTimeout(1500);
    }
  }

  // 4. History + dashboard
  await page.goto(`${BASE}/runs`);
  await shot("90-history", { fullPage: true });
  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(1500);
  await shot("91-dashboard-after", { fullPage: true });
  await page.goto("http://localhost:5055/submissions");
  log("practice site received:\n" + (await page.innerText("body")));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

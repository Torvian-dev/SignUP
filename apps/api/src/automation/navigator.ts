/**
 * Navigation decisions between form pages.
 *
 *  - Deterministic first: classify visible buttons as ADVANCE (Next/Continue) or COMMIT
 *    (Submit/Register/Create account/Apply/Pay). ADVANCE may be auto-clicked; COMMIT always
 *    stops for human approval.
 *  - If the landing page has no form (marketing page), follow a "Sign up / Register / Apply" link.
 *  - Open-ended fallback: the Browser Use sidecar (Python) is asked to reach the target form
 *    on complex sites (mega-menus, cookie walls, "choose account type" pages). It only
 *    NAVIGATES — it never types profile data and never submits.
 */
import type { Page } from "playwright";
import { env } from "../config/env.js";
import { humanClick, pause } from "./humanInput.js";
import type { PageAnalysis } from "./pageAnalyzer.js";

const COMMIT = /submit|register|sign ?up|create (my |an |your )?account|apply|send|finish|complete|confirm|pay|place order|join now/i;
const ADVANCE = /^(next|continue|proceed|save (and|&) continue|next step|go on)\b/i;
const COOKIE = /accept( all)?( cookies)?|agree|got it|allow all/i;

export type ButtonRole = "advance" | "commit" | "none";

export function classifyButton(text: string): ButtonRole {
  if (ADVANCE.test(text.trim())) return "advance";
  if (COMMIT.test(text)) return "commit";
  return "none";
}

export function pickPrimaryButton(a: PageAnalysis, hint: string | null): { text: string; locator: string; role: ButtonRole } | null {
  const candidates = a.buttons.map((b) => ({ ...b, role: classifyButton(b.text) })).filter((b) => b.role !== "none");
  const hinted = hint ? candidates.find((b) => b.text.toLowerCase().includes(hint.toLowerCase())) : undefined;
  const chosen = hinted ?? candidates.find((b) => b.type === "submit") ?? candidates[0];
  return chosen ? { text: chosen.text, locator: chosen.locator, role: chosen.role } : null;
}

export async function dismissCookieBanner(page: Page) {
  const btn = page.getByRole("button", { name: COOKIE }).first();
  if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await humanClick(page, btn);
    await pause(300, 700);
  }
}

export async function clickAndSettle(page: Page, locator: string) {
  const before = page.url();
  await humanClick(page, page.locator(locator).first());
  await Promise.race([
    page.waitForURL((u) => u.toString() !== before, { timeout: 15_000 }),
    page.waitForLoadState("networkidle", { timeout: 15_000 }),
  ]).catch(() => undefined);
  await pause(600, 1200);
}

export async function followSignupLink(page: Page, a: PageAnalysis): Promise<boolean> {
  const text = a.signals.signupLinks[0];
  if (!text) return false;
  const link = page.getByRole("link", { name: text }).or(page.getByRole("button", { name: text })).first();
  if (!(await link.isVisible().catch(() => false))) return false;
  await humanClick(page, link);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await pause(800, 1500);
  return true;
}

/**
 * Ask the Browser Use sidecar to drive the *same* browser (via CDP) to the form for `goal`.
 * Requires the session to have been launched with a CDP endpoint (Browserless/Browserbase or
 * a local Chromium with --remote-debugging-port).
 */
export async function navigateWithAgent(cdpUrl: string, goal: string, startUrl: string, maxSteps = 12): Promise<{ reached: boolean; finalUrl: string }> {
  const res = await fetch(`${env.NAVIGATOR_URL}/navigate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cdp_url: cdpUrl, goal, start_url: startUrl, max_steps: maxSteps }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) return { reached: false, finalUrl: startUrl };
  return (await res.json()) as { reached: boolean; finalUrl: string };
}

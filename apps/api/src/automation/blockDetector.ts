/**
 * Block / soft-ban detection. After a navigation or a submit, decide whether the site has blocked
 * us (WAF deny, "unusual traffic", rate limit, bot-wall) rather than shown a normal page. On a
 * block the orchestrator stops, fails the run, and quarantines the profile's proxy so the batch
 * doesn't keep burning accounts through a flagged IP.
 *
 * This is deliberately conservative: a normal form CAPTCHA is NOT a block (we solve those), and a
 * validation error is NOT a block. We only flag unambiguous wall/deny/limit pages.
 */
import type { Page } from "playwright";

export type BlockVerdict = "clean" | "blocked" | "rate_limited";
export interface BlockCheck { verdict: BlockVerdict; reason: string }

// Deny / bot-wall signals (vendor-agnostic + the big WAFs). Kept tight to avoid false positives.
const BLOCK_PATTERNS: [RegExp, string][] = [
  [/access (to this page )?(is )?denied/i, "access denied"],
  [/you have been blocked/i, "blocked by the site"],
  [/this website is using a security service to protect itself/i, "WAF challenge wall"],
  [/attention required.*cloudflare|cloudflare.*attention required/i, "Cloudflare block"],
  [/\b(unusual|suspicious|automated) (traffic|activity|requests?)\b/i, "flagged as automated traffic"],
  [/please verify you are a human|are you a robot|bot detection/i, "bot-detection wall"],
  [/request (was )?blocked|your request has been blocked/i, "request blocked"],
  [/pardon the interruption/i, "interruption wall"],
  [/reference ?(id|number)[:#]?\s*[a-f0-9-]{8,}/i, "WAF reference-id page"],
];
const RATE_PATTERNS: [RegExp, string][] = [
  [/rate ?limit|too many (requests|attempts)|slow down/i, "rate limited"],
  [/try again (later|in a (few|couple))/i, "temporarily throttled"],
];

export async function detectBlock(page: Page, httpStatus: number | null): Promise<BlockCheck> {
  // HTTP status is the strongest, cheapest signal.
  if (httpStatus === 429) return { verdict: "rate_limited", reason: "HTTP 429 Too Many Requests" };
  if (httpStatus === 403 || httpStatus === 503) {
    // 403/503 are used by WAFs for blocks, but also by some ordinary pages; confirm with text below.
  }

  const title = (await page.title().catch(() => "")) || "";
  // Only sample the top of the body — block pages say so immediately; avoids scanning huge SPAs.
  const body = (await page.evaluate(() => (document.body?.innerText || "").slice(0, 4000)).catch(() => "")) || "";
  const hay = `${title}\n${body}`;

  for (const [re, reason] of RATE_PATTERNS) if (re.test(hay)) return { verdict: "rate_limited", reason };
  for (const [re, reason] of BLOCK_PATTERNS) if (re.test(hay)) return { verdict: "blocked", reason };

  // A 403/503 with a near-empty body (no real content) is almost always a WAF deny.
  if ((httpStatus === 403 || httpStatus === 503) && body.replace(/\s+/g, " ").trim().length < 60) {
    return { verdict: "blocked", reason: `HTTP ${httpStatus} with no page content` };
  }
  return { verdict: "clean", reason: "" };
}

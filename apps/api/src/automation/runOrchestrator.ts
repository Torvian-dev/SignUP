import type { Page } from "playwright";
/**
 * The agent loop for one automation run.
 *
 *   queued → launching → [ analysing → mapping → filling → (solving_captcha | awaiting_manual) ]*
 *          → awaiting_review ──approve──► submitting → (next page? loop : verify email? : succeeded)
 *
 * Auto-advance: "Next/Continue" buttons on intermediate steps are clicked automatically when every
 * required field on the step is filled at ≥ auto_accept_confidence. Anything that COMMITS data
 * (Submit / Register / Create account / Apply / Pay) always stops at awaiting_review.
 *
 * Control messages arrive on Redis list run:<id>:control (pushed by the API):
 *   {type:"approve", userId, overrides:[{fieldId, profilePath?, transform?, value?}]}
 *   {type:"cancel"} | {type:"manual_done"} | {type:"input", event}
 */
import { decryptForOrg, encryptForOrg, generateSitePassword } from "../lib/crypto.js";
import { withOrg } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { redis } from "../lib/redis.js";
import { mapPage, type Decision } from "../services/ai/mappingEngine.js";
import { solveCaptcha } from "../services/captcha/captchaRouter.js";
import { waitForVerificationCode, waitForVerificationLink } from "../services/email/verificationInbox.js";
import { recordOutcome } from "../services/learning/learningService.js";
import { checkRunAllowed } from "../services/policy/policyGuard.js";
import { getDecryptedProfile } from "../services/profiles/profileService.js";
import { flattenValues } from "../services/profiles/profileVocabulary.js";
import { BLOB, putEncrypted } from "./blobPaths.js";
import { openSession, type BrowserSession } from "./browserSession.js";
import { detectBlock, type BlockVerdict } from "./blockDetector.js";
import { preflightProxy } from "./proxyPreflight.js";
import { detectCaptcha, injectSolution, toChallenge } from "./captchaDetector.js";
import { emit, setStatus } from "./events.js";
import { fillFields, type FillResult } from "./formFiller.js";
import { startLiveView } from "./liveView.js";
import { clickAndSettle, dismissCookieBanner, followSignupLink, pickPrimaryButton } from "./navigator.js";
import { resolveFrame } from "./frames.js";
import { humanType, hesitate } from "./humanInput.js";
import { audit as writeAudit } from "../middleware/audit.js";
import { analysePage, type PageAnalysis, type RawField } from "./pageAnalyzer.js";

const MAX_STEPS = 15;
const REVIEW_WAIT_MS = 20 * 60_000;   // keep the browser warm this long for the reviewer
const MANUAL_WAIT_MS = 10 * 60_000;
const controlKey = (runId: string) => `run:${runId}:control`;

type Control =
  | { type: "approve"; userId: string; overrides?: { fieldId: string; profilePath?: string | null; transform?: string | null; value?: string }[] }
  | { type: "cancel" } | { type: "manual_done" } | { type: "input"; event: any };

async function nextControl(runId: string, timeoutMs: number): Promise<Control | null> {
  // BLPOP blocks its connection. It must NOT run on the shared client, or live-view frame publishes and
  // BullMQ lock renewals queue behind it until a control message arrives. Use a dedicated connection.
  const conn = redis.duplicate();
  try {
    const r = await conn.blpop(controlKey(runId), Math.max(1, Math.ceil(timeoutMs / 1000)));
    return r ? (JSON.parse(r[1]) as Control) : null;
  } finally {
    conn.disconnect();
  }
}

export class CancelledError extends Error {}
/** A profile the batch should skip (auto-submit only): can't fill/solve safely. Not retried. */
export class SkipProfileError extends Error {}
/** The site blocked or rate-limited us. The run fails and the profile's proxy is quarantined. */
export class BlockedError extends Error {
  constructor(message: string, readonly verdict: BlockVerdict) { super(message); }
}

const BLOCK_COOLDOWN_MS: Record<BlockVerdict, number> = { blocked: 6 * 3_600_000, rate_limited: 30 * 60_000, clean: 0 };

/** Put the profile's single proxy on a cooldown so the batch skips this profile until it clears. */
async function quarantineProxy(orgId: string, profileId: string, verdict: BlockVerdict, reason: string) {
  const ms = BLOCK_COOLDOWN_MS[verdict];
  if (!ms) return;
  await withOrg(orgId, (tx) => tx.query(
    `UPDATE profile_proxies SET cooldown_until = now() + ($3 || ' milliseconds')::interval,
            block_count = block_count + 1, last_block_reason = $2, health_status = 'degraded', updated_at = now()
     WHERE profile_id = $1`,
    [profileId, reason.slice(0, 200), String(ms)]));
}

export async function executeRun(orgId: string, runId: string): Promise<void> {
  const run = await withOrg(orgId, async (tx) => (await tx.query("SELECT * FROM automation_runs WHERE id=$1", [runId])).rows[0]);
  if (!run || ["succeeded", "cancelled"].includes(run.status)) return;

  const url = new URL(run.url);
  const { domain, intent } = await checkRunAllowed(orgId, run.profile_id, url, run.intent);
  const policy = await withOrg(orgId, async (tx) => (await tx.query("SELECT * FROM org_policies WHERE org_id=$1", [orgId])).rows[0]);
  const autoAccept = Number(policy?.auto_accept_confidence ?? 0.92);
  const profile = await getDecryptedProfile(orgId, run.profile_id);

  // Values available to the filler (never logged, never sent to an LLM).
  const values = flattenValues(profile);
  const siteAcct = await withOrg(orgId, async (tx) => (await tx.query("SELECT * FROM site_accounts WHERE profile_id=$1 AND domain=$2", [profile.id, domain])).rows[0]);
  if (siteAcct) {
    values["site_account.username"] = (await decryptForOrg(orgId, siteAcct.username_enc)) ?? values["personal.email"] ?? "";
    values["site_account.password"] = (await decryptForOrg(orgId, siteAcct.password_enc)) ?? "";
  }
  const generatedPassword = generateSitePassword();
  values["generated.password"] = generatedPassword;
  let createdAccount = false;
  const runStart = new Date(Date.now() - 5 * 60_000); // search email from shortly before the run began

  let session: BrowserSession | null = null;
  try {
    await setStatus(orgId, runId, "launching");
    session = await openSession(profile);
    const { page } = session;

    // After any navigation/submit, stop if the site has thrown up a block or rate-limit wall.
    const guardBlocked = async () => {
      const check = await detectBlock(page, session!.mainStatus());
      if (check.verdict === "clean") return;
      await quarantineProxy(orgId, profile.id, check.verdict, check.reason);
      throw new BlockedError(check.reason, check.verdict);
    };

    // Proxy preflight: verify the profile's proxy is alive and its exit country is coherent.
    if (profile.proxy) {
      const pf = await preflightProxy(session.context, profile.addresses.primary?.countryCode);
      if (!pf.reachable) {
        await quarantineProxy(orgId, profile.id, "rate_limited", "proxy did not respond on preflight");
        throw new BlockedError("proxy is not responding", "rate_limited");
      }
      await withOrg(orgId, (tx) => tx.query("UPDATE profile_proxies SET last_exit_ip=$2, last_checked_at=now(), health_status='healthy' WHERE profile_id=$1", [profile.id, pf.ip]));
      if (pf.mismatch) {
        await emit(orgId, runId, "note",
          `Proxy exits from ${pf.country} but the profile is set to ${profile.addresses.primary?.countryCode} — timezone/locale may not match the IP`, undefined, "warn");
      }
    }

    const startUrl = run.checkpoint?.url ?? run.url;
    await emit(orgId, runId, "navigation", `Opening ${new URL(startUrl).hostname}`);
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    await guardBlocked();
    await dismissCookieBanner(page);

    for (let step = run.current_step ?? 0; step < MAX_STEPS; step++) {
      await setStatus(orgId, runId, "analysing", { current_step: step });
      let analysis = await analysePage(page);

      // Landing page without a usable form → find the sign-up / application entry point.
      const fillable = () => analysis.fields.filter((f) => f.visible && !f.honeypot && f.kind !== "hidden");
      if (fillable().length === 0 && (await followSignupLink(page, analysis))) {
        await emit(orgId, runId, "navigation", "Followed sign-up link");
        analysis = await analysePage(page);
      }
      if (fillable().length === 0) {
        if (/thank you|success|confirmed|we('ve| have) sent|check your (email|inbox)|account (has been )?created/i.test(await page.innerText("body").catch(() => ""))) {
          return await finish(orgId, runId, session, profile.id, domain, createdAccount, generatedPassword, values["personal.email"]);
        }
        if (run.auto_submit) throw new SkipProfileError("no form found on the page");
        await escalateManual(orgId, runId, session, "No form found on this page — please navigate to the form in the live view");
        continue;
      }

      // Persist page + fields
      const { stepId, fields } = await persistStep(orgId, runId, step, analysis);

      await setStatus(orgId, runId, "mapping");
      const mapped = await mapPage({
        orgId, runId, domain, url: analysis.url, pageTitle: analysis.title, profile,
        fields: fields.map((f) => ({ id: f.id, fieldKey: f.fieldKey, kind: f.kind, label: f.label, name: f.name, htmlId: f.htmlId,
          placeholder: f.placeholder, autocomplete: f.autocomplete, ariaLabel: f.ariaLabel, nearbyText: f.nearbyText,
          required: f.required, options: f.options?.slice(0, 80), section: f.section })),
      });
      const visibleCount = fields.filter((f) => f.visible && !f.honeypot && f.kind !== "hidden").length;
      await emit(orgId, runId, "mapping", `Mapped ${mapped.decisions.filter((d) => d.profilePath).length}/${visibleCount} fields`,
        { pageKind: mapped.pageKind, confidence: mapped.completionConfidence });

      await setStatus(orgId, runId, "filling");
      const results = await fillFields({
        orgId, page, fields, values, countryCode: profile.addresses.primary?.countryCode,
        consent: { terms: false, marketing: false },  // terms are ticked only on explicit approval
        minConfidence: 0.5,
      }, mapped.decisions);
      if ((mapped.pageKind === "signup" || analysis.signals.looksLikeSignup) && results.some((r) => r.status === "filled" && mapped.decisions.find((d) => d.fieldId === r.fieldId)?.profilePath === "generated.password")) {
        createdAccount = true;
      }
      await withOrg(orgId, (tx) => tx.query(
        `UPDATE automation_runs SET fields_total = fields_total + $2, fields_filled = fields_filled + $3, completion_confidence=$4 WHERE id=$1`,
        [runId, visibleCount, results.filter((r) => r.status === "filled").length, mapped.completionConfidence]));

      // CAPTCHA
      const captcha = await handleCaptcha(orgId, runId, domain, session, profile.proxy ?? undefined, { autoSubmit: run.auto_submit });

      // Email verification CODE (OTP): if the page asks for a one-time code, pull it from the inbox and type it.
      const otpResults = await fillEmailCode(orgId, runId, session, values["personal.email"], domain, fields, runStart);
      results.push(...otpResults);
      const otpFilled = new Set(otpResults.filter((r) => r.status === "filled").map((r) => r.fieldId));

      // Decide: auto-advance or stop for review
      const primary = pickPrimaryButton(analysis, mapped.submitLocatorHint);
      const requiredOk = fields.filter((f) => f.required && f.visible).every((f) => {
        if (otpFilled.has(f.id)) return true;
        const r = results.find((x) => x.fieldId === f.id);
        const d = mapped.decisions.find((x) => x.fieldId === f.id);
        return r?.status === "filled" && r.valid && (d?.confidence ?? 0) >= autoAccept;
      });
      const canAutoAdvance = primary?.role === "advance" && requiredOk && (run.auto_submit || !policy?.require_review_every_step);

      if (canAutoAdvance && primary) {
        for (const d of mapped.decisions) if (d.decisionId && d.profilePath) await recordOutcome(orgId, run.created_by, { decisionId: d.decisionId, outcome: "accepted", finalPath: d.profilePath, finalTransform: d.transform });
        await emit(orgId, runId, "navigation", `Auto-advancing: "${primary.text}"`);
        await hesitate(false);  // brief beat before moving to the next step
        await clickAndSettle(page, primary.locator, primary.framePath);
        await guardBlocked();
        await saveCheckpoint(orgId, runId, step + 1, page.url());
        continue;
      }

      // ---- Auto-submit (batch roster: one account per profile, no human click) ----
      if (run.auto_submit) {
        const reasons: string[] = [];
        if (!primary) reasons.push("no submit button found");
        if (captcha?.solvedBy === "unsolved") reasons.push("CAPTCHA could not be solved automatically");
        // Required fields must be safe to submit unseen. Trust a field that is filled and the site
        // accepts it, when the mapping is deterministic (heuristic), human-confirmed before (memory),
        // or a high-confidence AI mapping. Terms are ticked at submission, so they're exempt here.
        for (const f of fields.filter((x) => x.required && x.visible)) {
          if (otpFilled.has(f.id)) continue; // code pulled from email
          const r = results.find((x) => x.fieldId === f.id);
          const d = mapped.decisions.find((x) => x.fieldId === f.id);
          if (d?.profilePath === "consent.terms") continue;
          const trusted = d?.source === "memory" || d?.source === "heuristic" || (d?.confidence ?? 0) >= autoAccept;
          if (!r || r.status !== "filled" || !r.valid || !d?.profilePath || !trusted) {
            reasons.push(`"${f.label ?? f.name ?? f.kind}" could not be filled confidently`);
          }
        }
        if (reasons.length || !primary) throw new SkipProfileError(reasons.slice(0, 3).join("; ") || "cannot submit safely");
        // Accept every mapping, tick terms, submit — on the user's standing instruction for this roster.
        const autoCtrl = { type: "approve" as const, userId: run.created_by, overrides: [] };
        await applyOverridesAndLearn(orgId, runId, session, fields, mapped.decisions, results, values, autoCtrl, profile.addresses.primary?.countryCode);
        await setStatus(orgId, runId, "submitting", { approved_by: run.created_by });
        await writeAudit({ orgId, actorUserId: run.created_by, action: "run.submit", targetType: "run", targetId: runId, metadata: { domain, auto: true, batch: run.batch_id } });
        await emit(orgId, runId, "navigation", `Auto-submitting: "${primary.text}"`);
        await hesitate(true);  // longer "reviewing the form" pause before the committing click
        await clickAndSettle(page, primary.locator, primary.framePath);
        await guardBlocked();  // a block page right after submit = flagged; quarantine, don't count as success
        await withOrg(orgId, (tx) => tx.query("UPDATE automation_runs SET submitted_at = now() WHERE id=$1", [runId]));
        await saveCheckpoint(orgId, runId, step + 1, page.url());
        await maybeVerifyEmail(orgId, runId, page, domain, values["personal.email"]);
        continue;  // next iteration re-analyses; a success/confirmation page ends the run
      }

      // ---- Review gate ----
      await screenshot(orgId, runId, stepId, session);
      await withOrg(orgId, (tx) => tx.query("UPDATE automation_runs SET checkpoint=$2 WHERE id=$1",
        [runId, { url: page.url(), step, review: { stepId, results, submit: primary, captcha } }]));
      await setStatus(orgId, runId, "awaiting_review");
      await emit(orgId, runId, "review", "Ready for review", { stepId, completionConfidence: mapped.completionConfidence });

      const ctrl = await waitForApproval(orgId, runId, session);
      if (!ctrl) { await setStatus(orgId, runId, "paused"); return; }  // reviewer away — resume later from checkpoint

      await applyOverridesAndLearn(orgId, runId, session, fields, mapped.decisions, results, values, ctrl, profile.addresses.primary?.countryCode);
      await handleCaptcha(orgId, runId, domain, session, profile.proxy ?? undefined); // token may have expired while waiting

      await setStatus(orgId, runId, "submitting", { approved_by: ctrl.userId });
      await audit(orgId, ctrl.userId, runId, domain);
      if (!primary) { await escalateManual(orgId, runId, session, "Could not find the submit button — please click it in the live view"); }
      else { await hesitate(true); await clickAndSettle(page, primary.locator, primary.framePath); }
      await withOrg(orgId, (tx) => tx.query("UPDATE automation_runs SET submitted_at = now() WHERE id=$1", [runId]));
      await saveCheckpoint(orgId, runId, step + 1, page.url());

      // Post-submit: email verification?
      await maybeVerifyEmail(orgId, runId, page, domain, values["personal.email"]);
    }
    throw new Error(`exceeded ${MAX_STEPS} steps`);
  } catch (err) {
    if (err instanceof CancelledError) { await setStatus(orgId, runId, "cancelled"); return; }
    if (err instanceof SkipProfileError) {
      await setStatus(orgId, runId, "failed", { error_code: "skipped", error_message: err.message.slice(0, 500) });
      await emit(orgId, runId, "note", `Skipped: ${err.message}`, undefined, "warn");
      return;  // resolves so the batch can move to the next profile
    }
    if (err instanceof BlockedError) {
      await setStatus(orgId, runId, "failed", { error_code: err.verdict === "rate_limited" ? "rate_limited" : "blocked", error_message: err.message.slice(0, 500) });
      await emit(orgId, runId, "note", `${err.verdict === "rate_limited" ? "Rate-limited" : "Blocked"} by the site: ${err.message} — proxy quarantined`, undefined, "warn");
      return;  // resolves so the batch moves on; this profile's proxy is now on cooldown
    }
    logger.error({ err, runId }, "run failed");
    await setStatus(orgId, runId, "failed", { error_code: "run_error", error_message: (err as Error).message.slice(0, 500) });
    throw err;
  } finally {
    await session?.close();
  }

  // ---- helpers bound to this run ----
  async function waitForApproval(orgId: string, runId: string, s: BrowserSession) {
    const deadline = Date.now() + REVIEW_WAIT_MS;
    while (Date.now() < deadline) {
      const c = await nextControl(runId, Math.min(30_000, deadline - Date.now()));
      if (!c) { await s.page.evaluate(() => 1).catch(() => undefined); continue; } // keepalive
      if (c.type === "cancel") throw new CancelledError();
      if (c.type === "approve") return c;
    }
    return null;
  }
}

async function fillEmailCode(orgId: string, runId: string, s: BrowserSession, email: string | undefined, domain: string,
                            fields: (RawField & { id: string })[], since: Date): Promise<FillResult[]> {
  const otpFields = fields.filter((f) => f.otp && f.visible && !f.honeypot);
  if (otpFields.length === 0 || !email) return [];
  await emit(orgId, runId, "verification", "This page asks for an email code — checking the inbox");
  const code = await waitForVerificationCode(orgId, email, domain, since, 120_000);
  if (!code) {
    await emit(orgId, runId, "verification", "No verification code found in email within 2 minutes — enter it on the review screen", undefined, "warn");
    return [];
  }
  const out: FillResult[] = [];
  for (const f of otpFields) {
    try {
      const root = resolveFrame(s.page, f.framePath);
      await humanType(s.page, root.locator(f.locator).first(), code);
      out.push({ fieldId: f.id, status: "filled", valid: true, displayValue: code });
    } catch (err) {
      out.push({ fieldId: f.id, status: "error", valid: false, validationMessage: (err as Error).message.slice(0, 160) });
    }
  }
  await emit(orgId, runId, "verification", `Entered the code from email (${code})`);
  return out;
}

async function maybeVerifyEmail(orgId: string, runId: string, page: Page, domain: string, email?: string) {
  const body = (await page.innerText("body").catch(() => "")).toLowerCase();
  if (!/verify your email|check your (email|inbox)|confirmation (email|link)/.test(body) || !email) return;
  await emit(orgId, runId, "verification", "Waiting for verification email");
  const link = await waitForVerificationLink(orgId, email, domain, new Date(Date.now() - 60_000));
  if (link) { await page.goto(link); await emit(orgId, runId, "verification", "Email verified"); }
  else await emit(orgId, runId, "verification", "No verification email found within 5 minutes — verify manually", undefined, "warn");
}

async function persistStep(orgId: string, runId: string, step: number, a: PageAnalysis) {
  return withOrg(orgId, async (tx) => {
    const kind = a.signals.looksLikeLogin ? "login" : a.signals.looksLikeSignup ? "signup" : "form";
    const s = (await tx.query<{ id: string }>(
      `INSERT INTO run_steps (run_id, org_id, step_index, page_url, page_title, page_kind) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (run_id, step_index) DO UPDATE SET page_url=EXCLUDED.page_url, page_title=EXCLUDED.page_title RETURNING id`,
      [runId, orgId, step, a.url, a.title, kind])).rows[0]!;
    const fields: (RawField & { id: string; fieldKey: string })[] = [];
    for (const f of a.fields) {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO detected_fields (run_id, step_id, org_id, field_key, locator, kind, label, name_attr, id_attr, placeholder,
                                      autocomplete, aria_label, nearby_text, options, required, frame_path, in_shadow_dom, visible)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [runId, s.id, orgId, f.fieldKey, f.locator, ["text","email","tel","password","number","date","select","checkbox","radio","file","textarea","hidden","combobox"].includes(f.kind) ? f.kind : "unknown",
         f.label, f.name, f.htmlId, f.placeholder, f.autocomplete, f.ariaLabel, f.nearbyText, f.options ? JSON.stringify(f.options) : null,
         f.required, f.framePath, f.inShadow, f.visible && !f.honeypot]);
      fields.push({ ...f, id: r.rows[0]!.id });
    }
    return { stepId: s.id, fields };
  });
}

type CaptchaStatus = { kind: string; solvedBy: string } | null;

async function handleCaptcha(orgId: string, runId: string, domain: string, s: BrowserSession, proxy?: { type: string; host: string; port: number; username?: string; password?: string }, opts: { autoSubmit?: boolean } = {}): Promise<CaptchaStatus> {
  const found = await detectCaptcha(s.page);
  if (!found) return null;
  await setStatus(orgId, runId, "solving_captcha");
  await emit(orgId, runId, "captcha", `Detected ${found.kind}`);
  const challenge = await toChallenge(s.page, found, s.userAgent, proxy);
  const outcome = found.kind === "slider"
    ? ({ status: "manual", reason: "slider challenges are completed by the reviewer" } as const)
    : await solveCaptcha(orgId, runId, domain, challenge);
  if (outcome.status === "solved") {
    await injectSolution(s.page, found, outcome.solution.token, outcome.solution.text);
    await emit(orgId, runId, "captcha", `Solved via ${outcome.provider}`);
    return { kind: found.kind, solvedBy: outcome.provider };
  }
  // In auto-submit (batch) mode there is no person watching — report unsolved and let the caller skip.
  if (opts.autoSubmit) {
    await emit(orgId, runId, "captcha", `CAPTCHA could not be solved automatically: ${outcome.reason}`, undefined, "warn");
    return { kind: found.kind, solvedBy: "unsolved" };
  }
  await escalateManual(orgId, runId, s, `CAPTCHA needs a person: ${outcome.reason}`);
  const stillThere = await detectCaptcha(s.page);
  await emit(orgId, runId, "captcha", stillThere ? "CAPTCHA still looks unsolved — check it in the review screenshot" : "Solved by reviewer",
    undefined, stillThere ? "warn" : "info");
  return { kind: found.kind, solvedBy: stillThere ? "unsolved" : "reviewer" };
}

async function escalateManual(orgId: string, runId: string, s: BrowserSession, reason: string) {
  await setStatus(orgId, runId, "awaiting_manual");
  await emit(orgId, runId, "manual", reason, undefined, "warn");
  const live = await startLiveView(s.page, runId);
  try {
    const deadline = Date.now() + MANUAL_WAIT_MS;
    while (Date.now() < deadline) {
      const c = await nextControl(runId, Math.min(30_000, deadline - Date.now()));
      if (!c) continue;
      if (c.type === "cancel") throw new CancelledError();
      if (c.type === "input") await live.input(c.event);
      if (c.type === "manual_done") return;
    }
    throw new Error("manual step timed out");
  } finally {
    await live.stop();
  }
}

async function applyOverridesAndLearn(orgId: string, runId: string, s: BrowserSession, fields: (RawField & { id: string })[],
  decisions: Decision[], results: FillResult[], values: Record<string, string>, ctrl: Extract<Control, { type: "approve" }>, countryCode?: string) {
  const overrides = new Map((ctrl.overrides ?? []).map((o) => [o.fieldId, o]));
  const reFill: Decision[] = [];
  const extraValues: Record<string, string> = {};
  for (const d of decisions) {
    const o = overrides.get(d.fieldId);
    if (!d.decisionId) continue;
    if (!o) {
      const r = results.find((x) => x.fieldId === d.fieldId);
      // Approving the page is acceptance of the terms mapping (it is ticked right after approval).
      const outcome = d.profilePath === "consent.terms" ? "accepted"
        : r?.status === "filled" ? (r.valid ? "accepted" : "validation_failed") : "skipped";
      await recordOutcome(orgId, ctrl.userId, { decisionId: d.decisionId, outcome, finalPath: d.profilePath, finalTransform: d.transform });
      continue;
    }
    const overridePath = `override.${d.fieldId}`;
    const finalPath = o.value !== undefined ? overridePath : (o.profilePath ?? null);
    if (o.value !== undefined) extraValues[overridePath] = o.value;
    await recordOutcome(orgId, ctrl.userId, {
      decisionId: d.decisionId,
      outcome: finalPath === d.profilePath ? "accepted" : finalPath ? "corrected" : "rejected",
      finalPath: o.value !== undefined ? null : finalPath, finalTransform: o.transform ?? null,
    });
    if (finalPath) reFill.push({ ...d, profilePath: finalPath, transform: o.value !== undefined ? null : o.transform ?? d.transform, confidence: 1 });
  }
  // Terms are only ever ticked here — after a human approved the page.
  for (const d of decisions) if (d.profilePath === "consent.terms") reFill.push({ ...d, confidence: 1 });
  if (reFill.length) {
    await fillFields({ orgId, page: s.page, fields, values: { ...values, ...extraValues }, countryCode,
                       consent: { terms: true, marketing: false }, minConfidence: 0 }, reFill);
  }
}

async function screenshot(orgId: string, runId: string, stepId: string, s: BrowserSession) {
  const png = await s.page.screenshot({ fullPage: true, mask: [s.page.locator("input[type=password]")], maskColor: "#d9dde3" });
  const key = await putEncrypted(orgId, BLOB.artifacts, `${runId}/${stepId}.png.enc`, png);
  await withOrg(orgId, (tx) => tx.query("UPDATE run_steps SET screenshot_path=$2, finished_at=now() WHERE id=$1", [stepId, key]));
}

async function saveCheckpoint(orgId: string, runId: string, step: number, url: string) {
  await withOrg(orgId, (tx) => tx.query("UPDATE automation_runs SET current_step=$2, checkpoint = coalesce(checkpoint,'{}'::jsonb) || $3 WHERE id=$1",
    [runId, step, JSON.stringify({ url })]));
}

async function audit(orgId: string, userId: string, runId: string, domain: string) {
  await writeAudit({ orgId, actorUserId: userId, action: "run.submit", targetType: "run", targetId: runId, metadata: { domain } });
}

async function finish(orgId: string, runId: string, s: BrowserSession, profileId: string, domain: string, created: boolean, password: string, email?: string) {
  if (created) {
    await withOrg(orgId, async (tx) => tx.query(
      `INSERT INTO site_accounts (org_id, profile_id, domain, username_enc, password_enc, created_by_run)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (profile_id, domain) DO NOTHING`,
      [orgId, profileId, domain, await encryptForOrg(orgId, email ?? ""), await encryptForOrg(orgId, password), runId]));
  }
  await s.save();
  await setStatus(orgId, runId, "succeeded");
  await emit(orgId, runId, "done", created ? `Account created on ${domain}; credentials saved to the profile vault` : "Completed");
}

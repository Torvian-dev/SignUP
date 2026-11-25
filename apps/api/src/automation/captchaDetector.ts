/**
 * Detects CAPTCHA widgets on the current page and injects solved tokens.
 *
 *   reCAPTCHA v2       .g-recaptcha[data-sitekey] / iframe[src*="recaptcha/api2/anchor"]
 *   reCAPTCHA invisible  data-size="invisible" or badge without checkbox
 *   reCAPTCHA v3       script src "recaptcha/api.js?render=<sitekey>" (no widget)
 *   hCaptcha           .h-captcha[data-sitekey] / iframe[src*="hcaptcha.com"]
 *   Turnstile          .cf-turnstile[data-sitekey] / iframe[src*="challenges.cloudflare.com"]
 *   Slider             common slider-captcha containers (geetest, tencent, custom "slide to verify")
 *   Image              <img> adjacent to an input labelled captcha / "enter the characters"
 */
import type { Page } from "playwright";
import type { CaptchaChallenge, CaptchaKind } from "../services/captcha/types.js";

export interface DetectedCaptcha {
  kind: CaptchaKind;
  siteKey?: string;
  action?: string;
  enterprise?: boolean;
  dataS?: string;
  cData?: string;
  imageSelector?: string;
  inputSelector?: string;
  callback?: string;      // data-callback function name to invoke after injecting token
}

export async function detectCaptcha(page: Page): Promise<DetectedCaptcha | null> {
  const found = await page.evaluate(() => {
    const q = (s: string) => document.querySelector(s);
    // Already solved (by a provider token or by the reviewer in the live view)? Nothing to do.
    const solved = Array.from(document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
      "textarea[name='g-recaptcha-response'], textarea[name='h-captcha-response'], input[name='cf-turnstile-response']"))
      .some((el) => el.value.trim().length > 0);
    if (solved) return null;
    const attr = (el: Element | null, a: string) => el?.getAttribute(a) ?? undefined;
    const fromSrc = (sel: string, key = "k") => {
      const f = q(sel) as HTMLIFrameElement | null;
      return f ? new URL(f.src).searchParams.get(key) ?? undefined : undefined;
    };

    const ts = q(".cf-turnstile, [data-sitekey][class*=turnstile]");
    if (ts || q("iframe[src*='challenges.cloudflare.com']"))
      return { kind: "turnstile", siteKey: attr(ts, "data-sitekey"), cData: attr(ts, "data-cdata"), callback: attr(ts, "data-callback") };

    const hc = q(".h-captcha, [data-hcaptcha-widget-id]");
    if (hc || q("iframe[src*='hcaptcha.com']"))
      return { kind: "hcaptcha", siteKey: attr(hc, "data-sitekey") ?? fromSrc("iframe[src*='hcaptcha.com']", "sitekey"), callback: attr(hc, "data-callback") };

    const rc = q(".g-recaptcha, [data-sitekey]");
    const anchor = q("iframe[src*='recaptcha/api2/anchor'], iframe[src*='recaptcha/enterprise/anchor']") as HTMLIFrameElement | null;
    if (rc || anchor) {
      const invisible = attr(rc, "data-size") === "invisible" || (anchor ? new URL(anchor.src).searchParams.get("size") === "invisible" : false);
      return {
        kind: invisible ? "recaptcha_invisible" : "recaptcha_v2",
        siteKey: attr(rc, "data-sitekey") ?? fromSrc("iframe[src*='recaptcha']"),
        enterprise: !!anchor?.src.includes("enterprise"),
        dataS: attr(rc, "data-s"),
        callback: attr(rc, "data-callback"),
      };
    }

    const v3 = Array.from(document.scripts).find((s) => /recaptcha\/(api|enterprise)\.js\?.*render=([\w-]{20,})/.test(s.src));
    if (v3) {
      const m = v3.src.match(/render=([\w-]+)/);
      return { kind: "recaptcha_v3", siteKey: m?.[1], enterprise: v3.src.includes("enterprise") };
    }

    if (q(".geetest_slider, .tc-slider-normal, [class*='slider-captcha'], [class*='slide-verify'], [id*='nc_1_n1z']"))
      return { kind: "slider" };

    const capInput = Array.from(document.querySelectorAll("input")).find((i) =>
      /captcha|security code|characters.*image|verification code/i.test(
        `${i.name} ${i.id} ${i.placeholder} ${i.getAttribute("aria-label") ?? ""} ${i.closest("label, div")?.textContent ?? ""}`));
    if (capInput) {
      const img = capInput.closest("form, div")?.querySelector("img[src*='captcha' i], img[alt*='captcha' i], canvas");
      if (img) {
        img.setAttribute("data-fa-captcha-img", "1");
        capInput.setAttribute("data-fa-captcha-input", "1");
        return { kind: "image", imageSelector: "[data-fa-captcha-img]", inputSelector: "[data-fa-captcha-input]" };
      }
    }
    return null;
  });
  return found as DetectedCaptcha | null;
}

export async function toChallenge(page: Page, d: DetectedCaptcha, userAgent: string, proxy: CaptchaChallenge["proxy"]): Promise<CaptchaChallenge> {
  let imageBase64: string | undefined;
  if (d.kind === "image" && d.imageSelector) {
    imageBase64 = (await page.locator(d.imageSelector).first().screenshot()).toString("base64");
  }
  if (d.kind === "recaptcha_v3" && !d.action) {
    // Best-effort: sites usually call grecaptcha.execute(key, {action:'xyz'}) from inline scripts.
    d.action = await page.evaluate(() => {
      const m = Array.from(document.scripts).map((s) => s.textContent ?? "").join("\n").match(/action\s*:\s*['"]([\w/]+)['"]/);
      return m?.[1];
    });
  }
  return { kind: d.kind, pageUrl: page.url(), siteKey: d.siteKey, action: d.action, enterprise: d.enterprise, dataS: d.dataS,
           cData: d.cData, imageBase64, userAgent, proxy };
}

/** Put the solved token where the site's own JS expects it, then fire the widget callback. */
export async function injectSolution(page: Page, d: DetectedCaptcha, token?: string, text?: string) {
  if (d.kind === "image" && text && d.inputSelector) {
    await page.locator(d.inputSelector).fill(text);
    return;
  }
  if (!token) return;
  await page.evaluate(({ kind, token, callback }) => {
    const setAll = (sel: string) => document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(sel).forEach((el) => {
      el.value = token;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if (kind.startsWith("recaptcha")) {
      setAll("textarea[name='g-recaptcha-response'], #g-recaptcha-response");
    } else if (kind === "hcaptcha") {
      setAll("textarea[name='h-captcha-response'], textarea[name='g-recaptcha-response']");
    } else if (kind === "turnstile") {
      setAll("input[name='cf-turnstile-response']");
    }
    const fn = callback ? (window as any)[callback] : undefined;
    if (typeof fn === "function") fn(token);
  }, { kind: d.kind, token, callback: d.callback });
}

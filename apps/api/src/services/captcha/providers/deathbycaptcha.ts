/**
 * DeathByCaptcha HTTP API (api.dbcapi.me). Token CAPTCHAs use numeric `type` + JSON params:
 *   4 = reCAPTCHA v2 (token), 5 = reCAPTCHA v3, 7 = hCaptcha, 12 = Cloudflare Turnstile.
 * Verify type ids against the current DBC API reference before go-live.
 */
import {
  CaptchaProviderError, sleep,
  type CaptchaChallenge, type CaptchaKind, type CaptchaProvider, type CaptchaSolution,
} from "../types.js";

const BASE = "http://api.dbcapi.me/api";

export class DeathByCaptchaProvider implements CaptchaProvider {
  readonly name = "deathbycaptcha";
  constructor(private username: string, private password: string) {}

  supports(kind: CaptchaKind) {
    return ["recaptcha_v2", "recaptcha_invisible", "recaptcha_v3", "hcaptcha", "turnstile", "image"].includes(kind);
  }

  private form(ch: CaptchaChallenge): URLSearchParams {
    const f = new URLSearchParams({ username: this.username, password: this.password });
    const proxy = ch.proxy ? { proxy: `http://${ch.proxy.username ? `${ch.proxy.username}:${ch.proxy.password}@` : ""}${ch.proxy.host}:${ch.proxy.port}`, proxytype: "HTTP" } : {};
    switch (ch.kind) {
      case "recaptcha_v2":
      case "recaptcha_invisible":
        f.set("type", "4"); f.set("token_params", JSON.stringify({ googlekey: ch.siteKey, pageurl: ch.pageUrl, ...proxy })); break;
      case "recaptcha_v3":
        f.set("type", "5"); f.set("token_params", JSON.stringify({ googlekey: ch.siteKey, pageurl: ch.pageUrl, action: ch.action ?? "verify", min_score: ch.minScore ?? 0.3 })); break;
      case "hcaptcha":
        f.set("type", "7"); f.set("hcaptcha_params", JSON.stringify({ sitekey: ch.siteKey, pageurl: ch.pageUrl, ...proxy })); break;
      case "turnstile":
        f.set("type", "12"); f.set("turnstile_params", JSON.stringify({ sitekey: ch.siteKey, pageurl: ch.pageUrl, ...proxy })); break;
      case "image":
        f.set("captchafile", `base64:${ch.imageBase64}`); break;
      default:
        throw new CaptchaProviderError(this.name, "UNSUPPORTED", ch.kind, false);
    }
    return f;
  }

  async solve(ch: CaptchaChallenge, signal: AbortSignal): Promise<CaptchaSolution> {
    const res = await fetch(`${BASE}/captcha`, { method: "POST", body: this.form(ch), headers: { accept: "application/json" }, signal });
    if (res.status === 403) throw new CaptchaProviderError(this.name, "AUTH", "invalid credentials or no balance", false);
    if (!res.ok) throw new CaptchaProviderError(this.name, `HTTP_${res.status}`, await res.text());
    const { captcha } = (await res.json()) as { captcha: number };
    await sleep(ch.kind === "image" ? 3000 : 15_000, signal);
    for (;;) {
      const p = (await (await fetch(`${BASE}/captcha/${captcha}`, { headers: { accept: "application/json" }, signal })).json()) as
        { text?: string; is_correct?: boolean };
      if (p.is_correct === false) throw new CaptchaProviderError(this.name, "UNSOLVABLE", "captcha marked unsolvable");
      if (p.text) {
        const isToken = ch.kind !== "image";
        return { token: isToken ? p.text : undefined, text: isToken ? undefined : p.text, costUsd: isToken ? 0.00289 : 0.00139, providerTaskId: String(captcha) };
      }
      await sleep(5000, signal);
    }
  }

  async reportBad(taskId: string) {
    await fetch(`${BASE}/captcha/${taskId}/report`, { method: "POST", body: new URLSearchParams({ username: this.username, password: this.password }) }).catch(() => undefined);
  }

  async balance() {
    const r = await fetch(`${BASE}/user`, { method: "POST", body: new URLSearchParams({ username: this.username, password: this.password }), headers: { accept: "application/json" } });
    const j = (await r.json()) as { balance?: number };
    return (j.balance ?? 0) / 100; // DBC reports US cents
  }
}

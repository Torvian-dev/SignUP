/**
 * BestCaptchaSolver REST API (bcsapi.xyz). Submit → poll by id.
 * Endpoint names follow the provider's public API reference; verify before go-live.
 */
import {
  CaptchaProviderError, sleep,
  type CaptchaChallenge, type CaptchaKind, type CaptchaProvider, type CaptchaSolution,
} from "../types.js";

const BASE = "https://bcsapi.xyz/api";

export class BestCaptchaSolverProvider implements CaptchaProvider {
  readonly name = "bestcaptchasolver";
  constructor(private accessToken: string) {}

  supports(kind: CaptchaKind) {
    return ["recaptcha_v2", "recaptcha_invisible", "recaptcha_v3", "hcaptcha", "turnstile", "image"].includes(kind);
  }

  private request(ch: CaptchaChallenge): { path: string; body: Record<string, unknown> } {
    const proxy = ch.proxy ? { proxy: `${ch.proxy.username ? `${ch.proxy.username}:${ch.proxy.password}@` : ""}${ch.proxy.host}:${ch.proxy.port}`, proxy_type: "HTTP" } : {};
    switch (ch.kind) {
      case "recaptcha_v2":
      case "recaptcha_invisible":
        return { path: "captcha/recaptcha", body: { page_url: ch.pageUrl, site_key: ch.siteKey, type: ch.kind === "recaptcha_invisible" ? 2 : 1, data_s: ch.dataS, user_agent: ch.userAgent, ...proxy } };
      case "recaptcha_v3":
        return { path: "captcha/recaptcha", body: { page_url: ch.pageUrl, site_key: ch.siteKey, type: 3, v3_action: ch.action ?? "verify", v3_min_score: ch.minScore ?? 0.3 } };
      case "hcaptcha":
        return { path: "captcha/hcaptcha", body: { page_url: ch.pageUrl, site_key: ch.siteKey, user_agent: ch.userAgent, ...proxy } };
      case "turnstile":
        return { path: "captcha/turnstile", body: { page_url: ch.pageUrl, site_key: ch.siteKey, data: ch.cData, user_agent: ch.userAgent, ...proxy } };
      case "image":
        return { path: "captcha/image", body: { b64image: ch.imageBase64 } };
      default:
        throw new CaptchaProviderError(this.name, "UNSUPPORTED", ch.kind, false);
    }
  }

  async solve(ch: CaptchaChallenge, signal: AbortSignal): Promise<CaptchaSolution> {
    const { path, body } = this.request(ch);
    const res = await fetch(`${BASE}/${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_token: this.accessToken, ...body }), signal,
    });
    const sub = (await res.json()) as { id?: number; status?: string; error?: string; text?: string };
    if (sub.error) throw new CaptchaProviderError(this.name, "SUBMIT", sub.error, !/token|balance/i.test(sub.error));
    if (ch.kind === "image" && sub.text) return { text: sub.text, costUsd: 0.0008, providerTaskId: String(sub.id) };
    await sleep(ch.kind === "image" ? 3000 : 12_000, signal);
    for (;;) {
      const r = (await (await fetch(`${BASE}/captcha/${sub.id}?access_token=${encodeURIComponent(this.accessToken)}`, { signal })).json()) as
        { status: string; gresponse?: string; solution?: string; text?: string; error?: string };
      if (r.error) throw new CaptchaProviderError(this.name, "POLL", r.error);
      if (r.status === "completed") {
        return { token: r.gresponse ?? r.solution, text: r.text, costUsd: ch.kind === "image" ? 0.0008 : 0.0026, providerTaskId: String(sub.id) };
      }
      await sleep(5000, signal);
    }
  }

  async reportBad(taskId: string) {
    await fetch(`${BASE}/captcha/bad/${taskId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ access_token: this.accessToken }) }).catch(() => undefined);
  }

  async balance() {
    const r = (await (await fetch(`${BASE}/user/balance?access_token=${encodeURIComponent(this.accessToken)}`)).json()) as { balance?: string };
    return Number(r.balance ?? 0);
  }
}

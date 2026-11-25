/**
 * 2Captcha (api.2captcha.com v2), Anti-Captcha and CapMonster Cloud all implement the same
 * createTask / getTaskResult JSON protocol, so one adapter serves all three — plus any other
 * "Anti-Captcha-compatible" service via provider "compatible" with a custom base URL.
 */
import {
  CaptchaProviderError, sleep,
  type CaptchaChallenge, type CaptchaKind, type CaptchaProvider, type CaptchaSolution,
} from "../types.js";

const ENDPOINTS = {
  "2captcha": "https://api.2captcha.com",
  anticaptcha: "https://api.anti-captcha.com",
  capmonster: "https://api.capmonster.cloud",
} as const;

// Fallback price table (USD per solve) when the provider doesn't return cost.
const PRICE: Partial<Record<CaptchaKind, number>> = {
  recaptcha_v2: 0.0029, recaptcha_invisible: 0.0029, recaptcha_v3: 0.0029, hcaptcha: 0.0029, turnstile: 0.0015, image: 0.0007,
};

export class CreateTaskProvider implements CaptchaProvider {
  private base: string;
  constructor(readonly name: string, private apiKey: string, baseUrl?: string) {
    const b = baseUrl ?? ENDPOINTS[name as keyof typeof ENDPOINTS];
    if (!b) throw new Error(`no endpoint for captcha provider ${name}`);
    if (!b.startsWith("https://")) throw new Error("captcha provider base URL must be https");
    this.base = b.replace(/\/$/, "");
  }

  supports(kind: CaptchaKind) {
    return kind !== "slider";
  }

  private task(ch: CaptchaChallenge): Record<string, unknown> {
    const withProxy = !!ch.proxy;
    const proxy = ch.proxy
      ? { proxyType: ch.proxy.type === "socks5" ? "socks5" : "http", proxyAddress: ch.proxy.host, proxyPort: ch.proxy.port,
          proxyLogin: ch.proxy.username, proxyPassword: ch.proxy.password, userAgent: ch.userAgent }
      : {};
    const suffix = withProxy ? "" : "Proxyless";
    switch (ch.kind) {
      case "recaptcha_v2":
      case "recaptcha_invisible":
        return { type: ch.enterprise ? `RecaptchaV2EnterpriseTask${suffix}` : `RecaptchaV2Task${suffix}`,
                 websiteURL: ch.pageUrl, websiteKey: ch.siteKey, isInvisible: ch.kind === "recaptcha_invisible",
                 recaptchaDataSValue: ch.dataS, ...proxy };
      case "recaptcha_v3":
        // v3 is score-based; solvers only offer proxyless.
        return { type: "RecaptchaV3TaskProxyless", websiteURL: ch.pageUrl, websiteKey: ch.siteKey,
                 minScore: ch.minScore ?? 0.7, pageAction: ch.action ?? "verify", isEnterprise: !!ch.enterprise };
      case "hcaptcha":
        return { type: `HCaptchaTask${suffix}`, websiteURL: ch.pageUrl, websiteKey: ch.siteKey, ...proxy };
      case "turnstile":
        return { type: `TurnstileTask${suffix}`, websiteURL: ch.pageUrl, websiteKey: ch.siteKey, data: ch.cData, ...proxy };
      case "image":
        return { type: "ImageToTextTask", body: ch.imageBase64 };
      default:
        throw new CaptchaProviderError(this.name, "UNSUPPORTED", ch.kind, false);
    }
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T & { errorId: number; errorCode?: string; errorDescription?: string }> {
    const res = await fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientKey: this.apiKey, ...body }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new CaptchaProviderError(this.name, `HTTP_${res.status}`, await res.text());
    const json = (await res.json()) as T & { errorId: number; errorCode?: string; errorDescription?: string };
    if (json.errorId) {
      const fatal = ["ERROR_KEY_DOES_NOT_EXIST", "ERROR_ZERO_BALANCE", "ERROR_IP_NOT_ALLOWED", "ERROR_ACCOUNT_SUSPENDED"];
      throw new CaptchaProviderError(this.name, json.errorCode ?? "ERROR", json.errorDescription ?? "", !fatal.includes(json.errorCode ?? ""));
    }
    return json;
  }

  async solve(ch: CaptchaChallenge, signal: AbortSignal): Promise<CaptchaSolution> {
    const { taskId } = await this.call<{ taskId: number }>("createTask", { task: this.task(ch), softId: undefined });
    await sleep(ch.kind === "image" ? 3000 : 12_000, signal); // providers recommend a first poll delay
    for (;;) {
      const r = await this.call<{ status: string; solution?: Record<string, string>; cost?: string }>("getTaskResult", { taskId });
      if (r.status === "ready") {
        const s = r.solution ?? {};
        return {
          token: s.gRecaptchaResponse ?? s.token,
          text: s.text,
          userAgent: s.userAgent,
          costUsd: r.cost ? Number(r.cost) : PRICE[ch.kind] ?? 0,
          providerTaskId: String(taskId),
        };
      }
      await sleep(ch.kind === "image" ? 2000 : 5000, signal);
    }
  }

  async reportBad(taskId: string) {
    // Token-captcha report methods per provider (refund + quality signal). Verify names against provider docs.
    const methods: Record<string, string> = { "2captcha": "reportIncorrect", anticaptcha: "reportIncorrectRecaptcha", capmonster: "reportIncorrectTokenCaptcha" };
    const method = methods[this.name];
    if (!method) return;
    await this.call(method, { taskId: Number(taskId) }).catch(() => undefined);
  }

  async balance() {
    return (await this.call<{ balance: number }>("getBalance", {})).balance;
  }
}

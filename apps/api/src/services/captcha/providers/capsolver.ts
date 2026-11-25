/**
 * CapSolver (api.capsolver.com). Same createTask/getTaskResult envelope as Anti-Captcha, but:
 *  - task type names use "ProxyLess" casing and Turnstile is "AntiTurnstileTask…",
 *  - proxies are passed as one string "scheme:host:port:user:pass",
 *  - ImageToTextTask is synchronous (solution returned by createTask).
 * Verify task type names against the CapSolver docs before go-live; they change occasionally.
 */
import {
  CaptchaProviderError, sleep,
  type CaptchaChallenge, type CaptchaKind, type CaptchaProvider, type CaptchaSolution,
} from "../types.js";

const BASE = "https://api.capsolver.com";
const PRICE: Partial<Record<CaptchaKind, number>> = {
  recaptcha_v2: 0.0008, recaptcha_invisible: 0.0008, recaptcha_v3: 0.001, turnstile: 0.0012, image: 0.0004,
};

export class CapSolverProvider implements CaptchaProvider {
  readonly name = "capsolver";
  constructor(private apiKey: string) {}

  supports(kind: CaptchaKind) {
    return ["recaptcha_v2", "recaptcha_invisible", "recaptcha_v3", "turnstile", "image"].includes(kind);
  }

  private task(ch: CaptchaChallenge): Record<string, unknown> {
    const proxy = ch.proxy
      ? `${ch.proxy.type === "socks5" ? "socks5" : "http"}:${ch.proxy.host}:${ch.proxy.port}${ch.proxy.username ? `:${ch.proxy.username}:${ch.proxy.password ?? ""}` : ""}`
      : undefined;
    const t = (base: string) => (proxy ? { type: base, proxy } : { type: `${base}ProxyLess` });
    switch (ch.kind) {
      case "recaptcha_v2":
      case "recaptcha_invisible":
        return { ...t(ch.enterprise ? "ReCaptchaV2EnterpriseTask" : "ReCaptchaV2Task"), websiteURL: ch.pageUrl, websiteKey: ch.siteKey,
                 isInvisible: ch.kind === "recaptcha_invisible", userAgent: ch.userAgent };
      case "recaptcha_v3":
        return { ...t(ch.enterprise ? "ReCaptchaV3EnterpriseTask" : "ReCaptchaV3Task"), websiteURL: ch.pageUrl, websiteKey: ch.siteKey,
                 pageAction: ch.action ?? "verify" };
      case "turnstile":
        return { type: "AntiTurnstileTaskProxyLess", websiteURL: ch.pageUrl, websiteKey: ch.siteKey, metadata: ch.cData ? { cdata: ch.cData } : undefined };
      case "image":
        return { type: "ImageToTextTask", body: ch.imageBase64 };
      default:
        throw new CaptchaProviderError(this.name, "UNSUPPORTED", ch.kind, false);
    }
  }

  private async call<T>(method: string, body: Record<string, unknown>) {
    const res = await fetch(`${BASE}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientKey: this.apiKey, ...body }), signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new CaptchaProviderError(this.name, `HTTP_${res.status}`, await res.text());
    const j = (await res.json()) as T & { errorId: number; errorCode?: string; errorDescription?: string };
    if (j.errorId) {
      const fatal = ["ERROR_KEY_DENIED_ACCESS", "ERROR_ZERO_BALANCE", "ERROR_INVALID_TASK_DATA"];
      throw new CaptchaProviderError(this.name, j.errorCode ?? "ERROR", j.errorDescription ?? "", !fatal.includes(j.errorCode ?? ""));
    }
    return j;
  }

  async solve(ch: CaptchaChallenge, signal: AbortSignal): Promise<CaptchaSolution> {
    type R = { taskId?: string; status?: string; solution?: Record<string, string> };
    const created = await this.call<R>("createTask", { task: this.task(ch) });
    const done = (r: R): CaptchaSolution => ({
      token: r.solution?.gRecaptchaResponse ?? r.solution?.token,
      text: r.solution?.text,
      userAgent: r.solution?.userAgent,
      costUsd: PRICE[ch.kind] ?? 0,
      providerTaskId: created.taskId ?? "sync",
    });
    if (created.status === "ready") return done(created); // synchronous tasks (image)
    await sleep(3000, signal);
    for (;;) {
      const r = await this.call<R>("getTaskResult", { taskId: created.taskId });
      if (r.status === "ready") return done(r);
      if (r.status === "failed") throw new CaptchaProviderError(this.name, "FAILED", "task failed");
      await sleep(3000, signal);
    }
  }

  async reportBad(taskId: string) {
    await this.call("feedbackTask", { taskId, result: { invalid: true } }).catch(() => undefined);
  }

  async balance() {
    return (await this.call<{ balance: number }>("getBalance", {})).balance;
  }
}

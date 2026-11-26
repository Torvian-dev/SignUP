/**
 * Resolvr (https://resolvr.com/docs) — its own async REST API, not the Anti-Captcha protocol.
 *
 *   Auth:    Authorization: Bearer <API_KEY>
 *   Submit:  POST /v1/task        -> 202 { task_id, status: "queued" }
 *   Result:  GET  /v1/task/{id}   -> long-polls ~5s; { status, data: { token, headers, ... } }
 *   Balance: GET  /v1/balance     -> { balance, currency }
 *
 * Body is snake_case: { type, sitekey, url, proxy, data:{action}, user_agent }. A proxy is required for
 * every browser task (botdeflector_image is a recognition task and takes none). Types: recaptcha_v2,
 * recaptcha_v3, cloudflare_turnstile, mtcaptcha, botdeflector_image — no hCaptcha.
 */
import {
  CaptchaProviderError, type CaptchaChallenge, type CaptchaKind, type CaptchaProvider, type CaptchaSolution,
} from "../types.js";

const DEFAULT_BASE = "https://api.resolvr.com";
// Fallback USD/solve for our dashboard only — Resolvr bills your account; a returned cost wins.
const PRICE: Partial<Record<CaptchaKind, number>> = {
  recaptcha_v2: 0.002, recaptcha_invisible: 0.002, recaptcha_v3: 0.002, turnstile: 0.002, image: 0.001,
};

function proxyUrl(p?: CaptchaChallenge["proxy"]): string | undefined {
  if (!p) return undefined;
  const scheme = p.type === "socks5" ? "socks5" : "http";
  const auth = p.username ? `${p.username}:${p.password ?? ""}@` : "";
  return `${scheme}://${auth}${p.host}:${p.port}`;
}

/** Build the POST /v1/task body for a challenge (exported for testing). */
export function resolvrTaskBody(ch: CaptchaChallenge): Record<string, unknown> {
  const common = { url: ch.pageUrl, proxy: proxyUrl(ch.proxy), user_agent: ch.userAgent };
  switch (ch.kind) {
    case "recaptcha_v2":
    case "recaptcha_invisible":
      return { type: "recaptcha_v2", sitekey: ch.siteKey, ...common };
    case "recaptcha_v3":
      return { type: "recaptcha_v3", sitekey: ch.siteKey, data: { action: ch.action ?? "verify" }, ...common };
    case "turnstile":
      return { type: "cloudflare_turnstile", sitekey: ch.siteKey, ...common };
    case "image":
      return { type: "botdeflector_image", image: ch.imageBase64 };
    default:
      throw new CaptchaProviderError("resolvr", "UNSUPPORTED", ch.kind, false);
  }
}

export class ResolvrProvider implements CaptchaProvider {
  readonly name = "resolvr";
  private base: string;
  constructor(private apiKey: string, baseUrl?: string) {
    this.base = (baseUrl?.trim() || DEFAULT_BASE).replace(/\/$/, "");
    if (!this.base.startsWith("https://")) throw new Error("resolvr base URL must be https");
  }

  supports(kind: CaptchaKind) {
    return ["recaptcha_v2", "recaptcha_invisible", "recaptcha_v3", "turnstile", "image"].includes(kind);
  }

  private async req(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      method, signal,
      headers: { authorization: `Bearer ${this.apiKey}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!res.ok) {
      // 401 bad key, 402 insufficient balance, 403 type/IP not allowed → not retryable (try next provider).
      const fatal = [401, 402, 403].includes(res.status);
      throw new CaptchaProviderError(this.name, String(json.error ?? json.code ?? `HTTP_${res.status}`), json.message ?? "", !fatal);
    }
    return json;
  }

  async solve(ch: CaptchaChallenge, signal: AbortSignal): Promise<CaptchaSolution> {
    const created = await this.req("POST", "/v1/task", resolvrTaskBody(ch), signal);
    const id = created.task_id;
    if (!id) throw new CaptchaProviderError(this.name, "NO_TASK_ID", JSON.stringify(created).slice(0, 200));
    // GET long-polls server-side (~5s); the docs say not to sleep between calls. The router's
    // AbortSignal (solve timeout) bounds the loop.
    for (;;) {
      if (signal.aborted) throw new CaptchaProviderError(this.name, "ABORTED", "", false);
      const r = await this.req("GET", `/v1/task/${id}`, undefined, signal);
      if (r.status === "completed") {
        const token: string | undefined = r.data?.token;
        return {
          token: ch.kind === "image" ? undefined : token,
          text: ch.kind === "image" ? (r.data?.text ?? token) : undefined,
          userAgent: r.data?.user_agent ?? r.data?.headers?.["User-Agent"],
          costUsd: Number(r.data?.cost ?? PRICE[ch.kind] ?? 0),
          providerTaskId: String(id),
        };
      }
      if (r.status === "failed") throw new CaptchaProviderError(this.name, String(r.data?.error ?? "FAILED"), r.data?.message ?? "task failed");
      // "queued" | "processing" → call again immediately (the wait already happened server-side)
    }
  }

  async balance(): Promise<number> {
    return Number((await this.req("GET", "/v1/balance")).balance ?? 0);
  }
}

/**
 * DispurCaptcha (https://dispurcaptcha.com/docs) — its own synchronous REST API.
 *
 *   Auth:    header  X-API-Key: dpc_...
 *   Solve:   POST /api/v1/recaptcha   (reCAPTCHA v3)   -> { status, data: { gResponseToken, header:{userAgent,...} } }
 *            POST /api/v1/turnstile   (Cloudflare)     -> { status, data: { token, userAgent, secChUa } }
 *   Balance: GET  /api/v1/balance                      -> { status, data: { balanceEur, products[] } }
 *   Envelope: {"status":"success",...} or {"status":"error","message":"..."}.
 *
 * ONE request = one solve; never poll (retry only on 503/network). Proxy is REQUIRED and must carry
 * auth: USER:PASS@HOST:PORT (http:// added if omitted). Covers reCAPTCHA v3 and Turnstile only —
 * no reCAPTCHA v2 checkbox, no hCaptcha (use CapSolver for those).
 *
 * Fit note: Turnstile tokens work with any User-Agent (we pass the profile's own UA), so they drop
 * cleanly into our live browser. reCAPTCHA v3 tokens are bound to the solver's UA; v3 is score-based
 * and injecting it into a live browser is inherently less reliable — CapSolver is the better default.
 */
import {
  CaptchaProviderError, type CaptchaChallenge, type CaptchaKind, type CaptchaProvider, type CaptchaSolution,
} from "../types.js";

const DEFAULT_BASE = "https://api.dispurcaptcha.com";
// Fallback USD/solve for our dashboard (DispurCaptcha bills in EUR: Turnstile 0.99€, reCAPTCHA v3 5€ per 1000).
const PRICE: Partial<Record<CaptchaKind, number>> = { turnstile: 0.0011, recaptcha_v3: 0.0055 };

function proxyString(p?: CaptchaChallenge["proxy"]): string | undefined {
  if (!p || !p.username) return undefined; // DispurCaptcha requires an authenticated proxy (user:pass@host:port)
  const auth = `${p.username}:${p.password ?? ""}@${p.host}:${p.port}`;
  return p.type === "socks5" ? `socks5://${auth}` : auth;
}

export class DispurCaptchaProvider implements CaptchaProvider {
  readonly name = "dispurcaptcha";
  private base: string;
  constructor(private apiKey: string, baseUrl?: string) {
    this.base = (baseUrl?.trim() || DEFAULT_BASE).replace(/\/$/, "");
    if (!this.base.startsWith("https://")) throw new Error("dispurcaptcha base URL must be https");
  }

  supports(kind: CaptchaKind) {
    return kind === "recaptcha_v3" || kind === "turnstile";
  }

  private async post(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST", signal,
      headers: { "x-api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text }; }
    if (!res.ok || json.status === "error") {
      // 401 bad key, 402 balance, 400 bad params → fatal; 503/5xx/network → retryable.
      const fatal = [400, 401, 402, 403].includes(res.status);
      throw new CaptchaProviderError(this.name, `HTTP_${res.status}`, json.message ?? "solve failed", !fatal);
    }
    return json.data ?? {};
  }

  async solve(ch: CaptchaChallenge, signal: AbortSignal): Promise<CaptchaSolution> {
    const proxy = proxyString(ch.proxy);
    if (!proxy) throw new CaptchaProviderError(this.name, "PROXY_REQUIRED", "DispurCaptcha needs an authenticated proxy on the profile", false);

    if (ch.kind === "turnstile") {
      const data = await this.post("/api/v1/turnstile", {
        pageUrl: ch.pageUrl, siteKey: ch.siteKey, proxy,
        widgetAction: ch.action || undefined, extraData: ch.cData || undefined,
        userAgent: ch.userAgent, // Turnstile tokens work with any UA → use our browser's own UA
      }, signal);
      return { token: data.token, userAgent: data.userAgent, costUsd: PRICE.turnstile ?? 0, providerTaskId: "sync" };
    }
    if (ch.kind === "recaptcha_v3") {
      const data = await this.post("/api/v1/recaptcha", {
        websiteUrl: ch.pageUrl, recaptchaSitekey: ch.siteKey, proxy,
        action: ch.action || undefined, isEnterprise: !!ch.enterprise,
      }, signal);
      return { token: data.gResponseToken, userAgent: data.header?.userAgent, costUsd: PRICE.recaptcha_v3 ?? 0, providerTaskId: "sync" };
    }
    throw new CaptchaProviderError(this.name, "UNSUPPORTED", ch.kind, false);
  }

  async balance(): Promise<number> {
    const res = await fetch(`${this.base}/api/v1/balance`, { headers: { "x-api-key": this.apiKey } });
    if (!res.ok) throw new CaptchaProviderError(this.name, `HTTP_${res.status}`, await res.text(), res.status >= 500);
    const json = (await res.json()) as { data?: { balanceEur?: number } };
    return Number(json.data?.balanceEur ?? 0); // reported in EUR
  }
}

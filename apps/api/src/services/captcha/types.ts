export type CaptchaKind =
  | "recaptcha_v2" | "recaptcha_v3" | "recaptcha_invisible" | "hcaptcha" | "turnstile" | "slider" | "image";

export interface CaptchaChallenge {
  kind: CaptchaKind;
  pageUrl: string;
  siteKey?: string;          // reCAPTCHA / hCaptcha / Turnstile
  action?: string;           // reCAPTCHA v3 action
  minScore?: number;         // reCAPTCHA v3
  enterprise?: boolean;
  dataS?: string;            // reCAPTCHA data-s (Google properties)
  cData?: string;            // Turnstile cData
  imageBase64?: string;      // image CAPTCHA
  userAgent?: string;
  /** The profile's own proxy — solver workers solve through the same IP the browser uses. */
  proxy?: { type: string; host: string; port: number; username?: string; password?: string };
}

export interface CaptchaSolution {
  token?: string;            // reCAPTCHA / hCaptcha / Turnstile token
  text?: string;             // image CAPTCHA answer
  userAgent?: string;        // some solvers return the UA used (hCaptcha) — must match on submit
  costUsd: number;
  providerTaskId: string;
}

export interface CaptchaProvider {
  readonly name: string;
  supports(kind: CaptchaKind): boolean;
  solve(ch: CaptchaChallenge, signal: AbortSignal): Promise<CaptchaSolution>;
  /** Report a token the target site rejected (refund + provider quality stats). */
  reportBad?(taskId: string): Promise<void>;
  balance(): Promise<number>;
}

export class CaptchaProviderError extends Error {
  constructor(public provider: string, public code: string, message: string, public retryable = true) {
    super(`${provider}: ${code} ${message}`);
  }
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
  });

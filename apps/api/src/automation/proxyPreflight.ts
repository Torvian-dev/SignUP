/**
 * Proxy preflight: before filling anything, confirm the profile's proxy is alive and that its exit
 * country matches where the profile claims to be. A UK profile exiting from a German IP is an easy
 * correlation flag; a dead proxy means every field would egress from the wrong place (or fail).
 *
 * The request goes through the browser context, so it uses the profile's proxy — exactly the path
 * the real form fill will take.
 */
import type { BrowserContext } from "playwright";

const GEO_URL = "https://ipwho.is/";

export interface Preflight {
  reachable: boolean;
  ip?: string;
  country?: string;      // ISO-3166 alpha-2
  mismatch?: boolean;    // exit country differs from the profile's expected country
}

export async function preflightProxy(context: BrowserContext, expectedCountry?: string): Promise<Preflight> {
  try {
    const resp = await context.request.get(GEO_URL, { timeout: 15_000 });
    if (!resp.ok()) return { reachable: false };
    const body = (await resp.json()) as { success?: boolean; ip?: string; country_code?: string };
    if (body.success === false || !body.ip) return { reachable: false };
    const country = (body.country_code || "").toUpperCase();
    const want = (expectedCountry || "").toUpperCase();
    return { reachable: true, ip: body.ip, country, mismatch: !!want && !!country && want !== country };
  } catch {
    return { reachable: false };
  }
}

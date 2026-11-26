/**
 * Identity self-test: open a real browser session for a profile exactly as a run would, and report
 * what a detection script sees — so an operator can confirm a profile is clean (automation flag off,
 * fingerprint coherent, no WebRTC IP leak, proxy alive and in the right country) BEFORE spending
 * accounts on it.
 */
import { openSession } from "../../automation/browserSession.js";
import { preflightProxy } from "../../automation/proxyPreflight.js";
import { getDecryptedProfile } from "../profiles/profileService.js";

export type CheckStatus = "pass" | "warn" | "fail" | "info";
export interface Check { id: string; label: string; status: CheckStatus; detail: string }
export interface IdentityReport { profileId: string; generatedAt: string; checks: Check[] }

export async function runIdentityCheck(orgId: string, profileId: string): Promise<IdentityReport> {
  const profile = await getDecryptedProfile(orgId, profileId);
  const session = await openSession(profile);
  const checks: Check[] = [];
  const push = (id: string, label: string, status: CheckStatus, detail: string) => checks.push({ id, label, status, detail });

  try {
    const { page } = session;
    await page.goto("about:blank");

    // In-page probe of the surfaces detection scripts read.
    const p = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl") as WebGLRenderingContext | null;
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      return {
        webdriver: (navigator as any).webdriver,
        hasChrome: !!(window as any).chrome,
        plugins: navigator.plugins.length,
        platform: navigator.platform,
        languages: navigator.languages,
        cores: navigator.hardwareConcurrency,
        memory: (navigator as any).deviceMemory,
        screen: screen.width + "×" + screen.height,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        uaPlatform: (navigator as any).userAgentData?.platform,
        webglVendor: ext ? (gl!.getParameter((ext as any).UNMASKED_VENDOR_WEBGL) as string) : null,
        webglRenderer: ext ? (gl!.getParameter((ext as any).UNMASKED_RENDERER_WEBGL) as string) : null,
        ua: navigator.userAgent,
      };
    });

    push("webdriver", "Automation flag (navigator.webdriver)", p.webdriver === false ? "pass" : "fail",
      p.webdriver === false ? "off — reports false, like a real browser" : `exposed as ${p.webdriver}`);
    push("chrome", "window.chrome present", p.hasChrome ? "pass" : "warn", p.hasChrome ? "present" : "missing (headless tell)");
    push("plugins", "Browser plugins", p.plugins > 0 ? "pass" : "warn", `${p.plugins} plugin(s)`);
    push("ua", "User-Agent", "info", p.ua);
    push("webgl", "GPU (WebGL)", p.webglRenderer ? "pass" : "warn", `${p.webglVendor ?? "?"} — ${p.webglRenderer ?? "unavailable"}`);
    push("platform", "Platform / cores / memory", "info", `${p.platform} · ${p.cores} cores · ${p.memory}GB`);
    push("screen", "Screen", "info", p.screen);
    push("languages", "Languages", "info", p.languages.join(", "));

    const tzWant = profile.timezone;
    push("timezone", "Timezone", tzWant && p.timezone === tzWant ? "pass" : tzWant ? "warn" : "info",
      tzWant ? (p.timezone === tzWant ? p.timezone : `${p.timezone} (profile set to ${tzWant})`) : p.timezone);

    // WebRTC leak test — gather ICE candidates and see if any private/LAN address escapes the filter.
    const leak = await page.evaluate(() => new Promise<string[]>((resolve) => {
      const found = new Set<string>();
      let pc: RTCPeerConnection;
      try { pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }); }
      catch { return resolve([]); }
      const priv = /(\b10\.)|(\b127\.)|(\b192\.168\.)|(\b169\.254\.)|(\b172\.(1[6-9]|2\d|3[01])\.)|\.local\b/i;
      pc.onicecandidate = (e) => { const c = e.candidate?.candidate; if (c && priv.test(c)) found.add(c); };
      try { pc.createDataChannel("x"); pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {}); } catch {}
      setTimeout(() => { try { pc.close(); } catch {} resolve([...found]); }, 2500);
    }));
    push("webrtc", "WebRTC IP leak", leak.length === 0 ? "pass" : "fail",
      leak.length === 0 ? "no private/LAN address leaked" : `leaked ${leak.length} local candidate(s)`);

    // Proxy preflight (only if the profile has a proxy).
    if (profile.proxy) {
      const pf = await preflightProxy(session.context, profile.addresses.primary?.countryCode);
      if (!pf.reachable) push("proxy", "Proxy", "fail", "did not respond");
      else if (pf.mismatch) push("proxy", "Proxy exit country", "warn", `exits ${pf.country}, profile set to ${profile.addresses.primary?.countryCode} (IP ${pf.ip})`);
      else push("proxy", "Proxy", "pass", `alive · exit ${pf.country ?? "?"} · ${pf.ip}`);
    } else {
      push("proxy", "Proxy", "warn", "no proxy on this profile — traffic exits from the host IP");
    }

    return { profileId, generatedAt: new Date().toISOString(), checks };
  } finally {
    await session.close();
  }
}

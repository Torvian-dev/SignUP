/**
 * Per-profile browser fingerprint — deterministic, stable, and distinct between profiles.
 *
 * Everything is derived from a hash of the profile id, so a profile ALWAYS gets the same
 * device (a real employee's browser doesn't change day to day), but two profiles get
 * different OS / GPU / screen / cores. Combined with the one-proxy-per-profile exit IP and
 * the isolated cookie jar, each profile looks like a different person on a different machine.
 *
 * The Chrome *version* in the UA is filled in from the live engine at launch (buildUserAgent),
 * NOT varied here — spoofing a version the engine doesn't match would contradict the
 * Sec-CH-UA client-hint headers Chromium sends and is an easy tell. We decorrelate on the
 * other axes instead.
 */
import { createHash } from "node:crypto";

/** Bump when the generator changes so existing profiles are regenerated on next run. */
export const FP_VERSION = 1;

export interface Fingerprint {
  osToken: string;            // the "(...)" platform token inside the UA string
  platform: string;           // navigator.platform
  uaPlatform: string;         // navigator.userAgentData.platform
  viewport: { width: number; height: number };
  screen: { width: number; height: number; availWidth: number; availHeight: number };
  deviceScaleFactor: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  webglVendor: string;        // UNMASKED_VENDOR_WEBGL
  webglRenderer: string;      // UNMASKED_RENDERER_WEBGL
  canvasSeed: number;         // 1..255, drives the per-profile canvas/audio noise
  languages: string[];
}

interface Screen { w: number; h: number; dpr: number }
interface Archetype {
  osToken: string;
  platform: string;
  uaPlatform: string;
  gpus: { vendor: string; renderer: string }[];
  screens: Screen[];
  cores: number[];
  mem: number[];
  chromeHeight: number;       // browser chrome subtracted from screen to get the page viewport
  taskbar: number;            // reserved area subtracted for screen.availHeight
}

const WINDOWS: Archetype = {
  osToken: "Windows NT 10.0; Win64; x64",
  platform: "Win32",
  uaPlatform: "Windows",
  gpus: [
    { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  ],
  screens: [
    { w: 1920, h: 1080, dpr: 1 },
    { w: 1536, h: 864, dpr: 1.25 },
    { w: 1366, h: 768, dpr: 1 },
    { w: 1600, h: 900, dpr: 1 },
    { w: 2560, h: 1440, dpr: 1 },
  ],
  cores: [8, 12, 16],
  mem: [8, 16],
  chromeHeight: 120,
  taskbar: 48,
};

const MAC: Archetype = {
  osToken: "Macintosh; Intel Mac OS X 10_15_7",
  platform: "MacIntel",
  uaPlatform: "macOS",
  gpus: [
    { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)" },
    { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" },
    { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)" },
    { vendor: "Google Inc. (Intel Inc.)", renderer: "ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics OpenGL Engine, OpenGL 4.1)" },
  ],
  screens: [
    { w: 1440, h: 900, dpr: 2 },
    { w: 1512, h: 982, dpr: 2 },
    { w: 1680, h: 1050, dpr: 2 },
    { w: 2560, h: 1440, dpr: 2 },
  ],
  cores: [8, 10, 12],
  mem: [8, 16],
  chromeHeight: 110,
  taskbar: 25,
};

// Weighted toward Windows, which dominates real desktop traffic.
const ARCHETYPES: Archetype[] = [WINDOWS, WINDOWS, WINDOWS, MAC];

/** A deterministic byte stream seeded by the profile id (re-hashes as it drains). */
function byteStream(seed: string) {
  let block = createHash("sha256").update(`fp:${seed}`).digest();
  let i = 0;
  return () => {
    if (i >= block.length) { block = createHash("sha256").update(block).digest(); i = 0; }
    return block[i++]!;
  };
}
const pick = <T>(next: () => number, arr: T[]): T => arr[next() % arr.length]!;

export function generateFingerprint(profileId: string, locale: string): Fingerprint {
  const next = byteStream(profileId);
  const a = pick(next, ARCHETYPES);
  const gpu = pick(next, a.gpus);
  const scr = pick(next, a.screens);

  const lang = (locale || "en-GB").trim();
  const base = lang.split("-")[0]!;
  const languages = base && base !== lang ? [lang, base] : [lang];

  return {
    osToken: a.osToken,
    platform: a.platform,
    uaPlatform: a.uaPlatform,
    viewport: { width: scr.w, height: Math.max(600, scr.h - a.chromeHeight) },
    screen: { width: scr.w, height: scr.h, availWidth: scr.w, availHeight: scr.h - a.taskbar },
    deviceScaleFactor: scr.dpr,
    hardwareConcurrency: pick(next, a.cores),
    deviceMemory: pick(next, a.mem),
    webglVendor: gpu.vendor,
    webglRenderer: gpu.renderer,
    canvasSeed: (next() % 255) + 1,
    languages,
  };
}

/** Major version from a Playwright browser.version() string like "158.0.8127.36". */
export function engineMajor(version: string): number {
  return parseInt(version.split(".")[0] ?? "0", 10) || 0;
}

/** Build a UA string whose Chrome version matches the live engine, with this profile's OS. */
export function buildUserAgent(osToken: string, major: number): string {
  return `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/**
 * Stealth init-script: runs in every page/frame BEFORE site code, so the page never sees the
 * automation tells. It (a) removes the webdriver flag, (b) restores the surfaces headless
 * Chromium leaves empty (window.chrome, plugins), and (c) aligns the JS-visible fingerprint
 * (platform, cores, memory, languages, screen, WebGL vendor/renderer, userAgentData) with the
 * per-profile fingerprint, plus deterministic canvas/audio noise so the profile's hashes are
 * stable but distinct from other profiles.
 *
 * Launch Chromium with "--disable-blink-features=AutomationControlled" as well — that is what
 * stops navigator.webdriver being set to true in the first place; this script is the belt to
 * that braces and also covers the other vectors.
 */
import type { Fingerprint } from "./fingerprint.js";

export function stealthScript(fp: Fingerprint, userAgent: string, chromeMajor: number): string {
  const cfg = JSON.stringify({ fp, userAgent, chromeMajor });
  // The whole body runs inside the page. Keep it self-contained and defensive (try/catch each
  // patch) so one failure can't break the others or the page.
  return `(() => {
  const CFG = ${cfg};
  const fp = CFG.fp;
  const def = (obj, prop, get) => { try { Object.defineProperty(obj, prop, { get, configurable: true, enumerable: true }); } catch (e) {} };

  // 1) webdriver — real Chrome exposes it as false, headless/automation as true.
  try { delete Navigator.prototype.webdriver; } catch (e) {}
  def(navigator, 'webdriver', () => false);

  // 2) platform / hardware / languages
  def(navigator, 'platform', () => fp.platform);
  def(navigator, 'hardwareConcurrency', () => fp.hardwareConcurrency);
  def(navigator, 'deviceMemory', () => fp.deviceMemory);
  def(navigator, 'languages', () => Object.freeze(fp.languages.slice()));
  def(navigator, 'language', () => fp.languages[0]);

  // 3) window.chrome — present in real Chrome, usually missing in headless.
  try {
    if (!window.chrome) Object.defineProperty(window, 'chrome', { value: {}, configurable: true, writable: true });
    const c = window.chrome;
    if (c && !c.runtime) c.runtime = {};
    if (c && !c.app) c.app = { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } };
  } catch (e) {}

  // 4) plugins / mimeTypes — headless reports none; real Chrome ships the PDF viewer set.
  try {
    const data = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', desc: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', desc: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', desc: 'Portable Document Format' },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', desc: 'Portable Document Format' },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', desc: 'Portable Document Format' },
    ];
    const arr = Object.create(PluginArray.prototype);
    data.forEach((p, i) => {
      const plugin = Object.create(Plugin.prototype);
      def(plugin, 'name', () => p.name); def(plugin, 'filename', () => p.filename);
      def(plugin, 'description', () => p.desc); def(plugin, 'length', () => 1);
      arr[i] = plugin; arr[p.name] = plugin;
    });
    def(arr, 'length', () => data.length);
    def(navigator, 'plugins', () => arr);
  } catch (e) {}

  // 5) userAgentData — brands/platform coherent with the spoofed UA & engine version.
  try {
    const v = String(CFG.chromeMajor);
    const brands = [
      { brand: 'Chromium', version: v },
      { brand: 'Google Chrome', version: v },
      { brand: 'Not?A_Brand', version: '99' },
    ];
    const uaData = {
      brands, mobile: false, platform: fp.uaPlatform,
      getHighEntropyValues: (hints) => Promise.resolve({
        architecture: 'x86', bitness: '64', model: '', platform: fp.uaPlatform,
        platformVersion: fp.uaPlatform === 'Windows' ? '15.0.0' : '14.4.0',
        uaFullVersion: v + '.0.0.0', fullVersionList: brands.map(b => ({ brand: b.brand, version: b.version + '.0.0.0' })),
        wow64: false,
        ...(Array.isArray(hints) ? {} : {}),
      }),
      toJSON: () => ({ brands, mobile: false, platform: fp.uaPlatform }),
    };
    def(navigator, 'userAgentData', () => uaData);
  } catch (e) {}

  // 6) screen dimensions
  try {
    def(screen, 'width', () => fp.screen.width); def(screen, 'height', () => fp.screen.height);
    def(screen, 'availWidth', () => fp.screen.availWidth); def(screen, 'availHeight', () => fp.screen.availHeight);
    def(screen, 'colorDepth', () => 24); def(screen, 'pixelDepth', () => 24);
    def(window, 'outerWidth', () => fp.screen.availWidth);
    def(window, 'outerHeight', () => fp.viewport.height + 88);
  } catch (e) {}

  // 7) permissions.query — Notification state must agree with the actual permission.
  try {
    const orig = navigator.permissions && navigator.permissions.query;
    if (orig) navigator.permissions.query = (p) =>
      p && p.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission, onchange: null })
        : orig.call(navigator.permissions, p);
  } catch (e) {}

  // 8) WebGL vendor/renderer — report this profile's GPU for the UNMASKED params.
  try {
    const patch = (proto) => {
      if (!proto) return;
      const gp = proto.getParameter;
      proto.getParameter = function (p) {
        if (p === 37445) return fp.webglVendor;   // UNMASKED_VENDOR_WEBGL
        if (p === 37446) return fp.webglRenderer;  // UNMASKED_RENDERER_WEBGL
        return gp.call(this, p);
      };
    };
    patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
    patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  } catch (e) {}

  // 9) Canvas noise — deterministic per-profile LSB perturbation so readback hashes are stable
  //    for this profile but differ from others. Too small to affect anything visual.
  try {
    const seed = fp.canvasSeed | 0;
    const jitter = (data) => {
      for (let i = 0; i < data.length; i += 4) {
        const n = (i * 131 + seed) & 1;  // deterministic 0/1 from position + seed
        if (((i / 4) % 97) === (seed % 97)) {
          data[i] = Math.min(255, data[i] ^ n);
          data[i + 1] = Math.min(255, data[i + 1] ^ n);
          data[i + 2] = Math.min(255, data[i + 2] ^ n);
        }
      }
      return data;
    };
    const ctxProto = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
    if (ctxProto) {
      const gid = ctxProto.getImageData;
      ctxProto.getImageData = function (x, y, w, h) {
        const img = gid.call(this, x, y, w, h);
        try { jitter(img.data); } catch (e) {}
        return img;
      };
    }
    const canvasProto = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
    if (canvasProto) {
      const toURL = canvasProto.toDataURL;
      canvasProto.toDataURL = function (...args) {
        try { const ctx = this.getContext('2d'); if (ctx && this.width && this.height) { const d = ctx.getImageData(0, 0, this.width, this.height); ctx.putImageData(d, 0, 0); } } catch (e) {}
        return toURL.apply(this, args);
      };
    }
  } catch (e) {}

  // 10) AudioContext noise — tiny deterministic gain offset on the fingerprinting path.
  try {
    const seed = (fp.canvasSeed % 32) * 1e-7;
    const AP = window.AnalyserNode && AnalyserNode.prototype;
    if (AP && AP.getFloatFrequencyData) {
      const orig = AP.getFloatFrequencyData;
      AP.getFloatFrequencyData = function (arr) { orig.call(this, arr); for (let i = 0; i < arr.length; i += 100) arr[i] = arr[i] + seed; };
    }
  } catch (e) {}
})();`;
}

/**
 * Live view for manual takeover (CAPTCHA escalation, unexpected pages).
 * Streams CDP screencast frames to Redis → API SSE → <LiveView/> canvas in the browser,
 * and replays the reviewer's clicks/keys into the page. Hosted browsers (Browserbase,
 * Browserless) can instead expose their native live-view URL.
 */
import type { CDPSession, Page } from "playwright";
import { redis } from "../lib/redis.js";

export const screenChannel = (runId: string) => `run:${runId}:screen`;

export interface LiveView { stop(): Promise<void>; input(ev: InputEvent): Promise<void> }
export type InputEvent =
  | { kind: "click"; x: number; y: number }   // fractions of the viewport (0–1), independent of frame scaling
  | { kind: "type"; text: string }
  | { kind: "key"; key: string }
  | { kind: "scroll"; dy: number };

export async function startLiveView(page: Page, runId: string): Promise<LiveView> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  let last = 0;
  cdp.on("Page.screencastFrame", async (f: { data: string; sessionId: number }) => {
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
    const now = Date.now();
    if (now - last < 200) return; // ≤5 fps is plenty for solving a challenge
    last = now;
    await redis.publish(screenChannel(runId), f.data);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 2 });

  // Chromium only emits screencast frames when the page repaints, so a static page would show nothing.
  // Push a screenshot immediately, after every input, and whenever the stream has been quiet for 1.5 s.
  const snapshot = async () => {
    const jpg = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null);
    if (jpg) { last = Date.now(); await redis.publish(screenChannel(runId), jpg.toString("base64")); }
  };
  await snapshot();
  const keepFresh = setInterval(() => { if (Date.now() - last > 1500) void snapshot(); }, 1500);

  return {
    async stop() {
      clearInterval(keepFresh);
      await cdp.send("Page.stopScreencast").catch(() => undefined);
      await cdp.detach().catch(() => undefined);
    },
    async input(ev) {
      if (ev.kind === "click") {
        const vp = page.viewportSize() ?? { width: 1440, height: 900 };
        await page.mouse.click(ev.x * vp.width, ev.y * vp.height);
      }
      else if (ev.kind === "type") await page.keyboard.type(ev.text, { delay: 60 });
      else if (ev.kind === "key") await page.keyboard.press(ev.key);
      else if (ev.kind === "scroll") await page.mouse.wheel(0, ev.dy);
      setTimeout(() => void snapshot(), 300);
    },
  };
}

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
  | { kind: "click"; x: number; y: number }
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

  return {
    async stop() {
      await cdp.send("Page.stopScreencast").catch(() => undefined);
      await cdp.detach().catch(() => undefined);
    },
    async input(ev) {
      if (ev.kind === "click") await page.mouse.click(ev.x, ev.y);
      else if (ev.kind === "type") await page.keyboard.type(ev.text, { delay: 60 });
      else if (ev.kind === "key") await page.keyboard.press(ev.key);
      else if (ev.kind === "scroll") await page.mouse.wheel(0, ev.dy);
    },
  };
}

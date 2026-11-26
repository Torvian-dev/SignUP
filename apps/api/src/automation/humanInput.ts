/**
 * Natural input pacing. Besides behaving like a person, typing key-by-key with realistic gaps is
 * what makes React/Vue/Angular controlled inputs, input masks (phone, postcode, card-style date
 * fields) and debounced validators work reliably — `fill()` bypasses many of those listeners.
 */
import type { Locator, Page } from "playwright";

const rand = (min: number, max: number) => min + Math.random() * (max - min);
/** Log-normal-ish delay: mostly short, occasionally longer — like real typing rhythm. */
const keyDelay = () => Math.min(260, Math.exp(rand(Math.log(45), Math.log(140))));

export async function pause(minMs = 250, maxMs = 900) {
  await new Promise((r) => setTimeout(r, rand(minMs, maxMs)));
}

/**
 * "Think time" between fields: mostly a short beat, but ~1 in 6 times a longer pause, as a person
 * glances away, re-reads a label, or decides what to type. Keeps the cadence from being a metronome.
 */
export async function thinkTime() {
  const base = rand(400, 1100);
  const lingers = Math.random() < 0.16 ? rand(900, 2600) : 0;
  await new Promise((r) => setTimeout(r, base + lingers));
}

/**
 * Hesitation before a committing click (Submit / Register / Create account). People pause to review
 * the form before the final click; `big` makes it the longer, pre-submit kind.
 */
export async function hesitate(big = false) {
  await new Promise((r) => setTimeout(r, big ? rand(1400, 3800) : rand(500, 1300)));
}

/** Move the mouse along a slightly curved path to the element, then click. */
export async function humanClick(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) return target.click();
  const to = { x: box.x + box.width * rand(0.3, 0.7), y: box.y + box.height * rand(0.35, 0.65) };
  const from = await page.evaluate(() => ({ x: (window as any).__fa_mx ?? 200, y: (window as any).__fa_my ?? 200 }));
  const steps = Math.round(rand(12, 25));
  const ctrl = { x: (from.x + to.x) / 2 + rand(-60, 60), y: (from.y + to.y) / 2 + rand(-40, 40) };
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * ctrl.x + t ** 2 * to.x; // quadratic Bézier
    const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * ctrl.y + t ** 2 * to.y;
    await page.mouse.move(x, y);
    await new Promise((r) => setTimeout(r, rand(4, 14)));
  }
  await page.evaluate(({ x, y }) => { (window as any).__fa_mx = x; (window as any).__fa_my = y; }, to);
  await pause(60, 180);
  await page.mouse.click(to.x, to.y, { delay: rand(40, 110) });
}

export async function humanType(page: Page, target: Locator, text: string) {
  await humanClick(page, target);
  await target.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await target.press("Backspace");
  for (const ch of text) {
    await page.keyboard.type(ch);
    await new Promise((r) => setTimeout(r, keyDelay()));
  }
  // Fire blur so on-blur validators run, as when a user tabs to the next field.
  await target.evaluate((el) => (el as HTMLElement).blur());
  await pause(120, 400);
}

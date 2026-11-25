import type { Frame, Page } from "playwright";

/**
 * Resolve a frame path produced by the analyzer ("main", or "iframe[...] >> iframe[...]") back to the
 * live Frame so fields and buttons inside embedded forms can be located and clicked.
 */
export function resolveFrame(page: Page, framePath: string | undefined): Frame | Page {
  if (!framePath || framePath === "main") return page;
  let f: Frame | null = page.mainFrame();
  for (const sel of framePath.split(" >> ")) {
    const srcNeedle = (sel.match(/src\*="([^"]+)"/) ?? [])[1];
    const nameNeedle = (sel.match(/name="([^"]+)"/) ?? [])[1];
    const child: Frame | undefined = f?.childFrames().find(
      (c) => (srcNeedle ? c.url().includes(srcNeedle) : false) || (nameNeedle ? c.name() === nameNeedle : false));
    f = child ?? null;
  }
  return f ?? page;
}

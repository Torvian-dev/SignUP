/**
 * Website Analysis Engine (in-page extraction).
 *
 * Walks every frame (embedded / iframe forms), every open shadow root (web-component forms) and
 * every visible dialog (modal forms). For each control it resolves the human label from:
 *   <label for>, wrapping <label>, aria-labelledby, aria-label, placeholder, fieldset legend,
 *   preceding text node / table cell / grid sibling — because many sites don't use <label>.
 * Produces a stable locator and a field_key (hash of domain + form signature + locator) used by
 * the learning system to recognise the same field next time.
 */
import { createHash } from "node:crypto";
import type { Frame, Page } from "playwright";
import { logger } from "../lib/logger.js";

export interface RawField {
  locator: string;          // CSS path usable with frame.locator()
  framePath: string;        // "main" or chain of iframe selectors
  kind: string;
  label?: string; name?: string; htmlId?: string; placeholder?: string; autocomplete?: string; ariaLabel?: string;
  nearbyText?: string; section?: string;
  required: boolean; visible: boolean; inShadow: boolean; inDialog: boolean;
  options?: { value: string; label: string }[];
  formIndex: number;
  honeypot: boolean;
}

export interface PageAnalysis {
  url: string;
  title: string;
  fields: (RawField & { fieldKey: string })[];
  formCount: number;
  hasPasswordField: boolean;
  passwordFieldCount: number;
  signals: {
    looksLikeLogin: boolean;
    looksLikeSignup: boolean;
    stepIndicator: string | null;        // "Step 2 of 5"
    hasModal: boolean;
    signupLinks: string[];               // visible text of links that lead to sign-up
  };
  buttons: { text: string; locator: string; type: string; framePath: string }[];
}

/** Runs inside the page. Must be self-contained (serialised by Playwright). */
function extractInFrame() {
  const out: any[] = [];
  const buttons: any[] = [];
  const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);

  const cssPath = (el: Element): string => {
    if ((el as HTMLElement).id && /^[A-Za-z][\w-]*$/.test((el as HTMLElement).id)) return `#${(el as HTMLElement).id}`;
    const name = el.getAttribute("name");
    if (name) {
      const sel = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      if (el.getRootNode() instanceof Document && document.querySelectorAll(sel).length === 1) return sel;
    }
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1 && parts.length < 8) {
      const parent: Element | null = cur.parentElement;
      const idx = parent ? Array.from(parent.children).filter((c) => c.tagName === cur!.tagName).indexOf(cur) + 1 : 1;
      parts.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${idx})`);
      cur = parent;
    }
    return parts.join(" > ");
  };

  const isVisible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    const s = getComputedStyle(el as HTMLElement);
    // Off-screen positioning (left:-9999px) and clipping are common honeypot techniques → not visible.
    const offscreen = r.right <= 0 || r.bottom <= 0 || r.left >= document.documentElement.scrollWidth + 50;
    const clipped = s.clipPath === "inset(50%)" || (s.clip && s.clip !== "auto" && r.width <= 1);
    return r.width > 1 && r.height > 1 && !offscreen && !clipped && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };

  const labelFor = (el: HTMLElement): string | undefined => {
    const id = el.id;
    if (id) {
      const l = (el.getRootNode() as Document | ShadowRoot).querySelector?.(`label[for="${CSS.escape(id)}"]`);
      if (l) return text(l);
    }
    const wrap = el.closest("label");
    if (wrap) return text(wrap);
    const by = el.getAttribute("aria-labelledby");
    if (by) return by.split(/\s+/).map((i) => text(document.getElementById(i))).join(" ").trim() || undefined;
    return undefined;
  };

  const nearby = (el: HTMLElement): string | undefined => {
    let prev: Element | null = el.previousElementSibling;
    for (let i = 0; i < 3 && prev; i++, prev = prev.previousElementSibling) {
      const t = text(prev);
      if (t && t.length < 80) return t;
    }
    const cell = el.closest("td, .form-group, .field, [class*='field'], [class*='Field']");
    const t = cell ? text(cell.querySelector("label, span, div, th, p")) : "";
    return t || undefined;
  };

  const kindOf = (el: HTMLElement): string => {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") return "select";
    if (tag === "textarea") return "textarea";
    if (el.getAttribute("role") === "combobox") return "combobox";
    const t = (el.getAttribute("type") ?? "text").toLowerCase();
    return ["email", "tel", "password", "number", "date", "checkbox", "radio", "file", "hidden"].includes(t) ? t : "text";
  };

  const visit = (root: Document | ShadowRoot, inShadow: boolean) => {
    const forms = Array.from(root.querySelectorAll("form"));
    root.querySelectorAll<HTMLElement>("input, select, textarea, [role=combobox], [contenteditable=true]").forEach((el) => {
      const kind = kindOf(el);
      if (["submit", "button", "reset", "image"].includes((el.getAttribute("type") ?? "").toLowerCase())) return;
      const visible = kind === "hidden" ? false : isVisible(el) && !el.closest("[aria-hidden=true]");
      const name = el.getAttribute("name") ?? undefined;
      // Honeypots: invisible but not type=hidden, often with tempting names.
      const honeypot = !visible && kind !== "hidden" && (el.getAttribute("tabindex") === "-1" || /website|url|honey|hp_|fax/i.test(name ?? ""));
      const options =
        el.tagName === "SELECT"
          ? Array.from((el as HTMLSelectElement).options).slice(0, 300).map((o) => ({ value: o.value, label: o.text.trim() }))
          : kind === "radio" && name
            ? Array.from(root.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(name)}"]`))
                .map((r) => ({ value: r.value, label: labelFor(r) ?? r.value }))
            : undefined;
      if (kind === "radio" && name && out.some((f) => f.kind === "radio" && f.name === name)) return; // one entry per group
      out.push({
        locator: kind === "radio" && name ? `input[type=radio][name="${CSS.escape(name)}"]` : cssPath(el),
        kind, name, htmlId: el.id || undefined,
        label: labelFor(el), placeholder: el.getAttribute("placeholder") ?? undefined,
        autocomplete: el.getAttribute("autocomplete") ?? undefined, ariaLabel: el.getAttribute("aria-label") ?? undefined,
        nearbyText: nearby(el), section: text(el.closest("fieldset")?.querySelector("legend")) || undefined,
        required: (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true",
        visible, inShadow, inDialog: !!el.closest("dialog, [role=dialog], [aria-modal=true]"),
        options, formIndex: forms.findIndex((f) => f.contains(el)), honeypot,
      });
    });
    root.querySelectorAll<HTMLElement>("button, input[type=submit], [role=button], a.button, a.btn").forEach((b) => {
      if (!isVisible(b)) return;
      const t = text(b) || b.getAttribute("value") || b.getAttribute("aria-label") || "";
      if (t) buttons.push({ text: t.slice(0, 60), locator: cssPath(b), type: b.getAttribute("type") ?? "button" });
    });
    root.querySelectorAll("*").forEach((n) => { if ((n as HTMLElement).shadowRoot) visit((n as HTMLElement).shadowRoot!, true); });
  };
  visit(document, false);

  const body = document.body?.innerText ?? "";
  const links = Array.from(document.querySelectorAll("a, button"))
    .map((a) => text(a)).filter((t) => /sign ?up|register|create (an )?account|join|get started|apply now/i.test(t)).slice(0, 5);
  return {
    fields: out, buttons,
    formCount: document.querySelectorAll("form").length,
    stepIndicator: (body.match(/step\s+\d+\s+(of|\/)\s+\d+/i) ?? [null])[0],
    hasModal: !!document.querySelector("dialog[open], [role=dialog]:not([aria-hidden=true]), [aria-modal=true]"),
    signupLinks: links,
    bodySample: body.slice(0, 3000).toLowerCase(),
  };
}

async function framePath(frame: Frame): Promise<string> {
  const chain: string[] = [];
  let f: Frame | null = frame;
  while (f && f.parentFrame()) {
    const el = await f.frameElement();
    chain.unshift((await el.getAttribute("name")) ? `iframe[name="${await el.getAttribute("name")}"]` : `iframe[src*="${new URL(f.url()).pathname}"]`);
    f = f.parentFrame();
  }
  return chain.length ? chain.join(" >> ") : "main";
}

export async function analysePage(page: Page): Promise<PageAnalysis> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined); // SPAs: best-effort
  const url = page.url();
  const domain = new URL(url).hostname.replace(/^www\./, "");
  const fields: PageAnalysis["fields"] = [];
  const buttons: PageAnalysis["buttons"] = [];
  let formCount = 0, stepIndicator: string | null = null, hasModal = false, signupLinks: string[] = [], body = "";

  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    const host = (() => { try { return new URL(frame.url()).hostname; } catch { return ""; } })();
    if (/google\.com\/recaptcha|hcaptcha\.com|challenges\.cloudflare\.com/.test(frame.url())) continue; // CAPTCHA frames handled separately
    let r: ReturnType<typeof extractInFrame>;
    try { r = (await frame.evaluate(extractInFrame)) as ReturnType<typeof extractInFrame>; }
    catch (err) { logger.warn({ frameUrl: frame.url(), err: (err as Error).message.slice(0, 200) }, "frame analysis failed"); continue; }
    const fp = await framePath(frame);
    formCount += r.formCount;
    stepIndicator ??= r.stepIndicator;
    hasModal ||= r.hasModal;
    if (frame === page.mainFrame()) { signupLinks = r.signupLinks; body = r.bodySample; }
    for (const f of r.fields as RawField[]) {
      const sig = [domain, host, fp, f.formIndex, f.name, f.htmlId, f.label, f.kind].join("|");
      fields.push({ ...f, framePath: fp, fieldKey: createHash("sha256").update(sig).digest("hex").slice(0, 32) });
    }
    buttons.push(...(r.buttons as { text: string; locator: string; type: string }[]).map((b) => ({ ...b, framePath: fp })));
  }

  const pw = fields.filter((f) => f.kind === "password" && f.visible);
  return {
    url, title: await page.title(), fields, formCount, buttons,
    hasPasswordField: pw.length > 0, passwordFieldCount: pw.length,
    signals: {
      looksLikeLogin: pw.length === 1 && fields.filter((f) => f.visible && f.kind !== "password").length <= 2 && /log ?in|sign ?in/.test(body),
      looksLikeSignup: pw.length >= 2 || /create (an |your )?account|sign ?up|register/.test(body),
      stepIndicator, hasModal, signupLinks,
    },
  };
}

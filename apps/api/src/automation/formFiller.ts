/**
 * Fills mapped fields using natural input, then validates each one by reading it back and
 * checking the browser's own constraint validation + any visible error message nearby.
 */
import type { Frame, Locator, Page } from "playwright";
import { getDecrypted, BLOB } from "./blobPaths.js";
import { humanClick, humanType, pause } from "./humanInput.js";
import { applyTransform } from "./transforms.js";
import type { RawField } from "./pageAnalyzer.js";
import type { Decision } from "../services/ai/mappingEngine.js";
import { withOrg } from "../lib/db.js";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FillContext {
  orgId: string;
  page: Page;
  fields: (RawField & { id: string })[];      // detected fields, id = detected_fields.id
  values: Record<string, string>;           // flattened profile values + generated.* + site_account.*
  countryCode?: string;
  consent: { terms: boolean; marketing: boolean };
  minConfidence: number;                    // below this we leave the field for the reviewer
}

export interface FillResult {
  fieldId: string;
  decisionId?: string;
  status: "filled" | "skipped_low_confidence" | "skipped_no_value" | "skipped_unmapped" | "error";
  valid: boolean;
  validationMessage?: string;
  displayValue?: string;                    // masked for review screen when sensitive
}

function frameFor(page: Page, framePath: string): Frame | Page {
  if (framePath === "main") return page;
  // Resolve "iframe[...] >> iframe[...]" chains
  let f: Frame | null = page.mainFrame();
  for (const sel of framePath.split(" >> ")) {
    const child: Frame | undefined = f?.childFrames().find((c) => c.url().includes((sel.match(/src\*="([^"]+)"/) ?? [])[1] ?? "\u0000") || c.name() === (sel.match(/name="([^"]+)"/) ?? [])[1]);
    f = child ?? null;
  }
  return f ?? page;
}

async function validate(loc: Locator): Promise<{ valid: boolean; message?: string }> {
  return loc.evaluate((el) => {
    const input = el as HTMLInputElement;
    const native = typeof input.checkValidity === "function" ? input.checkValidity() : true;
    const errId = input.getAttribute("aria-describedby");
    const errEl = errId ? document.getElementById(errId) : input.parentElement?.querySelector("[class*=error], [role=alert]");
    const errText = errEl?.textContent?.trim();
    const invalidAria = input.getAttribute("aria-invalid") === "true";
    return { valid: native && !invalidAria, message: input.validationMessage || (invalidAria ? errText : undefined) };
  });
}

const SENSITIVE = /password|passport|tax|ssn|national_insurance|secret/i;

export async function fillFields(ctx: FillContext, decisions: Decision[]): Promise<FillResult[]> {
  const results: FillResult[] = [];
  const byId = new Map(ctx.fields.map((f) => [f.id, f]));

  for (const d of decisions) {
    const field = byId.get(d.fieldId);
    if (!field || field.honeypot || !field.visible) { results.push({ fieldId: d.fieldId, decisionId: d.decisionId, status: "skipped_unmapped", valid: true }); continue; }
    if (!d.profilePath) { results.push({ fieldId: d.fieldId, decisionId: d.decisionId, status: "skipped_unmapped", valid: !field.required }); continue; }
    if (d.confidence < ctx.minConfidence) { results.push({ fieldId: d.fieldId, decisionId: d.decisionId, status: "skipped_low_confidence", valid: !field.required }); continue; }

    let raw: string | undefined;
    if (d.profilePath === "consent.terms") raw = ctx.consent.terms ? "true" : undefined;
    else if (d.profilePath === "consent.marketing") raw = ctx.consent.marketing ? "true" : "false";
    else raw = ctx.values[d.profilePath];
    if (raw === undefined) { results.push({ fieldId: d.fieldId, decisionId: d.decisionId, status: "skipped_no_value", valid: !field.required }); continue; }

    // No explicit transform but an ISO date going into a text field with a format placeholder
    // (e.g. "DD/MM/YYYY") → format it the way the site asks.
    let transform = d.transform;
    const ph = field.placeholder?.trim().toUpperCase();
    if (!transform && field.kind !== "date" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && ph && /^(DD|MM|YYYY)[/.-](DD|MM)[/.-](YYYY|DD)$/.test(ph)) {
      transform = `date:${ph}`;
    }
    const value = applyTransform(raw, transform, { countryCode: ctx.countryCode });
    const root = frameFor(ctx.page, field.framePath);
    const loc = root.locator(field.locator).first();

    try {
      switch (field.kind) {
        case "select":
          await humanClick(ctx.page, loc);
          await loc.selectOption({ value }).catch(() => loc.selectOption({ label: value }));
          break;
        case "radio": {
          const opt = root.locator(`${field.locator}[value="${value.replace(/"/g, '\\"')}"]`).first();
          await humanClick(ctx.page, opt);
          break;
        }
        case "checkbox": {
          const want = value === "true";
          if ((await loc.isChecked()) !== want) await humanClick(ctx.page, loc);
          break;
        }
        case "file": {
          // value is "document:<uuid>" → decrypt from Blob to a temp file for setInputFiles
          const docId = value.replace(/^document:/, "");
          const doc = await withOrg(ctx.orgId, async (tx) => (await tx.query("SELECT * FROM documents WHERE id=$1", [docId])).rows[0]);
          if (!doc) throw new Error("document not found");
          const bytes = await getDecrypted(ctx.orgId, BLOB.documents, doc.blob_path);
          const dir = await mkdtemp(join(tmpdir(), "fa-upload-"));
          const p = join(dir, doc.filename);
          await writeFile(p, bytes!);
          await loc.setInputFiles(p);
          break;
        }
        case "date":
          // Native date inputs require ISO regardless of display format.
          await loc.fill(applyTransform(raw, "date:YYYY-MM-DD", {}));
          break;
        case "combobox":
          await humanType(ctx.page, loc, value);
          await pause(400, 800);
          await ctx.page.getByRole("option", { name: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") }).first()
            .click({ timeout: 3000 }).catch(() => loc.press("Enter"));
          break;
        default:
          await humanType(ctx.page, loc, value);
      }
      const v = await validate(loc);
      results.push({
        fieldId: d.fieldId, decisionId: d.decisionId, status: "filled", valid: v.valid, validationMessage: v.message,
        displayValue: SENSITIVE.test(d.profilePath) || field.kind === "password" ? "••••••••" : value,
      });
    } catch (err) {
      results.push({ fieldId: d.fieldId, decisionId: d.decisionId, status: "error", valid: false, validationMessage: (err as Error).message.slice(0, 200) });
    }
    await pause(150, 500);
  }
  return results;
}

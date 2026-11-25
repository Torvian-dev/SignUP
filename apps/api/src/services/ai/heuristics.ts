/**
 * Deterministic fast-path. The HTML `autocomplete` attribute is a standardised, unambiguous
 * signal (WHATWG token list) — when present we don't need to spend LLM tokens on that field.
 */
import type { FieldDescriptor } from "./types.js";

const AUTOCOMPLETE: Record<string, string> = {
  "given-name": "personal.firstName",
  "family-name": "personal.lastName",
  name: "personal.fullName",
  email: "personal.email",
  username: "personal.email",
  tel: "personal.phone",
  "tel-national": "personal.phone",
  "address-line1": "address.primary.line1",
  "street-address": "address.primary.line1",
  "address-line2": "address.primary.line2",
  "address-level2": "address.primary.city",
  "address-level1": "address.primary.region",
  "postal-code": "address.primary.postcode",
  country: "address.primary.country",
  "country-name": "address.primary.country",
  "new-password": "generated.password",
  "current-password": "site_account.password",
  bday: "custom.date_of_birth",
  organization: "custom.business_name",
};

export interface HeuristicHit { fieldId: string; profilePath: string; transform: string | null; confidence: number; reasoning: string }

export function heuristicMap(fields: FieldDescriptor[], availablePaths: Set<string>): HeuristicHit[] {
  const hits: HeuristicHit[] = [];
  for (const f of fields) {
    if (f.kind === "hidden") continue;
    const token = f.autocomplete?.toLowerCase().split(/\s+/).pop();
    const path = token ? AUTOCOMPLETE[token] : undefined;
    if (path && availablePaths.has(path)) {
      hits.push({
        fieldId: f.id,
        profilePath: path,
        transform: path.endsWith(".country") && f.kind === "select" ? "country:alpha2" : null,
        confidence: 0.97,
        reasoning: `autocomplete="${token}" is a standard token for ${path}`,
      });
    } else if (f.kind === "email" && availablePaths.has("personal.email")) {
      hits.push({ fieldId: f.id, profilePath: "personal.email", transform: null, confidence: 0.9, reasoning: "input type=email" });
    }
  }
  return hits;
}

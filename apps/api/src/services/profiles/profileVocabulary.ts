/**
 * Flattens a profile into "profile paths" — the vocabulary the mapping engine maps fields onto.
 * The LLM only ever sees path names, labels and *types* — never the values themselves.
 */
import type { DecryptedProfile } from "./profileService.js";

export interface ProfileSlot {
  path: string;          // e.g. personal.firstName | address.primary.postcode | custom.date_of_birth
  label: string;         // human label shown to the model
  type: string;          // text|email|phone|date|country|password|file|...
  synonyms: string[];    // hints, never values
  hasValue: boolean;
}

export const BUILTIN_SLOTS: Omit<ProfileSlot, "hasValue">[] = [
  { path: "personal.firstName", label: "First name", type: "text", synonyms: ["forename", "given name", "first"] },
  { path: "personal.lastName", label: "Last name", type: "text", synonyms: ["surname", "family name", "last"] },
  { path: "personal.fullName", label: "Full name", type: "text", synonyms: ["name", "your name", "applicant name", "contact name"] },
  { path: "personal.email", label: "Email address", type: "email", synonyms: ["e-mail", "email", "contact email"] },
  { path: "personal.phone", label: "Phone number", type: "phone", synonyms: ["telephone", "mobile", "cell", "contact number"] },
  { path: "address.primary.line1", label: "Address line 1", type: "text", synonyms: ["street", "address", "house number and street"] },
  { path: "address.primary.line2", label: "Address line 2", type: "text", synonyms: ["apartment", "suite", "flat", "unit"] },
  { path: "address.primary.city", label: "City / Town", type: "text", synonyms: ["town", "locality"] },
  { path: "address.primary.region", label: "County / State", type: "text", synonyms: ["state", "province", "county", "region"] },
  { path: "address.primary.postcode", label: "Postcode / ZIP", type: "postcode", synonyms: ["zip", "postal code"] },
  { path: "address.primary.country", label: "Country", type: "country", synonyms: ["nation", "country of residence"] },
  { path: "generated.password", label: "New account password (generated)", type: "password", synonyms: ["password", "confirm password"] },
  { path: "site_account.username", label: "Existing account username for this site", type: "text", synonyms: ["username", "login"] },
  { path: "site_account.password", label: "Existing account password for this site", type: "password", synonyms: ["password"] },
  { path: "consent.terms", label: "Accept terms (ONLY if user pre-approved)", type: "boolean", synonyms: ["terms", "agree"] },
  { path: "consent.marketing", label: "Marketing opt-in (default NO)", type: "boolean", synonyms: ["newsletter", "marketing"] },
];

export function buildVocabulary(p: DecryptedProfile): ProfileSlot[] {
  const resolved = new Set(Object.keys(flattenValues(p)));
  const slots: ProfileSlot[] = BUILTIN_SLOTS.map((s) => ({ ...s, hasValue: resolved.has(s.path) || s.path.startsWith("generated.") || s.path.startsWith("consent.") || s.path.startsWith("site_account.") }));
  for (const kind of Object.keys(p.addresses)) {
    if (kind === "primary") continue;
    for (const part of ["line1", "line2", "city", "region", "postcode", "country"]) {
      slots.push({ path: `address.${kind}.${part}`, label: `${kind} address ${part}`, type: part === "country" ? "country" : "text", synonyms: [kind], hasValue: resolved.has(`address.${kind}.${part}`) });
    }
  }
  for (const [key, f] of Object.entries(p.custom)) {
    slots.push({ path: `custom.${key}`, label: f.label, type: f.type, synonyms: f.synonyms, hasValue: !!(f.value || f.documentId) });
  }
  return slots;
}

/** path → raw value. Only used inside the worker when actually filling. */
export function flattenValues(p: DecryptedProfile): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v?: string) => { if (v) out[k] = v; };
  put("personal.firstName", p.personal.firstName);
  put("personal.lastName", p.personal.lastName);
  put("personal.fullName", [p.personal.firstName, p.personal.lastName].filter(Boolean).join(" ") || undefined);
  put("personal.email", p.personal.email);
  put("personal.phone", p.personal.phone);
  for (const [kind, a] of Object.entries(p.addresses)) {
    put(`address.${kind}.line1`, a.line1);
    put(`address.${kind}.line2`, a.line2);
    put(`address.${kind}.city`, a.city);
    put(`address.${kind}.region`, a.region);
    put(`address.${kind}.postcode`, a.postcode);
    put(`address.${kind}.country`, a.countryCode);
  }
  for (const [key, f] of Object.entries(p.custom)) put(`custom.${key}`, f.value ?? (f.documentId ? `document:${f.documentId}` : undefined));
  return out;
}

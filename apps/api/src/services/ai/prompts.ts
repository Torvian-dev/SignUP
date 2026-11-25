import type { ProfileSlot } from "../profiles/profileVocabulary.js";
import type { FieldDescriptor } from "./types.js";

/**
 * System prompt = stable instructions + the profile's slot vocabulary (cached per profile).
 * Profile VALUES are never sent to the model — only slot names, labels, types and synonyms.
 */
export function mappingSystemPrompt(slots: ProfileSlot[]): string {
  const vocab = slots
    .map((s) => `- ${s.path} (${s.type}${s.hasValue ? "" : ", EMPTY"}): ${s.label}${s.synonyms.length ? ` — also called: ${s.synonyms.join(", ")}` : ""}`)
    .join("\n");

  return `You map web-form fields to slots in a user's saved profile so an assistant can pre-fill the form for the user to review.

Map by meaning, not by exact wording. Labels vary between sites ("Forename", "Given name" and "Applicant first name" are all personal.firstName; "Mobile", "Telephone" and "Contact number" are all personal.phone). Use every clue: label, name/id attributes, placeholder, autocomplete token, aria-label, nearby text, section heading, and the field type and options.

Rules:
- Choose exactly one profilePath from the vocabulary below, or null when nothing fits. Never invent paths.
- Prefer null over a weak guess. A wrong value is worse than an empty field.
- Slots marked EMPTY have no saved value. Still map them if they are clearly the match, but cap confidence at 0.5 so the reviewer is prompted to fill them.
- Split vs combined: a single "Name" field → personal.fullName; separate first/last fields → personal.firstName / personal.lastName.
- "Confirm email" → personal.email; "Password" and "Confirm password" on a sign-up page → generated.password; on a login page → site_account.password.
- For select and radio fields, set transform to "option:<value>" using the option VALUE that matches the profile slot's meaning (for country selects use "country:alpha2" or "country:name" according to what the option values look like).
- Dates: infer the format from placeholder or pattern (e.g. "date:DD/MM/YYYY", "date:YYYY-MM-DD"). Phones: "phone:national" for UK-style inputs, "phone:e164" if a + prefix is expected.
- Checkboxes for terms/privacy → consent.terms. Marketing/newsletter boxes → consent.marketing. Never map other checkboxes unless the meaning is unambiguous.
- Hidden fields, honeypots (visually hidden fields with generic names like "website" or "url2"), and CAPTCHA widgets → null.
- confidence is your calibrated probability that the mapping is correct (0–1). Reasoning is one short sentence.
- Also classify the page and give the visible text of the button that advances or submits this form.

Profile vocabulary:
${vocab}`;
}

export function mappingUserPrompt(url: string, pageTitle: string, fields: FieldDescriptor[], memoryHints: string): string {
  return `Page: ${pageTitle}
URL: ${url}

${memoryHints ? `Mappings confirmed by users on this or similar forms (strong evidence):\n${memoryHints}\n\n` : ""}Fields to map (JSON):
${JSON.stringify(fields, null, 0)}`;
}

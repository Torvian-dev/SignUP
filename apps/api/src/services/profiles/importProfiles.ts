/**
 * Bulk profile import from CSV. One row = one profile. Columns (case-insensitive headers):
 *   label, firstName, lastName, email, phone,
 *   addressLine1, addressLine2, city, region, postcode, country,
 *   proxyType, proxyHost, proxyPort, proxyUsername, proxyPassword,
 *   and any header starting "custom:" (e.g. "custom:Date of Birth") → a custom field.
 * Each row is validated and created on its own; a bad row is reported and the rest still import.
 */
import { ZodError } from "zod";
import { createProfile, ProfileInput } from "./profileService.js";

const COUNTRY: Record<string, string> = {
  "united kingdom": "GB", uk: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB",
  "united states": "US", usa: "US", us: "US", america: "US", ireland: "IE", france: "FR", germany: "DE",
  spain: "ES", italy: "IT", netherlands: "NL", canada: "CA", australia: "AU",
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").replace(/^(\d)/, "f_$1").slice(0, 63) || "field";

function lower(row: Record<string, string>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) o[k.toLowerCase().trim()] = v;
  return o;
}

export function rowToProfileInput(raw: Record<string, string>): ProfileInput {
  const r = lower(raw);
  const get = (k: string) => (r[k]?.trim() ? r[k]!.trim() : undefined);

  const label = get("label") ?? [get("firstname"), get("lastname")].filter(Boolean).join(" ") ?? "";

  const countryRaw = get("country") ?? "";
  const countryCode = countryRaw.length === 2 ? countryRaw.toUpperCase()
    : COUNTRY[countryRaw.toLowerCase()] ?? (countryRaw ? countryRaw.toUpperCase().slice(0, 2) : "GB");
  const hasAddress = ["addressline1", "city", "postcode", "region"].some((k) => get(k));

  const proxyHost = get("proxyhost");
  const customFields = Object.keys(raw)
    .filter((h) => h.toLowerCase().startsWith("custom:"))
    .map((h) => ({ key: slug(h.slice(h.indexOf(":") + 1)), label: h.slice(h.indexOf(":") + 1).trim(),
                   type: "text" as const, value: raw[h]?.trim() || undefined, synonyms: [] }))
    .filter((f) => f.value);

  return ProfileInput.parse({
    label,
    firstName: get("firstname"), lastName: get("lastname"), email: get("email"), phone: get("phone"),
    addresses: hasAddress ? [{
      kind: "primary", line1: get("addressline1"), line2: get("addressline2"), city: get("city"),
      region: get("region"), postcode: get("postcode"), countryCode,
    }] : [],
    proxy: proxyHost ? {
      type: (get("proxytype") ?? "http").toLowerCase(), host: proxyHost,
      port: Number(get("proxyport") ?? 8080), username: get("proxyusername"), password: get("proxypassword"),
    } : null,
    customFields,
  });
}

export interface ImportResult {
  created: number;
  failed: { row: number; label: string; error: string }[];
  ids: string[];
}

export async function importProfiles(orgId: string, userId: string, rows: Record<string, string>[]): Promise<ImportResult> {
  const result: ImportResult = { created: 0, failed: [], ids: [] };
  for (const [i, raw] of rows.entries()) {
    try {
      const input = rowToProfileInput(raw);
      if (!input.label) throw new Error("missing label / name");
      const id = await createProfile(orgId, userId, input);
      result.ids.push(id);
      result.created++;
    } catch (err) {
      const msg = err instanceof ZodError
        ? err.issues.map((is) => `${is.path.join(".") || "row"}: ${is.message.toLowerCase()}`).join("; ")
        : err instanceof Error ? err.message : String(err);
      result.failed.push({ row: i + 2, label: raw.label ?? raw.Label ?? "", error: msg.slice(0, 200) }); // +2: header row + 1-indexed
    }
  }
  return result;
}

export const CSV_TEMPLATE_HEADERS = [
  "label", "firstName", "lastName", "email", "phone",
  "addressLine1", "addressLine2", "city", "region", "postcode", "country",
  "proxyType", "proxyHost", "proxyPort", "proxyUsername", "proxyPassword",
  "custom:Date of Birth", "custom:Business Name",
];

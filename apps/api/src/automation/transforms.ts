/** Value transforms requested by the mapping engine (e.g. "date:DD/MM/YYYY", "phone:e164", "option:GB"). */

const COUNTRY_NAMES: Record<string, string> = {
  GB: "United Kingdom", US: "United States", IE: "Ireland", FR: "France", DE: "Germany", ES: "Spain", IT: "Italy",
  NL: "Netherlands", CA: "Canada", AU: "Australia", NZ: "New Zealand", IN: "India", ZA: "South Africa",
};
const DIAL: Record<string, string> = { GB: "44", US: "1", IE: "353", FR: "33", DE: "49", ES: "34", IT: "39", NL: "31", CA: "1", AU: "61" };

export function applyTransform(value: string, transform: string | null, ctx: { countryCode?: string }): string {
  if (!transform) return value;
  const [op, arg = ""] = transform.split(/:(.*)/s) as [string, string?];
  switch (op) {
    case "date": return formatDate(value, arg);
    case "phone": return formatPhone(value, arg, ctx.countryCode ?? "GB");
    case "country":
      return arg === "name" ? COUNTRY_NAMES[value.toUpperCase()] ?? value : value.toUpperCase();
    case "split": {
      const parts = value.trim().split(/\s+/);
      return arg === "first" ? parts[0] ?? "" : parts.slice(1).join(" ");
    }
    case "upper": return value.toUpperCase();
    case "lower": return value.toLowerCase();
    case "option": return arg; // select/radio: the target option value is in the transform itself
    case "bool": return arg;
    default: return value;
  }
}

/** Accepts ISO (YYYY-MM-DD) or DD/MM/YYYY input; emits tokens DD, MM, YYYY, YY. */
function formatDate(v: string, fmt: string): string {
  let y: string, m: string, d: string;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const uk = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (iso) [, y, m, d] = iso as unknown as [string, string, string, string];
  else if (uk) [, d, m, y] = uk as unknown as [string, string, string, string];
  else return v;
  return (fmt || "YYYY-MM-DD")
    .replace("YYYY", y).replace("YY", y.slice(2)).replace("MM", m.padStart(2, "0")).replace("DD", d.padStart(2, "0"));
}

function formatPhone(v: string, mode: string, country: string): string {
  const digits = v.replace(/[^\d+]/g, "");
  const cc = DIAL[country] ?? "44";
  const national = digits.startsWith("+") ? "0" + digits.slice(1 + cc.length) : digits;
  if (mode === "e164") return digits.startsWith("+") ? digits : `+${cc}${national.replace(/^0/, "")}`;
  if (mode === "digits") return national.replace(/^0/, "");
  return national; // "national"
}

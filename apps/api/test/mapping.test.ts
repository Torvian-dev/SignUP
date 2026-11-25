import { describe, expect, it } from "vitest";
import { applyTransform } from "../src/automation/transforms.js";
import { heuristicMap } from "../src/services/ai/heuristics.js";

describe("applyTransform", () => {
  it("reformats ISO dates to the site's format", () => {
    expect(applyTransform("1990-03-07", "date:DD/MM/YYYY", {})).toBe("07/03/1990");
    expect(applyTransform("07/03/1990", "date:YYYY-MM-DD", {})).toBe("1990-03-07");
  });
  it("formats UK phone numbers", () => {
    expect(applyTransform("07123 456789", "phone:e164", { countryCode: "GB" })).toBe("+447123456789");
    expect(applyTransform("+447123456789", "phone:national", { countryCode: "GB" })).toBe("07123456789");
  });
  it("handles countries, splits and select options", () => {
    expect(applyTransform("GB", "country:name", {})).toBe("United Kingdom");
    expect(applyTransform("John Smith", "split:first", {})).toBe("John");
    expect(applyTransform("Mary Ann Jones", "split:last", {})).toBe("Ann Jones");
    expect(applyTransform("anything", "option:UK", {})).toBe("UK");
  });
});

describe("heuristicMap", () => {
  const paths = new Set(["personal.firstName", "personal.email", "address.primary.postcode", "address.primary.country"]);
  it("maps standard autocomplete tokens without an LLM call", () => {
    const hits = heuristicMap([
      { id: "a", kind: "text", autocomplete: "given-name", required: true },
      { id: "b", kind: "text", autocomplete: "shipping postal-code", required: false },
      { id: "c", kind: "select", autocomplete: "country", required: true },
      { id: "d", kind: "text", label: "Forename", required: true },
    ], paths);
    expect(hits.map((h) => [h.fieldId, h.profilePath])).toEqual([
      ["a", "personal.firstName"], ["b", "address.primary.postcode"], ["c", "address.primary.country"],
    ]);
    expect(hits.find((h) => h.fieldId === "c")?.transform).toBe("country:alpha2");
  });
  it("never maps hidden fields", () => {
    expect(heuristicMap([{ id: "h", kind: "hidden", autocomplete: "email", required: false }], paths)).toEqual([]);
  });
});

import { verifyTotp } from "../src/lib/totp.js";
describe("verifyTotp", () => {
  // RFC 6238 Appendix B: ASCII secret "12345678901234567890", T=59s → 94287082 (last 6 digits: 287082)
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  it("accepts the RFC test vector and rejects wrong codes", () => {
    expect(verifyTotp(secret, "287082", 59_000)).toBe(true);
    expect(verifyTotp(secret, "287083", 59_000)).toBe(false);
    expect(verifyTotp(secret, "abc", 59_000)).toBe(false);
  });
});

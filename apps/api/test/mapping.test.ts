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

import { extractCode } from "../src/services/email/emailParse.js";
describe("extractCode", () => {
  const cases: [string, string | null][] = [
    ["Your verification code is 482913. It expires in 10 minutes.", "482913"],
    ["<p>Enter the code <b>593017</b> to confirm your email.</p>", "593017"],
    ["Your one-time password: AB12CD", "AB12CD"],
    ["Confirmation code: 8831", "8831"],
    ["Your OTP is 246810 for Acme Portal", "246810"],
    ["Use 123456 to verify. Do not share this 6-digit code.", "123456"],
    ["Welcome to Acme — no code here, just a greeting from 2024.", "2024"], // falls back to a 4-digit block
    ["Thanks for signing up! Visit your dashboard.", null],
  ];
  it("pulls the code from typical verification emails", () => {
    for (const [body, want] of cases) expect(extractCode(body)).toBe(want);
  });
  it("prefers a code next to a keyword over an unrelated number", () => {
    expect(extractCode("Order 100043 confirmed. Your security code is 771290.")).toBe("771290");
  });
});

import { parseCsv } from "../src/lib/csv.js";
describe("parseCsv", () => {
  it("parses headers, quoted fields, embedded commas and newlines", () => {
    const csv = 'label,firstName,note\n"Smith, John",John,"line1\nline2"\nJane Doe,Jane,plain\n';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ label: "Smith, John", firstName: "John", note: "line1\nline2" });
    expect(rows[1]!.label).toBe("Jane Doe");
  });
  it("handles escaped quotes and a trailing row without newline", () => {
    const rows = parseCsv('a,b\n"he said ""hi""",x');
    expect(rows[0]).toEqual({ a: 'he said "hi"', b: "x" });
  });
  it("returns [] for empty input", () => { expect(parseCsv("")).toEqual([]); expect(parseCsv("\n\n")).toEqual([]); });
});

import { parseProxyString } from "../src/lib/proxy.js";
describe("parseProxyString", () => {
  it("parses the common list formats", () => {
    expect(parseProxyString("1.2.3.4:8080")).toEqual({ type: "http", host: "1.2.3.4", port: 8080 });
    expect(parseProxyString("1.2.3.4:8080:bob:secret")).toEqual({ type: "http", host: "1.2.3.4", port: 8080, username: "bob", password: "secret" });
    expect(parseProxyString("gb.proxy.example:9000:user1:p:a:ss")).toEqual({ type: "http", host: "gb.proxy.example", port: 9000, username: "user1", password: "p:a:ss" });
    expect(parseProxyString("bob:secret@1.2.3.4:8080")).toEqual({ type: "http", host: "1.2.3.4", port: 8080, username: "bob", password: "secret" });
    expect(parseProxyString("socks5://user:pass@10.0.0.1:1080")).toEqual({ type: "socks5", host: "10.0.0.1", port: 1080, username: "user", password: "pass" });
    expect(parseProxyString("https://proxy.example:443")).toEqual({ type: "https", host: "proxy.example", port: 443 });
  });
  it("rejects malformed proxies", () => {
    expect(parseProxyString("")).toBeNull();
    expect(parseProxyString("justhost")).toBeNull();
    expect(parseProxyString("1.2.3.4:notaport")).toBeNull();
    expect(parseProxyString("1.2.3.4:99999")).toBeNull();
  });
});

import { resolvrTaskBody } from "../src/services/captcha/providers/resolvr.js";
describe("resolvrTaskBody", () => {
  const base = { pageUrl: "https://site.example/form", siteKey: "6LcABC", userAgent: "UA",
    proxy: { type: "http", host: "1.2.3.4", port: 8080, username: "u", password: "p" } } as const;
  it("builds reCAPTCHA v2 / v3 / Turnstile bodies in Resolvr's snake_case shape", () => {
    expect(resolvrTaskBody({ ...base, kind: "recaptcha_v2" } as any)).toEqual({
      type: "recaptcha_v2", sitekey: "6LcABC", url: "https://site.example/form", proxy: "http://u:p@1.2.3.4:8080", user_agent: "UA" });
    expect(resolvrTaskBody({ ...base, kind: "recaptcha_v3", action: "checkout" } as any)).toMatchObject({
      type: "recaptcha_v3", sitekey: "6LcABC", data: { action: "checkout" } });
    expect(resolvrTaskBody({ ...base, kind: "turnstile" } as any)).toMatchObject({ type: "cloudflare_turnstile", sitekey: "6LcABC" });
  });
  it("formats a socks5 proxy with auth and handles the image task", () => {
    expect(resolvrTaskBody({ ...base, kind: "recaptcha_v2", proxy: { type: "socks5", host: "h", port: 1080, username: "a", password: "b" } } as any).proxy)
      .toBe("socks5://a:b@h:1080");
    expect(resolvrTaskBody({ kind: "image", pageUrl: "x", imageBase64: "ZZZ" } as any)).toEqual({ type: "botdeflector_image", image: "ZZZ" });
  });
});

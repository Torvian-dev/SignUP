/** Pure helpers for reading verification emails — no I/O, no config, safe to unit-test. */

const LINK_RE = /https?:\/\/[^\s"'<>]+(verify|confirm|activate|validation|token|email)[^\s"'<>]*/i;

/** Extract a confirmation link from an email body. */
export function extractLink(text: string): string | null {
  return text.match(LINK_RE)?.[0]?.replace(/&amp;/g, "&").replace(/=\r?\n/g, "").replace(/=3D/g, "=") ?? null;
}

/** Extract a one-time code from an email body/subject. Prefers a number next to a code-ish word. */
export function extractCode(text: string): string | null {
  const clean = text.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#8203;|&zwnj;/gi, " ").replace(/\s+/g, " ");
  // The code must contain a digit, so the match skips words like "password" and nearby prose and
  // lands on the real token (e.g. "AB12CD", "771290"), not an unrelated order number before the keyword.
  const keyed = clean.match(/(?:one[-\s]?time|verification|security|confirmation|auth(?:entication)?|login|access|OTP|PIN|code)\b[\s\S]{0,24}?\b((?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{4,8})\b/i);
  if (keyed) return keyed[1]!.toUpperCase();
  const six = clean.match(/(?<![0-9])([0-9]{6})(?![0-9])/);
  if (six) return six[1]!;
  const digits = clean.match(/(?<![0-9])([0-9]{4,8})(?![0-9])/);
  return digits ? digits[1]! : null;
}

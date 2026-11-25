import { createHmac, timingSafeEqual } from "node:crypto";

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s step) with ±1 step tolerance. `secret` is base32. */
export function verifyTotp(secretBase32: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const key = base32Decode(secretBase32);
  const counter = Math.floor(now / 30_000);
  return [-1, 0, 1].some((d) => {
    const expected = Buffer.from(hotp(key, counter + d));
    return timingSafeEqual(expected, Buffer.from(code));
  });
}

function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 1_000_000).padStart(6, "0");
}

function base32Decode(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

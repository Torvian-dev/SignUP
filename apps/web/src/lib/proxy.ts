export interface ParsedProxy { type: "http" | "https" | "socks5"; host: string; port: number; username?: string; password?: string }

/** Parse ip:port:user:pass and the other common proxy-list formats; null if unparseable. */
export function parseProxyString(raw: string): ParsedProxy | null {
  let s = (raw ?? "").trim();
  if (!s) return null;
  let type: ParsedProxy["type"] = "http";
  const scheme = s.match(/^([a-z0-9]+):\/\//i);
  if (scheme) { const sc = scheme[1]!.toLowerCase(); type = sc.startsWith("socks") ? "socks5" : sc === "https" ? "https" : "http"; s = s.slice(scheme[0].length); }
  let username: string | undefined, password: string | undefined, host: string | undefined, portStr: string | undefined;
  if (s.includes("@")) {
    const at = s.lastIndexOf("@"); const creds = s.slice(0, at); const hp = s.slice(at + 1).split(":");
    const ci = creds.indexOf(":"); if (ci >= 0) { username = creds.slice(0, ci); password = creds.slice(ci + 1); } else username = creds;
    host = hp[0]; portStr = hp[1];
  } else {
    const parts = s.split(":"); if (parts.length < 2) return null;
    host = parts[0]; portStr = parts[1];
    if (parts.length >= 4) { username = parts[2]; password = parts.slice(3).join(":"); } else if (parts.length === 3) username = parts[2];
  }
  const port = Number(portStr);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { type, host, port, username: username || undefined, password: password || undefined };
}

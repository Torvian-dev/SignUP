/**
 * Parse a proxy from the formats scrapers and proxy managers export:
 *   ip:port                         (no auth)
 *   ip:port:user:pass               (the common list format)
 *   host:port:user:pass
 *   user:pass@ip:port
 *   scheme://user:pass@ip:port      (scheme: http | https | socks5 | socks4)
 *   scheme://ip:port:user:pass
 * Returns null if it can't be parsed into host + valid port.
 */
export interface ParsedProxy {
  type: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export function parseProxyString(raw: string): ParsedProxy | null {
  let s = (raw ?? "").trim();
  if (!s) return null;

  let type: ParsedProxy["type"] = "http";
  const scheme = s.match(/^([a-z0-9]+):\/\//i);
  if (scheme) {
    const sc = scheme[1]!.toLowerCase();
    type = sc.startsWith("socks") ? "socks5" : sc === "https" ? "https" : "http";
    s = s.slice(scheme[0].length);
  }

  let username: string | undefined;
  let password: string | undefined;
  let host: string | undefined;
  let portStr: string | undefined;

  if (s.includes("@")) {
    // creds@host:port
    const at = s.lastIndexOf("@");
    const creds = s.slice(0, at);
    const hostport = s.slice(at + 1);
    const ci = creds.indexOf(":");
    if (ci >= 0) { username = creds.slice(0, ci); password = creds.slice(ci + 1); } else username = creds;
    const hp = hostport.split(":");
    host = hp[0]; portStr = hp[1];
  } else {
    const parts = s.split(":");
    if (parts.length < 2) return null;
    host = parts[0]; portStr = parts[1];
    if (parts.length >= 4) { username = parts[2]; password = parts.slice(3).join(":"); } // password may contain ':'
    else if (parts.length === 3) username = parts[2];
  }

  const port = Number(portStr);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { type, host, port, username: username || undefined, password: password || undefined };
}

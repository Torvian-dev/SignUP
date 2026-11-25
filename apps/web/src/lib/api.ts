import "server-only";
import { cookies, headers } from "next/headers";
import { getToken } from "next-auth/jwt";

const API = process.env.API_INTERNAL_URL!;

export async function accessToken(): Promise<string> {
  const h = await headers();
  const c = await cookies();
  const token = await getToken({
    req: { headers: Object.fromEntries(h.entries()), cookies: Object.fromEntries(c.getAll().map((x) => [x.name, x.value])) } as any,
    secret: process.env.AUTH_SECRET!,
    secureCookie: process.env.NODE_ENV === "production",
  });
  if (!token?.at) throw new Error("not authenticated");
  return token.at as string;
}

/** Server Components / Route Handlers → Express API with the user's bearer token. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API}/v1${path}`, {
    ...init,
    cache: "no-store",
    headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken()}`, ...(init.headers ?? {}) },
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `API ${r.status}`);
  }
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T);
}

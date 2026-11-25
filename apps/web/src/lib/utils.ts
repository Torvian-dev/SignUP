import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const fetcher = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message ?? `HTTP ${r.status}`);
  return r.json();
};

export async function send<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message ?? `HTTP ${r.status}`);
  return (r.status === 204 ? undefined : await r.json()) as T;
}

export const pct = (n?: number | string | null) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);

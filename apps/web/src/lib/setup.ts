import "server-only";

const API = process.env.API_INTERNAL_URL!;
const INT = process.env.INTERNAL_EXCHANGE_SECRET!;

/** True on a brand-new install with no accounts yet. */
export async function needsSetup(): Promise<boolean> {
  try {
    const r = await fetch(`${API}/v1/auth/setup-status`, {
      method: "POST", cache: "no-store",
      headers: { "content-type": "application/json", "x-internal-secret": INT },
    });
    if (!r.ok) return false;
    return ((await r.json()) as { needsSetup?: boolean }).needsSetup === true;
  } catch {
    return false;
  }
}

/** Create the first owner account. Throws a readable message on failure. */
export async function createFirstUser(input: { email: string; name?: string; password: string }): Promise<void> {
  const r = await fetch(`${API}/v1/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": INT },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(e?.error?.message ?? "could not create the account");
  }
}

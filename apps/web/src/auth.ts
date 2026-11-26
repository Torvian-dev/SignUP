/**
 * Auth.js v5. Providers: Microsoft Entra ID (M365 tenants), Google, email+password (+TOTP).
 * No database adapter: the API owns the users/accounts tables. OAuth identities are resolved to our
 * user id via POST /v1/auth/oauth-upsert (server-to-server).
 * After sign-in the *server-side* jwt callback exchanges the identity for API tokens
 * (ES256 access 15 min + rotating refresh). Tokens live only in the encrypted Auth.js
 * session cookie (httpOnly, Secure, SameSite=Lax) — never in localStorage.
 */
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { z } from "zod";

const API = process.env.API_INTERNAL_URL!;
const INTERNAL = process.env.INTERNAL_EXCHANGE_SECRET!;

declare module "next-auth" {
  interface Session { user: { id: string } & DefaultSession["user"]; error?: string }
}

async function exchange(userId: string) {
  const r = await fetch(`${API}/v1/auth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": INTERNAL },
    body: JSON.stringify({ userId }),
  });
  if (!r.ok) throw new Error("token exchange failed");
  return (await r.json()) as { accessToken: string; refreshToken: string; expiresIn: number };
}

async function oauthUser(provider: string, providerAccountId: string, user: { email?: string | null; name?: string | null; image?: string | null }) {
  const r = await fetch(`${API}/v1/auth/oauth-upsert`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": INTERNAL },
    body: JSON.stringify({ provider, providerAccountId, email: user.email, name: user.name, image: user.image }),
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as any)?.error?.message ?? "sign-in failed");
  return ((await r.json()) as { userId: string }).userId;
}

export const oauthEnabled = {
  microsoft: !!(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER),
  google: !!process.env.AUTH_GOOGLE_ID,
};

function claims(accessToken: string): { org: string } {
  return JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 }, // 30-day session: stay signed in on a personal install
  pages: { signIn: "/login" },
  providers: [
    // OAuth providers are enabled only when configured, so a missing app registration never breaks sign-in.
    ...(oauthEnabled.microsoft ? [MicrosoftEntraID({ allowDangerousEmailAccountLinking: false })] : []),
    ...(oauthEnabled.google ? [Google] : []),
    Credentials({
      credentials: { email: {}, password: {}, totp: {} },
      authorize: async (raw) => {
        const c = z.object({ email: z.string().email(), password: z.string().min(1), totp: z.string().optional() }).parse(raw);
        const r = await fetch(`${API}/v1/auth/verify-password`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-internal-secret": INTERNAL },
          body: JSON.stringify({ email: c.email, password: c.password, totp: c.totp }),
        });
        if (!r.ok) return null;
        const { userId } = (await r.json()) as { userId: string };
        return { id: userId, email: c.email };
      },
    }),
  ],
  callbacks: {
    // Used by the middleware (export { auth as middleware }) to gate every matched route:
    // no session → redirect to pages.signIn ("/login"), which forwards to "/setup" on first run.
    // Without this, Auth.js v5 lets unauthenticated requests through and protected pages throw.
    authorized({ auth }) {
      return !!auth?.user;
    },
    async jwt({ token, user, account }) {
      if (user && account) {
        const userId = account.type === "credentials" ? user.id! : await oauthUser(account.provider, account.providerAccountId, user);
        const t = await exchange(userId);
        return { ...token, uid: userId, at: t.accessToken, rt: t.refreshToken, exp_at: Date.now() + t.expiresIn * 1000, org: claims(t.accessToken).org };
      }
      if (Date.now() < (token.exp_at as number) - 60_000) return token;
      // Rotate refresh token
      const r = await fetch(`${API}/v1/auth/refresh`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: token.rt, orgId: token.org }),
      });
      if (!r.ok) return { ...token, error: "RefreshFailed" };
      const t = (await r.json()) as { accessToken: string; refreshToken: string; expiresIn: number };
      return { ...token, at: t.accessToken, rt: t.refreshToken, exp_at: Date.now() + t.expiresIn * 1000 };
    },
    async session({ session, token }) {
      session.user.id = token.uid as string;
      if (token.error) session.error = token.error as string;
      return session; // access token deliberately NOT exposed to the client
    },
  },
});

/** Server-only helper: read the API access token from the encrypted session JWT. */
export { getToken } from "next-auth/jwt";

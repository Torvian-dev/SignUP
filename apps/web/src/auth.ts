/**
 * Auth.js v5. Providers: Microsoft Entra ID (M365 tenants), Google, email+password (+TOTP).
 * After sign-in the *server-side* jwt callback exchanges the identity for API tokens
 * (ES256 access 15 min + rotating refresh). Tokens live only in the encrypted Auth.js
 * session cookie (httpOnly, Secure, SameSite=Lax) — never in localStorage.
 */
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import PostgresAdapter from "@auth/pg-adapter";
import { Pool } from "pg";
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

function claims(accessToken: string): { org: string } {
  return JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(new Pool({ connectionString: process.env.DATABASE_URL })),
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  providers: [
    MicrosoftEntraID({ allowDangerousEmailAccountLinking: false }),
    Google,
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
    async jwt({ token, user }) {
      if (user?.id) {
        const t = await exchange(user.id);
        return { ...token, uid: user.id, at: t.accessToken, rt: t.refreshToken, exp_at: Date.now() + t.expiresIn * 1000, org: claims(t.accessToken).org };
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

/**
 * Backend-for-frontend proxy. Client components call /api/v1/* (same origin, cookie auth);
 * this handler attaches the bearer token server-side and streams the response through
 * (works for JSON, PNG screenshots and Server-Sent Events alike).
 */
import { NextRequest } from "next/server";
import { accessToken } from "@/lib/api";

const API = process.env.API_INTERNAL_URL!;

async function forward(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path[0] === "auth") return new Response("not found", { status: 404 }); // auth endpoints are server-to-server only
  let token: string;
  try { token = await accessToken(); } catch { return new Response("unauthenticated", { status: 401 }); }
  const target = `${API}/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const upstream = await fetch(target, {
    method: req.method,
    headers: { authorization: `Bearer ${token}`, "content-type": req.headers.get("content-type") ?? "application/json",
               "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "" },
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.text(),
    // @ts-expect-error Node fetch streaming option
    duplex: "half",
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
export const dynamic = "force-dynamic";

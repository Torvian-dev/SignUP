export { auth as middleware } from "@/auth";

// Everything except login, Auth.js routes and static assets requires a session.
export const config = { matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"] };

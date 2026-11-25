export { auth as middleware } from "@/auth";

// Everything except login, Auth.js routes and static assets requires a session.
export const config = { matcher: ["/((?!login|setup|api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon-|apple-touch).*)"] };

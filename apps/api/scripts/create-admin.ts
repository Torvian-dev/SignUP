/**
 * Create the first owner login (and its organisation) for email + password sign-in.
 *
 *   npm run create-admin -- --email you@company.com --org "Acme Ltd"
 *
 * Prompts for the password (not echoed, not stored in shell history). Use --password-stdin for automation.
 * Idempotent per email: re-running resets that user's password.
 */
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { db } from "../src/lib/db.js";
import { createOwner } from "../src/services/auth/adminSetup.js";

const { values } = parseArgs({ options: { email: { type: "string" }, org: { type: "string" }, name: { type: "string" }, "password-stdin": { type: "boolean" } } });
if (!values.email) { console.error("usage: npm run create-admin -- --email you@company.com [--org \"Name\"] [--name \"Your Name\"]"); process.exit(1); }

async function readPassword(): Promise<string> {
  if (values["password-stdin"]) {
    let data = ""; for await (const chunk of process.stdin) data += chunk; return data.trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  (rl as any)._writeToOutput = (s: string) => { if (s.includes("Password")) process.stdout.write(s); };
  const pw = await new Promise<string>((r) => rl.question("Password (min 12 chars): ", r));
  rl.close(); process.stdout.write("\n");
  return pw;
}

const password = await readPassword();
if (password.length < 12) { console.error("password must be at least 12 characters"); process.exit(1); }

const r = await createOwner({ email: values.email, password, name: values.name, org: values.org });
console.log(r.created ? `Created owner ${values.email}` : `Password reset for ${values.email}`);
await db.end();

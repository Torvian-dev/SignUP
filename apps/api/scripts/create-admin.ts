/**
 * Create the first owner login (and its organisation) for email + password sign-in.
 *
 *   npm run create-admin -- --email you@company.com --org "Acme Ltd"
 *
 * Prompts for the password (not echoed, not stored in shell history). Use --password-stdin for automation.
 * Idempotent per email: re-running resets that user's password.
 */
import argon2 from "argon2";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { db } from "../src/lib/db.js";
import { createOrgDek } from "../src/lib/crypto.js";

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
const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });

const email = values.email.toLowerCase();
const existing = (await db.query("SELECT id FROM users WHERE email=$1", [email])).rows[0];
if (existing) {
  await db.query("UPDATE users SET password_hash=$2, is_disabled=false WHERE id=$1", [existing.id, hash]);
  console.log(`Password reset for ${email}`);
} else {
  const user = (await db.query("INSERT INTO users (email, name, password_hash, email_verified) VALUES ($1,$2,$3, now()) RETURNING id",
    [email, values.name ?? null, hash])).rows[0];
  const dek = await createOrgDek();
  const orgName = values.org ?? `${email.split("@")[1]} workspace`;
  const org = (await db.query("INSERT INTO organizations (name, slug, dek_wrapped, dek_key_version) VALUES ($1,$2,$3,$4) RETURNING id",
    [orgName, `${orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`, dek.wrapped, dek.keyVersion])).rows[0];
  await db.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,'owner')", [org.id, user.id]);
  await db.query("INSERT INTO org_policies (org_id) VALUES ($1)", [org.id]);
  console.log(`Created owner ${email} in organisation "${orgName}"`);
}
await db.end();

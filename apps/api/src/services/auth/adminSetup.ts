/**
 * First-owner creation, shared by the `create-admin` CLI and the Docker first-boot bootstrap.
 * Creating an owner also provisions their organisation (with its own wrapped DEK) and default policy.
 */
import argon2 from "argon2";
import { createOrgDek } from "../../lib/crypto.js";
import { db } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";

export async function createOwner(input: { email: string; password: string; name?: string; org?: string }): Promise<{ created: boolean; userId: string }> {
  const email = input.email.toLowerCase().trim();
  if (input.password.length < 12) throw new Error("password must be at least 12 characters");
  const hash = await argon2.hash(input.password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });

  const existing = (await db.query("SELECT id FROM users WHERE email=$1", [email])).rows[0];
  if (existing) {
    await db.query("UPDATE users SET password_hash=$2, is_disabled=false WHERE id=$1", [existing.id, hash]);
    return { created: false, userId: existing.id };
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const user = (await client.query(
      "INSERT INTO users (email, name, password_hash, email_verified) VALUES ($1,$2,$3, now()) RETURNING id",
      [email, input.name ?? null, hash])).rows[0];
    const dek = await createOrgDek();
    const orgName = input.org ?? `${email.split("@")[1]} workspace`;
    const org = (await client.query(
      "INSERT INTO organizations (name, slug, dek_wrapped, dek_key_version) VALUES ($1,$2,$3,$4) RETURNING id",
      [orgName, `${orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${Date.now().toString(36)}`, dek.wrapped, dek.keyVersion])).rows[0];
    await client.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,'owner')", [org.id, user.id]);
    await client.query("INSERT INTO org_policies (org_id) VALUES ($1)", [org.id]);
    await client.query("COMMIT");
    return { created: true, userId: user.id };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * On first boot (Docker), create the owner from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD,
 * but only when there are no users yet. A no-op on every later boot.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  const { rows } = await db.query<{ n: string }>("SELECT count(*) AS n FROM users");
  if (Number(rows[0]!.n) > 0) return;
  try {
    await createOwner({ email, password, name: process.env.BOOTSTRAP_ADMIN_NAME, org: process.env.BOOTSTRAP_ADMIN_ORG });
    logger.warn({ email }, "bootstrap: created first owner — sign in and change the password");
  } catch (err) {
    logger.error({ err }, "bootstrap admin creation failed");
  }
}

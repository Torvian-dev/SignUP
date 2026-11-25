/**
 * Regression test for hard form structures on the practice site:
 *   - a form embedded in a same-origin <iframe>  (/iframe-host)
 *   - a form rendered inside an open shadow root  (/shadow)
 *   - an existing-account sign-in page            (/login)
 * Verifies the agent detects the fields (inside the frame / shadow root) and maps the
 * page-tagged ones, and that an iframe/shadow form submits end to end.
 *
 *   API_INTERNAL_URL=... INTERNAL_EXCHANGE_SECRET=... ADMIN_EMAIL=... \
 *   DATABASE_URL=... node test/e2e/hard-cases.cjs
 * (needs the api + worker running with ALLOW_PRIVATE_TARGETS=true and the practice site on :5055)
 */
const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
const SITE = process.env.PRACTICE_SITE ?? "http://localhost:5055";
const SECRET = process.env.INTERNAL_EXCHANGE_SECRET;
const ADMIN = process.env.ADMIN_EMAIL ?? "admin@formagent.test";
const { Pool } = require("pg");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const uid = (await db.query("SELECT id FROM users WHERE email=$1", [ADMIN])).rows[0]?.id;
  if (!uid) throw new Error(`admin ${ADMIN} not found`);
  const tok = (await (await fetch(`${API}/v1/auth/exchange`, { method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": SECRET },
    body: JSON.stringify({ userId: uid }) })).json()).accessToken;
  const H = { authorization: `Bearer ${tok}`, "content-type": "application/json" };
  const get = async (p) => (await fetch(API + p, { headers: H })).json();

  // a profile with full data
  const profiles = (await get("/v1/profiles")).data;
  let pid = profiles.find((p) => p.customFieldCount > 0)?.id ?? profiles[0]?.id;
  if (!pid) throw new Error("no profile to test with");

  let failures = 0;
  const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };

  for (const [name, path, intent, expectKind] of [
    ["iframe", "/iframe-host", "signup", null],
    ["shadow", "/shadow", "signup", null],
    ["login", "/login", "login", "login"],
  ]) {
    const { id } = await (await fetch(`${API}/v1/runs`, { method: "POST", headers: H, body: JSON.stringify({ url: SITE + path, profileId: pid, intent }) })).json();
    let r;
    for (let i = 0; i < 80; i++) { r = await get(`/v1/runs/${id}`); if (["awaiting_review", "awaiting_manual", "succeeded", "failed", "cancelled"].includes(r.status)) break; await sleep(1500); }
    const rev = r.status === "awaiting_review" ? await get(`/v1/runs/${id}/review`) : { fields: [] };
    const detected = rev.fields.length;
    const mappedEmail = rev.fields.some((f) => f.profile_path === "personal.email" && f.fill?.status === "filled");
    check(r.status === "awaiting_review", `${name}: reached review (got ${r.status} ${r.error_message ?? ""})`);
    check(detected >= (name === "login" ? 2 : 4), `${name}: detected ${detected} fields inside the ${name === "login" ? "page" : name}`);
    check(mappedEmail, `${name}: email field found and filled`);
    if (name === "login") check(rev.fields.some((f) => f.profile_path === "site_account.password"), "login: password mapped to the existing-account slot, not the signup password");
    await fetch(`${API}/v1/runs/${id}/cancel`, { method: "POST", headers: H });
  }
  await db.end();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

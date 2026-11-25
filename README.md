# FormAgent: AI Form Automation Agent

Enter your details once. Paste a URL. The agent opens the site, finds the form (following "Sign up" links and multi-step flows), maps every field to your saved profile by meaning, fills it, handles CAPTCHAs, and stops for your review. You approve, it submits, and every correction you make trains the next run.

```
URL + profile ─► analyse page ─► map (memory → heuristics → Claude/OpenAI/Gemini) ─► fill & validate
             ─► CAPTCHA (provider failover → live view) ─► REVIEW ─► approve ─► submit ─► learn
```

## Repository map

| Path | What |
|---|---|
| `apps/api` | Express + TypeScript API **and** the Playwright automation worker (`src/worker-main.ts`) |
| `apps/web` | Next.js 15 + Tailwind + shadcn/ui + Auth.js dashboard |
| `apps/navigator` | Browser Use sidecar (Python) for open-ended navigation only |
| `db/migrations` | PostgreSQL 16 schema (RLS, pgvector, hash-chained audit log), plus `db/migrate.sh` |
| `infra/docker`, `docker-compose.yml` | Images and local stack |
| `infra/k8s` | AKS manifests (workload identity, Key Vault CSI, KEDA, network policies) |
| `.github/workflows/ci-cd.yml` | CI → images → staging → gated production |
| `docs/` | Blueprint documents (see below) |

## Deliverables index

| # | Deliverable | Location |
|---|---|---|
| 1–2 | Product and technical architecture, diagrams | [docs/ARCHITECTURE.md §1–3](docs/ARCHITECTURE.md) |
| 3–4 | Database schema and PostgreSQL scripts | [docs/ARCHITECTURE.md §9](docs/ARCHITECTURE.md#9-database-design) · [db/migrations/0001_init.sql](db/migrations/0001_init.sql) |
| 5 | API specification | [docs/API.md](docs/API.md) |
| 6–7 | Next.js and backend folder structure | [docs/ARCHITECTURE.md §10](docs/ARCHITECTURE.md#10-folder-structures) |
| 8–9 | Browser Use and Playwright architecture | [docs/ARCHITECTURE.md §4–5](docs/ARCHITECTURE.md) · `apps/api/src/automation/` · `apps/navigator/` |
| 10 | CAPTCHA handling architecture | [docs/ARCHITECTURE.md §6](docs/ARCHITECTURE.md) · `apps/api/src/services/captcha/` |
| 11–12 | AI mapping and learning system | [docs/ARCHITECTURE.md §7–8](docs/ARCHITECTURE.md) · `services/ai/`, `services/learning/` |
| 13 | Dashboard wireframes | [docs/WIREFRAMES.md](docs/WIREFRAMES.md) · implemented in `apps/web/src/app/(app)/` |
| 14–15 | Authentication and security architecture | [docs/SECURITY.md](docs/SECURITY.md) |
| 16–19 | Azure, Docker, Kubernetes, CI/CD | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| 20–21 | MVP and Phase 2 roadmap | [docs/ROADMAP.md](docs/ROADMAP.md) |
| 22 | Infrastructure cost estimate | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#estimated-infrastructure-costs-monthly-uk-south-pay-as-you-go-list-prices--planning-estimates-only) |
| 23 | Production code for every major component | `apps/*` |

## Try it on the practice site (about 5 minutes)

A fictional "Acme Supplier Portal" ships with the repo. It has a landing page without a form, a 3-step registration with unusual labels, a hidden trap field, a date in DD/MM/YYYY format, a country dropdown and a click-to-verify CAPTCHA.

```bash
# 1. Infrastructure + schema
./scripts/dev-secrets.sh > .env
echo "ALLOW_PRIVATE_TARGETS=true" >> .env           # dev only: lets the agent open http://localhost pages
docker compose up -d postgres redis
docker compose run --rm migrate                      # creates the schema (safe to re-run)
set -a; . ./.env; set +a; export DATABASE_URL=postgres://formagent:formagent@localhost:5432/formagent REDIS_URL=redis://localhost:6379 API_INTERNAL_URL=http://localhost:4000 AUTH_URL=http://localhost:3000 NAVIGATOR_URL=http://localhost:8088
(cd apps/api && npm ci && npx playwright install chromium)

# 2. Your first login (prompts for a password, min 12 characters)
(cd apps/api && npm run create-admin -- --email you@company.com --org "Your Company")

# 3. Run everything (four terminals, or append & to each)
(cd apps/api && node test/practice-site/server.mjs)  # practice site  → http://localhost:5055
(cd apps/api && npm run dev)                          # API            → :4000
(cd apps/api && npm run dev:worker)                   # browser agent
(cd apps/web && npm ci && npm run dev)                # web app        → http://localhost:3000
```

Then sign in at http://localhost:3000 and follow these steps:

1. Go to **Profiles** → **New profile**. Add your details, plus the **Date of Birth** and **Business Name** custom fields.
2. Go to **New automation**, enter the URL `http://localhost:5055/` and press **Start agent**.
3. On each review screen, use **Correct it** for anything left empty, then press **Approve & submit**.
4. When the live view appears, click the "I'm not a robot" box in the picture, check it shows ☑, then press **Done**.
5. Visit http://localhost:5055/submissions to see exactly what the site received.
6. Run it again. Fields you corrected are now filled from memory.

Add an AI key under **API keys** (Claude, OpenAI or Gemini) and the agent maps unfamiliar fields itself on the first visit. Without one it uses memory and standard field hints, and leaves the rest for you on the review screen.

### Batch sign-ups (one website, many profiles)

For a roster of real people — e.g. signing up a team of employees — enable **Policy & guardrails → Automatic submission**, then go to **Batch sign-ups → New batch**: paste the URL, tick the profiles, and set a quantity. The agent creates one account per profile, in order, each using that profile's own email and proxy, submitting automatically and moving on once the success page appears. A profile is **skipped** (never guessed) if a required field is uncertain or a CAPTCHA can't be solved automatically (CAPTCHA-gated sites need a solving-provider key). One account per profile per website still applies — it does not loop a single profile.

Automated version:
`E2E_PASSWORD=... node apps/api/test/e2e/batch-run.cjs` — creates 3 profiles and runs a batch through a local proxy.

**Automated version** of the single-run test (drives the real UI and saves screenshots):
`E2E_PASSWORD=... node apps/api/test/e2e/practice-run.cjs` (with Playwright installed).

## Run it on your PC

Install Docker Desktop, then double-click **`Start FormAgent.command`** (Mac) or **`start-formagent.bat`** (Windows) — or run `./try-it.sh`. Your PC runs everything; you use it at `http://localhost:3000`. A practice website is bundled so you can try it with no API keys. Step-by-step (download, install, use): **[TRY-IT.md](TRY-IT.md)**.

## Quick start (local, without Docker)

```bash
./scripts/dev-secrets.sh > .env          # dev keys; add AUTH_GOOGLE_* / AUTH_MICROSOFT_ENTRA_ID_* for OAuth
docker compose up -d postgres && docker compose run --rm migrate
docker compose up --build                # postgres+pgvector, redis, api, worker, navigator, web
# first login (runs on your machine against the compose database):
(cd apps/api && npm ci && set -a && . ../../.env && set +a && \
  DATABASE_URL=postgres://formagent:formagent@localhost:5432/formagent npm run create-admin -- --email you@company.com)
open http://localhost:3000
```

Without Docker:

```bash
cd apps/api && npm ci && DATABASE_URL=postgres://… npm run migrate && npm run dev   # + npm run dev:worker
cd apps/web && npm ci && npm run dev
```

## Verified in this repo

* **Batch sign-ups:** a 3-profile roster created 3 accounts fully automatically against the practice site (no human click), one at a time, each through its own proxy and email; the site received all three with correct data. Re-running stored exactly one account per profile.
* **End to end on the practice site:** 7 single runs through the real UI (sign-in → profile → run → review → live-view CAPTCHA → approve → submit). The site received every value correctly: names, email, phone, company, address, `GB` country code, date reformatted to `07/03/1985`, a generated 20-character password, terms ticked, marketing left unticked and the hidden trap field empty. Run 1 needed 9 manual corrections; every later run needed none.

* `apps/api`: `tsc --noEmit` is clean, and `vitest` passes (transforms, autocomplete heuristics).
* `apps/web`: `tsc --noEmit` is clean, and `next build` succeeds (all 14 routes).
* `db/migrate.sh` applies the schema on PostgreSQL 16 + pgvector, and a second run is a no-op. Tested in SQL:
  * RLS hides org A's profile from org B.
  * Each audit-log row's `prev_hash` matches the previous row's `row_hash`.
  * The app role cannot update the audit log.

**Not yet exercised:** real third-party websites, and live calls to the AI, CAPTCHA-provider, email and Azure APIs. These need real keys; the practice-site runs above used no AI key and solved the CAPTCHA through the reviewer's live view. The DeathByCaptcha, BestCaptchaSolver and CapSolver adapters follow those providers' public API references; confirm their endpoint and task-type names before go-live. DispurCaptcha and Resolvr use the shared task-submission adapter with an admin-supplied base URL. If either uses a different protocol, it needs a dedicated adapter like `capsolver.ts`.

## Design decisions worth knowing

* **Human approval before every final submission.** The agent auto-advances "Next/Continue" steps only when every required field clears the confidence bar. Submit, Register, Apply and Pay always wait for a person.
* **Profile values never reach an LLM.** The model sees field labels and slot names only. Values are substituted inside the worker.
* **One proxy and one stable browser identity per profile.** Cookies persist between runs, so logins and half-finished applications can be resumed.
* **Guardrails:** one account per profile per website, per-site daily caps, a CAPTCHA spend cap, and a domain blocklist. All are configurable under *Policy & guardrails*.

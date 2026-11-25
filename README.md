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

## Quick start (local)

```bash
./scripts/dev-secrets.sh > .env          # dev keys; add AUTH_GOOGLE_* / AUTH_MICROSOFT_ENTRA_ID_* for OAuth
docker compose up --build                # postgres+pgvector, redis, api, worker, navigator, web
open http://localhost:3000               # sign in → Admin → API keys → add Claude (and a CAPTCHA provider)
```

Without Docker:

```bash
cd apps/api && npm ci && DATABASE_URL=postgres://… npm run migrate && npm run dev   # + npm run dev:worker
cd apps/web && npm ci && npm run dev
```

## Verified in this repo

* `apps/api`: `tsc --noEmit` is clean, and `vitest` passes (transforms, autocomplete heuristics).
* `apps/web`: `tsc --noEmit` is clean, and `next build` succeeds (all 14 routes).
* `db/migrate.sh` applies the schema on PostgreSQL 16 + pgvector, and a second run is a no-op. Tested in SQL:
  * RLS hides org A's profile from org B.
  * Each audit-log row's `prev_hash` matches the previous row's `row_hash`.
  * The app role cannot update the audit log.

**Not yet exercised end to end:** live runs against real sites, and live calls to the AI, CAPTCHA, email and Azure APIs. These need real keys. The DeathByCaptcha, BestCaptchaSolver and CapSolver adapters follow those providers' public API references; confirm their endpoint and task-type names before go-live. DispurCaptcha and Resolvr use the shared task-submission adapter with an admin-supplied base URL. If either uses a different protocol, it needs a dedicated adapter like `capsolver.ts`.

## Design decisions worth knowing

* **Human approval before every final submission.** The agent auto-advances "Next/Continue" steps only when every required field clears the confidence bar. Submit, Register, Apply and Pay always wait for a person.
* **Profile values never reach an LLM.** The model sees field labels and slot names only. Values are substituted inside the worker.
* **One proxy and one stable browser identity per profile.** Cookies persist between runs, so logins and half-finished applications can be resumed.
* **Guardrails:** one account per profile per website, per-site daily caps, a CAPTCHA spend cap, and a domain blocklist. All are configurable under *Policy & guardrails*.

# Roadmap

Covers deliverables 20 and 21.

## MVP (12 weeks, team: 2 full-stack, 1 automation engineer, 0.5 designer, 0.5 DevOps)

| Weeks | Milestone | Exit criteria |
|---|---|---|
| 1–2 | **Foundations**: monorepo, Azure landing zone (Bicep), AKS, PG, Redis, KV, CI/CD to staging, Auth.js (Entra ID + Google + password), JWT exchange, RBAC, RLS, audit log | Login works on staging; RLS and audit-chain tests in CI |
| 3–4 | **Profiles & vault**: envelope encryption, profile CRUD + custom fields + one proxy per profile, document upload, provider-key admin with test/rotate | Profile round-trips encrypted; keys masked; rotation grace verified |
| 5–7 | **Agent core**: page analyser (frames, shadow DOM, modals), mapping engine (heuristics + Claude/OpenAI/Gemini failover), form filler + validation, review screen, approve → submit, SSE activity | 80 % of fields correct at first pass on a 30-site benchmark set; human approval enforced |
| 8–9 | **Multi-step & accounts**: auto-advance, checkpoints/resume, persistent browser state, site-account vault, email verification (Graph/IMAP), sign-up link discovery | 10 multi-step benchmark flows complete end to end |
| 9–10 | **CAPTCHA**: detection for all types; 2Captcha, CapSolver, Anti-Captcha, CapMonster, DBC, BCS, DispurCaptcha/Resolvr (compatible adapter); failover, budget, live-view escalation, metrics | Each type passes on the provider demo pages; escalation path works |
| 10–11 | **Learning & dashboard**: domain memory, calibration, corrections, KPIs, charts, provider usage, API status | A second run on the same site uses memory for ≥ 90 % of fields |
| 12 | **Hardening & launch**: pen test, load test (50 concurrent runs), runbooks, alerts, DPIA/GDPR records, pricing page | No high/critical findings; SLOs agreed |

**Out of MVP:** Browser Use navigator (stub only), semantic memory, site playbooks, team approvals, browser extension.

## Phase 2 (months 4–9)

1. **Browser Use navigator in production** for no-form landing pages and complex SPAs, with step budgets and a vision fallback.
2. **Semantic memory and anonymised global learning**: opt-in cross-tenant patterns (signature → slot only, no values) so a new customer starts warm.
3. **Site playbooks**: replay learned multi-step navigation, and detect when a site redesign breaks a playbook.
4. **Batch runs**: one URL × many profiles, or many URLs × one profile, with a queue UI and per-batch review ("approve all ≥ 95 %").
5. **Approval workflows**: four-eyes approval for chosen domains, Slack/Teams approve buttons, and SLAs.
6. **Document intelligence**: parse uploaded CVs, certificates and IDs into profile fields (Claude vision), and auto-attach the right document to file inputs.
7. **Browser extension**: fill the tab the user already has open with the same mapping engine (for sites behind SSO the agent can't reach).
8. **Passkeys (WebAuthn)** for admins, SCIM provisioning, and SSO enforcement per org.
9. **Public API and webhooks** (`run.review_ready`, `run.succeeded`) plus Zapier/Make connectors.
10. **Multi-region** (EU/US data residency), warm-standby DR, and SOC 2 Type II.
11. **Eval harness**: a nightly regression suite over stored corrections, per-provider accuracy, and automatic AI provider ordering by measured accuracy and cost.

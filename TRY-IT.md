# Try FormAgent

Run the whole thing on your own computer and click through it. A fictional practice website is bundled, so you need **no API keys** to try the core flow.

## 1. Install Docker

[Docker Desktop](https://docs.docker.com/get-docker/) (Mac/Windows/Linux). That's the only prerequisite.

## 2. Start it (one command)

```bash
./try-it.sh
```

First run builds the images and can take a few minutes. When it finishes it prints your **URL and admin login**, for example:

```
Open:     http://localhost:3000
Sign in:  admin@formagent.local
Password: <a random password it generated>
```

## 3. Try a run

1. **Profiles → New profile** (or **Import CSV**) — add your details and, optionally, a proxy as `ip:port:user:pass`.
2. **New automation** — URL: `http://practice:5055/register?captcha=off` → pick the profile → **Start agent**.
3. Watch the activity stream fill the form, then **review and Approve & submit**.
4. See what the site received at `http://localhost:5055/submissions`.

Other things to try: a **multi-step form** (`http://practice:5055/`), a **form in an iframe** (`/iframe-host`), a **shadow-DOM form** (`/shadow`), a **CAPTCHA** (`/register`, solved in the live view), a **code step** (`/verify-code`), and a **batch** (Profiles → import a CSV of several people → Batch sign-ups → select all).

> Use `http://practice:5055/...` as the URL you enter in the app (the agent reaches the practice site by that name). You can also open `http://localhost:5055` in your own browser to see it.

## Useful commands

```bash
docker compose logs -f api worker web    # watch logs (useful when reporting a glitch)
docker compose down                       # stop, keep data
docker compose down -v                    # stop and wipe all data
docker compose up -d --build              # rebuild after pulling changes
```

## What works without keys, and what needs them

- **Works now:** profiles, CSV import, running the agent on the practice site, multi-step/iframe/shadow/login forms, the review screen, batches, the dashboard. On a brand-new form the agent fills fields it recognises from standard tags or past corrections; anything it's unsure of is flagged for you to set.
- **Needs a key you add in Admin → API keys:**
  - **AI** (Claude / OpenAI / Gemini) — smart field-matching on sites it hasn't seen before.
  - **CAPTCHA** (CapSolver, etc.) — automatic solving. Without it, CAPTCHAs come to you in the live view.
  - **Email** (IMAP / Microsoft 365) — auto-reading verification links and codes.

## Reporting a glitch

Tell me, with as much of this as you can:

1. **What you did** — the page and the steps (e.g. "New automation → practice iframe URL → Start").
2. **What you expected** vs **what happened**.
3. A **screenshot** if it's visual.
4. For an error, the relevant **logs**: `docker compose logs --tail=50 api worker web`.

Small and specific is perfect — "the review screen showed X but the field was Y" is more useful than "it broke."

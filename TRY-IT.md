# Run FormAgent on your PC

Your PC runs everything (the database, the automation engine, the website). You use it through your normal web browser at `http://localhost:3000`. Nothing is public — it only runs on your machine.

A fictional practice website is bundled, so you can try the whole flow with **no API keys**.

---

## Step 1 — Install Docker Desktop (one time)

Download and install **Docker Desktop**: https://docs.docker.com/get-docker/
(Windows or Mac — pick your version, install, and open it once so it's running.)

Docker is what lets your PC run the whole system from one folder without installing databases or anything else by hand.

## Step 2 — Download the app

Get the project folder onto your PC, either way:

- **Easiest:** on the GitHub page, click the green **Code** button → **Download ZIP**, then unzip it. (Make sure you're on the `claude/ai-form-automation-saas-m493nl` branch, or whichever branch I tell you.)
- **Or with git:** `git clone <repo-url>` then `git checkout claude/ai-form-automation-saas-m493nl`

You now have a folder called `SignUP` (or similar) with all the files.

## Step 3 — Start it (double-click)

Open that folder and double-click:

- **Windows:** `start-formagent.bat`
- **Mac:** `Start FormAgent.command`

A window opens and shows progress. The **first run builds everything and can take a few minutes** (later starts take seconds). When it's ready it:

- opens `http://localhost:3000` in your browser, and
- prints your **admin email and password** in that window.

Sign in with those. (Change the password after first login under your account.)

> If double-click is blocked on Mac the first time: right-click the file → **Open** → **Open**. On Windows, if SmartScreen warns: **More info → Run anyway**.

## Step 4 — Use it

1. **Profiles → New profile** (or **Import CSV**) — add your details; a proxy can be pasted as `ip:port:user:pass`.
2. **New automation** — URL: `http://practice:5055/register?captcha=off` → pick the profile → **Start agent**.
3. Watch it fill the form, then **review → Approve & submit**. See what the site received at `http://localhost:5055/submissions`.

Other things to try: a form in an iframe (`/iframe-host`), a shadow-DOM form (`/shadow`), a CAPTCHA page (`/register`, solved in the live view), an email-code step (`/verify-code`), and a batch (import several people → **Batch sign-ups** → select all).

## Optional — make it a desktop app

In Chrome or Edge, with `http://localhost:3000` open, click the **Install** icon in the address bar (or menu → **Install FormAgent**). You get a FormAgent icon and a clean app window on your PC, instead of a browser tab. It still just talks to the engine running on your PC.

## Stopping and starting again

- **Stop:** double-click `Stop FormAgent.command` (Mac) / `stop-formagent.bat` (Windows). Your data is kept.
- **Start again:** double-click the Start launcher — it's quick after the first build.

---

## What works without keys, and what needs them

- **Works now:** profiles, CSV import, running the agent on the practice site, multi-step / iframe / shadow / login forms, review, batches, the dashboard.
- **Add a key in Admin → API keys for:**
  - **AI** (Claude / OpenAI / Gemini) — smart field-matching on sites it hasn't seen before.
  - **CAPTCHA** (CapSolver, etc.) — automatic solving (otherwise challenges come to you in the live view).
  - **Email** (IMAP / Microsoft 365) — auto-reading verification links and codes.

## Reporting a glitch

Tell me: what you did (page + steps), what you expected vs what happened, a screenshot if visual, and for errors the logs from a terminal in the folder:

```
docker compose logs --tail=50 api worker web
```

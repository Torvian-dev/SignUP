# Torv.io — Set Up From Scratch (Beginner Guide)

This guide takes you from **nothing** to a **running Torv.io app on your PC**, assuming you've never done it before. Follow it top to bottom.

Everything runs **on your own PC** (localhost). Nothing is public — the app is only reachable from your machine.

---

## 0. What you'll need (one-time)

| Thing | Why | Where |
|---|---|---|
| A **GitHub account** | Stores your copy of the code | https://github.com/signup |
| **Git for Windows** | Downloads code + updates | https://git-scm.com/download/win |
| **Docker Desktop** | Runs the whole app (database, engine, website) | https://docs.docker.com/get-docker/ |

You need **administrator rights** on the PC once (to turn on a Windows feature Docker needs). On your own home PC you almost always have this.

---

## 1. Put the code on your new GitHub account

You already have the project. To host it under a **new GitHub account**:

1. Sign in to the new GitHub account.
2. Top-right **+** → **New repository**.
   - **Name:** `torvio` (or anything)
   - Set it to **Private**.
   - Don't tick "Add a README".
   - Click **Create repository**.
3. GitHub shows you a page with a repo URL like `https://github.com/YOURNAME/torvio.git`. Keep that tab open.
4. On the PC that has the current code, open the project folder → right-click → **Open in Terminal**, and run (swap in your new repo URL):
   ```powershell
   git remote remove origin
   git remote add origin https://github.com/YOURNAME/torvio.git
   git push -u origin HEAD:main
   ```
   Sign in to the new GitHub account if asked. Your code is now on the new account on the `main` branch.

> Starting on a brand-new PC with no code at all? Skip to **Step 3** and clone from the new repo instead.

---

## 2. Install the software (one-time)

### Docker Desktop
1. Download from https://docs.docker.com/get-docker/ and run the installer.
2. **If it errors about "Virtual Machine Platform" not being enabled:**
   - Click **Start**, type **powershell**, **right-click → Run as administrator**.
   - Run: `wsl --install`
   - **Restart the PC**, then run the Docker installer again.
3. Open Docker Desktop once and let it finish starting (the whale icon in the system tray goes steady).

### Git for Windows
1. Download from https://git-scm.com/download/win, run it, click **Next** through every screen (all defaults are fine), **Install**, **Finish**.

---

## 3. Download the code to the PC

1. Make a folder you'll remember, e.g. `Documents\Torvio`.
2. Open that folder → right-click → **Open in Terminal** and run (your repo URL):
   ```powershell
   git clone https://github.com/YOURNAME/torvio.git .
   ```
   Sign in to GitHub if asked. You now have all the files in that folder.

---

## 4. Start it

1. Make sure **Docker Desktop is running** (whale icon steady in the tray).
2. In the project folder, **double-click `start-formagent.bat`**.
   - If Windows SmartScreen warns: **More info → Run anyway**.
3. A black window shows progress. **The first run builds everything and takes a few minutes** (later starts take seconds). It automatically creates your local secrets, sets up the database, and starts the app.
4. When it's ready it opens **http://localhost:3000** in your browser.

---

## 5. Create your login

1. The first screen is **"Create your account."**
2. Enter your **email + a password** (at least 12 characters). This is your owner login.
3. You're taken to the dashboard. **You stay signed in** — no need to log in again unless you deliberately sign out.

---

## 6. Make it a desktop app (optional, nice)

With `localhost:3000` open in Chrome/Edge:
- **⋯ menu → Apps → Install Torv.io** (or the install icon in the address bar).
- You get a Torv.io icon and a clean app window.

To add the launcher to your desktop: right-click `start-formagent.bat` → **Show more options → Send to → Desktop (create shortcut)**, and rename it "Start Torv.io".

---

## 7. Add your profiles

- **Profiles → New profile** to add one by hand, **or**
- **Profiles → Import CSV** to add many at once. Download the template on that screen for the exact columns. Each row is one profile; add a `proxy` column in `ip:port:user:pass` form to attach a proxy to each.
- **Bulk editing:** tick profiles in the list → use the bar at the top to **Assign proxies** (paste a list, mapped one-per-profile), **Edit field** (any column), or **Delete**.

---

## 8. Add your keys

Everything goes in the app — you never edit files.

- **API keys** (left menu) → add keys for your providers (AI, CAPTCHA, proxy, email).
- **Email (IMAP)** for reading verification codes: add an **SMTP/IMAP** email key — set **IMAP host** (e.g. `imap.gmail.com`), your mailbox username, and an **app password** (not your normal password). Use the **Test connection** button to check it.

---

## 9. Updating later (get new changes)

In the project folder, **double-click `update-torvio.bat`**. It pulls the latest code and rebuilds, **keeping your account and data**. Then refresh the app (**Ctrl+F5**).

> If `update-torvio.bat` pulls from the original branch and you moved to `main`, open the file in Notepad and change the branch name on the `git pull origin ...` line to `main`.

---

## 10. Stopping, starting, and your data

- **Stop:** double-click `stop-formagent.bat`. Your data is kept.
- **Start again:** double-click `start-formagent.bat` (quick after the first build).
- **Your data** lives in Docker on this PC. It survives restarts and updates.
- **Important:** your encryption keys live in a file called `.env` in the project folder. **Don't delete that folder or that file** — without it the app can't read your saved (encrypted) data. If you ever move to a new folder/PC, copy `.env` across too (and keep it private — it holds your secrets).

---

## Troubleshooting (things we hit before)

| Symptom | Fix |
|---|---|
| Docker installer: "Virtual Machine Platform not enabled" | Admin PowerShell → `wsl --install` → restart → reinstall Docker. |
| `start-formagent.bat` says Docker not found | Docker Desktop isn't installed or isn't running — open it first. |
| Browser shows **"Application error… server-side exception"** right after starting | The app loaded before it finished booting. Wait ~60s and refresh (Ctrl+F5). |
| Page still shows an old error after an update | Your browser cached it. Open a **private/incognito** window (Ctrl+Shift+N) to confirm, then clear the site's data, or close/reopen the installed app. |
| "invalid or expired token" | Go to `localhost:3000/login` and sign in again. (Login is set to stay valid, so this should be rare.) |
| `update-torvio.bat` builds in 2 seconds and nothing changed | The pull didn't fetch. In the folder's Terminal run `git pull origin main` explicitly, then run the launcher again. |
| "No space left on device" | Delete old Docker images: Docker Desktop → Images → remove unused ones; or run `docker system prune` in a terminal. |

---

## Quick reference

- **App:** http://localhost:3000
- **Start:** `start-formagent.bat`  •  **Stop:** `stop-formagent.bat`  •  **Update:** `update-torvio.bat`
- **Keys & settings:** all inside the app (no files to edit)
- **Keep safe:** the `.env` file in the project folder (your encryption keys)

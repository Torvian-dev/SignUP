#!/usr/bin/env bash
# One command to try FormAgent locally with Docker. Includes a practice site so no API keys are needed.
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null 2>&1 || { echo "Docker is required — install Docker Desktop: https://docs.docker.com/get-docker/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (comes with Docker Desktop)."; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is required to generate local secrets."; exit 1; }

if [ ! -f .env ]; then echo "→ Generating local secrets (.env)…"; ./scripts/dev-secrets.sh > .env; fi

echo "→ Starting database and cache…"
docker compose up -d postgres redis

echo "→ Applying the database schema…"
docker compose run --rm migrate

echo "→ Building and starting the app (first build can take a few minutes)…"
docker compose up -d --build api worker web practice

printf "→ Waiting for the app to come up"
for i in $(seq 1 90); do
  if curl -fsS http://localhost:3000/login >/dev/null 2>&1; then break; fi
  printf "."; sleep 2
done
echo

EMAIL=$(grep '^BOOTSTRAP_ADMIN_EMAIL=' .env | cut -d= -f2-)
PASS=$(grep '^BOOTSTRAP_ADMIN_PASSWORD=' .env | cut -d= -f2-)

cat <<MSG

────────────────────────────────────────────────────────────
  FormAgent is running.

  Open:     http://localhost:3000
  Sign in:  ${EMAIL}
  Password: ${PASS}

  Try a run:
    1. Profiles → New profile (or Import CSV) — add your details.
    2. New automation → URL:  http://practice:5055/register?captcha=off
       → pick the profile → Start agent.
    3. Review the filled form → Approve & submit.
    (The practice site is also viewable at http://localhost:5055)

  Stop (keep data):   docker compose down
  Reset (wipe data):  docker compose down -v
  Logs:               docker compose logs -f api worker web
────────────────────────────────────────────────────────────
MSG

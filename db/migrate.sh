#!/bin/sh
# Applies db/migrations/*.sql in order, each in one transaction, recording applied files in
# schema_migrations so re-runs are no-ops. Usage: DATABASE_URL=... db/migrate.sh [migrations_dir]
set -eu
DIR="${1:-$(dirname "$0")/migrations}"
URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}"
psql "$URL" -v ON_ERROR_STOP=1 -q -c "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
for f in $(ls "$DIR"/*.sql | sort); do
  name=$(basename "$f")
  if [ -n "$(psql "$URL" -tAc "SELECT 1 FROM schema_migrations WHERE name = '$name'")" ]; then
    echo "skip  $name"; continue
  fi
  echo "apply $name"
  { cat "$f"; echo; echo "INSERT INTO schema_migrations (name) VALUES ('$name');"; } | psql "$URL" -v ON_ERROR_STOP=1 -q -1
done

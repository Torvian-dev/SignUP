#!/usr/bin/env bash
# Generates a development .env (never use these values in production — prod secrets come from Key Vault).
set -euo pipefail
priv=$(openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt)
pub=$(echo "$priv" | openssl ec -pubout 2>/dev/null)
esc() { printf '%s' "$1" | awk '{printf "%s\\n", $0}'; }
cat <<EOF
NODE_ENV=development
JWT_PRIVATE_KEY_PEM="$(esc "$priv")"
JWT_PUBLIC_KEY_PEM="$(esc "$pub")"
INTERNAL_EXCHANGE_SECRET=$(openssl rand -hex 32)
DEV_LOCAL_KEK_HEX=$(openssl rand -hex 32)
BLIND_INDEX_KEY_HEX=$(openssl rand -hex 32)
AUTH_SECRET=$(openssl rand -base64 32)
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_MICROSOFT_ENTRA_ID_ID=
AUTH_MICROSOFT_ENTRA_ID_SECRET=
AUTH_MICROSOFT_ENTRA_ID_ISSUER=
ANTHROPIC_API_KEY=
BOOTSTRAP_ADMIN_EMAIL=admin@formagent.local
BOOTSTRAP_ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-16)
BOOTSTRAP_ADMIN_ORG=My Workspace
EOF

#!/bin/bash
cd "$(dirname "$0")"
docker compose down
echo; read -r -p "Stopped. Press Enter to close."

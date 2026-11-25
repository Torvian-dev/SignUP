#!/bin/bash
# Double-click to start FormAgent on this computer.
cd "$(dirname "$0")"
./try-it.sh
( command -v open >/dev/null && open http://localhost:3000 ) 2>/dev/null || true
echo; read -r -p "FormAgent is running. Press Enter to close this window (the app keeps running)."

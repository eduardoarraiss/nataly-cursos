#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
V=$(mktemp); railway variables list --service cursos --kv > "$V"
WAKEY=$(grep '^NATALY_WA_KEY=' "$V" | cut -d= -f2-); WAURL=$(grep '^NATALY_WA_URL=' "$V" | cut -d= -f2-)
rm -f "$V"
curl -s -H "apikey: $WAKEY" "$WAURL/instance/connectionState/nataly"; echo

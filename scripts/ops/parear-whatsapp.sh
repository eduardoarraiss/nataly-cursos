#!/bin/bash
# Gera um QR NOVO para reparear a instância `nataly` da Evolution e o abre.
# Os QR da Evolution EXPIRAM em ~40s e rotacionam — gere e escaneie na hora.
# Uso:  bash scripts/ops/parear-whatsapp.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
V=$(mktemp); railway variables list --service cursos --kv > "$V"
WAURL=$(grep '^NATALY_WA_URL=' "$V" | cut -d= -f2-)
WAKEY=$(grep '^NATALY_WA_KEY=' "$V" | cut -d= -f2-)
rm -f "$V"
echo "estado antes: $(curl -s -H "apikey: $WAKEY" "$WAURL/instance/connectionState/nataly")"
curl -s -H "apikey: $WAKEY" "$WAURL/instance/connect/nataly" -o /tmp/wa-connect.json
python3 - <<'PY'
import json,base64
d=json.load(open('/tmp/wa-connect.json'))
if not d.get('base64'):
    print('sem QR — a instância pode já estar conectada:', d); raise SystemExit(1)
open('/tmp/QR-whatsapp-nataly.png','wb').write(base64.b64decode(d['base64'].split(',',1)[1]))
print('QR salvo em /tmp/QR-whatsapp-nataly.png — escaneie AGORA (expira em ~40s)')
PY
open /tmp/QR-whatsapp-nataly.png
echo
echo "WhatsApp > Aparelhos conectados > Conectar aparelho > escaneie."
echo "Depois confirme:  bash scripts/ops/estado-whatsapp.sh"

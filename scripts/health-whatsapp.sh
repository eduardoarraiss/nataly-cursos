#!/bin/zsh
# Wrapper do health-check do WhatsApp da Nataly. Mesma forma do
# `health-checkouts.sh`, de propósito: o alarme deste projeto ja tem um jeito
# de tocar, e inventar um segundo so cria uma peca a mais para quebrar sozinha.
#
# 🔴 O ALERTA SAI PELA NOTIFICACAO DO macOS, e NAO pelo WhatsApp.
#    Avisar pelo canal que caiu e o erro classico de monitorar um canal por ele
#    mesmo: justamente quando o alarme importa, ele nao toca.
#
# 🔴 `node` NAO EXISTE no PATH do launchd (medido em 02/09/2026: o PATH de um
#    agente e /usr/bin:/bin:/usr/sbin:/sbin, e o node do Homebrew mora em
#    /opt/homebrew/bin). Resolver aqui, com fallback, e falar alto se faltar.
NODE=""
for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  [ -x "$c" ] && { NODE="$c"; break; }
done

RAIZ="$HOME/Documents/clientes/Nataly/site-cursos"
LOG="$RAIZ/logs/health-whatsapp.log"
mkdir -p "$(dirname "$LOG")"

if [ -z "$NODE" ]; then
  printf '%s | ERRO: node nao encontrado no PATH do launchd\n' "$(date '+%Y-%m-%d %H:%M')" >> "$LOG"
  osascript -e 'display notification "node nao encontrado — health-check do WhatsApp nao rodou" with title "Nataly · WhatsApp"' 2>/dev/null
  exit 127
fi

# As credenciais vem do Railway, que ja e a fonte da verdade delas.
# 🔴 SO LEITURA. `railway variables list` NAO dispara rebuild; `set` dispararia,
#    e um rebuild do GitHub apagaria o que subiu por `railway up`.
RAILWAY=""
for c in "$HOME/.npm-global/bin/railway" /opt/homebrew/bin/railway /usr/local/bin/railway; do
  [ -x "$c" ] && { RAILWAY="$c"; break; }
done
if [ -z "$RAILWAY" ]; then
  printf '%s | ERRO: railway CLI nao encontrado\n' "$(date '+%Y-%m-%d %H:%M')" >> "$LOG"
  osascript -e 'display notification "railway CLI sumiu — health-check do WhatsApp nao rodou" with title "Nataly · WhatsApp"' 2>/dev/null
  exit 1
fi

VARS=$(cd "$RAIZ" && "$RAILWAY" variables list --service cursos --kv 2>/dev/null)
if [ -z "$VARS" ]; then
  printf '%s | ERRO: nao consegui ler as variaveis do Railway\n' "$(date '+%Y-%m-%d %H:%M')" >> "$LOG"
  osascript -e 'display notification "nao consegui ler as variaveis do Railway — health-check do WhatsApp nao rodou" with title "Nataly · WhatsApp"' 2>/dev/null
  exit 1
fi
export NATALY_WA_URL=$(printf '%s\n' "$VARS" | grep '^NATALY_WA_URL=' | cut -d= -f2-)
export NATALY_WA_KEY=$(printf '%s\n' "$VARS" | grep '^NATALY_WA_KEY=' | cut -d= -f2-)
export NATALY_WA_INSTANCIA=$(printf '%s\n' "$VARS" | grep '^NATALY_WA_INSTANCIA=' | cut -d= -f2-)
# DATABASE_URL fica de FORA: a URL de producao aponta para a rede interna do
# Railway e nao resolve daqui. O health check ja trata a contagem como opcional
# — o alarme que importa (o canal caiu) nao pode depender do banco.

saida=$(cd "$RAIZ" && "$NODE" scripts/health-whatsapp.js 2>&1)
codigo=$?
printf '%s\n%s\n\n' "$(date '+%Y-%m-%d %H:%M')" "$saida" >> "$LOG"

# 🔴 O MARCADOR DE FIM. Um check que estoura no meio nao pode passar por bom:
#    sem a linha de fim, isto e falha, tenha o codigo de saida que tiver.
if ! printf '%s' "$saida" | grep -q '=== FIM DO HEALTH CHECK ==='; then
  osascript -e 'display notification "health-check do WhatsApp estourou no meio. Ver logs/health-whatsapp.log" with title "🚨 Nataly · WhatsApp" sound name "Basso"' 2>/dev/null
  exit 1
fi

if [ $codigo -ne 0 ]; then
  RESUMO=$(printf '%s' "$saida" | grep '^RESUMO=' | cut -d= -f2-)
  osascript -e "display notification \"$RESUMO — reparear: bash scripts/ops/parear-whatsapp.sh\" with title \"🚨 Nataly · WHATSAPP\" sound name \"Basso\"" 2>/dev/null
fi
exit $codigo

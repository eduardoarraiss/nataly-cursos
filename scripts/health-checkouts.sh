#!/bin/zsh
# Wrapper do health-check de checkouts. Usa o puppeteer de outro projeto de
# proposito: instalar puppeteer dentro de site-cursos engordaria o `railway up`,
# que sobe a pasta inteira.
# 🔴 `node` NAO EXISTE no PATH do launchd (medido em 02/09/2026: o PATH de um
# agente e /usr/bin:/bin:/usr/sbin:/sbin, e o node do Homebrew mora em
# /opt/homebrew/bin). Sem esta resolucao o script achava que o puppeteer tinha
# sumido e saia com erro. Resolver aqui, com fallback, e falar alto se faltar.
NODE=""
for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  [ -x "$c" ] && { NODE="$c"; break; }
done
if [ -z "$NODE" ]; then
  printf '%s | ERRO: node nao encontrado no PATH do launchd\n' "$(date '+%Y-%m-%d %H:%M')" >> "$HOME/Documents/clientes/Nataly/site-cursos/logs/health-checkouts.log"
  osascript -e 'display notification "node nao encontrado — health-check dos checkouts nao rodou" with title "Nataly · checkouts"' 2>/dev/null
  exit 127
fi

PUP_HOST="$HOME/Documents/HAUS/cases-apresentacao"
LOG="$HOME/Documents/clientes/Nataly/site-cursos/logs/health-checkouts.log"
mkdir -p "$(dirname "$LOG")"

NODE_PATH=$(cd "$PUP_HOST" && "$NODE" -e "console.log(require.resolve('puppeteer').replace(/\/puppeteer\/.*/,''))" 2>/dev/null)
if [ -z "$NODE_PATH" ]; then
  printf '%s | ERRO: puppeteer nao encontrado em %s\n' "$(date '+%Y-%m-%d %H:%M')" "$PUP_HOST" >> "$LOG"
  osascript -e 'display notification "puppeteer sumiu — health-check dos checkouts nao rodou" with title "Nataly · checkouts"' 2>/dev/null
  exit 1
fi
export NODE_PATH

saida=$(cd "$HOME/Documents/clientes/Nataly/site-cursos" && "$NODE" scripts/health-checkouts.js 2>&1)
codigo=$?
printf '%s\n%s\n\n' "$(date '+%Y-%m-%d %H:%M')" "$saida" >> "$LOG"

if [ $codigo -ne 0 ]; then
  osascript -e 'display notification "Um checkout da Nataly caiu ou mudou de preco. Ver logs/health-checkouts.log" with title "🚨 Nataly · CHECKOUT" sound name "Basso"' 2>/dev/null
fi
exit $codigo

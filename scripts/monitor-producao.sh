#!/bin/bash
# ============================================================
#  Wrapper do monitor de produção, para o launchd chamar.
# ============================================================
#  🔴 DUAS ARMADILHAS que mataram o health-check dos checkouts, e por que
#     este arquivo é como é:
#
#   1. NÃO CONFIE NO SHEBANG. O `health-checkouts.sh` começa com `#!/bin/zsh`
#      e o launchd o executava direto. Resultado desde 30/07/2026:
#      `/bin/zsh: can't open input file`, saída 127, TODO DIA, em silêncio —
#      34 dias sem monitorar preço de checkout nenhum. O plist deste aqui
#      chama `/bin/bash <caminho>` explicitamente, sem depender do shebang.
#
#   2. `node` NÃO EXISTE no PATH do launchd. Medido: o PATH de um agente é
#      `/usr/bin:/bin:/usr/sbin:/sbin`, e o node do Homebrew mora em
#      /opt/homebrew/bin. Por isso o caminho é resolvido aqui, com fallback,
#      e a ausência dele vira ERRO BARULHENTO em vez de saída silenciosa.
#
#  As credenciais do painel NÃO ficam aqui nem no plist (este arquivo é
#  commitado; o plist fica em texto puro no disco). Ficam em
#  ~/.config/arrais/nataly-monitor.env, com permissão 600.
# ============================================================
set -u

PROJETO="$HOME/Documents/clientes/Nataly/site-cursos"
ENVFILE="$HOME/.config/arrais/nataly-monitor.env"

avisa() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"🚨 Nataly · SITE\" sound name \"Basso\"" 2>/dev/null
}

NODE=""
for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
  [ -x "$c" ] && { NODE="$c"; break; }
done
if [ -z "$NODE" ]; then
  echo "ERRO: node não encontrado. O monitor NÃO rodou." >&2
  avisa "o monitor do site não rodou: node não encontrado"
  exit 127
fi

# As credenciais são opcionais para o script rodar, mas SEM elas ele não
# consegue dizer se o Postgres está de pé — e isso é metade do valor dele.
# Por isso a ausência avisa, em vez de degradar calada.
if [ -r "$ENVFILE" ]; then
  # shellcheck disable=SC1090
  . "$ENVFILE"
  export MONITOR_CRM_USUARIO MONITOR_CRM_SENHA
else
  echo "AVISO: $ENVFILE não existe — a checagem do banco vai reprovar de propósito." >&2
fi

cd "$PROJETO" || { echo "ERRO: $PROJETO não existe" >&2; avisa "o monitor não achou a pasta do projeto"; exit 1; }

"$NODE" scripts/monitor-producao.js
exit $?

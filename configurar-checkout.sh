#!/usr/bin/env bash
# Liga o checkout na página de vendas do Profissão Lash.
#   ./configurar-checkout.sh <codigo-kiwify-497> <codigo-kiwify-597>
# Exemplo: ./configurar-checkout.sh AbCd123 XyZw456
set -euo pipefail

PAGINA="public/profissao-lash-curso.html"
[ $# -eq 2 ] || { echo "uso: $0 <codigo497> <codigo597>"; exit 1; }
C497="$1"; C597="$2"

for c in "$C497" "$C597"; do
  case "$c" in
    http*) echo "ERRO: passe só o código do checkout, não a URL inteira ($c)"; exit 1;;
    "")    echo "ERRO: código vazio"; exit 1;;
  esac
done

python3 - "$PAGINA" "$C497" "$C597" <<'PY'
import io, sys, re
pagina, c497, c597 = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(pagina, encoding='utf-8').read()

antigo = re.search(r'<a href="[^"]*" class="cta" id="botao-checkout" data-checkout="[^"]*"', s)
if not antigo:
    print("ERRO: não achei o botão de checkout na página"); sys.exit(1)

s = s[:antigo.start()] + \
    f'<a href="https://pay.kiwify.com.br/{c497}" class="cta" id="botao-checkout" data-checkout="{c497}"' + \
    s[antigo.end():]

# o segundo lote fica registrado no HTML para a virada 497 -> 597
s = s.replace('<!-- LOTE-597 -->', '')
if 'data-checkout-597' not in s:
    s = s.replace('id="botao-checkout"', f'id="botao-checkout" data-checkout-597="{c597}"', 1)

io.open(pagina, 'w', encoding='utf-8').write(s)
print(f"checkout do lote R$ 497 ligado em pay.kiwify.com.br/{c497}")
print(f"codigo do lote R$ 597 guardado no HTML: {c597}")
PY

echo "Agora rode: ./verificar-pv.sh"

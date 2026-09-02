#!/usr/bin/env bash
# Confere as páginas do Profissão Lash por CONTEÚDO, nunca por status code.
# Cobre as 4 páginas da família e ainda checa se as rotas antigas continuam
# servindo o que serviam. Sai com o NÚMERO DE FALHAS (0 = pode divulgar).
#
#   ./verificar-pv.sh            -> verifica em produção
#   ./verificar-pv.sh local      -> verifica em http://127.0.0.1:3999
set -uo pipefail

ALVO="${1:-producao}"
if [ "$ALVO" = "local" ]; then BASE="http://127.0.0.1:3999"; else BASE="https://natalyribeiro.com.br"; fi
FALHAS=0
TMP=$(mktemp)

falha(){ echo "FALHA  $1"; FALHAS=$((FALHAS+1)); }
ok(){    echo "ok     $1"; }

# baixa_pagina <rota> <bytes minimos>
baixa_pagina(){
  curl -s --max-time 30 -o "$TMP" "$BASE$1"
  local tam; tam=$(wc -c < "$TMP" | tr -d ' ')
  if [ "$tam" -lt "$2" ]; then
    falha "$1 veio com $tam bytes, menos que os $2 esperados (o catch-all do site serve a home em rota inexistente)"
    return 1
  fi
  ok "$1 tem $tam bytes"
  return 0
}

# precisa <rótulo> <marcador>
precisa(){ if grep -qF "$2" "$TMP"; then ok "$1"; else falha "$1 (não achei: $2)"; fi; }
# proibido <rótulo> <marcador>
proibido(){ if grep -qF "$2" "$TMP"; then falha "$1 (achei: $2)"; else ok "$1"; fi; }
# proibido_re <rótulo> <regex> — para quando o texto cru também aparece em comentário
proibido_re(){ if grep -qE "$2" "$TMP"; then falha "$1 (casou: $2)"; else ok "$1"; fi; }
# precisa_re <rótulo> <regex> — quando o que importa é a FORMA e não um literal
precisa_re(){ if grep -qE "$2" "$TMP"; then ok "$1"; else falha "$1 (não casou: $2)"; fi; }
# precisa_re1 <rótulo> <regex> — idem, mas achatando o arquivo numa linha só.
# Serve para tag que o HTML quebra em várias linhas (o grep é orientado a linha
# e nunca casaria um atributo que ficou na linha de baixo do nome da tag).
precisa_re1(){
  if tr '\n' ' ' < "$TMP" | grep -qE "$2"; then ok "$1"; else falha "$1 (não casou: $2)"; fi
}

# o que NENHUMA página da família pode ter
comuns_proibidos(){
  proibido "codinome interno não vazou (Atelier)" "Atelier"
  proibido "codinome interno não vazou (Sálvia)"  "Sálvia"
  proibido "sem marcador de template"             "{{"
  proibido "sem placeholder de checkout"          "CHECKOUT_LOTE"
  proibido "Purchase NÃO é disparado aqui (quem dispara é a Kiwify)" 'track", "Purchase'
  proibido "Purchase NÃO é disparado aqui (GA4)"  '"purchase"'
}

# rastreamento obrigatório
comuns_precisa(){
  precisa "pixel Meta instalado" "/js/pixel.js"
  precisa "GA4 instalado"        "/js/analytics.js"
}

# ---- o HTML SEM COMENTARIO ----
# `proibido` grep no arquivo cru, e o arquivo cru tem os comentarios que
# EXPLICAM por que aquele preco nao pode estar la. Resultado: o comentario
# "nao cravar R$ 1.997 aqui" faz o check de "sem R$ 1.997" falhar — o gate
# reprovaria justamente a pagina que esta certa, e a saida obvia (apagar o
# comentario) apagaria o aviso que impede o erro de voltar.
# Entao: para o que precisa olhar o que a PESSOA VE, olha-se a versao sem
# comentario de HTML e sem comentario de JS.
sem_comentarios(){
  perl -0777 -pe 's/<!--.*?-->//gs; s{/\*.*?\*/}{}gs; s{^\s*//.*$}{}gm' "$TMP" > "$TMP.vivo"
}
# proibido_vivo <rótulo> <marcador> — proibido, mas só no que é servido de fato
proibido_vivo(){
  if grep -qF "$2" "$TMP.vivo"; then falha "$1 (achei: $2)"; else ok "$1"; fi
}
# proibido_vivo_re <rótulo> <regex>
proibido_vivo_re(){
  if grep -qE "$2" "$TMP.vivo"; then falha "$1 (casou: $2)"; else ok "$1"; fi
}

# confere_checkout <código esperado>
confere_checkout(){
  if grep -q 'data-checkout="pendente"' "$TMP"; then
    falha "CHECKOUT AINDA PENDENTE: o botão da oferta não leva a lugar nenhum"
    return
  fi
  local achado codigo
  achado=$(grep -oE 'https://pay\.kiwify\.com\.br/[A-Za-z0-9]+' "$TMP" | head -1)
  if [ -z "$achado" ]; then falha "não achei nenhum checkout na página"; return; fi
  if [ "$achado" != "https://pay.kiwify.com.br/$1" ]; then
    falha "checkout errado: esperava $1 e achei $achado"
    return
  fi
  codigo=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 -L "$achado")
  if [ "$codigo" = "200" ]; then ok "checkout $achado responde"
  else falha "checkout $achado devolveu $codigo"; fi
}

# ============================================================
echo "== 1. PV do curso online — $BASE/profissao-lash-curso"
# ============================================================
if baixa_pagina /profissao-lash-curso 30000; then
  precisa "título da página"          "Profissão Lash"
  precisa "grade das 39 aulas"        "39 aulas teóricas"
  precisa "oferta R$ 497"             "R$ 497"
  precisa "âncora R$ 697"             "R$ 697"
  precisa "garantia de 7 dias"        "7 dias de garantia"
  precisa "a VSL está na página"      "/video/vsl-profissao-lash.mp4"
  precisa "simulador"                 "sim-total"
  precisa "acordeão da grade"         "mod__cab"
  precisa "barra de progresso"        "progresso__b"
  comuns_precisa
  comuns_proibidos
  proibido "sem barra fixa (removida a pedido)" 'class="barra"'
  proibido "sem lote das 10 primeiras"          "10 primeiras"
  proibido "sem prints de conversa"             "/img/depoimentos/"
  confere_checkout y1Pz2US
fi

# ============================================================
echo
echo "== 2. PV online + presencial — $BASE/profissao-lash-presencial"
# ============================================================
if baixa_pagina /profissao-lash-presencial 40000; then
  # -- o que a página É, em 2 segundos --
  precisa "headline diz o produto"           "Curso de extensão de cílios do zero"
  # a cidade saiu do h1 (a tarja já a diz, logo acima). O que NÃO pode sair do h1
  # é o formato: sem "presencial" aqui a página vira a PV do curso online.
  precisa "headline diz que é presencial"    "<em>presencial</em> em que eu corrijo a sua mão"
  precisa "sub-headline resume a oferta"     "Todo o material incluso"
  precisa "sub-headline diz a cidade"        "um dia de prática em Cambuí, MG"
  # -- a oferta --
  # ⚠️ Estas três checagens exigiam o preço NA PÁGINA DE VENDA e foram
  #    removidas em 01/09/2026: o Eduardo tirou o número daqui. Quem confere o
  #    preço agora é a seção 2b, na /inscricao-presencial, onde ele deve estar.
  #    A proibição de preço nesta página está logo abaixo, em "SEM o preço".
  precisa "material incluso"                 "material da prática está incluso"
  precisa "apostila impressa"                "Apostila impressa"
  precisa "o curso online vem junto"         "39 aulas teóricas"
  precisa "grupo de suporte"                 "Grupo de suporte"
  precisa "certificado"                      "Certificado"
  precisa "a data NÃO é fixa"                "Não tem turma com data fechada"
  # -- a cidade nos TRÊS pontos de entrada --
  #    Ela saiu do <h1>, então o 2º ponto passou a ser a sub-headline (testada
  #    logo acima, por conteúdo). A garantia real — é impossível comprar sem
  #    saber que a aula é em Cambuí — é testada por POSIÇÃO mais abaixo.
  precisa "a cidade, com acento"             "Cambuí"
  precisa "tarja de aviso no topo"           'class="tarja"'
  precisa "a tarja diz a cidade"             "Aula prática presencial em Cambuí, MG"
  precisa "a cidade colada no botão"         "Só se inscreva se você puder vir até aqui"
  # -- persuasão: profissão, calculadora, prova, autoridade --
  precisa "vende a profissão antes do curso" "A conta da extensão de cílios"
  precisa "a calculadora está na página"     "sim-total"
  precisa "faixa da calculadora"             'id="sim-clientes"'
  precisa "mosaico de alunas"                'id="prova-fotos"'
  precisa "vídeos de alunas"                 'id="prova-videos"'
  precisa "prints das conversas"             'id="prova-prints"'
  precisa "lupa para ler o print"            'id="lupa"'
  precisa "foto da Nataly na página"         "/img/nataly-bio-led.jpg"
  precisa "Nataly como referência"           "anos formando profissionais"
  # -- VSL rotulada: ela fala do ONLINE --
  precisa "a VSL está na página"             "/video/vsl-profissao-lash.mp4"
  precisa "VSL avisa que é do curso online"  "é a apresentação do"
  precisa "VSL avisa o que vem a mais"       "mais o dia de prática presencial comigo em Cambuí"
  # -- o player COMPLETO, igual ao da /profissao-lash-curso --
  precisa_re1 "o autoplay é MUDO e em laço"  "<video[^>]*muted[^>]*loop[^>]*autoplay"
  precisa "véu do laço mudo"                 "Seu vídeo já começou"
  precisa "fallback quando o autoplay é bloqueado" "Toque para assistir"
  precisa "overlay de retenção na pausa"     'id="retencao"'
  precisa "texto da retenção"                "Esse vídeo sai do ar em breve"
  precisa "botão de continuar assistindo"    'id="continuar"'
  precisa "barra de percepção acelerada"     'id="progresso"'
  precisa "controles sem linha do tempo"     'id="controles"'
  precisa "aviso de retomada"                'id="retomada"'
  precisa "retomar de onde parou"            "pl_vsl_presencial_ponto"
  # a chave TEM que ser própria: dividir com a PV do online faria quem já viu a
  # VSL lá chegar aqui com o vídeo pulando para o meio.
  proibido "não usa a chave da outra página" "'pl_vsl_ponto'"
  # -- estrutura --
  precisa "grade de módulos"                 'class="mod__cab"'
  precisa "trava de 1 InitiateCheckout"      "window.IC_UNICO = true"
  precisa "âncora da oferta"                 'id="oferta"'

  # -- SEM PREÇO E SEM CHECKOUT NESTA PÁGINA (01/09/2026) ----------------
  #    Decisão do Eduardo: a página de venda constrói o desejo e NÃO mostra
  #    número. O valor aparece só na última pergunta do formulário, que virou
  #    rota própria. O produto na Kiwify (VluGxKq) segue ativo e é enviado à
  #    mão pela Nataly a quem ela qualificar.
  proibido_re "nenhum link de checkout clicável" 'href="https://pay\.kiwify'
  proibido "SEM o preço do combo"            "1.497"
  proibido "SEM o parcelamento do combo"     "154,82"
  proibido "SEM o preço do curso online"     "R$ 497"
  proibido "SEM o parcelamento do online"    "51,40"
  proibido "SEM o preço da formação LED"     "1.997"
  # a calculadora (R$ 120/140/180 por atendimento) PODE ficar: ela é o que a
  # ALUNA vai cobrar das clientes dela, não o preço do curso. É a peça que
  # constrói valor — apagar ela seria apagar o argumento.
  precisa "a calculadora continua na página"  'id="sim-total"'

  # -- os CTAs levam ao formulário, e não a uma âncora --
  proibido "nenhum CTA aponta para âncora de oferta" '<a href="#oferta" class="cta"'
  precisa "o CTA do topo leva ao formulário"  'href="/inscricao-presencial" class="cta" data-intencao="hero"'
  precisa "o CTA da oferta leva ao formulário" 'data-intencao="oferta"'
  precisa "o CTA do fim leva ao formulário"   'data-intencao="fechamento"'
  precisa "evento de intenção no clique"      "'IniciouInscricao'"
  precisa "a intenção é travada em 1 por sessão" "nr_intencao_presencial"
  proibido "a intenção NÃO é InitiateCheckout" "'InitiateCheckout', dados"
  precisa "o link carimba qual CTA foi clicado" "searchParams.set('cta'"

  # o que ocupou o lugar dos números
  precisa "a comparação diz o que cada uma entrega" 'class="formato-col"'
  precisa "o bloco de oferta abre pelo que ela leva" 'class="leva"'
  precisa "a nota diz onde o valor aparece"   "investimento e as condições"

  comuns_precisa
  comuns_proibidos
  proibido "sem cidade sem acento"           "Cambui"
  proibido "sem data inventada para a turma" "turmas em"
  proibido "sem vaga limitada não confirmada" "Vagas limitadas"
  proibido "sem prints de conversa antigos"  "/img/depoimentos/"
  # o hero não dá número antes de construir valor: a nota do botão do topo
  # ficou só com o agendamento. O preço segue no bloco de oferta, lá embaixo.
  # O preço aparece de propósito na etapa 9 do formulário ("Combina com você
  # agora?"). A regra sempre foi sobre o HERO — não dar número antes de
  # construir valor —, então ela vira checagem de POSIÇÃO em vez de proibição
  # geral: o preço não pode aparecer ANTES do bloco de oferta.
  P_PRECO=$(grep -boF "R$ 1.497, ou 12x de R$ 154,82" "$TMP" | head -1 | cut -d: -f1)
  P_OFT=$(grep -boF 'id="oferta"' "$TMP" | head -1 | cut -d: -f1)
  if [ -z "$P_PRECO" ]; then
    ok "hero sem preço na nota do botão"
  elif [ -n "$P_OFT" ] && [ "$P_PRECO" -gt "$P_OFT" ]; then
    ok "o preço só aparece depois da oferta (na pergunta do formulário)"
  else
    falha "o preço aparece ANTES da oferta (em $P_PRECO, oferta em $P_OFT)"
  fi
  # -- a foto da Nataly no hero --
  precisa "foto da Nataly no hero"           "/img/nataly-hero-presencial.jpg"
  precisa_re "a foto do hero declara width/height" 'nataly-hero-presencial\.jpg" width="1200" height="675"'
  # NÃO se confere checkout aqui: esta página não tem mais checkout, por decisão
  # do Eduardo em 01/09/2026. O produto VluGxKq segue ativo na Kiwify e é
  # enviado à mão pela Nataly a quem ela qualificar.

  # -- a ORDEM das dobras é parte do pedido: a oferta não pode ficar
  #    depois dos módulos e do FAQ, nem a prova social lá no fim --
  pos(){ grep -boF "$1" "$TMP" | head -1 | cut -d: -f1; }
  P_HERO=$(pos '<h1 class="h1">Curso de extensão de cílios do zero')
  P_VSL=$(pos 'id="player"')
  P_PROF=$(pos "A conta da extensão de cílios")
  P_CALC=$(pos "sim-clientes")
  P_PROVA=$(pos "prova-fotos")
  P_NAT=$(pos "anos formando profissionais")
  P_OFERTA=$(pos 'id="oferta"')
  P_MOD=$(pos 'class="mod__cab"')
  P_FAQ=$(pos 'id="faq"')
  ordem_ok=1
  for par in "HERO:$P_HERO:VSL:$P_VSL" "VSL:$P_VSL:PROFISSÃO:$P_PROF" "PROFISSÃO:$P_PROF:CALCULADORA:$P_CALC" \
             "CALCULADORA:$P_CALC:PROVA SOCIAL:$P_PROVA" "PROVA SOCIAL:$P_PROVA:NATALY:$P_NAT" \
             "NATALY:$P_NAT:OFERTA:$P_OFERTA" "OFERTA:$P_OFERTA:MÓDULOS:$P_MOD" \
             "MÓDULOS:$P_MOD:FAQ:$P_FAQ"; do
    a=$(echo "$par" | cut -d: -f1); pa=$(echo "$par" | cut -d: -f2)
    c=$(echo "$par" | cut -d: -f3); pc=$(echo "$par" | cut -d: -f4)
    if [ -z "$pa" ] || [ -z "$pc" ] || [ "$pa" -ge "$pc" ]; then
      falha "ordem das dobras: $a devia vir antes de $c"
      ordem_ok=0
    fi
  done
  [ "$ordem_ok" = 1 ] && ok "ordem das dobras: hero → VSL → profissão → calculadora → prova → Nataly → oferta → módulos → FAQ"

  # -- A GARANTIA QUE NÃO PODE CAIR ------------------------------------------
  #    É impossível comprar sem saber que a aula é em Cambuí. Testado por
  #    POSIÇÃO, no corpo da página (o <title> e as metas não valem: ninguém lê
  #    a aba do navegador antes de clicar no botão). A cidade tem de aparecer
  #    ANTES do primeiro botão de compra e ANTES do bloco de oferta.
  CORPO=$(mktemp)
  #    Comentário de HTML não é conteúdo: ninguém lê o código-fonte. Eles saem
  #    antes da medida, senão bastaria escrever "Cambuí" num <!-- --> para o
  #    teste passar sem que a página dissesse nada à pessoa.
  sed -n '/<body>/,$p' "$TMP" | perl -0777 -pe 's/<!--.*?-->//gs' > "$CORPO"
  P_CIDADE=$(grep -boF "Cambuí" "$CORPO" | head -1 | cut -d: -f1)
  P_CTA1=$(grep -boF "Quero a minha vaga no presencial" "$CORPO" | head -1 | cut -d: -f1)
  P_OFER=$(grep -boF 'id="oferta"' "$CORPO" | head -1 | cut -d: -f1)
  if [ -z "$P_CIDADE" ]; then
    falha "a cidade não aparece no CORPO da página (só no title/meta não conta)"
  elif [ -z "$P_CTA1" ] || [ -z "$P_OFER" ]; then
    falha "não achei o primeiro CTA ou o bloco de oferta para medir a posição da cidade"
  elif [ "$P_CIDADE" -ge "$P_CTA1" ] || [ "$P_CIDADE" -ge "$P_OFER" ]; then
    falha "dá para chegar no botão de compra sem ter lido Cambuí (cidade em $P_CIDADE, 1º CTA em $P_CTA1, oferta em $P_OFER)"
  else
    ok "impossível comprar sem saber da cidade: Cambuí aparece em $P_CIDADE, antes do 1º CTA ($P_CTA1) e da oferta ($P_OFER)"
  fi
  rm -f "$CORPO"
fi

# ============================================================
echo
echo "== 2b. Formulário de qualificação — $BASE/inscricao-presencial"
# ============================================================
if baixa_pagina /inscricao-presencial 20000; then
  # -- a abertura --
  precisa "tela de boas-vindas"              'data-etapa="0"'
  precisa "TEM a foto da Nataly"             "/img/nataly-smile-shoulder.jpg"
  precisa_re1 "a foto declara width/height"  'nataly-smile-shoulder\.jpg"[^>]*width="1400" height="1400"'
  precisa "botão de começar"                 'id="comecar"'
  precisa "diz quantas perguntas são"        "dez perguntas rápidas"
  precisa "promete a recomendação já na abertura" "dos meus cursos é o certo para você"
  precisa "barra de progresso"               'id="barra"'
  # As setas eram fixas no canto, como na referência, mas medido em 390px
  # cobriam o aviso de privacidade e as opções. Foram para o fluxo, ao lado do
  # "Avançar": é o botão de voltar que garante o caminho de volta.
  precisa "botão de voltar"                  'id="subir"'
  precisa "botão de avançar"                 'id="avancar"'

  # -- as perguntas, uma a uma. A 5.5 é CONDICIONAL: só quem já trabalha
  #    com cílios a vê. Ela existe no HTML de todo mundo; quem a tira da
  #    fila é o JS, conforme a resposta da pergunta 5.
  precisa "pergunta 1 — nome"                'data-etapa="1"'
  precisa "pergunta 2 — cidade"              'data-etapa="2"'
  precisa "pergunta 3 — WhatsApp"            'data-etapa="3"'
  precisa "pergunta 4 — Instagram"           'data-etapa="4"'
  precisa "pergunta 5 — situação e idade"    'data-etapa="5"'
  precisa "pergunta 5.5 — o que ela busca"   'data-etapa="5.5"'
  precisa "pergunta 6 — meta e prazo"        'data-etapa="6"'
  precisa "pergunta 7 — objetivo"            'data-etapa="7"'
  precisa "pergunta 8 — pode vir a Cambuí"   'data-etapa="8"'
  precisa "pergunta 9 — como prefere aprender" 'data-etapa="9"'
  precisa "pergunta 10 — faixa de investimento" 'data-etapa="10"'

  # -- a ramificação de quem já é lash --
  precisa "opção: aperfeiçoar a extensão"    'value="aperfeicoar-cilios"'
  precisa "opção: aprender a técnica com LED" 'value="tecnica-led"'
  precisa "opção: ainda não sei, me ajuda"   'value="nao-sei"'
  precisa "a condicional é marcada como tal" 'etapa--se-lash'

  # -- 🔴 NENHUM PREÇO DE PRODUTO NO HTML DO FORMULÁRIO --
  # Este é o coração do pedido: ela nunca pode ver um preço que não é o dela.
  # Como o HTML é servido igual para as quatro rotas da árvore, qualquer preço
  # cravado aqui MENTE para pelo menos três quartos de quem abre a página.
  # O único preço que ela vê é o do produto recomendado, escrito pelo JS na
  # tela final com o que o servidor devolveu.
  sem_comentarios
  proibido_vivo_re "sem preço de produto cravado no HTML" 'R\$ ?(297|497|1\.497|1\.997|247)'
  # Parcelamento NENHUM: as parcelas so existem para os nossos produtos, entao
  # um "12x de" no HTML e prova de que um preco nosso vazou para ca.
  # ⚠️ "Metodo LED" NAO entra nesta lista: ele aparece, corretamente, como
  # NOME DA TECNICA na opcao "Aprender a tecnica com LED" da pergunta 5.5.
  # Proibir o nome barraria a pergunta que o Eduardo pediu. O que nao pode
  # aparecer e PRECO — e disso cuida a regra acima, que e precisa.
  proibido_vivo_re "sem parcelamento cravado"        '1[02]x de R\$'
  proibido_vivo "sem checkout cravado"               "pay.kiwify"

  # -- a faixa de investimento pergunta o BOLSO DELA, sem revelar o nosso --
  precisa "pergunta a faixa de investimento" 'name="faixa_investimento"'
  precisa "faixa até R\$ 500"                'value="ate-500"'
  precisa "faixa de R\$ 500 a R\$ 1.500"      'value="500-1500"'
  precisa "faixa de R\$ 1.500 a R\$ 2.000"    'value="1500-2000"'
  precisa "faixa acima de R\$ 2.000"         'value="acima-2000"'
  precisa "faixa de quem depende de parcelar" 'value="depende-parcelamento"'

  # -- a ORDEM da árvore: distância → preferência → dinheiro --
  # Se o dinheiro perguntasse antes da distância, quem mora perto e faria o
  # presencial seria empurrada para a oferta barata. A ordem é a regra.
  P_CAMBUI=$(grep -boF 'data-etapa="8"' "$TMP" | head -1 | cut -d: -f1)
  P_PREF=$(grep -boF 'data-etapa="9"' "$TMP" | head -1 | cut -d: -f1)
  P_VALOR=$(grep -boF 'data-etapa="10"' "$TMP" | head -1 | cut -d: -f1)
  if [ -n "$P_CAMBUI" ] && [ -n "$P_PREF" ] && [ -n "$P_VALOR" ] \
     && [ "$P_CAMBUI" -lt "$P_PREF" ] && [ "$P_PREF" -lt "$P_VALOR" ]; then
    ok "a ordem é Cambuí → preferência → investimento"
  else
    falha "a ordem da árvore quebrou (Cambuí $P_CAMBUI, preferência $P_PREF, valor $P_VALOR)"
  fi

  # -- a TELA FINAL: recomendação, e checkout só no online --
  precisa "a tela da recomendação existe"    'id="rec"'
  precisa "diz qual é a opção ideal"         "opção ideal para você"
  precisa "espaço para o nome do produto"    'id="rec-nome"'
  precisa "espaço para o porquê"             'id="rec-porque"'
  precisa "espaço para o preço"              'id="rec-preco"'
  precisa "espaço para o que está incluso"   'id="rec-inclui"'
  precisa "botão de checkout, escondido por padrão" 'id="rec-cta" hidden'
  precisa "caixa do presencial para quem só travou no bolso" 'id="rec-extra"'
  precisa "o produto vem do SERVIDOR"        "res.j.recomendacao"
  precisa "o presencial não recebe checkout" "primeiro a"

  # -- campos obrigatórios pedidos pelo Eduardo --
  precisa "campo nome"                       'name="nome"'
  precisa "campo WhatsApp"                   'name="telefone"'
  precisa "campo cidade"                     'name="cidade"'
  precisa "campo Instagram"                  'name="instagram"'
  precisa "campo disponibilidade"            'name="disponibilidade"'
  precisa "campo preferência de formato"     'name="prefere_formato"'
  precisa "campo faixa de investimento"      'name="faixa_investimento"'
  precisa "campo do que ela busca"           'name="busca"'

  # -- UX e acessibilidade --
  precisa "teclado numérico no telefone"     'inputmode="numeric"'
  precisa "autocomplete de nome"             'autocomplete="name"'
  precisa "autocomplete de telefone"         'autocomplete="tel-national"'
  precisa "campo com 20px trava o zoom do iOS" "font-size:20px"
  precisa "erro anunciado por leitor de tela" 'role="alert"'
  precisa "rascunho sobrevive ao refresh"    "nr_insc_presencial"
  precisa "armadilha de robô"                "sobrenome_confirmacao"
  precisa "tela de agradecimento"            'id="obrigado"'
  precisa "diz em quanto tempo responde"     "em até 24 horas"
  precisa "dá o WhatsApp da Nataly"          "(35) 99716-4668"

  # -- LGPD --
  precisa "aviso de privacidade"             "não são vendidos nem repassados"
  precisa "link para a política"             'href="/politica-de-privacidade"'
  proibido "sem caixa pré-marcada"           'type="checkbox" checked'
  precisa "fora do índice do Google"         'content="noindex'

  # -- eventos --
  precisa "evento da etapa do investimento"  "'ViuInvestimento'"
  precisa "GA4 na etapa do investimento"     "'view_price_step'"
  precisa "intenção do GA4 na chegada"       "'select_item'"
  precisa "evento da recomendação"           "'ViuRecomendacao'"
  precisa "GA4 na recomendação"              "'view_recommendation'"
  precisa "Lead no envio"                    "'Lead'"
  precisa "o Lead DIZ QUAL PRODUTO"          "content_ids: [prod.id]"
  precisa "evento com nome próprio por produto" "'Lead_' + prod.id"
  precisa "GA4 generate_lead no envio"       "'generate_lead'"
  precisa "o GA4 também diz o produto"       "produto: prod.id"
  precisa "beacon no evento antes de sair"   "transport_type: 'beacon'"
  precisa "event_callback coordenado"        "event_callback: mostra"
  # ⚠️ MUDOU EM 01/09/2026. Antes da árvore, nenhum caminho desta página levava
  # a checkout, e disparar InitiateCheckout aqui era erro. Hoje metade dos
  # caminhos termina num checkout Kiwify, então o evento é OBRIGATÓRIO — e a
  # trava de 1 por sessão é obrigatória junto, senão volta o vício que deixou
  # o A/B do Método LED ilegível (um IC por clique).
  precisa "trava de 1 InitiateCheckout por sessão" "window.IC_UNICO = true"
  precisa "o produto certo assume os eventos"      "window.NR_PRODUTO ="
  proibido "NUNCA Purchase aqui"             "'Purchase'"
  comuns_precisa
  comuns_proibidos
  proibido "sem cidade sem acento"           "Cambui"
fi

# ============================================================
echo
echo "== 2c. A ÁRVORE DE DECISÃO — os sete caminhos, na API de verdade"
# ============================================================
# ⚠️ Estes casos GRAVAM lead. Só rodam em local: contra produção encheriam o
# banco da Nataly de lead falso e o WhatsApp dela de aviso de mentira.
if [ "$ALVO" != "local" ]; then
  echo "aviso  árvore não exercitada em produção (grava lead) — rode ./verificar-pv.sh local"
else
  # A árvore pura roda sem rede e cobre as 405 combinações possíveis.
  if node funil-presencial/teste-arvore.js > /tmp/nr-arvore.txt 2>&1; then
    ok "a árvore passa nas 405 combinações (teste-arvore.js)"
  else
    falha "teste-arvore.js falhou — veja /tmp/nr-arvore.txt"
    tail -20 /tmp/nr-arvore.txt | sed 's/^/       /'
  fi

  # E aqui os sete caminhos que o Eduardo listou, batendo na API DE VERDADE:
  # a árvore pode estar certa e a rota errada, e é a rota que a aluna usa.
  BASE_LEAD='"nome":"Gate Arvore","telefone":"(35) 99716-4668","cidade":"Cambui","instagram":"@gate_arvore","quando_comecar":"agora"'
  caminho(){  # $1=rótulo  $2=respostas  $3=produto esperado  $4=formato esperado
    local corpo resp prod fmt
    corpo="{$BASE_LEAD,\"lead_uid\":\"gate-$RANDOM$RANDOM\",$2}"
    resp=$(curl -s --max-time 20 -X POST "$BASE/api/lead-presencial" \
             -H 'Content-Type: application/json' -d "$corpo")
    prod=$(echo "$resp" | sed -n 's/.*"id":"\([a-z0-9-]*\)".*/\1/p')
    fmt=$(echo  "$resp" | sed -n 's/.*"formato":"\([a-z]*\)".*/\1/p')
    if [ "$prod" = "$3" ] && [ "$fmt" = "$4" ]; then
      ok "$1 → $3 ($4)"
    else
      falha "$1: esperava $3/$4 e veio ${prod:-nada}/${fmt:-nada}"
    fi
  }

  caminho "não é lash"                '"situacao":"outra-area","disponibilidade":"sim","prefere_formato":"presencial","faixa_investimento":"acima-2000"' profissao-lash-presencial presencial
  caminho "é lash + quer LED"         '"situacao":"ja-lash","busca":"tecnica-led","disponibilidade":"sim","prefere_formato":"presencial","faixa_investimento":"acima-2000"' lash2-presencial presencial
  caminho "é lash + quer aperfeiçoar" '"situacao":"ja-lash","busca":"aperfeicoar-cilios","disponibilidade":"sim","prefere_formato":"presencial","faixa_investimento":"acima-2000"' profissao-lash-presencial presencial
  caminho "não pode vir"              '"situacao":"ja-lash","busca":"tecnica-led","disponibilidade":"nao","prefere_formato":"presencial","faixa_investimento":"acima-2000"' lash2-online online
  caminho "pode vir e prefere online" '"situacao":"outra-area","disponibilidade":"sim","prefere_formato":"online","faixa_investimento":"acima-2000"' profissao-lash online
  caminho "pode vir e quer presencial" '"situacao":"outra-area","disponibilidade":"sim","prefere_formato":"presencial","faixa_investimento":"500-1500"' profissao-lash-presencial presencial

  # O caso mais delicado: ela PODE vir, quer o ao vivo, e só o bolso travou.
  # O presencial não pode sumir em silêncio — tem de aparecer na resposta.
  CORPO="{$BASE_LEAD,\"lead_uid\":\"gate-bolso-$RANDOM$RANDOM\",\"situacao\":\"ja-lash\",\"busca\":\"tecnica-led\",\"disponibilidade\":\"sim\",\"prefere_formato\":\"presencial\",\"faixa_investimento\":\"ate-500\"}"
  R=$(curl -s --max-time 20 -X POST "$BASE/api/lead-presencial" -H 'Content-Type: application/json' -d "$CORPO")
  if echo "$R" | grep -q '"id":"lash2-online"'; then
    ok "pode vir mas investimento baixo → online"
  else
    falha "pode vir mas investimento baixo NÃO foi para o online (veio: ${R:0:160})"
  fi
  if echo "$R" | grep -q '"presencial_possivel":{'; then
    ok "...e o presencial é MENCIONADO, não descartado em silêncio"
  else
    falha "o presencial foi descartado em silêncio — o Eduardo pediu explicitamente que não fosse"
  fi
  if echo "$R" | grep -q '"checkout":null'; then
    falha "a menção ao presencial veio com checkout (a data vem antes do pagamento)"
  else
    ok "o caminho online levou o link do checkout"
  fi

  # E o inverso: no presencial NÃO pode sair link de checkout nenhum.
  CORPO="{$BASE_LEAD,\"lead_uid\":\"gate-pres-$RANDOM$RANDOM\",\"situacao\":\"ja-lash\",\"busca\":\"tecnica-led\",\"disponibilidade\":\"sim\",\"prefere_formato\":\"presencial\",\"faixa_investimento\":\"acima-2000\"}"
  R=$(curl -s --max-time 20 -X POST "$BASE/api/lead-presencial" -H 'Content-Type: application/json' -d "$CORPO")
  if echo "$R" | grep -q '"checkout":null'; then
    ok "o presencial NÃO recebe link de checkout"
  else
    falha "saiu checkout num caminho presencial — a Nataly combina a data antes de cobrar"
  fi
  if echo "$R" | grep -q '"preco":"R\$ 1.997"'; then
    ok "e o preço do presencial do LED é R\$ 1.997"
  else
    falha "o preço do LED presencial não bate com a página de venda"
  fi
fi

# ============================================================
echo
echo "== 3. Obrigado do online — $BASE/obrigado-profissao-lash"
# ============================================================
if baixa_pagina /obrigado-profissao-lash 8000; then
  precisa "confirma a compra"            "Compra confirmada"
  precisa "nomeia o produto certo"       "Profissão Lash"
  precisa "explica o acesso por e-mail"  "acesso chega no e-mail"
  precisa "manda conferir spam"          "spam"
  precisa "e-mail de suporte"            "natalysamribeiro@gmail.com"
  precisa "botão do grupo de suporte"    "chat.whatsapp.com/GDIAtWgrck1HzkwCL008Tv"
  precisa "evento de audiência, não de venda" "CompraConfirmada"
  precisa "fora do índice do Google"     'content="noindex"'
  comuns_precisa
  comuns_proibidos
  proibido "sem checkout numa página de obrigado" "pay.kiwify"
fi

# ============================================================
echo
echo "== 4. Obrigado do online + presencial — $BASE/obrigado-profissao-lash-presencial"
# ============================================================
if baixa_pagina /obrigado-profissao-lash-presencial 8000; then
  precisa "confirma a compra"                 "Compra confirmada"
  precisa "diz que o online já está liberado" "curso online já é seu"
  precisa "explica o acesso por e-mail"       "e-mail o link para criar a sua senha"
  precisa "manda conferir spam"               "spam"
  precisa "diz que a data será agendada"      "data da prática a gente marca junto"
  precisa "diz por onde vem o contato"        "pelo WhatsApp"
  precisa "diz o que ela faz agora"           "O que você faz agora"
  precisa "e-mail de suporte"                 "natalysamribeiro@gmail.com"
  precisa "botão do grupo de suporte"         "chat.whatsapp.com/GDIAtWgrck1HzkwCL008Tv"
  precisa "a cidade, com acento"              "Cambuí"
  precisa "fora do índice do Google"          'content="noindex"'
  comuns_precisa
  comuns_proibidos
  proibido "sem checkout numa página de obrigado" "pay.kiwify"
  proibido "sem data inventada"                   "turmas em"
fi

# ============================================================
echo
echo "== 4b. O funil de qualificação (API, painel e política)"
# ============================================================
# A API é conferida com um envio INVÁLIDO de propósito: prova que a rota
# está viva e validando, e não grava nada. Nunca use um envio válido aqui —
# o gate rodaria em produção e encheria o banco da Nataly de lead falso.
RESP=$(curl -s --max-time 20 -X POST "$BASE/api/lead-presencial" \
  -H 'Content-Type: application/json' -d '{"nome":"x"}')
if echo "$RESP" | grep -q '"erros"'; then
  ok "a API de lead responde e valida (envio inválido recusado)"
else
  falha "a API de lead não respondeu como esperado (veio: ${RESP:0:120})"
fi
# a mensagem de erro tem de ser ÚTIL: "campo inválido" não ajuda ninguém
if echo "$RESP" | grep -q "DDD"; then
  ok "o erro de telefone explica o que fazer"
else
  falha "o erro de telefone virou mensagem genérica"
fi

# o método errado não pode cair no catch-all e devolver a home
COD=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$BASE/api/lead-presencial")
if [ "$COD" = "405" ]; then ok "GET na API devolve 405, não a home"
else falha "GET na API devolveu $COD (o catch-all do site provavelmente pegou)"; fi

# ---- o painel tem de estar FECHADO ----
COD=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$BASE/crm")
if [ "$COD" = "302" ] || [ "$COD" = "503" ]; then
  ok "/crm exige sessão (devolveu $COD)"
else
  falha "/crm devolveu $COD — dados pessoais de terceiros podem estar expostos"
fi
# A distinção importa: 503 é "painel sem CRM_SENHA configurada" (seguro, mas não
# certificável); vazamento é a API devolver DADO DE LEAD sem sessão. Dizer
# "VAZAMENTO" para o caso de falta de configuração é alarme que mente sobre a
# causa — e alarme que mente custa caro no dia em que tocar de verdade.
COD_API=$(curl -s --max-time 20 -o "$TMP" -w "%{http_code}" "$BASE/crm/api/leads")
if grep -qi "telefone\|whatsapp\|instagram" "$TMP"; then
  falha "a API do painel devolveu DADO DE LEAD sem sessão — VAZAMENTO REAL (HTTP $COD_API)"
elif grep -q "nao-autenticado" "$TMP" || [ "$COD_API" = "401" ] || [ "$COD_API" = "403" ]; then
  ok "a API do painel exige sessão (HTTP $COD_API, sem dado de lead)"
elif [ "$COD_API" = "503" ]; then
  falha "painel NÃO CONFIGURADO (CRM_SENHA ausente): nada vazou, mas não dá para certificar — defina CRM_SENHA e rode de novo"
else
  falha "a API do painel respondeu HTTP $COD_API sem sessão e sem se identificar como protegida"
fi
proibido "a API do painel não devolve nome de lead sem sessão" "telefone"

# fora do índice do Google
D=$(curl -s -D - -o /dev/null --max-time 20 "$BASE/crm")
if echo "$D" | grep -qi "X-Robots-Tag: noindex"; then ok "/crm fora do índice do Google"
else falha "/crm sem X-Robots-Tag noindex"; fi
if echo "$D" | grep -qi "Cache-Control: no-store"; then ok "/crm não fica em cache"
else falha "/crm sem Cache-Control no-store"; fi

# ---- a política cobre o formulário ----
if baixa_pagina /politica-de-privacidade 10000; then
  precisa "diz que o formulário do presencial coleta dados" "formulário de inscrição no curso presencial"
  precisa "lista os dados de origem"        "fbclid"
  precisa "diz que o contato é por WhatsApp" "Entrar em contato com você pelo WhatsApp"
  precisa "diz quem enxerga os dados"       "apenas a Nataly Ribeiro e o Eduardo"
  precisa "diz que não são repassados"      "não são vendidos, alugados"
  precisa "diz por quanto tempo guarda"     "até dois anos"
  precisa "dá o canal para pedir exclusão"  "natalysamribeiro@gmail.com"
  precisa "cita a base legal"               "procedimentos preliminares"
  comuns_proibidos
fi

# ============================================================
echo
echo "== 5. As rotas antigas continuam de pé (conferidas por conteúdo)"
# ============================================================
# ⚠️ Aqui NÃO se usa 'printf ... | grep -q': com 'pipefail' ligado, o grep -q sai
# assim que acha o texto, o printf leva SIGPIPE e a pipeline devolve 141 — ou seja,
# a rota que ESTÁ intacta seria reportada como quebrada. Grava em arquivo e busca nele.
while IFS='|' read -r rota marcador; do
  curl -s --max-time 25 -o "$TMP" "$BASE$rota"
  if grep -qF "$marcador" "$TMP"; then
    ok "$rota intacta"
  else
    falha "$rota mudou ou caiu (não achei: $marcador)"
  fi
done <<'ROTAS'
/captacao-iniciante-online|Aula ao vivo e gratuita
/presencial|Método LED — Formação Presencial
/lancamento-presencial|Método LED — Formação Presencial
/profissao-lash-curso|39 aulas teóricas
/obrigado|Compra confirmada · Lash 2.0
/obrigado-presencial|Vaga garantida
/lancamento-497|Lash 2.0 — O Método LED
ROTAS

# ============================================================
echo
echo "== 5b. A pagina de links da bio (/links e /bio)"
# ============================================================
# Ela e o link da bio do Instagram: se um destino estiver errado, TODO o trafego
# organico vai pro lugar errado sem ninguem perceber. Confere ORDEM e DESTINO.
for rota in /links /bio; do
  if baixa_pagina "$rota" 6000; then
    # 1. o destino ANTIGO do cartao 2 nao pode voltar: /captacao-iniciante-online
    #    e a captacao da aula gratuita, NAO a pagina de venda do iniciante.
    proibido "$rota nao aponta pro destino antigo do iniciante" "/captacao-iniciante-online"

    # 2. os 6 destinos, NA ORDEM. Extrai os href dos cartoes e compara a sequencia.
    #    Sem a ordem, um cartao trocado de lugar passaria batido.
    ORDEM_ESPERADA="/profissao-lash-presencial /profissao-lash-curso /lash-2-metodo-led /presencial /apostila /led-pro/"
    ORDEM_ACHADA=$(grep -oE 'href="https://natalyribeiro\.com\.br[^"?]*' "$TMP" \
      | sed 's|href="https://natalyribeiro.com.br||' | tr '\n' ' ' | sed 's/ *$//')
    if [ "$ORDEM_ACHADA" = "$ORDEM_ESPERADA" ]; then
      ok "$rota tem os 6 destinos na ordem certa"
    else
      falha "$rota com destinos fora de ordem — esperado [$ORDEM_ESPERADA], achei [$ORDEM_ACHADA]"
    fi

    # 3. UTM de bio em TODOS os 6 cartoes (sem isso nao da pra medir o que a bio traz)
    N_UTM=$(grep -c 'utm_source=instagram&utm_medium=bio' "$TMP")
    if [ "$N_UTM" -ge 6 ]; then ok "$rota: os 6 cartoes tem UTM de bio ($N_UTM)"
    else falha "$rota: so $N_UTM cartao(oes) com UTM de bio, precisa de 6"; fi

    # 4. nenhum placeholder de template pode ficar em pagina de producao
    proibido "$rota sem placeholder de usuario"  "SEU_USUARIO"
    proibido "$rota sem placeholder de telefone" "SEUNUMERO"

    # 5. o pedido do Edu: fundo marrom escuro e voz grotesca, nao cursiva
    precisa "$rota com fundo marrom escuro" "#241C15"
    precisa "$rota com Hanken Grotesk"      "Hanken+Grotesk"
    proibido "$rota sem Cormorant (cursiva a mais)" "Cormorant"

    # 6. regra do design system: filete 1px, nunca sombra
    # a PROPRIEDADE, nao a palavra: o comentario do CSS explica a regra e
    # citaria o termo sem que exista uma sombra de verdade na pagina.
    proibido_re "$rota sem sombra (filete 1px, nunca box-shadow)" "box-shadow[[:space:]]*:"

    comuns_proibidos
  fi
done

# ============================================================
echo
echo "== 6. Assets pesados respondem de verdade"
# ============================================================
for a in /video/vsl-profissao-lash.mp4 /img/iniciante/vsl-poster.jpg /img/nataly-bio-led.jpg /js/pixel.js /js/analytics.js; do
  BYTES=$(curl -s --max-time 30 -r 0-2047 -o /dev/null -w "%{size_download}" "$BASE$a")
  if [ "${BYTES:-0}" -gt 1000 ]; then ok "$a responde com dados"
  else falha "$a não devolveu dados (baixou ${BYTES:-0} bytes)"; fi
done

# ============================================================
echo
echo "== 7. Layout — nenhuma caixa pode vazar do pai"
# ============================================================
# Existe porque o cartao da bio transbordava 232px e TODOS os checks de texto
# passavam: o overflow do BODY era zero em 320/390/430 e so aparecia a 900px.
# Auditar a largura da CAIXA, nao o alinhamento do texto.
if [ "$ALVO" = "local" ]; then
  node verificar-layout.js "$BASE" "${CRM_SENHA:-}" > /tmp/layout-check.txt 2>&1
  RC=$?
  if [ "$RC" -eq 2 ]; then
    falha "checagem de layout NAO rodou (puppeteer indisponivel) — nao conte como aprovado"
  elif [ "$RC" -ne 0 ]; then
    grep "FALHA" /tmp/layout-check.txt | while read -r l; do echo "$l"; done
    N=$(grep -c "FALHA" /tmp/layout-check.txt)
    FALHAS=$((FALHAS+N))
  else
    ok "nenhuma caixa vaza do pai em 320/390/430/900/1280px"
  fi
fi

rm -f "$TMP"
echo
if [ "$FALHAS" -eq 0 ]; then
  echo "TUDO CERTO. As páginas podem ser divulgadas."
else
  echo "$FALHAS FALHA(S). NÃO divulgue ainda."
fi
exit "$FALHAS"

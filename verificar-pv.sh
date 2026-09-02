#!/usr/bin/env bash
# Confere as páginas do Profissão Lash por CONTEÚDO, nunca por status code.
# Cobre as 4 páginas da família e ainda checa se as rotas antigas continuam
# servindo o que serviam. Sai com o NÚMERO DE FALHAS (0 = pode divulgar).
#
#   ./verificar-pv.sh            -> verifica em produção
#   ./verificar-pv.sh local      -> verifica em http://127.0.0.1:3999
set -uo pipefail

ALVO="${1:-producao}"
# BASE_LOCAL existe para quando MAIS DE UMA pessoa mexe na mesma árvore ao mesmo
# tempo — que foi o caso em 02/09/2026, com três frentes abertas. Sem isto, o
# gate só sabe falar com a 3999: quem subisse o segundo servidor exercitaria o
# processo do outro, que tem o código ANTIGO carregado na memória (os módulos do
# funil são `require`ados no boot), e reprovaria rotas que existem.
# Sem a variável, nada muda: continua a 3999 de sempre.
if [ "$ALVO" = "local" ]; then BASE="${BASE_LOCAL:-http://127.0.0.1:3999}"; else BASE="https://natalyribeiro.com.br"; fi
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
# precisa_vivo <rótulo> <marcador> — o espelho do `proibido_vivo`, e ele
# faltava. Sem ele, um `precisa` era satisfeito pelo COMENTÁRIO que explica a
# regra: em 02/09/2026 o check "o funil fecha com quem terminou" passou com a
# linha do funil APAGADA, porque o comentário logo acima dela ainda dizia
# "Terminaram o formulário". Todo `precisa` cujo marcador também apareça num
# comentário tem de ser este aqui — senão o gate certifica a explicação em vez
# do código.
precisa_vivo(){ if grep -qF "$2" "$TMP.vivo"; then ok "$1"; else falha "$1 (não achei no código vivo: $2)"; fi; }

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
  # A versao SEM COMENTARIO tem de existir antes do primeiro `proibido_vivo`.
  sem_comentarios
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
  precisa "a tarja diz a cidade"             "Presencial em Cambuí, MG"
  # 02/09/2026: o Eduardo pediu a distância na tarja — "Cambuí, MG" sozinho não
  # diz nada para quem nunca ouviu falar da cidade, e é AQUI que ela decide se
  # é longe demais. As 2h foram confirmadas pela Nataly.
  precisa "a tarja diz a distância"          "2h de São Paulo"
  # 🔴 A "TARJA BRANCA" QUE O EDUARDO PEDIU PARA TIRAR. Nunca houve duas
  # tarjas: a tarja é um <p>, e a margem de 16px que todo navegador dá a um
  # parágrafo aparecia como uma faixa creme entre ela e o hero escuro. Sem
  # `margin:0` no seletor, a faixa volta — e volta silenciosamente.
  precisa_re1 "a tarja não tem margem (a faixa creme era isso)" '\.tarja\{[^}]*margin:0'
  # -- a dobra de distâncias, também pedida em 02/09 --
  precisa "a dobra de onde fica Cambuí"      "Onde fica Cambuí"
  precisa "diz que é na Fernão Dias"         "Fernão Dias"
  precisa "tempo de São Paulo na dobra"      "São Paulo, capital"
  precisa "tempo de Pouso Alegre"            "Pouso Alegre"
  precisa "os tempos são declarados aproximados" "Tempos aproximados"
  # -- o player: tela cheia e a barra --
  precisa "botão de tela cheia no player"    'id="btn-tela"'
  precisa "tela cheia pelo contêiner (mantém os controles)" "requestFullscreen"
  # 🔴 Sem este caminho o botão não faz NADA no iPhone: o Safari do iOS não
  # implementa requestFullscreen em elemento comum, só webkitEnterFullscreen
  # no próprio <video>. E é no iPhone que a maioria assiste.
  precisa "tela cheia pelo caminho do iPhone" "webkitEnterFullscreen"
  precisa "a barra acelerada usa o expoente"  "var EXPO  = 0.45"
  proibido "o expoente antigo saiu"          "var EXPO  = 0.50"
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
  # 🔴 VELOCIDADE (02/09/2026): a VSL tem 21 MB. Com preload="auto" o navegador
  #    começaria a baixar o filme inteiro junto com a página, competindo com o
  #    texto que a pessoa precisa ler. `metadata` baixa só o cabeçalho.
  #    Já voltou para "auto" uma vez; este check existe para não voltar de novo.
  precisa_re1 "a VSL de 21 MB carrega só o cabeçalho" '<video[^>]*preload="metadata"'
  proibido_vivo_re "a VSL NÃO voltou para preload=auto" 'preload="auto"'
  # os dois domínios mais pesados abrem conexão em paralelo (~351 KB de script)
  precisa "preconnect ao domínio do pixel" "preconnect\" href=\"https://connect.facebook.net"
  precisa "preconnect ao domínio do GA4"   "preconnect\" href=\"https://www.googletagmanager.com"
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
  # A versao SEM COMENTARIO precisa existir ANTES do primeiro `proibido_vivo`.
  # Sem esta linha, `$TMP.vivo` seria o resto da pagina anterior e os checks
  # abaixo estariam auditando o arquivo errado — passando por acidente.
  sem_comentarios
  # -- a abertura --
  precisa "tela de boas-vindas"              'data-etapa="0"'
  # 🔴 Foto trocada em 02/09/2026 a pedido da NATALY: a anterior era gerada por
  #    IA e ela pediu uma real. Esta e' ela com uma aluna e o certificado
  #    assinado por ela como coordenadora.
  precisa "TEM a foto real da Nataly com a aluna" "/img/nataly-alunas-certificado.jpg"
  precisa_re1 "a foto declara width/height"  'nataly-alunas-certificado-700\.jpg"[^>]*width="1400" height="1400"'
  # a versao grande continua servida para tela 3x — nao pode sumir do srcset
  precisa "a foto tem as duas larguras (srcset)" 'nataly-alunas-certificado.jpg 1400w'
  precisa "e diz o tamanho da caixa medido"      'sizes="340px"'
  # os dois dominios mais pesados abrem conexao em paralelo
  precisa "preconnect ao dominio do pixel"       "preconnect\" href=\"https://connect.facebook.net"
  precisa "preconnect ao dominio do GA4"         "preconnect\" href=\"https://www.googletagmanager.com"
  proibido "a foto gerada por IA não voltou"  "/img/nataly-smile-shoulder.jpg"
  # A outra marca não pode entrar aqui: o certificado da Resnichka e' de um
  # curso em que a Nataly e' INSTRUTORA, e confunde com o que a aluna recebe.
  proibido_vivo "sem certificado de outra marca (Resnichka)" "resnichka"
  precisa "botão de começar"                 'id="comecar"'
  # 🔴 NENHUM NÚMERO DE PERGUNTAS. São 10, ou 11 para quem já trabalha com
  #    cílios — e a própria tela mostra "Pergunta 11 de 11". Prometer um
  #    número fixo mente para metade das pessoas logo na abertura.
  precisa "não promete um número fixo de perguntas" "São poucas perguntas, menos de dois minutos"
  proibido_vivo "sem contagem de perguntas cravada (nove)" "nove perguntas"
  proibido_vivo "sem contagem de perguntas cravada (dez)"  "dez perguntas"
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

  # -- AS TRÊS TELAS (02/09/2026) --------------------------------------
  # 🔴 A ORDEM É O PEDIDO. Antes, o fim das perguntas gravava a inscrição,
  # avisava a Nataly e disparava o `Lead` — e a tela abria dizendo "recebi a
  # sua inscrição" com o preço ESCONDIDO ABAIXO. Quem não rolava concluía que
  # a recomendação não veio; e quem via o preço já constava como inscrita.
  # Agora: perguntas → recomendação → (clique) → recebido.
  precisa "a tela da recomendação existe"    'id="recomendacao"'
  precisa "a tela do recebido existe"        'id="obrigado"'
  precisa "o bloco do produto existe"        'id="rec"'
  precisa "diz qual é a opção ideal"         "opção ideal para você"
  precisa "espaço para o nome do produto"    'id="rec-nome"'
  precisa "espaço para o porquê"             'id="rec-porque"'
  precisa "espaço para o preço"              'id="rec-preco"'
  precisa "espaço para o que está incluso"   'id="rec-inclui"'
  precisa "caixa do presencial para quem só travou no bolso" 'id="rec-extra"'
  precisa "o produto vem do SERVIDOR"        "res.j.recomendacao"
  precisa "a recomendação vem da rota própria" "/api/recomendacao-presencial"
  precisa "o presencial não recebe checkout" "primeiro a"

  # 🔴 A TELA DA RECOMENDAÇÃO NÃO PODE DIZER QUE RECEBEU. Era exatamente esse
  # o erro: "Pronto, recebi a sua inscrição" aparecia ANTES de ela querer.
  # A frase agora vive só na tela 3, e o gate mede por POSIÇÃO de byte.
  P_REC=$(grep -boF 'id="recomendacao"' "$TMP" | head -1 | cut -d: -f1)
  P_OBR=$(grep -boF 'id="obrigado"' "$TMP" | head -1 | cut -d: -f1)
  P_PRONTO=$(grep -boF 'recebi a sua inscrição' "$TMP" | head -1 | cut -d: -f1)
  if [ -z "$P_REC" ] || [ -z "$P_OBR" ] || [ -z "$P_PRONTO" ]; then
    falha "não achei as duas telas finais para medir a ordem delas"
  elif [ "$P_REC" -lt "$P_OBR" ] && [ "$P_PRONTO" -gt "$P_OBR" ]; then
    ok "a recomendação vem ANTES do recebido, e o 'recebi' só existe na tela 3"
  else
    falha "a ordem das telas quebrou (recomendação $P_REC, recebido $P_OBR, 'recebi' $P_PRONTO)"
  fi

  # -- O BOTÃO, NOS DOIS CAMINHOS ---------------------------------------
  # 🔴 A CAUSA do "o botão não faz nada no celular": existia UM botão só,
  # revelado apenas quando `formato === 'online' && checkout`. No caminho
  # PRESENCIAL ele ficava `hidden` de propósito e a tela terminava sem nada
  # para apertar. São dois elementos porque os papéis são diferentes: <a> que
  # navega para o checkout e <button> que confirma o interesse.
  precisa "botão de checkout do online (âncora)"   'id="rec-cta"'
  precisa "botão de confirmar do presencial"       'id="rec-confirmar"'
  precisa "o presencial CONFIRMA de verdade"       "function confirma"
  precisa "os dois botões têm o mesmo rótulo"      "Quero garantir a minha vaga"
  precisa "o clique do presencial está ligado"     "btConfirmar.addEventListener"
  precisa "o clique do checkout está ligado"       "aCta.addEventListener"
  # O <a> do checkout NÃO pode ter preventDefault: é a navegação dele que faz
  # o InitiateCheckout do pixel.js disparar e a decoração de UTM valer.
  proibido "o link do checkout não é interceptado" "aCta.addEventListener('click', function (ev) { ev.preventDefault"
  precisa "o POST sobrevive à navegação"           "keepalive: true"
  # A escassez do presencial é verdadeira (turma pequena) e o Eduardo pediu.
  precisa "o presencial diz que a turma é selecionada" 'id="rec-exclusivo"'
  precisa "e diz por quê"                          "turma pequena"

  # -- a tela entra ROLADA NO TOPO --------------------------------------
  # Sem isto a tela nova herdava a rolagem da pergunta anterior e a
  # recomendação nascia acima da dobra, sem ninguém ver — que foi o relato.
  precisa "a tela da recomendação começa no topo"  "window.scrollTo(0, 0)"
  precisa "o foco não briga com a rolagem"         "preventScroll: true"

  # -- CAMPO DE ESTADO COM BUSCA (02/09/2026) ---------------------------
  # Pedido do Eduardo: "ao selecionar estado, você deveria poder escrever e
  # aparecer uma seleção com todos os estados para escolher". Sem biblioteca.
  precisa "o estado é um combo com busca"    'role="combobox"'
  precisa "a lista é um listbox"             'role="listbox"'
  precisa "o combo diz se está aberto"       'aria-expanded="false"'
  precisa "e aponta a opção do teclado"      "aria-activedescendant"
  precisa "os 27 estados estão na página"    "Rio Grande do Norte"
  precisa "busca sem acento acha com acento" "normalize('NFD')"
  # O que vai para o servidor continua sendo a SIGLA de duas letras.
  precisa "o valor enviado é a sigla"        'id="f-estado" name="estado"'
  # 🔴 Enter escolhendo o estado NÃO pode avançar a pergunta junto.
  precisa "Enter no combo não pula a pergunta" "ev.stopPropagation()"

  # -- ONDE FICA CAMBUÍ, dentro da pergunta (02/09/2026) ----------------
  # O mapa com rota exigiria a API paga do Google; o Eduardo dispensou. Ficou
  # a referência em texto mais um link que abre o Maps do celular dela.
  precisa "a pergunta diz a distância de São Paulo" "2h de São Paulo"
  precisa "e a de Pouso Alegre"              "40 minutos de Pouso Alegre"
  precisa "link para o Maps com destino travado" "maps/dir/?api=1"
  proibido_re "NENHUMA chave da API do Google no cliente" "AIza[0-9A-Za-z_-]{20}"
  proibido "não carrega a API paga de mapas" "maps.googleapis.com"

  # -- a pergunta do dinheiro não é sondagem de preço -------------------
  # Sem esta linha a pergunta parece uma sondagem de quanto dá para cobrar de
  # cada uma. Quem desconfia mente para baixo ou abandona — e é a ÚLTIMA
  # pergunta, onde desistir custa mais caro.
  precisa "diz que a resposta não muda o preço" "não muda o valor de nada"

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
  precisa "evento por ETAPA (Meta)"          "'EtapaFormulario'"
  precisa "evento por ETAPA (GA4)"           "'form_step'"
  precisa "etapa conta uma vez por sessão"   "nr_etapa_"
  # Sem o +1 de propósito: a abertura ocupa a casa 0 da fila, então o índice da
  # pergunta 1 já é 1. Com o +1 a última saía como "12 de 11".
  proibido "posição da etapa não soma 1 a mais" "indexOf(String(id)) + 1"
  precisa "intenção do GA4 na chegada"       "'select_item'"
  precisa "evento da recomendação"           "'ViuRecomendacao'"
  precisa "GA4 na recomendação"              "'view_recommendation'"
  precisa "Lead no envio"                    "'Lead'"
  precisa "o Lead DIZ QUAL PRODUTO"          "content_ids: [prod.id]"
  precisa "evento com nome próprio por produto" "'Lead_' + prod.id"
  precisa "GA4 generate_lead no envio"       "'generate_lead'"
  precisa "o GA4 também diz o produto"       "produto: prod.id"
  precisa "beacon no evento antes de sair"   "transport_type: 'beacon'"

  # ============================================================
  # 🔴 O `Lead` SÓ NASCE DO CLIQUE (02/09/2026)
  # ============================================================
  # É o evento pelo qual a campanha de R$ 120/dia otimiza. Disparado no fim
  # das perguntas — como era até 02/09 — ele ensinaria o algoritmo a procurar
  # quem só olha o preço, e a gente pagaria por isso todo dia.
  precisa "o Lead mora numa função própria"  "function disparaLead"
  precisa "e ela é chamada no clique"        "disparaLead(dados.lead_uid)"
  precisa "o Lead é travado em 1 por sessão" "nr_lead_presencial"
  # A prova de ORDEM: `disparaLead` tem de ser chamado DEPOIS de
  # `mostraRecomendacao` no arquivo, e nunca de dentro dela.
  P_MOSTRA=$(grep -boF 'function mostraRecomendacao' "$TMP" | head -1 | cut -d: -f1)
  P_CONFIRMA=$(grep -boF 'function confirma' "$TMP" | head -1 | cut -d: -f1)
  P_CHAMA=$(grep -boF 'disparaLead(dados.lead_uid)' "$TMP" | head -1 | cut -d: -f1)
  if [ -z "$P_MOSTRA" ] || [ -z "$P_CONFIRMA" ] || [ -z "$P_CHAMA" ]; then
    falha "não achei as funções do fluxo para medir onde o Lead é disparado"
  elif [ "$P_CHAMA" -gt "$P_CONFIRMA" ] && [ "$P_CONFIRMA" -gt "$P_MOSTRA" ]; then
    ok "o Lead é disparado dentro de confirma(), depois da tela da recomendação"
  else
    falha "o Lead saiu do lugar (mostra $P_MOSTRA, confirma $P_CONFIRMA, chamada $P_CHAMA)"
  fi
  # E a tela da recomendação dispara o ViuRecomendacao, que é o PAR do Lead:
  # a distância entre os dois é quanta gente viu o preço e não quis.
  # ⚠️ Não dá para provar isto com `grep -F` de duas linhas: um padrão com \n
  # vira DOIS padrões em OU, e a checagem casaria a linha do meio do arquivo e
  # reprovaria código certo. Quem prova a ordem é a medida por posição acima.
  precisa "a recomendação dispara o par do Lead" "'ViuRecomendacao'"
  # 🔴 O eventID é o que deduplica o Lead do navegador com o do CAPI. Sem ele o
  # Meta contaria a mesma inscrição duas vezes e o custo por lead do relatório
  # cairia pela metade sem nada ter melhorado.
  precisa "o Lead leva eventID (dedupe com o CAPI)" "{ eventID: uid }"
  # ⚠️ MUDOU EM 01/09/2026. Antes da árvore, nenhum caminho desta página levava
  # a checkout, e disparar InitiateCheckout aqui era erro. Hoje metade dos
  # caminhos termina num checkout Kiwify, então o evento é OBRIGATÓRIO — e a
  # trava de 1 por sessão é obrigatória junto, senão volta o vício que deixou
  # o A/B do Método LED ilegível (um IC por clique).
  precisa "trava de 1 InitiateCheckout por sessão" "window.IC_UNICO = true"
  precisa "o produto certo assume os eventos"      "window.NR_PRODUTO ="
  proibido "NUNCA Purchase aqui"             "'Purchase'"

  # ---- CAPTURA PARCIAL (02/09/2026) -----------------------------------
  # O formulário tem de gravar o lead ANTES do fim. Quem abandona some — e
  # some justamente quem chegou perto de comprar.
  precisa "o formulário grava o parcial"        "/api/lead-parcial"
  precisa "a gravação parcial existe"           "function mandaParcial"
  precisa "o gatilho é nome + WhatsApp"         "function temContato"
  precisa "manda a etapa onde ela está"         "ultima_etapa: String(etapaId)"
  precisa "o uid atravessa o preenchimento"     "function garanteUid"
  precisa "o uid vive no rascunho"              "d._uid = LEAD_UID"
  precisa "o envio final reusa o MESMO uid"     "lead_uid: garanteUid()"
  precisa "salva também quando ela fecha a aba" "navigator.sendBeacon"
  precisa "cobre o app indo para segundo plano" "visibilitychange"
  precisa "as chamadas são enfileiradas (ordem)" "filaParcial = filaParcial.then"
  # 🔴 O EVENTO. `Lead` é por onde a campanha do Meta otimiza: dispará-lo no
  #    parcial ensinaria o algoritmo a buscar quem abandona.
  precisa "o parcial tem evento PRÓPRIO no Meta" "'LeadParcial'"
  precisa "e no GA4 também"                      "'lead_partial'"
  precisa "o LeadParcial conta uma vez por sessão" "nr_lead_parcial"
  # O `Lead` de verdade continua existindo, e existe UMA VEZ SÓ: dentro de
  # `sucesso()`. Duas ocorrências significam que alguém o copiou para o
  # caminho do parcial.
  N_LEAD=$(grep -c "fbq('track', 'Lead'" "$TMP")
  if [ "$N_LEAD" = "1" ]; then ok "o evento Lead é disparado em UM lugar só (o envio final)"
  else falha "achei $N_LEAD disparos de Lead no formulário — o parcial NÃO pode disparar Lead"; fi
  proibido "o parcial não dispara Lead (nem por engano)" "'Lead', COMUNS"

  # ---- HONESTIDADE COM QUEM PREENCHE ----
  # Se a gente guarda antes do fim, a gente conta. Aqui, onde ela está olhando.
  precisa "o rodapé diz que as respostas já são salvas" "As suas respostas vão sendo salvas conforme você"
  precisa "e diz para que serve isso"                   "eu ainda consigo te"
  proibido "o rodapé não diz mais 'ao enviar' (era mentira por omissão)" "Ao enviar, você concorda"

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
echo "== 2d. A CAPTURA PARCIAL — a API de verdade"
# ============================================================
# ⚠️ Grava lead. Só roda em local, pelo mesmo motivo da árvore.
if [ "$ALVO" != "local" ]; then
  # Em produção dá para conferir o que NÃO grava nada: que a rota existe e
  # recusa o método errado. É pouco, mas é honesto — e é melhor que silêncio.
  COD=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$BASE/api/lead-parcial")
  if [ "$COD" = "405" ]; then ok "a rota do parcial existe (GET devolve 405)"
  else falha "GET em /api/lead-parcial devolveu $COD — a rota sumiu ou o catch-all pegou"; fi
  echo "aviso  gravação parcial não exercitada em produção (grava lead) — rode ./verificar-pv.sh local"
else
  UIDP="gate-parcial-$RANDOM$RANDOM"
  PJSON(){ curl -s --max-time 20 -X POST "$BASE/api/lead-parcial" \
             -H 'Content-Type: application/json' -d "$1"; }

  # 1. sem contato utilizável não grava nada
  R=$(PJSON "{\"nome\":\"So Nome\",\"lead_uid\":\"$UIDP\",\"ultima_etapa\":\"2\"}")
  if echo "$R" | grep -q '"motivo":"sem-contato"'; then
    ok "sem WhatsApp válido o parcial NÃO grava (linha que ninguém consegue chamar)"
  else falha "o parcial gravou sem telefone (veio: ${R:0:120})"; fi

  # 2. o gatilho: nome + WhatsApp
  R=$(PJSON "{\"nome\":\"Gate Parcial\",\"telefone\":\"(35) 99716-4668\",\"cidade\":\"Cambui\",\"lead_uid\":\"$UIDP\",\"ultima_etapa\":\"4\"}")
  if echo "$R" | grep -q '"gravado":true'; then ok "nome + WhatsApp é o gatilho: o parcial grava"
  else falha "o gatilho do parcial não gravou (veio: ${R:0:160})"; fi

  # 3. a segunda etapa cai na MESMA linha, e não apaga o que já sabia
  PJSON "{\"nome\":\"Gate Parcial\",\"telefone\":\"(35) 99716-4668\",\"instagram\":\"@gate_parcial\",\"situacao\":\"ja-lash\",\"busca\":\"tecnica-led\",\"disponibilidade\":\"sim\",\"prefere_formato\":\"presencial\",\"lead_uid\":\"$UIDP\",\"ultima_etapa\":\"10\"}" > /dev/null

  # 4. o envio FINAL com o MESMO uid tem de PROMOVER a linha — e a Nataly
  #    precisa continuar sendo avisada. Se isto quebrar, o funil parece
  #    funcionar e ninguém recebe aviso de venda nenhuma.
  R=$(curl -s --max-time 20 -X POST "$BASE/api/lead-presencial" -H 'Content-Type: application/json' \
      -d "{\"nome\":\"Gate Parcial\",\"telefone\":\"(35) 99716-4668\",\"cidade\":\"Cambui\",\"instagram\":\"@gate_parcial\",\"situacao\":\"ja-lash\",\"busca\":\"tecnica-led\",\"quando_comecar\":\"agora\",\"disponibilidade\":\"sim\",\"prefere_formato\":\"presencial\",\"faixa_investimento\":\"acima-2000\",\"lead_uid\":\"$UIDP\"}")
  if echo "$R" | grep -q '"dedupe":true'; then
    falha "🔴 o envio final caiu no ramo de DEDUPE por causa do parcial — a Nataly PARARIA DE SER AVISADA"
  elif echo "$R" | grep -q '"id":"lash2-presencial"'; then
    ok "o envio final promove o parcial e sai com a recomendação certa"
  else
    falha "o envio final depois do parcial não devolveu a recomendação (veio: ${R:0:160})"
  fi

  # 5. o beacon atrasado NÃO pode estragar o lead pronto
  R=$(PJSON "{\"nome\":\"Gate Parcial\",\"telefone\":\"(35) 99716-4668\",\"lead_uid\":\"$UIDP\",\"ultima_etapa\":\"10\"}")
  if echo "$R" | grep -q '"ja_completo":true'; then
    ok "o parcial atrasado é recusado depois do envio final"
  else falha "um parcial atrasado sobrescreveria o lead pronto (veio: ${R:0:120})"; fi

  # 6. sem uid não grava: sete etapas viariam sete leads gêmeos da mesma pessoa
  R=$(PJSON "{\"nome\":\"Sem Uid\",\"telefone\":\"(35) 99716-4668\",\"ultima_etapa\":\"4\"}")
  if echo "$R" | grep -q '"motivo":"sem-uid"'; then ok "sem lead_uid o parcial não grava (evita gêmeos)"
  else falha "o parcial gravou sem uid — cada etapa viraria um lead novo"; fi

  # 7. a armadilha de robô vale aqui também
  R=$(PJSON "{\"nome\":\"Robo\",\"telefone\":\"(35) 99716-4668\",\"sobrenome_confirmacao\":\"x\",\"lead_uid\":\"gate-robo-$RANDOM\"}")
  if echo "$R" | grep -q '"ignorado":"robo"'; then ok "a armadilha de robô também protege o parcial"
  else falha "o honeypot não pegou no parcial (veio: ${R:0:120})"; fi

  # 8. e a suíte de unidade do parcial, que cobre a MIGRAÇÃO em banco antigo
  if FUNIL_DEV_DIR=.dados-teste node funil-presencial/teste-parcial.js > /tmp/nr-parcial.txt 2>&1; then
    ok "a suíte do parcial passa (migração em banco antigo, upsert, aviso e texto)"
  else
    falha "teste-parcial.js falhou — veja /tmp/nr-parcial.txt"
    grep "FALHA" /tmp/nr-parcial.txt | head -8 | sed 's/^/       /'
  fi
fi

# ============================================================
echo
echo "== 2e. A RECOMENDAÇÃO — a tela que vem ANTES do envio"
# ============================================================
# ⚠️ Grava lead. Só roda em local, pelo mesmo motivo da árvore e do parcial.
if [ "$ALVO" != "local" ]; then
  # Em produção dá para conferir o que NÃO grava: que a rota existe e recusa o
  # método errado. Se ela sumir, o formulário inteiro para no fim das perguntas.
  COD=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$BASE/api/recomendacao-presencial")
  if [ "$COD" = "405" ]; then ok "a rota da recomendação existe (GET devolve 405)"
  else falha "GET em /api/recomendacao-presencial devolveu $COD — a rota sumiu ou o catch-all pegou"; fi
  echo "aviso  recomendação não exercitada em produção (grava lead) — rode ./verificar-pv.sh local"
else
  UIDR="gate-rec-$RANDOM$RANDOM"
  CORPO_REC="{\"nome\":\"Gate Recomendacao\",\"telefone\":\"(35) 99716-4668\",\"cidade\":\"Cambui\",\"instagram\":\"@gate_rec\",\"quando_comecar\":\"agora\",\"situacao\":\"ja-lash\",\"busca\":\"tecnica-led\",\"faixa_idade\":\"25-34\",\"meta_renda\":\"5k-10k\",\"disponibilidade\":\"sim\",\"prefere_formato\":\"presencial\",\"faixa_investimento\":\"acima-2000\",\"lead_uid\":\"$UIDR\"}"

  # 1. a rota devolve o produto, o preço e o porquê — que é o que a tela mostra
  R=$(curl -s --max-time 20 -X POST "$BASE/api/recomendacao-presencial" \
        -H 'Content-Type: application/json' -d "$CORPO_REC")
  if echo "$R" | grep -q '"id":"lash2-presencial"'; then
    ok "a recomendação devolve o produto certo para estas respostas"
  else falha "a recomendação não devolveu o produto esperado (veio: ${R:0:160})"; fi
  if echo "$R" | grep -q '"preco":"R\$ 1.997"'; then
    ok "e devolve o preço, que é o que a tela precisa mostrar"
  else falha "a recomendação veio sem preço (veio: ${R:0:160})"; fi
  if echo "$R" | grep -q '"gravado":true'; then
    ok "e grava a linha de quem viu o preço"
  else falha "a recomendação NÃO gravou — perdemos o lead comercial mais forte do funil"; fi
  # 🔴 O presencial NUNCA recebe link de pagamento aqui: a data vem antes.
  if echo "$R" | grep -q '"checkout":null'; then
    ok "o presencial não recebe checkout na recomendação"
  else falha "veio link de pagamento no presencial — venderia uma vaga sem data"; fi

  # 2. sem as respostas todas não há recomendação para dar. Devolver um produto
  #    chutado seria pior do que devolver erro: a Nataly leria o chute como
  #    indicação de verdade.
  R=$(curl -s --max-time 20 -X POST "$BASE/api/recomendacao-presencial" \
        -H 'Content-Type: application/json' \
        -d '{"nome":"Gate Incompleto","telefone":"(35) 99716-4668","lead_uid":"gate-rec-incompleto"}')
  if echo "$R" | grep -q '"erros"'; then
    ok "sem as respostas todas, a recomendação recusa em vez de chutar produto"
  else falha "a recomendação aceitou um corpo incompleto (veio: ${R:0:160})"; fi

  # 3. o robô leva 200 e não grava nada
  R=$(curl -s --max-time 20 -X POST "$BASE/api/recomendacao-presencial" \
        -H 'Content-Type: application/json' \
        -d "{\"nome\":\"Robo\",\"telefone\":\"(35) 99716-4668\",\"sobrenome_confirmacao\":\"pego\",\"lead_uid\":\"gate-rec-robo\"}")
  if echo "$R" | grep -q '"dedupe":true'; then ok "a armadilha de robô responde manso e não grava"
  else falha "a armadilha de robô da recomendação não pegou (veio: ${R:0:120})"; fi

  # 4. GET não passa
  COD=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$BASE/api/recomendacao-presencial")
  if [ "$COD" = "405" ]; then ok "GET na recomendação devolve 405"
  else falha "GET em /api/recomendacao-presencial devolveu $COD"; fi

  # 5. o clique promove a MESMA linha a inscrição
  R=$(curl -s --max-time 20 -X POST "$BASE/api/lead-presencial" \
        -H 'Content-Type: application/json' -d "$CORPO_REC")
  if echo "$R" | grep -q '"ok":true'; then
    ok "o clique em garantir a vaga fecha a inscrição da mesma pessoa"
  else falha "o envio final falhou depois da recomendação (veio: ${R:0:160})"; fi

  # 6. e a suíte que prova o resto: grava incompleta, avisa com texto próprio,
  #    promove no clique e não aparece na lista de inscrições.
  if FUNIL_DEV_DIR=.dados-teste node funil-presencial/teste-recomendacao.js > /tmp/nr-rec.txt 2>&1; then
    ok "a suíte da recomendação passa (grava incompleta, aviso próprio, promoção no clique)"
  else
    falha "teste-recomendacao.js falhou — veja /tmp/nr-rec.txt"
    grep "FALHA" /tmp/nr-rec.txt | head -8 | sed 's/^/       /'
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

# ---- O PAINEL POR DENTRO ----------------------------------------------
# Os checks acima provam que /crm esta FECHADO. Estes provam que, aberto,
# ele e o painel certo. Exigem credencial, entao so rodam quando ela existe
# no ambiente (CRM_CONTAS ou CRM_SENHA) — e quando nao existe, dizem isso
# em vez de ficarem calados, que e como um gate passa a mentir.
CRM_U=""; CRM_P=""
if [ -n "${CRM_CONTAS:-}" ]; then
  PAR="${CRM_CONTAS%%,*}"
  CRM_U="${PAR%:*}"; CRM_P="${PAR##*:}"
elif [ -n "${CRM_SENHA:-}" ]; then
  CRM_U="${CRM_USUARIO:-nataly}"; CRM_P="$CRM_SENHA"
fi

if [ -z "$CRM_P" ]; then
  echo "AVISO  painel não auditado por dentro: defina CRM_CONTAS para conferir o conteúdo do /crm"
else
  CK=$(mktemp)
  ENTROU=$(curl -s -c "$CK" --max-time 20 -X POST "$BASE/crm/entrar" \
    -H 'Content-Type: application/json' \
    -d "{\"usuario\":\"$CRM_U\",\"senha\":\"$CRM_P\"}")
  if echo "$ENTROU" | grep -q '"ok":true'; then
    ok "entrei no painel com a conta configurada"
    curl -s -b "$CK" --max-time 20 -o "$TMP" "$BASE/crm"
    TAM=$(wc -c < "$TMP" | tr -d ' ')
    if [ "$TAM" -gt 30000 ]; then ok "/crm serve o painel ($TAM bytes)"
    else falha "/crm veio com $TAM bytes — o catch-all serviu outra coisa?"; fi
    sem_comentarios

    # 🔴 A REGRA QUE NAO PODE VOLTAR: o link do WhatsApp abre a conversa
    # VAZIA. Havia texto pronto assinado como a Nataly em DOIS lugares e o
    # Edu barrou em 01/09/2026. Ninguem escreve na voz de outra pessoa.
    proibido_vivo_re "WhatsApp SEM mensagem pronta (a conversa abre vazia)" "wa\.me/[^\"']*[?&]text="
    proibido_vivo_re "WhatsApp sem parâmetro de mensagem (api.whatsapp)"    "whatsapp\.com/send[^\"']*text="
    # ⚠️ Os dois de cima so pegam o link ESCRITO INTEIRO no fonte. O link real
    # e MONTADO ('https://wa.me/' + numero), entao um "+ '?text=Oi'" passaria
    # por eles inteiro — foi o que o teste de mutacao mostrou. Este pega o
    # parametro em qualquer forma, montado ou nao. Quem valida o link JA
    # RENDERIZADO e o verificar-layout.js, secao 5b; este aqui e a segunda
    # tranca, para o caso de o navegador nao rodar.
    proibido_vivo_re "nenhum parâmetro de mensagem em lugar nenhum do painel" "[?&]text="
    proibido_vivo    "nenhuma saudação pronta na voz da Nataly"             "Oi, aqui é a Nataly"
    precisa          "o painel tem link de WhatsApp"                        "wa.me/"
    precisa          "o botão do WhatsApp é verde (classe própria)"         "bt-wa"

    # os quatro numeros do topo, cada um respondendo a uma pergunta dela
    precisa "número: novos sem contato"  "Novos sem contato"
    precisa "número: quentes na fila"    "Quentes na fila"
    precisa "número: chegaram em 7 dias" "Chegaram em 7 dias"
    precisa "número: em proposta"        "Em proposta"

    # os graficos — e a promessa de que cada um responde a alguma coisa
    precisa "gráfico de tendência por dia"       "Leads por dia"
    precisa "gráfico de onde a fila empoça"      "Onde os leads estão agora"
    precisa "gráfico de produto indicado"        "Produto que a árvore indicou"
    precisa "gráfico de origem por qualidade"    "Origem"
    precisa "toda figura tem a versão em tabela" "Ver os números em tabela"

    # kanban: as TRES formas de mover. Arrastar sozinho exclui gente.
    precisa "kanban: alça de arraste"                 "kpega"
    precisa "kanban: menu Mover (sem arrastar)"       "kmover"
    precisa "kanban: arraste por ponteiro (funciona no toque)" "pointerdown"
    precisa "kanban: caminho por teclado"             "para escolher a coluna"
    precisa "kanban: as 6 colunas do funil"           "proposta-enviada"

    # filtros — o de produto ja existiu sem listener e nao filtrava nada
    precisa "filtro de produto"      "fProduto"
    # o filtro que separa quem terminou de quem parou no meio
    precisa "filtro de completo x parcial"   "fCompleto"
    precisa "o filtro tem as três opções"    "Pararam no meio"
    precisa_re "o filtro de completo tem listener de change" "'fAnuncio', 'fCompleto'"
    # o azulejo, com o número que o Eduardo quer visível
    precisa "azulejo dos que pararam no meio" "Pararam no meio', par.total"
    precisa "e ele diz quantas pararam no preço" "pararam na pergunta do preço"
    # onde ela parou, na lista e na gaveta
    precisa "a lista mostra ONDE ela parou"   "function textoOndeParou"
    precisa "a linha do parcial é marcada"    "lin-parcial"
    precisa "a pílula própria de incompleto"  "q-parcial"
    precisa "a gaveta avisa que não é lead pronto" "é alguém para chamar"
    precisa "e que ela não viu preço"         "não viu preço nenhum"
    precisa "filtro de período"      "fPeriodo"
    precisa "filtro de qualificação" "fQualif"
    precisa "filtro de origem"       "fAnuncio"
    precisa "busca por nome/telefone/@" "Nome, telefone ou @"
    precisa_re "o filtro de produto tem listener de change" "fStatus', 'fQualif', 'fProduto'"
    precisa "exportar CSV continua de pé" "/crm/exportar.csv"

    # acessibilidade minima da estrutura
    precisa "abas com role de tablist"   "role=\"tablist\""
    precisa "região que narra mudanças"  "aria-live=\"polite\""
    precisa "gaveta como diálogo modal"  "aria-modal=\"true\""

    # o painel e FERRAMENTA, nao peca de marca: a paleta da Nataly nao entra
    proibido_vivo "painel sem o creme da marca"     "#F2EEE5"
    proibido_vivo "painel sem o chocolate da marca" "#6B4F3A"
    proibido_vivo "painel sem a sálvia da marca"    "#A5B59A"

    # nada de CDN: o painel abre no 4G do celular dela
    proibido_vivo_re "sem script de CDN externo"  "<script[^>]+src=\"https?://"
    proibido_vivo_re "sem folha de estilo remota" "<link[^>]+href=\"https?://[^\"]*\.css"
    proibido_vivo_re "sem fonte remota"           "fonts\.(googleapis|gstatic)"
    precisa "os gráficos são SVG feito à mão"     "createElementNS"

    # ============================================================
    # O REDESENHO DE 02/09/2026 — navegação lateral e painel próprio
    # ============================================================
    # Estes checks existem porque a página única virou quatro vistas. Se
    # alguém "simplificar" de volta para uma tela só, ou se um gráfico novo
    # sumir numa refatoração, é aqui que aparece.
    precisa "a navegação é lateral/inferior, não uma fileira de abas" 'class="nav" role="tablist"'
    precisa "a lista de seções é vertical (desktop)"  'aria-orientation="vertical"'
    precisa "seção: Painel"    'id="abaPainel"'
    precisa_vivo "seção: Pipeline"  '>Pipeline<'
    precisa_vivo "seção: Leads"     '>Leads<'
    precisa "seção: Avisos"    '>Avisos<'
    precisa "o painel tem tela própria"        'id="pPainel"'
    precisa "o título muda com a seção"        'id="tituloVista"'
    # A barra de navegação é UM elemento em duas posições. Dois elementos
    # espelhados dariam ids duplicados e foco parando duas vezes na mesma seção.
    # O MESMO seletor tem de existir nas duas formas: barra inferior fixa
    # (celular) e coluna grudada (desktop). Se um dia virarem dois elementos
    # espelhados, nascem ids duplicados e foco parando duas vezes na mesma
    # seção — `precisa_re1` achata o arquivo porque a regra atravessa linhas.
    precisa_re1 "a navegação vira barra inferior no celular" '\.lateral\{[^}]*position:fixed'
    precisa_re1 "…e coluna lateral no desktop"               '\.lateral\{[^}]*position:sticky'
    # o período do painel, que é o único filtro que sobrevive nessa vista
    precisa "seletor de período no painel"     'id="segPeriodo"'
    precisa "o segmentado escreve no mesmo estado do select" "document.getElementById('fPeriodo').value = x.v"

    # os gráficos NOVOS — cada um foi aceito por mudar uma decisão
    precisa_vivo "gráfico: há quanto tempo estão esperando" "Há quanto tempo estão esperando"
    precisa "…medido pelo ÚLTIMO TOQUE, não pela entrada" "l.atualizado_em || l.criado_em"
    precisa_vivo "gráfico: onde o formulário perde gente"   "Onde o formulário perde gente"
    # 🔴 Sem a linha final o funil saía com todas as barras do mesmo tamanho:
    #    quem para NA última pergunta ficava dentro da barra dela.
    # ⚠️ O marcador NÃO pode ser só "Terminaram o formulário": esse texto já
    #    existe vivo, como rótulo da opção do filtro de completo — o check
    #    passava com a linha do funil APAGADA. Marcador tem de ser único ao
    #    que ele certifica.
    precisa_vivo "…e o funil fecha com quem terminou"      "etapa: 'fim', rot: 'Terminaram o formulário'"
    # A honestidade que o funil precisa: ele conta o banco inteiro, e começa
    # no WhatsApp porque antes disso ninguém é gravado.
    precisa_vivo "…e avisa que começa no WhatsApp"         "antes dele ninguém é gravado"
    precisa_vivo "…e que não respeita os filtros da tela"  "Conta o formulário inteiro, sem filtro"
    # No Painel os filtros somem da tela; um número recortado tem de dizer que é recorte.
    precisa_vivo "o painel avisa quando está filtrado"     "Estes números são de um recorte filtrado"
    # A rampa de espera é SEQUENCIAL (uma cor, clara -> escura), não categórica.
    precisa_vivo "a rampa de espera é sequencial de uma cor só" "RAMPA_ESPERA"
    # gráfico sem dado tem de DIZER que não tem, não virar caixa vazia
    precisa_vivo "gráfico sem dado explica que não tem"    "Nada para mostrar ainda"
    # a última vista fica guardada — ela abre isto dez vezes por dia
    precisa_vivo "o painel lembra a última seção usada"    "crm.vista"

    comuns_proibidos
  else
    falha "não consegui entrar no painel com a conta configurada (resposta: ${ENTROU:0:90})"
  fi
  rm -f "$CK"
fi

# ============================================================
# A PORTA DO PAINEL — /crm/entrar
# ============================================================
# Esta página NUNCA foi auditada aqui, e é por onde se entra em dados
# pessoais de terceiros. Não exige sessão (é o login), então roda sempre.
if baixa_pagina /crm/entrar 3000; then
  sem_comentarios
  # o que não pode faltar por acessibilidade e por dor real
  precisa "o campo tem rótulo de verdade (usuário)"  'for="usuario"'
  precisa "o campo tem rótulo de verdade (senha)"    'for="senha"'
  # 🔴 O OLHO. As senhas daqui têm símbolo e maiúscula no meio; digitar às
  #    cegas no celular erra, e sem ele o suporte vira "esqueci a senha".
  precisa "olho para revelar a senha"                'id="olho"'
  precisa "…e ele diz o estado para o leitor de tela" 'aria-pressed="false"'
  precisa "…e troca o rótulo ao revelar"             "'Mostrar senha' : 'Ocultar senha'"
  # 🔴 O TRIM. Espaço colado ao copiar a senha é a causa nº 1 de
  #    "senha incorreta" com a senha certa.
  precisa "apara espaço do usuário no envio"         "getElementById('usuario').value.trim()"
  precisa "apara espaço da senha no envio"           "getElementById('senha').value.trim()"
  # o campo não pode ter menos de 16px, senão o Safari do iPhone dá zoom
  # sozinho ao focar e a caixa sai da tela
  precisa_re "campo de 16px (o iPhone não dá zoom sozinho)" "font-size:16px"
  # o erro tem de ser anunciado, não só pintado
  precisa "o erro é anunciado ao leitor de tela"     'role="alert"'
  precisa "avisa que a página trata dado de terceiro" "dados pessoais de terceiros"
  # dados pessoais: fora do índice e sem cache
  precisa "login fora do índice do Google"           'content="noindex, nofollow, noarchive"'
  precisa "login não vaza referenciador"             'name="referrer"'
  # 🔴 A IDV: a porta e a sala são o MESMO lugar. A paleta da marca é
  #    proibida no painel de propósito, e a porta segue a mesma regra.
  proibido_vivo "login sem o creme da marca"     "#F2EEE5"
  proibido_vivo "login sem o chocolate da marca" "#6B4F3A"
  proibido_vivo "login sem a sálvia da marca"    "#A5B59A"
  precisa "login usa a MESMA tinta do painel"    "#101828"
  precisa "login usa o MESMO chão do painel"     "#F6F7F9"
  precisa "login usa o MESMO azul do painel"     "#1c5cab"
  # nada de CDN: ela entra pelo 4G
  proibido_vivo_re "login sem script de CDN externo"  "<script[^>]+src=\"https?://"
  proibido_vivo_re "login sem folha de estilo remota" "<link[^>]+href=\"https?://[^\"]*\.css"
  proibido_vivo_re "login sem fonte remota"           "fonts\.(googleapis|gstatic)"
  # 🔴 nunca uma senha escrita no fonte
  proibido_vivo_re "nenhuma senha no fonte do login"  "senha *[:=] *[\"'][^\"']{6,}"
  comuns_proibidos
fi

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
  # ---- LGPD: a política tem de cobrir quem NÃO terminou ----
  # A gravação passou a acontecer antes do fim; se o texto não disser isso, a
  # gente guarda dado de gente que a política não menciona.
  precisa "diz que as respostas são salvas conforme ela avança" "As respostas vão sendo salvas conforme você avança"
  precisa "diz o que acontece se ela parar no meio" "continua guardado"
  precisa "diz que pode haver contato mesmo sem terminar" "mesmo se você não terminar"
  precisa "dá a base legal do formulário incompleto" "que você começou e não"
  precisa "diz por quanto tempo guarda o incompleto" "ficou pela metade"
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

  # ============================================================
  # 🔴 O VERIFICADOR CHEGOU AO FIM? Contar linhas "FALHA" nao distingue
  #    "mediu tudo e achou 8 problemas" de "mediu um terco, achou 8 e MORREU".
  #    Em 02/09/2026 aconteceram as duas coisas, em sequencia: primeiro um
  #    crash com ZERO falhas impressas (e este gate fechou com "TUDO CERTO.
  #    As paginas podem ser divulgadas" tendo medido 35 de 86); depois um
  #    crash COM 8 falhas impressas, que passou como se tivesse medido tudo.
  #    Por isso a trava agora e um MARCADOR DE FIM, e nao uma contagem: o
  #    verificar-layout.js imprime `FIM-LAYOUT truncado=0` na ultima linha,
  #    inclusive quando reprova. Se ele nao aparecer, a checagem nao terminou —
  #    e uma checagem que nao terminou nunca conta como aprovada.
  # ============================================================
  if ! grep -q "FIM-LAYOUT truncado=0" /tmp/layout-check.txt; then
    falha "a checagem de layout NAO chegou ao fim (saida $RC) — ela abortou no meio e nao mediu tudo. Ver /tmp/layout-check.txt"
    grep -c "^ok" /tmp/layout-check.txt | sed 's/^/       so rodou ate: /;s/$/ checagens ok (o normal e 86)/'
    tail -8 /tmp/layout-check.txt | sed 's/^/       /'
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

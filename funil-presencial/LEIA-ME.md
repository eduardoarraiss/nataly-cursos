# Funil de qualificação — quatro produtos, uma árvore de decisão

Dois passos, duas páginas:

1. **`/profissao-lash-presencial`** — a página de venda. Constrói o desejo e
   **não mostra preço nenhum**. Todos os CTAs levam ao formulário.
2. **`/inscricao-presencial`** — o formulário, em rota própria, uma pergunta por
   tela. No fim ele **diz qual dos quatro cursos é o certo para ela** e mostra
   **só o preço daquele curso**.

A pessoa se candidata, a árvore indica o produto, a Nataly fecha pelo WhatsApp.

---

## Os quatro produtos (01/09/2026)

| Produto | Para quem | Preço | Checkout | Conferido em |
|---|---|---|---|---|
| **Profissão Lash — online** | começando do zero | R$ 497 · 12x R$ 51,40 | `y1Pz2US` | `public/profissao-lash-curso.html` |
| **Profissão Lash — online + presencial** | do zero + dia em Cambuí | R$ 1.497 · 12x R$ 154,82 | `VluGxKq` | `server.js` (a PV não mostra preço) |
| **Método LED — online** | já é lash, quer a técnica LED | R$ 297 · 12x R$ 30,72 | `FfyBeg0` | `server.js` via `FASE_PADRAO=2` |
| **Método LED — presencial** | já é lash, quer LED ao vivo | R$ 1.997 · 12x R$ 206,54 | `eZ1ZPoU` | `public/lancamento-presencial.html` |

⚠️ **O Método LED online não tem checkout fixo.** Ele é injetado por
`renderVenda()` conforme a fase (`RUNBOOK-PRECO-E-CHECKOUT.md`). `FASE_PADRAO=3`
no Railway devolve a relâmpago de R$ 247 / `QOSVIDR` — e `produtos.js` lê a
mesma env, então a recomendação acompanha sem deploy. **Se alguém mudar a fase,
não é preciso tocar em código; se alguém mudar o preço no painel da Kiwify sem
mudar a fase, `produtos.js` passa a mentir.**

Nenhum destes produtos foi criado agora: os quatro já existiam e já vendiam. A
árvore só decide qual deles cada pessoa vê. **Não apague nenhum checkout.**

Nada aqui tem relação com a Haus, com o Roberta OS ou com o `haus-comercial-crm`.
Banco próprio, instância de WhatsApp própria, pasta própria.

---

## As peças, em ordem de dependência

| Arquivo | O que faz |
|---|---|
| `schema.sql` | Tabelas: `leads`, `leads_historico`, `avisos`, `sessoes`, `login_tentativas` |
| `db.js` | Postgres em produção (`DATABASE_URL`), PGlite local em desenvolvimento |
| `produtos.js` | **Os quatro produtos e a árvore de decisão.** Fonte única |
| `leads.js` | Validação, normalização, qualificação e persistência |
| `notificador.js` | Aviso no WhatsApp, com fila e nova tentativa |
| `auth.js` | Sessão do painel, freio de força bruta |
| `rotas.js` | `POST /api/lead-presencial`, `POST /api/lead-parcial` e tudo em `/crm` |
| `painel/entrar.html` | Login |
| `painel/crm.html` | Lista, kanban, detalhe, avisos e exportação |

O formulário em si vive em `public/inscricao-presencial.html` — página inteira,
com CSS e JS próprios, no modelo do formulário de referência: barra de progresso
fina no topo, pergunta numerada, campo só com filete embaixo e botão "Avançar".

---

## Rodar local

```bash
CRM_SENHA="$(node funil-presencial/gerar-senha.js | grep -o '[^=]*$')" \
PORT=3999 node server.js
```

Sem `DATABASE_URL`, o funil sobe com **PGlite** — o mesmo Postgres compilado em
WASM, rodando dentro do Node, sem servidor e sem custo. O SQL é idêntico ao de
produção.

> ⚠️ **PGlite é de processo único.** Não abra `funil-presencial/.dados-dev` em
> outro `node` enquanto o servidor roda — o WASM aborta e derruba o processo.
> Para olhar os dados com o servidor de pé, use o painel ou a API.

## Testes

```bash
npm run teste              # árvore + unidade + avisos + parcial (banco isolado)
npm run teste:parcial      # SÓ o parcial: migração em banco ANTIGO, upsert, aviso
npm run teste:arvore       # SÓ a árvore: 405 combinações, sem banco e sem rede
npm run teste:formulario   # as duas passadas num Chrome de verdade (67 checagens)
npm run teste:rastreamento # pixel Meta + GA4, em Chrome COM JANELA
./verificar-pv.sh local    # o gate completo (309 checagens)
```

`teste:arvore` é o mais barato e o que pega mais coisa: roda em milissegundos,
sem banco e sem navegador. **Rode ele primeiro sempre que mexer em preço,
checkout ou regra de roteamento.**

Duas armadilhas que já custaram tempo:

- **`teste:rastreamento` precisa de Chrome com janela.** O Meta suprime o pixel
  em Chrome headless (proteção anti-bot) e o teste daria falso negativo.
- **O GA4 agrupa eventos e envia com ~5 s de atraso.** Esperar menos que isso
  depois do envio faz o `generate_lead` parecer que não disparou. Ele disparou.

Rodar o formulário mais de 5 vezes em 10 minutos do mesmo IP bate no freio de
spam e devolve 429. Reinicie o servidor para zerar o contador.

---

## A árvore de decisão

Mora inteira em **`produtos.js`**, roda **só no servidor** e é devolvida ao
formulário pronta. O navegador não decide produto nenhum: se decidisse, um dia
a tela e a linha do banco discordariam.

### Passo 1 — a família

| Resposta | Família |
|---|---|
| Não é lash (outra área ou beleza) | **Profissão Lash** |
| É lash + "quero me aperfeiçoar na extensão" | **Profissão Lash** |
| É lash + "quero aprender a técnica com LED" | **Método LED** |
| É lash + "ainda não sei" | **Método LED**, como *sugestão* — a tela final diz com todas as letras que é sugestão e que a Nataly ajuda a decidir |

### Passo 2 — o formato, **nesta ordem e não em outra**

1. **Consegue vir a Cambuí?** Se não → **online**, e acabou.
2. **O que ela prefere?** Se pediu online → **online**, mesmo podendo vir.
3. **A faixa de investimento.** Só aqui, como último critério.

**Por que a ordem importa:** se o dinheiro pesasse antes da distância, alguém de
Cambuí que faria o presencial seria empurrada para a oferta barata — e a oferta
cara se canibalizaria sozinha.

**E quando ela pode vir e só o investimento trava**, a recomendação sai online
**dizendo que o presencial existe**, com preço, e que a condição se conversa.
Descartar em silêncio seria decidir pelo bolso dela sem perguntar.

## A pergunta do preço — por que virou faixa

A nona pergunta antiga mostrava **R$ 1.497 cravado**. Era verdade quando existia
um produto só. Com quatro preços (R$ 297 a R$ 1.997) um número fixo **mentiria
para a maioria de quem abre a página** — e o HTML é o mesmo para as quatro
rotas, então não havia como cravar um número honesto.

A saída: perguntar **a faixa dela**, sem revelar valor nosso nenhum. E as faixas
foram desenhadas para **conter** os preços:

| Faixa | Teto | Cabe |
|---|---|---|
| Até R$ 500 | 500 | LED online (297) · Profissão Lash online (497) |
| De R$ 500 a R$ 1.500 | 1.500 | + o combo presencial (1.497) |
| De R$ 1.500 a R$ 2.000 | 2.000 | + o LED presencial (1.997) |
| Mais de R$ 2.000 | ∞ | tudo |
| Depende: consigo se parcelar | ∞ | tudo (o mais caro sai a R$ 206,54/mês) |

Consequência: **a árvore nunca recomenda acima do que ela marcou**, e o único
preço que ela vê na vida é o do produto dela, na tela final.
`teste-arvore.js` prova isso nas **405 combinações possíveis**.

🔴 **Nenhum preço de produto vive no HTML do formulário.** O gate reprova se um
voltar (`proibido_vivo_re` na seção 2b do `verificar-pv.sh`).

## Como o lead é qualificado

Pontuação de 0 a 100, só com o que a pessoa respondeu — e lida **contra o
produto recomendado**, não contra um preço fixo:

| Resposta | Peso |
|---|---|
| Quando começar | agora 30 · 30 dias 20 · 90 dias 8 · só olhando 0 |
| Situação hoje | já é lash 20 · área da beleza 15 · outra área 10 |
| Investimento | presencial recomendado 30 · depende de parcelar 18 · online por escolha/distância 22 · online porque a faixa travou 10 |
| Encaixe do formato | produto online 18 · presencial + "consigo ir" 20 · presencial + "talvez" 12 |

`quente` ≥ 70 · `morno` ≥ 40 · `frio` < 40.

**Trava dura:** quem responde que está **só pesquisando** nunca é quente.

> ⚠️ **A trava antiga mudou em 01/09/2026.** Ela dizia que *quem não pode vir a
> Cambuí nunca é quente* — verdade enquanto existia um produto só, presencial.
> Com quatro produtos ela virou mentira cara: quem não pode vir agora recebe o
> online, que é uma venda pronta. Manter a trava marcaria de FRIO justamente o
> lead que compra sem sair de casa.

---

## A captura parcial — o lead que não terminou (02/09/2026)

**O problema:** o lead só era gravado no envio final. Quem abandonava sumia — e
sumia justamente quem chegou perto de comprar, porque o funil tem 11 perguntas
e a do investimento é a **última**.

**O gatilho é nome + WhatsApp válido** (perguntas 1 e 3). A partir daí, cada
etapa que ela abre atualiza a **mesma linha**, pelo mesmo `lead_uid` que já
existia para o duplo clique. Não foi preciso inventar chave nova.

| Rota | Quando | Valida | Roda a árvore | Avisa |
|---|---|---|---|---|
| `POST /api/lead-parcial` | a cada etapa | nome + telefone, e só | não | uma vez, depois de 20 min |
| `POST /api/lead-presencial` | no envio final | tudo | sim | na hora |

Duas colunas novas em `leads`: **`completo`** (boolean) e **`ultima_etapa`** —
a pergunta que ela estava **vendo** quando parou, não a última que respondeu.
A diferença é comercial: quem responde a 9 e some parou **na 10**, que é a do
dinheiro.

### As travas que sustentam isso

- **`COALESCE(EXCLUDED.x, leads.x)`** no upsert do parcial: uma chamada que
  chega fora de ordem nunca apaga o que a anterior gravou.
- **`WHERE leads.completo = false`** no mesmo upsert: o beacon de saída, que
  chega depois do envio final, é recusado em vez de sobrescrever o lead pronto.
- **`cria()` não usa mais `xmax = 0`** para decidir se avisa. A partir de agora
  há conflito em *todo* envio bem-sucedido (a linha parcial já existe), e o
  `xmax` faria todo lead completo cair no ramo de "dedupe" — **a Nataly
  pararia de ser avisada**. Hoje a decisão vem de um `SELECT` do estado
  anterior: avisa se ainda não era um lead completo.
- **As chamadas são enfileiradas no navegador** (uma por vez). Numa rede móvel
  duas requisições podem chegar fora de ordem, e o `ultima_etapa` da pergunta 4
  chegando depois da 10 diria que ela parou no Instagram quando travou no preço.

### O aviso de incompleto

**Uma mensagem por pessoa, para sempre**, e só depois de **20 minutos** sem
concluir (`FUNIL_PARCIAL_MIN`, ajustável sem deploy; `FUNIL_PARCIAL=0` desliga
o aviso sem desligar a gravação).

Avisar a cada etapa daria sete mensagens por pessoa — e um grupo que toca o
tempo todo é um grupo que ninguém abre. Os 20 minutos ficam acima do maior
tempo plausível de preenchimento e abaixo do ponto em que a conversa esfria.

A mensagem abre com `🟠 *FORMULÁRIO INCOMPLETO*`, diz em qual pergunta ela
parou, lista só o que ela chegou a responder e avisa, com todas as letras, que
**ela não viu preço nenhum e não tem curso indicado**. Se ela terminar depois,
o aviso normal de lead sai como sempre — e é a mesma linha, não duas.

### Rastreamento

🔴 **O parcial NUNCA dispara `Lead`.** O `Lead` é o evento pelo qual a campanha
do Meta otimiza: dispará-lo no parcial ensinaria o algoritmo a procurar quem
abandona. O parcial tem nome próprio — `LeadParcial` no Meta e `lead_partial`
no GA4 — uma vez por sessão. `teste:rastreamento` prova isso em Chrome de
verdade, conferindo que nenhum `Lead` sai antes do envio.

### No painel

O padrão de `/crm` continua sendo **as inscrições completas** — todo número que
existia continua significando o que significava. Os parciais entram por um
azulejo próprio no topo (**"Pararam no meio"**, com quantas travaram no preço),
que é clicável e leva à lista delas. Na lista, filete e pílula próprios, e a
coluna do produto passa a dizer **onde ela parou**.

### LGPD

A política de privacidade foi ajustada em quatro pontos: o que é coletado (diz
que as respostas são salvas conforme ela avança e que o que ficou pela metade
continua guardado), para que serve (contato mesmo sem terminar), a base legal
(os mesmos procedimentos preliminares) e o prazo (dois anos, contados da última
resposta). O rodapé do formulário deixou de dizer *"ao enviar"* — era mentira
por omissão, porque o nome e o WhatsApp já saíram do navegador antes disso.

---

## Velocidade (02/09/2026)

O site servia **tudo sem compressão** e os estáticos com `max-age=0`.

- **gzip** para tipos de texto, com `zlib` do próprio Node (sem dependência
  nova). `/api/` e `/crm` **não passam** por ele, requisição com `Range` passa
  direto (é assim que a VSL de 21 MB é buscada) e binário já comprimido é
  ignorado.
- **`Cache-Control`** por extensão: vídeo 30 dias, imagem e fonte 7 dias, js e
  css **1 hora** — pouco de propósito, para um conserto no `pixel.js` no meio
  de uma campanha chegar no mesmo dia.
- **`srcset`** na foto de abertura do formulário: a caixa nunca passa de 340
  CSS px (medido no Chrome), então o celular comum baixa a versão de 700px em
  vez da de 1400px.
- **`preconnect`** para `connect.facebook.net` e `www.googletagmanager.com` —
  ~351 KB de script de terceiro que agora abrem conexão em paralelo.

**O que NÃO foi mexido, de propósito:** a prova social inteira (já é `lazy`), a
mecânica da VSL aprovada pelo Eduardo, e a foto do hero da PV — ela já está
comprimida a ponto de uma segunda passada render 10 KB em troca de perda de
qualidade empilhada.

`medir-velocidade.js` mede as duas rotas em 390px, três passadas, e reporta a
mediana. Rode antes e depois de mexer.

---

## O aviso no WhatsApp

O lead é **gravado primeiro**. O aviso é consequência, nunca condição: se o
WhatsApp estiver fora do ar, o aviso fica na tabela `avisos` como `pendente` e é
retentado com espera crescente (1, 5, 15 min, 1 h, 6 h, 24 h). Depois de seis
tentativas vira `falhou` — e o painel mostra, com botão de reenviar. **Nenhum
lead se perde por falha de envio.**

`NATALY_WA_DESTINO` aceita tanto um número (`5535997164668`) quanto um id de
grupo (`...@g.us`). Quando o grupo existir, é só trocar a variável — sem tocar
em código.

`NATALY_WA_DRIVER=log` é o **padrão**: escreve no console e não envia nada.
Enviar de verdade exige configuração deliberada.

`NATALY_WA_TESTE=1` faz toda mensagem começar com
`Isso é um teste de uma automação, ignore`.

---

## Rastreamento — o mapa completo

| Momento | Meta | GA4 |
|---|---|---|
| Página de venda carrega | `PageView`, `ViewContent` | `page_view`, `view_item` |
| Rola até a oferta | `ScrollOferta` | `scroll_to_offer` |
| **Clica no CTA** | `IniciouInscricao` (1×/sessão) | — |
| **Chega no formulário** | `PageView`, `ViewContent` | `page_view`, `view_item`, `select_item` (1×/sessão) |
| **Vê a etapa da faixa** | `ViuInvestimento` (1×/sessão) | `view_price_step` |
| **Envia** | `Lead` + `Lead_<produto>` (com `eventID`, `content_ids`, sem valor) | `generate_lead` |
| **Vê a recomendação** | `ViuRecomendacao` (com o produto) | `view_recommendation` |
| **Clica no checkout** (só online) | `InitiateCheckout` (1×/sessão, **com o valor do produto certo**) | `begin_checkout` |

Nunca `Purchase` — quem dispara é a Kiwify (pixel + CAPI).

> ⚠️ **`InitiateCheckout` mudou de lado em 01/09/2026.** Antes da árvore ele era
> proibido aqui, e com razão: nenhum caminho desta página levava a checkout.
> Hoje metade leva, e a ausência do evento é que seria o defeito.

### Por que o produto não pode vir da rota

`pixel.js` e `analytics.js` deduzem o produto pela URL. Funciona nas páginas de
venda, onde uma URL = um produto. **Não funciona aqui**: a mesma
`/inscricao-presencial` serve os quatro. Pior — a rota contém a palavra
`presencial`, então a dedução cairia em *Formação Presencial LED, R$ 1.997*, e
mandaria esse valor ao Meta **em cada abertura de formulário**, inclusive para
quem vai terminar no produto de R$ 297.

Duas coisas resolvem, e as duas precisam continuar de pé:

1. a rota do formulário é reconhecida como **`funil-qualificacao`, valor 0** —
   honesto enquanto o produto é desconhecido;
2. a tela final publica **`window.NR_PRODUTO`**, e todo evento lê dali no
   momento em que dispara. É isso que faz o `InitiateCheckout` sair valendo
   R$ 297 para quem clicou no checkout de R$ 297.

O `teste:rastreamento` confere o valor do evento no CDP, não só o nome.

### Por que o evento de intenção é assimétrico

O clique no CTA acontece **antes de sair da página**. Medido pelo CDP:

- o **`fbq` sobrevive ao unload** — a requisição sai;
- o **`gtag` não**: ele AGRUPA os eventos e só descarrega o lote alguns segundos
  depois, então o hit morre junto com a página. O `event_callback` **não salva**:
  ele é chamado em ~3 ms, quando o evento foi *enfileirado*, não enviado.

Por isso o Meta recebe `IniciouInscricao` no clique, e o GA4 recebe `select_item`
na **chegada** — a `/inscricao-presencial` carrega `?cta=` dizendo qual botão
trouxe a pessoa. Numa navegação os dois passos são o mesmo, e assim nenhum
número se perde.

> ⚠️ `pixel.js` e `analytics.js` só tratam uma página como "de venda" se ela
> tiver para onde converter: link de checkout, link para o formulário, ou o
> formulário. **Essa linha já apagou o `ViewContent` em silêncio duas vezes** —
> ao tirar o checkout, e ao mover o formulário para fora da página. Se o destino
> de conversão mudar de novo, atualize a detecção nos dois arquivos.

Uma Conversão Personalizada só desse lead **não foi criada** — o caminho está
pronto: filtre por `content_category = qualificacao-presencial` no Meta, ou use
o nome próprio `IniciouInscricao` / `ViuInvestimento`.

---

## O funil que dá para ler

Com esses eventos dá para responder, sem abrir o banco:

- quantas viram a página e quantas clicaram (`ViewContent` → `IniciouInscricao`);
- quantas abriram o formulário e quantas chegaram no preço (`select_item` → `ViuInvestimento`);
- **quantas desistiram ao ver o número** (`ViuInvestimento` → `Lead`) — é o dado
  mais valioso do funil, e só existe porque o preço tem etapa própria.

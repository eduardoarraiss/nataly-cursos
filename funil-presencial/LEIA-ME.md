# Funil de qualificação — Profissão Lash Online + Presencial

Dois passos, duas páginas:

1. **`/profissao-lash-presencial`** — a página de venda. Constrói o desejo e
   **não mostra preço nenhum**. Todos os CTAs levam ao formulário.
2. **`/inscricao-presencial`** — o formulário, em rota própria, uma pergunta por
   tela. **É a única página do site onde o valor aparece**, na nona e última
   pergunta, depois que a pessoa já respondeu o fácil.

A pessoa se candidata, a Nataly qualifica e fecha a venda pelo WhatsApp.

O produto na Kiwify (`pay.kiwify.com.br/VluGxKq`) **continua existindo e ativo** —
ele só não está mais linkado na página. A Nataly manda o link à mão para quem
qualificar. **Não apague o produto nem a URL.**

Nada aqui tem relação com a Haus, com o Roberta OS ou com o `haus-comercial-crm`.
Banco próprio, instância de WhatsApp própria, pasta própria.

---

## As peças, em ordem de dependência

| Arquivo | O que faz |
|---|---|
| `schema.sql` | Tabelas: `leads`, `leads_historico`, `avisos`, `sessoes`, `login_tentativas` |
| `db.js` | Postgres em produção (`DATABASE_URL`), PGlite local em desenvolvimento |
| `leads.js` | Validação, normalização, qualificação e persistência |
| `notificador.js` | Aviso no WhatsApp, com fila e nova tentativa |
| `auth.js` | Sessão do painel, freio de força bruta |
| `rotas.js` | `POST /api/lead-presencial` e tudo em `/crm` |
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
npm run teste              # unidade + avisos (banco isolado, não toca o de dev)
npm run teste:formulario   # as 9 etapas num Chrome de verdade
npm run teste:rastreamento # pixel Meta + GA4, em Chrome COM JANELA
./verificar-pv.sh local    # o gate completo (201 checagens)
```

Duas armadilhas que já custaram tempo:

- **`teste:rastreamento` precisa de Chrome com janela.** O Meta suprime o pixel
  em Chrome headless (proteção anti-bot) e o teste daria falso negativo.
- **O GA4 agrupa eventos e envia com ~5 s de atraso.** Esperar menos que isso
  depois do envio faz o `generate_lead` parecer que não disparou. Ele disparou.

Rodar o formulário mais de 5 vezes em 10 minutos do mesmo IP bate no freio de
spam e devolve 429. Reinicie o servidor para zerar o contador.

---

## Como o lead é qualificado

Pontuação de 0 a 100, só com o que a pessoa respondeu:

| Resposta | Peso |
|---|---|
| Pode vir a Cambuí | sim 40 · talvez 15 · não 0 |
| Aceita o valor | sim 30 · quer parcelar 20 · não 0 |
| Situação hoje | já é lash 10 · área da beleza 10 · outra área 5 |
| Quando começar | agora 20 · 30 dias 12 · 90 dias 5 · só olhando 0 |

`quente` ≥ 70 · `morno` ≥ 40 · `frio` < 40.

**Trava dura:** quem responde que **não pode vir a Cambuí** ou que **não aceita o
valor** nunca é quente, por mais que pontue no resto. Comprar seria impossível.

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
| **Vê a etapa do preço** | `ViuInvestimento` (1×/sessão) | `view_price_step` |
| **Envia** | `Lead` (com `eventID`, sem valor) | `generate_lead` |

Nunca `Purchase` (quem dispara é a Kiwify) e nunca `InitiateCheckout` (ninguém
entra em checkout no funil).

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

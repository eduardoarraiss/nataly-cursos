# RUNBOOK — trocar preço / checkout da página do Método LED

Documento de emergência e de rotina. Objetivo: **trocar o preço da página `/lash-2-metodo-led`
em minutos**, sem precisar reler código nem redescobrir como o projeto funciona.

Última atualização: **20/07/2026**.

---

## 1. Mapa dos checkouts (Kiwify)

| Preço | Checkout | Link | Situação em 20/07/2026 |
|---|---|---|---|
| R$297 | `FfyBeg0` | `https://pay.kiwify.com.br/FfyBeg0` | **Padrão histórico.** Era o que estava no ar até 20/07. Validado: cobra R$297, 12× R$30,72, PIX sim, boleto NÃO. |
| R$247 | `QOSVIDR` | `https://pay.kiwify.com.br/QOSVIDR` | **Oferta relâmpago (atual).** Revalidado 30/07 renderizando: R$247, 12× R$25,55, ativo. É o único checkout que recebe tráfego pago. |
| R$197 | `BMda0X4` | `https://pay.kiwify.com.br/BMda0X4` | Usado na `/oferta-relampago` do grupo VIP e na `/lancamento-197`. |
| R$297 | `1EX5ICK` | — | 🧟 **ZUMBI. Não usar.** Cobra R$297 mas a aba Links do app diz R$497. Mandar esse link achando que é o de R$497 entra venda a R$297. |
| R$67,90 | `VIljYxV` | — | Apostila (produto diferente). Único com boleto ligado. |

**Juros ao cliente: +24,1% em todos.** R$297 em 12× sai R$368,64.

⚠️ **Como conferir o preço real de um checkout:** o HTML cru dos checkouts Kiwify é **idêntico**
entre si (é só o shell do JS), então `curl` dá **falso positivo**. Só dá pra saber renderizando:

```bash
# puppeteer disponível em ~/Documents/HAUS/cases-apresentacao
cd ~/Documents/HAUS/cases-apresentacao
# script que abre pay.kiwify.com.br/<slug> em viewport de iPhone e imprime os R$ do innerText
```

⚠️ **A API pública do Kiwify não expõe meio de pagamento.** Ligar/desligar boleto e PIX só pelo
painel. Não testar chamadas de escrita às cegas contra a loja ao vivo.

---

## 2. Trocar o preço da página — o jeito RÁPIDO (sem deploy)

A página `/lash-2-metodo-led` é servida por `renderVenda(file, fase)` no `server.js`, e a fase é
escolhida por `splitPreco()`. Existem 3 fases:

| Fase | Preço | Checkout | Faixa no topo |
|---|---|---|---|
| 1 | R$197 | `BMda0X4` | não |
| 2 | R$297 | `FfyBeg0` | não |
| 3 | R$247 | `QOSVIDR` | **sim**, verde `#A9DB7E`, "⚡ oferta relâmpago" |

**Variável de ambiente `FASE_PADRAO` decide qual fase é servida.** Trocar ela no painel do
Railway e reiniciar o serviço **muda o preço sem deploy nenhum**:

```
FASE_PADRAO=3   → R$247 com faixa relâmpago   (estado atual)
FASE_PADRAO=2   → R$297, sem faixa            (volta ao padrão histórico)
FASE_PADRAO=1   → R$197
```

Painel: Railway → projeto **Nataly Ribeiro** → serviço **cursos** → Variables → alterar
`FASE_PADRAO` → o serviço reinicia sozinho. **Esse é o rollback de preço mais rápido que existe
aqui. Use ele antes de pensar em qualquer coisa mais complicada.**

**QA por URL** (não grava cookie, serve pra conferir sem mudar nada pra ninguém):
- `?preco=297` → força R$297 · `?preco=197` → força R$197
- `?faixa=ds` → mostra a faixa na cor chocolate do design system em vez do verde

---

## 3. Deploy — LEIA ANTES DE SUBIR QUALQUER COISA

### 3.1 O comando é `railway up`. NÃO é `git push`.

⚠️ **O `DEPLOY.md` deste projeto está ERRADO** — ele manda usar `git push` e abandonar
`railway up`. **Fazer isso derruba o site.** Motivo verificado em 20/07:

- `webhook-kiwify.js` **não está no git** (`git status` → `?? webhook-kiwify.js`)
- mas `server.js` faz `require('./webhook-kiwify')` na **linha 425**
- produção serve `/links`, `/obrigado-apostila` e `/webhooks/kiwify/health` com conteúdo real,
  e **nenhum deles está no repositório**

Ou seja: o que está no ar foi publicado por **upload do working tree**. Um `git push` sobe um
código sem o `webhook-kiwify.js` e o app morre com `Cannot find module './webhook-kiwify'`.

✅ `.railwayignore` só exclui `node_modules` e `.DS_Store`, então `railway up` **inclui os
arquivos untracked** — é justamente por isso que funciona.

```bash
cd ~/Documents/clientes/Nataly/site-cursos
railway up            # sobe o working tree inteiro
```

🚫 **NUNCA** commitar `webhook-kiwify.js` (contém integração/segredo). Se for commitar algo,
`git add` do arquivo específico — **nunca** `git add -A`.

### 3.2 `railway up` sobe TUDO que estiver na pasta

Não existe deploy parcial. O working tree costuma estar bem à frente da produção, então antes de
subir **sempre** rode `git status` e confira o que vai junto. Em 20/07 iam junto: a rota
`/oferta-relampago` (R$197) e os aliases `/lancamento-197` e `/lancamento`, o fix de UTM
forwarding no `analytics.js`, 14 arquivos rastreados modificados (incluindo `apostila.html`
reescrita) e ~15 arquivos `.bak`.

### 3.3 ⚠️ NÃO existe rollback de deployment confiável

`railway deployment list` mostra **um único** deployment `SUCCESS` (02/07/2026); todos os
anteriores estão `REMOVED` e não são restauráveis. E o último commit do git é de 01/07, enquanto
o deploy no ar é de 02/07 — ou seja, **o estado exato de produção não existe reproduzível em
lugar nenhum**.

Consequência prática: se um deploy quebrar, o caminho **não** é "voltar", é **consertar e subir
de novo**. Por isso:

**Antes de todo deploy, faça backup do working tree:**
```bash
cd ~/Documents/clientes/Nataly/site-cursos
tar --exclude=node_modules --exclude=.DS_Store --exclude=.git \
    -czf ~/Documents/clientes/Nataly/_backups-deploy/site-cursos-$(date +%Y%m%d-%H%M).tgz .
```
Backups ficam em `~/Documents/clientes/Nataly/_backups-deploy/` — **fora** de `site-cursos`, pra
não entrarem no próprio deploy. Lá também tem `prod-backup-20260720/`, um retrato do HTML que
produção servia antes da virada de preço.

### 3.4 Verificar o deploy POR CONTEÚDO, nunca por status code

```bash
curl -s https://natalyribeiro.com.br/lash-2-metodo-led | grep -o "pay.kiwify.com.br/[A-Za-z0-9]*" | sort | uniq -c
curl -s https://natalyribeiro.com.br/lash-2-metodo-led | grep -o "LED_VALUE = [0-9]*"
curl -s https://natalyribeiro.com.br/webhooks/kiwify/health          # {"ok":true,...}
curl -s -o /dev/null -w "%{http_code}\n" https://natalyribeiro.com.br/links
```
O esperado é **um único** checkout na página. Se aparecer mais de um, tem link vazando.

---

## 4. Armadilhas conhecidas

- **`node_modules` está no iCloud.** `git`, `node`, `grep`, `find` travam ou demoram muito nessa
  pasta. O boot local leva de 10 a 40 segundos e **parece travado sem estar** — não mate o
  processo achando que morreu. As ferramentas de leitura/escrita de arquivo funcionam normal.
- **A página promete meios de pagamento que o checkout não tem.** Em 20/07 o card dizia
  "PIX, CARTÃO OU BOLETO" e o curso **não tem boleto** (só a apostila tem). Sempre que mudar de
  checkout, confira o que ele realmente oferece antes de prometer na página.
- **`/lancamento-197` vende R$197 direto** enquanto a rota `/oferta-relampago` não estiver no ar.
  Quem tiver o link compra a R$197 em qualquer dia.
- **O gate da oferta relâmpago é da PÁGINA, não do checkout.** Fechar a página não fecha a venda:
  quem tiver o link do Kiwify compra a qualquer momento. Fechar de verdade = desativar na Kiwify.
- **Atribuição de preço é pelo checkout**, não por cookie — cada preço tem link próprio, então o
  relatório da Kiwify já separa sozinho.

---

## 5. Contexto de negócio (por que o preço está mudando)

Ver as memórias: `nataly-oferta-relampago-247-pagina-principal`, `nataly-checkouts-meios-pagamento`,
`nataly-teste-ab-preco-197-297`, `nataly-funil-diagnostico-jul2026`,
`nataly-metodoled-videos-leva-2007`.

⚠️ **Há tráfego pago apontando pra essa página** (campanha `120250136786970693`, conjunto
`120250544294300693`, R$80/dia). Mudança de preço aqui mexe com dinheiro rodando. Como o teste de
criativo começou em 20/07 junto com a virada de preço, **anote a data/hora de cada virada** e
segmente o relatório antes/depois — senão não dá pra saber se o que mudou o resultado foi o
criativo ou o preço.

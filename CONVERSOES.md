# Conversões / Pixel Meta — Lash 2.0

Guia completo de tracking do site. Vale tanto no domínio Railway quanto no natalyribeiro.com.br
(o pixel **não depende do domínio** — funciona em qualquer URL).

---

## 1. Como ativar o Pixel (1 passo)
Edite **uma linha** em `public/js/pixel.js` e dê `git push`:
```js
var META_PIXEL_ID = "SEU_ID_AQUI";   // ex.: "1234567890123456"
```
Enquanto vazio, nada dispara (não quebra o site). O `pixel.js` está incluído em todas as páginas.

> Onde achar o ID: Meta Events Manager → sua fonte de dados (Pixel) → o ID aparece no topo.

---

## 2. Eventos que disparam (depois de ativado)

| Evento | Quando dispara | Onde |
|--------|----------------|------|
| **PageView** | Carregou qualquer página | Todas |
| **Lead** | Pessoa clicou em "Entrar pro grupo VIP" e foi levada ao grupo | Página `/entrar` |
| **InitiateCheckout** | Clicou num botão de compra (link Hotmart) | Páginas de venda |
| **Purchase** | (futuro) compra aprovada | Via Hotmart (ver seção 5) |

---

## 3. Como o Lead é rastreado (o evento que importa agora)
**Decisão de arquitetura:** os botões "Entrar pro grupo VIP" **não** apontam direto pro WhatsApp.
Eles apontam pra uma página intermediária **`/entrar`** (`public/entrar.html`) que:
1. dispara `fbq('track','Lead')` (conversão);
2. redireciona pro grupo do WhatsApp em ~0,6s (`window.location.replace`).

**Por quê assim, e não no clique do botão:** quando o link vai direto pro WhatsApp, o navegador
sai da página antes do pixel terminar de enviar o evento, e o Lead se perde com frequência.
Uma página de redirecionamento garante que o evento é enviado (page load é confiável), e ainda
é rápida pro usuário.

**Importante (limitação real):** o WhatsApp **não avisa** quando alguém entra de fato no grupo.
Então o Lead mede **intenção/entrada no fluxo** (clicou → foi redirecionado pro grupo), que é o
padrão pra funil de grupo VIP. Não dá pra ter "confirmou entrada no grupo" via pixel.

> Quiser também medir só o clique (separado do Lead)? Dá pra adicionar um evento custom
> `fbq('trackCustom','ClicouVIP')` no clique do botão, sem duplicar o Lead. Hoje está só o Lead
> (1 conversão limpa por pessoa que avança).

---

## 4. Configurar a conversão no Meta (Events Manager)
1. Events Manager → confirme que o Pixel recebe **PageView** e **Lead** (use a aba "Testar eventos"
   abrindo o site e clicando em entrar).
2. Em **Conversões personalizadas** ou direto no Gerenciador de Anúncios, escolha **Lead** como
   evento de otimização da campanha de captação.
3. (Recomendado) Ative a **API de Conversões** depois, pra reforçar o tracking server-side — isso
   já exige um passo extra (token), fazemos quando for escalar.

---

## 5. Purchase (quando o curso estiver na Hotmart) — futuro
A venda acontece na **Hotmart**, fora do nosso site. Duas formas de medir Purchase:
- **Mais simples:** ativar a **integração nativa Hotmart → Meta Pixel** (no painel da Hotmart,
  Apps/Pixel, cola o mesmo ID do Pixel). A Hotmart dispara `Purchase` na confirmação.
- **Mais robusto:** API de Conversões da Hotmart com o token do Meta.
Além disso, o `InitiateCheckout` já dispara no nosso site quando clicam no botão de compra
(quando trocarmos os placeholders `#HOTMART_197` / `#HOTMART_497` pelos links reais).

---

## 5b. Google Analytics 4 (GA4) — ATIVO desde 17/06/2026
**Measurement ID:** `G-MZS1VCZ89D` — propriedade **"Nataly — Lash 2.0"** na conta Google do **Eduardo**.
Configurado em `public/js/analytics.js` (linha `var GA_MEASUREMENT_ID = "G-MZS1VCZ89D"`).

**Eventos:**
| Evento GA4 | Quando | Onde |
|------------|--------|------|
| `page_view` | toda página, **carregando os UTMs da URL** (fonte/campanha casam com as UTMs das campanhas Meta) | todas |
| `generate_lead` | pessoa avança pro grupo VIP | `/entrar` |

**Como o `generate_lead` sobrevive ao redirect (importante):** a `/entrar` redireciona rápido pro
WhatsApp. Pra o evento não se perder, ele é enviado com `transport_type:'beacon'` e o **redirect só
acontece no `event_callback`** (assim que o GA confirma o envio), com **fallback de 3s** caso o GA
esteja bloqueado (adblock). Há `preconnect` pra googletagmanager/facebook acelerando o carregamento.
> ⚠️ Lição: a versão inicial redirecionava em 1,2s e o `generate_lead` se perdia (o `gtag.js` é
> assíncrono e não terminava de enviar). Validado com Puppeteer headless: a sequência correta é
> `page_view → generate_lead → redirect`.

**Falta 1 passo manual (Eduardo):** marcar `generate_lead` como **Evento-chave** no GA4.
- O evento **aparece sozinho** depois de disparar (DebugView/Tempo Real = na hora; lista de Eventos = até 24h). **Não precisa "criar" o evento.**
- Depois que aparecer: **Administração → Eventos-chave** → ligar a chave em `generate_lead`. A partir daí conta como conversão.
- Conferir agora: GA4 → **DebugView** (ou Tempo Real) → abrir `/entrar` em outra aba.

---

## 6. Resumo do fluxo de tracking
```
Ad (Meta)  →  /  (captação, PageView)  →  clica "Entrar pro grupo VIP"
           →  /entrar  (PageView + LEAD)  →  WhatsApp (grupo VIP)
... mais perto do dia 30:
   página de venda (PageView) → clica comprar (InitiateCheckout) → Hotmart (Purchase)
```

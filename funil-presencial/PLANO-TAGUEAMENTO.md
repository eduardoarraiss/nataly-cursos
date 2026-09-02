# Plano de tagueamento — funil de qualificação

Escrito em 01/09/2026. **Nada aqui foi implementado ainda além do que está marcado ✅.**
O objetivo é conseguir rodar campanha de **lead** no Meta e saber, com número, onde o funil
perde gente e qual anúncio traz lead que presta.

**Códigos:** pixel Meta `1511752107118676` · GA4 `G-MZS1VCZ89D` · conta `act_875612732237664`.
Não existe GTM: tudo é tag direta.

---

## 1. O que já existe ✅

| Momento | Meta | GA4 |
|---|---|---|
| Página de venda carrega | `PageView` · `ViewContent` | `page_view` · `view_item` |
| Rola até a oferta | `ScrollOferta` | `scroll_to_offer` |
| Clica no CTA | `IniciouInscricao` (1×/sessão) | — (ver §4) |
| Chega no formulário | `PageView` · `ViewContent` | `page_view` · `view_item` · `select_item` |
| Vê a etapa do preço | `ViuInvestimento` (1×/sessão) | `view_price_step` |
| Envia | **`Lead`** (`eventID`, sem valor) | `generate_lead` |

🔴 Zero `Purchase` e zero `InitiateCheckout` nas páginas de qualificação.
**Purchase é só da Kiwify** (pixel + CAPI) — duplicar reproduz o 4,75× já medido.

---

## 2. Evento por ETAPA do formulário — o que mais barateia o lead

Hoje sabemos quem chegou e quem terminou. Não sabemos **em qual pergunta desistem**, e é aí que
está o dinheiro: cada pergunta que derruba gente custa lead.

**Proposta:** `EtapaFormulario` (Meta) e `form_step` (GA4), com `step` (1 a 9) e `step_nome`.
Dispara **uma vez por etapa por sessão** — sem isso, quem volta para corrigir infla o número.

**Como ler:** a maior queda entre duas etapas consecutivas é a pergunta a reescrever. A hipótese
mais provável é a etapa do **investimento**, que é onde a conversa fica cara — mas isso se mede,
não se supõe.

---

## 3. Conversão Personalizada própria — obrigatório antes de escalar

🔴 **Hoje o `Lead` deste funil se mistura com o `Lead` da captação do grupo de WhatsApp do
Iniciante.** São públicos diferentes: um quer curso presencial de R$ 1.497, o outro entrou num
grupo grátis. Otimizar pelos dois juntos ensina o algoritmo a trazer o mais barato.

Além disso, a custom conversion `2047406306130846` ("Lead — Grupo VIP Lash 2.0") tem regra
`url contém /entrar`, que **captura `/entrar-profissao-lash` junto**.

**Proposta:** Conversão Personalizada filtrando `content_category = qualificacao-presencial`
(ou a rota `/inscricao-presencial`), e **a campanha otimiza por ela**, nunca pelo `Lead` cru.
⚠️ A `rule` de uma custom conversion **não é editável pela API** — para mudar é apagar e recriar.

---

## 4. A assimetria do GA4 no clique — não é bug, é medição

O `fbq` sobrevive ao unload; **o `gtag` não** — ele agrupa e manda o lote ~5s depois, então o hit
morre com a navegação. O `event_callback` **não salva**: dispara em 3ms, ao *enfileirar*.
Por isso o Meta recebe no clique e o GA4 recebe **na chegada**, com `?cta=` dizendo qual botão
trouxe. Ver [[reference-gtag-nao-sobrevive-ao-unload]].

---

## 5. CAPI para o `Lead` — recupera o que o navegador perde

Hoje o `Lead` sai só do navegador. Bloqueador e iOS comem parte.
O funil **já grava tudo no banco**, então o dado existe: dá para o servidor mandar o mesmo evento
com o mesmo `eventID` (o Meta deduplica).

⚠️ Token CAPI termina `ZDZD`, no Keychain `vault:META_ARRAIS_ACCESS_TOKEN` — **rotação pendente
desde 16/06**. Nunca usar `META_ACCESS_TOKEN`, que é da Haus e dá `(#100) Missing perms`.

---

## 6. Qualificação dentro do evento — otimizar por lead BOM

O funil já classifica quente/morno/frio com nota 0-100. Mandar isso no evento permite,
mais para frente, otimizar por lead que presta em vez de por volume.

**Proposta:** parâmetro `qualificacao` e `pontuacao` no `Lead`, e — quando houver volume —
uma Conversão Personalizada só de **lead quente**.

⚠️ Só faz sentido escalar para "otimizar por quente" com volume suficiente; abaixo disso o
algoritmo não tem sinal e a entrega estrangula.

---

## 7. Produto recomendado no evento

Com a ramificação, o mesmo formulário passa a recomendar **quatro produtos** de preços muito
diferentes (R$ 497 a R$ 1.997). Sem distinguir, o Meta otimiza pela média de todos.

**Proposta:** `content_ids` com o produto recomendado, e `InitiateCheckout` **com o valor certo**
no caminho online. ⚠️ `pixel.js` cai no default "lash2-online R$197" quando não reconhece a rota.

---

## 8. Ordem sugerida

1. Evento por etapa (diz onde perde gente) — maior retorno imediato
2. Conversão Personalizada própria (sem isso a campanha aprende errado)
3. Produto no evento (a ramificação torna isto obrigatório)
4. CAPI do `Lead` (recupera perda de navegador)
5. Qualificação no evento (só faz efeito com volume)

## 9. Como medir sem se enganar

- ⚠️ **Chrome headless não mostra disparo do pixel** (supressão anti-bot). Medir só em Chrome com janela.
- ⚠️ **GA4 com bucket estrito de tempo dá falso negativo** por causa do lote. Asserção cumulativa.
- ⚠️ **O agregado do `/stats` do pixel atrasa horas**; `last_fired_time` chega a ficar 20h atrasado.
  Nunca concluir "o evento não chegou" pelo agregado recente.
- ⚠️ `aggregation=url` do `/stats` devolve **só o domínio, sem path**.
- 🔴 **Ler posicionamento por COMPRA, nunca por InitiateCheckout.**

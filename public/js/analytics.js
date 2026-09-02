// ============================================================
//  GOOGLE ANALYTICS 4 — Nataly Ribeiro (Lash 2.0 Online + Presencial LED)
//  Measurement ID abaixo. Vazio = desligado (não quebra o site).
//
//  Captura:
//   • page_view       — todas as páginas (com UTMs → fonte/campanha)
//   • view_item       — ao abrir a página de venda (com valor do produto)
//   • scroll_to_offer — ao chegar na seção de preço (#oferta) = alta intenção
//   • begin_checkout  — clique no botão que leva ao checkout Kiwify
//   • generate_lead   — na /entrar (conversão = entrou no grupo VIP) — ver entrar.html
// ============================================================

var GA_MEASUREMENT_ID = "G-MZS1VCZ89D"; // Nataly — GA4

(function () {
  if (!GA_MEASUREMENT_ID) return; // sem ID = desligado

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_MEASUREMENT_ID;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID);

  // --- Detecção do produto pela rota ---
  var path = (location.pathname || "").toLowerCase();
  var isPresencial = path.indexOf("presencial") !== -1;   // refinado logo abaixo por isFunil
  var isObrigadoApostila = path.indexOf("obrigado-apostila") !== -1;
  var isApostila = !isObrigadoApostila && path.indexOf("apostila") !== -1; // LP low-ticket (PDF R$67,90)
  // PV do Profissão Lash (curso iniciante) — produto e valor PRÓPRIOS.
  // Sem isto ela cairia no padrão "Lash 2.0 R$197", que é outro produto e
  // sujaria a otimização do Meta e o funil do GA4.
  // ⚠️ A rota do combo (/profissao-lash-presencial) CONTÉM "presencial", então ela
  // tem de ser testada ANTES de isPresencial — senão cairia em "Formação Presencial
  // LED" (R$ 1.997), que é outro produto. E a checagem do online foi alargada de
  // "profissao-lash-curso" para "profissao-lash" para cobrir também a página de
  // obrigado; sem isso ela cairia no default "Lash 2.0 R$ 197".
  // 🔴 A ROTA DO FORMULÁRIO NÃO TEM PRODUTO ATÉ A ÁRVORE RODAR.
  // Ela contém "presencial", então sem esta linha o ViewContent/view_item de
  // carregamento sairia como "Formação Presencial LED · R$ 1.997" para TODA
  // pessoa que abre o formulário — inclusive as que vão terminar no produto de
  // R$ 297. Isso não é um erro de rótulo: é R$ 1.997 de valor declarado ao Meta
  // em cada abertura de formulário. Enquanto o produto é desconhecido, o
  // honesto é dizer que é o funil, e com valor zero. A partir da tela final,
  // `window.NR_PRODUTO` assume e os eventos passam a valer o produto certo.
  var isFunil = path.indexOf("inscricao-presencial") !== -1;
  var isProfLashPresencial = !isFunil && path.indexOf("profissao-lash-presencial") !== -1;
  var isProfissaoLash = !isFunil && !isProfLashPresencial && path.indexOf("profissao-lash") !== -1;
  var produto = isFunil
    ? { id: "funil-qualificacao", name: "Funil de qualificação", value: 0 }
    : isProfLashPresencial
    ? { id: "profissao-lash-presencial", name: "Profissão Lash — Online + Presencial", value: 1497 }
    : isProfissaoLash
    ? { id: "profissao-lash",      name: "Profissão Lash — Iniciante", value: 497 }
    : isPresencial
    ? { id: "lash2-presencial",    name: "Formação Presencial LED", value: 1997 }
    : isApostila
    ? { id: "apostila-metodo-led", name: "Apostila — O Método LED",  value: (window.LED_VALUE || 67.9) }
    : { id: "lash2-online",        name: "Lash 2.0 — Online",        value: (window.LED_VALUE || 197) };

  // --- Variante de página (teste A/B de copy+design) ---
  // Cada HTML define window.PAGE_VARIANT ("A" = longa canônica, "B" = enxuta).
  // Vai como parâmetro page_variant em todos os eventos → comparar no GA4.
  var VARIANT = (window.PAGE_VARIANT || "").toString().toUpperCase() || null;
  if (VARIANT) {
    // fica disponível em todos os eventos GA4 desta página
    gtag("set", { page_variant: VARIANT });
  }

  function ev_extra(base) {
    if (VARIANT) base.page_variant = VARIANT;
    return base;
  }


  // --- OVERRIDE DE PRODUTO EM TEMPO DE EXECUÇÃO ---
  // A /inscricao-presencial serve QUATRO produtos na mesma URL: qual deles
  // ela recebe só se sabe depois que o servidor roda a árvore. A detecção por
  // rota não tem como acertar isso — pior, a rota contém "presencial", então
  // ela cairia em "Formação Presencial LED" (R$ 1.997) e mandaria esse valor
  // até para quem clicou no checkout do Método LED online (R$ 297).
  // Por isso a tela final publica `window.NR_PRODUTO` e TODO evento lê daqui,
  // no momento em que dispara, e não do que a rota disse no carregamento.
  function atual() {
    var o = window.NR_PRODUTO;
    if (o && o.id && typeof o.value === 'number') return o;
    return produto;
  }

  function itens() {
    var p = atual();
    return [{
      item_id: p.id,
      item_name: p.name,
      price: p.value,
      quantity: 1
    }];
  }
  function valorAtual() { return atual().value; }

  // TRAVA DE 1 begin_checkout POR SESSÃO — opt-in: a página declara window.IC_UNICO.
  // Mesma razão do pixel: página com muitos CTAs contaria um evento por clique.
  var bcJaFoi = false;
  function bcPodeDisparar() {
    if (!window.IC_UNICO) return true;   // páginas antigas seguem exatamente como estavam
    if (bcJaFoi) return false;
    bcJaFoi = true;
    try {
      var chave = "bc_" + atual().id;
      if (sessionStorage.getItem(chave)) return false;
      sessionStorage.setItem(chave, "1");
    } catch (e) {}
    return true;
  }

  // begin_checkout no clique de qualquer link que vá pro checkout Kiwify.
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("a");
    if (!a) return;
    var href = (a.getAttribute("href") || "").toLowerCase();
    if (href.indexOf("pay.kiwify") !== -1 && bcPodeDisparar()) {
      gtag("event", "begin_checkout", ev_extra({
        currency: "BRL", value: valorAtual(), items: itens()
      }));
      // Evento EXCLUSIVO da variante (nome próprio) — filtro fácil no relatório.
      if (VARIANT) gtag("event", "begin_checkout_" + VARIANT.toLowerCase(), { page_variant: VARIANT });
    }
  });

  // Eventos de venda só nas páginas que têm checkout.
  function initVenda() {
    // Compra da APOSTILA confirmada (página de obrigado da apostila) — audiência, sem valor.
    // O purchase com valor vem da Kiwify (dedupe) — não duplicar aqui.
    if (isObrigadoApostila) {
      gtag("event", "compra_apostila_confirmada", {
        currency: "BRL",
        items: [{ item_id: "apostila-metodo-led", item_name: "Apostila — O Método LED", quantity: 1 }]
      });
    }
    // Uma página é "de venda" quando tem para onde converter. A lista cresceu
    // junto com o funil: primeiro era só o link da Kiwify; em 01/09/2026 a
    // /profissao-lash-presencial trocou o checkout pelo formulário, e o
    // formulário virou PÁGINA PRÓPRIA (/inscricao-presencial).
    // Hoje conta: link de checkout, link para o formulário, ou o formulário.
    // ⚠️ Esta linha já apagou o view_item e o scroll_to_offer em silêncio DUAS vezes — uma ao
    // tirar o checkout, outra ao mover o formulário para fora da página.
    // Se mudar o destino de conversão de novo, ATUALIZE AQUI.
    var temConversao = document.querySelector('a[href*="pay.kiwify"]') ||
                       document.querySelector('a[href*="inscricao-presencial"]') ||
                       document.getElementById("insc-form");
    if (!temConversao) return; // não é página de venda

    gtag("event", "view_item", ev_extra({
      currency: "BRL", value: valorAtual(), items: itens()
    }));
    // PageView EXCLUSIVO da variante (topo do funil A/B).
    if (VARIANT) gtag("event", "page_view_" + VARIANT.toLowerCase(), { page_variant: VARIANT });

    var oferta = document.getElementById("oferta");
    if (oferta && "IntersectionObserver" in window) {
      var fired = false;
      var io = new IntersectionObserver(function (entries) {
        if (fired) return;
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            fired = true;
            gtag("event", "scroll_to_offer", ev_extra({
              currency: "BRL", value: valorAtual(), items: itens()
            }));
            io.disconnect();
            break;
          }
        }
      }, { threshold: 0.4 });
      io.observe(oferta);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVenda);
  } else {
    initVenda();
  }

  // Obs.: generate_lead (conversão do grupo VIP) é disparado pela /entrar,
  // coordenado com o redirect (beacon + event_callback). Ver entrar.html.
})();

// ============================================================
//  UTM FORWARDING — leva a origem do anúncio até o checkout Kiwify.
//  O anúncio já traz utm_* na URL da página, mas o link do checkout
//  era cru (pay.kiwify.com.br/XXXX sem query) → a Kiwify gravava
//  tracking null e a atribuição se perdia. Aqui: captura utm_*/src/
//  fbclid/gclid da URL de entrada, persiste (last-touch em
//  localStorage, sobrevive a idas e voltas) e injeta em todo link
//  pay.kiwify. Tudo em try/catch: se não houver UTM, não faz nada.
// ============================================================
(function () {
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var STORE = "nr_attrib";

  function readParams() {
    var qs;
    try { qs = new URLSearchParams(location.search); } catch (e) { return null; }
    var out = {}, has = false;
    UTM_KEYS.forEach(function (k) { var v = qs.get(k); if (v) { out[k] = v; has = true; } });
    var src = qs.get("src"); if (src) { out.src = src; has = true; }
    var fbclid = qs.get("fbclid"); if (fbclid) { out.fbclid = fbclid; has = true; }
    var gclid = qs.get("gclid"); if (gclid) { out.gclid = gclid; has = true; }
    return has ? out : null;
  }

  function getAttrib() {
    var fresh = readParams();
    if (fresh) {
      try { localStorage.setItem(STORE, JSON.stringify(fresh)); } catch (e) {}
      return fresh;
    }
    try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { return null; }
  }

  // Alvos que precisam receber a origem: o checkout da Kiwify e o FORMULÁRIO
  // de qualificação, que virou rota própria. Sem levar a UTM adiante, o lead
  // chegaria no banco sem saber de qual anúncio veio.
  function ehAlvo(href) {
    var h = (href || "").toLowerCase();
    return h.indexOf("pay.kiwify") !== -1 || h.indexOf("inscricao-presencial") !== -1;
  }

  function decorate(a, attrib) {
    if (!a || !attrib) return;
    var href = a.getAttribute("href") || "";
    if (!ehAlvo(href)) return;
    try {
      var u = new URL(href, location.origin);
      UTM_KEYS.forEach(function (k) { if (attrib[k]) u.searchParams.set(k, attrib[k]); });
      // A Kiwify mostra "src" no painel — usa utm_source como fallback.
      var src = attrib.src || attrib.utm_source;
      if (src) u.searchParams.set("src", src);
      if (attrib.fbclid) u.searchParams.set("fbclid", attrib.fbclid);
      if (attrib.gclid) u.searchParams.set("gclid", attrib.gclid);
      a.setAttribute("href", u.toString());
    } catch (e) {}
  }

  function apply() {
    var attrib = getAttrib();
    if (!attrib) return;
    var links = document.querySelectorAll('a[href*="pay.kiwify"], a[href*="inscricao-presencial"]');
    for (var i = 0; i < links.length; i++) decorate(links[i], attrib);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }

  // Exposto para quem INJETA link depois do load. A /inscricao-presencial só
  // sabe qual é o checkout depois que a árvore roda, então o botão nasce fora
  // do `apply()` de carregamento.
  //
  // ⚠️ A garantia do clique NÃO basta para um link injetado. Ela cobre a
  // navegação, mas não cobre "copiar endereço do link" (que não dispara
  // clique) nem o clique do meio em vários navegadores — e nesses casos a
  // pessoa levaria para o checkout uma URL sem utm_*, sem src e sem fbclid,
  // e a venda chegaria na Kiwify sem origem. Decorar na hora de desenhar
  // resolve os três casos com a MESMA implementação.
  window.NR_DECORA_UTM = apply;

  // Garantia no clique (links injetados ou reescritos depois do load).
  // Capture=true → roda antes da navegação, então o href já vai decorado.
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("a");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (!ehAlvo(href)) return;
    if (href.indexOf("utm_") === -1 && href.indexOf("src=") === -1) decorate(a, getAttrib());
  }, true);
})();

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
  var isPresencial = path.indexOf("presencial") !== -1;
  var produto = isPresencial
    ? { id: "lash2-presencial", name: "Formação Presencial LED", value: 1197 }
    : { id: "lash2-online",     name: "Lash 2.0 — Online",       value: 197 };

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

  function itens() {
    return [{
      item_id: produto.id,
      item_name: produto.name,
      price: produto.value,
      quantity: 1
    }];
  }

  // begin_checkout no clique de qualquer link que vá pro checkout Kiwify.
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("a");
    if (!a) return;
    var href = (a.getAttribute("href") || "").toLowerCase();
    if (href.indexOf("pay.kiwify") !== -1) {
      gtag("event", "begin_checkout", ev_extra({
        currency: "BRL", value: produto.value, items: itens()
      }));
      // Evento EXCLUSIVO da variante (nome próprio) — filtro fácil no relatório.
      if (VARIANT) gtag("event", "begin_checkout_" + VARIANT.toLowerCase(), { page_variant: VARIANT });
    }
  });

  // Eventos de venda só nas páginas que têm checkout.
  function initVenda() {
    if (!document.querySelector('a[href*="pay.kiwify"]')) return;

    gtag("event", "view_item", ev_extra({
      currency: "BRL", value: produto.value, items: itens()
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
              currency: "BRL", value: produto.value, items: itens()
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

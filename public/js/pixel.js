// ============================================================
//  META PIXEL — Nataly Ribeiro (Lash 2.0 Online + Formação Presencial LED)
//  Pixel único: 1511752107118676. O script detecta o produto pela ROTA
//  e ajusta content_name / content_ids / value automaticamente.
//
//  Eventos disparados:
//   • PageView         — toda página (automático)
//   • ViewContent      — ao abrir a página de venda → público "viu a oferta"
//   • ScrollOferta     — custom, ao chegar na seção de preço (#oferta) = ALTA intenção
//   • InitiateCheckout — clique no botão que leva ao checkout Kiwify
//   • Lead             — disparado na /entrar (grupo VIP) — ver entrar.html
//   • Purchase         — disparado pela própria Kiwify (Pixel + API de Conversões)
// ============================================================

var META_PIXEL_ID = "1511752107118676"; // Pixel da Nataly

(function () {
  if (!META_PIXEL_ID) return; // sem ID = pixel desligado

  // Código base do Meta Pixel
  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0";
    n.queue = []; t = b.createElement(e); t.async = !0; t.src = v;
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

  fbq("init", META_PIXEL_ID);
  fbq("track", "PageView");

  // --- Detecção do produto pela rota ---
  var path = (location.pathname || "").toLowerCase();
  var isPresencial = path.indexOf("presencial") !== -1;
  var produto = isPresencial
    ? { id: "lash2-presencial", name: "Formação Presencial LED", value: 1197 }
    : { id: "lash2-online",     name: "Lash 2.0 — Online",       value: 197 };

  // --- Variante de página (teste A/B de copy+design) ---
  // Cada HTML define window.PAGE_VARIANT ("A" = página longa canônica,
  // "B" = página enxuta). Vai em content_category + custom data page_variant
  // pra desdobrar no Meta. Páginas sem variante ficam sem tag (não atrapalha).
  var VARIANT = (window.PAGE_VARIANT || "").toString().toUpperCase() || null;

  function dados() {
    var d = {
      content_name: produto.name,
      content_ids: [produto.id],
      content_type: "product",
      value: produto.value,
      currency: "BRL"
    };
    if (VARIANT) { d.content_category = "pv_" + VARIANT.toLowerCase(); d.page_variant = VARIANT; }
    return d;
  }

  // InitiateCheckout no clique de qualquer link que vá pro checkout Kiwify.
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("a");
    if (!a) return;
    var href = (a.getAttribute("href") || "").toLowerCase();
    if (href.indexOf("pay.kiwify") !== -1) {
      fbq("track", "InitiateCheckout", dados());
      // Evento EXCLUSIVO da variante (nome próprio) — Conversão Personalizada no Meta.
      if (VARIANT) fbq("trackCustom", "InitiateCheckout_" + VARIANT, dados());
    }
  });

  // Eventos de venda só nas páginas que têm checkout (lançamento/presencial).
  function initVenda() {
    if (!document.querySelector('a[href*="pay.kiwify"]')) return; // não é página de venda

    fbq("track", "ViewContent", dados());
    // PageView EXCLUSIVO da variante (topo do funil A/B) — nome próprio no Meta.
    if (VARIANT) fbq("trackCustom", "PageView_" + VARIANT, { page_variant: VARIANT });

    // ScrollOferta: dispara 1x quando a seção de preço entra na tela.
    var oferta = document.getElementById("oferta");
    if (oferta && "IntersectionObserver" in window) {
      var fired = false;
      var io = new IntersectionObserver(function (entries) {
        if (fired) return;
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            fired = true;
            fbq("trackCustom", "ScrollOferta", dados());
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
})();

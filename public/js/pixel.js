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
  var isProfLashPresencial = path.indexOf("profissao-lash-presencial") !== -1;
  var isProfissaoLash = !isProfLashPresencial && path.indexOf("profissao-lash") !== -1;
  var produto = isProfLashPresencial
    ? { id: "profissao-lash-presencial", name: "Profissão Lash — Online + Presencial", value: 1497 }
    : isProfissaoLash
    ? { id: "profissao-lash",      name: "Profissão Lash — Iniciante", value: 497 }
    : isPresencial
    ? { id: "lash2-presencial",    name: "Formação Presencial LED", value: 1997 }
    : isApostila
    ? { id: "apostila-metodo-led", name: "Apostila — O Método LED",  value: (window.LED_VALUE || 67.9) }
    : { id: "lash2-online",        name: "Lash 2.0 — Online",        value: (window.LED_VALUE || 197) };

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

  // TRAVA DE 1 InitiateCheckout POR SESSÃO — opt-in: a página declara window.IC_UNICO.
  // Página com muitos CTAs conta um IC por clique e infla a métrica (foi o que
  // deixou o A/B do Método LED ilegível). Quem opta pela trava manda no máximo um
  // IC por sessão e por produto. Se o sessionStorage estiver bloqueado, a trava
  // ainda vale como variável de página, que já cobre o vai-e-volta entre CTAs.
  var icJaFoi = false;
  function icPodeDisparar() {
    if (!window.IC_UNICO) return true;   // páginas antigas seguem exatamente como estavam
    if (icJaFoi) return false;
    icJaFoi = true;
    try {
      var chave = "ic_" + produto.id;
      if (sessionStorage.getItem(chave)) return false;
      sessionStorage.setItem(chave, "1");
    } catch (e) {}
    return true;
  }

  // InitiateCheckout no clique de qualquer link que vá pro checkout Kiwify.
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("a");
    if (!a) return;
    var href = (a.getAttribute("href") || "").toLowerCase();
    if (href.indexOf("pay.kiwify") !== -1 && icPodeDisparar()) {
      fbq("track", "InitiateCheckout", dados());
      // Evento EXCLUSIVO da variante (nome próprio) — Conversão Personalizada no Meta.
      if (VARIANT) fbq("trackCustom", "InitiateCheckout_" + VARIANT, dados());
    }
  });

  // Eventos de venda só nas páginas que têm checkout (lançamento/presencial).
  function initVenda() {
    // Compra da APOSTILA confirmada (página de obrigado da apostila) — AUDIÊNCIA, sem valor.
    // O Purchase COM valor é disparado pela própria Kiwify (Pixel + CAPI, com dedupe) — não duplicar aqui.
    if (isObrigadoApostila) {
      fbq("trackCustom", "CompraApostilaConfirmada", {
        content_ids: ["apostila-metodo-led"], content_name: "Apostila — O Método LED", currency: "BRL"
      });
    }
    // Uma página é "de venda" quando tem para onde converter. A lista cresceu
    // junto com o funil: primeiro era só o link da Kiwify; em 01/09/2026 a
    // /profissao-lash-presencial trocou o checkout pelo formulário, e o
    // formulário virou PÁGINA PRÓPRIA (/inscricao-presencial).
    // Hoje conta: link de checkout, link para o formulário, ou o formulário.
    // ⚠️ Esta linha já apagou o ViewContent e o ScrollOferta em silêncio DUAS vezes — uma ao
    // tirar o checkout, outra ao mover o formulário para fora da página.
    // Se mudar o destino de conversão de novo, ATUALIZE AQUI.
    var temConversao = document.querySelector('a[href*="pay.kiwify"]') ||
                       document.querySelector('a[href*="inscricao-presencial"]') ||
                       document.getElementById("insc-form");
    if (!temConversao) return; // não é página de venda

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

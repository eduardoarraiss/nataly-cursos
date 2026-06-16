// ============================================================
//  META PIXEL — Lash 2.0 (Nataly Ribeiro)
//  COMO ATIVAR: cole o ID do seu Pixel do Meta na linha abaixo,
//  entre as aspas. Salve e dê push. Enquanto estiver vazio,
//  nada dispara (não quebra o site).
//
//  Eventos automáticos depois de ativado:
//   • PageView         — em toda página
//   • Lead             — disparado na página /entrar (redireciona pro grupo VIP)
//   • InitiateCheckout — clique em qualquer botão de compra (Hotmart)
// ============================================================

var META_PIXEL_ID = "1474568504358962"; // Pixel da Nataly (Lash 2.0)

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

  // InitiateCheckout no clique dos botões de compra (Hotmart).
  // O Lead é disparado na página /entrar (mais confiável que no clique).
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("a");
    if (!a) return;
    var href = (a.getAttribute("href") || "").toLowerCase();
    if (href.indexOf("hotmart") !== -1) {
      fbq("track", "InitiateCheckout", { content_name: "Lash 2.0" });
    }
  });
})();

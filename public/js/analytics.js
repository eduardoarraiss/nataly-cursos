// ============================================================
//  GOOGLE ANALYTICS 4 — Lash 2.0 (Nataly Ribeiro)
//  COMO ATIVAR: cole o Measurement ID (G-XXXXXXXXXX) abaixo,
//  entre as aspas. Vazio = desligado (não quebra o site).
//
//  Captura automática:
//   • page_view em todas as páginas (com os UTMs da URL → fonte/campanha)
//   • generate_lead na página /entrar (conversão = entrou no grupo VIP)
// ============================================================

var GA_MEASUREMENT_ID = "G-MZS1VCZ89D"; // Nataly — Lash 2.0 (GA4)

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

  // Obs.: o generate_lead (conversão) é disparado pela própria página /entrar,
  // coordenado com o redirect (transport=beacon + event_callback), pra não se
  // perder no window.location.replace. Ver entrar.html.
})();

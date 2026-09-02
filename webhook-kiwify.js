// ============================================================
//  WEBHOOK KIWIFY → META CAPI (Purchase server-side, 1x por venda)
//  ------------------------------------------------------------
//  Fix definitivo da DUPLA CONTAGEM de Compra (auditada 30/06/2026).
//  Causa: a Kiwify dispara Purchase por Pixel(navegador) + CAPI(servidor),
//  e como o produto é CO-PRODUÇÃO (Nataly produtora + Eduardo co-produtor)
//  com o MESMO pixel nas duas pontas, o CAPI sai 2x por venda → ~2,3x.
//
//  Este módulo manda UMA Purchase por PEDIDO PAGO, com:
//    event_id = order_ref   → dedup determinístico (retry e navegador colam)
//    1 evento por PEDIDO (nunca por item/bump — não há bumps neste produto)
//
//  ⚠️ Só vira fonte única DEPOIS de DESLIGAR o pixel FB nativo da Kiwify
//     (passo de corte, pós-pico). Enquanto o nativo estiver ligado, NÃO
//     registrar este webhook na Kiwify (senão vira 3ª fonte).
//
//  ENV necessárias (nunca hardcode segredo):
//    META_PIXEL_ID            (default 1511752107118676)
//    META_CAPI_TOKEN          token com acesso ao pixel (vault META_ARRAIS_ACCESS_TOKEN)
//    KIWIFY_WEBHOOK_TOKEN     token do webhook (Kiwify assina o corpo com ele)
//    META_TEST_EVENT_CODE     (opcional) ativa o stream de Test Events
//    META_CAPI_API_VERSION    (opcional, default v21.0)
// ============================================================
"use strict";
const crypto = require("crypto");

const PIXEL_ID = () => process.env.META_PIXEL_ID || "1511752107118676";
const API_VER = () => process.env.META_CAPI_API_VERSION || "v21.0";

// produtos conhecidos → URL canônica de origem do evento
const PRODUCTS = {
  "72bd4910-70c2-11f1-a903-0f129e2bf2f2": { name: "Lash 2.0 — Online", url: "https://www.natalyribeiro.com.br/lash-2-metodo-led" },
  "b4a30c50-740c-11f1-8cd9-017d655e273c": { name: "Formação Presencial LED", url: "https://www.natalyribeiro.com.br/presencial" },
};

function sha256(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (!s) return undefined;
  return crypto.createHash("sha256").update(s).digest("hex");
}
// telefone: só dígitos, com DDI (Brasil 55) — antes de hashear
function normPhone(v) {
  if (!v) return undefined;
  let d = String(v).replace(/\D/g, "");
  if (!d) return undefined;
  if (d.length <= 11) d = "55" + d; // assume Brasil se vier sem DDI
  return d;
}

// Verifica a assinatura do webhook da Kiwify (HMAC-SHA1 do corpo cru com o token).
function verifyKiwifySignature(rawBody, signature, token) {
  if (!token) return false;
  if (!signature) return false;
  const calc = crypto.createHmac("sha1", token).update(rawBody).digest("hex");
  // comparação em tempo constante
  try {
    return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(String(signature)));
  } catch (_) {
    return false;
  }
}

// Extrai os campos do payload da Kiwify de forma defensiva (nomes variam por versão).
function parseKiwifyOrder(payload) {
  const p = payload || {};
  const status = (p.order_status || p.status || p.webhook_event_type || "").toString().toLowerCase();
  const order_ref = p.order_ref || p.order_id || p.id;
  const prod = p.Product || p.product || {};
  const product_id = prod.product_id || prod.id || p.product_id;
  const comm = p.Commissions || p.commissions || {};
  // valores em CENTAVOS na Kiwify
  const cents = comm.product_base_price ?? comm.charge_amount ?? p.product_base_price ?? p.charge_amount ?? p.total;
  const value = cents != null ? Number(cents) / 100 : undefined;
  const currency = (comm.currency || p.charged_currency || p.currency || "BRL").toString().toUpperCase();
  const cust = p.Customer || p.customer || {};
  const trk = p.TrackingParameters || p.tracking_parameters || {};
  return {
    status, order_ref, product_id, value, currency,
    email: cust.email,
    phone: cust.mobile || cust.phone || cust.mobile_phone,
    first_name: cust.first_name || (cust.full_name ? String(cust.full_name).split(" ")[0] : undefined),
    last_name: cust.last_name || (cust.full_name ? String(cust.full_name).split(" ").slice(1).join(" ") : undefined),
    ip: cust.ip || p.ip,
    fbp: trk.fbp || p.fbp,
    fbc: trk.fbc || p.fbc,
    created_at: p.approved_date || p.updated_at || p.created_at,
  };
}

const PAID = new Set(["paid", "approved", "order_approved", "compra_aprovada", "aprovada"]);
function isPaid(order) { return PAID.has(order.status); }

// Monta o payload exato do CAPI (Conversions API) — 1 Purchase, event_id=order_ref.
function buildCapiEvent(order, opts = {}) {
  const meta = PRODUCTS[order.product_id] || { name: "Lash 2.0", url: "https://www.natalyribeiro.com.br/lash-2-metodo-led" };
  const user_data = {};
  if (sha256(order.email)) user_data.em = [sha256(order.email)];
  const ph = normPhone(order.phone); if (sha256(ph)) user_data.ph = [sha256(ph)];
  if (sha256(order.first_name)) user_data.fn = [sha256(order.first_name)];
  if (sha256(order.last_name)) user_data.ln = [sha256(order.last_name)];
  if (order.ip) user_data.client_ip_address = order.ip;
  if (order.fbp) user_data.fbp = order.fbp;
  if (order.fbc) user_data.fbc = order.fbc;

  const evtTime = order.created_at ? Math.floor(new Date(order.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000);
  return {
    event_name: "Purchase",
    event_time: Number.isFinite(evtTime) ? evtTime : Math.floor(Date.now() / 1000),
    event_id: String(order.order_ref),          // 🔑 dedup determinístico (1 por pedido)
    event_source_url: meta.url,
    action_source: "website",
    user_data,
    custom_data: {
      currency: order.currency || "BRL",
      value: order.value,
      content_type: "product",
      content_ids: [order.product_id],
      content_name: meta.name,
      order_id: String(order.order_ref),
    },
  };
}

// Envia ao Graph API. Retorna {status, body}. Suporta Test Events via test_event_code.
async function sendCapi(event, { pixelId, token, testCode } = {}) {
  pixelId = pixelId || PIXEL_ID();
  token = token || process.env.META_CAPI_TOKEN;
  testCode = testCode || process.env.META_TEST_EVENT_CODE;
  if (!token) throw new Error("META_CAPI_TOKEN ausente");
  const body = { data: [event] };
  if (testCode) body.test_event_code = testCode;
  const url = `https://graph.facebook.com/${API_VER()}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, body: data };
}

// Handler Express. Requer raw body (express.raw) p/ validar assinatura.
function makeHandler() {
  return async function handler(req, res) {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
      const signature = req.query.signature || req.headers["x-kiwify-signature"];
      const wToken = process.env.KIWIFY_WEBHOOK_TOKEN;
      // 🔴 FALHA FECHADA. Antes era `if (wToken && !verifica(...))`: sem o token
      //    configurado, a verificação era PULADA e qualquer POST anônimo passava.
      //    Enquanto META_CAPI_TOKEN não existe a rota é inerte e ninguém repara —
      //    mas no dia em que alguém configurar o CAPI e esquecer este token, a
      //    rota vira um injetor aberto de `Purchase` no pixel: qualquer pessoa
      //    forjaria vendas, e o algoritmo do Meta passaria a otimizar por elas.
      //    Com uma campanha rodando, isso envenena a entrega e o ROAS de uma vez.
      //    Sem token não há como distinguir a Kiwify de um estranho: recusa.
      if (!wToken) {
        console.error("[capi] KIWIFY_WEBHOOK_TOKEN ausente — webhook recusado (falha fechada)");
        return res.status(503).json({ ok: false, error: "webhook não configurado" });
      }
      if (!verifyKiwifySignature(raw, signature, wToken)) {
        return res.status(401).json({ ok: false, error: "assinatura inválida" });
      }
      let payload; try { payload = JSON.parse(raw.toString("utf8")); } catch { payload = {}; }
      const order = parseKiwifyOrder(payload);
      if (!order.order_ref) return res.status(200).json({ ok: true, skipped: "sem order_ref" });
      if (!isPaid(order)) return res.status(200).json({ ok: true, skipped: `status=${order.status} (só dispara em pago)` });

      const event = buildCapiEvent(order);
      const result = await sendCapi(event);
      const ok = result.status >= 200 && result.status < 300;
      // log enxuto, sem PII em texto plano
      console.log(`[capi] order=${order.order_ref} status=${order.status} value=${order.value} -> meta ${result.status} ${ok ? "OK" : JSON.stringify(result.body).slice(0,200)}`);
      return res.status(ok ? 200 : 502).json({ ok, event_id: event.event_id, meta_status: result.status });
    } catch (e) {
      console.error("[capi] erro:", e.message);
      return res.status(500).json({ ok: false, error: e.message });
    }
  };
}

module.exports = { sha256, normPhone, verifyKiwifySignature, parseKiwifyOrder, isPaid, buildCapiEvent, sendCapi, makeHandler, PRODUCTS };

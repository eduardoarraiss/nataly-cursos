// Teste LOCAL do webhook CAPI — dry-run (não envia Purchase pra produção).
// Valida: parse, gating de pago, dedup event_id=order_ref, hashing, assinatura,
// e (opcional) checa acesso do token ao pixel via GET. Para disparar Test Event
// real, rode com META_TEST_EVENT_CODE setado (pega o código no Events Manager → Test Events).
"use strict";
const crypto = require("crypto");
const { execSync } = require("child_process");
const W = require("./webhook-kiwify");

function ok(cond, msg) { console.log(`${cond ? "✅" : "❌"} ${msg}`); if (!cond) process.exitCode = 1; }

// ---- payload realista de webhook Kiwify (order paid) ----
const sample = {
  order_id: "5acbda6a-1167-410b-92b0-87f8e1d3110c",
  order_ref: "3qPpOkn",
  order_status: "paid",
  Product: { product_id: "72bd4910-70c2-11f1-a903-0f129e2bf2f2", product_name: "Lash 2.0 - Método LED" },
  Commissions: { product_base_price: "19700", charge_amount: "19700", currency: "BRL" },
  Customer: { full_name: "Maria Teste Silva", email: "Maria.Teste@Gmail.com ", mobile: "(35) 99999-1234", ip: "187.10.20.30" },
  TrackingParameters: { fbp: "fb.1.123.456", fbc: "fb.1.123.abc" },
  approved_date: "2026-06-30 12:49",
};

console.log("== parse + gating ==");
const order = W.parseKiwifyOrder(sample);
ok(order.order_ref === "3qPpOkn", "order_ref extraído");
ok(order.value === 197, `value = 197 (veio ${order.value})`);
ok(order.currency === "BRL", "currency BRL");
ok(W.isPaid(order) === true, "isPaid=true em status paid");
ok(W.isPaid(W.parseKiwifyOrder({ order_ref: "x", order_status: "waiting_payment" })) === false, "isPaid=false em waiting_payment (NÃO dispara em pix gerado)");

console.log("\n== build CAPI event (1 por pedido, dedup) ==");
const ev = W.buildCapiEvent(order);
ok(ev.event_name === "Purchase", "event_name Purchase");
ok(ev.event_id === "3qPpOkn", "event_id == order_ref (dedup determinístico)");
ok(ev.custom_data.value === 197 && ev.custom_data.currency === "BRL", "custom_data value/currency");
ok(ev.action_source === "website", "action_source website");
ok(ev.event_source_url.includes("lash-2-metodo-led"), "event_source_url canônica");
// hashing: email lowercase/trim antes do sha256
const expectedEm = crypto.createHash("sha256").update("maria.teste@gmail.com").digest("hex");
ok(ev.user_data.em && ev.user_data.em[0] === expectedEm, "email normalizado + sha256");
ok(ev.user_data.ph && /^[a-f0-9]{64}$/.test(ev.user_data.ph[0]), "phone hasheado");
ok(W.normPhone("(35) 99999-1234") === "5535999991234", "phone normalizado c/ DDI 55");
ok(ev.user_data.client_ip_address === "187.10.20.30" && ev.user_data.fbp && ev.user_data.fbc, "ip+fbp+fbc presentes");
// garantir que NÃO há PII em texto plano
const json = JSON.stringify(ev);
ok(!json.includes("maria.teste@gmail.com") && !json.includes("Maria"), "sem PII em texto plano no payload");

console.log("\n== assinatura Kiwify (HMAC-SHA1 do corpo) ==");
const tok = "tok_teste_123";
const raw = Buffer.from(JSON.stringify(sample));
const sig = crypto.createHmac("sha1", tok).update(raw).digest("hex");
ok(W.verifyKiwifySignature(raw, sig, tok) === true, "assinatura válida aceita");
ok(W.verifyKiwifySignature(raw, "deadbeef", tok) === false, "assinatura inválida rejeitada");

console.log("\n== payload final que iria pro Meta (event_id em destaque) ==");
console.log(JSON.stringify({ data: [ev] }, null, 2));

// ---- checagem opcional de acesso do token ao pixel (GET, inócuo) ----
(async () => {
  let token = process.env.META_CAPI_TOKEN;
  if (!token) {
    try { token = execSync(`${process.env.HOME}/.local/bin/vault get META_ARRAIS_ACCESS_TOKEN`, { encoding: "utf8" }).trim(); } catch {}
  }
  if (!token) { console.log("\n(sem token — pulando checagem de acesso ao pixel)"); return; }
  const pid = process.env.META_PIXEL_ID || "1511752107118676";
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${pid}?fields=name,last_fired_time&access_token=${encodeURIComponent(token)}`);
    const d = await r.json();
    ok(r.status === 200 && d.id === pid, `token acessa o pixel ${pid} (name="${d.name||"?"}")`);
  } catch (e) { console.log("checagem de acesso falhou:", e.message); }

  const testCode = process.env.META_TEST_EVENT_CODE;
  if (testCode) {
    console.log(`\n== enviando Test Event (code ${testCode}) — aparece só no Test Events, não na produção ==`);
    const res = await W.sendCapi(W.buildCapiEvent(order), { token, testCode });
    console.log("resposta Meta:", JSON.stringify(res.body));
    ok(res.status === 200 && res.body && res.body.events_received >= 1, "Test Event recebido pelo Meta");
  } else {
    console.log("\nℹ️  Para o Test Event real: Events Manager → Pixel → Testar Eventos → copiar o code → ");
    console.log("   META_TEST_EVENT_CODE=TESTxxxxx node test-capi.js");
  }
})();

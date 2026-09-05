/* ============================================================
   HEALTH CHECK DO WHATSAPP DA NATALY
   ============================================================
   Pergunta à Evolution se a instância está `open` e conta quantos leads estão
   esperando aviso. Sai com código 1 quando algo está errado — quem grita é o
   `health-whatsapp.sh`, do mesmo jeito que o `health-checkouts` já faz.

   🔴 POR QUE ISTO EXISTE, e é a lição inteira deste incidente.
      Em 04/09/2026, às 12h23, o aparelho pareado caiu e o WhatsApp ficou fora
      por CINCO DIAS. O site respondeu 200 o tempo todo, o lead foi gravado o
      tempo todo, e ninguém foi avisado — em silêncio. Cair é aceitável; cair
      calado, não.

   🔴 O ALERTA NÃO PODE SAIR PELO CANAL QUE CAIU. Avisar pelo WhatsApp que o
      WhatsApp caiu é o erro clássico de monitorar um canal por ele mesmo:
      justamente quando o alarme importa, ele não toca. Por isso o aviso sai
      pela notificação do macOS (`osascript`), que é o canal que os outros
      health checks deste projeto já usam e que não depende de nada disto.
   ============================================================ */
'use strict';

const CFG = {
  url: (process.env.NATALY_WA_URL || '').replace(/\/+$/, ''),
  key: process.env.NATALY_WA_KEY || '',
  instancia: process.env.NATALY_WA_INSTANCIA || 'nataly',
};

/* Saída em UMA linha para o `.sh` ler e enfiar na notificação, e o resto para
   o log. Se este processo morrer no meio, a linha não sai — e a ausência dela
   é, ela mesma, um sinal de falha para quem chama. */
function resultado(estado, texto, detalhe) {
  console.log('ESTADO=' + estado);
  console.log('RESUMO=' + texto);
  if (detalhe) console.log(detalhe);
  console.log('=== FIM DO HEALTH CHECK ===');
  process.exit(estado === 'ok' ? 0 : 1);
}

async function pergunta(caminho) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(CFG.url + caminho, { headers: { apikey: CFG.key }, signal: ctrl.signal });
    const corpo = await r.text();
    let j = null; try { j = JSON.parse(corpo); } catch (e) {}
    return { http: r.status, j, corpo };
  } finally { clearTimeout(t); }
}

async function principal() {
  if (!CFG.url || !CFG.key) {
    resultado('config', 'health check sem NATALY_WA_URL/KEY — não consegui checar nada');
  }

  /* 1. o estado da instância */
  let est = null;
  try {
    const r = await pergunta('/instance/connectionState/' + encodeURIComponent(CFG.instancia));
    /* Conferido por CONTEÚDO: um 200 sem `instance.state` não é "está de pé",
       é uma resposta que não diz nada. */
    est = (r.j && r.j.instance && r.j.instance.state) || null;
    if (!est) {
      resultado('sem-resposta',
        'a Evolution respondeu sem dizer o estado da instância', r.corpo.slice(0, 300));
    }
  } catch (e) {
    resultado('inalcancavel', 'não consegui falar com a Evolution: ' + e.message);
  }

  /* 2. quantos leads estão esperando aviso — só se houver banco à mão.
        É opcional de propósito: o alarme mais importante (o canal caiu) não
        pode depender de o Postgres estar acessível de fora. */
  let esperando = null;
  if (process.env.DATABASE_URL) {
    try {
      const db = require('../funil-presencial/db');
      await db.iniciar();
      const r = await db.consulta(
        "SELECT COUNT(*)::int AS n FROM leads WHERE aviso_estado <> 'enviado'");
      esperando = r.rows[0].n;
      await db.fechar();
    } catch (e) {
      console.log('(não consegui contar os leads esperando: ' + e.message + ')');
    }
  }

  const fila = esperando === null ? '' : ' · ' + esperando + ' lead(s) esperando aviso';

  if (est !== 'open') {
    resultado('caiu', 'WhatsApp DESCONECTADO (estado: ' + est + ')' + fila,
      'Reparear:  bash scripts/ops/parear-whatsapp.sh');
  }
  if (esperando) {
    /* Conectado e ainda com fila parada: ou a fila travou, ou os avisos
       acabaram de nascer. Vale um aviso mais brando, não um alarme. */
    resultado('fila', 'WhatsApp conectado, mas ' + esperando + ' lead(s) ainda sem aviso');
  }
  resultado('ok', 'WhatsApp conectado' + fila);
}

principal().catch((e) => {
  resultado('estourou', 'o health check estourou: ' + ((e && e.message) || e));
});

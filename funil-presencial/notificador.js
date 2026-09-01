/* ============================================================
   AVISO NO WHATSAPP DA NATALY — com fila e nova tentativa
   ============================================================
   Princípio: o lead JÁ ESTÁ no banco quando esta parte roda. Aqui
   nada pode derrubar o pedido da pessoa. Toda falha vira linha na
   tabela `avisos` com status 'pendente' ou 'falhou', e o painel
   mostra quais não saíram.

   DESTINO CONFIGURÁVEL: NATALY_WA_DESTINO aceita tanto um número
   (5535997164668) quanto um id de grupo (....@g.us). O Eduardo vai
   criar um grupo depois — trocar a variável basta, sem tocar código.

   DRIVER PADRÃO É 'log': sem configuração explícita, NADA é enviado
   para o WhatsApp. Conectar exige ação deliberada do Eduardo.
   ============================================================ */
const db = require('./db');
const L = require('./leads');

const CFG = () => ({
  driver:    process.env.NATALY_WA_DRIVER   || 'log',
  url:       (process.env.NATALY_WA_URL     || '').replace(/\/+$/, ''),
  key:       process.env.NATALY_WA_KEY      || '',
  instancia: process.env.NATALY_WA_INSTANCIA || '',
  destino:   process.env.NATALY_WA_DESTINO  || '',
  teste:     process.env.NATALY_WA_TESTE === '1',
});

/* Pedido literal do Eduardo: toda mensagem de teste começa assim. */
const PREFIXO_TESTE = 'Isso é um teste de uma automação, ignore';

/* Backoff: 1min, 5min, 15min, 1h, 6h, 24h. Depois disso desiste e
   marca 'falhou' — mas o lead continua no banco e no painel. */
const ESPERAS_MIN = [1, 5, 15, 60, 360, 1440];
const MAX_TENTATIVAS = ESPERAS_MIN.length;

/* ---------- a mensagem ---------- */
const ROTULO = {
  situacao: { 'ja-lash':'já trabalha com cílios', 'area-beleza':'já é da área da beleza',
              'outra-area':'vem de outra área' },
  disponibilidade: { sim:'PODE vir a Cambuí', talvez:'talvez consiga vir', nao:'NÃO pode vir' },
  aceita_valor: { sim:'aceita o valor', 'preciso-parcelar':'aceita, quer parcelar', nao:'NÃO aceita o valor' },
  quando_comecar: { agora:'quer começar agora', '30-dias':'em até 30 dias',
                    '90-dias':'em até 90 dias', 'so-olhando':'só olhando' },
  meta_renda: { 'ate-2k':'até R$ 2 mil', '2k-5k':'R$ 2 a 5 mil', '5k-10k':'R$ 5 a 10 mil',
                'mais-10k':'mais de R$ 10 mil', 'nao-sei':'ainda não sabe' },
  qualificacao: { quente:'🔥 QUENTE', morno:'🟡 MORNO', frio:'🔵 FRIO' },
};

/* Origem em portugues, nao em jargao de UTM: quem le no celular as 23h
   nao deve precisar decifrar "utm_content". Mostra o anuncio quando existe,
   e diz o canal por extenso. */
function descreveOrigem(l) {
  const canal = {
    facebook: 'Facebook Ads', fb: 'Facebook Ads', ig: 'Instagram Ads',
    instagram: 'Instagram', google: 'Google', bio: 'link da bio',
  }[String(l.utm_source || '').toLowerCase()] || l.utm_source;

  const partes = [];
  if (canal) partes.push(canal);
  if (l.utm_content) partes.push('anuncio: ' + l.utm_content);
  else if (l.utm_campaign) partes.push('campanha: ' + l.utm_campaign);

  if (!partes.length) return 'Entrou direto no site (sem anuncio)';
  return partes.join(' · ');
}

function montaMensagem(l) {
  const linha = [];

  // Cabecalho: em UM olhar a Nataly sabe o que e, quao quente esta e quem e.
  linha.push('🔔 *LEAD NOVO* · Profissao Lash');
  linha.push(ROTULO.qualificacao[l.qualificacao] + '  ·  ' + l.pontuacao + '/100');
  linha.push('━━━━━━━━━━━━━━━');
  linha.push('');

  linha.push('*' + l.nome + '*');
  linha.push('📍 ' + l.cidade + (l.estado ? ', ' + l.estado : ''));
  linha.push('📱 ' + L.formataTelefone(l.telefone));
  linha.push('📷 instagram.com/' + l.instagram);
  if (l.email) linha.push('✉️ ' + l.email);
  linha.push('');

  // As respostas dela, em topicos curtos.
  if (l.situacao)        linha.push('• ' + ROTULO.situacao[l.situacao]);
  if (l.faixa_idade)     linha.push('• ' + l.faixa_idade + ' anos');
  if (l.meta_renda)      linha.push('• meta: ' + ROTULO.meta_renda[l.meta_renda]);
  if (l.quando_comecar)  linha.push('• ' + ROTULO.quando_comecar[l.quando_comecar]);
  linha.push('• ' + ROTULO.disponibilidade[l.disponibilidade]);
  linha.push('• ' + ROTULO.aceita_valor[l.aceita_valor]);

  if (l.objetivo) {
    linha.push('');
    linha.push('💬 _"' + l.objetivo.slice(0, 400) + '"_');
  }

  linha.push('');
  linha.push('━━━━━━━━━━━━━━━');
  linha.push('📢 ' + descreveOrigem(l));
  linha.push('');

  /* 🔴 O link abre a conversa VAZIA, de proposito.
     Nao escrever mensagem na voz da Nataly: quem fala com a aluna e ela, e o
     texto e dela. Ja houve uma versao daqui que mandava a saudacao pronta
     ("Oi, Fulana! Aqui e a Nataly...") — o Edu barrou, e com razao: assinar
     palavras no nome de outra pessoa nao e decisao de quem escreve o codigo.
     Se um dia houver mensagem padrao, ela vem escrita e aprovada por eles. */
  linha.push('👉 *Responder:* https://wa.me/' + l.telefone);

  const corpo = linha.join('\n');
  return CFG().teste ? PREFIXO_TESTE + '\n\n' + corpo : corpo;
}

function primeiroNome(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

/* ---------- enfileirar ---------- */
async function enfileira(lead) {
  const cfg = CFG();
  const r = await db.consulta(
    'INSERT INTO avisos (lead_id, destino, mensagem) VALUES ($1,$2,$3) RETURNING *',
    [lead.id, cfg.destino || null, montaMensagem(lead)]);
  return r.rows[0];
}

/* ---------- envio ---------- */

/* Evolution API própria da Nataly. NÃO é a instância da Haus (haus-r1) —
   essa serve o Roberta OS e não pode ser tocada. */
async function enviaEvolution(cfg, destino, mensagem) {
  if (!cfg.url || !cfg.key || !cfg.instancia) {
    throw new Error('Evolution não configurada (falta NATALY_WA_URL, NATALY_WA_KEY ou NATALY_WA_INSTANCIA)');
  }
  if (!destino) throw new Error('sem destino (defina NATALY_WA_DESTINO)');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(cfg.url + '/message/sendText/' + encodeURIComponent(cfg.instancia), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.key },
      body: JSON.stringify({ number: destino, text: mensagem }),
      signal: ctrl.signal,
    });
    const corpo = await res.text();
    if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + corpo.slice(0, 300));
    return corpo.slice(0, 500);
  } finally { clearTimeout(t); }
}

/* Driver de desenvolvimento: escreve no console e dá por enviado.
   É o PADRÃO — assim o site funciona inteiro sem nada conectado ao WhatsApp. */
async function enviaLog(cfg, destino, mensagem) {
  console.log('\n[funil/aviso] (driver=log, NADA foi enviado ao WhatsApp)');
  console.log('  destino: ' + (destino || '(não configurado)'));
  console.log('  ' + mensagem.split('\n').join('\n  ') + '\n');
  return 'driver=log';
}

async function despacha(cfg, destino, mensagem) {
  if (cfg.driver === 'evolution') return enviaEvolution(cfg, destino, mensagem);
  return enviaLog(cfg, destino, mensagem);
}

/* ---------- processa a fila ---------- */
async function processaFila(limite = 10) {
  const cfg = CFG();
  const pend = await db.consulta(
    "SELECT * FROM avisos WHERE status = 'pendente' AND proxima_em <= now() " +
    'ORDER BY criado_em ASC LIMIT ' + parseInt(limite, 10));

  let enviados = 0, erros = 0;
  for (const a of pend.rows) {
    const destino = a.destino || cfg.destino;
    try {
      await despacha(cfg, destino, a.mensagem);
      await db.consulta(
        "UPDATE avisos SET status='enviado', enviado_em=now(), atualizado_em=now(), " +
        'tentativas = tentativas + 1, ultimo_erro = NULL, destino = $2 WHERE id = $1',
        [a.id, destino || null]);
      enviados++;
    } catch (e) {
      const n = a.tentativas + 1;
      const desistiu = n >= MAX_TENTATIVAS;
      const espera = ESPERAS_MIN[Math.min(n, ESPERAS_MIN.length - 1)];
      await db.consulta(
        'UPDATE avisos SET status = $2, tentativas = $3, ultimo_erro = $4, ' +
        "atualizado_em = now(), proxima_em = now() + ($5 || ' minutes')::interval WHERE id = $1",
        [a.id, desistiu ? 'falhou' : 'pendente', n, String(e.message).slice(0, 500), String(espera)]);
      erros++;
      console.error('[funil/aviso] tentativa ' + n + ' falhou (aviso ' + a.id + '): ' + e.message);
    }
  }
  return { enviados, erros, vistos: pend.rows.length };
}

/* ---------- reenvio manual, a partir do painel ---------- */
async function reenfileira(avisoId) {
  const r = await db.consulta(
    "UPDATE avisos SET status='pendente', tentativas=0, proxima_em=now(), " +
    'ultimo_erro=NULL, atualizado_em=now() WHERE id = $1 RETURNING *', [avisoId]);
  return r.rows[0] || null;
}

/* ---------- worker ---------- */
let _timer = null;
function iniciaWorker(intervaloMs = 60000) {
  if (_timer) return;
  const rodada = () => processaFila().catch((e) =>
    console.error('[funil/aviso] worker: ' + e.message));
  _timer = setInterval(rodada, intervaloMs);
  if (_timer.unref) _timer.unref();   // não segura o processo aberto
  console.log('[funil/aviso] worker de reenvio a cada ' + Math.round(intervaloMs / 1000) + 's ' +
              '(driver=' + CFG().driver + ')');
}
function paraWorker() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = {
  CFG, PREFIXO_TESTE, montaMensagem, enfileira, processaFila,
  reenfileira, iniciaWorker, paraWorker, MAX_TENTATIVAS,
};

/* Monta a mensagem consolidada dos leads a partir do que ESTÁ no banco de
   produção (nada digitado à mão), e só envia se a instância estiver `open`.
   Uso: node monta-mensagem.js            → só monta e imprime
        node monta-mensagem.js --enviar   → monta e tenta enviar */
'use strict';
const https = require('https');
const fs = require('fs');

const IDS_REAIS = [143, 182, 183, 185, 203, 211];   // os testes ficam de fora
const BASE = 'https://natalyribeiro.com.br';
const WAURL = process.env.WAURL;
const WAKEY = process.env.WAKEY;
const GRUPO = '120363412975098009@g.us';

function pede(url, opts, corpo) {
  return new Promise((res, rej) => {
    const d = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
    const o = Object.assign({ method: 'GET', headers: {} }, opts);
    if (d) { o.headers['Content-Type'] = 'application/json'; o.headers['Content-Length'] = d.length; }
    const r = https.request(url, o, (resp) => {
      let t = '';
      resp.on('data', (c) => { t += c; });
      resp.on('end', () => {
        let j = null; try { j = JSON.parse(t); } catch (e) {}
        res({ http: resp.statusCode, j, texto: t, cookie: (resp.headers['set-cookie'] || [])[0] });
      });
    });
    r.on('error', rej); if (d) r.write(d); r.end();
  });
}

const tel = (e164) => {
  const x = String(e164 || '').replace(/^55/, '');
  return x.length === 11 ? '(' + x.slice(0, 2) + ') ' + x.slice(2, 7) + '-' + x.slice(7)
       : x.length === 10 ? '(' + x.slice(0, 2) + ') ' + x.slice(2, 6) + '-' + x.slice(6) : e164;
};
const quando = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  const br = new Date(d.getTime() - 3 * 3600 * 1000);   // Brasília
  return p(br.getUTCDate()) + '/' + p(br.getUTCMonth() + 1) + ', ' +
         p(br.getUTCHours()) + 'h' + p(br.getUTCMinutes());
};

/* O que ela quer aprender, dito só com o que ELA declarou. Nada inferido:
   o campo `interesse` só passou a existir hoje, então para estas seis a
   resposta honesta vem da situação e do objetivo que ela escreveu. */
function oQueQuer(l) {
  const s = {
    'ja-lash': 'Já trabalha com cílios',
    'area-beleza': 'Já é da área da beleza, mas ainda não trabalha com cílios',
    'outra-area': 'Vem de outra área e quer começar do zero',
  }[l.situacao];
  const b = { 'tecnica-led': 'Quer aprender a técnica com LED',
              'aperfeicoar-cilios': 'Quer se aperfeiçoar na extensão',
              'nao-sei': 'Ainda está decidindo o caminho' }[l.busca];
  if (!s && !b) return 'Não chegou a responder o que quer aprender.';
  return [s, b].filter(Boolean).join('. ') + '.';
}

function passo(l) {
  if (l.completo) return '✅ *Terminou o formulário inteiro.*';
  const ROT = {
    '1': 'no nome', '2': 'na cidade', '3': 'no WhatsApp', '4': 'na pergunta do Instagram',
    '5': 'na situação dela hoje', '5.5': 'no que está buscando',
    '6': 'na meta de renda', '7': 'no objetivo', '8': 'na pergunta sobre vir a Cambuí',
    '9': 'em como prefere aprender', '10': 'na pergunta do investimento',
    rec: 'na última tela, sem enviar — e naquela versão essa tela mostrava o preço',
  }[String(l.ultima_etapa)];
  return '⏸️ Parou ' + (ROT || 'no meio do formulário') + '.';
}

function contexto(l) {
  const p = [];
  if (l.disponibilidade === 'sim') p.push('disse que consegue vir a Cambuí');
  if (l.disponibilidade === 'talvez') p.push('acha que consegue vir a Cambuí, quer conversar');
  if (l.disponibilidade === 'nao') p.push('não consegue vir a Cambuí');
  if (l.prefere_formato === 'presencial') p.push('prefere aprender ao vivo');
  if (l.prefere_formato === 'online') p.push('prefere estudar no próprio ritmo');
  if (l.quando_comecar === 'agora') p.push('quer começar agora');
  if (l.quando_comecar === '30-dias') p.push('quer começar em até 30 dias');
  if (l.quando_comecar === 'so-olhando') p.push('marcou que está só pesquisando');
  return p.length ? p.join(', ') + '.' : null;
}

async function principal() {
  /* ---- puxa do banco de produção ---- */
  const conta = process.env.CRM_USER, senha = process.env.CRM_PASS;
  const login = await pede(BASE + '/crm/entrar', { method: 'POST' }, { usuario: conta, senha });
  if (!(login.j && login.j.ok)) throw new Error('não consegui entrar no painel: ' + login.texto);

  const leads = [];
  for (const id of IDS_REAIS) {
    const r = await pede(BASE + '/crm/api/lead/' + id, { headers: { Cookie: login.cookie } });
    if (!(r.j && r.j.lead)) throw new Error('lead ' + id + ' não veio: ' + r.texto.slice(0, 120));
    leads.push(r.j.lead);
  }
  leads.sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));

  /* ---- monta ---- */
  /* 🔴 O INTERVALO SAI DOS DADOS, e não de um número digitado aqui.
     Os carimbos do banco são UTC (voltam com 'Z'): imprimir sem converter
     jogaria a Karina do dia 03 para o dia 04 e faria a Nataly procurar no dia
     errado. Toda hora desta mensagem é de Brasília. */
  const dia = (iso) => quando(iso).split(',')[0];
  const de = dia(leads[0].criado_em), ate = dia(leads[leads.length - 1].criado_em);

  const L = [];
  L.push('📋 *RESUMO DE LEADS — ' + (de === ate ? de : de + ' a ' + ate) + '*');
  L.push('');
  L.push('Nataly, isto é um resumo consolidado de quem preencheu o formulário. ' +
         'Não são leads novos chegando todos de uma vez agora.');
  L.push('');
  L.push('O aparelho pareado do WhatsApp da automação caiu em 04/09, às 12h23, e ' +
         'desde então nenhum aviso saiu daqui. Estou reenviando a lista inteira ' +
         'para garantir que nenhum nome se perdeu no meio.');
  L.push('');
  L.push('São ' + leads.length + ' pessoas, em ordem de chegada:');

  leads.forEach((l, i) => {
    L.push('');
    L.push('━━━━━━━━━━━━━━━');
    L.push('*' + (i + 1) + '. ' + l.nome + '* — ' + quando(l.criado_em));
    L.push('📱 ' + tel(l.telefone));
    if (l.instagram) L.push('📷 instagram.com/' + l.instagram);
    const cid = [l.cidade, l.estado].filter(Boolean).join(', ');
    /* A cidade só entra se for cidade: uma delas digitou "41" no campo, e
       imprimir isso como endereço faria a mensagem parecer defeito. */
    if (cid && !/^\d+$/.test(String(l.cidade).trim())) L.push('📍 ' + cid);
    L.push('');
    L.push(oQueQuer(l));
    const c = contexto(l);
    if (c) L.push(c.charAt(0).toUpperCase() + c.slice(1));
    if (l.objetivo && l.objetivo.trim().length > 3) {
      L.push('💬 _"' + l.objetivo.trim().slice(0, 300) + '"_');
    }
    L.push(passo(l));
  });

  L.push('');
  L.push('━━━━━━━━━━━━━━━');
  L.push('⚠️ *O que mudou no formulário hoje*');
  L.push('');
  L.push('Quatro destas seis responderam tudo e pararam exatamente na tela que ' +
         'mostrava o curso e o preço. Era isso que estava derrubando.');
  L.push('');
  L.push('O formulário parou de mostrar preço, curso e checkout. Agora ele só ' +
         'coleta os dados e pergunta o que a pessoa quer aprender — se quer se ' +
         'tornar lash designer ou aprender a técnica com LED. Quem escolhe o que ' +
         'oferecer, e por quanto, é você, na conversa.');
  L.push('');
  L.push('📌 A página promete contato *em até 24 horas*, de segunda a sábado. ' +
         'Quem preencher agora já espera esse retorno.');

  const msg = L.join('\n');
  fs.writeFileSync('/tmp/mensagem-nataly.txt', msg);

  /* ---- caça ao codinome interno, antes de qualquer envio ---- */
  const proibido = msg.match(/Atelier|S[áa]lvia/i);
  if (proibido) throw new Error('🔴 codinome interno na mensagem: ' + proibido[0]);

  console.log('─'.repeat(60));
  console.log(msg);
  console.log('─'.repeat(60));
  console.log('caracteres:', msg.length, '· leads:', leads.length);
  console.log('passada final: nenhum "Atelier"/"Sálvia" ✅');

  if (process.argv.indexOf('--enviar') === -1) {
    console.log('\n(modo montagem — nada enviado. Use --enviar)');
    return;
  }

  /* ---- só envia com a conexão VIVA, e confere pelo RETORNO ---- */
  const est = await pede(WAURL + '/instance/connectionState/nataly', { headers: { apikey: WAKEY } });
  const estado = est.j && est.j.instance && est.j.instance.state;
  console.log('\nestado da instância:', estado);
  if (estado !== 'open') {
    console.log('🔴 NÃO ENVIEI: a instância não está `open`. Pareamento pendente.');
    process.exit(2);
  }

  const env = await pede(WAURL + '/message/sendText/nataly',
    { method: 'POST', headers: { apikey: WAKEY } },
    { number: GRUPO, text: msg });
  console.log('resposta da API:', JSON.stringify(env.j).slice(0, 400));
  /* Conferido pelo CONTEÚDO do retorno, nunca pelo código de status. */
  const idMsg = env.j && env.j.key && env.j.key.id;
  const st = env.j && env.j.status;
  if (!idMsg) { console.log('🔴 ENVIO NÃO CONFIRMADO: a API não devolveu id de mensagem.'); process.exit(1); }
  console.log('✅ ENVIADO — id da mensagem: ' + idMsg + ' · status: ' + st);
}

principal().catch((e) => { console.error('🔴 estourou:', (e && e.message) || e); process.exit(1); });

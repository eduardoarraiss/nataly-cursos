/* ============================================================
   LEADS — validação, normalização, qualificação e persistência
   ============================================================
   Regra que manda em tudo: o lead é GRAVADO primeiro. O aviso de
   WhatsApp é consequência, nunca condição. Se o WhatsApp cair, a
   pessoa que preencheu continua no banco.
   ============================================================ */
const db = require('./db');

/* ---------- vocabulário fechado ----------
   Campo de escolha nunca aceita texto livre do cliente: se chegar algo
   fora da lista, é erro de validação e não linha suja no banco. */
const OPCOES = {
  situacao:        ['ja-lash', 'area-beleza', 'outra-area'],
  disponibilidade: ['sim', 'talvez', 'nao'],
  aceita_valor:    ['sim', 'preciso-parcelar', 'nao'],
  quando_comecar:  ['agora', '30-dias', '90-dias', 'so-olhando'],
  faixa_idade:     ['18-24', '25-34', '35-44', '45+'],
  meta_renda:      ['ate-2k', '2k-5k', '5k-10k', 'mais-10k', 'nao-sei'],
};

const STATUS = ['novo', 'contatado', 'em-conversa', 'proposta-enviada', 'ganho', 'perdido'];

/* ---------- normalizações ---------- */

function texto(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, max);
}

/* Telefone brasileiro -> só dígitos, com DDI 55 na frente.
   Aceita o que a máscara do formulário produz e também o que a pessoa
   colar de qualquer jeito. Devolve null se não for um número plausível. */
function normalizaTelefone(v) {
  if (!v) return null;
  let d = String(v).replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);   // já veio com DDI
  if (d.length === 11 && d[2] === '9') { /* celular com nono dígito */ }
  else if (d.length === 10) { /* fixo ou celular antigo */ }
  else return null;
  const ddd = parseInt(d.slice(0, 2), 10);
  if (!(ddd >= 11 && ddd <= 99)) return null;               // DDD inexistente
  return '55' + d;
}

function formataTelefone(e164) {
  if (!e164) return '';
  const d = e164.replace(/^55/, '');
  if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return e164;
}

/* Instagram: aceita "@nome", "nome", ou a URL inteira colada do navegador. */
function normalizaInstagram(v) {
  if (!v) return null;
  let s = String(v).trim().toLowerCase();
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//, '');
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  s = s.replace(/^@+/, '').trim();
  if (!/^[a-z0-9._]{1,30}$/.test(s)) return null;
  return s;
}

function normalizaEmail(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return null;
  return s.slice(0, 160);
}

function opcao(campo, v) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return OPCOES[campo].includes(s) ? s : null;
}

/* ---------- qualificação ----------
   Pontuação declarada, não adivinhada: só usa o que a pessoa respondeu.
   O peso maior é da disponibilidade porque a aula é presencial em Cambuí —
   quem não pode vir não compra, por mais quente que esteja em tudo o mais. */
function qualifica(l) {
  let p = 0;
  p += ({ sim: 40, talvez: 15, nao: 0 })[l.disponibilidade] || 0;
  p += ({ sim: 30, 'preciso-parcelar': 20, nao: 0 })[l.aceita_valor] || 0;
  p += ({ 'ja-lash': 10, 'area-beleza': 10, 'outra-area': 5 })[l.situacao] || 0;
  p += ({ agora: 20, '30-dias': 12, '90-dias': 5, 'so-olhando': 0 })[l.quando_comecar] || 0;

  // Trava dura: sem poder vir a Cambuí, ou sem aceitar o valor, o lead não é
  // quente — nem que pontue alto no resto. Comprar seria impossível.
  let nivel;
  if (l.disponibilidade === 'nao' || l.aceita_valor === 'nao') nivel = 'frio';
  else if (p >= 70) nivel = 'quente';
  else if (p >= 40) nivel = 'morno';
  else nivel = 'frio';

  return { pontuacao: p, qualificacao: nivel };
}

/* ---------- validação do corpo recebido ---------- */
function valida(body) {
  const erros = {};
  const l = {};

  l.nome = texto(body.nome, 120);
  if (!l.nome || l.nome.length < 2) erros.nome = 'Escreva o seu nome completo.';

  l.telefone = normalizaTelefone(body.telefone);
  if (!l.telefone) erros.telefone = 'Confira o WhatsApp: precisa ter DDD e número, como (35) 99716-4668.';
  l.telefone_exibicao = texto(body.telefone, 40);

  l.cidade = texto(body.cidade, 80);
  if (!l.cidade || l.cidade.length < 2) erros.cidade = 'Diga em qual cidade você mora.';

  l.instagram = normalizaInstagram(body.instagram);
  if (!l.instagram) erros.instagram = 'Coloque só o seu @ do Instagram, sem espaço.';

  l.disponibilidade = opcao('disponibilidade', body.disponibilidade);
  if (!l.disponibilidade) erros.disponibilidade = 'Escolha uma das opções.';

  l.aceita_valor = opcao('aceita_valor', body.aceita_valor);
  if (!l.aceita_valor) erros.aceita_valor = 'Escolha uma das opções.';

  // opcionais — inválido vira null, não vira erro que trava o envio
  l.estado = texto(body.estado, 2);
  if (l.estado) l.estado = l.estado.toUpperCase();
  l.email = normalizaEmail(body.email);
  l.faixa_idade = opcao('faixa_idade', body.faixa_idade);
  l.situacao = opcao('situacao', body.situacao);
  l.meta_renda = opcao('meta_renda', body.meta_renda);
  l.quando_comecar = opcao('quando_comecar', body.quando_comecar);
  l.objetivo = texto(body.objetivo, 1000);

  return { erros, lead: l, ok: Object.keys(erros).length === 0 };
}

/* ---------- atribuição ----------
   Vem do cliente, então é dado sujo por definição: tudo cortado no tamanho
   e nada usado em decisão de segurança. Serve para saber de qual anúncio veio. */
function atribuicao(body, req) {
  const a = body.atribuicao || {};
  const t = (v, n) => texto(v, n);
  return {
    utm_source:   t(a.utm_source, 120),
    utm_medium:   t(a.utm_medium, 120),
    utm_campaign: t(a.utm_campaign, 200),
    utm_content:  t(a.utm_content, 200),
    utm_term:     t(a.utm_term, 200),
    fbclid:       t(a.fbclid, 255),
    gclid:        t(a.gclid, 255),
    referrer:     t(a.referrer, 500),
    pagina:       t(a.pagina, 200),
    user_agent:   t(req.headers['user-agent'], 400),
    ip:           ipDe(req),
  };
}

function ipDe(req) {
  const xf = req.headers['x-forwarded-for'];
  const ip = (xf ? String(xf).split(',')[0] : '') || req.socket?.remoteAddress || '';
  return ip.trim().replace(/^::ffff:/, '').slice(0, 45) || null;
}

/* ---------- gravação ---------- */
const CAMPOS = [
  'nome', 'telefone', 'telefone_exibicao', 'email', 'instagram', 'cidade', 'estado',
  'faixa_idade', 'situacao', 'meta_renda', 'objetivo', 'disponibilidade', 'aceita_valor',
  'quando_comecar', 'pontuacao', 'qualificacao', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_content', 'utm_term', 'fbclid', 'gclid', 'referrer', 'pagina', 'user_agent', 'ip',
  'lead_uid',
];

async function cria(dados) {
  const vals = CAMPOS.map((c) => (dados[c] === undefined ? null : dados[c]));
  const ph = CAMPOS.map((_, i) => '$' + (i + 1)).join(', ');

  // ON CONFLICT no lead_uid: se a pessoa apertar o botão duas vezes (ou a rede
  // reenviar), volta o lead que já existe em vez de criar um gêmeo.
  const sql =
    'INSERT INTO leads (' + CAMPOS.join(', ') + ') VALUES (' + ph + ') ' +
    'ON CONFLICT (lead_uid) DO UPDATE SET atualizado_em = now() ' +
    'RETURNING *, (xmax = 0) AS novo';

  const r = await db.consulta(sql, vals);
  return r.rows[0];
}

async function porId(id) {
  const r = await db.consulta('SELECT * FROM leads WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function historico(id) {
  const r = await db.consulta(
    'SELECT * FROM leads_historico WHERE lead_id = $1 ORDER BY criado_em ASC', [id]);
  return r.rows;
}

async function avisosDo(id) {
  const r = await db.consulta(
    'SELECT * FROM avisos WHERE lead_id = $1 ORDER BY criado_em DESC', [id]);
  return r.rows;
}

/* Muda o status e registra no histórico, na mesma chamada. Nunca se muda
   status sem deixar rastro — é o que permite auditar o funil depois. */
async function mudaStatus(id, novo, anotacao, autor) {
  if (!STATUS.includes(novo)) throw new Error('status inválido: ' + novo);
  const atual = await porId(id);
  if (!atual) return null;

  const nota = texto(anotacao, 2000);
  const r = nota
    ? await db.consulta(
        'UPDATE leads SET status = $1, anotacao = $2, atualizado_em = now() ' +
        'WHERE id = $3 RETURNING *', [novo, nota, id])
    : await db.consulta(
        'UPDATE leads SET status = $1, atualizado_em = now() ' +
        'WHERE id = $2 RETURNING *', [novo, id]);

  await db.consulta(
    'INSERT INTO leads_historico (lead_id, de_status, para_status, anotacao, autor) ' +
    'VALUES ($1,$2,$3,$4,$5)',
    [id, atual.status, novo, nota, texto(autor, 80)]);

  return r.rows[0];
}

/* ---------- listagem com filtros ---------- */
async function lista(f = {}) {
  const cond = [];
  const p = [];
  const add = (sql, v) => { p.push(v); cond.push(sql.replace('?', '$' + p.length)); };

  if (f.status && STATUS.includes(f.status)) add('status = ?', f.status);
  if (f.qualificacao && ['quente', 'morno', 'frio'].includes(f.qualificacao))
    add('qualificacao = ?', f.qualificacao);
  if (f.cidade)      add('LOWER(cidade) LIKE ?', '%' + String(f.cidade).toLowerCase() + '%');
  if (f.utm_content) add('utm_content = ?', f.utm_content);
  if (f.utm_campaign) add('utm_campaign = ?', f.utm_campaign);
  if (f.busca) {
    p.push('%' + String(f.busca).toLowerCase() + '%');
    cond.push('(LOWER(nome) LIKE $' + p.length + ' OR telefone LIKE $' + p.length +
              ' OR LOWER(instagram) LIKE $' + p.length + ')');
  }

  const where = cond.length ? ' WHERE ' + cond.join(' AND ') : '';
  const limite = Math.min(parseInt(f.limite, 10) || 500, 2000);

  const r = await db.consulta(
    'SELECT * FROM leads' + where + ' ORDER BY criado_em DESC LIMIT ' + limite, p);
  return r.rows;
}

/* ---------- números do topo do painel ---------- */
async function resumo() {
  const [total, porStatus, porQualif, porAnuncio, avisosFalhos] = await Promise.all([
    db.consulta('SELECT COUNT(*)::int AS n FROM leads'),
    db.consulta('SELECT status, COUNT(*)::int AS n FROM leads GROUP BY status'),
    db.consulta('SELECT qualificacao, COUNT(*)::int AS n FROM leads GROUP BY qualificacao'),
    db.consulta('SELECT COALESCE(utm_content, referrer, \'(sem origem)\') AS origem, ' +
                'COUNT(*)::int AS n FROM leads GROUP BY 1 ORDER BY n DESC LIMIT 20'),
    db.consulta("SELECT COUNT(*)::int AS n FROM avisos WHERE status <> 'enviado'"),
  ]);
  return {
    total: total.rows[0].n,
    porStatus: porStatus.rows,
    porQualif: porQualif.rows,
    porAnuncio: porAnuncio.rows,
    avisosFalhos: avisosFalhos.rows[0].n,
  };
}

/* ---------- avisos que não saíram ---------- */
async function avisosProblema() {
  const r = await db.consulta(
    "SELECT a.*, l.nome, l.telefone FROM avisos a JOIN leads l ON l.id = a.lead_id " +
    "WHERE a.status <> 'enviado' ORDER BY a.criado_em DESC LIMIT 200");
  return r.rows;
}

module.exports = {
  OPCOES, STATUS,
  valida, atribuicao, qualifica, ipDe,
  normalizaTelefone, formataTelefone, normalizaInstagram, normalizaEmail,
  cria, porId, historico, avisosDo, mudaStatus, lista, resumo, avisosProblema,
};

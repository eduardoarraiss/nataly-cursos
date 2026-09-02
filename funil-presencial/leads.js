/* ============================================================
   LEADS — validação, normalização, qualificação e persistência
   ============================================================
   Regra que manda em tudo: o lead é GRAVADO primeiro. O aviso de
   WhatsApp é consequência, nunca condição. Se o WhatsApp cair, a
   pessoa que preencheu continua no banco.
   ============================================================ */
const db = require('./db');
const PRD = require('./produtos');

/* ---------- vocabulário fechado ----------
   Campo de escolha nunca aceita texto livre do cliente: se chegar algo
   fora da lista, é erro de validação e não linha suja no banco. */
const OPCOES = {
  situacao:        ['ja-lash', 'area-beleza', 'outra-area'],
  /* só aparece para quem já trabalha com cílios */
  busca:           PRD.OPCOES_ARVORE.busca,
  disponibilidade: ['sim', 'talvez', 'nao'],
  prefere_formato: PRD.OPCOES_ARVORE.prefere_formato,
  faixa_investimento: PRD.OPCOES_ARVORE.faixa_investimento,
  /* DERIVADO da faixa, nunca mais vindo do formulário — ver deriveAceitaValor().
     Continua no vocabulário porque a coluna existe, o CSV exporta e o painel lê. */
  aceita_valor:    ['sim', 'preciso-parcelar', 'nao'],
  quando_comecar:  ['agora', '30-dias', '90-dias', 'so-olhando'],
  faixa_idade:     ['18-24', '25-34', '35-44', '45+'],
  meta_renda:      ['ate-2k', '2k-5k', '5k-10k', 'mais-10k', 'nao-sei'],
};

/* Os ids válidos de produto. Fecha o filtro do painel do mesmo jeito que
   OPCOES fecha os campos do formulário: nada de string livre no WHERE. */
const PRODUTO_IDS = Object.keys(PRD.PRODUTOS());

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

/* ---------- a faixa vira `aceita_valor` ----------
   A nona pergunta antiga ("você aceita R$ 1.497?") morreu junto com o produto
   único: com quatro preços ela mentiria para três quartos das pessoas. No
   lugar entrou a FAIXA DE INVESTIMENTO, perguntada sem revelar preço nenhum.

   `aceita_valor` continua existindo, mas agora é DERIVADO — e é derivado da
   comparação com o produto que a árvore recomendou, não de um número fixo.
   Por construção a árvore nunca recomenda acima da faixa marcada, então
   'nao' só aparece se alguém adulterar o envio. */
function deriveAceitaValor(faixa, produto) {
  if (faixa === 'depende-parcelamento') return 'preciso-parcelar';
  if (!produto) return 'sim';
  return PRD.cabeNaFaixa(produto, faixa) ? 'sim' : 'nao';
}

/* ---------- qualificação ----------
   Pontuação declarada, não adivinhada: só usa o que a pessoa respondeu.

   ⚠️ MUDOU EM 01/09/2026, junto com a árvore. A trava antiga dizia que quem
   não podia vir a Cambuí nunca era quente — e era verdade quando existia UM
   produto, presencial. Com quatro produtos ela virou mentira cara: quem não
   pode vir agora recebe o online, que é uma venda perfeitamente boa. Manter a
   trava marcaria de FRIO justamente o lead que compra sem sair de casa.

   No lugar dela, a trava honesta é a que a própria pessoa declarou: quem diz
   que está SÓ PESQUISANDO não é lead quente, por mais que pontue no resto. */
function qualifica(l, rec) {
  const presencial = rec && rec.formato === 'presencial';
  let p = 0;

  // 1. o prazo — é o que mais separa quem compra de quem olha
  p += ({ agora: 30, '30-dias': 20, '90-dias': 8, 'so-olhando': 0 })[l.quando_comecar] || 0;

  // 2. a situação — quem já atende decide mais rápido
  p += ({ 'ja-lash': 20, 'area-beleza': 15, 'outra-area': 10 })[l.situacao] || 0;

  // 3. o dinheiro, lido contra o produto recomendado (não contra um preço fixo)
  if (l.faixa_investimento === 'depende-parcelamento') p += 18;
  else if (presencial) p += 30;                       // a faixa alcançou a oferta cara
  else if (rec && rec.mencionaPresencial) p += 10;    // podia vir, mas a faixa travou
  else p += 22;                                       // online por distância ou escolha

  // 4. o encaixe do formato. Para produto online a distância deixou de ser
  //    obstáculo, então ela não pode pesar contra o lead.
  if (!presencial) p += 18;
  else p += ({ sim: 20, talvez: 12, nao: 0 })[l.disponibilidade] || 0;

  let nivel;
  if (l.quando_comecar === 'so-olhando') nivel = 'frio';
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

  /* Os três campos que ALIMENTAM A ÁRVORE viraram obrigatórios: sem eles não
     há recomendação, e uma recomendação chutada é pior que nenhuma.
     `aceita_valor` saiu daqui — hoje é derivado da faixa (deriveAceitaValor). */
  l.situacao = opcao('situacao', body.situacao);
  if (!l.situacao) erros.situacao = 'Escolha a opção que mais parece com você hoje.';

  l.prefere_formato = opcao('prefere_formato', body.prefere_formato);
  if (!l.prefere_formato) erros.prefere_formato = 'Me diz como você prefere aprender.';

  l.faixa_investimento = opcao('faixa_investimento', body.faixa_investimento);
  if (!l.faixa_investimento) erros.faixa_investimento = 'Escolha a faixa que cabe no seu momento.';

  /* A pergunta condicional: obrigatória SÓ para quem já trabalha com cílios.
     Quem não é lash nunca a vê, então exigi-la de todas travaria o envio de
     quem respondeu tudo o que lhe foi perguntado. E quem NÃO é lash mas manda
     o campo assim mesmo tem o valor descartado — a resposta não teria contexto. */
  if (l.situacao === 'ja-lash') {
    l.busca = opcao('busca', body.busca);
    if (!l.busca) erros.busca = 'Me diz o que você está buscando agora.';
  } else {
    l.busca = null;
  }

  // opcionais — inválido vira null, não vira erro que trava o envio
  l.estado = texto(body.estado, 2);
  if (l.estado) l.estado = l.estado.toUpperCase();
  l.email = normalizaEmail(body.email);
  l.faixa_idade = opcao('faixa_idade', body.faixa_idade);
  l.meta_renda = opcao('meta_renda', body.meta_renda);
  l.quando_comecar = opcao('quando_comecar', body.quando_comecar);
  l.objetivo = texto(body.objetivo, 1000);

  return { erros, lead: l, ok: Object.keys(erros).length === 0 };
}

/* ---------- roteamento ----------
   Roda a árvore e devolve, num objeto só, o que vai para o banco, o que vai
   para o WhatsApp e o que a tela final mostra. Chamado UMA vez, no servidor:
   o formulário nunca decide o produto sozinho, senão a tela e a linha do
   banco poderiam discordar. */
function roteia(l) {
  const rec = PRD.recomenda(l);
  const colunas = {
    produto_id:      rec.produto.id,
    produto_nome:    rec.produto.nome,
    produto_formato: rec.formato,
    produto_valor:   rec.produto.valor,
    recomendacao_motivos: rec.motivos.join('\n').slice(0, 2000),
    aceita_valor:    deriveAceitaValor(l.faixa_investimento, rec.produto),
  };
  return { rec, colunas };
}

/* O que a tela final precisa saber. Sai do servidor pronto: nenhum preço e
   nenhum checkout é escrito no HTML do formulário, então não existe jeito de
   ela ver o número de um produto que não é o dela. */
function paraTela(rec) {
  const p = rec.produto;
  return {
    id: p.id,
    nome: p.nome,
    nome_meta: p.nome_meta,
    formato: rec.formato,
    preco: p.preco,
    parcela: p.parcela,
    valor: p.valor,
    inclui: p.inclui,
    // Checkout SÓ no caminho online. No presencial a Nataly combina a data
    // antes de cobrar — mandar link aqui seria vender uma vaga sem data.
    checkout: rec.formato === 'online' ? 'https://pay.kiwify.com.br/' + p.checkout : null,
    porque: PRD.porQue(rec),
    // Ela pode vir e só o dinheiro travou: dizer que o presencial existe.
    presencial_possivel: rec.mencionaPresencial ? {
      nome: rec.presencialDaFamilia.nome,
      preco: rec.presencialDaFamilia.preco,
      parcela: rec.presencialDaFamilia.parcela,
    } : null,
    sugestao: rec.familiaIncerta,
  };
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
  'faixa_idade', 'situacao', 'busca', 'meta_renda', 'objetivo', 'disponibilidade',
  'prefere_formato', 'faixa_investimento', 'aceita_valor', 'quando_comecar',
  'produto_id', 'produto_nome', 'produto_formato', 'produto_valor', 'recomendacao_motivos',
  'pontuacao', 'qualificacao', 'utm_source', 'utm_medium', 'utm_campaign',
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

async function apaga(id) {
  /* `executar` NAO aceita parametros (so recebe SQL) — usar ela aqui deixava o
     $1 sem valor e a rota devolvia 503. O certo e `consulta`.
     E o rowCount de `consulta` vem do numero de linhas devolvidas, entao o
     DELETE precisa de RETURNING para dizer se apagou de fato. */
  await db.consulta('DELETE FROM avisos WHERE lead_id = $1', [id]);
  await db.consulta('DELETE FROM leads_historico WHERE lead_id = $1', [id]);
  const r = await db.consulta('DELETE FROM leads WHERE id = $1 RETURNING id', [id]);
  return r.rows.length > 0;
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
  if (f.produto_id && PRODUTO_IDS.includes(f.produto_id)) add('produto_id = ?', f.produto_id);
  if (f.produto_formato && ['online', 'presencial'].includes(f.produto_formato))
    add('produto_formato = ?', f.produto_formato);
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
  const [total, porStatus, porQualif, porProduto, porAnuncio, avisosFalhos] = await Promise.all([
    db.consulta('SELECT COUNT(*)::int AS n FROM leads'),
    db.consulta('SELECT status, COUNT(*)::int AS n FROM leads GROUP BY status'),
    db.consulta('SELECT qualificacao, COUNT(*)::int AS n FROM leads GROUP BY qualificacao'),
    db.consulta("SELECT COALESCE(produto_id, '(sem produto)') AS produto_id, " +
                'COUNT(*)::int AS n FROM leads GROUP BY 1 ORDER BY n DESC'),
    db.consulta('SELECT COALESCE(utm_content, referrer, \'(sem origem)\') AS origem, ' +
                'COUNT(*)::int AS n FROM leads GROUP BY 1 ORDER BY n DESC LIMIT 20'),
    db.consulta("SELECT COUNT(*)::int AS n FROM avisos WHERE status <> 'enviado'"),
  ]);
  return {
    total: total.rows[0].n,
    porStatus: porStatus.rows,
    porQualif: porQualif.rows,
    porProduto: porProduto.rows,
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

module.exports = { apaga,
  OPCOES, STATUS, PRODUTO_IDS,
  valida, atribuicao, qualifica, ipDe, roteia, paraTela, deriveAceitaValor,
  normalizaTelefone, formataTelefone, normalizaInstagram, normalizaEmail,
  cria, porId, historico, avisosDo, mudaStatus, lista, resumo, avisosProblema,
};

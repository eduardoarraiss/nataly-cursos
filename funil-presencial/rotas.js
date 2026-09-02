/* ============================================================
   ROTAS DO FUNIL — API do lead + painel /crm
   ============================================================
   Montado no server.js ANTES do express.static e do catch-all
   (que transforma 404 em 302 para "/"). Sem isso, um POST para
   /api/lead-presencial receberia um redirecionamento.
   ============================================================ */
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const L = require('./leads');
const N = require('./notificador');
const auth = require('./auth');

const router = express.Router();

/* Express 4 não captura rejeição de handler async: sem isto, um erro do banco
   viraria "unhandled rejection" — a requisição penduraria até o timeout e o
   processo poderia morrer, levando junto a PÁGINA DE VENDAS.

   Em vez de lembrar de embrulhar cada rota (e esquecer uma), o embrulho é
   aplicado no REGISTRO: qualquer handler async passado para router.get/post/
   all/use já sai protegido. Uma rota nova nasce coberta. */
const bem = (fn) =>
  (typeof fn === 'function' && fn.constructor && fn.constructor.name === 'AsyncFunction')
    ? function (req, res, next) { return Promise.resolve(fn(req, res, next)).catch(next); }
    : fn;

['get', 'post', 'put', 'delete', 'all', 'use'].forEach((metodo) => {
  const original = router[metodo].bind(router);
  router[metodo] = function (...args) {
    // o tratador de erro tem 4 parâmetros: esse não pode ser embrulhado,
    // senão o Express deixa de reconhecê-lo como tratador de erro.
    return original(...args.map((a) =>
      (typeof a === 'function' && a.length === 4) ? a : bem(a)));
  };
});

/* ---------- freio de spam no formulário público ----------
   Em memória, por IP. Não é defesa contra ataque distribuído — é para
   impedir que um script encha o WhatsApp da Nataly de lixo. */
const _janela = new Map();
const LIMITE_ENVIOS = 5;
const JANELA_MS = 10 * 60 * 1000;

function passouDoLimite(ip) {
  const agora = Date.now();
  const lista = (_janela.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  lista.push(agora);
  _janela.set(ip, lista);
  if (_janela.size > 5000) _janela.clear();   // teto de memória
  return lista.length > LIMITE_ENVIOS;
}

/* Cabeçalhos que valem para tudo que envolve dado pessoal. */
function semRastro(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
}

/* ============================================================
   1. API PÚBLICA — recebe o lead do formulário
   ============================================================ */
router.post('/api/lead-presencial', express.json({ limit: '32kb' }), async (req, res) => {
  semRastro(res);
  try {
    const body = req.body || {};

    // Armadilha para robô: campo escondido que humano nunca preenche.
    // Responde 200 de propósito — o robô acha que funcionou e não insiste.
    if (body.sobrenome_confirmacao) {
      console.log('[funil] envio de robô descartado (honeypot)');
      return res.json({ ok: true, dedupe: true });
    }

    const ip = L.ipDe(req);
    /* O freio de spam não pode barrar o GATE. `verificar-pv.sh local` exercita
       os sete caminhos da árvore de uma vez, e com o teto de 5 envios por IP
       ele bateria em 429 no meio — reportando falha na árvore quando o que
       falhou foi o próprio freio.
       A isenção é estreita de propósito: SÓ em desenvolvimento (sem
       DATABASE_URL, que produção sempre tem) e SÓ vinda do loopback. Em
       produção nada muda, nem para quem estiver na mesma máquina. */
    const ehDev = !process.env.DATABASE_URL;
    const local = ip === '127.0.0.1' || ip === '::1';
    if (!(ehDev && local) && passouDoLimite(ip)) {
      return res.status(429).json({
        ok: false, erro: 'limite',
        mensagem: 'Você já enviou o formulário. A Nataly vai te chamar no WhatsApp.',
      });
    }

    const { ok, erros, lead } = L.valida(body);
    if (!ok) return res.status(400).json({ ok: false, erros });

    /* A ÁRVORE RODA AQUI, no servidor, e em lugar nenhum mais.
       O formulário manda respostas e recebe o produto de volta — ele não
       calcula nada. Se a decisão fosse repetida no navegador, um dia as duas
       cópias divergiriam e a tela mostraria um produto e o banco gravaria
       outro. Uma fonte só, e a tela é consequência dela. */
    const { rec, colunas } = L.roteia(lead);
    Object.assign(lead, colunas);
    Object.assign(lead, L.qualifica(lead, rec), L.atribuicao(body, req));
    lead.lead_uid = String(body.lead_uid || '').slice(0, 80) || null;

    const recomendacao = L.paraTela(rec);

    // ---- GRAVA PRIMEIRO. Só depois pensa em avisar. ----
    const salvo = await L.cria(lead);

    /* Reenvio do mesmo formulário: não avisa a Nataly de novo — mas a
       recomendação VAI JUNTO. Sem ela, quem apertasse o botão duas vezes (ou
       tivesse a rede reenviando) cairia numa tela final sem produto, sem
       preço e sem checkout: o pior lugar possível para ficar. */
    if (salvo.novo === false) {
      return res.json({ ok: true, dedupe: true, qualificacao: salvo.qualificacao, recomendacao });
    }

    // ---- Aviso: enfileira e tenta. Falhar aqui NÃO derruba o lead. ----
    try {
      await N.enfileira(salvo);
      N.processaFila(3).catch((e) => console.error('[funil] fila:', e.message));
    } catch (e) {
      console.error('[funil] não consegui enfileirar o aviso (lead ' + salvo.id +
                    ' está salvo): ' + e.message);
    }

    res.json({ ok: true, qualificacao: salvo.qualificacao, recomendacao });
  } catch (e) {
    console.error('[funil] erro ao receber lead:', e);
    res.status(500).json({
      ok: false, erro: 'servidor',
      mensagem: 'Deu um problema aqui do nosso lado. Tenta de novo em instantes.',
    });
  }
});

/* Qualquer outra coisa em /api do funil devolve 404 em JSON.
   Sem isto, o catch-all do server.js devolveria a home com 302. */
router.all('/api/lead-presencial', (req, res) => {
  semRastro(res);
  res.status(405).json({ erro: 'metodo-nao-permitido' });
});

/* ============================================================
   2. PAINEL /crm
   ============================================================ */

/* Os cabeçalhos de privacidade valem para TUDO em /crm, inclusive para o
   redirecionamento de quem não tem sessão. Aplicados aqui, e não dentro de
   cada rota, porque o porteiro (auth.exige) responde ANTES do handler: um
   302 emitido por ele sairia sem noindex e sem no-store. */
router.use('/crm', (req, res, next) => { semRastro(res); next(); });

const _cache = {};
function pagina(nome) {
  if (!_cache[nome] || process.env.NODE_ENV !== 'production') {
    _cache[nome] = fs.readFileSync(path.join(__dirname, 'painel', nome), 'utf8');
  }
  return _cache[nome];
}

/* -- login -- */
router.get('/crm/entrar', (req, res) => {
  semRastro(res);
  if (!auth.configurado()) {
    return res.status(503).type('text/plain; charset=utf-8').send(
      'Painel não configurado. Defina CRM_SENHA (mínimo 12 caracteres) nas variáveis de ambiente.');
  }
  res.type('html').send(pagina('entrar.html'));
});

router.post('/crm/entrar', express.json({ limit: '4kb' }), async (req, res) => {
  semRastro(res);
  const { usuario, senha } = req.body || {};
  const r = await auth.tentaLogin(req, usuario, senha);
  if (!r.ok) {
    const msg = {
      'nao-configurado': 'O painel ainda não tem senha configurada no servidor.',
      bloqueado: 'Muitas tentativas erradas. Espere 15 minutos.',
      credenciais: 'Usuário ou senha incorretos.',
    }[r.motivo] || 'Não consegui entrar.';
    return res.status(r.motivo === 'bloqueado' ? 429 : 401).json({ ok: false, mensagem: msg });
  }
  auth.poeCookie(res, r.token);
  res.json({ ok: true });
});

router.post('/crm/sair', auth.exige({ api: true }), async (req, res) => {
  semRastro(res);
  await auth.encerraSessao(auth.leCookie(req, auth.COOKIE));
  auth.tiraCookie(res);
  res.json({ ok: true });
});

/* -- painel -- */
router.get('/crm', auth.exige(), (req, res) => {
  semRastro(res);
  res.type('html').send(pagina('crm.html'));
});

/* -- dados -- */
router.get('/crm/api/resumo', auth.exige({ api: true }), async (req, res) => {
  semRastro(res);
  res.json(await L.resumo());
});

router.get('/crm/api/leads', auth.exige({ api: true }), async (req, res) => {
  semRastro(res);
  res.json({ leads: await L.lista(req.query) });
});

router.get('/crm/api/lead/:id', auth.exige({ api: true }), async (req, res) => {
  semRastro(res);
  const id = parseInt(req.params.id, 10);
  const lead = await L.porId(id);
  if (!lead) return res.status(404).json({ erro: 'nao-encontrado' });
  res.json({ lead, historico: await L.historico(id), avisos: await L.avisosDo(id) });
});

router.post('/crm/api/lead/:id/status', auth.exige({ api: true }),
  express.json({ limit: '8kb' }), async (req, res) => {
    semRastro(res);
    const { status, anotacao } = req.body || {};
    if (!L.STATUS.includes(status)) return res.status(400).json({ erro: 'status-invalido' });
    try {
      const lead = await L.mudaStatus(parseInt(req.params.id, 10), status, anotacao, req.crm.usuario);
      if (!lead) return res.status(404).json({ erro: 'nao-encontrado' });
      res.json({ ok: true, lead });
    } catch (e) {
      res.status(400).json({ erro: e.message });
    }
  });

/* Apagar lead. Existe para limpar teste e para atender pedido de exclusao
   (LGPD) — a politica de privacidade promete exclusao em 15 dias.
   Apaga em cascata: avisos e historico saem junto, senao sobra dado pessoal
   orfao no banco, que e exatamente o que a promessa diz que nao acontece. */
router.delete('/crm/api/lead/:id', auth.exige({ api: true }), async (req, res) => {
  semRastro(res);
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ erro: 'id-invalido' });
  const apagado = await L.apaga(id);
  if (!apagado) return res.status(404).json({ erro: 'nao-encontrado' });
  res.json({ ok: true, id });
});

router.get('/crm/api/avisos', auth.exige({ api: true }), async (req, res) => {
  semRastro(res);
  res.json({ avisos: await L.avisosProblema(), driver: N.CFG().driver });
});

router.post('/crm/api/aviso/:id/reenviar', auth.exige({ api: true }), async (req, res) => {
  semRastro(res);
  const a = await N.reenfileira(parseInt(req.params.id, 10));
  if (!a) return res.status(404).json({ erro: 'nao-encontrado' });
  N.processaFila(3).catch(() => {});
  res.json({ ok: true });
});

/* -- exportação CSV -- */
const COLUNAS = [
  ['id', 'ID'], ['criado_em', 'Criado em'], ['nome', 'Nome'], ['telefone', 'WhatsApp'],
  ['email', 'E-mail'], ['instagram', 'Instagram'], ['cidade', 'Cidade'], ['estado', 'UF'],
  ['faixa_idade', 'Idade'], ['situacao', 'Situação'], ['busca', 'O que busca'],
  ['meta_renda', 'Meta de renda'],
  ['quando_comecar', 'Quando começar'], ['disponibilidade', 'Pode vir a Cambuí'],
  ['prefere_formato', 'Prefere'], ['faixa_investimento', 'Faixa de investimento'],
  ['aceita_valor', 'Aceita o valor'], ['objetivo', 'Objetivo'],
  ['produto_id', 'Produto indicado'], ['produto_nome', 'Produto (nome)'],
  ['produto_formato', 'Formato'], ['produto_valor', 'Valor indicado'],
  ['recomendacao_motivos', 'Por que foi indicado'],
  ['pontuacao', 'Pontuação'], ['qualificacao', 'Qualificação'], ['status', 'Status'],
  ['anotacao', 'Anotação'], ['utm_source', 'utm_source'], ['utm_medium', 'utm_medium'],
  ['utm_campaign', 'utm_campaign'], ['utm_content', 'utm_content'], ['utm_term', 'utm_term'],
  ['fbclid', 'fbclid'], ['referrer', 'Referrer'], ['pagina', 'Página'],
];

/* Escapa para CSV. O apóstrofo na frente de =,+,-,@ evita que o Excel
   interprete o conteúdo de um campo como fórmula (injeção de CSV). */
function celula(v) {
  if (v === null || v === undefined) return '';
  // Data em pt-BR, fuso de Brasília. Sem isto o Excel recebe
  // "Tue Sep 01 2026 ... GMT-0300" e não reconhece como data.
  if (v instanceof Date) {
    return '"' + v.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '"';
  }
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

router.get('/crm/exportar.csv', auth.exige(), async (req, res) => {
  semRastro(res);
  const leads = await L.lista(Object.assign({}, req.query, { limite: 5000 }));
  const linhas = [COLUNAS.map((c) => celula(c[1])).join(';')];
  for (const l of leads) linhas.push(COLUNAS.map((c) => celula(l[c[0]])).join(';'));
  const hoje = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="leads-presencial-' + hoje + '.csv"');
  // BOM: sem ele o Excel no Windows abre "Cambuí" como "CambuÃ­".
  res.send('﻿' + linhas.join('\r\n'));
});

/* ---------- rede de proteção ----------
   Qualquer erro que escape de um handler cai aqui. Sem isto, uma falha do
   banco vira exceção não tratada e pode derrubar o processo — e com ele a
   PÁGINA DE VENDAS inteira. O funil pode ficar indisponível; o site, não. */
router.use((err, req, res, next) => {
  console.error('[funil] erro não tratado em ' + req.method + ' ' + req.path + ':', err.message);
  if (res.headersSent) return next(err);
  semRastro(res);
  if (req.path.indexOf('/api/') !== -1) {
    return res.status(503).json({ ok: false, erro: 'indisponivel' });
  }
  res.status(503).type('text/plain; charset=utf-8')
     .send('O painel está temporariamente indisponível. Tente de novo em instantes.');
});

module.exports = router;

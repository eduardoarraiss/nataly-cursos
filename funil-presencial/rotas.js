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
/* 🔴 OS TETOS SUBIRAM E A JANELA VIROU DE UMA HORA em 02/09/2026, junto com o
   conserto do `ipDe` (ver `leads.js`). Enquanto o IP era o da borda da
   Cloudflare, cinco envios por dez minutos era um numero sem sentido: nao
   segurava script nenhum e, ao mesmo tempo, barrava mulher que nunca tinha
   enviado nada, porque a borda ja tinha sido gasta por outra pessoa. Medido.

   Com o IP REAL na mao, o teto passa a valer por visitante — e ai a conta
   inverte de lado. O erro caro aqui e barrar quem e de verdade: um lead
   perdido e verba de anuncio queimada, e um envio a mais de robo a Nataly
   ignora. Vinte por hora e folgado para NAT de operadora e wi-fi de salao, e
   continua apertado para script.

   E vale lembrar que a defesa contra DUPLICATA nao e esta: e o `lead_uid` com
   `ON CONFLICT`, que nao cria gemeo por mais que a pessoa aperte o botao. Este
   freio existe so para o flood. */
const LIMITE_ENVIOS = 20;
const JANELA_MS = 60 * 60 * 1000;

/* O parcial tem freio PRÓPRIO, e muito mais folgado, porque ele é chamado
   uma vez por etapa: um preenchimento honesto sozinho já gasta sete chamadas,
   e o teto de 5 do envio final barraria a segunda pessoa da mesma rede (dois
   celulares no wi-fi do salão saem pelo mesmo IP). O que este freio impede é o
   script que quer encher o banco — e para isso 80 por 10 minutos já é apertado.

   Vale lembrar por que o risco aqui é menor: o parcial NÃO manda mensagem no
   WhatsApp na hora. O pior que um flood consegue é escrever linha no banco,
   nunca tocar o celular da Nataly. */
const _janelaParcial = new Map();
/* Proporcional ao de cima: o parcial e chamado ~10 vezes por preenchimento,
   entao 20 inscricoes por hora pedem ~200 chamadas por hora. */
const LIMITE_PARCIAL = 200;

/* A recomendação tem freio próprio pelo mesmo motivo, ao contrário: ela é
   chamada UMA vez por preenchimento, mas NÃO pode gastar o orçamento do envio
   final. Se as duas dividissem o teto de 5, três pessoas do mesmo salão
   veriam a recomendação e a terceira levaria 429 na hora de CONFIRMAR — o
   429 mais caro que este funil consegue dar.
   Como ela também não toca o WhatsApp da Nataly na hora, 30 por 10 minutos é
   folgado para o wi-fi compartilhado e apertado para script. */
const _janelaRec = new Map();
/* Uma chamada por preenchimento; sessenta por hora deixa margem de sobra para
   quem volta e refaz, sem abrir a porta para script. */
const LIMITE_REC = 60;

function passouDoLimite(ip) {
  const agora = Date.now();
  const lista = (_janela.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  lista.push(agora);
  _janela.set(ip, lista);
  if (_janela.size > 5000) _janela.clear();   // teto de memória
  return lista.length > LIMITE_ENVIOS;
}

function passouDoLimiteParcial(ip) {
  const agora = Date.now();
  const lista = (_janelaParcial.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  lista.push(agora);
  _janelaParcial.set(ip, lista);
  if (_janelaParcial.size > 5000) _janelaParcial.clear();
  return lista.length > LIMITE_PARCIAL;
}

function passouDoLimiteRec(ip) {
  const agora = Date.now();
  const lista = (_janelaRec.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  lista.push(agora);
  _janelaRec.set(ip, lista);
  if (_janelaRec.size > 5000) _janelaRec.clear();
  return lista.length > LIMITE_REC;
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
    if (body.ref_c7 || body.sobrenome_confirmacao) {
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
        /* 🔴 ESTA MENSAGEM NAO PODE DIZER QUE ELA JA ENVIOU. Ela dizia
           "Você já enviou o formulário. A Nataly vai te chamar no WhatsApp." —
           e quem cai aqui NAO enviou nada: este ramo e SO o freio de flood. O
           envio repetido de verdade nem chega neste ponto, ele desce ate o
           `dedupe` e volta com a recomendacao e um `ok: true`.
           A frase antiga mandava a pessoa embora tranquila, achando que estava
           resolvido, e o lead se perdia em silencio — pago. */
        mensagem: 'Deu um problema aqui do nosso lado ao registrar o seu envio. ' +
                  'Tenta de novo em alguns instantes, por favor.',
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

/* ============================================================
   1a. API PÚBLICA — a RECOMENDAÇÃO, antes de ela confirmar (02/09/2026)
   ============================================================
   Pedido do Eduardo, nas palavras dele: "deveria ser apenas a de apresentar o
   melhor programa para a pessoa, dizer que é exclusivo e selecionamos poucas
   pessoas no caso do presencial, etc… E depois clicar em garantir vaga e dar
   a mensagem de form recebido".

   Até 02/09/2026 o fim das perguntas fazia TUDO de uma vez: gravava a
   inscrição, avisava a Nataly e disparava o `Lead`. A tela abria dizendo
   "recebi a sua inscrição" e só então mostrava o produto e o preço — ou seja,
   a pessoa era dada como inscrita ANTES de saber quanto custava e ANTES de
   dizer que queria.

   Agora são dois passos, e esta rota é o primeiro:

     · AQUI  — a árvore roda, a recomendação volta para a tela e a linha é
               gravada como INCOMPLETA, com o produto que ela viu. Sem aviso
               no WhatsApp e sem `Lead`.
     · DEPOIS — ela aperta "Quero garantir a minha vaga" e vai para
               /api/lead-presencial, que promove a linha a completa, avisa a
               Nataly e dispara o `Lead`.

   🔴 ESTA ROTA NÃO DISPARA NADA E NÃO AVISA NINGUÉM. É a diferença entre "viu
      o preço" e "quis". A campanha de R$ 120/dia otimiza pelo `Lead`: se ele
      saísse daqui, o algoritmo aprenderia a trazer quem só olha a vitrine, e
      a gente pagaria por isso todo dia.

   Por que ela valida COMPLETO (`L.valida`, e não `L.validaParcial`): a árvore
   precisa das respostas todas. Sem `disponibilidade`, `prefere_formato` e
   `faixa_investimento` não existe recomendação para dar — e devolver um
   produto chutado seria pior do que devolver erro. */
router.post('/api/recomendacao-presencial', express.json({ limit: '32kb' }), async (req, res) => {
  semRastro(res);
  try {
    const body = req.body || {};

    // Mesma armadilha de robô das outras rotas, mesma resposta mansa.
    if (body.ref_c7 || body.sobrenome_confirmacao) {
      /* 🔴 NÃO responder `ok:true` sem recomendação: a tela abre vazia, sem
         nome, sem preço e sem botão, e a pessoa fica olhando um cartão em
         branco sem nenhum aviso. Foi assim que o autopreenchimento do
         navegador — que escrevia na armadilha — virou tela morta em 02/09.
         Robô não lê mensagem de erro; gente lê. Então a resposta honesta é
         um erro, que o formulário sabe mostrar. */
      console.log('[funil] recomendação com honeypot preenchido — recusada');
      return res.status(400).json({
        ok: false, erro: 'honeypot',
        mensagem: 'Deu um problema aqui do nosso lado. Tenta de novo, por favor.',
      });
    }

    const ip = L.ipDe(req);
    /* Mesma isenção estreita das outras rotas: só em desenvolvimento e só do
       loopback, para o gate poder exercitar os sete caminhos da árvore sem
       bater no freio e reportar falha na árvore quando o que falhou foi o
       próprio freio. */
    const ehDev = !process.env.DATABASE_URL;
    const local = ip === '127.0.0.1' || ip === '::1';
    if (!(ehDev && local) && passouDoLimiteRec(ip)) {
      return res.status(429).json({
        ok: false, erro: 'limite',
        /* Mesma correcao da rota de envio: quem cai aqui e o freio, nao a
           repeticao. Dizer que ela ja respondeu seria mentir e faze-la sair. */
        mensagem: 'Deu um problema aqui do nosso lado. ' +
                  'Tenta de novo em alguns instantes, por favor.',
      });
    }

    const { ok, erros, lead } = L.valida(body);
    if (!ok) return res.status(400).json({ ok: false, erros });

    /* A ÁRVORE RODA AQUI, no servidor, exatamente como rodava no envio final —
       mesma função, mesma fonte. O formulário continua sem decidir nada. */
    const { rec, colunas } = L.roteia(lead);
    Object.assign(lead, colunas);
    Object.assign(lead, L.qualifica(lead, rec), L.atribuicao(body, req));
    lead.lead_uid = String(body.lead_uid || '').slice(0, 80) || null;

    const recomendacao = L.paraTela(rec);

    /* Sem uid não dá para promover esta linha a inscrição depois: o clique no
       botão criaria um lead novo e a Nataly veria a mesma pessoa duas vezes.
       A recomendação vai para a tela assim mesmo — ela não pode ficar sem
       resposta por um detalhe nosso —, mas nada é gravado. */
    if (!lead.lead_uid) {
      return res.json({ ok: true, gravado: false, motivo: 'sem-uid', recomendacao });
    }

    /* Grava como INCOMPLETA, com o produto. Falhar aqui NÃO pode derrubar a
       tela: ela respondeu onze perguntas e tem direito de ver o resultado.
       O que se perde é o registro comercial, e isso a gente loga. */
    let gravado = false;
    try {
      gravado = !!(await L.criaRecomendacao(lead));
    } catch (e) {
      console.error('[funil] erro ao gravar a recomendação:', e.message);
    }

    return res.json({ ok: true, gravado, recomendacao });
  } catch (e) {
    console.error('[funil] erro ao montar a recomendação:', e);
    res.status(500).json({
      ok: false, erro: 'servidor',
      mensagem: 'Deu um problema aqui do nosso lado. Tenta de novo em instantes.',
    });
  }
});

router.all('/api/recomendacao-presencial', (req, res) => {
  semRastro(res);
  res.status(405).json({ erro: 'metodo-nao-permitido' });
});

/* ============================================================
   1b. API PÚBLICA — o lead PARCIAL (02/09/2026)
   ============================================================
   Pedido do Eduardo, nas palavras dele: "se certifique do forms captar o
   lead, independente de ele finalizar o preenchimento ou não. Às vezes a
   pessoa se assusta com o preço, e o comercial pode converter".

   Rota SEPARADA da do envio final, e não um parâmetro na mesma, porque as
   duas têm regras opostas em tudo o que importa:

     | | envio final | parcial |
     |validação| trava se faltar campo | nunca trava |
     |árvore| roda | não roda (faltam respostas) |
     |aviso| na hora | uma vez, depois de 20 min parada |
     |freio| 5 / 10 min | 80 / 10 min (é chamada por etapa) |
     |Meta| dispara `Lead` | dispara `LeadParcial`, NUNCA `Lead` |

   Enfiar isso tudo em ifs dentro de uma rota só significaria que um erro no
   caminho do parcial poderia derrubar o envio final — que é a rota que fecha
   venda. Separadas, o pior caso do parcial é o parcial não gravar.

   🔴 ESTA ROTA NÃO DISPARA `Lead` NEM NADA PARECIDO. O `Lead` é o evento pelo
      qual a campanha do Meta otimiza; ensiná-lo a procurar quem abandona
      seria pagar para trazer mais gente que abandona. O evento do parcial tem
      nome próprio e vive só no navegador (`LeadParcial` / `lead_partial`). */
router.post('/api/lead-parcial', express.json({ limit: '32kb' }), async (req, res) => {
  semRastro(res);
  try {
    const body = req.body || {};

    // Mesma armadilha de robô da rota final, mesma resposta mansa.
    if (body.ref_c7 || body.sobrenome_confirmacao) return res.json({ ok: true, ignorado: 'robo' });

    const ip = L.ipDe(req);
    const ehDev = !process.env.DATABASE_URL;
    const local = ip === '127.0.0.1' || ip === '::1';
    if (!(ehDev && local) && passouDoLimiteParcial(ip)) {
      /* 429 sem drama: quem está preenchendo não vê nada, o formulário
         continua funcionando e o envio final é outra rota, com outro freio. */
      return res.status(429).json({ ok: false, erro: 'limite' });
    }

    const { ok, motivo, lead } = L.validaParcial(body);
    /* Sem nome ou sem telefone não há o que guardar: não é erro da pessoa, é
       só cedo demais. 200 de propósito — o formulário não tem o que mostrar
       nem o que corrigir, e um 400 aqui viraria erro no console dela. */
    if (!ok) return res.json({ ok: false, motivo });

    Object.assign(lead, L.atribuicao(body, req));
    lead.lead_uid = String(body.lead_uid || '').slice(0, 80) || null;
    /* Sem uid não dá para atualizar a mesma linha depois, e cada etapa viraria
       um lead novo. Melhor não gravar do que gravar sete gêmeas da mesma
       pessoa: a Nataly abriria o painel achando que teve sete interessadas. */
    if (!lead.lead_uid) return res.json({ ok: false, motivo: 'sem-uid' });

    const salvo = await L.criaParcial(lead);
    /* null = a trava do `WHERE completo = false` recusou porque este lead já
       está completo (o beacon de saída chegou depois do envio final). É o
       comportamento correto, e para o navegador é sucesso: não há nada a
       fazer. */
    return res.json({ ok: true, gravado: !!salvo, ja_completo: !salvo });
  } catch (e) {
    /* Um parcial que não grava NÃO pode virar erro na tela de quem está
       preenchendo. Ela continua no formulário, e o envio final — que é o que
       fecha a venda — segue por outro caminho, intacto. */
    console.error('[funil] erro ao gravar parcial:', e.message);
    return res.status(200).json({ ok: false, motivo: 'servidor' });
  }
});

router.all('/api/lead-parcial', (req, res) => {
  semRastro(res);
  res.status(405).json({ erro: 'metodo-nao-permitido' });
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
  ['completo', 'Terminou o formulário'], ['ultima_etapa', 'Parou na pergunta'],
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

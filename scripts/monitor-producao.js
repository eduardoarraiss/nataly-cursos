#!/usr/bin/env node
/* ============================================================
   MONITOR DE PRODUÇÃO — natalyribeiro.com.br
   ============================================================
   Escrito em 02/09/2026, antes de a campanha de R$ 120/dia subir
   apontando para /profissao-lash-presencial.

   O QUE ELE RESOLVE: até aqui ninguém descobria que o site tinha
   caído a não ser olhando. E o modo como este site cai é o pior
   possível de enxergar — o catch-all do `server.js` transforma
   404 em `res.redirect('/')`, então uma rota morta devolve **200**
   e a home. Foi exatamente o que aconteceu em 01/09/2026: a
   /profissao-lash-curso e a /captacao-iniciante-online estavam no
   ar, com 200, servindo a página errada, e a verba rodava.

   🔴 POR ISSO NADA AQUI OLHA CÓDIGO DE RESPOSTA SOZINHO. Toda
   checagem exige um PEDAÇO DE CONTEÚDO que só existe na página
   certa. Um 200 servindo a home reprova.

   Sem dependência nenhuma: só `https` e `child_process` do Node.

   Uso:
     node scripts/monitor-producao.js              # checa e sai
     node scripts/monitor-producao.js --verboso    # imprime tudo

   Saída 0 = tudo certo. Saída 1 = alguma checagem reprovou.
   ============================================================ */
'use strict';

const https = require('https');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.env.MONITOR_BASE || 'https://natalyribeiro.com.br';
const VERBOSO = process.argv.includes('--verboso');
const LOG = path.join(__dirname, '..', 'logs', 'monitor-producao.log');

/* Credenciais do painel. Ficam em ENV, nunca no arquivo — este arquivo é
   commitado. Sem elas o monitor ainda roda: ele apenas PULA a checagem que
   precisa de sessão, e avisa que pulou (não finge que passou). */
const CRM_USUARIO = process.env.MONITOR_CRM_USUARIO || '';
const CRM_SENHA   = process.env.MONITOR_CRM_SENHA   || '';

const TIMEOUT_MS = 20000;

/* ---------- requisição ---------- */
function pede(caminho, opts = {}) {
  return new Promise((resolve) => {
    const url = new URL(caminho, BASE);
    const req = https.request(url, {
      method: opts.metodo || 'GET',
      headers: Object.assign({
        'User-Agent': 'monitor-nataly/1.0',
        'Accept-Encoding': 'identity',
      }, opts.headers || {}),
      timeout: TIMEOUT_MS,
    }, (res) => {
      const pedacos = [];
      res.on('data', (d) => pedacos.push(d));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        corpo: Buffer.concat(pedacos).toString('utf8'),
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ erro: 'timeout de ' + TIMEOUT_MS + 'ms' }); });
    req.on('error', (e) => resolve({ erro: e.message }));
    if (opts.corpo) req.write(opts.corpo);
    req.end();
  });
}

/* ---------- as checagens ----------
   Cada uma devolve { nome, ok, detalhe }. `detalhe` só é lido quando reprova,
   e tem de dizer O QUE deu errado, não que algo deu errado. */
const falhas = [];
const passes = [];

function registra(nome, ok, detalhe) {
  (ok ? passes : falhas).push({ nome, detalhe });
  if (VERBOSO || !ok) {
    console.log((ok ? '  ok   ' : '  FALHA') + '  ' + nome + (ok ? '' : ' — ' + detalhe));
  }
}

/* Confere uma página pelo CONTEÚDO. `marcas` são trechos que TÊM de aparecer;
   `proibidos` são trechos que denunciam que veio a página errada. */
async function conferePagina(nome, caminho, marcas, proibidos = []) {
  const r = await pede(caminho);
  if (r.erro) return registra(nome, false, 'não respondeu: ' + r.erro);
  if (r.status !== 200) return registra(nome, false, 'HTTP ' + r.status + ' (esperado 200)');

  const faltando = marcas.filter((m) => r.corpo.indexOf(m) === -1);
  if (faltando.length) {
    /* A pista mais provável: caiu no catch-all e veio a home. Dizer isso
       poupa a próxima pessoa de dez minutos de investigação. */
    const pareceHome = r.corpo.indexOf('Nataly Ribeiro — O Método LED') !== -1;
    return registra(nome, false,
      'respondeu 200 mas falta no HTML: ' + faltando.map((m) => JSON.stringify(m)).join(', ') +
      (pareceHome ? '  🔴 O CORPO É A HOME — a rota caiu no fallback res.redirect("/")' : '') +
      '  [' + r.corpo.length + ' bytes]');
  }
  const achou = proibidos.filter((m) => r.corpo.indexOf(m) !== -1);
  if (achou.length) {
    return registra(nome, false, 'apareceu no HTML o que não podia: ' +
      achou.map((m) => JSON.stringify(m)).join(', '));
  }
  registra(nome, true, r.corpo.length + ' bytes');
}

async function checaTudo() {
  /* 1. A PÁGINA DE VENDA — o destino da campanha.
        Marcas: o título dela, o link para o formulário e o pixel. Se o link
        para o formulário sumir, a página está no ar e não converte — que é
        uma queda tão cara quanto um 500. */
  await conferePagina('PV /profissao-lash-presencial',
    '/profissao-lash-presencial',
    ['Curso de extensão de cílios presencial em Cambuí',
     '/inscricao-presencial',
     'pixel.js']);

  /* 2. O FORMULÁRIO — o segundo passo do funil.
        Marca extra: a rota da API. Se o formulário subir apontando para o
        endereço errado, ele carrega bonito e não grava nada. */
  await conferePagina('Formulário /inscricao-presencial',
    '/inscricao-presencial',
    ['Inscrição · Curso presencial em Cambuí',
     '/api/lead-presencial',
     '/api/lead-parcial']);

  /* 3. A ROTA DA API, viva e montada.
        🔴 É um GET, não um POST, e a diferença não é detalhe.

        A primeira versão desta checagem mandava `POST {}` esperando o 400 de
        validação. Parecia inofensivo — não cria lead, não toca no WhatsApp.
        Só que o freio de spam (`passouDoLimite`, 5 por 10 minutos) é contado
        ANTES da validação: aquele POST GASTAVA UMA DAS CINCO VAGAS do IP a
        cada rodada. E como o IP que o servidor enxerga é o da borda da
        Cloudflare, compartilhado por muita gente, o monitor estaria comendo a
        cota de quem está preenchendo o formulário de verdade — com a campanha
        rodando. Medido em 02/09/2026: uma rodada devolveu
        `429 "Você já enviou o formulário"` para o próprio monitor.

        O GET cai no `router.all('/api/lead-presencial')`, que responde 405 e
        NÃO passa pelo freio. Prova a mesma coisa que importa: que o router do
        funil subiu e que a rota não foi engolida pelo catch-all. Um 302 aqui
        significaria o formulário enviando lead para o vazio. */
  const api = await pede('/api/lead-presencial', { metodo: 'GET' });
  if (api.erro) {
    registra('Rota /api/lead-presencial montada', false, 'não respondeu: ' + api.erro);
  } else if (api.status === 302 || api.status === 301) {
    registra('Rota /api/lead-presencial montada', false,
      '🔴 HTTP ' + api.status + ' — a rota da API NÃO EXISTE e caiu no catch-all. ' +
      'O formulário está enviando lead para o vazio.');
  } else if (api.status !== 405) {
    registra('Rota /api/lead-presencial montada', false,
      'HTTP ' + api.status + ' (esperado 405) — corpo: ' + api.corpo.slice(0, 200));
  } else {
    registra('Rota /api/lead-presencial montada', true, '405, como esperado');
  }

  /* 3b. A rota do PARCIAL, pelo mesmo motivo e do mesmo jeito. Ela é metade
         da captura do funil: se sumir, quem abandona volta a sumir junto. */
  const apiP = await pede('/api/lead-parcial', { metodo: 'GET' });
  if (apiP.status !== 405) {
    registra('Rota /api/lead-parcial montada', false,
      'HTTP ' + apiP.status + ' (esperado 405). Se for 302, a captura de quem ' +
      'abandona o formulário parou de existir.');
  } else {
    registra('Rota /api/lead-parcial montada', true, '405, como esperado');
  }

  /* 4. O PAINEL, fechado para quem não tem sessão.
        Duas coisas ao mesmo tempo: que ele existe, e que ele não vaza. */
  const crm = await pede('/crm');
  if (crm.erro) {
    registra('/crm fechado sem sessão', false, 'não respondeu: ' + crm.erro);
  } else if (crm.status !== 302 || String(crm.headers.location || '') !== '/crm/entrar') {
    registra('/crm fechado sem sessão', false,
      'HTTP ' + crm.status + ' → ' + (crm.headers.location || '(sem Location)') +
      ' (esperado 302 → /crm/entrar)');
  } else {
    registra('/crm fechado sem sessão', true, '302 → /crm/entrar');
  }

  /* Exige o 401 exato, e não "qualquer coisa que não seja 200". Um 404 aqui
     passaria pelo teste frouxo e significaria que o router do funil não subiu
     — ou seja, uma falha grave lida como aprovação. */
  const leadsAberto = await pede('/crm/api/leads');
  if (leadsAberto.status === 200) {
    registra('/crm/api/leads exige sessão', false,
      '🔴 VAZAMENTO: a API de leads respondeu 200 SEM SESSÃO — dado pessoal de terceiros exposto');
  } else if (leadsAberto.status !== 401) {
    registra('/crm/api/leads exige sessão', false,
      'HTTP ' + leadsAberto.status + ' (esperado 401). Não vazou, mas também não é o painel: ' +
      'provavelmente o router do funil não subiu.');
  } else {
    registra('/crm/api/leads exige sessão', true, 'HTTP 401');
  }

  await conferePagina('Login /crm/entrar', '/crm/entrar', ['Entrar', 'senha']);

  /* 5. O BANCO, de pé — a única checagem que prova isso.
        As de cima passam com o Postgres fora do ar: a PV e o formulário são
        arquivo estático, e o 400 da API vem da validação, que roda ANTES do
        banco. Só uma consulta de verdade prova que o Postgres responde — e o
        resumo do painel faz oito contagens de uma vez.
        Não escreve nada: nenhum lead de monitoramento entra no CRM da Nataly. */
  if (!CRM_USUARIO || !CRM_SENHA) {
    registra('Banco (via /crm/api/resumo)', false,
      'PULADA: faltam MONITOR_CRM_USUARIO e MONITOR_CRM_SENHA no ambiente. ' +
      'Sem elas o monitor NÃO sabe dizer se o Postgres está de pé.');
  } else {
    const login = await pede('/crm/entrar', {
      metodo: 'POST',
      headers: { 'Content-Type': 'application/json' },
      corpo: JSON.stringify({ usuario: CRM_USUARIO, senha: CRM_SENHA }),
    });
    const cookie = []
      .concat(login.headers && login.headers['set-cookie'] || [])
      .map((c) => String(c).split(';')[0]).join('; ');

    if (login.status !== 200 || !cookie) {
      registra('Banco (via /crm/api/resumo)', false,
        'não consegui entrar no painel: HTTP ' + login.status + ' ' +
        String(login.corpo || '').slice(0, 150));
    } else {
      const resumo = await pede('/crm/api/resumo', { headers: { Cookie: cookie } });
      if (resumo.status !== 200) {
        registra('Banco (via /crm/api/resumo)', false,
          '🔴 HTTP ' + resumo.status + ' — o Postgres provavelmente está fora. ' +
          'O site continua no ar, mas NENHUM LEAD ESTÁ SENDO GRAVADO. ' +
          String(resumo.corpo || '').slice(0, 150));
      } else {
        let d = null;
        try { d = JSON.parse(resumo.corpo); } catch (e) { /* abaixo */ }
        if (!d || typeof d.total !== 'number') {
          registra('Banco (via /crm/api/resumo)', false,
            'respondeu 200 mas não veio o resumo: ' + resumo.corpo.slice(0, 150));
        } else {
          /* Aviso preso na fila é sintoma de WhatsApp fora do ar. O lead está
             salvo (a regra do funil é gravar primeiro), mas a Nataly não foi
             avisada — e um lead que ela não vê hoje é um lead que esfria. */
          const falhos = d.avisosFalhos || 0;
          if (falhos > 0) {
            registra('Fila de avisos do WhatsApp', false,
              falhos + ' aviso(s) não enviado(s) — a Nataly não está sendo avisada dos leads. ' +
              'Ver /crm, seção de avisos, botão de reenviar.');
          } else {
            registra('Fila de avisos do WhatsApp', true, 'nada preso');
          }
          registra('Banco (via /crm/api/resumo)', true,
            d.total + ' inscrição(ões), ' + ((d.parciais && d.parciais.total) || 0) + ' parcial(is)');
        }
      }
    }
  }

  /* 6. A VSL, servindo por Range. É assim que o navegador busca os 21 MB —
        se o Range parar de funcionar, o vídeo não dá play e a PV perde a
        peça que mais vende. Um pedido de 2 KB basta para provar. */
  const vsl = await pede('/video/vsl-profissao-lash.mp4', { headers: { Range: 'bytes=0-2047' } });
  if (vsl.erro) {
    registra('VSL por Range', false, 'não respondeu: ' + vsl.erro);
  } else if (vsl.status !== 206) {
    registra('VSL por Range', false,
      'HTTP ' + vsl.status + ' (esperado 206). Em 01/09 este número foi 302 e o sintoma ' +
      'que apareceu foi "o vídeo não dá play".');
  } else {
    registra('VSL por Range', true, 'HTTP 206, ' + (vsl.headers['content-range'] || '?'));
  }
}

/* ---------- aviso ---------- */
function avisa(titulo, texto) {
  /* Notificação do macOS, o mesmo canal que o health-check dos checkouts já
     usa. Só aparece com o Mac ligado e a sessão aberta — está dito no
     relatório, para ninguém confundir isto com monitoramento de servidor. */
  execFile('/usr/bin/osascript', ['-e',
    'display notification ' + JSON.stringify(texto) +
    ' with title ' + JSON.stringify(titulo) + ' sound name "Basso"'],
    () => {});
}

(async () => {
  const inicio = Date.now();
  console.log('monitor · ' + BASE + ' · ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
  await checaTudo();

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  const resumo = passes.length + ' passaram, ' + falhas.length + ' falharam (' + seg + 's)';
  console.log(resumo);

  /* O log guarda SEMPRE, não só quando falha: sem a linha de "estava de pé às
     9h", não dá para dizer quando começou a queda. */
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG,
      new Date().toISOString() + ' | ' + resumo +
      (falhas.length ? '\n' + falhas.map((f) => '    FALHA: ' + f.nome + ' — ' + f.detalhe).join('\n') : '') +
      '\n');
  } catch (e) { console.error('não consegui escrever o log: ' + e.message); }

  if (falhas.length) {
    avisa('🚨 Nataly · SITE',
      falhas.length + ' checagem(ns) reprovou(aram): ' + falhas.map((f) => f.nome).join(', ') +
      '. Ver logs/monitor-producao.log');
    /* 🔴 ABORTA. Um check que só imprime não é check: a saída diferente de
       zero é o que faz o launchd, o CI ou o próximo script perceberem. */
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('monitor quebrou: ' + (e && e.stack || e));
  avisa('🚨 Nataly · SITE', 'o próprio monitor quebrou: ' + (e && e.message));
  process.exit(2);
});

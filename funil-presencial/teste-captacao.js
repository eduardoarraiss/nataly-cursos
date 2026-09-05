/* ============================================================
   GATE DA CAPTAÇÃO SEM PREÇO — ponta a ponta, em ARRANQUE FRIO
   ============================================================
   Roda:  node funil-presencial/teste-captacao.js

   🔴 POR QUE ARRANQUE FRIO, E POR QUE UM SERVIDOR NOVO A CADA RODADA.
      Bug de corrida neste funil só aparece na PRIMEIRA requisição depois de
      subir o processo — medido em 02/09/2026: 1 falha em 8 com o servidor
      quente, 2 em 3 com ele frio. Reaproveitar um servidor entre as rodadas
      esconderia exatamente a classe de defeito que este arquivo existe para
      pegar. Então cada rodada sobe o seu, bate, e derruba.

   🔴 ESTE GATE ABORTA. Não é um relatório bonito que imprime "ok" e devolve
      zero: qualquer falha derruba o processo com código 1, e o fim de verdade
      é o MARCADOR DE FIM lá embaixo. Um gate que estoura no meio e mesmo
      assim imprime "tudo certo" já aconteceu aqui — mediu 35 de 86 e aprovou.
      Se a última linha não aparecer, NÃO passou, por mais verde que pareça.

   🔴 CONFERE POR CONTEÚDO, NUNCA POR CÓDIGO DE STATUS. Um 200 com o corpo
      errado é o defeito mais caro deste funil: foi assim que o honeypot
      devolveu `ok:true` para gente de verdade e a tela abriu vazia.
   ============================================================ */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const RAIZ = path.join(__dirname, '..');
const PORTA = 4177;
const BASE = 'http://127.0.0.1:' + PORTA;
const DIR_TESTE = '.dados-gate-captacao';

let falhas = 0;
const checagens = [];

function ok(nome, condicao, detalhe) {
  checagens.push(nome);
  if (condicao) { console.log('ok     ' + nome); return true; }
  falhas++;
  console.log('FALHA  ' + nome + (detalhe ? '  → ' + detalhe : ''));
  return false;
}
function eq(nome, veio, esperado) {
  return ok(nome, veio === esperado,
    'esperava ' + JSON.stringify(esperado) + ', veio ' + JSON.stringify(veio));
}

/* ---------- o servidor de uma rodada ---------- */
function sobeServidor() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['server.js'], {
      cwd: RAIZ,
      env: Object.assign({}, process.env, {
        PORT: String(PORTA),
        /* Sem DATABASE_URL o funil usa PGlite local — banco PRÓPRIO deste
           gate, para não encostar nos dados de desenvolvimento. */
        DATABASE_URL: '',
        FUNIL_DEV_DIR: DIR_TESTE,
        /* driver 'log': nada sai para o WhatsApp de ninguém durante o teste. */
        NATALY_WA_DRIVER: 'log',
        NATALY_WA_TESTE: '1',
        CRM_CONTAS: 'gate@teste.local:senha-de-teste-do-gate',
        NODE_ENV: 'test',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    const morreu = (e) => reject(new Error('servidor não subiu: ' + e + '\n' + saida));
    p.stdout.on('data', (d) => { saida += d; });
    p.stderr.on('data', (d) => { saida += d; });
    p.on('exit', (c) => { if (c !== null) morreu('saiu com código ' + c); });

    /* Espera o servidor ATENDER de verdade, e não um `sleep` chutado: o
       tempo de subida do PGlite varia com a máquina, e dormir um número fixo
       ou falha em máquina lenta ou desperdiça segundos em máquina rápida. */
    const limite = Date.now() + 30000;
    (function tenta() {
      http.get(BASE + '/inscricao-presencial', (r) => {
        r.resume();
        if (r.statusCode === 200) return resolve(p);
        if (Date.now() > limite) return morreu('não respondeu 200 a tempo');
        setTimeout(tenta, 200);
      }).on('error', () => {
        if (Date.now() > limite) return morreu('não abriu a porta a tempo');
        setTimeout(tenta, 200);
      });
    })();
  });
}

function derruba(p) {
  return new Promise((resolve) => {
    if (!p || p.exitCode !== null) return resolve();
    p.on('exit', () => resolve());
    p.kill('SIGTERM');
    setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} resolve(); }, 3000);
  });
}

/* ---------- HTTP ---------- */
function pede(metodo, caminho, corpo, cookie) {
  return new Promise((resolve, reject) => {
    const dados = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
    const req = http.request(BASE + caminho, {
      method: metodo,
      headers: Object.assign(
        dados ? { 'Content-Type': 'application/json', 'Content-Length': dados.length } : {},
        cookie ? { Cookie: cookie } : {}),
    }, (r) => {
      let t = '';
      r.on('data', (d) => { t += d; });
      r.on('end', () => {
        let j = null;
        try { j = JSON.parse(t); } catch (e) {}
        resolve({ http: r.statusCode, j, texto: t, cookie: (r.headers['set-cookie'] || [])[0] });
      });
    });
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}

/* Um formulário completo, do jeito que o navegador manda hoje. */
function respostas(extra) {
  return Object.assign({
    nome: 'Joana Teste da Silva',
    telefone: '(35) 99716-4668',
    email: 'joana@exemplo.com',
    instagram: '@joana.teste',
    cidade: 'Pouso Alegre',
    estado: 'MG',
    faixa_idade: '25-34',
    situacao: 'outra-area',
    meta_renda: '2k-5k',
    objetivo: 'Quero sair do meu emprego e atender em casa',
    quando_comecar: 'agora',
    disponibilidade: 'sim',
    prefere_formato: 'presencial',
    interesse: 'iniciante',
    lead_uid: 'gate-' + Math.random().toString(36).slice(2, 12),
  }, extra || {});
}

/* ---------- uma rodada = um servidor novo ---------- */
async function rodada(titulo, fn) {
  console.log('\n== ' + titulo + '  (arranque frio)');
  const p = await sobeServidor();
  try { await fn(); } finally { await derruba(p); }
}

async function principal() {
  /* Banco limpo: o gate não pode passar por causa de lixo de uma rodada
     anterior, nem falhar por causa dele. */
  fs.rmSync(path.join(__dirname, DIR_TESTE), { recursive: true, force: true });

  /* ============================================================
     1. A ARMADILHA DE ROBÔ — a primeira hipótese de "não chega lead"
     ============================================================
     🔴 ESTE É O DEFEITO QUE JÁ CUSTOU LEAD PAGO DUAS VEZES. O campo se
        chamava `sobrenome_confirmacao`, o autopreenchimento do navegador
        escrevia nele (vê "sobrenome", preenche) e mulher de verdade era
        tratada como robô: `ok:true` sem gravar nada, tela vazia, sem erro.
        Hoje ele se chama `ref_c7`, que não casa com heurística nenhuma. */
  await rodada('1. a armadilha de robô', async () => {
    const uid = 'gate-robo-' + Date.now();
    const r = await pede('POST', '/api/lead-presencial', respostas({ ref_c7: 'sou-robo', lead_uid: uid }));
    ok('envio com a armadilha preenchida é descartado', r.j && r.j.ok === true && r.j.dedupe === true,
       r.texto.slice(0, 200));

    /* E o que importa: NÃO gravou. Conferido no banco, não na resposta. */
    const login = await pede('POST', '/crm/entrar',
      { usuario: 'gate@teste.local', senha: 'senha-de-teste-do-gate' });
    ok('o painel abre com a conta do gate', login.j && login.j.ok === true, login.texto.slice(0, 200));
    const lista = await pede('GET', '/crm/api/leads?completo=tudo&limite=100', undefined, login.cookie);
    const achou = (lista.j.leads || []).some((l) => l.lead_uid === uid);
    ok('🔴 e o robô NÃO virou linha no banco', achou === false);

    /* 🔴 O NOME DO CAMPO É PARTE DA CORREÇÃO. Se alguém rebatizar a armadilha
       para algo que pareça um campo real, o autopreenchimento volta a
       preenchê-la e o defeito silencioso volta junto — sem erro em lugar
       nenhum, só lead sumindo. */
    const html = fs.readFileSync(path.join(RAIZ, 'public/inscricao-presencial.html'), 'utf8');
    ok('a armadilha continua com nome neutro (`ref_c7`)', /name="ref_c7"/.test(html));
    ok('🔴 e NÃO voltou a se chamar "sobrenome"', /name="sobrenome/.test(html) === false);
  });

  /* ============================================================
     2. O CAMINHO FELIZ — responder tudo e enviar
     ============================================================ */
  await rodada('2. o envio completo grava, qualifica e enfileira o aviso', async () => {
    const dados = respostas();
    const r = await pede('POST', '/api/lead-presencial', dados);
    ok('o envio é aceito', r.j && r.j.ok === true, r.texto.slice(0, 300));

    /* 🔴 O NAVEGADOR NÃO PODE RECEBER PRODUTO NEM PREÇO. A captação parou de
       vender; se a resposta ainda trouxesse a recomendação, ela apareceria na
       aba de rede e um dia alguém a colocaria de volta na tela. */
    const corpo = JSON.stringify(r.j || {});
    ok('🔴 a resposta NÃO traz recomendação de produto', /recomendacao/.test(corpo) === false, corpo.slice(0, 200));
    ok('🔴 a resposta NÃO traz preço', /"valor"|R\$|1197|1997|497|297/.test(corpo) === false, corpo.slice(0, 200));

    const login = await pede('POST', '/crm/entrar',
      { usuario: 'gate@teste.local', senha: 'senha-de-teste-do-gate' });
    const lista = await pede('GET', '/crm/api/leads?completo=tudo&limite=100', undefined, login.cookie);
    const lead = (lista.j.leads || []).find((l) => l.lead_uid === dados.lead_uid);
    ok('a linha existe no banco', !!lead);
    if (lead) {
      eq('e está COMPLETA', lead.completo, true);
      eq('o interesse declarado foi gravado', lead.interesse, 'iniciante');
      eq('o nome foi gravado', lead.nome, 'Joana Teste da Silva');
      eq('o telefone foi normalizado com DDI', lead.telefone, '5535997164668');
      /* A árvore continua rodando NO SERVIDOR: é a inteligência comercial que
         a Nataly lê no painel. O que ela não faz mais é ir para a tela. */
      eq('a árvore rodou e marcou o produto (uso interno)', lead.produto_id, 'profissao-lash-presencial');
      /* 🔴 SEM FAIXA DECLARADA, A ÁRVORE NÃO PODE INVENTAR OBJEÇÃO DE
         ORÇAMENTO. Ausência de resposta não é resposta negativa: se
         `cabeNaFaixa` voltar a tratar faixa nula como "não cabe", todo mundo
         cai no online com um motivo falso gravado no painel. */
      ok('🔴 e NÃO inventou motivo de orçamento',
         /acima da faixa/.test(lead.recomendacao_motivos || '') === false, lead.recomendacao_motivos);
      ok('a qualificação foi calculada', ['quente', 'morno', 'frio'].indexOf(lead.qualificacao) !== -1,
         String(lead.qualificacao));
    }

    /* O aviso foi enfileirado (driver=log, então nada saiu de verdade). */
    const av = await pede('GET', '/crm/api/resumo', undefined, login.cookie);
    ok('o resumo responde', av.j && typeof av.j.total === 'number');
  });

  /* ============================================================
     3. A PERGUNTA DE DINHEIRO NÃO PODE VOLTAR A TRAVAR NINGUÉM
     ============================================================ */
  await rodada('3. sem faixa de investimento o envio passa', async () => {
    const r = await pede('POST', '/api/lead-presencial', respostas());
    ok('🔴 nenhum erro cobra a faixa de investimento',
       !(r.j && r.j.erros && r.j.erros.faixa_investimento), JSON.stringify(r.j && r.j.erros));

    /* E o contrário: o interesse é a nova obrigatória. */
    const semInteresse = respostas();
    delete semInteresse.interesse;
    const r2 = await pede('POST', '/api/lead-presencial', semInteresse);
    ok('sem interesse o envio é recusado', !!(r2.j && r2.j.erros && r2.j.erros.interesse),
       JSON.stringify(r2.j && r2.j.erros));
    ok('e o erro é uma frase em português, não um código',
       /aprender/.test((r2.j.erros || {}).interesse || ''), (r2.j.erros || {}).interesse);

    /* 🔴 A ABA QUE FICOU ABERTA DESDE ONTEM. No dia da virada existe gente com
       a página ANTIGA carregada no celular — a que perguntava a faixa e não
       conhecia o campo `interesse`. Ela NÃO pode receber uma cobrança por uma
       pergunta que a tela dela não tem: sem campo para corrigir, o botão nunca
       mais funciona e o lead pago morre em silêncio. */
    const velho = respostas({ faixa_investimento: 'ate-500', situacao: 'ja-lash', busca: 'tecnica-led' });
    delete velho.interesse;
    const r3 = await pede('POST', '/api/lead-presencial', velho);
    ok('🔴 o envio do formulário ANTIGO ainda passa', r3.j && r3.j.ok === true,
       JSON.stringify(r3.j && r3.j.erros));

    const login = await pede('POST', '/crm/entrar',
      { usuario: 'gate@teste.local', senha: 'senha-de-teste-do-gate' });
    const lista = await pede('GET', '/crm/api/leads?completo=tudo&limite=200', undefined, login.cookie);
    const dela = (lista.j.leads || []).find((l) => l.lead_uid === velho.lead_uid);
    ok('e o interesse dela foi DEDUZIDO do que ela já respondeu', dela && dela.interesse === 'led',
       dela && String(dela.interesse));
  });

  /* ============================================================
     4. UM ENVIO REPETIDO NÃO VIRA DUAS PESSOAS
     ============================================================
     O duplo clique, a rede que reenvia e o botão apertado de novo depois de
     um erro caem todos aqui. Se cada um virasse uma linha, a Nataly abriria o
     painel achando que teve o triplo de interessadas. */
  await rodada('4. envio repetido não cria lead gêmeo', async () => {
    const dados = respostas();
    const a = await pede('POST', '/api/lead-presencial', dados);
    const b = await pede('POST', '/api/lead-presencial', dados);
    ok('o primeiro envio é novo', a.j && a.j.ok === true && !a.j.dedupe);
    ok('o segundo é reconhecido como repetição', b.j && b.j.ok === true && b.j.dedupe === true,
       JSON.stringify(b.j));

    const login = await pede('POST', '/crm/entrar',
      { usuario: 'gate@teste.local', senha: 'senha-de-teste-do-gate' });
    const lista = await pede('GET', '/crm/api/leads?completo=tudo&limite=200', undefined, login.cookie);
    const quantas = (lista.j.leads || []).filter((l) => l.lead_uid === dados.lead_uid).length;
    eq('e existe UMA linha só para ela', quantas, 1);
  });

  /* ============================================================
     5. A PÁGINA SERVIDA — o que ela NÃO pode mais conter
     ============================================================
     Conferido no HTML que o servidor entrega, e não no arquivo do disco: o
     que importa é o que chega no navegador dela. */
  await rodada('5. a página entregue não fala de dinheiro', async () => {
    const r = await pede('GET', '/inscricao-presencial');
    const h = r.texto;
    ok('a página é servida', h.length > 5000 && /insc-form/.test(h));

    /* Só o corpo visível: os comentários do arquivo FALAM de preço de
       propósito (contam por que ele saiu), e varrer o arquivo cru acusaria a
       própria documentação. O que não pode ter preço é o que ela lê. */
    const semComentarios = h.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    /* 🔴 A PERGUNTA DA META DE RENDA FICA DE FORA DA VARREDURA DE "R$".
       Ela tem "Até R$ 2 mil", "Mais de R$ 10 mil" — e esses reais são os DELA,
       o quanto ela quer GANHAR. É o oposto de preço nosso: é a única cifra que
       a captação pode mostrar, porque quem a diz é ela. Varrer sem recortar
       este bloco acusaria a pergunta certa e ensinaria a ignorar o gate. */
    const semRenda = semComentarios.replace(
      /<fieldset[^>]*data-etapa="6"[\s\S]*?<\/fieldset>/, '');
    ok('a pergunta da meta de renda continua na página',
       /name="meta_renda"/.test(semComentarios));

    const PROIBIDOS = [
      [/R\$\s*\d/, 'valor em reais'],
      [/\b1\.?197\b/, 'preço do combo'],
      [/\b1\.?997\b/, 'preço do LED presencial'],
      [/\bfaixa_investimento\b/, 'a pergunta da faixa de investimento'],
      [/pay\.kiwify/, 'link de checkout'],
      [/\bparcela|\d+\s*x\s*de\b/i, 'parcelamento'],
      [/id="recomendacao"/, 'a tela da recomendação'],
      [/Quero garantir a minha vaga/, 'o botão de garantir vaga'],
    ];
    PROIBIDOS.forEach(([re, nome]) => {
      const m = semRenda.match(re);
      ok('🔴 não tem ' + nome, !m, m ? 'achei: ' + m[0] : '');
    });

    ok('a última pergunta é a do interesse', /data-etapa="interesse"/.test(h));
    ok('e ela oferece os dois caminhos',
       /value="iniciante"/.test(h) && /value="led"/.test(h));

    /* O botão de WhatsApp existe e nasce SEM href — quem monta é o JS, com o
       texto escolhido pelo interesse. Um `wa.me` cravado abriria conversa em
       branco para quem clicasse antes de o JS rodar. */
    ok('o botão de falar agora existe', /id="wa-agora"/.test(h));
    const botao = (h.match(/<a[^>]*id="wa-agora"[^>]*>/) || [''])[0];
    ok('🔴 e nasce sem href (o JS monta com a mensagem certa)',
       /href=/.test(botao) === false, botao);

    /* As duas frases, conferidas por conteúdo. */
    ok('a frase da iniciante existe e diz que preencheu o formulário',
       /me tornar uma lash designer[\s\S]{0,80}preenchi o formulário/.test(h));
    ok('a frase do LED existe e diz que preencheu o formulário',
       /aprender a técnica com LED[\s\S]{0,80}preenchi o formulário/.test(h));
    ok('o número do WhatsApp é o da Nataly', /5535997164668/.test(h));

    /* O prazo mora em UM lugar. Se ele passar a existir em dois, um dia os
       dois vão discordar — e a promessa que a pessoa lê é a que vale. */
    const prazos = h.match(/data-prazo="[^"]*"/g) || [];
    eq('o prazo do contato está declarado uma vez só', prazos.length, 1);
  });

  /* ============================================================
     6. O RASTREAMENTO — um Lead, e um só
     ============================================================
     Conferido no código servido, porque é lá que o defeito mora: evento
     duplicado não dá erro em lugar nenhum e só aparece semanas depois, como
     uma campanha otimizando por um número inflado. */
  await rodada('6. o Lead dispara uma vez só, no envio', async () => {
    const h = (await pede('GET', '/inscricao-presencial')).texto;

    const chamadas = (h.match(/fbq\(\s*['"]track['"]\s*,\s*['"]Lead['"]/g) || []).length;
    eq('existe UMA chamada de fbq track Lead no arquivo', chamadas, 1);

    ok('ela vive dentro de `disparaLead`', /function disparaLead\([\s\S]{0,2000}fbq\(\s*'track',\s*'Lead'/.test(h));
    ok('com trava de página (`leadDisparado`)', /var leadDisparado = false;/.test(h));
    ok('e trava de sessão (`sessionStorage`)', /sessionStorage\.setItem\('nr_lead_presencial'/.test(h));
    ok('o Lead leva eventID, para não duplicar com a CAPI',
       /fbq\('track', 'Lead', dados, \{ eventID: uid \}\)/.test(h));

    /* 🔴 `disparaLead` só pode ser chamado de UM lugar: a tela de recebido,
       depois de o servidor confirmar. Se ele voltar a ser chamado na chegada
       de uma tela, o Meta volta a contar quem não enviou — que é exatamente o
       desencontro de 04/09/2026, quando o Meta marcou 2 leads num dia em que
       o banco não ganhou linha nenhuma. */
    const chamadasLead = (h.match(/disparaLead\(/g) || []).length;
    eq('e é chamado de um lugar só (a definição + a chamada)', chamadasLead, 2);
    ok('a chamada está dentro de `recebido`', /function recebido\([\s\S]{0,2500}disparaLead\(dados\.lead_uid/.test(h));

    /* Os eventos que morreram com a tela do preço não podem estar vivos. */
    [['ViuRecomendacao', 'o evento da tela de recomendação'],
     ['CompleteRegistration', 'o evento de confirmação (virou o próprio Lead)'],
     ['ViuInvestimento', 'o evento da etapa de dinheiro'],
     ['InitiateCheckout', 'o evento de checkout']].forEach(([ev, nome]) => {
      const vivo = new RegExp("fbq\\([^)]*['\"]" + ev + "['\"]").test(h);
      ok('🔴 ' + nome + ' não dispara mais', !vivo);
    });

    /* O clique no WhatsApp é medido, e o GA4 vai de `beacon`: é o único
       evento que compete com uma navegação. O `event_callback` NÃO serve —
       ele dispara ao ENFILEIRAR, em 3 ms, e mente dizendo que enviou. */
    ok('o clique no WhatsApp dispara no Meta', /fbq\('trackCustom', 'ClicouWhatsApp'/.test(h));
    ok('e no GA4', /gtag\('event', 'click_whatsapp'/.test(h));
    ok('🔴 o GA4 do WhatsApp vai por beacon',
       /click_whatsapp'[\s\S]{0,200}transport_type: 'beacon'/.test(h));
    /* Sem os comentários: o arquivo FALA de `event_callback` de propósito,
       para explicar por que ele não é usado. Varrer o texto cru acusaria a
       própria explicação — e a lição some junto com o falso positivo. */
    const codigo = h.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    ok('🔴 e o funil NÃO usa event_callback em lugar nenhum',
       /event_callback/.test(codigo) === false);
    ok('o clique no WhatsApp é travado por sessão',
       /sessionStorage\.setItem\('nr_wa_presencial'/.test(h));

    /* Um listener por elemento. Registrar de novo ao reexibir um bloco
       duplicaria o evento sem erro nenhum no console. */
    const listenersWa = (h.match(/wa\.addEventListener\(/g) || []).length;
    eq('o botão de WhatsApp recebe UM listener', listenersWa, 1);
  });

  /* ============================================================
     FIM
     ============================================================ */
  console.log('\n' + '─'.repeat(60));
  if (falhas) {
    console.log(falhas + ' FALHA(S) de ' + checagens.length + '.');
    process.exit(1);
  }
  /* 🔴 O MARCADOR DE FIM. Só existe se TODAS as rodadas terminaram. Um gate
     que estoura no meio nunca chega aqui — e é por isso que ele existe. */
  console.log('GATE DA CAPTAÇÃO: TUDO CERTO — ' + checagens.length + ' checagens, 6 rodadas frias.');
  console.log('=== FIM DO GATE ===');
  process.exit(0);
}

principal().catch((e) => {
  console.error('\n🔴 O GATE ESTOUROU (isto NÃO é aprovação):', e && e.stack || e);
  process.exit(1);
});

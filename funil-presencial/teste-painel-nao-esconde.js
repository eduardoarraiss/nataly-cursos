/* ============================================================
   GATE: NENHUMA VISTA DO PAINEL ESCONDE LEAD POR PADRÃO
   ============================================================
   Roda:  node funil-presencial/teste-painel-nao-esconde.js

   🔴 A REGRA QUE ESTE ARQUIVO DEFENDE, e ela vale para sempre:
      com os filtros no estado PADRÃO, toda vista do painel mostra TODAS as
      linhas da tabela. Filtro é coisa que a pessoa LIGA, nunca que já vem
      ligada.

   O incidente (05/09/2026): `estado.completo` nascia 'sim' — só quem terminou
   o formulário do site. Das 119 linhas do CRM, apenas DUAS eram `completo`.
   O painel escondia 117 de 119 e o pipeline abria VAZIO. Nada quebrou, nada
   deu erro, nenhum log reclamou: a tela só mostrava menos do que existia.
   E escondia justamente os mais valiosos — os 87 compradores e os 24 do
   anúncio nunca preencheram o formulário do site, então nunca seriam
   `completo`; e os 6 do site que faltavam eram quem abandonou na tela de
   preço, a fila de ligação mais quente que existe.

   Com o WhatsApp fora do ar, o painel é a operação inteira: o que ele não
   mostra, na prática não existe.

   🔴 ARRANQUE FRIO. 🔴 ABORTA com código 1. 🔴 MARCADOR DE FIM no final.
   ============================================================ */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const RAIZ = path.join(__dirname, '..');
const PORTA = 4181;
const BASE = 'http://127.0.0.1:' + PORTA;
const DIR = '.dados-gate-painel';
const CONTA = 'gate@teste.local';
const SENHA = 'senha-de-teste-do-gate';

let falhas = 0; const checagens = [];
function ok(nome, cond, det) {
  checagens.push(nome);
  if (cond) { console.log('ok     ' + nome); return true; }
  falhas++; console.log('FALHA  ' + nome + (det ? '  → ' + det : '')); return false;
}
const eq = (n, v, e) => ok(n, v === e, 'esperava ' + JSON.stringify(e) + ', veio ' + JSON.stringify(v));

function sobe() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['server.js'], {
      cwd: RAIZ,
      env: Object.assign({}, process.env, {
        PORT: String(PORTA), DATABASE_URL: '', FUNIL_DEV_DIR: DIR,
        NATALY_WA_DRIVER: 'log', NATALY_WA_TESTE: '1',
        CRM_CONTAS: CONTA + ':' + SENHA, NODE_ENV: 'test',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    p.stdout.on('data', (d) => { saida += d; });
    p.stderr.on('data', (d) => { saida += d; });
    p.on('exit', (c) => { if (c !== null) reject(new Error('servidor saiu (' + c + ')\n' + saida)); });
    const limite = Date.now() + 30000;
    (function tenta() {
      http.get(BASE + '/inscricao-presencial', (r) => {
        r.resume();
        if (r.statusCode === 200) return resolve(p);
        if (Date.now() > limite) return reject(new Error('sem resposta\n' + saida));
        setTimeout(tenta, 200);
      }).on('error', () => {
        if (Date.now() > limite) return reject(new Error('porta fechada\n' + saida));
        setTimeout(tenta, 200);
      });
    })();
  });
}
const derruba = (p) => new Promise((r) => {
  if (!p || p.exitCode !== null) return r();
  p.on('exit', () => r()); p.kill('SIGTERM');
  setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} r(); }, 3000);
});

function pede(metodo, caminho, corpo, cookie) {
  return new Promise((res, rej) => {
    const d = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
    const req = http.request(BASE + caminho, {
      method: metodo,
      headers: Object.assign(
        d ? { 'Content-Type': 'application/json', 'Content-Length': d.length } : {},
        cookie ? { Cookie: cookie } : {}),
    }, (r) => {
      let t = ''; r.on('data', (c) => { t += c; });
      r.on('end', () => {
        let j = null; try { j = JSON.parse(t); } catch (e) {}
        res({ http: r.statusCode, j, texto: t, cookie: (r.headers['set-cookie'] || [])[0] });
      });
    });
    req.on('error', rej); if (d) req.write(d); req.end();
  });
}

/* Lê os PADRÕES direto do código do painel. É o único jeito de o gate provar
   algo sobre a tela sem abrir um navegador: se alguém trocar o padrão de volta
   para 'sim', ou criar um período padrão, isto falha. */
function padroesDoPainel() {
  const src = fs.readFileSync(path.join(__dirname, 'painel/crm.html'), 'utf8');
  const completo = (src.match(/\n\s*completo:\s*'([a-z]+)'/) || [])[1] || null;
  const periodo = (src.match(/\n\s*periodo:\s*'([^']*)'/) || [])[1];
  const filtros = (src.match(/\n\s*filtros:\s*\{([^}]*)\}/) || [])[1] || '';
  return { completo, periodo, filtros, src };
}

async function principal() {
  fs.rmSync(path.join(__dirname, DIR), { recursive: true, force: true });

  console.log('== 1. os PADRÕES declarados no painel  (leitura do código)');
  const P = padroesDoPainel();
  /* 🔴 'tudo' é o único valor aceitável. 'sim' esconde os importados para
     sempre — eles nunca preencheram o formulário do site. */
  eq('o padrão de `completo` mostra todo mundo', P.completo, 'tudo');
  eq('não existe período padrão (senão apaga o histórico)', P.periodo, '');
  /* Todo filtro de texto nasce vazio. Um só com valor já corta linha. */
  /* Cada filtro tem de nascer `campo: ''`. Conta as chaves e conta as vazias:
     se as duas contas baterem, nenhum nasce com valor. Casar aspas soltas com
     regex acusaria a vírgula ENTRE dois vazios como se fosse conteúdo. */
  const chaves = (P.filtros.match(/[a-z_]+\s*:/g) || []).length;
  const vazios = (P.filtros.match(/:\s*''/g) || []).length;
  eq('nenhum filtro de texto nasce com valor', vazios, chaves,
     'chaves=' + chaves + ' vazios=' + vazios);
  ok('o seletor oferece "Todo mundo" como primeira opção',
     /\{ v: 'tudo'/.test(P.src.split('var COMPLETOS')[1] || ''),
     'a primeira opção é lida como "o normal"');
  ok('e limpar filtros volta para `tudo`, não para `sim`',
     /estado\.completo = 'tudo';/.test(P.src) && !/estado\.completo = 'sim';/.test(P.src));

  console.log('\n== 2. contra o BANCO, em arranque frio');
  const p = await sobe();
  try {
    const login = await pede('POST', '/crm/entrar', { usuario: CONTA, senha: SENHA });
    ok('o painel abre', login.j && login.j.ok === true);

    /* Semeia os três tipos que existem no CRM real: quem terminou o
       formulário, quem parou no meio, e quem foi importado (que NUNCA é
       completo, porque nunca preencheu formulário nenhum). */
    const base = {
      nome: 'Completa Do Gate', telefone: '(35) 99716-4668', email: 'c@exemplo.com',
      instagram: '@completa.gate', cidade: 'Cambui', estado: 'MG', faixa_idade: '25-34',
      situacao: 'outra-area', meta_renda: '2k-5k', quando_comecar: 'agora',
      disponibilidade: 'sim', prefere_formato: 'presencial', interesse: 'iniciante',
    };
    await pede('POST', '/api/lead-presencial', Object.assign({}, base, { lead_uid: 'g-comp-1' }));
    await pede('POST', '/api/lead-parcial', {
      lead_uid: 'g-parc-1', nome: 'Parcial Do Gate', telefone: '(35) 99884-9427',
      ultima_etapa: '4' });
    await pede('POST', '/crm/api/importar', {
      origem: 'meta-lead-ads',
      registros: [
        { origem_id: 'g-imp-1', nome: 'Importada Um', telefone: '+5511973486372',
          criado_em: '2026-08-21T00:00:00Z' },
        { origem_id: 'g-imp-2', nome: 'Compradora Um', telefone: '+5548998381825',
          comprou: 'Lash 2.0 - Método LED', comprou_em: '2026-06-30T00:00:00Z',
          criado_em: '2026-06-30T00:00:00Z' },
      ],
    }, login.cookie);

    /* A VERDADE: quantas linhas existem na tabela, sem filtro nenhum. */
    const tudo = await pede('GET', '/crm/api/leads?completo=tudo&limite=1000', undefined, login.cookie);
    const total = ((tudo.j && tudo.j.leads) || []).length;
    ok('há linhas de vários tipos no banco', total >= 4, 'total=' + total);

    /* 🔴 O CORAÇÃO DO GATE: a query que o painel monta NO ESTADO PADRÃO tem
       de devolver o total. Se alguém puser um padrão que corta, isto falha —
       e falha com o número, não com uma opinião. */
    const padrao = await pede('GET', '/crm/api/leads?completo=' + P.completo + '&limite=1000',
      undefined, login.cookie);
    const vistas = ((padrao.j && padrao.j.leads) || []).length;
    eq('🔴 o painel NO PADRÃO mostra TODAS as linhas', vistas, total);

    /* E a prova pelo avesso: com o padrão ANTIGO, esconderia. Isto documenta
       o defeito e garante que o teste tem poder de detecção — um teste que
       passaria dos dois jeitos não prova nada. */
    const antigo = await pede('GET', '/crm/api/leads?completo=sim&limite=1000', undefined, login.cookie);
    const comAntigo = ((antigo.j && antigo.j.leads) || []).length;
    ok('🔴 (prova de que o gate tem poder) o padrão ANTIGO esconderia linha',
       comAntigo < total, 'antigo=' + comAntigo + ' de ' + total);

    /* As três vistas do painel (Painel, Lista, Pipeline) leem da MESMA
       chamada — `estado.leads`. Então provar a chamada prova as três. O que
       ainda pode divergir é o CSV, que monta a própria URL. */
    const csv = await pede('GET', '/crm/exportar.csv?completo=' + P.completo + '&limite=5000',
      undefined, login.cookie);
    const linhasCsv = csv.texto.split('\r\n').filter((l) => l.trim()).length - 1;  // -1 = cabeçalho
    eq('🔴 e o CSV exporta o mesmo tanto que a tela mostra', linhasCsv, total);

    /* O contador do resumo conta o banco inteiro, e não pode discordar. */
    const resumo = await pede('GET', '/crm/api/resumo', undefined, login.cookie);
    const r = resumo.j || {};
    /* 🔴 OS CONTADORES TAMBÉM ESCONDIAM. Eram todos `WHERE completo = true`:
       diziam 2 quando havia 119. Um número errado num azulejo é pior que um
       azulejo vazio — ele parece informação. */
    eq('o total do resumo conta TODO MUNDO', r.total, total);
    const somaStatus = (r.porStatus || []).reduce((a, x) => a + x.n, 0);
    eq('o contador por status soma o mesmo total', somaStatus, total);
    ok('e `completas` continua existindo para o gráfico de funil',
       typeof r.completas === 'number' && r.completas <= total,
       'completas=' + r.completas);
  } finally { await derruba(p); }

  console.log('\n' + '─'.repeat(60));
  if (falhas) { console.log(falhas + ' FALHA(S) de ' + checagens.length + '.'); process.exit(1); }
  console.log('GATE DO PAINEL: TUDO CERTO — ' + checagens.length + ' checagens.');
  console.log('=== FIM DO GATE DO PAINEL ===');
  process.exit(0);
}

principal().catch((e) => {
  console.error('\n🔴 O GATE ESTOUROU (isto NÃO é aprovação):', (e && e.stack) || e);
  process.exit(1);
});

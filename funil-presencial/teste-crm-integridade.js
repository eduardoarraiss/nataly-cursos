/* ============================================================
   GATE DA INTEGRIDADE DO CRM — nenhum lead entra sem virar linha
   ============================================================
   Roda:  node funil-presencial/teste-crm-integridade.js

   🔴 A PROPRIEDADE QUE ESTE ARQUIVO DEFENDE:
      toda requisição de captação vira registro. A válida vira LEAD; a
      inválida vira RECEBIDO recuperável. Zero é sempre erro.

   O incidente que o gerou: em 04 e 05/09/2026 descobriu-se que (a) o WhatsApp
   caiu e ficou fora cinco dias avisando ninguém, em silêncio, e (b) 24 leads
   de um formulário instantâneo do Meta nunca tinham tocado o CRM. Nos dois
   casos o sistema respondia como se estivesse tudo certo.

   🔴 ARRANQUE FRIO A CADA RODADA: servidor novo, sempre. Bug de corrida aqui
      só aparece na primeira requisição depois de subir o processo — medido em
      02/09/2026, 1 falha em 8 quente contra 2 em 3 frio.
   🔴 ABORTA com código 1. O fim de verdade é o MARCADOR DE FIM.
   ============================================================ */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const RAIZ = path.join(__dirname, '..');
const PORTA = 4179;
const BASE = 'http://127.0.0.1:' + PORTA;
const DIR = '.dados-gate-crm';
const CONTA = 'gate@teste.local';
const SENHA = 'senha-de-teste-do-gate';

let falhas = 0; const checagens = [];
function ok(nome, cond, det) {
  checagens.push(nome);
  if (cond) { console.log('ok     ' + nome); return true; }
  falhas++; console.log('FALHA  ' + nome + (det ? '  → ' + det : '')); return false;
}
const eq = (n, v, e) => ok(n, v === e, 'esperava ' + JSON.stringify(e) + ', veio ' + JSON.stringify(v));

function sobe(extraEnv) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['server.js'], {
      cwd: RAIZ,
      env: Object.assign({}, process.env, {
        PORT: String(PORTA), DATABASE_URL: '', FUNIL_DEV_DIR: DIR,
        NATALY_WA_DRIVER: 'log', NATALY_WA_TESTE: '1',
        CRM_CONTAS: CONTA + ':' + SENHA, NODE_ENV: 'test',
      }, extraEnv || {}),
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
        if (Date.now() > limite) return reject(new Error('não respondeu a tempo\n' + saida));
        setTimeout(tenta, 200);
      }).on('error', () => {
        if (Date.now() > limite) return reject(new Error('porta não abriu\n' + saida));
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
const entra = () => pede('POST', '/crm/entrar', { usuario: CONTA, senha: SENHA });

function respostas(extra) {
  return Object.assign({
    nome: 'Joana Teste da Silva', telefone: '(35) 99716-4668', email: 'joana@exemplo.com',
    instagram: '@joana.teste', cidade: 'Pouso Alegre', estado: 'MG', faixa_idade: '25-34',
    situacao: 'outra-area', meta_renda: '2k-5k', objetivo: 'quero atender em casa',
    quando_comecar: 'agora', disponibilidade: 'sim', prefere_formato: 'presencial',
    interesse: 'iniciante', lead_uid: 'crm-' + Math.random().toString(36).slice(2, 12),
  }, extra || {});
}

async function rodada(titulo, fn, env) {
  console.log('\n== ' + titulo + '  (arranque frio)');
  const p = await sobe(env);
  try { await fn(); } finally { await derruba(p); }
}

/* Lê a tabela `recebidos` pelo painel. Existe uma rota só para o gate? Não —
   ele lê pelo endpoint do painel, que é o mesmo que a Nataly vê. Testar por um
   caminho que só o teste usa provaria que o teste funciona, não o produto. */
async function perdidos(cookie) {
  const r = await pede('GET', '/crm/api/recebidos-perdidos', undefined, cookie);
  return (r.j && r.j.recebidos) || [];
}

async function principal() {
  fs.rmSync(path.join(__dirname, DIR), { recursive: true, force: true });

  /* ============================================================
     1. ENVIO VÁLIDO VIRA LINHA — e o recebido aponta para ela
     ============================================================ */
  await rodada('1. envio válido vira lead, e fica rastreado', async () => {
    const d = respostas();
    const r = await pede('POST', '/api/lead-presencial', d);
    ok('o envio é aceito', r.j && r.j.ok === true, r.texto.slice(0, 200));

    const login = await entra();
    const lista = await pede('GET', '/crm/api/leads?completo=tudo&limite=200', undefined, login.cookie);
    const lead = ((lista.j && lista.j.leads) || []).find((l) => l.lead_uid === d.lead_uid);
    ok('virou linha no CRM', !!lead);
    if (lead) {
      eq('nasce marcado com a origem do funil', lead.origem, 'funil-presencial');
      /* O driver é `log`, que dá por enviado — o que importa aqui é que a
         coluna EXISTE e é escrita, não o valor. */
      ok('e a linha carrega o estado do aviso', typeof lead.aviso_estado === 'string',
         String(lead.aviso_estado));
    }
    /* O envio bom NÃO pode aparecer como perdido. */
    const p = await perdidos(login.cookie);
    ok('🔴 e NÃO aparece na lista de perdidos', !p.some((x) => x.lead_uid === d.lead_uid));
  });

  /* ============================================================
     2. ENVIO INVÁLIDO NÃO SOME — vira dead-letter recuperável
     ============================================================
     🔴 ESTE É O CORAÇÃO DO GATE. Antes de 05/09/2026 um envio recusado ia
        embora com a requisição: 400 e ponto. Se a pessoa fechasse a aba,
        aquele lead nunca existiu para ninguém. */
  await rodada('2. envio inválido vira dead-letter, não vira zero', async () => {
    const ruim = respostas({ lead_uid: 'crm-ruim-' + Date.now() });
    delete ruim.interesse;          // falta a obrigatória
    delete ruim.faixa_investimento; // e não é o formulário antigo
    const r = await pede('POST', '/api/lead-presencial', ruim);
    ok('o envio é recusado, como tem de ser', r.j && r.j.ok === false && !!r.j.erros);

    const login = await entra();
    const lista = await pede('GET', '/crm/api/leads?completo=tudo&limite=200', undefined, login.cookie);
    ok('e NÃO virou lead (a validação continua valendo)',
       !((lista.j && lista.j.leads) || []).some((l) => l.lead_uid === ruim.lead_uid));

    const p = await perdidos(login.cookie);
    const meu = p.find((x) => x.lead_uid === ruim.lead_uid);
    ok('🔴 MAS FICOU GRAVADO como recebido perdido', !!meu,
       'perdidos vistos: ' + p.length);
    if (meu) {
      ok('com o motivo da recusa', /interesse/.test(String(meu.motivo)), String(meu.motivo));
      /* 🔴 O CORPO CRU TEM DE ESTAR LÁ. É ele que torna o lead recuperável:
         sem o telefone dentro, a linha só diz "alguém sumiu", que não serve
         para ligar para ninguém. */
      ok('e com o CORPO CRU, que é o que permite ligar para ela',
         /99716-4668/.test(String(meu.corpo)) && /Joana/.test(String(meu.corpo)),
         String(meu.corpo).slice(0, 120));
    }
  });

  /* ============================================================
     3. FALHA DE NOTIFICAÇÃO NÃO APAGA A LINHA
     ============================================================
     Sobe com a Evolution apontando para um endereço morto: o envio do aviso
     vai falhar de verdade, e o lead tem de sobreviver a isso. */
  await rodada('3. WhatsApp fora do ar não custa o lead', async () => {
    const d = respostas({ lead_uid: 'crm-wa-' + Date.now() });
    const r = await pede('POST', '/api/lead-presencial', d);
    ok('o envio é aceito mesmo com o WhatsApp fora', r.j && r.j.ok === true, r.texto.slice(0, 200));

    const login = await entra();
    const lista = await pede('GET', '/crm/api/leads?completo=tudo&limite=200', undefined, login.cookie);
    const lead = ((lista.j && lista.j.leads) || []).find((l) => l.lead_uid === d.lead_uid);
    ok('🔴 e a linha existe no CRM assim mesmo', !!lead);
    if (lead) {
      /* 🔴 E NÃO PODE CONSTAR COMO AVISADA. Foi exatamente isso que enganou
         todo mundo por cinco dias: o sistema dando por enviado o que não
         saiu. Com a Evolution morta, o estado tem de ser 'pendente'. */
      ok('🔴 e NÃO consta como avisada', lead.aviso_estado !== 'enviado',
         'aviso_estado=' + lead.aviso_estado);
    }
  }, { NATALY_WA_DRIVER: 'evolution', NATALY_WA_URL: 'http://127.0.0.1:9',
       NATALY_WA_KEY: 'x', NATALY_WA_INSTANCIA: 'nataly',
       NATALY_WA_DESTINO: '120363412975098009@g.us' });

  /* ============================================================
     4. DUAS PORTAS, A MESMA TABELA
     ============================================================
     O lead importado do Meta e o lead do formulário do site têm de conviver na
     MESMA tabela, distinguíveis pela origem. Se amanhã nascer outra porta, ela
     escreve aqui também — e não num lugar novo que ninguém olha. */
  await rodada('4. porta do site e porta importada caem na mesma tabela', async () => {
    const d = respostas({ lead_uid: 'crm-porta-' + Date.now() });
    await pede('POST', '/api/lead-presencial', d);

    const login = await entra();
    const antes = await pede('GET', '/crm/api/leads?completo=tudo&limite=300', undefined, login.cookie);
    const n0 = ((antes.j && antes.j.leads) || []).length;

    /* Importa uma linha pela MESMA função que o importador do Meta usa. */
    const L = require('./leads');
    const db = require('./db');
    process.env.FUNIL_DEV_DIR = DIR;
    /* O gate fala com o servidor por HTTP; abrir o PGlite daqui abortaria o
       WASM (processo único). Então a porta importada é exercitada pelo
       endpoint de importação do painel, que é como ela roda de verdade. */
    void L; void db;

    const imp = await pede('POST', '/crm/api/importar', {
      origem: 'meta-lead-ads',
      registros: [{
        origem_id: 'gate-form-1', nome: 'Importada Do Meta',
        telefone: '+5535984353209', email: 'importada@exemplo.com',
        criado_em: '2026-08-21T00:18:35+0000',
      }],
    }, login.cookie);
    ok('a importação responde', imp.j && imp.j.ok === true, imp.texto.slice(0, 200));

    const dep = await pede('GET', '/crm/api/leads?completo=tudo&limite=300', undefined, login.cookie);
    const leads = (dep.j && dep.j.leads) || [];
    eq('entrou exatamente uma linha nova', leads.length, n0 + 1);
    const vinda = leads.find((l) => l.origem_id === 'gate-form-1');
    ok('🔴 e ela está na MESMA tabela do lead do site', !!vinda);
    if (vinda) {
      eq('marcada com a origem certa', vinda.origem, 'meta-lead-ads');
      /* 🔴 A DATA É A DA ORIGEM, NÃO A DA IMPORTAÇÃO. A Nataly precisa saber
         que este contato é de agosto, não de hoje: ligar dizendo "vi que você
         se inscreveu agora" para quem se inscreveu há duas semanas queima. */
      ok('e com a data REAL da origem, não a de hoje',
         String(vinda.criado_em).slice(0, 10) === '2026-08-21', String(vinda.criado_em));
      /* 🔴 O QUE NÃO VEIO FICA NULO. Ela vai LIGAR para essa pessoa: um dado
         deduzido faz a Nataly passar vergonha. */
      eq('o que a origem não tinha fica NULO: cidade', vinda.cidade, null);
      eq('...e interesse', vinda.interesse, null);
      eq('...e situação', vinda.situacao, null);
      ok('🔴 e nada de produto inventado', !vinda.produto_id, String(vinda.produto_id));
    }

    /* Rodar de novo NÃO pode duplicar. */
    const imp2 = await pede('POST', '/crm/api/importar', {
      origem: 'meta-lead-ads',
      registros: [{
        origem_id: 'gate-form-1', nome: 'Importada Do Meta',
        telefone: '+5535984353209', criado_em: '2026-08-21T00:18:35+0000',
      }],
    }, login.cookie);
    const dep2 = await pede('GET', '/crm/api/leads?completo=tudo&limite=300', undefined, login.cookie);
    eq('🔴 reimportar não cria gêmeo', ((dep2.j && dep2.j.leads) || []).length, n0 + 1);
    ok('e a resposta diz que pulou', imp2.j && imp2.j.pulados >= 1, JSON.stringify(imp2.j));

    /* Dedupe por TELEFONE, mesmo com origem_id diferente e formato diferente. */
    const imp3 = await pede('POST', '/crm/api/importar', {
      origem: 'meta-lead-ads',
      /* Mesma pessoa, OUTRO formato: sem DDI, como o Meta às vezes entrega
         ('8892609066' veio assim de verdade). Se o dedupe só casasse string
         literal, ela viraria uma segunda linha e a Nataly ligaria duas vezes. */
      registros: [{ origem_id: 'gate-form-2', nome: 'Mesma Pessoa Outro Id',
                    telefone: '35984353209', criado_em: '2026-08-22T00:00:00+0000' }],
    }, login.cookie);
    const dep3 = await pede('GET', '/crm/api/leads?completo=tudo&limite=300', undefined, login.cookie);
    eq('🔴 dedupe por telefone normalizado também segura',
       ((dep3.j && dep3.j.leads) || []).length, n0 + 1);
    ok('e diz que pulou por telefone', imp3.j && imp3.j.pulados >= 1, JSON.stringify(imp3.j));
  });

  console.log('\n' + '─'.repeat(60));
  if (falhas) { console.log(falhas + ' FALHA(S) de ' + checagens.length + '.'); process.exit(1); }
  console.log('GATE DO CRM: TUDO CERTO — ' + checagens.length + ' checagens, 4 rodadas frias.');
  console.log('=== FIM DO GATE DO CRM ===');
  process.exit(0);
}

principal().catch((e) => {
  console.error('\n🔴 O GATE ESTOUROU (isto NÃO é aprovação):', (e && e.stack) || e);
  process.exit(1);
});

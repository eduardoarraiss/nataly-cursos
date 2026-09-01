/* ============================================================
   BANCO DO FUNIL — adaptador de um driver só para dois destinos
   ============================================================
   Produção : Postgres de verdade (Railway), via DATABASE_URL.
   Dev/teste: PGlite — o mesmo Postgres compilado em WASM, rodando
              dentro do Node, sem servidor e sem custo.

   Por que assim: o SQL é ESCRITO UMA VEZ e roda igual nos dois. Sem
   isso, testar localmente exigiria criar um banco pago no Railway
   antes de saber se o código funciona — que é exatamente o que não
   se pode fazer sem o aval do Eduardo.

   Os dois falam o mesmo dialeto e o mesmo placeholder ($1, $2...),
   então nada aqui é "quase Postgres": é Postgres.
   ============================================================ */
const fs = require('fs');
const path = require('path');

let _driver = null;   // 'pg' | 'pglite'
let _cli = null;      // Pool (pg) ou PGlite
let _pronto = null;   // Promise da inicialização (memoizada)

/* Diretório do banco de desenvolvimento. Os testes apontam para um PRÓPRIO
   (FUNIL_DEV_DIR=.dados-teste): eles apagam as tabelas no início, e sem essa
   separação rodar a suíte limparia os leads que você acabou de semear para
   olhar no painel. */
const DEV_DIR = process.env.FUNIL_DEV_DIR
  ? path.resolve(__dirname, process.env.FUNIL_DEV_DIR)
  : path.join(__dirname, '.dados-dev');

/* ---------- inicialização ---------- */
async function iniciar() {
  if (_pronto) return _pronto;
  _pronto = (async () => {
    const url = process.env.DATABASE_URL;

    if (url) {
      const pg = require('pg');
      // int8 (BIGSERIAL) volta como string por padrão no pg e como número no
      // PGlite. Sem isto, `lead.id` teria tipo diferente nos dois ambientes e
      // uma comparação estrita passaria em dev e falharia em produção.
      pg.types.setTypeParser(20, (v) => parseInt(v, 10));

      // O Postgres do Railway usa certificado próprio. Na rede interna do
      // projeto (postgres.railway.internal) o tráfego não sai da VPC.
      const interno = /\.railway\.internal/.test(url);
      _cli = new pg.Pool({
        connectionString: url,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ssl: interno ? false : { rejectUnauthorized: false },
      });
      _cli.on('error', (e) => console.error('[funil/db] erro ocioso no pool:', e.message));
      _driver = 'pg';
      await _cli.query('SELECT 1');
      console.log('[funil/db] Postgres conectado (' + (interno ? 'rede interna' : 'rede pública') + ')');
    } else {
      const { PGlite } = require('@electric-sql/pglite');
      fs.mkdirSync(DEV_DIR, { recursive: true });
      _cli = new PGlite(DEV_DIR);
      await _cli.waitReady;
      _driver = 'pglite';
      console.log('[funil/db] SEM DATABASE_URL — usando PGlite local em ' + DEV_DIR);
      console.log('[funil/db] (isto é banco de DESENVOLVIMENTO; em produção defina DATABASE_URL)');
      console.log('[funil/db] ⚠️  PGlite é de PROCESSO ÚNICO: não abra este mesmo diretório');
      console.log('[funil/db]     em outro `node` enquanto o servidor roda, senão o WASM aborta.');
      console.log('[funil/db]     Para inspecionar os dados com o servidor de pé, use a API /crm.');
    }
    return _cli;
  })();
  return _pronto;
}

/* ---------- consulta ---------- */
async function consulta(sql, params = []) {
  await iniciar();
  const r = await _cli.query(sql, params);
  return { rows: r.rows || [], rowCount: r.rows ? r.rows.length : (r.rowCount || 0) };
}

/* ---------- várias instruções de uma vez (schema) ---------- */
async function executar(sql) {
  await iniciar();
  if (_driver === 'pglite') return _cli.exec(sql);
  return _cli.query(sql);
}

/* ---------- migração ---------- */
async function migrar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await executar(sql);
  console.log('[funil/db] schema aplicado (' + _driver + ')');
}

function driver() { return _driver; }

/* ---------- encerramento limpo ---------- */
async function fechar() {
  if (!_cli) return;
  try {
    if (_driver === 'pg') await _cli.end();
    else await _cli.close();
  } catch (e) { /* já fechado */ }
  _cli = null; _pronto = null; _driver = null;
}

module.exports = { iniciar, consulta, executar, migrar, driver, fechar };

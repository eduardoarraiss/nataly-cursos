/* ============================================================
   TESTE DA CAPTURA PARCIAL — o lead que não terminou
   ============================================================
   Uso: FUNIL_DEV_DIR=.dados-teste node funil-presencial/teste-parcial.js

   Cobre as quatro coisas que, se quebrarem, quebram em silêncio:

     1. A MIGRAÇÃO EM BANCO QUE JÁ EXISTE. Em 01/09/2026 um índice colocado
        antes de um ALTER abortou o schema inteiro e derrubou o envio de leads
        em produção. Aqui a migração roda de verdade contra um banco criado
        com o schema ANTIGO — não contra um vazio, que é onde esse defeito
        não aparece.
     2. O UPSERT. Sete chamadas do mesmo preenchimento têm de virar UMA linha,
        e o envio final tem de PROMOVER essa linha em vez de criar uma segunda.
     3. O AVISO. Uma mensagem por pessoa, nunca duas, e só depois do silêncio.
     4. O TEXTO. A mensagem tem de dizer que está INCOMPLETA e onde ela parou.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('./db');
const L = require('./leads');
const N = require('./notificador');

let falhas = 0, total = 0;
function ok(nome, cond, extra) {
  total++;
  if (cond) console.log('ok     ' + nome);
  else { falhas++; console.log('FALHA  ' + nome + (extra ? '  → ' + extra : '')); }
}
const eq = (nome, a, b) => ok(nome, a === b,
  'esperava ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a));

const uid = (s) => 'teste-parcial-' + s + '-' + Date.now();

/* ============================================================
   1. A MIGRAÇÃO CONTRA UM BANCO ANTIGO
   ============================================================
   Roda num PGlite descartável, à parte do banco de teste do resto da suíte:
   aqui é preciso um banco que nasça com o schema DE ONTEM, e o banco da suíte
   já está migrado desde o primeiro `db.migrar()`.

   O schema de ontem vem do backup que ficou ao lado do arquivo. Se um dia
   ninguém guardar mais backup, este teste diz isso em voz alta em vez de
   passar calado — um teste que se autodesliga é pior que teste nenhum. */
async function migracaoEmBancoAntigo() {
  console.log('\n-- 1. a migração roda em banco que JÁ EXISTE --');

  const antigo = path.join(__dirname, 'schema.sql.bak-pre-parcial-20260902');
  if (!fs.existsSync(antigo)) {
    ok('o schema antigo está disponível para o teste', false,
       'não achei ' + antigo + ' — sem ele NÃO dá para provar que a migração ' +
       'funciona em banco existente, que é exatamente o defeito de 01/09/2026');
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-migra-'));
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite(dir);
  await pg.waitReady;

  try {
    // ---- o mundo de ontem: schema antigo + leads dentro dele ----
    await pg.exec(fs.readFileSync(antigo, 'utf8'));
    await pg.query(
      "INSERT INTO leads (nome, telefone, instagram, cidade, disponibilidade, " +
      "aceita_valor, situacao, produto_id, produto_nome, produto_formato, " +
      "produto_valor, pontuacao, qualificacao, lead_uid) " +
      "VALUES ('Lead De Ontem','5535997164668','ontem','Cambuí','sim','sim'," +
      "'ja-lash','lash2-presencial','Método LED — presencial','presencial'," +
      "1997, 88, 'quente', 'lead-de-ontem')");
    const antes = await pg.query('SELECT COUNT(*)::int AS n FROM leads');
    eq('o banco antigo tem o lead de ontem', antes.rows[0].n, 1);

    // ---- e agora o schema de hoje, inteiro, de uma vez ----
    let erroMigracao = null;
    try {
      await pg.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    } catch (e) {
      erroMigracao = e.message;
    }
    ok('a migração roda inteira sobre o banco antigo, sem abortar', !erroMigracao, erroMigracao);
    if (erroMigracao) return;

    // ---- as colunas novas nasceram? ----
    const cols = await pg.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'leads'");
    const nomes = cols.rows.map((c) => c.column_name);
    ['completo', 'ultima_etapa', 'avisado_parcial_em'].forEach((c) => {
      ok('a coluna ' + c + ' existe depois da migração', nomes.indexOf(c) !== -1);
    });
    const colAviso = await pg.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'avisos'");
    ok('a coluna tipo existe em avisos',
       colAviso.rows.map((c) => c.column_name).indexOf('tipo') !== -1);

    // ---- e o índice sobre a coluna nova? Se o ALTER tivesse abortado, ele
    //      também não existiria — é a segunda testemunha do mesmo fato.
    const idx = await pg.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'leads'");
    const ixs = idx.rows.map((r) => r.indexname);
    ok('o índice idx_leads_completo foi criado', ixs.indexOf('idx_leads_completo') !== -1);
    ok('o índice idx_leads_produto continua de pé', ixs.indexOf('idx_leads_produto') !== -1);

    // ---- os NOT NULL que precisavam cair, caíram ----
    const nn = await pg.query(
      "SELECT column_name, is_nullable FROM information_schema.columns " +
      "WHERE table_name = 'leads' AND column_name IN " +
      "('instagram','cidade','disponibilidade','aceita_valor','nome','telefone')");
    const mapa = {};
    nn.rows.forEach((r) => { mapa[r.column_name] = r.is_nullable; });
    ['instagram', 'cidade', 'disponibilidade', 'aceita_valor'].forEach((c) => {
      eq('a coluna ' + c + ' aceita nulo (o parcial não a tem ainda)', mapa[c], 'YES');
    });
    /* Estas DUAS continuam obrigatórias, e é o que sustenta a promessa: toda
       linha do banco tem um contato que dá para chamar. */
    eq('nome continua obrigatório',     mapa.nome, 'NO');
    eq('telefone continua obrigatório', mapa.telefone, 'NO');

    // ---- o lead de ontem foi marcado como COMPLETO ----
    const velho = await pg.query("SELECT completo FROM leads WHERE lead_uid = 'lead-de-ontem'");
    eq('o lead de ontem virou completo (ele veio do envio final)', velho.rows[0].completo, true);

    // ---- e um PARCIAL vivo NÃO pode ser promovido por um restart ----
    await pg.query(
      "INSERT INTO leads (nome, telefone, ultima_etapa, completo, lead_uid) " +
      "VALUES ('Parcial Vivo','5535997164668','10', false, 'parcial-vivo')");
    await pg.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    const vivo = await pg.query("SELECT completo FROM leads WHERE lead_uid = 'parcial-vivo'");
    ok('🔴 rodar a migração DE NOVO não promove um parcial vivo a completo',
       vivo.rows[0].completo === false,
       'o backfill do schema marcou como completo quem estava no meio do formulário — ' +
       'todo restart apagaria os avisos de incompleto');

    // ---- idempotência: uma terceira passada não pode explodir ----
    let erro3 = null;
    try { await pg.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')); }
    catch (e) { erro3 = e.message; }
    ok('a migração é idempotente (roda a cada boot)', !erro3, erro3);
  } finally {
    try { await pg.close(); } catch (e) { /* já fechado */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}

/* ============================================================
   2, 3 e 4 — no banco de teste da suíte
   ============================================================ */
(async () => {
  await migracaoEmBancoAntigo();

  await db.migrar();
  await db.consulta('DELETE FROM avisos');
  await db.consulta('DELETE FROM leads_historico');
  await db.consulta('DELETE FROM leads');

  console.log('\n-- 2. o gatilho: nome + WhatsApp, e nada menos --');
  ok('só o nome não grava',
     L.validaParcial({ nome: 'Joana Teste' }).ok === false);
  ok('só o telefone não grava',
     L.validaParcial({ telefone: '(35) 99716-4668' }).ok === false);
  ok('telefone inválido não grava',
     L.validaParcial({ nome: 'Joana Teste', telefone: '123' }).ok === false);
  const g = L.validaParcial({ nome: 'Joana Teste', telefone: '(35) 99716-4668' });
  ok('nome + WhatsApp válido é o gatilho', g.ok === true);
  eq('o telefone sai normalizado', g.lead.telefone, '5535997164668');

  ok('campo opcional inválido vira null, não erro',
     L.validaParcial({ nome: 'Joana Teste', telefone: '35997164668',
                       email: 'nao-e-email', instagram: 'com espaço' }).lead.email === null);
  eq('etapa fora do vocabulário é descartada',
     L.validaParcial({ nome: 'J T', telefone: '35997164668', ultima_etapa: '<script>' }).lead.ultima_etapa,
     null);
  eq('etapa condicional 5.5 é aceita',
     L.validaParcial({ nome: 'J T', telefone: '35997164668', ultima_etapa: '5.5' }).lead.ultima_etapa,
     '5.5');

  console.log('\n-- 3. o upsert: sete chamadas, uma linha só --');
  const u1 = uid('upsert');
  const p1 = await L.criaParcial({ nome: 'Joana Upsert', telefone: '5535997164668',
                                   cidade: 'Pouso Alegre', ultima_etapa: '4', lead_uid: u1 });
  ok('a primeira chamada grava', !!p1);
  eq('e nasce incompleta', p1.completo, false);

  const p2 = await L.criaParcial({ nome: 'Joana Upsert', telefone: '5535997164668',
                                   instagram: 'joanaupsert', situacao: 'ja-lash',
                                   ultima_etapa: '10', lead_uid: u1 });
  eq('a segunda cai na MESMA linha', p2.id, p1.id);
  eq('e avança a etapa', p2.ultima_etapa, '10');

  /* A trava do COALESCE: chamada sem cidade não pode apagar a cidade. */
  const p3 = await L.criaParcial({ nome: 'Joana Upsert', telefone: '5535997164668',
                                   ultima_etapa: '10', lead_uid: u1 });
  eq('🔴 uma chamada sem cidade NÃO apaga a cidade já gravada', p3.cidade, 'Pouso Alegre');
  eq('nem o instagram', p3.instagram, 'joanaupsert');

  const umaSo = await db.consulta('SELECT COUNT(*)::int AS n FROM leads WHERE lead_uid = $1', [u1]);
  eq('quatro chamadas, UMA linha', umaSo.rows[0].n, 1);

  console.log('\n-- 3b. o envio final PROMOVE a mesma linha --');
  const completo = await L.cria({
    nome: 'Joana Upsert', telefone: '5535997164668', cidade: 'Pouso Alegre',
    instagram: 'joanaupsert', situacao: 'ja-lash', busca: 'tecnica-led',
    disponibilidade: 'sim', prefere_formato: 'presencial',
    faixa_investimento: 'acima-2000', aceita_valor: 'sim',
    produto_id: 'lash2-presencial', produto_valor: 1997,
    pontuacao: 88, qualificacao: 'quente', lead_uid: u1,
  });
  eq('é a MESMA linha do parcial', completo.id, p1.id);
  eq('agora está completa', completo.completo, true);
  eq('a etapa de parada é zerada (ela terminou)', completo.ultima_etapa, null);
  ok('🔴 e a Nataly É avisada — o lead completo não pode cair no ramo de dedupe',
     completo.novo === true,
     'o `novo` veio false: com a gravação parcial existe SEMPRE conflito no ' +
     'envio final, e um `novo` mal calculado faria a Nataly parar de ser avisada');

  const dupla = await L.cria({
    nome: 'Joana Upsert', telefone: '5535997164668', cidade: 'Pouso Alegre',
    instagram: 'joanaupsert', situacao: 'ja-lash', busca: 'tecnica-led',
    disponibilidade: 'sim', prefere_formato: 'presencial',
    faixa_investimento: 'acima-2000', aceita_valor: 'sim',
    produto_id: 'lash2-presencial', produto_valor: 1997,
    pontuacao: 88, qualificacao: 'quente', lead_uid: u1,
  });
  eq('o duplo clique não avisa de novo', dupla.novo, false);
  eq('e continua sendo uma linha só', dupla.id, p1.id);

  console.log('\n-- 3c. o parcial atrasado não estraga o lead pronto --');
  const atrasado = await L.criaParcial({ nome: 'Joana Upsert', telefone: '5535997164668',
                                         ultima_etapa: '10', lead_uid: u1 });
  ok('🔴 o beacon que chega depois do envio final é RECUSADO', atrasado === null,
     'ele sobrescreveria o lead pronto com uma foto pela metade');
  const intacto = await L.porId(p1.id);
  eq('o produto indicado continua lá', intacto.produto_id, 'lash2-presencial');
  eq('e o lead continua completo', intacto.completo, true);

  console.log('\n-- 4. o aviso de incompleto: uma vez, e só depois do silêncio --');
  await db.consulta('DELETE FROM avisos');
  const u2 = uid('aviso');
  const parado = await L.criaParcial({
    nome: 'Marina Que Parou', telefone: '5535997164668', cidade: 'Cambuí',
    instagram: 'marina', situacao: 'ja-lash', busca: 'tecnica-led',
    disponibilidade: 'sim', prefere_formato: 'presencial',
    ultima_etapa: '10', lead_uid: u2,
  });

  const agora = await L.parciaisParaAvisar(20);
  ok('quem acabou de parar NÃO é avisada ainda (o silêncio não passou)',
     agora.filter((l) => l.id === parado.id).length === 0);

  /* Envelhece a linha à força: 40 minutos parada. */
  await db.consulta(
    "UPDATE leads SET atualizado_em = now() - interval '40 minutes' WHERE id = $1", [parado.id]);
  const esfriou = await L.parciaisParaAvisar(20);
  ok('depois do silêncio, ela entra na varredura',
     esfriou.filter((l) => l.id === parado.id).length === 1);

  const v1 = await N.varreParciais();
  eq('a varredura enfileirou uma mensagem', v1.enfileirados, 1);
  const v2 = await N.varreParciais();
  ok('🔴 a segunda varredura NÃO avisa de novo (uma mensagem por pessoa)',
     v2.enfileirados === 0,
     'a Nataly receberia lembrete de lead pela metade e pararia de ler o grupo');

  const avisos = await db.consulta('SELECT * FROM avisos WHERE lead_id = $1', [parado.id]);
  eq('há exatamente um aviso para ela', avisos.rows.length, 1);
  eq('e ele está marcado como parcial', avisos.rows[0].tipo, 'parcial');

  /* Um lead COMPLETO nunca pode aparecer na varredura de incompletos. */
  const soParciais = await L.parciaisParaAvisar(0);
  ok('nenhum lead completo entra na varredura de incompletos',
     soParciais.every((l) => l.completo === false));

  console.log('\n-- 5. o texto da mensagem --');
  const msg = N.montaMensagemParcial(await L.porId(parado.id));
  ok('diz, no cabeçalho, que está INCOMPLETO', /INCOMPLETO/.test(msg));
  ok('diz em qual pergunta ela parou', /Parou na pergunta \d+ de \d+/.test(msg));
  ok('nomeia a pergunta do investimento', /faixa de investimento/.test(msg));
  ok('avisa que é a pergunta que mais derruba gente', /onde\s*\n?mais gente desiste/.test(msg));
  ok('🔴 não se apresenta como LEAD NOVO', msg.indexOf('LEAD NOVO') === -1);
  ok('leva o link do WhatsApp', msg.indexOf('wa.me/5535997164668') !== -1);
  ok('🔴 a conversa abre VAZIA (nada de mensagem pronta na voz da Nataly)',
     msg.indexOf('?text=') === -1 && msg.indexOf('&text=') === -1);
  ok('não inventa produto nem preço para quem não chegou lá',
     msg.indexOf('R$') === -1 && msg.indexOf('Indicado') === -1);

  const msgCedo = N.montaMensagemParcial({
    nome: 'Quem Parou Cedo', telefone: '5535997164668', ultima_etapa: '4',
  });
  ok('quem parou cedo recebe o aviso de que ela não viu preço',
     /NÃO viu preço nenhum/.test(msgCedo));
  ok('e a mensagem diz que ela só deixou nome e WhatsApp',
     /só chegou a deixar o nome e o WhatsApp/.test(msgCedo));

  console.log('\n-- 6. onde ela parou, contado direito --');
  const eLash = L.descreveEtapa({ ultima_etapa: '10', situacao: 'ja-lash' });
  eq('quem já é lash tem 11 perguntas', eLash.total, 11);
  eq('e a do preço é a 11ª para ela', eLash.posicao, 11);
  ok('a do preço é reconhecida como a do preço', eLash.noPreco === true);
  const naoLash = L.descreveEtapa({ ultima_etapa: '10', situacao: 'outra-area' });
  eq('quem não é lash tem 10 perguntas', naoLash.total, 10);
  eq('e a do preço é a 10ª para ela', naoLash.posicao, 10);
  eq('etapa desconhecida não vira texto inventado', L.descreveEtapa({ ultima_etapa: '99' }), null);

  console.log('\n-- 7. a listagem separa os dois mundos --');
  const completas = await L.lista({});
  ok('o padrão da listagem são as COMPLETAS (nada muda para quem já usava)',
     completas.every((l) => l.completo === true));
  const parciais = await L.lista({ completo: 'nao' });
  ok('completo=nao devolve só quem parou no meio',
     parciais.length > 0 && parciais.every((l) => l.completo === false));
  const tudo = await L.lista({ completo: 'tudo' });
  ok('completo=tudo devolve os dois', tudo.length >= completas.length + parciais.length);
  const noPreco = await L.lista({ completo: 'nao', parou: 'preco' });
  ok('dá para filtrar quem travou no preço',
     noPreco.length > 0 && noPreco.every((l) => l.ultima_etapa === '10'));

  const r = await L.resumo();
  ok('o resumo conta os parciais à parte', r.parciais && r.parciais.total >= 1);
  ok('e diz quantas pararam no preço', r.parciais.noPreco >= 1);
  ok('🔴 o funil (produto/qualificação) NÃO conta parcial',
     r.porProduto.every((p) => p.produto_id !== '(sem produto)'),
     'um parcial não tem produto: contá-lo criaria uma fatia "(sem produto)" ' +
     'gigante e faria a taxa de conversão despencar sem que nada tivesse mudado');

  console.log('\n' + (falhas === 0
    ? 'TUDO CERTO (' + total + ' checagens).'
    : falhas + ' FALHA(S) de ' + total + '.'));
  await db.fechar();
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('ERRO NO TESTE:', e);
  process.exit(1);
});

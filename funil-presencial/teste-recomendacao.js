/* ============================================================
   TESTE DA TELA DA RECOMENDAÇÃO — quem viu o preço e não confirmou
   ============================================================
   Uso: FUNIL_DEV_DIR=.dados-teste node funil-presencial/teste-recomendacao.js

   Em 02/09/2026 o fim do formulário deixou de ser o envio. O pedido do
   Eduardo, nas palavras dele: "deveria ser apenas a de apresentar o melhor
   programa para a pessoa... E depois clicar em garantir vaga e dar a mensagem
   de form recebido".

   Isso criou um estado que não existia: a pessoa que respondeu TUDO, viu o
   curso indicado e o preço, e não clicou. Ela é o lead comercial mais forte
   deste funil — e as quatro coisas abaixo, se quebrarem, quebram em silêncio:

     1. A GRAVAÇÃO. A linha nasce INCOMPLETA, mas com o produto e o preço que
        ela viu. Sem as colunas da árvore, a Nataly abriria o painel e leria
        "parou na recomendação" sem saber QUAL recomendação.
     2. A NÃO-PROMOÇÃO. Ver o preço não é se inscrever. Se esta linha virasse
        `completo = true`, voltaríamos exatamente ao problema que o trabalho
        veio corrigir — e o `Lead` do Meta contaria quem só olhou a vitrine.
     3. O AVISO. Ela entra na varredura de parciais, como qualquer um que
        parou no meio — mas com um texto PRÓPRIO. O texto padrão diz "NÃO viu
        preço nenhum", que para ela é mentira.
     4. A PROMOÇÃO NO CLIQUE. Quando ela confirma, a MESMA linha vira
        inscrição — nunca uma segunda pessoa no painel.
   ============================================================ */
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

const uid = (s) => 'teste-rec-' + s + '-' + Date.now();

/* Uma pessoa que respondeu tudo e se qualifica para o presencial caro. */
function respostas(u) {
  return {
    nome: 'Marina Viu O Preço', telefone: '(35) 99716-4668', cidade: 'Pouso Alegre',
    estado: 'MG', instagram: '@marina_teste', faixa_idade: '25-34',
    situacao: 'ja-lash', busca: 'tecnica-led', meta_renda: '5k-10k',
    quando_comecar: 'agora', disponibilidade: 'sim', prefere_formato: 'presencial',
    faixa_investimento: 'acima-2000', lead_uid: u,
  };
}

(async () => {
  await db.migrar();

  /* ============================================================
     1. A GRAVAÇÃO — incompleta, mas COM o produto
     ============================================================ */
  console.log('\n-- 1. a linha nasce incompleta, com o produto que ela viu --');
  const u1 = uid('grava');
  const body = respostas(u1);

  const v = L.valida(body);
  ok('as respostas completas passam na validação do envio final', v.ok,
     JSON.stringify(v.erros));

  const { rec, colunas } = L.roteia(v.lead);
  Object.assign(v.lead, colunas);
  Object.assign(v.lead, L.qualifica(v.lead, rec));
  v.lead.lead_uid = u1;

  const linha = await L.criaRecomendacao(v.lead);
  ok('a recomendação gravou uma linha', !!linha);
  eq('🔴 e ela NÃO está completa — ver o preço não é se inscrever',
     linha.completo, false);
  eq('a etapa registrada é a da recomendação', linha.ultima_etapa, L.ETAPA_REC);
  ok('o PRODUTO que ela viu ficou gravado', !!linha.produto_id,
     'sem isto a Nataly liga sem saber o que oferecer');
  eq('e é o produto certo para estas respostas', linha.produto_id, 'lash2-presencial');
  ok('o PREÇO que ela viu ficou gravado', linha.produto_valor > 0);
  ok('a qualificação foi calculada', !!linha.qualificacao);
  ok('e a pontuação também', linha.pontuacao > 0);

  /* A tela recebe o mesmo produto que o banco guardou: se divergissem, a
     pessoa veria um preço e a Nataly cobraria outro. */
  const tela = L.paraTela(rec);
  eq('a tela mostra o MESMO produto que o banco gravou', tela.id, linha.produto_id);
  eq('e o presencial não recebe link de pagamento', tela.checkout, null);

  /* ============================================================
     2. O UPSERT — pedir a recomendação duas vezes é UMA linha
     ============================================================ */
  console.log('\n-- 2. pedir duas vezes não cria duas pessoas --');
  const linha2 = await L.criaRecomendacao(v.lead);
  eq('a segunda chamada cai na MESMA linha', linha2.id, linha.id);
  const quantas = await db.consulta('SELECT count(*)::int AS n FROM leads WHERE lead_uid = $1', [u1]);
  eq('e o banco tem uma linha só para este uid', quantas.rows[0].n, 1);

  /* ============================================================
     3. O AVISO — texto próprio, porque ela VIU o preço
     ============================================================ */
  console.log('\n-- 3. o aviso diz a verdade sobre ela --');
  const et = L.descreveEtapa(linha);
  ok('a etapa é reconhecida como a da recomendação', et && et.naRecomendacao === true);
  ok('e não é confundida com a pergunta do investimento', et && et.noPreco === false);

  await db.consulta(
    "UPDATE leads SET atualizado_em = now() - interval '40 minutes' WHERE id = $1", [linha.id]);
  const fila = await L.parciaisParaAvisar(20);
  eq('ela entra na varredura de quem parou', fila.filter((l) => l.id === linha.id).length, 1);

  const msg = N.montaMensagemParcial(await L.porId(linha.id));
  ok('o aviso diz que ela VIU o preço', msg.indexOf('VIU O PREÇO') !== -1, msg.slice(0, 200));
  ok('e nomeia o produto que ela viu', msg.indexOf('Método LED') !== -1);
  ok('e diz o valor', msg.indexOf('1.997') !== -1);
  ok('🔴 e NUNCA diz que ela não viu preço nenhum',
     msg.indexOf('NÃO viu preço nenhum') === -1,
     'esse é o texto de quem parou no meio das perguntas; para ela seria mentira, ' +
     'e a Nataly abriria a conversa errada');
  ok('deixa claro que não é inscrição fechada',
     msg.indexOf('não clicou') !== -1 || msg.indexOf('não confirmou') !== -1);

  /* ============================================================
     4. O CLIQUE — a MESMA linha vira inscrição
     ============================================================ */
  console.log('\n-- 4. o clique promove a linha, não cria uma segunda --');
  const final = L.valida(respostas(u1));
  const r2 = L.roteia(final.lead);
  Object.assign(final.lead, r2.colunas);
  Object.assign(final.lead, L.qualifica(final.lead, r2.rec));
  final.lead.lead_uid = u1;

  const salvo = await L.cria(final.lead);
  eq('é a MESMA linha de antes', salvo.id, linha.id);
  eq('agora sim ela está completa', salvo.completo, true);
  eq('e a marca de "parou na recomendação" foi limpa', salvo.ultima_etapa, null);
  eq('vale avisar a Nataly (é a primeira vez que vira inscrição)', salvo.novo, true);

  const total1 = await db.consulta('SELECT count(*)::int AS n FROM leads WHERE lead_uid = $1', [u1]);
  eq('🔴 continua UMA linha só — a Nataly não vê a mesma pessoa duas vezes',
     total1.rows[0].n, 1);

  /* E o caminho de volta: um parcial atrasado (o beacon de saída) não pode
     rebaixar uma linha já completa. */
  const atrasado = await L.criaParcial({
    nome: 'Marina Viu O Preço', telefone: '5535997164668',
    ultima_etapa: '9', lead_uid: u1,
  });
  ok('🔴 um parcial atrasado NÃO rebaixa a inscrição pronta', atrasado === null,
     'o beacon de saída chega depois do envio e apagaria a indicação de produto');

  /* ============================================================
     5. O PAINEL — dá para achar essa gente
     ============================================================ */
  console.log('\n-- 5. o painel consegue listar quem viu o preço --');
  const u2 = uid('lista');
  const outra = L.valida(respostas(u2));
  const r3 = L.roteia(outra.lead);
  Object.assign(outra.lead, r3.colunas);
  Object.assign(outra.lead, L.qualifica(outra.lead, r3.rec));
  outra.lead.lead_uid = u2;
  await L.criaRecomendacao(outra.lead);

  const naRec = await L.lista({ completo: 'nao', parou: L.ETAPA_REC });
  ok('dá para filtrar quem parou na recomendação', naRec.length > 0);
  ok('e todas elas têm produto gravado', naRec.every((l) => !!l.produto_id),
     'é o que faz a ligação valer: a Nataly já sabe o que oferecer');
  ok('e nenhuma delas está completa', naRec.every((l) => l.completo === false));

  const completas = await L.lista({});
  ok('🔴 quem só viu o preço NÃO entra na lista padrão de inscrições',
     completas.every((l) => l.lead_uid !== u2),
     'se entrasse, a taxa de conversão do painel passaria a contar quem não quis');

  console.log('\n' + (falhas === 0
    ? 'TUDO CERTO (' + total + ' checagens).'
    : falhas + ' FALHA(S) de ' + total + '.'));
  await db.fechar();
  process.exit(falhas ? 1 : 0);
})().catch((e) => {
  console.error('ERRO NO TESTE:', e);
  process.exit(1);
});

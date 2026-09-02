/* Testes de unidade do funil. Rodam contra PGlite, sem servidor e sem custo.
   Uso: node funil-presencial/teste-unidade.js   (sai 0 se tudo passa) */
const db = require('./db');
const L = require('./leads');

let falhas = 0, total = 0;
function ok(nome, cond, extra) {
  total++;
  if (cond) console.log('ok     ' + nome);
  else { falhas++; console.log('FALHA  ' + nome + (extra ? '  → ' + extra : '')); }
}
const eq = (nome, a, b) => ok(nome, a === b, 'esperava ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a));

(async () => {
  await db.migrar();
  await db.consulta('DELETE FROM avisos');
  await db.consulta('DELETE FROM leads_historico');
  await db.consulta('DELETE FROM leads');

  console.log('\n-- telefone --');
  eq('celular com máscara',      L.normalizaTelefone('(35) 99716-4668'), '5535997164668');
  eq('celular só dígitos',       L.normalizaTelefone('35997164668'),     '5535997164668');
  eq('já com DDI',               L.normalizaTelefone('5535997164668'),   '5535997164668');
  eq('com +55 e espaços',        L.normalizaTelefone('+55 35 99716 4668'), '5535997164668');
  eq('fixo de 10 dígitos',       L.normalizaTelefone('3535221234'),      '5535352212 34'.replace(' ',''));
  eq('curto demais é rejeitado', L.normalizaTelefone('99716466'),        null);
  eq('DDD zerado é rejeitado',   L.normalizaTelefone('0135997164668'),   null);
  eq('vazio é rejeitado',        L.normalizaTelefone(''),                null);
  eq('formata de volta',         L.formataTelefone('5535997164668'),     '(35) 99716-4668');

  console.log('\n-- instagram --');
  eq('com arroba',      L.normalizaInstagram('@nataly.ribeiro'), 'nataly.ribeiro');
  eq('url completa',    L.normalizaInstagram('https://www.instagram.com/nataly.ribeiro/'), 'nataly.ribeiro');
  eq('url com query',   L.normalizaInstagram('instagram.com/nataly.ribeiro?igsh=abc'.replace('instagram','https://instagram')), 'nataly.ribeiro');
  eq('maiúsculas caem', L.normalizaInstagram('Nataly.Ribeiro'), 'nataly.ribeiro');
  eq('com espaço no meio é rejeitado', L.normalizaInstagram('nataly ribeiro'), null);

  console.log('\n-- qualificação --');
  /* A pontuação passou a depender do PRODUTO recomendado (a mesma faixa de
     investimento vale muito num caminho presencial e pouco num online), então
     ela recebe a recomendação junto. `rec()` roda a árvore para o mesmo lead,
     que é exatamente o que a rota faz. A árvore em si é testada à parte, em
     teste-arvore.js, nas 405 combinações. */
  const PRD = require('./produtos');
  const rec = (l) => PRD.recomenda(l);
  const comArvore = (l) => L.qualifica(l, rec(l));

  const q1 = comArvore({ disponibilidade:'sim', prefere_formato:'presencial',
    faixa_investimento:'acima-2000', situacao:'ja-lash', busca:'tecnica-led',
    quando_comecar:'agora' });
  eq('lead perfeito pontua 100', q1.pontuacao, 100);
  eq('lead perfeito é quente',   q1.qualificacao, 'quente');

  /* ⚠️ A TRAVA MUDOU EM 01/09/2026, e este teste mudou de LADO junto.
     Antes: "quem não pode vir a Cambuí nunca é quente" — verdade enquanto
     existia um produto só, presencial. Com quatro produtos, quem não pode vir
     recebe o online, que é uma venda pronta: marcá-la de fria escondia da
     Nataly justamente o lead que compra sem sair de casa. */
  const q2 = comArvore({ disponibilidade:'nao', prefere_formato:'online',
    faixa_investimento:'acima-2000', situacao:'ja-lash', busca:'tecnica-led',
    quando_comecar:'agora' });
  ok('quem não pode vir mas quer começar agora É quente (recebe o online)',
     q2.qualificacao === 'quente', 'veio ' + q2.qualificacao);

  /* A trava honesta é a que ela mesma declarou. */
  const q3 = comArvore({ disponibilidade:'sim', prefere_formato:'presencial',
    faixa_investimento:'acima-2000', situacao:'ja-lash', busca:'tecnica-led',
    quando_comecar:'so-olhando' });
  ok('quem diz que só está pesquisando NUNCA é quente',
     q3.qualificacao === 'frio', 'veio ' + q3.qualificacao);

  const q4 = comArvore({ disponibilidade:'talvez', prefere_formato:'nao-sei',
    faixa_investimento:'depende-parcelamento', situacao:'outra-area',
    quando_comecar:'30-dias' });
  eq('lead intermediário é morno', q4.qualificacao, 'morno');

  console.log('\n-- validação --');
  const vazio = L.valida({});
  ok('formulário vazio é recusado', !vazio.ok);
  /* Eram 6; a árvore trouxe mais 2 (`prefere_formato` e `faixa_investimento`)
     porque sem eles não há como decidir o produto — e recomendar no chute é
     pior do que não recomendar. `situacao` também virou obrigatório: era
     opcional quando existia um produto só, e agora é a raiz da árvore.
     A lista é conferida por NOME, não por contagem: "são 8" passaria mesmo se
     um campo certo tivesse sido trocado por outro. */
  const OBRIGATORIOS = ['nome','telefone','cidade','instagram','disponibilidade',
                        'situacao','prefere_formato','faixa_investimento'];
  const acusados = Object.keys(vazio.erros).sort().join(',');
  ok('acusa exatamente os 8 campos obrigatórios',
     acusados === OBRIGATORIOS.slice().sort().join(','), 'acusou ' + acusados);
  /* Quem não é lash não pode ser cobrada pela pergunta que nunca viu. */
  ok('e NÃO cobra a pergunta condicional de quem não a viu', !vazio.erros.busca);
  ok('a mensagem de erro é útil, não genérica',
     /DDD/.test(vazio.erros.telefone), vazio.erros.telefone);

  const bom = L.valida({
    nome:'Maria Silva', telefone:'(35) 99716-4668', cidade:'Cambuí', instagram:'@maria',
    disponibilidade:'sim', prefere_formato:'presencial', faixa_investimento:'acima-2000',
    situacao:'outra-area', quando_comecar:'agora',
    email:'maria@exemplo.com', estado:'mg', faixa_idade:'25-34', objetivo:'Quero mudar de vida',
  });
  ok('formulário completo passa', bom.ok, JSON.stringify(bom.erros));
  eq('estado vira maiúsculo', bom.lead.estado, 'MG');
  eq('e-mail normalizado', bom.lead.email, 'maria@exemplo.com');

  const injecao = L.valida({
    nome:'Maria', telefone:'35997164668', cidade:'Cambuí', instagram:'maria',
    disponibilidade:"sim'; DROP TABLE leads; --", faixa_investimento:'acima-2000',
    prefere_formato:'presencial', situacao:'outra-area',
  });
  ok('opção fora da lista vira erro, não vai para o banco', !injecao.ok && !!injecao.erros.disponibilidade);

  console.log('\n-- gravação --');
  const base = Object.assign({}, bom.lead, L.roteia(bom.lead).colunas,
    L.qualifica(bom.lead, rec(bom.lead)), {
    utm_source:'ig', utm_campaign:'presencial-set', utm_content:'ad-video-01',
    ip:'1.2.3.4', lead_uid:'uid-teste-1',
  });
  const l1 = await L.cria(base);
  ok('lead gravado com id', !!l1.id, JSON.stringify(l1));
  eq('gravou a qualificação', l1.qualificacao, 'quente');
  eq('nasce com status novo', l1.status, 'novo');
  ok('marca que é lead novo', l1.novo === true, 'novo=' + l1.novo);
  ok('id é número, não string', typeof l1.id === 'number', typeof l1.id);

  const l2 = await L.cria(base);
  eq('duplo envio NÃO cria lead gêmeo', l2.id, l1.id);
  ok('reenvio é marcado como não-novo', l2.novo === false, 'novo=' + l2.novo);
  const cont = await db.consulta('SELECT COUNT(*)::int AS n FROM leads');
  eq('continua tendo 1 lead no banco', cont.rows[0].n, 1);

  console.log('\n-- pipeline --');
  await L.mudaStatus(l1.id, 'contatado', 'Chamei no WhatsApp', 'nataly');
  const dep = await L.mudaStatus(l1.id, 'em-conversa', null, 'nataly');
  eq('status mudou', dep.status, 'em-conversa');
  const h = await L.historico(l1.id);
  eq('histórico tem 2 passos', h.length, 2);
  eq('guardou de onde veio', h[0].de_status, 'novo');
  eq('guardou a anotação', h[0].anotacao, 'Chamei no WhatsApp');
  eq('guardou o autor', h[0].autor, 'nataly');

  let erro = null;
  try { await L.mudaStatus(l1.id, 'inventado', null, 'x'); } catch (e) { erro = e; }
  ok('status inventado é recusado', !!erro);

  console.log('\n-- listagem e filtros --');
  eq('filtra por anúncio', (await L.lista({ utm_content:'ad-video-01' })).length, 1);
  eq('anúncio inexistente não traz nada', (await L.lista({ utm_content:'nao-existe' })).length, 0);
  eq('filtra por cidade sem acento exato', (await L.lista({ cidade:'cambu' })).length, 1);
  eq('busca por instagram', (await L.lista({ busca:'maria' })).length, 1);
  eq('filtra por status', (await L.lista({ status:'em-conversa' })).length, 1);

  const r = await L.resumo();
  eq('resumo conta o total', r.total, 1);
  ok('resumo agrupa por anúncio', r.porAnuncio.some(a => a.origem === 'ad-video-01'));

  await db.fechar();
  console.log('\n' + (falhas ? falhas + ' FALHA(S) de ' + total : 'TUDO CERTO — ' + total + ' checagens'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('ERRO FATAL', e); process.exit(1); });

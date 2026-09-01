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
  const q1 = L.qualifica({ disponibilidade:'sim', aceita_valor:'sim', situacao:'ja-lash', quando_comecar:'agora' });
  eq('lead perfeito pontua 100', q1.pontuacao, 100);
  eq('lead perfeito é quente',   q1.qualificacao, 'quente');

  const q2 = L.qualifica({ disponibilidade:'nao', aceita_valor:'sim', situacao:'ja-lash', quando_comecar:'agora' });
  ok('quem não pode vir a Cambuí NUNCA é quente', q2.qualificacao === 'frio', 'veio ' + q2.qualificacao);

  const q3 = L.qualifica({ disponibilidade:'sim', aceita_valor:'nao', situacao:'ja-lash', quando_comecar:'agora' });
  ok('quem não aceita o valor NUNCA é quente', q3.qualificacao === 'frio', 'veio ' + q3.qualificacao);

  const q4 = L.qualifica({ disponibilidade:'talvez', aceita_valor:'preciso-parcelar', situacao:'outra-area', quando_comecar:'30-dias' });
  eq('lead intermediário é morno', q4.qualificacao, 'morno');

  console.log('\n-- validação --');
  const vazio = L.valida({});
  ok('formulário vazio é recusado', !vazio.ok);
  ok('acusa os 6 campos obrigatórios', Object.keys(vazio.erros).length === 6,
     'acusou ' + Object.keys(vazio.erros).join(','));
  ok('a mensagem de erro é útil, não genérica',
     /DDD/.test(vazio.erros.telefone), vazio.erros.telefone);

  const bom = L.valida({
    nome:'Maria Silva', telefone:'(35) 99716-4668', cidade:'Cambuí', instagram:'@maria',
    disponibilidade:'sim', aceita_valor:'sim', situacao:'outra-area', quando_comecar:'agora',
    email:'maria@exemplo.com', estado:'mg', faixa_idade:'25-34', objetivo:'Quero mudar de vida',
  });
  ok('formulário completo passa', bom.ok, JSON.stringify(bom.erros));
  eq('estado vira maiúsculo', bom.lead.estado, 'MG');
  eq('e-mail normalizado', bom.lead.email, 'maria@exemplo.com');

  const injecao = L.valida({
    nome:'Maria', telefone:'35997164668', cidade:'Cambuí', instagram:'maria',
    disponibilidade:"sim'; DROP TABLE leads; --", aceita_valor:'sim',
  });
  ok('opção fora da lista vira erro, não vai para o banco', !injecao.ok && !!injecao.erros.disponibilidade);

  console.log('\n-- gravação --');
  const base = Object.assign({}, bom.lead, L.qualifica(bom.lead), {
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

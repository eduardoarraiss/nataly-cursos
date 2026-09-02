/* Testes do avisador: mensagem, fila, backoff e reenvio.
   Nada aqui toca o WhatsApp de verdade. */
const db = require('./db');
const L = require('./leads');
const N = require('./notificador');

let falhas = 0, total = 0;
function ok(nome, cond, extra) {
  total++;
  if (cond) console.log('ok     ' + nome);
  else { falhas++; console.log('FALHA  ' + nome + (extra ? '  → ' + extra : '')); }
}

(async () => {
  await db.migrar();
  await db.consulta('DELETE FROM avisos');
  await db.consulta('DELETE FROM leads_historico');
  await db.consulta('DELETE FROM leads');

  const lead = await L.cria({
    nome:'Maria Aparecida Silva', telefone:'5535997164668', instagram:'maria.lash',
    cidade:'Pouso Alegre', estado:'MG', email:'maria@exemplo.com',
    situacao:'outra-area', faixa_idade:'25-34', meta_renda:'5k-10k',
    quando_comecar:'agora', disponibilidade:'sim',
    prefere_formato:'presencial', faixa_investimento:'depende-parcelamento',
    aceita_valor:'preciso-parcelar',
    produto_id:'profissao-lash-presencial', produto_nome:'Profissão Lash — online + presencial',
    produto_formato:'presencial', produto_valor:1497,
    recomendacao_motivos:'Vem de outra área e quer começar do zero: começa pela formação completa.',
    objetivo:'Quero sair do meu emprego e viver de cílios',
    pontuacao:85, qualificacao:'quente',
    utm_source:'ig', utm_campaign:'presencial-setembro', utm_content:'video-bastidor-01',
    lead_uid:'uid-aviso-1',
  });

  console.log('\n-- a mensagem --');
  delete process.env.NATALY_WA_TESTE;
  const m = N.montaMensagem(lead);
  ok('tem o nome',           m.includes('Maria Aparecida Silva'));
  ok('tem a cidade',         m.includes('Pouso Alegre, MG'));
  ok('tem o Instagram',      m.includes('instagram.com/maria.lash'));
  ok('tem o telefone legível', m.includes('(35) 99716-4668'));
  ok('diz a meta',           m.includes('R$ 5 a 10 mil'));

  ok('diz de qual anúncio veio', m.includes('video-bastidor-01'));
  ok('diz a qualificação',   m.includes('QUENTE'));
  /* Pedido literal do Eduardo: o TÍTULO tem de dizer o produto para o qual
     ela se qualificou. Sem isso a Nataly abre o aviso sem saber que conversa
     vai ter — e com quatro produtos de R$ 297 a R$ 1.997, a conversa muda. */
  ok('o cabeçalho diz o PRODUTO', m.split('\n')[0].includes('Profissão Lash online + presencial'),
     m.split('\n')[0]);
  ok('diz o produto indicado e o preço', m.includes('🎯 *Indicado:*') && m.includes('R$ 1.497'));
  ok('avisa que o presencial não leva checkout', m.includes('combine a data antes'));
  ok('diz POR QUE foi indicado', m.includes('começa pela formação completa'));
  ok('mostra a faixa de investimento dela', m.includes('consegue mais se parcelar'));
  ok('tem link wa.me para responder', m.includes('https://wa.me/5535997164668'));
  /* 🔴 ESTE TESTE ESTÁ INVERTIDO DE PROPÓSITO, e a inversão é o ponto.
     Ele já cobrava o contrário — exigia que o link viesse com a saudação
     pronta ("Oi, Fulana! Aqui é a Nataly...") — e continuou cobrando depois
     que o Eduardo barrou a saudação em 01/09. Um teste que reprova o
     comportamento correto é pior que teste nenhum: a leitura óbvia da falha é
     "conserta o código", que aqui significa reintroduzir exatamente o que foi
     proibido. Agora ele guarda a regra em vez de atacá-la.
     Quem fala com a aluna é a Nataly, e o texto é dela. */
  ok('🔴 o link abre a conversa VAZIA, sem palavras na voz da Nataly',
     !/[?&]text=/.test(m), m.split('\n').pop());
  ok('sem prefixo de teste quando não é teste', !m.includes(N.PREFIXO_TESTE));

  console.log('\n-- modo teste (pedido literal do Eduardo) --');
  process.env.NATALY_WA_TESTE = '1';
  const mt = N.montaMensagem(lead);
  ok('mensagem de teste COMEÇA com o aviso combinado',
     mt.startsWith('Isso é um teste de uma automação, ignore'), mt.slice(0, 60));
  delete process.env.NATALY_WA_TESTE;

  console.log('\n-- lead sem origem --');
  const semUtm = Object.assign({}, lead, { utm_content:null, utm_campaign:null, utm_source:null });
  ok('diz que a origem é direta', N.montaMensagem(semUtm).includes('Entrou direto no site'),
     N.montaMensagem(semUtm).split('\n').filter(l=>l.indexOf('📢')===0)[0]);

  console.log('\n-- o cabeçalho muda com o produto --');
  /* O pedido do Eduardo é que o TÍTULO diga o produto. Um teste com um produto
     só provaria que o título tem um texto fixo, não que ele acompanha a
     árvore. Os quatro, então. */
  [['profissao-lash','Profissão Lash online'],
   ['profissao-lash-presencial','Profissão Lash online + presencial'],
   ['lash2-online','Método LED online'],
   ['lash2-presencial','Método LED presencial']].forEach(([id, titulo]) => {
    const cab = N.montaMensagem(Object.assign({}, lead, { produto_id:id })).split('\n')[0];
    ok('cabeçalho de ' + id, cab === '🔔 *LEAD NOVO* · ' + titulo, cab);
  });

  console.log('\n-- o caminho online avisa que o checkout já foi --');
  const online = Object.assign({}, lead, { produto_id:'lash2-online',
    produto_nome:'Método LED — online', produto_formato:'online', produto_valor:297 });
  const mo = N.montaMensagem(online);
  ok('diz que ela já recebeu o link', mo.includes('já recebeu o link do checkout'));
  ok('e mostra o preço DESSE produto', mo.includes('R$ 297'), mo.split('\n').filter(l=>l.includes('Indicado'))[0]);
  ok('sem o preço do outro produto', !mo.includes('R$ 1.497'));

  console.log('\n-- fila: caminho feliz --');
  process.env.NATALY_WA_DRIVER = 'log';
  process.env.NATALY_WA_DESTINO = '5535997164668';
  await N.enfileira(lead);
  let f = await db.consulta('SELECT * FROM avisos');
  ok('aviso nasce pendente', f.rows[0].status === 'pendente', f.rows[0].status);
  const r1 = await N.processaFila();
  ok('processou e enviou', r1.enviados === 1 && r1.erros === 0, JSON.stringify(r1));
  f = await db.consulta('SELECT * FROM avisos');
  ok('aviso ficou enviado', f.rows[0].status === 'enviado', f.rows[0].status);
  ok('gravou o horário de envio', !!f.rows[0].enviado_em);
  ok('não reenvia o que já saiu', (await N.processaFila()).vistos === 0);

  console.log('\n-- fila: WhatsApp fora do ar --');
  await db.consulta('DELETE FROM avisos');
  process.env.NATALY_WA_DRIVER = 'evolution';
  delete process.env.NATALY_WA_URL;   // força a falha
  const av = await N.enfileira(lead);
  const r2 = await N.processaFila();
  ok('a falha é contabilizada', r2.erros === 1, JSON.stringify(r2));
  f = await db.consulta('SELECT * FROM avisos WHERE id=$1', [av.id]);
  ok('continua pendente para nova tentativa', f.rows[0].status === 'pendente', f.rows[0].status);
  ok('contou a tentativa', f.rows[0].tentativas === 1, String(f.rows[0].tentativas));
  ok('guardou o motivo da falha', /não configurada/.test(f.rows[0].ultimo_erro || ''), f.rows[0].ultimo_erro);
  ok('adiou a próxima tentativa (backoff)',
     new Date(f.rows[0].proxima_em).getTime() > Date.now() + 60000, String(f.rows[0].proxima_em));

  ok('O LEAD NÃO SE PERDEU quando o aviso falhou',
     (await db.consulta('SELECT COUNT(*)::int n FROM leads')).rows[0].n === 1);

  console.log('\n-- backoff: desiste depois de esgotar --');
  for (let i = 0; i < N.MAX_TENTATIVAS + 1; i++) {
    await db.consulta("UPDATE avisos SET proxima_em = now() - interval '1 minute' WHERE id=$1", [av.id]);
    await N.processaFila();
  }
  f = await db.consulta('SELECT * FROM avisos WHERE id=$1', [av.id]);
  ok('após esgotar as tentativas vira falhou', f.rows[0].status === 'falhou', f.rows[0].status);

  const prob = await L.avisosProblema();
  ok('o painel enxerga o aviso que falhou', prob.length === 1 && prob[0].nome === 'Maria Aparecida Silva');

  console.log('\n-- reenvio manual pelo painel --');
  await N.reenfileira(av.id);
  f = await db.consulta('SELECT * FROM avisos WHERE id=$1', [av.id]);
  ok('voltou para pendente com contador zerado',
     f.rows[0].status === 'pendente' && f.rows[0].tentativas === 0);

  process.env.NATALY_WA_DRIVER = 'log';
  await N.processaFila();
  f = await db.consulta('SELECT * FROM avisos WHERE id=$1', [av.id]);
  ok('com o WhatsApp de volta, o aviso sai', f.rows[0].status === 'enviado', f.rows[0].status);

  await db.fechar();
  console.log('\n' + (falhas ? falhas + ' FALHA(S) de ' + total : 'TUDO CERTO — ' + total + ' checagens'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('ERRO FATAL', e); process.exit(1); });

/* ============================================================
   TESTE DA ÁRVORE DE DECISÃO — sem banco, sem rede, sem navegador
   ============================================================
   A árvore é a peça que decide para qual dos quatro produtos cada pessoa é
   mandada. Um erro aqui não quebra nada visivelmente: ele só manda a aluna
   errada para a oferta errada, calado, até alguém notar no faturamento. Por
   isso ela é testada sozinha, com os casos que o Eduardo listou.

   Uso: node funil-presencial/teste-arvore.js
   ============================================================ */
const PRD = require('./produtos');
const L = require('./leads');

let falhas = 0;
function ok(t) { console.log('ok     ' + t); }
function falha(t, esperado, veio) {
  console.log('FALHA  ' + t + '\n         esperava: ' + esperado + '\n         veio:     ' + veio);
  falhas++;
}
function eIgual(t, veio, esperado) {
  if (veio === esperado) ok(t); else falha(t, esperado, veio);
}

/* Uma resposta completa e neutra. Cada caso muda só o que interessa nele —
   assim o teste diz qual campo causou o quê, e não "mudei sete coisas". */
function respostas(extra) {
  return Object.assign({
    situacao: 'outra-area',
    busca: null,
    disponibilidade: 'sim',
    prefere_formato: 'nao-sei',
    faixa_investimento: 'acima-2000',
    quando_comecar: 'agora',
  }, extra || {});
}

function rota(extra) { return PRD.recomenda(respostas(extra)); }

console.log('== 1. A FAMÍLIA (o que ela busca)');

eIgual('não é lash → família Profissão Lash',
  rota({ situacao: 'outra-area' }).familia, 'profissao-lash');

eIgual('é da área da beleza mas não faz cílios → Profissão Lash',
  rota({ situacao: 'area-beleza' }).familia, 'profissao-lash');

eIgual('é lash + quer aprender LED → família Método LED',
  rota({ situacao: 'ja-lash', busca: 'tecnica-led' }).familia, 'metodo-led');

eIgual('é lash + quer se aperfeiçoar na extensão → Profissão Lash',
  rota({ situacao: 'ja-lash', busca: 'aperfeicoar-cilios' }).familia, 'profissao-lash');

eIgual('é lash + não sabe → Método LED (avanço natural de quem já atende)',
  rota({ situacao: 'ja-lash', busca: 'nao-sei' }).familia, 'metodo-led');

eIgual('...e essa é marcada como SUGESTÃO, não como veredito',
  rota({ situacao: 'ja-lash', busca: 'nao-sei' }).familiaIncerta, true);

eIgual('quem respondeu com convicção NÃO vira sugestão',
  rota({ situacao: 'ja-lash', busca: 'tecnica-led' }).familiaIncerta, false);

console.log('\n== 2. O FORMATO (distância → preferência → dinheiro, nesta ordem)');

eIgual('não pode vir a Cambuí → online, e acabou',
  rota({ disponibilidade: 'nao' }).formato, 'online');

eIgual('não pode vir → nem com dinheiro de sobra vira presencial',
  rota({ disponibilidade: 'nao', prefere_formato: 'presencial',
         faixa_investimento: 'acima-2000' }).formato, 'online');

eIgual('pode vir mas PREFERE online → online (a escolha dela manda)',
  rota({ disponibilidade: 'sim', prefere_formato: 'online',
         faixa_investimento: 'acima-2000' }).formato, 'online');

eIgual('pode vir e quer presencial → presencial',
  rota({ disponibilidade: 'sim', prefere_formato: 'presencial' }).formato, 'presencial');

eIgual('pode vir, não sabe o formato, dinheiro alcança → presencial (não canibaliza a oferta cara)',
  rota({ disponibilidade: 'sim', prefere_formato: 'nao-sei' }).formato, 'presencial');

eIgual('"talvez consigo ir" conta como poder vir',
  rota({ disponibilidade: 'talvez', prefere_formato: 'presencial' }).formato, 'presencial');

console.log('\n== 3. O DINHEIRO, e SÓ como último critério');

var travada = rota({ situacao: 'ja-lash', busca: 'tecnica-led',
                     disponibilidade: 'sim', prefere_formato: 'presencial',
                     faixa_investimento: 'ate-500' });
eIgual('pode vir mas o investimento não alcança → online',
  travada.formato, 'online');
eIgual('...e o presencial NÃO é descartado em silêncio',
  travada.mencionaPresencial, true);
eIgual('...e a tela final leva o presencial junto, com preço',
  L.paraTela(travada).presencial_possivel.preco, 'R$ 1.997');

eIgual('quem NÃO pode vir não recebe menção ao presencial (seria crueldade)',
  rota({ disponibilidade: 'nao', faixa_investimento: 'ate-500' }).mencionaPresencial, false);

eIgual('quem PEDIU online não recebe menção ao presencial (ela já escolheu)',
  rota({ prefere_formato: 'online' }).mencionaPresencial, false);

console.log('\n== 4. O PRODUTO FINAL, nos oito caminhos');

var casos = [
  ['zero + não pode vir',            { situacao: 'outra-area', disponibilidade: 'nao' }, 'profissao-lash'],
  ['zero + pode vir + tem grana',    { situacao: 'outra-area', disponibilidade: 'sim' }, 'profissao-lash-presencial'],
  ['zero + pode vir + pouca grana',  { situacao: 'outra-area', disponibilidade: 'sim', faixa_investimento: 'ate-500' }, 'profissao-lash'],
  ['lash + LED + não pode vir',      { situacao: 'ja-lash', busca: 'tecnica-led', disponibilidade: 'nao' }, 'lash2-online'],
  ['lash + LED + pode vir',          { situacao: 'ja-lash', busca: 'tecnica-led', disponibilidade: 'sim' }, 'lash2-presencial'],
  ['lash + LED + prefere online',    { situacao: 'ja-lash', busca: 'tecnica-led', prefere_formato: 'online' }, 'lash2-online'],
  ['lash + aperfeiçoar + pode vir',  { situacao: 'ja-lash', busca: 'aperfeicoar-cilios', disponibilidade: 'sim' }, 'profissao-lash-presencial'],
  ['lash + não sabe + pode vir',     { situacao: 'ja-lash', busca: 'nao-sei', disponibilidade: 'sim' }, 'lash2-presencial'],
];
casos.forEach(function (c) {
  eIgual(c[0] + ' → ' + c[2], rota(c[1]).produto.id, c[2]);
});

console.log('\n== 5. NENHUM produto é recomendado acima da faixa que ela marcou');
/* É a promessa que sustenta a pergunta de investimento: se a árvore puder
   recomendar acima do teto declarado, a tela final mostra um preço que ela
   já disse que não cabe — exatamente o que o produto único fazia. */
var TODAS = ['ate-500', '500-1500', '1500-2000', 'acima-2000', 'depende-parcelamento'];
var vazou = 0, combinacoes = 0;
['outra-area', 'area-beleza', 'ja-lash'].forEach(function (sit) {
  ['aperfeicoar-cilios', 'tecnica-led', 'nao-sei'].forEach(function (bus) {
    ['sim', 'talvez', 'nao'].forEach(function (disp) {
      ['presencial', 'online', 'nao-sei'].forEach(function (pref) {
        TODAS.forEach(function (faixa) {
          combinacoes++;
          var r = PRD.recomenda(respostas({ situacao: sit, busca: bus,
            disponibilidade: disp, prefere_formato: pref, faixa_investimento: faixa }));
          if (!PRD.cabeNaFaixa(r.produto, faixa)) {
            vazou++;
            console.log('  vazou: ' + [sit, bus, disp, pref, faixa].join('/') +
                        ' → ' + r.produto.id + ' (' + r.produto.preco + ')');
          }
        });
      });
    });
  });
});
if (vazou === 0) ok('as ' + combinacoes + ' combinações respeitam a faixa declarada');
else falha('preço acima da faixa em ' + vazou + ' combinações', '0', String(vazou));

console.log('\n== 6. CHECKOUT: online mostra, presencial não');
TODAS.forEach(function (faixa) {
  ['sim', 'nao'].forEach(function (disp) {
    var r = rota({ disponibilidade: disp, faixa_investimento: faixa });
    var t = L.paraTela(r);
    var esperado = r.formato === 'online';
    var tem = !!t.checkout;
    if (tem === esperado) return;
    falha('checkout no formato ' + r.formato + ' (' + faixa + '/' + disp + ')',
          esperado ? 'com link' : 'SEM link', tem ? 'com link' : 'sem link');
  });
});
ok('todo caminho online tem link de checkout e nenhum presencial tem');

/* O link tem de ser o checkout DAQUELE produto, não o de outro. Esta é a
   armadilha que o Eduardo pediu para conferir: checkout antigo continuar
   vivo com preço diferente. */
eIgual('checkout do Profissão Lash online',
  L.paraTela(rota({ situacao: 'outra-area', disponibilidade: 'nao' })).checkout,
  'https://pay.kiwify.com.br/y1Pz2US');
eIgual('checkout do Método LED online',
  L.paraTela(rota({ situacao: 'ja-lash', busca: 'tecnica-led', disponibilidade: 'nao' })).checkout,
  'https://pay.kiwify.com.br/FfyBeg0');

console.log('\n== 7. Os quatro preços, conferidos contra as páginas de venda');
var P = PRD.PRODUTOS();
eIgual('Profissão Lash online',              P['profissao-lash'].preco, 'R$ 497');
eIgual('Profissão Lash online + presencial', P['profissao-lash-presencial'].preco, 'R$ 1.497');
eIgual('Método LED online (FASE_PADRAO=2)',  P['lash2-online'].preco, 'R$ 297');
eIgual('Método LED presencial',              P['lash2-presencial'].preco, 'R$ 1.997');
eIgual('checkout do combo',                  P['profissao-lash-presencial'].checkout, 'VluGxKq');
eIgual('checkout do LED presencial',         P['lash2-presencial'].checkout, 'eZ1ZPoU');

console.log('\n== 8. A PONTUAÇÃO acompanha a árvore');
/* A trava antiga ("quem não pode vir nunca é quente") teria marcado de FRIO
   a pessoa abaixo, que é uma venda online pronta para acontecer. */
var semDeslocamento = respostas({ situacao: 'ja-lash', busca: 'tecnica-led',
  disponibilidade: 'nao', quando_comecar: 'agora', faixa_investimento: 'acima-2000' });
var q1 = L.qualifica(semDeslocamento, PRD.recomenda(semDeslocamento));
eIgual('quem não pode vir mas quer começar agora é QUENTE', q1.qualificacao, 'quente');

var soOlhando = respostas({ quando_comecar: 'so-olhando' });
var q2 = L.qualifica(soOlhando, PRD.recomenda(soOlhando));
eIgual('quem disse que só está pesquisando nunca é quente', q2.qualificacao, 'frio');

var perfeita = respostas({ situacao: 'ja-lash', busca: 'tecnica-led',
  disponibilidade: 'sim', prefere_formato: 'presencial', faixa_investimento: 'acima-2000',
  quando_comecar: 'agora' });
var q3 = L.qualifica(perfeita, PRD.recomenda(perfeita));
eIgual('o lead perfeito bate 100/100', q3.pontuacao, 100);
if (q3.pontuacao > 100) falha('a pontuação estourou 100', '<= 100', String(q3.pontuacao));

console.log('\n== 9. A VALIDAÇÃO exige o que a árvore precisa');
var v1 = L.valida({ nome: 'Ana Silva', telefone: '(35) 99716-4668', cidade: 'Cambuí',
  instagram: '@ana', disponibilidade: 'sim', situacao: 'ja-lash',
  prefere_formato: 'online', faixa_investimento: 'ate-500' });
eIgual('quem é lash e não diz o que busca é barrada', !!v1.erros.busca, true);

var v2 = L.valida({ nome: 'Ana Silva', telefone: '(35) 99716-4668', cidade: 'Cambuí',
  instagram: '@ana', disponibilidade: 'sim', situacao: 'outra-area',
  prefere_formato: 'online', faixa_investimento: 'ate-500' });
eIgual('quem NÃO é lash passa sem responder a condicional', v2.ok, true);
eIgual('...e o campo condicional fica nulo, não inventado', v2.lead.busca, null);

var v3 = L.valida({ nome: 'Ana Silva', telefone: '(35) 99716-4668', cidade: 'Cambuí',
  instagram: '@ana', disponibilidade: 'sim', situacao: 'outra-area',
  prefere_formato: 'online', faixa_investimento: 'ate-500', busca: 'tecnica-led' });
eIgual('quem não é lash tem a resposta condicional descartada', v3.lead.busca, null);

var v4 = L.valida({ nome: 'Ana Silva', telefone: '(35) 99716-4668', cidade: 'Cambuí',
  instagram: '@ana', disponibilidade: 'sim', situacao: 'outra-area' });
eIgual('sem faixa de investimento não passa', !!v4.erros.faixa_investimento, true);
eIgual('sem preferência de formato não passa', !!v4.erros.prefere_formato, true);

console.log('\n== 10. O que vai para o BANCO fica auditável');
var lead = respostas({ situacao: 'ja-lash', busca: 'tecnica-led', disponibilidade: 'sim' });
var r = L.roteia(lead);
eIgual('grava o id do produto', r.colunas.produto_id, 'lash2-presencial');
eIgual('grava o formato', r.colunas.produto_formato, 'presencial');
eIgual('grava o preço que ela viu', r.colunas.produto_valor, 1997);
eIgual('grava os motivos da decisão', r.colunas.recomendacao_motivos.length > 20, true);
eIgual('deriva aceita_valor da faixa', r.colunas.aceita_valor, 'sim');
eIgual('quem depende de parcelar fica marcada assim',
  L.roteia(respostas({ faixa_investimento: 'depende-parcelamento' })).colunas.aceita_valor,
  'preciso-parcelar');

console.log(falhas ? '\n' + falhas + ' FALHA(S) NA ÁRVORE.' : '\nÁrvore: tudo certo.');
process.exit(falhas ? 1 : 0);

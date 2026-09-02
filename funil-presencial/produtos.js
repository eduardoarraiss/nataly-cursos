/* ============================================================
   OS QUATRO PRODUTOS E A ÁRVORE DE DECISÃO
   ============================================================
   Fonte ÚNICA da verdade. O formulário não decide nada: ele manda as
   respostas, o servidor roda `recomenda()` e devolve o produto. Assim a
   tela final, a linha do banco e o aviso do WhatsApp nunca divergem —
   se a regra mudar, muda num lugar só.

   ⚠️ PREÇOS E CHECKOUTS CONFERIDOS NO CÓDIGO EM 01/09/2026:
     · profissao-lash            y1Pz2US  R$ 497   public/profissao-lash-curso.html:1002
     · profissao-lash-presencial VluGxKq  R$ 1.497 server.js:628 (a PV não mostra preço)
     · lash2-online (Método LED) FfyBeg0  R$ 297   server.js:302 via FASE_PADRAO=2
     · lash2-presencial          eZ1ZPoU  R$ 1.997 public/lancamento-presencial.html:748
   O Método LED online NÃO tem checkout fixo na página: ele é injetado por
   `renderVenda()` conforme a fase. FASE_PADRAO=2 desde 13/08/2026 (a relâmpago
   de R$ 247 / QOSVIDR acabou). Se alguém religar FASE_PADRAO=3 no Railway, o
   preço da página vira R$ 247 e ESTE ARQUIVO passa a mentir — por isso o valor
   também lê a env aqui embaixo, e não fica cravado.

   Os `id` são os MESMOS que `public/js/pixel.js` e `analytics.js` usam por
   rota. Não inventar id novo: o Meta e o GA4 já têm público e relatório
   montados em cima deles, e um id paralelo partiria a série histórica.
   ============================================================ */

/* O Método LED online segue a fase servida pelo site (RUNBOOK-PRECO-E-CHECKOUT.md).
   Fase 3 = relâmpago R$ 247 (QOSVIDR) · qualquer outra = R$ 297 (FfyBeg0). */
function ledOnline() {
  const fase3 = String(process.env.FASE_PADRAO || '') === '3';
  return fase3
    ? { checkout: 'QOSVIDR', valor: 247, preco: 'R$ 247', parcela: '12x de R$ 25,55' }
    : { checkout: 'FfyBeg0', valor: 297, preco: 'R$ 297', parcela: '12x de R$ 30,72' };
}

function PRODUTOS() {
  const led = ledOnline();
  return {
    'profissao-lash': {
      id: 'profissao-lash',
      familia: 'profissao-lash',
      formato: 'online',
      nome: 'Profissão Lash — online',
      nome_meta: 'Profissão Lash — Iniciante',
      curto: 'Profissão Lash online',
      valor: 497,
      preco: 'R$ 497',
      parcela: '12x de R$ 51,40',
      checkout: 'y1Pz2US',
      inclui: [
        '39 aulas teóricas, no seu ritmo',
        'A aula prática gravada, do começo ao fim',
        'Apostila digital completa',
        'Bônus de precificação, marketing e fidelização',
        'Grupo de suporte no WhatsApp',
        'Certificado',
      ],
    },
    'profissao-lash-presencial': {
      id: 'profissao-lash-presencial',
      familia: 'profissao-lash',
      formato: 'presencial',
      nome: 'Profissão Lash — online + presencial',
      nome_meta: 'Profissão Lash — Online + Presencial',
      curto: 'Profissão Lash online + presencial',
      valor: 1497,
      preco: 'R$ 1.497',
      parcela: '12x de R$ 154,82',
      checkout: 'VluGxKq',
      inclui: [
        'Um dia de prática ao vivo comigo, em Cambuí, MG',
        'Todo o material da prática incluso, você não leva nada',
        'Apostila impressa na sua mão',
        'O curso online completo, com as 39 aulas teóricas',
        'Bônus de precificação, marketing e fidelização',
        'Grupo de suporte no WhatsApp',
        'Certificado',
      ],
    },
    'lash2-online': {
      id: 'lash2-online',
      familia: 'metodo-led',
      formato: 'online',
      nome: 'Método LED — online',
      nome_meta: 'Lash 2.0 — Online',
      curto: 'Método LED online',
      valor: led.valor,
      preco: led.preco,
      parcela: led.parcela,
      checkout: led.checkout,
      inclui: [
        'A técnica do Método LED em vídeo, passo a passo',
        'Mapeamento, colagem e cura com LED',
        'O protocolo de durabilidade que eu uso no estúdio',
        'Acesso vitalício, no seu ritmo',
        'Grupo de suporte no WhatsApp',
        'Certificado',
      ],
    },
    'lash2-presencial': {
      id: 'lash2-presencial',
      familia: 'metodo-led',
      formato: 'presencial',
      nome: 'Método LED — presencial',
      nome_meta: 'Formação Presencial LED',
      curto: 'Método LED presencial',
      valor: 1997,
      preco: 'R$ 1.997',
      parcela: '12x de R$ 206,54',
      checkout: 'eZ1ZPoU',
      inclui: [
        'Um dia inteiro de formação ao vivo comigo, em Cambuí, MG',
        'Demonstração prática do Método LED, de perto',
        'Apostila completa do Método LED',
        'Dois encontros online comigo depois da formação',
        'Certificado de formação presencial',
      ],
    },
  };
}

/* ---------- vocabulário das perguntas novas ---------- */
const OPCOES_ARVORE = {
  /* 5b — só aparece para quem já trabalha com cílios */
  busca: ['aperfeicoar-cilios', 'tecnica-led', 'nao-sei'],
  /* 9 — a preferência declarada, que vem ANTES do dinheiro */
  prefere_formato: ['presencial', 'online', 'nao-sei'],
  /* 10 — a faixa de investimento. Cada faixa CONTÉM o preço do produto que
     ela habilita, então ninguém nunca recebe recomendação acima do que disse
     que pode: 497 e 297 cabem em 'ate-500'; 1.497 cabe em '500-1500';
     1.997 cabe em '1500-2000'. */
  faixa_investimento: ['ate-500', '500-1500', '1500-2000', 'acima-2000', 'depende-parcelamento'],
};

/* Teto de cada faixa, em reais. 'depende-parcelamento' não tem teto: quem
   aceita parcelar em 12x consegue qualquer um dos quatro (o mais caro sai a
   R$ 206,54 por mês). */
const TETO = {
  'ate-500': 500,
  '500-1500': 1500,
  '1500-2000': 2000,
  'acima-2000': Infinity,
  'depende-parcelamento': Infinity,
};

function cabeNaFaixa(produto, faixa) {
  const teto = TETO[faixa];
  if (teto === undefined) return false;
  return produto.valor <= teto;
}

/* ============================================================
   A ÁRVORE
   ============================================================
   Passo 1 — a FAMÍLIA, pela situação e pelo que ela busca.
   Passo 2 — o FORMATO, nesta ordem e não em outra:
       1º  consegue vir a Cambuí?   não → online, e acabou.
       2º  o que ela PREFERE?       pediu online → online, mesmo podendo vir.
       3º  a faixa de investimento. SÓ AQUI, como último critério.

   A ordem é o ponto todo. Se o dinheiro pesasse antes da distância, uma
   pessoa de Cambuí que faria o presencial seria empurrada para a oferta
   barata e a oferta cara se canibalizaria sozinha.

   E quando ela PODE vir e só o investimento trava, a recomendação sai online
   mas DIZENDO que o presencial existe — descartar em silêncio seria decidir
   pelo bolso dela sem perguntar.
   ============================================================ */
function recomenda(r) {
  const P = PRODUTOS();
  const motivos = [];

  /* ---------- passo 1: a família ---------- */
  let familia;
  let familiaIncerta = false;

  if (r.situacao !== 'ja-lash') {
    familia = 'profissao-lash';
    motivos.push(r.situacao === 'area-beleza'
      ? 'Já é da área da beleza, mas ainda não trabalha com cílios: começa pela formação completa.'
      : 'Vem de outra área e quer começar do zero: começa pela formação completa.');
  } else if (r.busca === 'tecnica-led') {
    familia = 'metodo-led';
    motivos.push('Já trabalha com cílios e disse que quer aprender a técnica com LED.');
  } else if (r.busca === 'aperfeicoar-cilios') {
    familia = 'profissao-lash';
    motivos.push('Já trabalha com cílios, mas quer se aperfeiçoar na extensão: a base completa resolve antes do LED.');
  } else {
    /* 'nao-sei' ou sem resposta: o LED é o avanço natural de quem já atende.
       É SUGESTÃO, e a copy da tela final tem de dizer isso com todas as letras. */
    familia = 'metodo-led';
    familiaIncerta = true;
    motivos.push('Já atende e ainda está decidindo o caminho: o LED é o avanço natural de quem já trabalha com cílios.');
  }

  /* ---------- passo 2: o formato ---------- */
  const presencialDaFamilia = familia === 'profissao-lash' ? P['profissao-lash-presencial'] : P['lash2-presencial'];
  const onlineDaFamilia     = familia === 'profissao-lash' ? P['profissao-lash']            : P['lash2-online'];

  let formato;
  let mencionaPresencial = false;   // online escolhido, mas o presencial cabe na conversa

  if (r.disponibilidade === 'nao') {
    formato = 'online';
    motivos.push('Não consegue vir até Cambuí, então o presencial está fora — e o online entrega o mesmo conteúdo.');
  } else if (r.prefere_formato === 'online') {
    formato = 'online';
    motivos.push('Pode vir, mas prefere estudar no próprio ritmo: a escolha dela vale mais que a nossa.');
  } else if (cabeNaFaixa(presencialDaFamilia, r.faixa_investimento)) {
    formato = 'presencial';
    motivos.push(r.disponibilidade === 'talvez'
      ? 'Acha que consegue vir a Cambuí e o investimento cabe: vale conversar sobre a data.'
      : 'Consegue vir a Cambuí e o investimento cabe: dá para praticar ao vivo.');
    if (r.prefere_formato === 'presencial') motivos.push('E foi ela quem pediu o ao vivo.');
  } else {
    /* Ela PODE vir e não pediu online. Só o investimento travou.
       Não descartar o presencial em silêncio: recomendar o online DIZENDO
       que o presencial existe e que a condição se conversa. */
    formato = 'online';
    mencionaPresencial = true;
    motivos.push('Pode vir a Cambuí, mas o investimento do presencial ficou acima da faixa que ela marcou: começa pelo online.');
  }

  const produto = formato === 'presencial' ? presencialDaFamilia : onlineDaFamilia;

  return {
    produto,
    familia,
    formato,
    familiaIncerta,
    mencionaPresencial,
    presencialDaFamilia,
    motivos,
  };
}

/* Frase de abertura da tela final, na voz da Nataly. Uma frase, não um
   parágrafo — quem chegou até aqui quer o nome do curso, não um ensaio. */
function porQue(rec) {
  if (rec.familiaIncerta) {
    return 'Pelo que você me contou, eu começaria por aqui — mas é uma sugestão, não uma sentença. ' +
           'Se você quiser, a gente decide junta no WhatsApp.';
  }
  if (rec.formato === 'presencial') {
    return 'Você consegue vir até Cambuí e o valor cabe no que você me disse. ' +
           'Então eu não te mandaria para o online: o que muda a sua mão é a prática ao vivo.';
  }
  if (rec.mencionaPresencial) {
    return 'Dá para começar hoje pelo online, no seu ritmo, sem apertar o seu bolso agora.';
  }
  return 'É o caminho que combina com o que você me contou sobre a sua rotina e o seu momento.';
}

module.exports = { PRODUTOS, OPCOES_ARVORE, TETO, cabeNaFaixa, recomenda, porQue, ledOnline };

/* ============================================================
   LEADS — validação, normalização, qualificação e persistência
   ============================================================
   Regra que manda em tudo: o lead é GRAVADO primeiro. O aviso de
   WhatsApp é consequência, nunca condição. Se o WhatsApp cair, a
   pessoa que preencheu continua no banco.
   ============================================================ */
const db = require('./db');
const PRD = require('./produtos');

/* ---------- vocabulário fechado ----------
   Campo de escolha nunca aceita texto livre do cliente: se chegar algo
   fora da lista, é erro de validação e não linha suja no banco. */
const OPCOES = {
  situacao:        ['ja-lash', 'area-beleza', 'outra-area'],
  /* só aparece para quem já trabalha com cílios */
  busca:           PRD.OPCOES_ARVORE.busca,
  disponibilidade: ['sim', 'talvez', 'nao'],
  prefere_formato: PRD.OPCOES_ARVORE.prefere_formato,
  faixa_investimento: PRD.OPCOES_ARVORE.faixa_investimento,
  /* DERIVADO da faixa, nunca mais vindo do formulário — ver deriveAceitaValor().
     Continua no vocabulário porque a coluna existe, o CSV exporta e o painel lê. */
  aceita_valor:    ['sim', 'preciso-parcelar', 'nao'],
  quando_comecar:  ['agora', '30-dias', '90-dias', 'so-olhando'],
  /* 🔴 O INTERESSE DECLARADO (05/09/2026) — o campo que substituiu a pergunta
     de dinheiro como última do formulário.
     Ele é a única coisa que a captação precisa saber sobre o que ela quer:
     começar do zero como lash designer, ou aprender a técnica com LED. É ele
     que escolhe a frase que vai pré-preenchida no WhatsApp da tela final, e é
     ele que a Nataly lê antes de discar.
     NÃO é produto e NÃO tem preço: 'iniciante' e 'led' são caminhos de
     conversa, não itens de catálogo. */
  interesse:       ['iniciante', 'led'],
  faixa_idade:     ['18-24', '25-34', '35-44', '45+'],
  meta_renda:      ['ate-2k', '2k-5k', '5k-10k', 'mais-10k', 'nao-sei'],
};

/* Os ids válidos de produto. Fecha o filtro do painel do mesmo jeito que
   OPCOES fecha os campos do formulário: nada de string livre no WHERE. */
const PRODUTO_IDS = Object.keys(PRD.PRODUTOS());

const STATUS = ['novo', 'contatado', 'em-conversa', 'proposta-enviada', 'ganho', 'perdido'];

/* ---------- ONDE ELA PAROU ----------
   `ultima_etapa` guarda a pergunta que ela estava VENDO quando desistiu — não
   a última que respondeu. A diferença importa comercialmente: quem responde a
   9 e some parou NA 10, que é a do investimento. Dizer "parou na 9" mandaria a
   Nataly conversar sobre o assunto errado.

   A '5.5' só existe para quem já trabalha com cílios, então o TOTAL muda de
   pessoa para pessoa (10 ou 11). É a mesma fila do formulário; se uma pergunta
   nascer ou morrer lá, ela tem de nascer ou morrer aqui — senão o aviso diz
   "pergunta 7 de 10" para um formulário de 11. */
/* 🔴 A ETAPA '10' (a faixa de investimento) SAIU DA FILA EM 05/09/2026.
   A captação não pergunta mais de dinheiro, então ninguém novo pode parar
   nela. Ela continua no mapa `ETAPAS` logo abaixo porque as linhas gravadas
   antes dessa data ainda apontam para lá, e o painel precisa saber traduzir
   `ultima_etapa = '10'` em português. Fora da fila ela não ganha número de
   posição — e é melhor assim: dizer "pergunta 10 de 11" para um formulário
   que hoje tem 11 telas diferentes seria inventar uma contagem que não
   existe mais. */
const ORDEM_ETAPAS = ['1', '2', '3', '4', '5', '5.5', '6', '7', '8', '9', 'interesse'];
const ETAPA_PRECO  = '10';   /* histórico: nenhuma linha nova nasce aqui */

/* ---------- A PARADA MAIS CARA DE TODAS (02/09/2026) ----------
   `rec` NAO e uma pergunta, e por isso NAO entra em ORDEM_ETAPAS: ela e o
   lugar onde a pessoa parou DEPOIS de responder tudo — na tela que mostra o
   produto indicado, o preco e as condicoes — sem apertar o botao que confirma.

   Ate hoje essa pessoa nao existia: o formulario gravava tudo e disparava o
   `Lead` no fim das perguntas, entao quem via o preco e recuava ja constava
   como inscrita. Agora ela fica registrada como INCOMPLETA, e com o produto
   que ela viu gravado na linha — que e a informacao comercial mais forte que
   este funil produz: ela sabe o preco, e mesmo assim nao clicou. */
const ETAPA_REC = 'rec';

const ETAPAS = {
  '1':   'o nome',
  '2':   'a cidade',
  '3':   'o WhatsApp',
  '4':   'o Instagram',
  '5':   'a situação dela hoje',
  '5.5': 'o que ela está buscando',
  '6':   'a meta de renda e quando quer começar',
  '7':   'o objetivo dela (pergunta aberta)',
  '8':   'se consegue vir a Cambuí',
  '9':   'como prefere aprender',
  '10':  'a faixa de investimento',
  /* A ÚLTIMA PERGUNTA desde 05/09/2026. Quem para aqui respondeu tudo o que
     interessa e recuou no fim — é a parada mais valiosa que a captação nova
     consegue produzir, porque a Nataly já tem nome, WhatsApp e o caminho. */
  'interesse': 'o que ela quer aprender (iniciante ou LED)',
  'rec': 'a tela da recomendacao — ela viu o curso indicado e o preco',
};

/* Descreve a parada em português, com posição REAL na fila daquela pessoa. */
function descreveEtapa(l) {
  const id = l && l.ultima_etapa ? String(l.ultima_etapa) : null;
  if (!id || !ETAPAS[id]) return null;
  const lash = l.situacao === 'ja-lash';
  const fila = ORDEM_ETAPAS.filter((e) => e !== '5.5' || lash);
  const pos = fila.indexOf(id);
  return {
    id,
    rotulo: ETAPAS[id],
    /* `rec` nao esta na fila de perguntas, entao nao tem numero: dizer
       "pergunta 0 de 10" seria pior do que nao dizer nada. Quem le a mensagem
       precisa e do `naRecomendacao`, que e uma informacao diferente e mais
       valiosa do que a posicao. */
    posicao: pos < 0 ? null : pos + 1,
    total: fila.length,
    noPreco: id === ETAPA_PRECO,
    naRecomendacao: id === ETAPA_REC,
    /* A ÚLTIMA pergunta da captação nova (05/09/2026). Quem para aqui
       respondeu tudo o que interessa e recuou no último clique — é a parada
       mais valiosa que este formulário consegue produzir hoje, porque a
       Nataly já tem nome, WhatsApp, cidade e o caminho todo. */
    naUltima: id === 'interesse',
  };
}

/* ---------- normalizações ---------- */

function texto(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, max);
}

/* Telefone brasileiro -> só dígitos, com DDI 55 na frente.
   Aceita o que a máscara do formulário produz e também o que a pessoa
   colar de qualquer jeito. Devolve null se não for um número plausível. */
function normalizaTelefone(v) {
  if (!v) return null;
  let d = String(v).replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);   // já veio com DDI
  if (d.length === 11 && d[2] === '9') { /* celular com nono dígito */ }
  else if (d.length === 10) {
    /* 🔴 DEZ dígitos começando o assinante com 8 ou 9 é, quase sempre, o
       CELULAR DELA SEM O DDD — ela digitou "99716-4668" achando que bastava.
       O código lia os dois primeiros como DDD e devolvia (99) 9716-4668:
       um número de Imperatriz-MA que não existe e no qual a Nataly nunca
       conseguiria falar. O lead entrava no painel parecendo bom e era lixo.

       Os fixos de verdade têm assinante começando em 2..5, e são esses que
       continuam passando. Celular de oito dígitos (o antigo 8xxx/9xxx) morreu
       na migração para o nono dígito em 2016 — recusar é mais honesto do que
       gravar um telefone morto.

       Recusar aqui devolve o erro de validação que JÁ existe e JÁ diz o que
       fazer: "precisa ter DDD e número, como (35) 99716-4668". */
    if (d[2] === '9' || d[2] === '8') return null;
  }
  else return null;
  const ddd = parseInt(d.slice(0, 2), 10);
  if (!(ddd >= 11 && ddd <= 99)) return null;               // DDD inexistente
  return '55' + d;
}

function formataTelefone(e164) {
  if (!e164) return '';
  const d = e164.replace(/^55/, '');
  if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return e164;
}

/* Instagram: aceita "@nome", "nome", ou a URL inteira colada do navegador. */
function normalizaInstagram(v) {
  if (!v) return null;
  let s = String(v).trim().toLowerCase();
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//, '');
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  s = s.replace(/^@+/, '').trim();
  if (!/^[a-z0-9._]{1,30}$/.test(s)) return null;
  return s;
}

function normalizaEmail(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return null;
  return s.slice(0, 160);
}

function opcao(campo, v) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  return OPCOES[campo].includes(s) ? s : null;
}

/* ---------- a faixa vira `aceita_valor` ----------
   A nona pergunta antiga ("você aceita R$ 1.497?") morreu junto com o produto
   único: com quatro preços ela mentiria para três quartos das pessoas. No
   lugar entrou a FAIXA DE INVESTIMENTO, perguntada sem revelar preço nenhum.

   `aceita_valor` continua existindo, mas agora é DERIVADO — e é derivado da
   comparação com o produto que a árvore recomendou, não de um número fixo.
   Por construção a árvore nunca recomenda acima da faixa marcada, então
   'nao' só aparece se alguém adulterar o envio. */
function deriveAceitaValor(faixa, produto) {
  if (faixa === 'depende-parcelamento') return 'preciso-parcelar';
  if (!produto) return 'sim';
  return PRD.cabeNaFaixa(produto, faixa) ? 'sim' : 'nao';
}

/* ---------- qualificação ----------
   Pontuação declarada, não adivinhada: só usa o que a pessoa respondeu.

   ⚠️ MUDOU EM 01/09/2026, junto com a árvore. A trava antiga dizia que quem
   não podia vir a Cambuí nunca era quente — e era verdade quando existia UM
   produto, presencial. Com quatro produtos ela virou mentira cara: quem não
   pode vir agora recebe o online, que é uma venda perfeitamente boa. Manter a
   trava marcaria de FRIO justamente o lead que compra sem sair de casa.

   No lugar dela, a trava honesta é a que a própria pessoa declarou: quem diz
   que está SÓ PESQUISANDO não é lead quente, por mais que pontue no resto. */
function qualifica(l, rec) {
  const presencial = rec && rec.formato === 'presencial';
  let p = 0;

  // 1. o prazo — é o que mais separa quem compra de quem olha
  p += ({ agora: 30, '30-dias': 20, '90-dias': 8, 'so-olhando': 0 })[l.quando_comecar] || 0;

  // 2. a situação — quem já atende decide mais rápido
  p += ({ 'ja-lash': 20, 'area-beleza': 15, 'outra-area': 10 })[l.situacao] || 0;

  // 3. o dinheiro, lido contra o produto recomendado (não contra um preço fixo)
  if (l.faixa_investimento === 'depende-parcelamento') p += 18;
  else if (presencial) p += 30;                       // a faixa alcançou a oferta cara
  else if (rec && rec.mencionaPresencial) p += 10;    // podia vir, mas a faixa travou
  else p += 22;                                       // online por distância ou escolha

  // 4. o encaixe do formato. Para produto online a distância deixou de ser
  //    obstáculo, então ela não pode pesar contra o lead.
  if (!presencial) p += 18;
  else p += ({ sim: 20, talvez: 12, nao: 0 })[l.disponibilidade] || 0;

  let nivel;
  if (l.quando_comecar === 'so-olhando') nivel = 'frio';
  else if (p >= 70) nivel = 'quente';
  else if (p >= 40) nivel = 'morno';
  else nivel = 'frio';

  return { pontuacao: p, qualificacao: nivel };
}

/* ---------- validação do corpo recebido ---------- */
function valida(body) {
  const erros = {};
  const l = {};

  l.nome = texto(body.nome, 120);
  if (!l.nome || l.nome.length < 2) erros.nome = 'Escreva o seu nome completo.';

  l.telefone = normalizaTelefone(body.telefone);
  if (!l.telefone) erros.telefone = 'Confira o WhatsApp: precisa ter DDD e número, como (35) 99716-4668.';
  l.telefone_exibicao = texto(body.telefone, 40);

  l.cidade = texto(body.cidade, 80);
  if (!l.cidade || l.cidade.length < 2) erros.cidade = 'Diga em qual cidade você mora.';

  l.instagram = normalizaInstagram(body.instagram);
  if (!l.instagram) erros.instagram = 'Coloque só o seu @ do Instagram, sem espaço.';

  l.disponibilidade = opcao('disponibilidade', body.disponibilidade);
  if (!l.disponibilidade) erros.disponibilidade = 'Escolha uma das opções.';

  /* Os três campos que ALIMENTAM A ÁRVORE viraram obrigatórios: sem eles não
     há recomendação, e uma recomendação chutada é pior que nenhuma.
     `aceita_valor` saiu daqui — hoje é derivado da faixa (deriveAceitaValor). */
  l.situacao = opcao('situacao', body.situacao);
  if (!l.situacao) erros.situacao = 'Escolha a opção que mais parece com você hoje.';

  l.prefere_formato = opcao('prefere_formato', body.prefere_formato);
  if (!l.prefere_formato) erros.prefere_formato = 'Me diz como você prefere aprender.';

  /* 🔴 A FAIXA DE INVESTIMENTO DEIXOU DE SER OBRIGATÓRIA EM 05/09/2026, porque
     a pergunta saiu do formulário. Ela continua aceita — se um envio antigo,
     de aba aberta ontem, ainda mandar o campo, o valor é gravado em vez de
     descartado. O que não pode mais acontecer é TRAVAR um envio por falta
     dela: a captação inteira foi reescrita para não falar de dinheiro, e
     exigir aqui o que a tela não pergunta devolveria um erro de validação
     apontando para um campo que não existe — a pessoa veria "escolha a faixa"
     sem ter onde escolher, e o lead morreria na tela, pago. */
  l.faixa_investimento = opcao('faixa_investimento', body.faixa_investimento);

  /* O interesse é a última pergunta e é obrigatório: é ele que roteia a
     conversa no WhatsApp. Sem ele a tela final não sabe qual frase oferecer. */
  l.interesse = opcao('interesse', body.interesse);

  /* 🔴 A ABA QUE FICOU ABERTA DESDE ONTEM (05/09/2026).
     No dia da virada existe gente com a página ANTIGA carregada no celular —
     aquela que perguntava a faixa de investimento e não conhecia o campo
     `interesse`. Ela vai terminar de preencher e apertar enviar, e o
     formulário dela vai mandar `faixa_investimento` e nenhum `interesse`.

     Se a exigência valesse para ela também, receberia "me diz o que você quer
     aprender" — uma cobrança por uma pergunta que a tela dela NÃO TEM. Sem
     campo para corrigir, o botão nunca mais funcionaria: ela apertaria, veria
     o mesmo erro, e iria embora. Lead pago, perdido em silêncio, no dia do
     deploy — a mesma família de defeito do honeypot, pela mesma razão (erro
     apontando para um campo que ela não consegue ver).

     Então, para o envio do formulário ANTIGO, o interesse é DEDUZIDO do que
     ela já respondeu — e a dedução é a mesma raiz que a árvore sempre usou:
     quem já trabalha com cílios e foi buscar a técnica com LED quer LED;
     todo o resto quer começar. É uma inferência, não uma resposta dela, e por
     isso só vale quando não há resposta nenhuma.

     A janela é estreita de propósito: só entra aqui quem mandou
     `faixa_investimento`, que é a assinatura inconfundível do formulário
     velho. O formulário novo nunca manda esse campo, então um envio novo sem
     interesse continua sendo recusado, como tem de ser. Quando não houver
     mais aba antiga viva, este ramo pode sair. */
  if (!l.interesse && l.faixa_investimento) {
    /* 🔴 LÊ DO `body`, NÃO DE `l.busca`: neste ponto da função o `l.busca`
       ainda não foi preenchido (ele nasce no bloco condicional, logo abaixo),
       e usá-lo aqui leria `undefined` sempre — a dedução daria 'iniciante'
       para TODA lash que veio pelo LED, calada, sem erro nenhum. */
    const buscaDela = opcao('busca', body.busca);
    l.interesse = (l.situacao === 'ja-lash' && buscaDela === 'tecnica-led') ? 'led' : 'iniciante';
  }

  if (!l.interesse) erros.interesse = 'Me diz o que você quer aprender.';

  /* A pergunta condicional: obrigatória SÓ para quem já trabalha com cílios.
     Quem não é lash nunca a vê, então exigi-la de todas travaria o envio de
     quem respondeu tudo o que lhe foi perguntado. E quem NÃO é lash mas manda
     o campo assim mesmo tem o valor descartado — a resposta não teria contexto. */
  if (l.situacao === 'ja-lash') {
    l.busca = opcao('busca', body.busca);
    if (!l.busca) erros.busca = 'Me diz o que você está buscando agora.';
  } else {
    l.busca = null;
  }

  // opcionais — inválido vira null, não vira erro que trava o envio
  l.estado = texto(body.estado, 2);
  if (l.estado) l.estado = l.estado.toUpperCase();
  l.email = normalizaEmail(body.email);
  l.faixa_idade = opcao('faixa_idade', body.faixa_idade);
  l.meta_renda = opcao('meta_renda', body.meta_renda);
  l.quando_comecar = opcao('quando_comecar', body.quando_comecar);
  l.objetivo = texto(body.objetivo, 1000);

  return { erros, lead: l, ok: Object.keys(erros).length === 0 };
}

/* ============================================================
   RECEBIDOS — o dead-letter da captação (05/09/2026)
   ============================================================
   🔴 GRAVA O CORPO CRU ANTES DE VALIDAR QUALQUER COISA, e é essa ordem que é
      o ponto todo. Até hoje um envio que não passava na validação sumia com a
      requisição: o servidor devolvia 400 e pronto. Se a pessoa fechasse a
      aba, aquele lead nunca existiu para ninguém — nem para conferir depois.
      Verba de anúncio virando zero, em silêncio, sem deixar rastro.

   O que se ganha: um envio malformado deixa de ser um zero e vira uma linha
   recuperável, com nome e telefone dentro, que dá para ler e ligar à mão.

   🔴 ELE NUNCA PODE DERRUBAR O ENVIO. Se gravar o recebido falhar, o lead
      segue o caminho normal — perder a rede é ruim, perder o lead é pior.
      Por isso o try/catch engole tudo e devolve null. */
async function registraRecebido({ rota, corpo, ip, userAgent, leadUid }) {
  try {
    const r = await db.consulta(
      'INSERT INTO recebidos (rota, ip, user_agent, lead_uid, corpo) ' +
      'VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [String(rota).slice(0, 80), ip || null, String(userAgent || '').slice(0, 400) || null,
       leadUid ? String(leadUid).slice(0, 80) : null,
       JSON.stringify(corpo || {}).slice(0, 20000)]);
    return r.rows[0].id;
  } catch (e) {
    console.error('[funil] não consegui gravar o recebido (o envio segue): ' + e.message);
    return null;
  }
}

/* Fecha o recebido: aceito (com o lead que nasceu) ou recusado (com o motivo).
   Também não pode derrubar nada. */
async function fechaRecebido(id, { aceito, motivo, leadId }) {
  if (!id) return;
  try {
    await db.consulta(
      'UPDATE recebidos SET aceito = $2, motivo = $3, lead_id = $4 WHERE id = $1',
      [id, !!aceito, motivo ? String(motivo).slice(0, 500) : null, leadId || null]);
  } catch (e) {
    console.error('[funil] não consegui fechar o recebido ' + id + ': ' + e.message);
  }
}

/* Quantos envios entraram e NÃO viraram lead. É o número que diz se estamos
   perdendo gente agora — e é o que a reconciliação compara com o Meta. */
async function recebidosPerdidos(desdeMin = 1440) {
  const r = await db.consulta(
    'SELECT * FROM recebidos WHERE aceito = false AND lead_id IS NULL ' +
    "AND criado_em > now() - ($1 || ' minutes')::interval ORDER BY criado_em DESC LIMIT 200",
    [String(parseInt(desdeMin, 10))]);
  return r.rows;
}

/* ============================================================
   IMPORTAÇÃO — a porta única para lead que nasceu FORA do site
   ============================================================
   🔴 POR QUE ISTO EXISTE. Em 05/09/2026 descobriu-se que 24 pessoas tinham
      deixado nome, telefone e e-mail num FORMULÁRIO INSTANTÂNEO do Meta, entre
      20 e 23/08, e que nenhuma delas jamais tocou o site — logo, nenhuma
      existia no CRM. Elas não se perderam por bug: se perderam por DESENHO.
      Formulário instantâneo nasce e morre dentro do Meta, e sem alguém buscar
      lá, ninguém nunca saberia que existiram.

   🔴 TRÊS REGRAS DURAS, e as três são sobre a Nataly LIGAR para essas pessoas:

     1. NUNCA INVENTAR. O que a origem não trouxe fica NULO. Sem cidade, sem
        interesse, sem produto, sem qualificação. Deduzir "ela deve querer o
        iniciante" e a Nataly abrir a ligação com isso é fazê-la passar
        vergonha com uma pessoa real.
     2. A DATA É A DA ORIGEM. Quem se inscreveu em 21/08 não é lead de hoje.
        Ligar dizendo "vi que você acabou de se inscrever" duas semanas depois
        queima o contato.
     3. NÃO DUPLICAR, por dois caminhos: `origem_id` (rodar o importador duas
        vezes é inofensivo) e TELEFONE NORMALIZADO (a mesma pessoa que também
        preencheu o site não vira duas linhas, e a Nataly não liga duas vezes).

   🔴 E NADA DE PIXEL. Importado é RECUPERAÇÃO, não conversão nova: disparar
      `Lead` por eles inflaria a métrica pela qual a campanha otimiza, com
      eventos de agosto chegando em setembro. Esta função não toca em evento
      nenhum, e não enfileira aviso — quem avisa a Nataly é o painel. */

/* As formas em que o MESMO número brasileiro aparece na vida real: com e sem
   DDI, com e sem o nono dígito. Duas listas que se cruzam = mesma pessoa. */
function chavesDeTelefone(e164) {
  if (!e164) return [];
  let d = String(e164).replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  const fora = new Set();
  if (d.length === 11) {
    fora.add(d);
    /* Sem o nono dígito: o mesmo assinante nos cadastros antigos. */
    if (d[2] === '9') fora.add(d.slice(0, 2) + d.slice(3));
  } else if (d.length === 10) {
    fora.add(d);
    fora.add(d.slice(0, 2) + '9' + d.slice(2));
  } else if (d) {
    fora.add(d);
  }
  const todas = [];
  fora.forEach((x) => { todas.push(x); todas.push('55' + x); });
  return todas;
}

/* 🔴 O TELEFONE DE UMA ORIGEM EXTERNA NÃO SEGUE A REGRA DO FORMULÁRIO, e
   confundir as duas custou 3 dos 24 leads do Meta na primeira medição (12,5%
   de lead PAGO, no lixo).

   `normalizaTelefone` recusa dez dígitos cujo assinante começa em 8 ou 9,
   porque no FORMULÁRIO isso é quase sempre a mulher digitando o celular sem o
   DDD — e gravar um número que não existe é pior do que recusar na cara dela,
   que ainda pode corrigir.

   Numa importação nada disso vale. O número veio do campo de telefone do
   próprio Meta, já com código de país, e não há ninguém do outro lado para
   corrigir: recusar aqui não devolve um erro, apaga uma pessoa. Medido:
   +554399508234, +554798805080 e 8892609066 são contatos reais, com e-mail,
   que a régua do formulário jogaria fora em silêncio.

   Então aqui a régua é a mínima honesta: DDD brasileiro que existe e um
   assinante de 8 ou 9 dígitos. O que for duvidoso entra e fica visível para a
   Nataly julgar — ela tem o e-mail e o nome para conferir. */
function normalizaTelefoneOrigem(v) {
  if (!v) return null;
  let d = String(v).replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = parseInt(d.slice(0, 2), 10);
  if (!(ddd >= 11 && ddd <= 99)) return null;
  return '55' + d;
}

/* Um registro de origem → as colunas do lead. Só o que veio. */
function normalizaImportado(reg, origem) {
  const nome = texto(reg.nome, 120);
  const telefone = normalizaTelefoneOrigem(reg.telefone);
  if (!nome || !telefone) return { ok: false, motivo: 'sem nome ou sem telefone utilizável' };
  const criado = reg.criado_em ? new Date(reg.criado_em) : null;
  if (reg.criado_em && (!criado || isNaN(criado.getTime()))) {
    return { ok: false, motivo: 'data de origem ilegível' };
  }
  return {
    ok: true,
    lead: {
      nome,
      telefone,
      telefone_exibicao: formataTelefone(telefone),
      email: normalizaEmail(reg.email),
      origem: String(origem).slice(0, 40),
      origem_id: reg.origem_id ? String(reg.origem_id).slice(0, 120) : null,
      criado_em: criado,
      /* O que a pessoa COMPROU, quando a origem é uma venda. Fica nulo para
         lead — e é justamente a diferença entre os dois no painel. */
      comprou: texto(reg.comprou, 160),
      comprou_em: reg.comprou_em ? new Date(reg.comprou_em) : null,
      /* 🔴 TUDO O MAIS FICA NULO, DE PROPÓSITO. Ver a regra 1 acima. */
    },
  };
}

/* Importa uma leva. `simular: true` não escreve nada — só conta e devolve a
   amostra, que é como esta função tem de ser rodada na primeira vez. */
async function importa(origem, registros, { simular = false } = {}) {
  const res = { origem, vistos: registros.length, importados: 0, pulados: 0,
                invalidos: 0, detalhes: [], amostra: [] };

  for (const reg of registros) {
    const n = normalizaImportado(reg, origem);
    if (!n.ok) {
      res.invalidos++;
      res.detalhes.push({ origem_id: reg.origem_id, resultado: 'invalido', motivo: n.motivo });
      continue;
    }
    const l = n.lead;

    /* Já importado antes? (mesma origem, mesmo id) */
    if (l.origem_id) {
      const j = await db.consulta(
        'SELECT id FROM leads WHERE origem = $1 AND origem_id = $2 LIMIT 1',
        [l.origem, l.origem_id]);
      if (j.rows.length) {
        res.pulados++;
        res.detalhes.push({ origem_id: l.origem_id, resultado: 'ja-importado', lead_id: j.rows[0].id });
        continue;
      }
    }

    /* Já existe como pessoa? (telefone, em qualquer das formas) */
    const chaves = chavesDeTelefone(l.telefone);
    if (chaves.length) {
      const j = await db.consulta(
        'SELECT id, nome FROM leads WHERE regexp_replace(telefone, $2, $3, $4) = ANY($1) ' +
        'OR telefone = ANY($1) LIMIT 1',
        [chaves, '[^0-9]', '', 'g']);
      if (j.rows.length) {
        res.pulados++;
        res.detalhes.push({ origem_id: l.origem_id, resultado: 'ja-existe-por-telefone',
                            lead_id: j.rows[0].id, nome: j.rows[0].nome });
        continue;
      }
    }

    if (res.amostra.length < 5) res.amostra.push(Object.assign({}, l));
    if (simular) { res.importados++; continue; }

    const campos = ['nome', 'telefone', 'telefone_exibicao', 'email', 'origem', 'origem_id',
                    'comprou', 'comprou_em'];
    const vals = campos.map((c) => l[c]);
    let sql = 'INSERT INTO leads (' + campos.join(', ');
    let ph = campos.map((_, i) => '$' + (i + 1));
    if (l.criado_em) { sql += ', criado_em'; ph.push('$' + (vals.push(l.criado_em))); }
    /* 🔴 `aviso_estado` entra como 'enviado' — e isto é deliberado.
       O importado NÃO deve gerar aviso retroativo: são leads de agosto, e
       despejar vinte e quatro mensagens no grupo da Nataly de uma vez é ruído,
       não informação. Ela os vê no painel, filtrando por origem. Marcá-los
       'pendente' faria a fila tentar avisar todos assim que o WhatsApp
       voltasse — exatamente o que não se quer. */
    /* 🔴 QUEM COMPROU NASCE COMO 'ganho'. O painel já pinta o status, então a
       venda aparece na tabela sem precisar de tela nova — e o funil de status
       para de contar comprador como oportunidade aberta. */
    sql += ', aviso_estado, status) VALUES (' + ph.join(', ') +
           ", 'enviado', " + (l.comprou ? "'ganho'" : "'novo'") + ') RETURNING id';
    const r = await db.consulta(sql, vals);
    res.importados++;
    res.detalhes.push({ origem_id: l.origem_id, resultado: 'importado', lead_id: r.rows[0].id });
  }
  return res;
}

/* ============================================================
   META LEADGEN — o formulário instantâneo cai no CRM sozinho
   ============================================================
   🔴 O PROBLEMA QUE ISTO RESOLVE, e ele não era um bug: um formulário
      instantâneo do Meta nasce e MORRE dentro do Meta. A pessoa preenche
      dentro do Instagram, o anúncio contabiliza o lead, e nada nunca sai de
      lá. Em 05/09/2026 achamos 24 mulheres esperando desde 20 de agosto —
      nome, telefone e e-mail — que nunca existiram para a operação.
      Importar as 24 limpou a poça. Isto aqui fecha o cano.

   Como funciona: a Meta chama `POST /webhooks/meta-leadgen` no instante em que
   alguém envia o formulário, mandando só o `leadgen_id`. O conteúdo do lead
   NÃO vem no webhook — a gente busca no Graph com o id. Por isso o token
   precisa de `leads_retrieval`.

   🔴 A META REENVIA. Ela reentrega o mesmo evento quando não recebe 200 rápido,
      e reentrega em duplicata sem motivo nenhum às vezes. A idempotência é o
      `origem_id` (o próprio `leadgen_id`), com índice único no banco — quem já
      entrou é PULADO, não regravado. Sem isso a Nataly ligaria duas vezes para
      a mesma pessoa. */

/* Busca o conteúdo de um lead no Graph a partir do id que o webhook mandou. */
async function buscaLeadNoMeta(leadgenId, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    /* A base do Graph é configurável para o GATE poder apontar para um
       servidor falso: sem isso, testar o webhook exigiria internet, um lead
       real e uma chamada de verdade na conta da Nataly a cada rodada — e um
       teste que gasta recurso real acaba não sendo rodado. Em produção a
       variável não existe e vale o endereço da Meta. */
    const base = process.env.META_GRAPH_BASE || 'https://graph.facebook.com/v21.0';
    const r = await fetch(base + '/' + encodeURIComponent(leadgenId) +
      '?fields=created_time,field_data&access_token=' + encodeURIComponent(token),
      { signal: ctrl.signal });
    const corpo = await r.text();
    let j = null;
    try { j = JSON.parse(corpo); } catch (e) { throw new Error('resposta ilegível do Graph'); }
    if (j.error) throw new Error('Graph: ' + (j.error.message || 'erro'));
    return j;
  } finally { clearTimeout(t); }
}

/* O formato do Meta (`field_data`) → o formato da importação.
   🔴 SÓ O QUE VEIO. Este formulário pergunta nome, telefone e e-mail, e mais
      nada — então cidade, interesse e situação ficam NULOS. A Nataly vai LIGAR
      para essa pessoa: deduzir o que ela quer e abrir a conversa com isso é
      fazê-la passar vergonha com alguém real. */
function leadDoMeta(j) {
  const campos = {};
  for (const c of (j.field_data || [])) {
    campos[c.name] = (c.values && c.values[0]) || null;
  }
  return {
    origem_id: String(j.id),
    nome: campos.full_name || campos.name || null,
    /* O Meta manda o telefone com código de país e, às vezes, sem o nono
       dígito. Quem trata isso é `normalizaTelefoneOrigem`, lá em cima — a
       régua do formulário do site descartaria contatos reais. */
    telefone: campos.phone_number || null,
    email: campos.email || null,
    criado_em: j.created_time || null,
  };
}

/* Processa um `leadgen_id`: busca, converte e entrega à PORTA ÚNICA.
   Devolve o resultado da importação, que já sabe dizer se pulou por duplicata. */
async function processaLeadgen(leadgenId, token, origem = 'meta-lead-ads') {
  const bruto = await buscaLeadNoMeta(leadgenId, token);
  const reg = leadDoMeta(bruto);
  return importa(origem, [reg]);
}

/* ---------- validação do PARCIAL ----------
   Regra oposta à do envio final, e de propósito: aqui NADA trava.

   O gatilho é o mínimo que torna o registro útil para o comercial: um nome e
   um WhatsApp que dá para discar. Sem os dois, gravar seria acumular linha que
   ninguém consegue chamar. Com os dois, tudo o mais que vier é bônus — e o
   que vier errado (um e-mail pela metade, um @ com espaço) vira null em vez de
   erro, porque recusar o parcial por causa de um campo opcional devolveria
   exatamente o problema que este caminho existe para resolver.

   `aceita_valor`, `produto_*`, `pontuacao` e `qualificacao` NÃO são preenchidos
   aqui: todos dependem da árvore, e a árvore precisa de respostas que ela ainda
   não deu. Chutar um produto para ela seria inventar um dado comercial — e a
   Nataly leria esse chute como se fosse a indicação de verdade. */
function validaParcial(body) {
  const l = {};

  l.nome = texto(body.nome, 120);
  l.telefone = normalizaTelefone(body.telefone);
  if (!l.nome || l.nome.length < 2 || !l.telefone) {
    return { ok: false, motivo: 'sem-contato', lead: null };
  }
  l.telefone_exibicao = texto(body.telefone, 40);

  l.cidade    = texto(body.cidade, 80);
  l.instagram = normalizaInstagram(body.instagram);
  l.email     = normalizaEmail(body.email);
  l.estado    = texto(body.estado, 2);
  if (l.estado) l.estado = l.estado.toUpperCase();
  l.objetivo  = texto(body.objetivo, 1000);

  ['situacao', 'busca', 'faixa_idade', 'meta_renda', 'quando_comecar',
   'disponibilidade', 'prefere_formato', 'faixa_investimento', 'interesse']
    .forEach((c) => { l[c] = opcao(c, body[c]); });

  /* A etapa tem de vir do vocabulário fechado, como qualquer outro campo de
     escolha: sem isso o painel imprimiria texto do cliente na cara da Nataly. */
  const et = String(body.ultima_etapa === undefined ? '' : body.ultima_etapa).trim();
  l.ultima_etapa = ETAPAS[et] ? et : null;

  return { ok: true, motivo: null, lead: l };
}

/* ---------- roteamento ----------
   Roda a árvore e devolve, num objeto só, o que vai para o banco, o que vai
   para o WhatsApp e o que a tela final mostra. Chamado UMA vez, no servidor:
   o formulário nunca decide o produto sozinho, senão a tela e a linha do
   banco poderiam discordar. */
function roteia(l) {
  const rec = PRD.recomenda(l);
  const colunas = {
    produto_id:      rec.produto.id,
    produto_nome:    rec.produto.nome,
    produto_formato: rec.formato,
    produto_valor:   rec.produto.valor,
    recomendacao_motivos: rec.motivos.join('\n').slice(0, 2000),
    aceita_valor:    deriveAceitaValor(l.faixa_investimento, rec.produto),
  };
  return { rec, colunas };
}

/* O que a tela final precisa saber. Sai do servidor pronto: nenhum preço e
   nenhum checkout é escrito no HTML do formulário, então não existe jeito de
   ela ver o número de um produto que não é o dela. */
function paraTela(rec) {
  const p = rec.produto;
  return {
    id: p.id,
    nome: p.nome,
    nome_meta: p.nome_meta,
    formato: rec.formato,
    preco: p.preco,
    parcela: p.parcela,
    valor: p.valor,
    inclui: p.inclui,
    // Checkout SÓ no caminho online. No presencial a Nataly combina a data
    // antes de cobrar — mandar link aqui seria vender uma vaga sem data.
    checkout: rec.formato === 'online' ? 'https://pay.kiwify.com.br/' + p.checkout : null,
    porque: PRD.porQue(rec),
    // Ela pode vir e só o dinheiro travou: dizer que o presencial existe.
    presencial_possivel: rec.mencionaPresencial ? {
      nome: rec.presencialDaFamilia.nome,
      preco: rec.presencialDaFamilia.preco,
      parcela: rec.presencialDaFamilia.parcela,
    } : null,
    sugestao: rec.familiaIncerta,
  };
}

/* ---------- atribuição ----------
   Vem do cliente, então é dado sujo por definição: tudo cortado no tamanho
   e nada usado em decisão de segurança. Serve para saber de qual anúncio veio. */
function atribuicao(body, req) {
  const a = body.atribuicao || {};
  const t = (v, n) => texto(v, n);
  return {
    utm_source:   t(a.utm_source, 120),
    utm_medium:   t(a.utm_medium, 120),
    utm_campaign: t(a.utm_campaign, 200),
    utm_content:  t(a.utm_content, 200),
    utm_term:     t(a.utm_term, 200),
    fbclid:       t(a.fbclid, 255),
    gclid:        t(a.gclid, 255),
    referrer:     t(a.referrer, 500),
    pagina:       t(a.pagina, 200),
    user_agent:   t(req.headers['user-agent'], 400),
    ip:           ipDe(req),
  };
}

/* ---------- o IP de quem está do outro lado ----------
   🔴 `x-forwarded-for` NÃO serve aqui. Medido em produção em 02/09/2026: o
   primeiro elemento que chega é sempre um endereço da BORDA da Cloudflare, e
   ele MUDA a cada requisição — cinco IPs diferentes em dez chamadas
   (104.23.254.42, 172.69.138.102, 172.71.238.16, 172.71.11.167...).

   O estrago era duplo e nos dois sentidos:
     · sete envios seguidos sem nunca tomar 429 (o freio não freia um script);
     · e uma requisição LIMPA levando 429, porque caiu numa borda que outra
       pessoa já tinha gasto — a mulher que nunca enviou nada era barrada.

   `cf-connecting-ip` é o IP real do visitante e **não é forjável**: a própria
   Cloudflare devolve 403 (error 1000) para quem tenta mandar esse cabeçalho de
   fora. Testado. O `x-forwarded-for` fica como reserva para quando o site
   rodar sem a Cloudflare na frente (desenvolvimento, ou um dia sem CDN). */
function ipDe(req) {
  const cf = req.headers['cf-connecting-ip'];
  const xf = req.headers['x-forwarded-for'];
  const ip = (cf ? String(cf) : '') ||
             (xf ? String(xf).split(',')[0] : '') ||
             req.socket?.remoteAddress || '';
  return ip.trim().replace(/^::ffff:/, '').slice(0, 45) || null;
}

/* ---------- gravação ---------- */
const CAMPOS = [
  'nome', 'telefone', 'telefone_exibicao', 'email', 'instagram', 'cidade', 'estado',
  'faixa_idade', 'situacao', 'busca', 'meta_renda', 'objetivo', 'disponibilidade',
  'prefere_formato', 'faixa_investimento', 'interesse', 'aceita_valor', 'quando_comecar',
  'produto_id', 'produto_nome', 'produto_formato', 'produto_valor', 'recomendacao_motivos',
  'pontuacao', 'qualificacao', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_content', 'utm_term', 'fbclid', 'gclid', 'referrer', 'pagina', 'user_agent', 'ip',
  'lead_uid',
];

/* Os campos que o PARCIAL escreve. É um subconjunto estrito de CAMPOS: nada
   que dependa da árvore entra aqui. */
const CAMPOS_PARCIAL = [
  'nome', 'telefone', 'telefone_exibicao', 'email', 'instagram', 'cidade', 'estado',
  'faixa_idade', 'situacao', 'busca', 'meta_renda', 'objetivo', 'disponibilidade',
  'prefere_formato', 'faixa_investimento', 'interesse', 'quando_comecar', 'ultima_etapa',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid', 'referrer', 'pagina', 'user_agent', 'ip', 'lead_uid',
];

/* Os campos da gravacao da RECOMENDACAO (02/09/2026). E o PARCIAL mais o que
   a arvore decidiu: neste ponto ela respondeu tudo, entao o produto, o preco e
   a qualificacao JA existem — o que ainda nao existe e a confirmacao dela.
   Sem estas colunas a Nataly abriria o painel e veria "parou na recomendacao"
   sem saber QUAL recomendacao, que e justamente o que faz a ligacao valer. */
const CAMPOS_REC = CAMPOS_PARCIAL.concat([
  'produto_id', 'produto_nome', 'produto_formato', 'produto_valor',
  'recomendacao_motivos', 'aceita_valor', 'pontuacao', 'qualificacao',
]);

/* ---------- gravação do PARCIAL (02/09/2026) ----------
   Reaproveita o `lead_uid` e o `ON CONFLICT` que já existiam para o duplo
   clique: o mesmo formulário manda o mesmo uid a cada etapa, então as sete
   chamadas caem sempre na MESMA linha. Não foi preciso inventar chave nova —
   o mecanismo de não duplicar já estava pronto.

   Duas travas, e as duas já custaram raciocínio:

   1. COALESCE(EXCLUDED.x, leads.x) — o parcial NUNCA apaga o que já sabia.
      As chamadas podem chegar fora de ordem (rede móvel reordena, o beacon do
      `pagehide` sai por último mas pode chegar antes), e sem o COALESCE uma
      chamada antiga zeraria os campos que a nova tinha acabado de gravar.

   2. WHERE leads.completo = false — um parcial jamais toca num lead COMPLETO.
      Se o beacon de saída chegar depois do envio final (que é o caso comum:
      ela envia e fecha a aba), sem esta linha ele sobrescreveria o lead pronto
      com uma foto pela metade e apagaria a indicação de produto. */
async function criaParcial(dados) {
  const vals = CAMPOS_PARCIAL.map((c) => (dados[c] === undefined ? null : dados[c]));
  const ph = CAMPOS_PARCIAL.map((_, i) => '$' + (i + 1)).join(', ');
  const set = CAMPOS_PARCIAL
    .filter((c) => c !== 'lead_uid')
    .map((c) => c + ' = COALESCE(EXCLUDED.' + c + ', leads.' + c + ')')
    .join(', ');

  const sql =
    'INSERT INTO leads (' + CAMPOS_PARCIAL.join(', ') + ', completo) ' +
    'VALUES (' + ph + ', false) ' +
    'ON CONFLICT (lead_uid) DO UPDATE SET ' + set + ', atualizado_em = now() ' +
    'WHERE leads.completo = false ' +
    'RETURNING *';

  const r = await db.consulta(sql, vals);
  /* Zero linhas = o ON CONFLICT bateu num lead que JÁ ESTÁ COMPLETO e o WHERE
     recusou a atualização. Não é erro: é a trava funcionando. */
  return r.rows[0] || null;
}

/* ---------- gravação da RECOMENDAÇÃO (02/09/2026) ----------
   Mesma mecanica do parcial — mesmo `lead_uid`, mesmo COALESCE, mesma trava
   `WHERE completo = false` — e pelas mesmas razoes. A unica diferenca e o
   conjunto de colunas: aqui a arvore ja rodou.

   🔴 ISTO NAO E UMA INSCRICAO. A linha continua `completo = false` e a Nataly
      NAO e avisada na hora. Quem promove a linha a inscricao e o clique dela
      no "Quero garantir a minha vaga", que vai para `cria()`. Gravar completo
      aqui traria de volta exatamente o problema que este trabalho corrige:
      contar como inscrita quem so olhou o preco.

   O `ultima_etapa` fixo em ETAPA_REC e o que faz o aviso de parcial dizer a
   verdade mais util do funil: "ela viu o preco e nao confirmou". */
async function criaRecomendacao(dados) {
  const d = Object.assign({}, dados, { ultima_etapa: ETAPA_REC });
  const vals = CAMPOS_REC.map((c) => (d[c] === undefined ? null : d[c]));
  const ph = CAMPOS_REC.map((_, i) => '$' + (i + 1)).join(', ');
  const set = CAMPOS_REC
    .filter((c) => c !== 'lead_uid')
    .map((c) => c + ' = COALESCE(EXCLUDED.' + c + ', leads.' + c + ')')
    .join(', ');

  const sql =
    'INSERT INTO leads (' + CAMPOS_REC.join(', ') + ', completo) ' +
    'VALUES (' + ph + ', false) ' +
    'ON CONFLICT (lead_uid) DO UPDATE SET ' + set + ', atualizado_em = now() ' +
    'WHERE leads.completo = false ' +
    'RETURNING *';

  const r = await db.consulta(sql, vals);
  /* Zero linhas = ela ja tinha confirmado antes (voltou e pediu a recomendacao
     de novo). Nao e erro: a linha completa vale mais e fica como esta. */
  return r.rows[0] || null;
}

async function cria(dados) {
  /* Quem já estava aqui ANTES deste envio? Três respostas possíveis, e cada
     uma leva a um caminho diferente:
       · ninguém          → lead novo, avisa a Nataly;
       · um PARCIAL       → ela terminou! promove a completo e avisa (é a
                            primeira vez que este lead vira inscrição);
       · um COMPLETO      → duplo clique ou reenvio de rede: não avisa de novo.

     Isto substitui o `(xmax = 0) AS novo` que existia aqui. O xmax dizia
     apenas "houve conflito?" — e a partir de 02/09/2026 HÁ conflito em todo
     envio bem-sucedido, porque a linha parcial foi gravada durante o
     preenchimento. Mantê-lo faria todo lead completo cair no ramo de "dedupe"
     e a Nataly PARARIA DE SER AVISADA. */
  const anterior = dados.lead_uid
    ? (await db.consulta('SELECT id, completo FROM leads WHERE lead_uid = $1',
                         [dados.lead_uid])).rows[0] || null
    : null;

  const vals = CAMPOS.map((c) => (dados[c] === undefined ? null : dados[c]));
  const ph = CAMPOS.map((_, i) => '$' + (i + 1)).join(', ');
  /* Aqui NÃO tem COALESCE: o envio final é a versão definitiva das respostas.
     Se ela corrigiu a cidade na última tela, é a correção que vale. */
  const set = CAMPOS
    .filter((c) => c !== 'lead_uid')
    .map((c) => c + ' = EXCLUDED.' + c)
    .join(', ');

  const sql =
    'INSERT INTO leads (' + CAMPOS.join(', ') + ', completo) VALUES (' + ph + ', true) ' +
    'ON CONFLICT (lead_uid) DO UPDATE SET ' + set +
    ", completo = true, ultima_etapa = NULL, atualizado_em = now() " +
    'RETURNING *';

  const r = await db.consulta(sql, vals);
  const linha = r.rows[0];
  /* `novo` continua significando o que sempre significou para quem chama:
     "vale avisar a Nataly?". */
  linha.novo = !(anterior && anterior.completo);
  return linha;
}

/* ---------- os parciais que já esfriaram ----------
   Quem parou no meio e não voltou. `avisado_parcial_em IS NULL` garante UMA
   mensagem por pessoa, para sempre — a Nataly não pode receber lembrete de
   lead pela metade, senão ela para de ler o grupo e o aviso que importa se
   perde no meio do ruído.

   O corte por `criado_em` existe para o dia em que o worker ficar horas fora
   do ar: sem ele, a volta despejaria de uma vez todo mundo que parou desde
   ontem. Melhor perder o aviso de um parcial de 3 dias atrás — que já está
   frio de qualquer jeito — do que inundar o celular dela. */
async function parciaisParaAvisar(minutos, limite = 20) {
  const min = Math.max(1, parseInt(minutos, 10) || 20);
  const r = await db.consulta(
    'SELECT * FROM leads ' +
    'WHERE completo = false ' +
    '  AND avisado_parcial_em IS NULL ' +
    '  AND nome IS NOT NULL AND telefone IS NOT NULL ' +
    "  AND atualizado_em <= now() - ($1 || ' minutes')::interval " +
    "  AND criado_em >= now() - interval '2 days' " +
    'ORDER BY atualizado_em ASC LIMIT ' + parseInt(limite, 10),
    [String(min)]);
  return r.rows;
}

async function marcaAvisadoParcial(id) {
  await db.consulta(
    'UPDATE leads SET avisado_parcial_em = now() WHERE id = $1 AND avisado_parcial_em IS NULL',
    [id]);
}

async function porId(id) {
  const r = await db.consulta('SELECT * FROM leads WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function historico(id) {
  const r = await db.consulta(
    'SELECT * FROM leads_historico WHERE lead_id = $1 ORDER BY criado_em ASC', [id]);
  return r.rows;
}

async function apaga(id) {
  /* `executar` NAO aceita parametros (so recebe SQL) — usar ela aqui deixava o
     $1 sem valor e a rota devolvia 503. O certo e `consulta`.
     E o rowCount de `consulta` vem do numero de linhas devolvidas, entao o
     DELETE precisa de RETURNING para dizer se apagou de fato. */
  await db.consulta('DELETE FROM avisos WHERE lead_id = $1', [id]);
  await db.consulta('DELETE FROM leads_historico WHERE lead_id = $1', [id]);
  const r = await db.consulta('DELETE FROM leads WHERE id = $1 RETURNING id', [id]);
  return r.rows.length > 0;
}

async function avisosDo(id) {
  const r = await db.consulta(
    'SELECT * FROM avisos WHERE lead_id = $1 ORDER BY criado_em DESC', [id]);
  return r.rows;
}

/* Muda o status e registra no histórico, na mesma chamada. Nunca se muda
   status sem deixar rastro — é o que permite auditar o funil depois. */
async function mudaStatus(id, novo, anotacao, autor) {
  if (!STATUS.includes(novo)) throw new Error('status inválido: ' + novo);
  const atual = await porId(id);
  if (!atual) return null;

  const nota = texto(anotacao, 2000);
  const r = nota
    ? await db.consulta(
        'UPDATE leads SET status = $1, anotacao = $2, atualizado_em = now() ' +
        'WHERE id = $3 RETURNING *', [novo, nota, id])
    : await db.consulta(
        'UPDATE leads SET status = $1, atualizado_em = now() ' +
        'WHERE id = $2 RETURNING *', [novo, id]);

  await db.consulta(
    'INSERT INTO leads_historico (lead_id, de_status, para_status, anotacao, autor) ' +
    'VALUES ($1,$2,$3,$4,$5)',
    [id, atual.status, novo, nota, texto(autor, 80)]);

  return r.rows[0];
}

/* ---------- listagem com filtros ---------- */
async function lista(f = {}) {
  const cond = [];
  const p = [];
  const add = (sql, v) => { p.push(v); cond.push(sql.replace('?', '$' + p.length)); };

  /* 🔴 O PADRÃO É "SÓ AS COMPLETAS", e é uma escolha, não um descuido.
     Quem já chamava esta função — o painel antigo, a exportação em CSV, os
     gráficos do funil — pedia leads que responderam tudo. Se os parciais
     entrassem na lista por omissão, cada número do painel mudaria de
     significado da noite para o dia: a taxa de ganho despencaria, o funil
     encheria de "frio" e ninguém saberia que a régua tinha mudado.
     Quem quer os parciais pede por eles: `completo=nao` (só os que pararam no
     meio) ou `completo=tudo` (os dois juntos). */
  const quaisCompleto = String(f.completo || 'sim');
  if (quaisCompleto === 'nao')      cond.push('completo = false');
  else if (quaisCompleto !== 'tudo') cond.push('completo = true');

  /* Filtrar pela pergunta onde ela travou. `preco` é atalho para a etapa 10 —
     é a pergunta que o comercial mais quer, e obrigar a decorar o número dela
     seria esconder a informação atrás de trivia. */
  if (f.parou) {
    /* Dois atalhos, para o comercial não ter de decorar o id da etapa:
       `ultima` = respondeu tudo e não enviou (a fila de ligação de hoje);
       `preco`  = a pergunta do investimento, que só existe em linha antiga. */
    const ATALHO = { preco: ETAPA_PRECO, ultima: 'interesse' };
    const et = ATALHO[f.parou] || String(f.parou);
    if (ETAPAS[et]) add('ultima_etapa = ?', et);
  }

  if (f.status && STATUS.includes(f.status)) add('status = ?', f.status);
  if (f.qualificacao && ['quente', 'morno', 'frio'].includes(f.qualificacao))
    add('qualificacao = ?', f.qualificacao);
  if (f.produto_id && PRODUTO_IDS.includes(f.produto_id)) add('produto_id = ?', f.produto_id);
  if (f.produto_formato && ['online', 'presencial'].includes(f.produto_formato))
    add('produto_formato = ?', f.produto_formato);
  if (f.cidade)      add('LOWER(cidade) LIKE ?', '%' + String(f.cidade).toLowerCase() + '%');
  if (f.utm_content) add('utm_content = ?', f.utm_content);
  if (f.utm_campaign) add('utm_campaign = ?', f.utm_campaign);
  if (f.busca) {
    p.push('%' + String(f.busca).toLowerCase() + '%');
    cond.push('(LOWER(nome) LIKE $' + p.length + ' OR telefone LIKE $' + p.length +
              ' OR LOWER(instagram) LIKE $' + p.length + ')');
  }

  const where = cond.length ? ' WHERE ' + cond.join(' AND ') : '';
  const limite = Math.min(parseInt(f.limite, 10) || 500, 2000);

  const r = await db.consulta(
    'SELECT * FROM leads' + where + ' ORDER BY criado_em DESC LIMIT ' + limite, p);
  return r.rows;
}

/* ---------- números do topo do painel ---------- */
async function resumo() {
  /* Todo agregado de FUNIL é contado só entre as inscrições completas —
     mesma razão do padrão de `lista()`. Um parcial não tem produto indicado
     nem pontuação: jogá-lo nesses gráficos criaria uma fatia "(sem produto)"
     enorme e um monte de "frio" que ninguém respondeu.
     Os parciais têm bloco PRÓPRIO, logo abaixo. */
  const [total, porStatus, porQualif, porProduto, porAnuncio, avisosFalhos,
         parciais, parciaisEtapa] = await Promise.all([
    db.consulta('SELECT COUNT(*)::int AS n FROM leads WHERE completo = true'),
    db.consulta('SELECT status, COUNT(*)::int AS n FROM leads WHERE completo = true GROUP BY status'),
    db.consulta('SELECT qualificacao, COUNT(*)::int AS n FROM leads WHERE completo = true GROUP BY qualificacao'),
    db.consulta("SELECT COALESCE(produto_id, '(sem produto)') AS produto_id, " +
                'COUNT(*)::int AS n FROM leads WHERE completo = true GROUP BY 1 ORDER BY n DESC'),
    db.consulta('SELECT COALESCE(utm_content, referrer, \'(sem origem)\') AS origem, ' +
                'COUNT(*)::int AS n FROM leads WHERE completo = true GROUP BY 1 ORDER BY n DESC LIMIT 20'),
    db.consulta("SELECT COUNT(*)::int AS n FROM avisos WHERE status <> 'enviado'"),
    db.consulta('SELECT COUNT(*)::int AS n FROM leads WHERE completo = false'),
    db.consulta('SELECT ultima_etapa, COUNT(*)::int AS n FROM leads ' +
                'WHERE completo = false GROUP BY 1 ORDER BY n DESC'),
  ]);

  const etapas = parciaisEtapa.rows;
  const conta = (id) => etapas
    .filter((e) => String(e.ultima_etapa) === id)
    .reduce((a, e) => a + e.n, 0);
  /* Histórico: nenhuma linha nova para na etapa do preço desde 05/09/2026.
     Continua contado porque as linhas antigas seguem no painel. */
  const noPreco  = conta(ETAPA_PRECO);
  /* O número que interessa agora: quantas responderam TUDO e não enviaram. */
  const naUltima = conta('interesse');

  return {
    total: total.rows[0].n,
    porStatus: porStatus.rows,
    porQualif: porQualif.rows,
    porProduto: porProduto.rows,
    porAnuncio: porAnuncio.rows,
    avisosFalhos: avisosFalhos.rows[0].n,
    /* O número que o Eduardo quer VISÍVEL: quantas pararam, e quantas
       pararam no último clique — que é a fila de ligação mais fácil que
       existe. `noPreco` fica ao lado dele, para as linhas de antes de
       05/09/2026 não sumirem do painel de um dia para o outro. */
    parciais: {
      total: parciais.rows[0].n,
      noPreco,
      naUltima,
      porEtapa: etapas.map((e) => ({
        etapa: e.ultima_etapa,
        rotulo: ETAPAS[String(e.ultima_etapa)] || '(não sei onde parou)',
        n: e.n,
      })),
    },
  };
}

/* ---------- avisos que não saíram ---------- */
async function avisosProblema() {
  const r = await db.consulta(
    "SELECT a.*, l.nome, l.telefone FROM avisos a JOIN leads l ON l.id = a.lead_id " +
    "WHERE a.status <> 'enviado' ORDER BY a.criado_em DESC LIMIT 200");
  return r.rows;
}

module.exports = {
  importa, buscaLeadNoMeta, leadDoMeta, processaLeadgen, chavesDeTelefone, normalizaImportado,
  registraRecebido, fechaRecebido, recebidosPerdidos, apaga,
  OPCOES, STATUS, PRODUTO_IDS, ETAPAS, ORDEM_ETAPAS, ETAPA_PRECO, ETAPA_REC,
  valida, validaParcial, atribuicao, qualifica, ipDe, roteia, paraTela,
  deriveAceitaValor, descreveEtapa,
  normalizaTelefone, formataTelefone, normalizaInstagram, normalizaEmail,
  cria, criaParcial, criaRecomendacao, parciaisParaAvisar, marcaAvisadoParcial,
  porId, historico, avisosDo, mudaStatus, lista, resumo, avisosProblema,
};

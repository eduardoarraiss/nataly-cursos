/* ============================================================
   AVISO NO WHATSAPP DA NATALY — com fila e nova tentativa
   ============================================================
   Princípio: o lead JÁ ESTÁ no banco quando esta parte roda. Aqui
   nada pode derrubar o pedido da pessoa. Toda falha vira linha na
   tabela `avisos` com status 'pendente' ou 'falhou', e o painel
   mostra quais não saíram.

   DESTINO CONFIGURÁVEL: NATALY_WA_DESTINO aceita tanto um número
   (5535997164668) quanto um id de grupo (....@g.us). O Eduardo vai
   criar um grupo depois — trocar a variável basta, sem tocar código.

   DRIVER PADRÃO É 'log': sem configuração explícita, NADA é enviado
   para o WhatsApp. Conectar exige ação deliberada do Eduardo.
   ============================================================ */
const db = require('./db');
const L = require('./leads');

const CFG = () => ({
  driver:    process.env.NATALY_WA_DRIVER   || 'log',
  url:       (process.env.NATALY_WA_URL     || '').replace(/\/+$/, ''),
  key:       process.env.NATALY_WA_KEY      || '',
  instancia: process.env.NATALY_WA_INSTANCIA || '',
  destino:   process.env.NATALY_WA_DESTINO  || '',
  teste:     process.env.NATALY_WA_TESTE === '1',
  /* Minutos de inatividade antes de avisar sobre quem parou no meio.
     Vive numa env para o Eduardo poder afrouxar ou apertar sem deploy —
     é um número de operação comercial, não uma decisão de código. */
  parcialMin: Math.max(1, parseInt(process.env.FUNIL_PARCIAL_MIN, 10) || 20),
  /* FUNIL_PARCIAL=0 desliga o aviso de incompleto sem desligar nada mais.
     A GRAVAÇÃO do parcial continua acontecendo: o dado é do comercial, o
     aviso é só a forma de entregá-lo. */
  parcialLigado: process.env.FUNIL_PARCIAL !== '0',
});

/* Pedido literal do Eduardo: toda mensagem de teste começa assim. */
const PREFIXO_TESTE = 'Isso é um teste de uma automação, ignore';

/* Backoff: 1min, 5min, 15min, 1h, 6h, 24h. Depois disso desiste e
   marca 'falhou' — mas o lead continua no banco e no painel. */
const ESPERAS_MIN = [1, 5, 15, 60, 360, 1440];
const MAX_TENTATIVAS = ESPERAS_MIN.length;

/* ---------- a mensagem ---------- */
const ROTULO = {
  situacao: { 'ja-lash':'já trabalha com cílios', 'area-beleza':'já é da área da beleza',
              'outra-area':'vem de outra área' },
  busca: { 'aperfeicoar-cilios':'quer se aperfeiçoar na extensão',
           'tecnica-led':'quer aprender a técnica com LED',
           'nao-sei':'ainda não sabe o que buscar — pediu ajuda para decidir' },
  disponibilidade: { sim:'PODE vir a Cambuí', talvez:'talvez consiga vir', nao:'NÃO pode vir' },
  prefere_formato: { presencial:'prefere aprender ao vivo', online:'prefere no próprio ritmo, online',
                     'nao-sei':'não tem preferência de formato' },
  faixa_investimento: { 'ate-500':'até R$ 500', '500-1500':'de R$ 500 a R$ 1.500',
                        '1500-2000':'de R$ 1.500 a R$ 2.000', 'acima-2000':'mais de R$ 2.000',
                        'depende-parcelamento':'consegue mais se parcelar' },
  aceita_valor: { sim:'aceita o valor', 'preciso-parcelar':'aceita, quer parcelar', nao:'NÃO aceita o valor' },
  quando_comecar: { agora:'quer começar agora', '30-dias':'em até 30 dias',
                    '90-dias':'em até 90 dias', 'so-olhando':'só olhando' },
  meta_renda: { 'ate-2k':'até R$ 2 mil', '2k-5k':'R$ 2 a 5 mil', '5k-10k':'R$ 5 a 10 mil',
                'mais-10k':'mais de R$ 10 mil', 'nao-sei':'ainda não sabe' },
  qualificacao: { quente:'🔥 QUENTE', morno:'🟡 MORNO', frio:'🔵 FRIO' },
};

/* Nome curto do produto, para o CABEÇALHO. Pedido literal do Eduardo: o
   título tem de dizer para qual produto ela se qualificou, senão a Nataly
   abre a mensagem sem saber que conversa vai ter. Cai no nome gravado na
   linha (leads antigos) e, em último caso, no genérico — nunca em vazio. */
const PRODUTO_CURTO = {
  'profissao-lash':            'Profissão Lash online',
  'profissao-lash-presencial': 'Profissão Lash online + presencial',
  'lash2-online':              'Método LED online',
  'lash2-presencial':          'Método LED presencial',
};
function tituloProduto(l) {
  return PRODUTO_CURTO[l.produto_id] || l.produto_nome || 'Profissao Lash';
}

/* Origem em portugues, nao em jargao de UTM: quem le no celular as 23h
   nao deve precisar decifrar "utm_content". Mostra o anuncio quando existe,
   e diz o canal por extenso. */
function descreveOrigem(l) {
  const canal = {
    facebook: 'Facebook Ads', fb: 'Facebook Ads', ig: 'Instagram Ads',
    instagram: 'Instagram', google: 'Google', bio: 'link da bio',
  }[String(l.utm_source || '').toLowerCase()] || l.utm_source;

  const partes = [];
  if (canal) partes.push(canal);
  if (l.utm_content) partes.push('anuncio: ' + l.utm_content);
  else if (l.utm_campaign) partes.push('campanha: ' + l.utm_campaign);

  if (!partes.length) return 'Entrou direto no site (sem anuncio)';
  return partes.join(' · ');
}

function montaMensagem(l) {
  const linha = [];

  // Cabecalho: em UM olhar a Nataly sabe o que e, quao quente esta e quem e.
  linha.push('🔔 *LEAD NOVO* · ' + tituloProduto(l));
  linha.push(ROTULO.qualificacao[l.qualificacao] + '  ·  ' + l.pontuacao + '/100');
  linha.push('━━━━━━━━━━━━━━━');
  linha.push('');

  linha.push('*' + l.nome + '*');
  linha.push('📍 ' + l.cidade + (l.estado ? ', ' + l.estado : ''));
  linha.push('📱 ' + L.formataTelefone(l.telefone));
  linha.push('📷 instagram.com/' + l.instagram);
  if (l.email) linha.push('✉️ ' + l.email);
  linha.push('');

  // As respostas dela, em topicos curtos.
  if (l.situacao)           linha.push('• ' + ROTULO.situacao[l.situacao]);
  if (l.busca)              linha.push('• ' + ROTULO.busca[l.busca]);
  if (l.faixa_idade)        linha.push('• ' + l.faixa_idade + ' anos');
  if (l.meta_renda)         linha.push('• meta: ' + ROTULO.meta_renda[l.meta_renda]);
  if (l.quando_comecar)     linha.push('• ' + ROTULO.quando_comecar[l.quando_comecar]);
  linha.push('• ' + ROTULO.disponibilidade[l.disponibilidade]);
  if (l.prefere_formato)    linha.push('• ' + ROTULO.prefere_formato[l.prefere_formato]);
  if (l.faixa_investimento) linha.push('• investe: ' + ROTULO.faixa_investimento[l.faixa_investimento]);

  if (l.objetivo) {
    linha.push('');
    linha.push('💬 _"' + l.objetivo.slice(0, 400) + '"_');
  }

  /* O que a árvore decidiu, e POR QUÊ. Sem o motivo a Nataly recebe um nome
     de produto sem saber de onde ele saiu — e não consegue discordar. */
  if (l.produto_id) {
    linha.push('');
    linha.push('━━━━━━━━━━━━━━━');
    const p = PRODUTO_CURTO[l.produto_id] || l.produto_nome;
    const preco = l.produto_valor ? ' · R$ ' + precoBR(l.produto_valor) : '';
    linha.push('🎯 *Indicado:* ' + p + preco);
    if (l.produto_formato === 'online') {
      linha.push('_Ela já recebeu o link do checkout na tela._');
    } else {
      linha.push('_Sem checkout: combine a data antes de mandar o link._');
    }
    String(l.recomendacao_motivos || '').split('\n')
      .filter(Boolean).slice(0, 4)
      .forEach((m) => linha.push('  ↳ ' + m));
  }

  linha.push('');
  linha.push('━━━━━━━━━━━━━━━');
  linha.push('📢 ' + descreveOrigem(l));
  linha.push('');

  /* 🔴 O link abre a conversa VAZIA, de proposito.
     Nao escrever mensagem na voz da Nataly: quem fala com a aluna e ela, e o
     texto e dela. Ja houve uma versao daqui que mandava a saudacao pronta
     ("Oi, Fulana! Aqui e a Nataly...") — o Edu barrou, e com razao: assinar
     palavras no nome de outra pessoa nao e decisao de quem escreve o codigo.
     Se um dia houver mensagem padrao, ela vem escrita e aprovada por eles. */
  linha.push('👉 *Responder:* https://wa.me/' + l.telefone);

  const corpo = linha.join('\n');
  return CFG().teste ? PREFIXO_TESTE + '\n\n' + corpo : corpo;
}

/* ============================================================
   O AVISO DE QUEM PAROU NO MEIO
   ============================================================
   Regra DIFERENTE da do lead completo, e essa diferença é o ponto:

   · O lead completo é avisado NA HORA. Ele é uma inscrição: tem produto,
     tem preço, tem uma conversa pronta para acontecer.
   · O parcial é avisado UMA VEZ SÓ, depois de um tempo de silêncio.
     Avisar a cada etapa encheria o grupo de sete mensagens por pessoa, e um
     grupo que toca o tempo todo é um grupo que ninguém abre — o aviso que
     importa se perderia no meio do ruído que nós mesmos criamos.

   O tempo de silêncio (20 min por padrão) foi escolhido para ficar acima do
   maior tempo plausível de preenchimento e abaixo do ponto em que a conversa
   esfria: quem parou há 20 minutos ainda está com o assunto na cabeça.

   E o texto tem de deixar ÓBVIO que não é lead pronto. Se a Nataly abrir
   esperando uma inscrição e encontrar meia ficha, ela aprende a desconfiar
   de todo aviso — inclusive dos bons. */
function montaMensagemParcial(l) {
  const et = L.descreveEtapa(l);
  const linha = [];

  linha.push('🟠 *FORMULÁRIO INCOMPLETO* — alguém para chamar');
  if (et && et.posicao) {
    linha.push('Parou na pergunta ' + et.posicao + ' de ' + et.total + ': ' + et.rotulo);
  } else {
    linha.push('Parou no meio do formulário');
  }
  linha.push('━━━━━━━━━━━━━━━');
  linha.push('');

  linha.push('*' + l.nome + '*');
  if (l.cidade) linha.push('📍 ' + l.cidade + (l.estado ? ', ' + l.estado : ''));
  linha.push('📱 ' + L.formataTelefone(l.telefone));
  if (l.instagram) linha.push('📷 instagram.com/' + l.instagram);
  if (l.email) linha.push('✉️ ' + l.email);
  linha.push('');

  /* Só o que ela CHEGOU a responder. Nada de campo vazio enfileirado: uma
     lista cheia de "—" faria a mensagem parecer um erro do sistema. */
  const respostas = [];
  if (l.situacao)           respostas.push(ROTULO.situacao[l.situacao]);
  if (l.busca)              respostas.push(ROTULO.busca[l.busca]);
  if (l.faixa_idade)        respostas.push(l.faixa_idade + ' anos');
  if (l.meta_renda)         respostas.push('meta: ' + ROTULO.meta_renda[l.meta_renda]);
  if (l.quando_comecar)     respostas.push(ROTULO.quando_comecar[l.quando_comecar]);
  if (l.disponibilidade)    respostas.push(ROTULO.disponibilidade[l.disponibilidade]);
  if (l.prefere_formato)    respostas.push(ROTULO.prefere_formato[l.prefere_formato]);
  if (l.faixa_investimento) respostas.push('investe: ' + ROTULO.faixa_investimento[l.faixa_investimento]);

  if (respostas.length) {
    linha.push('O que ela já tinha respondido:');
    respostas.forEach((r) => linha.push('• ' + r));
  } else {
    linha.push('_Ela só chegou a deixar o nome e o WhatsApp._');
  }

  if (l.objetivo) {
    linha.push('');
    linha.push('💬 _"' + String(l.objetivo).slice(0, 400) + '"_');
  }

  linha.push('');
  linha.push('━━━━━━━━━━━━━━━');
  /* A informação comercial forte: parar NA pergunta do dinheiro não é o mesmo
     que parar na do Instagram. Uma é objeção de preço, que se conversa; a
     outra é distração, que se retoma. */
  if (et && et.noPreco) {
    linha.push('💰 Ela parou justamente na pergunta do investimento — é onde');
    linha.push('mais gente desiste, e é a conversa que costuma virar venda.');
  } else {
    linha.push('⚠️ Ela NÃO terminou o formulário, então NÃO viu preço nenhum e');
    linha.push('NÃO tem curso indicado ainda. Não é lead pronto: é alguém que');
    linha.push('parou no meio e vale uma conversa.');
  }
  linha.push('');
  linha.push('📢 ' + descreveOrigem(l));
  linha.push('');
  /* Mesma regra do aviso de lead: a conversa abre VAZIA. O texto é dela. */
  linha.push('👉 *Chamar:* https://wa.me/' + l.telefone);

  const corpo = linha.join('\n');
  return CFG().teste ? PREFIXO_TESTE + '\n\n' + corpo : corpo;
}

/* 1497 -> "1.497". A mensagem vai para o celular da Nataly, e "R$ 1497"
   lido de relance vira R$ 149,70 na cabeça de quem já leu os dois. */
function precoBR(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

function primeiroNome(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }

/* ---------- enfileirar ---------- */
async function enfileira(lead) {
  const cfg = CFG();
  const r = await db.consulta(
    "INSERT INTO avisos (lead_id, destino, mensagem, tipo) VALUES ($1,$2,$3,'lead') RETURNING *",
    [lead.id, cfg.destino || null, montaMensagem(lead)]);
  return r.rows[0];
}

async function enfileiraParcial(lead) {
  const cfg = CFG();
  const r = await db.consulta(
    "INSERT INTO avisos (lead_id, destino, mensagem, tipo) VALUES ($1,$2,$3,'parcial') RETURNING *",
    [lead.id, cfg.destino || null, montaMensagemParcial(lead)]);
  return r.rows[0];
}

/* ---------- a varredura dos parciais esfriados ----------
   Roda no mesmo worker que já retenta os avisos, a cada minuto. Não precisa de
   agendador novo nem de processo separado: o trabalho é o mesmo (achar o que
   está esperando e mandar), e um timer a mais seria uma peça a mais para
   quebrar sozinha.

   `marcaAvisadoParcial` é chamado ANTES do envio, de propósito: se o WhatsApp
   estiver fora, o aviso já está na fila e a fila retenta sozinha. Marcar
   depois abriria a janela em que duas rodadas do worker enfileiram a mesma
   pessoa duas vezes — e mensagem repetida é exatamente o que o Eduardo
   proibiu. */
async function varreParciais() {
  const cfg = CFG();
  if (!cfg.parcialLigado) return { enfileirados: 0, desligado: true };
  const parados = await L.parciaisParaAvisar(cfg.parcialMin);
  let n = 0;
  for (const l of parados) {
    try {
      await L.marcaAvisadoParcial(l.id);
      await enfileiraParcial(l);
      n++;
    } catch (e) {
      console.error('[funil/aviso] parcial ' + l.id + ' não entrou na fila: ' + e.message);
    }
  }
  if (n) console.log('[funil/aviso] ' + n + ' formulário(s) incompleto(s) entraram na fila');
  return { enfileirados: n, desligado: false };
}

/* ---------- envio ---------- */

/* Evolution API própria da Nataly. NÃO é a instância da Haus (haus-r1) —
   essa serve o Roberta OS e não pode ser tocada. */
async function enviaEvolution(cfg, destino, mensagem) {
  if (!cfg.url || !cfg.key || !cfg.instancia) {
    throw new Error('Evolution não configurada (falta NATALY_WA_URL, NATALY_WA_KEY ou NATALY_WA_INSTANCIA)');
  }
  if (!destino) throw new Error('sem destino (defina NATALY_WA_DESTINO)');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(cfg.url + '/message/sendText/' + encodeURIComponent(cfg.instancia), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.key },
      body: JSON.stringify({ number: destino, text: mensagem }),
      signal: ctrl.signal,
    });
    const corpo = await res.text();
    if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + corpo.slice(0, 300));
    return corpo.slice(0, 500);
  } finally { clearTimeout(t); }
}

/* Driver de desenvolvimento: escreve no console e dá por enviado.
   É o PADRÃO — assim o site funciona inteiro sem nada conectado ao WhatsApp. */
async function enviaLog(cfg, destino, mensagem) {
  console.log('\n[funil/aviso] (driver=log, NADA foi enviado ao WhatsApp)');
  console.log('  destino: ' + (destino || '(não configurado)'));
  console.log('  ' + mensagem.split('\n').join('\n  ') + '\n');
  return 'driver=log';
}

async function despacha(cfg, destino, mensagem) {
  if (cfg.driver === 'evolution') return enviaEvolution(cfg, destino, mensagem);
  return enviaLog(cfg, destino, mensagem);
}

/* ---------- processa a fila ---------- */
async function processaFila(limite = 10) {
  const cfg = CFG();
  const pend = await db.consulta(
    "SELECT * FROM avisos WHERE status = 'pendente' AND proxima_em <= now() " +
    'ORDER BY criado_em ASC LIMIT ' + parseInt(limite, 10));

  let enviados = 0, erros = 0;
  for (const a of pend.rows) {
    const destino = a.destino || cfg.destino;
    try {
      await despacha(cfg, destino, a.mensagem);
      await db.consulta(
        "UPDATE avisos SET status='enviado', enviado_em=now(), atualizado_em=now(), " +
        'tentativas = tentativas + 1, ultimo_erro = NULL, destino = $2 WHERE id = $1',
        [a.id, destino || null]);
      enviados++;
    } catch (e) {
      const n = a.tentativas + 1;
      const desistiu = n >= MAX_TENTATIVAS;
      const espera = ESPERAS_MIN[Math.min(n, ESPERAS_MIN.length - 1)];
      await db.consulta(
        'UPDATE avisos SET status = $2, tentativas = $3, ultimo_erro = $4, ' +
        "atualizado_em = now(), proxima_em = now() + ($5 || ' minutes')::interval WHERE id = $1",
        [a.id, desistiu ? 'falhou' : 'pendente', n, String(e.message).slice(0, 500), String(espera)]);
      erros++;
      console.error('[funil/aviso] tentativa ' + n + ' falhou (aviso ' + a.id + '): ' + e.message);
    }
  }
  return { enviados, erros, vistos: pend.rows.length };
}

/* ---------- reenvio manual, a partir do painel ---------- */
async function reenfileira(avisoId) {
  const r = await db.consulta(
    "UPDATE avisos SET status='pendente', tentativas=0, proxima_em=now(), " +
    'ultimo_erro=NULL, atualizado_em=now() WHERE id = $1 RETURNING *', [avisoId]);
  return r.rows[0] || null;
}

/* ---------- worker ---------- */
let _timer = null;
function iniciaWorker(intervaloMs = 60000) {
  if (_timer) return;
  const rodada = () => varreParciais()
    .catch((e) => console.error('[funil/aviso] varredura de parciais: ' + e.message))
    .then(() => processaFila())
    .catch((e) => console.error('[funil/aviso] worker: ' + e.message));
  _timer = setInterval(rodada, intervaloMs);
  if (_timer.unref) _timer.unref();   // não segura o processo aberto
  console.log('[funil/aviso] worker de reenvio a cada ' + Math.round(intervaloMs / 1000) + 's ' +
              '(driver=' + CFG().driver + ')');
}
function paraWorker() { if (_timer) { clearInterval(_timer); _timer = null; } }

module.exports = {
  CFG, PREFIXO_TESTE, montaMensagem, montaMensagemParcial, tituloProduto, ROTULO,
  enfileira, enfileiraParcial, varreParciais, processaFila,
  reenfileira, iniciaWorker, paraWorker, MAX_TENTATIVAS,
};

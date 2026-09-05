/* ============================================================
   AVISO POR E-MAIL — o canal que não depende de pareamento
   ============================================================
   🔴 POR QUE ELE EXISTE. Em 04/09/2026 o aparelho pareado do WhatsApp caiu
      (`device_removed`) e ficou fora por dias. Durante todo esse tempo o lead
      foi gravado e ninguém foi avisado. O WhatsApp é um canal que depende de
      um celular específico continuar pareado — e um canal assim não pode ser
      o único.

      O e-mail não pareia nada. Enquanto o WhatsApp estiver fora, é ele que
      leva o lead até a Nataly.

   🔴 REMETENTE E DESTINATÁRIO SÃO A MESMA CONTA, e isso é escolha de
      ENTREGABILIDADE, não preguiça: o Gmail dela mandando para o Gmail dela
      é o caminho com menos chance de cair em spam que existe sem domínio
      próprio, sem DNS e sem provedor pago. Não há SPF/DKIM a configurar —
      quem assina é o próprio Google, no domínio dele.

   🔴 SENHA DE APP, NUNCA A SENHA DA CONTA. O Google recusa a senha normal em
      SMTP desde 2022; e uma senha de app pode ser revogada sozinha, sem
      derrubar o acesso dela ao e-mail.

   🔴 FALHA FECHADA E VISÍVEL. Sem `NATALY_EMAIL_SENHA` configurada, este
      módulo NÃO finge que enviou: ele recusa, o aviso continua 'pendente' e
      o painel pinta "não avisada". Dizer "enviado" sem ter enviado é o
      defeito que este projeto inteiro passou a semana consertando.
   ============================================================ */
'use strict';

const L = require('./leads');

function CFG() {
  return {
    /* A conta dela, que é a mesma do painel /crm. */
    de: process.env.NATALY_EMAIL_DE || 'natalysamribeiro@gmail.com',
    para: process.env.NATALY_EMAIL_PARA || process.env.NATALY_EMAIL_DE
          || 'natalysamribeiro@gmail.com',
    /* Senha de APP do Google (16 caracteres, gerada em
       Conta Google → Segurança → Verificação em duas etapas → Senhas de app).
       Espaços são ignorados: o Google mostra a senha em blocos de quatro. */
    senha: (process.env.NATALY_EMAIL_SENHA || '').replace(/\s+/g, ''),
    /* Base do painel, para o link que abre a linha do lead. */
    painel: (process.env.NATALY_PAINEL_URL || 'https://natalyribeiro.com.br').replace(/\/+$/, ''),
  };
}

function configurado() { return !!CFG().senha; }

/* ---------- as frases do WhatsApp, iguais às da página ----------
   🔴 Elas têm de dizer o mesmo que a tela disse. Se a mulher escreveu "quero
      aprender a técnica com LED" no formulário e a Nataly abre a conversa
      falando de curso de iniciante, a primeira frase já sai errada. */
const WA_TEXTO = {
  iniciante: 'Oi! Aqui é a Nataly. Vi que você quer se tornar lash designer — ' +
             'posso te explicar como funciona?',
  led: 'Oi! Aqui é a Nataly. Vi que você quer aprender a técnica com LED — ' +
       'posso te explicar como funciona?',
};

function escapa(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* 🔴 CAMPO QUE NÃO VEIO APARECE VAZIO, e aparece MARCADO como vazio.
   A Nataly vai ligar para essa pessoa: um traço cinza dizendo "não informado"
   é informação; um campo preenchido por dedução é ela repetindo em voz alta
   um palpite nosso para alguém real. */
function ou(v) {
  return (v === null || v === undefined || v === '')
    ? '<span style="color:#A79683">— não informado</span>'
    : escapa(v);
}

/* Assunto que se lê na notificação do celular SEM abrir: quem é e o que quer. */
function assunto(lead) {
  const nome = String(lead.nome || 'Alguém').trim().split(/\s+/).slice(0, 2).join(' ');
  const q = lead.interesse === 'led' ? 'quer a técnica LED'
          : lead.interesse === 'iniciante' ? 'quer ser lash designer'
          : 'novo contato';
  const cid = lead.cidade ? ' · ' + lead.cidade : '';
  return '🔔 ' + nome + ' — ' + q + cid;
}

function corpo(lead, cfg) {
  const tel = String(lead.telefone || '').replace(/\D/g, '');
  const frase = WA_TEXTO[lead.interesse] || '';
  /* 🔴 O TELEFONE É UM LINK, e o link já leva a primeira frase escrita. Ela
     abre o e-mail no celular, toca no número e o WhatsApp abre com a conversa
     começada — sem copiar número, sem digitar, sem errar dígito. */
  const wa = tel ? 'https://wa.me/' + tel + (frase ? '?text=' + encodeURIComponent(frase) : '') : null;

  const linha = (rot, val) =>
    '<tr><td style="padding:6px 14px 6px 0;color:#8A7766;font-size:13px;' +
    'white-space:nowrap;vertical-align:top">' + rot + '</td>' +
    '<td style="padding:6px 0;color:#463729;font-size:15px">' + val + '</td></tr>';

  const R = {
    situacao: { 'ja-lash': 'Já trabalha com cílios',
                'area-beleza': 'Já é da área da beleza',
                'outra-area': 'Vem de outra área' },
    disponibilidade: { sim: 'Consegue vir a Cambuí', talvez: 'Talvez consiga vir',
                       nao: 'Não consegue vir' },
    prefere_formato: { presencial: 'Prefere ao vivo', online: 'Prefere online',
                       'nao-sei': 'Não sabe ainda' },
    quando_comecar: { agora: 'Quer começar agora', '30-dias': 'Em até 30 dias',
                      '90-dias': 'Em até 90 dias', 'so-olhando': 'Só pesquisando' },
    interesse: { iniciante: 'Ser lash designer (começar do zero)',
                 led: 'Aprender a técnica com LED' },
  };
  const rot = (c, v) => (v ? (R[c] && R[c][v]) || v : null);

  return '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;' +
    'background:#F2EEE5;padding:24px;color:#463729">' +
    '<div style="max-width:560px;margin:0 auto;background:#FAF7F0;' +
    'border:1px solid #DED3C2;border-radius:14px;padding:24px">' +

    '<p style="margin:0 0 4px;font-size:12px;letter-spacing:.14em;' +
    'text-transform:uppercase;color:#6B4F3A;font-weight:700">Novo lead</p>' +
    '<h1 style="margin:0 0 18px;font-size:26px;line-height:1.2">' + escapa(lead.nome) + '</h1>' +

    (wa ? '<a href="' + wa + '" style="display:inline-block;background:#6B4F3A;' +
      'color:#F2EEE5;text-decoration:none;font-weight:700;font-size:16px;' +
      'padding:13px 22px;border-radius:100px;margin-bottom:20px">' +
      'Chamar no WhatsApp →</a>' : '') +

    '<table style="border-collapse:collapse;width:100%;margin-top:6px">' +
    linha('WhatsApp', wa ? '<a href="' + wa + '" style="color:#6B4F3A;font-weight:600">' +
      escapa(L.formataTelefone(lead.telefone)) + '</a>' : ou(null)) +
    linha('O que quer', ou(rot('interesse', lead.interesse))) +
    linha('Cidade', ou([lead.cidade, lead.estado].filter(Boolean).join(', '))) +
    linha('Instagram', lead.instagram
      ? '<a href="https://instagram.com/' + escapa(lead.instagram) +
        '" style="color:#6B4F3A">@' + escapa(lead.instagram) + '</a>' : ou(null)) +
    linha('E-mail', ou(lead.email)) +
    linha('Situação', ou(rot('situacao', lead.situacao))) +
    linha('Pode vir a Cambuí', ou(rot('disponibilidade', lead.disponibilidade))) +
    linha('Prefere', ou(rot('prefere_formato', lead.prefere_formato))) +
    linha('Quando', ou(rot('quando_comecar', lead.quando_comecar))) +
    linha('Qualificação', ou(lead.qualificacao)) +
    linha('Veio de', ou(lead.utm_content || lead.origem)) +
    '</table>' +

    (lead.objetivo ? '<div style="margin-top:18px;padding:14px 16px;background:#F2EEE5;' +
      'border-left:3px solid #C9A48B;border-radius:8px;font-style:italic;' +
      'font-size:15px;line-height:1.5">“' + escapa(lead.objetivo) + '”</div>' : '') +

    '<p style="margin:22px 0 0;font-size:14px">' +
    '<a href="' + cfg.painel + '/crm?lead=' + encodeURIComponent(lead.id) +
    '" style="color:#6B4F3A;font-weight:600">Abrir no painel →</a></p>' +

    '<p style="margin:18px 0 0;font-size:12px;color:#A79683;line-height:1.5">' +
    'Aviso automático do formulário do site. Campo em cinza é campo que a ' +
    'pessoa não respondeu — não foi deduzido.</p>' +
    '</div></div>';
}

/* ---------- o envio ----------
   Devolve uma string de confirmação. LANÇA quando não deu — e quem chama
   trata isso como "não avisado", nunca como sucesso silencioso. */
async function envia(lead) {
  const cfg = CFG();
  if (!cfg.senha) {
    /* 🔴 ERRO DE CANAL, não da mensagem: o aviso continua pendente e sobe
       sozinho no minuto em que a senha for configurada. Não vira 'falhou'. */
    const e = new Error('e-mail não configurado (falta NATALY_EMAIL_SENHA — ' +
      'senha de APP do Google, não a senha da conta)');
    e.canalFora = true;
    throw e;
  }

  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: cfg.de, pass: cfg.senha },
    /* O Gmail é rápido; se passar disso, é porque não vai. Melhor falhar e
       ser tentado de novo do que segurar a fila. */
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });

  let r;
  try {
    r = await t.sendMail({
      from: '"Leads do site" <' + cfg.de + '>',
      to: cfg.para,
      /* Responder o e-mail cai na própria caixa dela — não some num vazio. */
      replyTo: cfg.para,
      subject: assunto(lead),
      html: corpo(lead, cfg),
      /* Alternativa em texto puro: melhora a entregabilidade e salva quem lê
         no relógio ou com imagens bloqueadas. */
      text: [
        'NOVO LEAD',
        lead.nome,
        'WhatsApp: ' + L.formataTelefone(lead.telefone),
        'O que quer: ' + (lead.interesse || '(não informado)'),
        'Cidade: ' + (lead.cidade || '(não informado)'),
        'Instagram: ' + (lead.instagram ? '@' + lead.instagram : '(não informado)'),
        lead.objetivo ? '\n"' + lead.objetivo + '"' : '',
        '\nPainel: ' + cfg.painel + '/crm',
      ].filter(Boolean).join('\n'),
    });
  } catch (e) {
    /* Falha de SMTP é quase sempre o canal (senha revogada, rede, limite do
       Gmail de ~500/dia). Marcada assim, ela é retentada em vez de morrer. */
    const err = new Error('SMTP: ' + e.message);
    err.canalFora = true;
    throw err;
  } finally {
    try { t.close(); } catch (e) {}
  }

  /* 🔴 CONFERE POR CONTEÚDO. `sendMail` resolvendo não basta: o que prova que
     o servidor aceitou é o `messageId` e o endereço estar em `accepted`. */
  const aceito = r && Array.isArray(r.accepted) && r.accepted.length > 0;
  if (!aceito || !r.messageId) {
    const err = new Error('o Gmail respondeu sem aceitar o destinatário: ' +
      JSON.stringify({ accepted: r && r.accepted, rejected: r && r.rejected }));
    err.canalFora = true;
    throw err;
  }
  return 'email=' + r.messageId + ' aceito=' + r.accepted.join(',');
}

module.exports = { CFG, configurado, envia, assunto, corpo, WA_TEXTO };

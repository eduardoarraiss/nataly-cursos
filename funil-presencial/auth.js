/* ============================================================
   AUTENTICAÇÃO DO PAINEL /crm
   ============================================================
   Do outro lado desta senha há DADOS PESSOAIS REAIS DE TERCEIROS:
   nome, telefone, e-mail, Instagram e cidade de mulheres que
   preencheram um formulário. Por isso, aqui:

     · senha por variável de ambiente, nunca no código;
     · comparação em tempo constante (não vaza a senha por timing);
     · sessão com token aleatório de 256 bits guardada no banco
       (dá para revogar; não é cookie autoassinado solto);
     · cookie HttpOnly + SameSite=Lax + Secure em produção;
     · freio de força bruta por IP;
     · FALHA FECHADA: sem CRM_SENHA configurada, o painel não abre.
       Em nenhuma hipótese um painel sem senha fica no ar.
   ============================================================ */
const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'nr_crm';
const HORAS_SESSAO = 12;
/* O painel e ESTRITO de proposito, ao contrario do formulario publico.
   Aqui o erro caro e o oposto: sao dados pessoais de terceiros e SO DUAS
   PESSOAS entram. Barrar uma delas custa um cafe; deixar passar forca bruta
   custa o cadastro inteiro das alunas. Dez tentativas em quinze minutos e
   folgado para quem erra a senha e apertado para script. */
const MAX_ERROS = 10;         // por IP, na janela abaixo
const JANELA_MIN = 15;
/* Espera CRESCENTE a cada erro, antes mesmo do bloqueio. Um bloqueio seco no
   decimo erro ainda deixa nove tentativas de graca por janela; com a espera
   subindo, uma lista de senhas fica inviavel muito antes disso. O teto de 4 s
   existe para nao prender conexao a toa — quem so errou a senha uma vez nao
   sente nada. */
const ESPERA_POR_ERRO_MS = 400;
const ESPERA_MAX_MS = 4000;

/* CONTAS: cada pessoa com a SUA senha.
   Formato de `CRM_CONTAS`: "email:senha,email:senha".
   A senha nao pode conter virgula (o separador) — se contiver, use `;` como
   separador de contas, que tambem e aceito.
   `CRM_USUARIOS`+`CRM_SENHA` (senha unica) e `CRM_USUARIO` continuam valendo,
   para nao quebrar quem ja estava configurado. */
function CONTAS() {
  const cru = String(process.env.CRM_CONTAS || '').trim();
  if (cru) {
    const mapa = new Map();
    cru.split(cru.includes(';') ? ';' : ',').forEach((par) => {
      const i = par.indexOf(':');
      if (i < 1) return;
      const email = par.slice(0, i).trim().toLowerCase();
      const senha = par.slice(i + 1).trim();
      if (email && senha) mapa.set(email, senha);
    });
    if (mapa.size) return mapa;
  }
  // Retrocompatibilidade: lista de usuarios com uma senha so.
  const unica = process.env.CRM_SENHA || '';
  const mapa = new Map();
  String(process.env.CRM_USUARIOS || process.env.CRM_USUARIO || 'nataly')
    .split(',').map((u) => u.trim().toLowerCase()).filter(Boolean)
    .forEach((u) => mapa.set(u, unica));
  return mapa;
}
const USUARIOS = () => [...CONTAS().keys()];
const USUARIO = () => USUARIOS()[0];
const SENHA = () => process.env.CRM_SENHA || '';
/* O painel so abre se houver conta com senha de verdade. Piso de 8 quando as
   contas trazem senha propria (o Edu definiu senhas de 10), e 12 no modo de
   senha unica, que era a regra original. O freio de forca bruta segura o resto. */
const configurado = () => {
  const contas = CONTAS();
  if (!contas.size) return false;
  const piso = process.env.CRM_CONTAS ? 8 : 12;
  for (const senha of contas.values()) if (!senha || senha.length < piso) return false;
  return true;
};

/* Comparação em tempo constante. Os dois lados passam por SHA-256 antes
   para que o comprimento da senha digitada não vaze pelo tempo da comparação. */
function mesmaSenha(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function leCookie(req, nome) {
  const c = req.headers.cookie || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + nome + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

/* ---------- freio de força bruta ---------- */
async function errosRecentes(ip) {
  const r = await db.consulta(
    "SELECT COUNT(*)::int AS n FROM login_tentativas " +
    "WHERE ip = $1 AND sucesso = false AND criada_em > now() - ($2 || ' minutes')::interval",
    [ip || '?', String(JANELA_MIN)]);
  return r.rows[0].n;
}

async function registraTentativa(ip, sucesso) {
  await db.consulta('INSERT INTO login_tentativas (ip, sucesso) VALUES ($1,$2)',
    [ip || '?', !!sucesso]);
}

/* ---------- sessão ---------- */
async function criaSessao(usuario, ip) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.consulta(
    "INSERT INTO sessoes (token, usuario, expira_em, ip) " +
    "VALUES ($1,$2, now() + ($3 || ' hours')::interval, $4)",
    [token, usuario, String(HORAS_SESSAO), ip || null]);
  return token;
}

async function sessaoValida(token) {
  if (!token) return null;
  const r = await db.consulta(
    'SELECT * FROM sessoes WHERE token = $1 AND expira_em > now()', [token]);
  return r.rows[0] || null;
}

async function encerraSessao(token) {
  if (token) await db.consulta('DELETE FROM sessoes WHERE token = $1', [token]);
}

async function limpaExpiradas() {
  await db.consulta('DELETE FROM sessoes WHERE expira_em < now()');
  await db.consulta("DELETE FROM login_tentativas WHERE criada_em < now() - interval '7 days'");
}

/* ---------- login ---------- */
async function tentaLogin(req, usuario, senha) {
  const ip = ipDe(req);

  if (!configurado()) {
    return { ok: false, motivo: 'nao-configurado' };
  }
  const erros = await errosRecentes(ip);
  if (erros >= MAX_ERROS) {
    return { ok: false, motivo: 'bloqueado' };
  }
  /* A espera vem ANTES de comparar a senha, e por isso vale para a tentativa
     que acerta tambem — o que e proposital: se ela nao valesse, o tempo de
     resposta diria "esta foi a certa". */
  if (erros > 0) {
    await new Promise((r) => setTimeout(r, Math.min(erros * ESPERA_POR_ERRO_MS, ESPERA_MAX_MS)));
  }

    // Percorre TODAS as contas sem sair do laco cedo: parar no primeiro acerto
  // vazaria, pelo tempo de resposta, qual e-mail existe.
  const informado = String(usuario || '').trim().toLowerCase();
  const tentada = String(senha || '');
  let certo = false;
  for (const [email, senhaDaConta] of CONTAS()) {
    if (mesmaSenha(informado, email) && mesmaSenha(tentada, senhaDaConta)) certo = true;
  }
  await registraTentativa(ip, certo);
  if (!certo) return { ok: false, motivo: 'credenciais' };

  const token = await criaSessao(USUARIO(), ip);
  return { ok: true, token };
}

/* ---------- o IP de quem tenta entrar ----------
   Mesma correcao do `leads.js`, e aqui ela pesa mais: do outro lado desta
   senha ha dado pessoal de terceiros. Com o `x-forwarded-for` da Cloudflare, o
   IP mudava a cada requisicao e o freio de forca bruta NAO PRENDIA NINGUEM —
   medido em 02/09/2026: DOZE senhas erradas seguidas, nenhum bloqueio.
   `cf-connecting-ip` e o IP real e nao e forjavel (a Cloudflare recusa com 403
   quem tenta manda-lo de fora). O `x-forwarded-for` fica de reserva para
   quando nao houver CDN na frente. */
function ipDe(req) {
  const cf = req.headers['cf-connecting-ip'];
  const xf = req.headers['x-forwarded-for'];
  const ip = (cf ? String(cf) : '') ||
             (xf ? String(xf).split(',')[0] : '') ||
             req.socket?.remoteAddress || '';
  return ip.trim().replace(/^::ffff:/, '').slice(0, 45);
}

function poeCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: HORAS_SESSAO * 3600 * 1000,
    path: '/crm',
  });
}

function tiraCookie(res) {
  res.clearCookie(COOKIE, { path: '/crm' });
}

/* ---------- porteiro ----------
   Middleware. Páginas ganham redirecionamento para o login; chamadas de
   API ganham 401 em JSON (senão o fetch do painel receberia HTML). */
function exige(opts = {}) {
  return async (req, res, next) => {
    try {
      if (!configurado()) {
        return res.status(503).type('text/plain; charset=utf-8').send(
          'Painel não configurado. Defina a variável de ambiente CRM_SENHA (mínimo 12 caracteres).');
      }
      const sessao = await sessaoValida(leCookie(req, COOKIE));
      if (!sessao) {
        if (opts.api) return res.status(401).json({ erro: 'nao-autenticado' });
        return res.redirect('/crm/entrar');
      }
      req.crm = sessao;
      next();
    } catch (e) {
      console.error('[funil/auth]', e.message);
      res.status(500).type('text/plain; charset=utf-8').send('Erro interno.');
    }
  };
}

module.exports = {
  COOKIE, USUARIO, USUARIOS, CONTAS, configurado, tentaLogin, sessaoValida, encerraSessao,
  limpaExpiradas, poeCookie, tiraCookie, exige, leCookie, ipDe, MAX_ERROS,
};

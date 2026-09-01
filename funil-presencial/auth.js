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
const MAX_ERROS = 8;          // por IP
const JANELA_MIN = 15;

const USUARIO = () => process.env.CRM_USUARIO || 'nataly';
const SENHA = () => process.env.CRM_SENHA || '';
const configurado = () => SENHA().length >= 12;

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
  if (await errosRecentes(ip) >= MAX_ERROS) {
    return { ok: false, motivo: 'bloqueado' };
  }

  const certo = mesmaSenha(usuario || '', USUARIO()) && mesmaSenha(senha || '', SENHA());
  await registraTentativa(ip, certo);
  if (!certo) return { ok: false, motivo: 'credenciais' };

  const token = await criaSessao(USUARIO(), ip);
  return { ok: true, token };
}

function ipDe(req) {
  const xf = req.headers['x-forwarded-for'];
  const ip = (xf ? String(xf).split(',')[0] : '') || req.socket?.remoteAddress || '';
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
  COOKIE, USUARIO, configurado, tentaLogin, sessaoValida, encerraSessao,
  limpaExpiradas, poeCookie, tiraCookie, exige, leCookie, ipDe, MAX_ERROS,
};

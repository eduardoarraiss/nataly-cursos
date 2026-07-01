const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// Canônico = www.natalyribeiro.com.br (o apex redireciona pro www via Cloudflare).
// Rotas amigáveis (sem .html)
const pagina = (file) => (_req, res) => res.sendFile(path.join(PUBLIC, file));

app.get('/', pagina('home.html'));              // home oficial (placeholder; futuro site)
app.get('/vip', pagina('index.html'));          // atalho captação
app.get('/lash-grupo-vip', pagina('index.html')); // URL dos anúncios → captação
app.get('/entrar', pagina('entrar.html'));     // redireciona pro grupo + dispara Lead
// ============================================================
//  TESTE A/B — SPLIT SERVER-SIDE STICKY na URL canônica.
//  A URL /lash-2-metodo-led continua ÚNICA (a campanha NÃO troca o link).
//  1ª visita: sorteia 50/50 A (página longa) x B (enxuta) e grava cookie
//  led_ab (30 dias). Visitas seguintes respeitam o cookie (mesma variante).
//  Serve o HTML na MESMA URL (sendFile, sem redirect). A página /obrigado
//  lê o mesmo cookie pra atribuir a VENDA à variante servida.
// ============================================================
const AB_ARQUIVOS = { A: 'lash-2-metodo-led.html', B: 'lash-2-metodo-led-b.html' };
const AB_MAXAGE = 30 * 24 * 60 * 60 * 1000; // 30 dias

function leCookie(req, nome) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + nome + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function splitAB(req, res) {
  let v = leCookie(req, 'led_ab');
  if (v !== 'A' && v !== 'B') {
    v = Math.random() < 0.5 ? 'A' : 'B';
    res.cookie('led_ab', v, { maxAge: AB_MAXAGE, path: '/', sameSite: 'lax' });
  }
  res.sendFile(path.join(PUBLIC, AB_ARQUIVOS[v]));
}

// ⭐ PÁGINA OFICIAL DOS ANÚNCIOS — URL FIXA E ÚNICA. Split A/B sticky por dentro.
app.get('/lash-2-metodo-led', splitAB);
app.get('/metodo-led', splitAB); // alias curto — mesmo split
// Acesso DIRETO às variantes (QA/preview manual) — NÃO gravam o cookie de split.
app.get('/lash-2-metodo-led-b', pagina('lash-2-metodo-led-b.html')); // B direto
app.get('/metodo-led-b', pagina('lash-2-metodo-led-b.html'));        // alias B direto
app.get('/lash-2-metodo-led-a', pagina('lash-2-metodo-led.html'));   // A direto (QA)

app.get('/lancamento-197', pagina('lancamento.html')); // venda — lançamento (R$197, dia 30/06) · link direto, escondido da home
app.get('/lancamento', pagina('lancamento.html'));     // alias interno (mesma página)
app.get('/presencial', pagina('lancamento-presencial.html'));            // venda — Formação Presencial (R$1.500 / lançamento R$1.197)
app.get('/lancamento-presencial', pagina('lancamento-presencial.html')); // alias interno (mesma página)
app.get('/lancamento-497', pagina('lancamento-497.html')); // LED online — perpétua (R$497 · 12x R$51,40)
app.get('/lancamento-297', pagina('lancamento-297.html')); // LED online — oferta 7 dias (R$297 · 12x R$30,72)
app.get('/curso', pagina('curso.html'));           // venda — perpétua (R$497)

// Páginas de obrigado (pós-compra) — usar como URL de redirecionamento no checkout Kiwify
app.get('/obrigado', pagina('obrigado.html'));                       // online — acesso chega no e-mail
app.get('/obrigado-presencial', pagina('obrigado-presencial.html')); // presencial — bônus no e-mail + equipe entra em contato

// Estáticos (css, img)
app.use(express.static(PUBLIC));

// 404 → volta pra captação
app.use((_req, res) => res.redirect('/'));

app.listen(PORT, () => console.log(`Nataly Cursos rodando na porta ${PORT}`));

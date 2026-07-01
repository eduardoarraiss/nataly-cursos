const express = require('express');
const path = require('path');
const fs = require('fs');

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

// ============================================================
//  FASE DE PREÇO (server-side por data — Railway sempre ligado).
//  Corte: 2026-07-01T03:00:00Z = 00:00 de 01/07 America/Sao_Paulo.
//  Antes = FASE 1 (R$197 · checkout BMda0X4). Depois = FASE 2 (R$497 · 1EX5ICK).
//  Override de QA (NÃO grava nada): ?preco=497 força fase 2, ?preco=197 força fase 1.
// ============================================================
const FASE2_TS = Date.parse('2026-07-01T03:00:00Z');
function faseAtual(req) {
  const q = String((req.query && req.query.preco) || '');
  if (q === '497') return 2;
  if (q === '197') return 1;
  return Date.now() >= FASE2_TS ? 2 : 1;
}

// Bloco de oferta FASE 2 (Opção 1 — card completo). Mesmas classes/tokens da IDV
// da página (f2-* definidas no <style> de cada HTML). Lista real de entregáveis
// + apostila. Injetado no lugar da região <!--OFERTA_F1-->...<!--/OFERTA_F1-->.
const OFERTA_F2 = `<h2 class="titulo titulo--md mt-m">Tudo que você <span class="acento">recebe</span> hoje.</h2>

      <div class="oferta-card oferta-card--f2 mt-l">
        <span class="f2-selo">Acesso imediato · Certificado</span>
        <p class="f2-titulo-inclui">Está tudo incluso:</p>
        <ul class="f2-lista">
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt">O <b>Método LED completo</b> em vídeo, nas 4 fases</span></li>
          <li class="f2-item f2-novo"><span class="f2-ck">✓</span><span class="f2-txt"><b>Apostila completa</b> do Método LED</span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>1 mentoria online por mês</b>, ao vivo comigo</span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>Grupo de suporte</b> durante todo o aprendizado</span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>Acesso por 1 ano</b></span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>Garantia incondicional</b> de 7 dias</span></li>
        </ul>
        <div class="f2-preco-wrap">
          <div class="f2-em12">12× de</div>
          <div class="f2-num"><span class="cif">R$</span>54<span class="cent">,40</span></div>
          <div class="f2-cartao">no cartão de crédito</div>
          <p class="f2-avista">ou <b>R$ 497</b> à vista no Pix</p>
        </div>
        <a href="https://pay.kiwify.com.br/1EX5ICK" class="cta"><span class="f2-cta-main">Quero garantir minha vaga <span class="f2-arw">&rarr;</span></span><small>&#128274; Pagamento seguro &middot; Pix, cartão ou boleto</small></a>
        <p class="f2-garantia">&#128737; Garantia de 7 dias &mdash; risco zero</p>
      </div>`;

// Linha de preço do HERO da Página B (fase 2 — sem ancoragem/riscado).
const HERO_F2 = `<span class="peso acento">12× de R$54,40</span> no cartão &nbsp;·&nbsp; ou <span class="peso acento">R$497</span> à vista`;

// Renderiza a página de venda aplicando a fase (checkout, bloco de preço, labels e value).
const _rawCache = {};
function rawHtml(file) {
  if (!_rawCache[file]) _rawCache[file] = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  return _rawCache[file];
}
function renderVenda(file, fase) {
  let html = rawHtml(file);
  if (fase === 2) {
    html = html.replace(/<!--OFERTA_F1-->[\s\S]*?<!--\/OFERTA_F1-->/g, OFERTA_F2);
    html = html.replace(/<!--HERO_F1-->[\s\S]*?<!--\/HERO_F1-->/g, HERO_F2); // só a Página B tem HERO markers
  }
  const checkout = fase === 2 ? 'pay.kiwify.com.br/1EX5ICK' : 'pay.kiwify.com.br/BMda0X4';
  html = html.split('pay.kiwify.com.br/BMda0X4').join(checkout); // troca só o id do produto, mantém domínio
  html = html.split('@@CTA_PRECO@@').join(fase === 2 ? 'R$497' : 'R$197');
  html = html.split('@@LED_VALUE@@').join(fase === 2 ? '497' : '197');
  return html;
}
function enviaVenda(req, res, file) {
  res.set('Cache-Control', 'no-store'); // garante que a virada de fase apareça na hora
  res.type('html').send(renderVenda(file, faseAtual(req)));
}

function splitAB(req, res) {
  let v = leCookie(req, 'led_ab');
  if (v !== 'A' && v !== 'B') {
    v = Math.random() < 0.5 ? 'A' : 'B';
    res.cookie('led_ab', v, { maxAge: AB_MAXAGE, path: '/', sameSite: 'lax' });
  }
  enviaVenda(req, res, AB_ARQUIVOS[v]);
}

// ⭐ PÁGINA OFICIAL DOS ANÚNCIOS — URL FIXA E ÚNICA. Split A/B sticky + fase de preço por dentro.
app.get('/lash-2-metodo-led', splitAB);
app.get('/metodo-led', splitAB); // alias curto — mesmo split
// Acesso DIRETO às variantes (QA/preview manual) — NÃO gravam o cookie de split. Respeitam ?preco.
app.get('/lash-2-metodo-led-b', (req, res) => enviaVenda(req, res, 'lash-2-metodo-led-b.html')); // B direto
app.get('/metodo-led-b', (req, res) => enviaVenda(req, res, 'lash-2-metodo-led-b.html'));        // alias B direto
app.get('/lash-2-metodo-led-a', (req, res) => enviaVenda(req, res, 'lash-2-metodo-led.html'));   // A direto (QA)

app.get('/lancamento-197', pagina('lancamento.html')); // venda — lançamento (R$197, dia 30/06) · link direto, escondido da home
app.get('/lancamento', pagina('lancamento.html'));     // alias interno (mesma página)
app.get('/presencial', pagina('lancamento-presencial.html'));            // venda — Formação Presencial (R$1.500 / lançamento R$1.197)
app.get('/lancamento-presencial', pagina('lancamento-presencial.html')); // alias interno (mesma página)
app.get('/lancamento-497', pagina('lancamento-497.html')); // LED online — perpétua (R$497 · 12x R$51,40)
app.get('/lancamento-297', pagina('lancamento-297.html')); // LED online — oferta 7 dias (R$297 · 12x R$30,72)
app.get('/curso', pagina('curso.html'));           // venda — perpétua (R$497)
app.get('/oferta-secreta-vip', pagina('oferta-secreta-vip.html')); // SECRETA — grupo VIP (De R$497 por R$297 · 12x R$30,72 · checkout FfyBeg0)

// Páginas de obrigado (pós-compra) — usar como URL de redirecionamento no checkout Kiwify
app.get('/obrigado', pagina('obrigado.html'));                       // online — acesso chega no e-mail
app.get('/obrigado-presencial', pagina('obrigado-presencial.html')); // presencial — bônus no e-mail + equipe entra em contato

// Estáticos (css, img)
app.use(express.static(PUBLIC));

// 404 → volta pra captação
app.use((_req, res) => res.redirect('/'));

app.listen(PORT, () => console.log(`Nataly Cursos rodando na porta ${PORT}`));

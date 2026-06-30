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
// ⭐ PÁGINA OFICIAL DOS ANÚNCIOS — URL FIXA. Trocar só o preço por dentro, nunca a URL.
//    Variante A do teste A/B (página longa). page_variant=A · UTM utm_content=pv_a
app.get('/lash-2-metodo-led', pagina('lash-2-metodo-led.html'));
app.get('/metodo-led', pagina('lash-2-metodo-led.html')); // alias curto
// Variante B do teste A/B — página ENXUTA (mesma oferta R$197 / BMda0X4).
//    page_variant=B · UTM utm_content=pv_b · gestor aponta conjuntos próprios pra cá.
app.get('/lash-2-metodo-led-b', pagina('lash-2-metodo-led-b.html'));
app.get('/metodo-led-b', pagina('lash-2-metodo-led-b.html')); // alias curto

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

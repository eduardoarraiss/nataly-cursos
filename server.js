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
app.get('/lancamento-197', pagina('lancamento.html')); // venda — lançamento (R$197, dia 30/06) · link direto, escondido da home
app.get('/lancamento', pagina('lancamento.html'));     // alias interno (mesma página)
app.get('/curso', pagina('curso.html'));           // venda — perpétua (R$497)

// Estáticos (css, img)
app.use(express.static(PUBLIC));

// 404 → volta pra captação
app.use((_req, res) => res.redirect('/'));

app.listen(PORT, () => console.log(`Nataly Cursos rodando na porta ${PORT}`));

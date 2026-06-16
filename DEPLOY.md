# Site Cursos Nataly — Deploy

Site de cursos da Nataly Ribeiro (Método Evolução LED). Servidor Node + Express estático.

## Estrutura
```
site-cursos/
├── server.js            ← Express, rotas amigáveis
├── package.json         ← start: node server.js
├── public/
│   ├── index.html       ← /          → CAPTAÇÃO (grupo VIP WhatsApp)
│   ├── lancamento.html  ← /lancamento → VENDA lançamento (R$197, só dia 30/06)
│   ├── curso.html       ← /curso      → VENDA perpétua (R$497)
│   ├── css/atelier.css  ← Design System Atelier Sálvia
│   └── img/             ← fotos da Nataly
```

## Rodar local
```bash
cd ~/Documents/clientes/Nataly/site-cursos
npm install
npm start          # http://localhost:3000
```

## Deploy — AUTOMÁTICO via GitHub (não precisa de ação manual)
O serviço **cursos** está conectado ao repo **github.com/eduardoarraiss/nataly-cursos** (branch `main`).
Todo push pra `main` dispara build + deploy automático no Railway. Fluxo:
```bash
cd ~/Documents/clientes/Nataly/site-cursos
git add -A && git commit -m "minha mudança"
git push                       # Railway builda e publica sozinho (~1-2 min)
```
> Não use mais `railway up` (o upload dá timeout do Claude Code). O git push resolve.
> Acompanhar build: `railway status` ou dashboard do Railway.

### Gerar domínio Railway (depois do 1º deploy)
```bash
railway domain --service cursos      # cria o subdomínio .up.railway.app
```

### Domínio próprio (quando comprar)
Railway → projeto Nataly Ribeiro → serviço cursos → Settings → Networking →
Custom Domain → adicionar (ex.: cursos.natalyribeiro.com.br) e apontar o CNAME no registrador.

## PLACEHOLDERS A TROCAR (busque por estes literais)
| Placeholder | Onde | O que colocar |
|-------------|------|---------------|
| `#GRUPO_VIP` | index.html (4×) | Link de convite do grupo VIP (chat.whatsapp.com/...) |
| `#HOTMART_197` | lancamento.html (4×) | Checkout Hotmart do preço de lançamento R$197 |
| `#HOTMART_497` | curso.html (4×) e barra | Checkout Hotmart do preço perpétuo R$497 |
| `SEU_PIXEL_ID_AQUI` | <head> das 3 páginas | ID do Pixel Meta (bloco comentado) |
| `.player__ph` | lancamento.html / curso.html | Trocar pelo `<iframe>` do vídeo VSL quando gravar |
| `12x` (comentário) | lancamento.html / curso.html | Descomentar quando o parcelamento estiver na Hotmart |

## Funil
ads → `/` (captação, grupo VIP) → aquecimento → dia 30 → `/lancamento` (R$197) → depois `/curso` (R$497)

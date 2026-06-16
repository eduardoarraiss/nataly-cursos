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

## Deploy no Railway
Projeto **Nataly Ribeiro** · serviço **cursos** (já criado).
```bash
cd ~/Documents/clientes/Nataly/site-cursos
railway link --project "Nataly Ribeiro"      # se ainda não estiver linkado
railway up --service cursos --detach
```
> Obs.: do ambiente do Claude Code o upload do Railway dá timeout (restrição de rede).
> Rode o `railway up` do seu Terminal normal — funciona como nos outros projetos.

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

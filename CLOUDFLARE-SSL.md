# Cloudflare — deixar natalyribeiro.com.br servindo direto (branded, sem redirect)

Contexto: o Railway não emitiu o cert do domínio custom (apex não valida por causa do CNAME flattening; www ficou travado). Solução: **Cloudflare termina o SSL** (Universal SSL) e **roteia pro serviço Railway via Host Header override**.

O **DNS já está pronto** (apex + www = CNAME proxied → `cursos-production-5ebe.up.railway.app`). NÃO mexer em DNS.

O token de API do Cloudflare só tem permissão de DNS + Page Rules, então **2 passos precisam ser feitos no painel** (SSL mode e Origin Rule). Depois o resto é finalizado via API (remover o redirect).

## Estado interino (já no ar, funciona pros anúncios)
Page Rules redirecionam (301) o domínio pra URL do Railway:
`natalyribeiro.com.br/lash-grupo-vip` → `cursos-production-5ebe.up.railway.app/lash-grupo-vip`
Funciona com SSL válido; só a barra de endereço muda pro railway depois do redirect.

## PASSO 1 — SSL/TLS = Full
dash.cloudflare.com → domínio natalyribeiro.com.br → **SSL/TLS → Visão geral** → Modo = **Full** (não Flexible, não Full strict).

## PASSO 2 — Origin Rule (Host Header override)
**Rules → Origin Rules → Create rule**:
- Nome: `Railway host override`
- When: expressão `(http.host eq "natalyribeiro.com.br") or (http.host eq "www.natalyribeiro.com.br")`
- Then → Set origin → **Host Header → Rewrite to** = `cursos-production-5ebe.up.railway.app`
- (se houver) **SNI → Override** = `cursos-production-5ebe.up.railway.app`
- Deploy.

## PASSO 3 — finalização (via API, eu faço)
Depois do passo 1+2: remover as 2 forwarding page rules (`natalyribeiro.com.br/*` e `www.natalyribeiro.com.br/*`) pra parar o redirect. Aí o domínio serve direto.
Testar: `https://natalyribeiro.com.br/lash-grupo-vip` → 200, cadeado válido, barra fica no domínio.

## Alternativa: ampliar o token e fazer 100% via API
Recriar `CLOUDFLARE_API_TOKEN` com permissões extras: **Zone → Zone Settings: Edit** + **Zone → Config Rules: Edit** (ou Origin Rules). Aí dá pra setar SSL=Full e criar a Origin Rule via API, sem painel.

## Rotas / URLs
- Captação (anúncios): `/lash-grupo-vip` (e `/`, `/vip`)
- Venda lançamento: `/lancamento` · perpétua: `/curso` · redirect grupo: `/entrar`
- Serviço Railway: `cursos-production-5ebe.up.railway.app`

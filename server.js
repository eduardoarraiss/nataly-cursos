const express = require('express');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// ============================================================
//  COMPRESSÃO (02/09/2026) — o site servia TUDO sem comprimir
// ============================================================
//  Medido em 390px, primeira visita, cache desligado: a /profissao-lash-presencial
//  descia 97 KB de HTML cru e a /inscricao-presencial 60 KB. Texto comprime de
//  quatro a seis vezes; esses bytes eram desperdício puro, e no 4G de quem clica
//  num anúncio eles são segundos.
//
//  Escrito com o `zlib` do próprio Node, e não com o pacote `compression`,
//  porque acrescentar dependência de produção não é decisão de quem escreve o
//  código — e aqui não faz falta nenhuma.
//
//  🔴 QUATRO TRAVAS, e cada uma existe por um motivo concreto:
//
//   1. /api/ e /crm NÃO PASSAM POR AQUI. São o formulário que grava a venda e
//      o painel com dado pessoal de terceiro. Eles não têm peso relevante
//      (JSON pequeno) e não há ganho que pague o risco de mexer neles.
//   2. REQUISIÇÃO COM `Range` PASSA DIREITO. É assim que o navegador busca a
//      VSL de 21 MB, e é assim que o gate confere os assets pesados
//      (`curl -r 0-2047`). Comprimir uma resposta parcial quebra o vídeo.
//   3. SÓ TIPO DE TEXTO. JPEG, MP4 e WOFF2 já vêm comprimidos: passá-los pelo
//      gzip gastaria CPU para deixar o arquivo do mesmo tamanho ou maior.
//   4. 204 E 304 NÃO TÊM CORPO. Escrever bytes de gzip num 304 devolveria uma
//      resposta que o navegador não sabe ler.
// ============================================================
const COMPRIMIVEL = /^(?:text\/(?:html|css|plain|csv)|application\/(?:javascript|json)|image\/svg\+xml)/i;
const MIN_GZIP = 1024;   // abaixo disso o cabeçalho do gzip come o ganho

app.use((req, res, next) => {
  if (req.path.indexOf('/api/') === 0 || req.path.indexOf('/crm') === 0) return next();
  if (req.headers.range) return next();
  if (req.method === 'HEAD') return next();
  if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return next();

  const write = res.write.bind(res);
  const end = res.end.bind(res);
  let pedacos = [];      // o corpo, juntado antes de comprimir
  let passar = null;     // true = deixa passar cru (decidido no 1º write)

  /* 🔴 JUNTA O CORPO E COMPRIME UMA VEZ, em vez de empurrar por um stream.
     A primeira versão disto plugava um `zlib.createGzip()` entre o `sendFile`
     e o socket. Funcionava nos cabeçalhos e travava no corpo: saíam os 10
     bytes do cabeçalho do gzip e a resposta nunca fechava — o navegador
     ficava girando. Contrapressão de pipe com um transform no meio tem mais
     casos de borda do que este site precisa resolver.
     Aqui não há stream nenhum: as respostas que passam por este caminho são
     texto de no máximo uma centena de KB (o maior HTML do site tem 97 KB), e
     juntá-las na memória é barato e não tem caso de borda.
     Nada de binário grande passa por aqui — o filtro de tipo e a saída
     antecipada do `Range` já mandaram o vídeo de 21 MB embora lá em cima. */
  function deixaPassar() {
    if (passar !== null) return passar;
    const tipo = String(res.getHeader('Content-Type') || '');
    passar = !!(res.getHeader('Content-Encoding') || !COMPRIMIVEL.test(tipo) ||
                res.statusCode === 204 || res.statusCode === 304);
    return passar;
  }

  res.write = function (pedaco, cod, cb) {
    if (deixaPassar()) return write(pedaco, cod, cb);
    if (pedaco) pedacos.push(Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(pedaco, typeof cod === 'string' ? cod : 'utf8'));
    if (typeof cod === 'function') cod();
    else if (typeof cb === 'function') cb();
    return true;
  };

  res.end = function (pedaco, cod, cb) {
    if (typeof pedaco === 'function') { cb = pedaco; pedaco = undefined; }
    if (deixaPassar()) return end(pedaco, cod, cb);
    if (pedaco) pedacos.push(Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(pedaco, typeof cod === 'string' ? cod : 'utf8'));
    const cru = Buffer.concat(pedacos);
    pedacos = [];

    /* Corpo pequeno não vale o gzip: o cabeçalho e o rodapé do formato somam
       mais do que se ganha, e a resposta sairia MAIOR. */
    if (cru.length < MIN_GZIP) {
      res.setHeader('Content-Length', String(cru.length));
      return end(cru, cb);
    }

    zlib.gzip(cru, { level: 6 }, (erro, comprimido) => {
      /* 🔴 Se o gzip falhar, manda o texto CRU. Uma página lenta é um
         problema; uma página que não carrega é outro, e não é este o lugar
         de trocar um pelo outro. */
      const corpo = (erro || !comprimido || comprimido.length >= cru.length) ? cru : comprimido;
      if (corpo !== cru) {
        res.setHeader('Content-Encoding', 'gzip');
        const vary = String(res.getHeader('Vary') || '');
        if (vary.toLowerCase().indexOf('accept-encoding') === -1) {
          res.setHeader('Vary', vary ? vary + ', Accept-Encoding' : 'Accept-Encoding');
        }
      }
      res.setHeader('Content-Length', String(corpo.length));
      end(corpo, cb);
    });
    return res;
  };
  next();
});

// ============================================================
//  HOTJAR — mapas de calor + gravação de sessão (29/07/2026)
//
//  Snippet OFICIAL (hjsv 6), conferido no pacote publicado pela própria Hotjar
//  (@hotjar/browser@1.0.9, que monta exatamente esta string) — não escrito de memória.
//  Carrega ASSÍNCRONO (r.async=1): não bloqueia o render das páginas, que já são pesadas.
//
//  🔒 KILL SWITCH: o Site ID vem da env HOTJAR_SITE_ID. Se ela estiver VAZIA (ou não for
//  só dígitos), NADA é injetado — nem o <script>, nem o preconnect. Ou seja, este código
//  pode subir junto com qualquer deploy futuro sem ativar rastreamento por acidente,
//  e desligar o Hotjar depois é apagar a env no painel do Railway + restart (sem deploy).
//
//  ⚠️ Só dígitos são aceitos no Site ID de propósito: a env entra dentro de um <script>
//  inline, então qualquer outra coisa seria injeção de HTML/JS na página. O valor ainda passa
//  por Number() antes de virar literal: "0000000" com zeros à esquerda seria octal legado
//  em JS (e SyntaxError em strict mode) — Number() garante um decimal limpo sempre.
// ============================================================
const HOTJAR_SITE_ID = String(process.env.HOTJAR_SITE_ID || '').trim();
const HOTJAR_SV = String(process.env.HOTJAR_SV || '6').trim();
const HOTJAR_ATIVO = /^\d+$/.test(HOTJAR_SITE_ID) && /^\d+$/.test(HOTJAR_SV);
if (HOTJAR_SITE_ID && !HOTJAR_ATIVO) {
  console.warn('[hotjar] HOTJAR_SITE_ID inválido (só dígitos são aceitos) — Hotjar NÃO será injetado.');
}
const HOTJAR_SNIPPET = HOTJAR_ATIVO ? `
<!-- Hotjar Tracking Code — injetado pelo server (env HOTJAR_SITE_ID) -->
<link rel="preconnect" href="https://static.hotjar.com" crossorigin>
<script>
(function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};h._hjSettings={hjid:${Number(HOTJAR_SITE_ID)},hjsv:${Number(HOTJAR_SV)}};a=o.getElementsByTagName('head')[0];r=o.createElement('script');r.async=1;r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;a.appendChild(r);})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');
</script>` : '';

// Injeta o snippet antes do PRIMEIRO </head>. Com HOTJAR_SITE_ID vazio devolve o HTML
// intacto (mesmos bytes de hoje). O replace usa função pra que cifrões no snippet nunca
// sejam interpretados como $&/$1 pelo String.replace.
function injetaHotjar(html) {
  if (!HOTJAR_SNIPPET) return html;
  return html.replace('</head>', () => HOTJAR_SNIPPET + '\n</head>');
}

// Canônico = www.natalyribeiro.com.br (o apex redireciona pro www via Cloudflare).
// Rotas amigáveis (sem .html)
// Com o Hotjar DESLIGADO continua um sendFile puro (zero mudança de comportamento no ar).
// Com o Hotjar ligado, lê o HTML do cache (mesmo rawHtml que renderVenda usa) e injeta.
const pagina = (file) => (_req, res) => {
  if (!HOTJAR_SNIPPET) return res.sendFile(path.join(PUBLIC, file));
  res.type('html').send(injetaHotjar(rawHtml(file)));
};

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
//  Antes = FASE 1 (R$197 · BMda0X4). Depois = FASE 2 (De R$497 por R$297 · FfyBeg0).
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
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt">O <b>Método LED completo</b>, 6 módulos e 19 aulas</span></li>
          <li class="f2-item f2-novo"><span class="f2-ck">✓</span><span class="f2-txt"><b>Apostila completa</b> do Método LED</span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>Lista de materiais com os links</b><span class="porque" style="display:block;font-weight:500;font-size:13.5px;line-height:1.4;color:var(--tinta);opacity:.72;margin-top:2px">Para você não errar na primeira compra do aparelho.</span></span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>1 mentoria online por mês</b>, ao vivo comigo</span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>Grupo de suporte</b> durante todo o aprendizado</span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>Certificado</b> e acesso por 1 ano</span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>Garantia incondicional</b> de 7 dias</span></li>
        </ul>
        <div class="f2-preco-wrap">
          <!-- SEM ANCORAGEM (13/08/2026, decisão do Eduardo): o preço se apresenta limpo.
               A linha de valor anterior foi REMOVIDA daqui: nada de valor riscado, nenhuma tag de
               tachado, nenhum "de X por Y".
               Some junto o bug de contraste que ela carregava (creme .72 sobre card claro
               --papel #FAF7F0 = 1,15:1, ilegível). Elemento removido, bug removido.
               ⚠️ Este comentário viaja pro browser: não escrever valor antigo nem slug aqui. -->
          <div class="f2-em12">12× de</div>
          <div class="f2-num"><span class="cif">R$</span>30<span class="cent">,72</span></div>
          <div class="f2-cartao">no cartão de crédito</div>
          <p class="f2-avista">ou <b>R$ 297</b> à vista no Pix</p>
        </div>
        <!-- ⚠️ NÃO prometer boleto: os checkouts do curso aceitam Cartão, Dois Cartões,
             Pix e Cartão+Pix. Boleto só está ligado na apostila. -->
        <a href="https://pay.kiwify.com.br/FfyBeg0" class="cta" data-cta="oferta"><span class="f2-cta-main">Quero garantir minha vaga <span class="f2-arw">&rarr;</span></span></a>
        <p class="f2-pgto">&#128274; Pagamento seguro &middot; Pix ou cartão</p>
        <p class="f2-garantia">&#128737; Garantia de 7 dias &mdash; risco zero</p>
      </div>`;

// Linha de preço do HERO da Página B (fase 2 — sem ancoragem/riscado).
// ⚠️ CÓDIGO MORTO hoje: nenhuma das páginas (A, B, C, D) tem os marcadores <!--HERO_F1-->,
// então este replace nunca dispara. Mantido para não quebrar uma página futura que os declare
// — mas já SEM ancoragem, para não ressuscitar o "De R$497" se alguém religar os marcadores.
const HERO_F2 = `<span class="peso acento">12× de R$30,72</span> &nbsp;·&nbsp; ou <span class="peso acento">R$297</span> à vista`;

// ============================================================
//  FASE 3 — OFERTA RELÂMPAGO NA PÁGINA PÚBLICA (teste de conversão)
//  De R$297 por R$247 (R$50 de desconto) · 12× R$25,55 · checkout QOSVIDR.
//  Mesmo card aprovado da fase 2 (só muda preço, selo e checkout) + faixa no topo.
//  Voltar pra R$297 = trocar a fase em splitPreco() (1 linha).
// ============================================================
const CHECKOUT_F3 = 'https://pay.kiwify.com.br/QOSVIDR';
const OFERTA_F3 = `<h2 class="titulo titulo--md mt-m">Tudo que você <span class="acento">recebe</span> hoje.</h2>

      <div class="oferta-card oferta-card--f2 oferta-card--f3 mt-l">
        <span class="f3-selo">&#9889; Oferta relâmpago</span>
        <p class="f2-titulo-inclui">Está tudo incluso:</p>
        <ul class="f2-lista">
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt">O <b>Método LED completo</b>, 6 módulos e 19 aulas</span></li>
          <li class="f2-item f2-novo"><span class="f2-ck">✓</span><span class="f2-txt"><b>Apostila completa</b> do Método LED</span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>Lista de materiais com os links</b><span class="porque" style="display:block;font-weight:500;font-size:13.5px;line-height:1.4;color:var(--tinta);opacity:.72;margin-top:2px">Para você não errar na primeira compra do aparelho.</span></span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>1 mentoria online por mês</b>, ao vivo comigo</span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>Grupo de suporte</b> durante todo o aprendizado</span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>Certificado</b> e acesso por 1 ano</span></li>
          <li class="f2-item"><span class="f2-ck">✓</span><span class="f2-txt"><b>Garantia incondicional</b> de 7 dias</span></li>
        </ul>
        <div class="f2-preco-wrap">
          <!-- ⚠️ cor CORRIGIDA: o card F2 usa creme (rgba(242,238,229,.72)) sobre fundo claro,
               o que deixa a ancoragem de preço invisível. Aqui usa tinta-suave (legível). -->
          <p class="f3-de">De <s>R$297</s> por apenas</p>
          <div class="f2-em12">12× de</div>
          <div class="f2-num"><span class="cif">R$</span>25<span class="cent">,55</span></div>
          <div class="f2-cartao">no cartão de crédito</div>
          <p class="f2-avista">ou <b>R$ 247</b> à vista no Pix</p>
        </div>
        <!-- Botão enxuto: só o texto, em UMA linha. O "pagamento seguro" saiu de DENTRO
             do botão e virou legenda abaixo (era ele que fazia o botão virar banner). -->
        <a href="${CHECKOUT_F3}" class="cta" data-cta="oferta"><span class="f2-cta-main">Quero garantir minha vaga <span class="f2-arw">&rarr;</span></span></a>
        <p class="f3-pgto">&#128274; Pagamento seguro &middot; Pix ou cartão</p>
        <p class="f2-garantia">&#128737; Garantia de 7 dias &mdash; risco zero</p>
      </div>`;

// Linha de preço do HERO da Página B na fase 3.
const HERO_F3 = `De <s>R$297</s> por <span class="peso acento">12× de R$25,55</span> &nbsp;·&nbsp; ou <span class="peso acento">R$247</span> à vista`;

// Faixa de topo + selo do card. Duas versões pro Edu escolher (?faixa=ds mostra a
// versão 100% dentro do design system; padrão = "quente", verde, como ele pediu):
//   quente → verde #A9DB7E (o mesmo verde de preço já usado nas peças da Nataly)
//            com texto pretinho #241C15. Contrastes medidos no pixel renderizado:
//              preço "DE R$297 POR R$247" (protagonista) = 10.48:1 (AAA)
//              rótulo "⚡ OFERTA RELÂMPAGO" em pretinho 78%  = 6.14:1 (AA)
//            ⚠️ NÃO usar o verde do card (--f2-verde #79A85B): a faixa ficaria idêntica
//            ao preço do card e os dois competiriam. #A9DB7E é 1.73:1 mais claro que ele,
//            então lê como faixa (mais clara/vibrante) e o card mantém o dele.
//   ds     → chocolate var(--chocolate) com creme (mesma da /oferta-relampago, dentro do DS)
// Hierarquia da faixa (invertida em 20/07 a pedido do Edu): o PREÇO é o que salta;
// "⚡ oferta relâmpago" recua pra rótulo menor; "R$50 de desconto" é o menor de todos.
const VERDE_F3 = '#A9DB7E';
const RELAMPAGO_TOPO_CSS = (quente) => `
<style>
  /* display:block (não flex) — o <s> tem que fluir como texto, senão vira item de flex e quebra torto */
  .rel3-faixa { position: sticky; top: 0; z-index: 60; display: block; padding: 9px 14px;
    text-align: center; text-wrap: balance;
    font-family: var(--f-body); line-height: 1.25;
    text-transform: uppercase;
    background: ${quente ? VERDE_F3 : 'var(--chocolate)'};
    color: ${quente ? '#241C15' : 'var(--branco-quente)'}; }
  /* rótulo — secundário, mas continua sendo o nome da faixa */
  .rel3-lead { display: block; font-size: 11px; font-weight: 800; letter-spacing: .14em;
    color: ${quente ? 'rgba(36,28,21,.78)' : 'rgba(242,238,229,.82)'}; }
  /* PROTAGONISTA — o preço */
  .rel3-preco { display: block; font-size: 19px; font-weight: 900; letter-spacing: .01em;
    margin-top: 1px; }
  /* menor hierarquia */
  .rel3-off { font-size: 11px; font-weight: 700; letter-spacing: .04em; white-space: nowrap;
    color: ${quente ? 'rgba(36,28,21,.78)' : 'rgba(242,238,229,.82)'}; }
  /* opacity .72 (não menos): abaixo disso o R$297 riscado cai pra 3.96:1 e reprova AA */
  .rel3-faixa s { font-weight: 700; opacity: .72; text-decoration-thickness: 2px; }
  @media (max-width: 520px) {
    .rel3-faixa { padding: 8px 12px; }
    .rel3-lead { font-size: 10px; letter-spacing: .1em; }
    .rel3-preco { font-size: 17px; }
    .rel3-off { font-size: 10px; letter-spacing: .02em; }
  }
  @media (max-width: 380px) {
    .rel3-preco { font-size: 15.5px; }
    .rel3-off { display: none; } /* em tela estreita fica só "de R$297 por R$247" */
  }

  .oferta-card--f3 .f3-selo { display:inline-flex; align-items:center; gap:8px; border-radius:100px;
    padding:8px 16px; font-family:var(--f-body); font-size:12.5px; font-weight:800;
    letter-spacing:.1em; text-transform:uppercase;
    background: ${quente ? VERDE_F3 : 'transparent'};
    color: ${quente ? '#241C15' : 'var(--chocolate)'};
    border: 1px solid ${quente ? VERDE_F3 : 'var(--chocolate)'}; }
  @media (max-width: 400px) { .oferta-card--f3 .f3-selo { font-size:12px; letter-spacing:.07em; } }

  /* Ancoragem "De R$297 por apenas" — é ela que sustenta a percepção de desconto,
     então não pode ficar apagada. Era var(--tinta-suave) #8A7766 (3.28:1 = reprova AA
     sobre o card --papel #FAF7F0); agora var(--tinta) #463729 = 8.99:1.
     Continua subordinada ao R$247 pelo tamanho (21px x ~74-104px) e pelo itálico. */
  .oferta-card--f3 .f3-de { font-family: var(--f-apoio); font-style: italic; font-size: 21px;
    color: var(--tinta); margin-bottom: 2px; }
  .oferta-card--f3 .f3-de s { text-decoration-thickness: 2px; color: var(--tinta); opacity: .78; }

  /* ── CTA da fase 3 ────────────────────────────────────────────────────────────
     O card da fase 3 carrega as DUAS classes (oferta-card--f2 + --f3), então herdava
     o .cta da fase 2: flex-column com o "pagamento seguro" dentro, 132px de altura em
     390px e o texto quebrando em 2 linhas. Estes overrides são escopados em --f3 e
     este <style> só é injetado na fase 3 → o botão do CONTROLE (fase 2) fica intacto. */
  .oferta-card--f3 .cta { flex-direction: row; justify-content: center; gap: 0;
    min-height: 58px; padding: 14px 18px; }
  .oferta-card--f3 .cta .f2-cta-main { font-size: 16.5px; white-space: nowrap; }
  @media (max-width: 400px) { .oferta-card--f3 .cta .f2-cta-main { font-size: 15.5px; } }
  @media (max-width: 344px) { .oferta-card--f3 .cta { padding: 14px 10px; }
    .oferta-card--f3 .cta .f2-cta-main { font-size: 14.5px; gap: 6px; } }
  /* em 320px o texto ficava com 4px de folga lateral — apertado demais pra confiar */
  @media (max-width: 330px) { .oferta-card--f3 .cta .f2-cta-main { font-size: 13.5px; } }
  /* legenda que saiu de dentro do botão */
  .oferta-card--f3 .f3-pgto { font-family: var(--f-body); font-weight: 600; font-size: 11.5px;
    letter-spacing: .05em; text-transform: uppercase; color: var(--tinta); opacity: .78;
    margin-top: 9px; text-align: center; }
</style>`;

// ============================================================
//  FASE 2 — CSS injetado (13/08/2026)
//  Espelha o que a fase 3 já fazia: legenda de pagamento FORA do botão, para o CTA
//  caber em UMA linha. Sem ancoragem de preço (não existe mais elemento riscado).
// ============================================================
const OFERTA_F2_CSS = `
<style>
  /* legenda que saiu de dentro do botão — mesmas medidas da .f3-pgto já aprovada */
  /* ⚠️ contraste: --tinta-suave #8A7766 sobre o card --papel #FAF7F0 dá 4,00:1 e REPROVA
     AA (a própria página D anota isso no <style> dela). Usa --tinta com opacity .78, que
     é o mesmo recurso que a página já usa em .qa-card .a e .video-card .case. */
  .oferta-card--f2 .f2-pgto { display: block; font-family: var(--f-body); font-weight: 600;
    font-size: 11.5px; letter-spacing: .05em; text-transform: uppercase;
    color: var(--tinta); opacity: .78; margin-top: 9px; text-align: center; }
  /* rede de segurança para páginas cujo .oferta-card--f2 .cta ainda é flex-column
     (A e B): com o <small> removido, sobra só o texto, então a coluna vira uma linha. */
  .oferta-card--f2 .cta { min-height: 58px; }
</style>`;

const RELAMPAGO_TOPO_FAIXA = `<div class="rel3-faixa"><span class="rel3-lead">&#9889;&nbsp;Oferta relâmpago</span><span class="rel3-preco">de&nbsp;<s>R$297</s> por&nbsp;R$247 <span class="rel3-off">&middot; R$50 de desconto</span></span></div>`;

// Renderiza a página de venda aplicando a fase (checkout, bloco de preço, labels e value).
const _rawCache = {};
function rawHtml(file) {
  if (!_rawCache[file]) _rawCache[file] = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  return _rawCache[file];
}
function renderVenda(file, fase, opts) {
  let html = rawHtml(file);
  if (fase === 2) {
    html = html.replace(/<!--OFERTA_F1-->[\s\S]*?<!--\/OFERTA_F1-->/g, OFERTA_F2);
    html = html.replace(/<!--HERO_F1-->[\s\S]*?<!--\/HERO_F1-->/g, HERO_F2); // marcadores hoje inexistentes
    html = html.replace('</head>', OFERTA_F2_CSS + '\n</head>');
  }
  if (fase === 3) {
    html = html.replace(/<!--OFERTA_F1-->[\s\S]*?<!--\/OFERTA_F1-->/g, OFERTA_F3);
    html = html.replace(/<!--HERO_F1-->[\s\S]*?<!--\/HERO_F1-->/g, HERO_F3);
    const quente = !(opts && opts.faixa === 'ds');
    // O CSS entra sempre: além da faixa, ele define .f3-selo, .f3-de, .f3-pgto e os
    // overrides do botão do card da fase 3.
    html = html.replace('</head>', RELAMPAGO_TOPO_CSS(quente) + '\n</head>');
    // Opt-out da FAIXA de preço no topo: a página D não pode exibir preço acima do
    // hero (decisão do Edu de 30/07 — preço vive só no campo de oferta). Quem quiser
    // ficar sem a faixa declara <!--SEM_FAIXA_PRECO--> no HTML. Aditivo: as páginas
    // que não têm o marcador seguem recebendo a faixa como antes.
    if (!html.includes('<!--SEM_FAIXA_PRECO-->')) {
      html = html.replace('<body>', '<body>\n' + RELAMPAGO_TOPO_FAIXA);
    }
  }
  const checkout = fase === 3 ? 'pay.kiwify.com.br/QOSVIDR'
    : fase === 2 ? 'pay.kiwify.com.br/FfyBeg0'
    : 'pay.kiwify.com.br/BMda0X4';
  html = html.split('pay.kiwify.com.br/BMda0X4').join(checkout); // troca só o id do produto, mantém domínio
  html = html.split('@@CTA_PRECO@@').join(fase === 3 ? 'R$247' : fase === 2 ? 'R$297' : 'R$197');
  html = html.split('@@LED_VALUE@@').join(fase === 3 ? '247' : fase === 2 ? '297' : '197');
  // Tokens da Página D — todo preço da D é injetado, nenhum é hardcoded. Isso existe porque
  // a C escreveu "De R$297 ... 12× R$25,55" fixo no hero: com FASE_PADRAO=2 (o rollback sem
  // deploy) a tela mostraria três preços diferentes ao mesmo tempo. Aditivo: as páginas que
  // não têm estes tokens simplesmente não são afetadas pelo split.
  html = html.split('@@PRECO_DE@@').join(fase === 3 ? 'R$297' : 'R$497');
  html = html.split('@@PARCELA@@').join(fase === 3 ? '12× de R$25,55' : fase === 2 ? '12× de R$30,72' : '12× de R$20,37');
  // Largura da barra na ancoragem de MERCADO (curso importado R$4.500 = 100%). Tem que
  // derivar do preço da fase, senão a barra mente: com R$297 desenhado no 5,5% do R$247
  // o gráfico mostraria um preço que não é o cobrado. 197→4.4% · 297→6.6% · 247→5.5%.
  html = html.split('@@ANC_BARRA@@').join(fase === 3 ? '5.5%' : fase === 2 ? '6.6%' : '4.4%');
  // Hotjar por último: cobre TODAS as páginas de venda que passam por aqui (A, B, C, 297,
  // aliases e a /oferta-relampago, que também renderiza por renderVenda). Sem a env, no-op.
  return injetaHotjar(html);
}
function enviaVendaFase(req, res, file, fase) {
  res.set('Cache-Control', 'no-store'); // garante que a virada de fase apareça na hora
  res.type('html').send(renderVenda(file, fase, { faixa: String((req.query && req.query.faixa) || '') }));
}
function enviaVenda(req, res, file) {
  enviaVendaFase(req, res, file, faseAtual(req));
}

function splitAB(req, res) {
  let v = leCookie(req, 'led_ab');
  if (v !== 'A' && v !== 'B') {
    v = Math.random() < 0.5 ? 'A' : 'B';
    res.cookie('led_ab', v, { maxAge: AB_MAXAGE, path: '/', sameSite: 'lax' });
  }
  enviaVenda(req, res, AB_ARQUIVOS[v]);
}

// ============================================================
//  TESTE A/B DE PREÇO — página oficial ÚNICA (A "lash-2-metodo-led.html"),
//  split sticky 50/50 (cookie led_preco, 30 dias). Mesmo design nas duas pontas.
//    • 50% -> De R$497 por R$197 (12× R$20,37 · à vista R$197 · checkout BMda0X4) = fase 1
//    • 50% -> De R$497 por R$297 (12× R$30,72 · à vista R$297 · checkout FfyBeg0) = fase 2
//  A URL /lash-2-metodo-led continua ÚNICA (a campanha NÃO troca o link).
//  Atribuição da venda é AUTOMÁTICA na Kiwify: cada preço tem checkout diferente.
//  Override QA (não grava cookie): ?preco=197 força 197; ?preco=297 ou ?preco=497 força 297.
// ============================================================
const PRECO_MAXAGE = 30 * 24 * 60 * 60 * 1000; // 30 dias
// PÁGINA OFICIAL = D desde 30/07/2026 (aprovada pelo Edu). A antiga (A) continua no
// disco e acessível em /lash-2-metodo-led-a, que é o caminho de rollback rápido: para
// voltar atrás, trocar esta linha de volta para 'lash-2-metodo-led.html' e `railway up`.
const PAGINA_OFICIAL = 'lash-2-metodo-led-d.html';
// Fase servida por padrão na página pública. Só aceita 2 (R$297) ou 3 (R$247 relâmpago).
// ⚠️ PADRÃO INVERTIDO EM 13/08/2026: a oferta relâmpago acabou. Agora só FASE_PADRAO=3
// (explícito) serve R$247 — vazio ou qualquer outro valor cai em 2 (R$297 · FfyBeg0).
// Antes era o contrário, e o padrão implícito era o relâmpago. Conferido em 13/08 pelo
// `railway variables --service cursos`: a env FASE_PADRAO NÃO está setada em produção,
// então hoje a página cai no padrão do código — por isso inverter aqui basta.
// Continua servindo de rollback pelo painel do Railway, sem redeploy, nos dois sentidos.
const FASE_PADRAO = String(process.env.FASE_PADRAO || '') === '3' ? 3 : 2;
function splitPreco(req, res) {
  const q = String((req.query && req.query.preco) || '');
  if (q === '197') return enviaVendaFase(req, res, PAGINA_OFICIAL, 1);            // QA 197
  if (q === '297' || q === '497') return enviaVendaFase(req, res, PAGINA_OFICIAL, 2); // QA 297 (versão anterior)
  if (q === '247') return enviaVendaFase(req, res, PAGINA_OFICIAL, 3);            // QA 247

  // 💰 PREÇO PÚBLICO = FASE 2 desde 13/08/2026: R$297 à vista · 12× de R$30,72 ·
  // checkout FfyBeg0 · SEM ancoragem, SEM valor riscado, SEM faixa e SEM selo relâmpago.
  // O teste de oferta relâmpago (20/07 a 13/08, R$247 · QOSVIDR) foi encerrado.
  //
  // RELIGAR A RELÂMPAGO SEM DEPLOY: setar a env FASE_PADRAO=3 no Railway (volta pro
  // R$247 / QOSVIDR no restart, sem mexer em código). Vazio ou qualquer outro = R$297.
  // Faixa dentro do design system (chocolate) em vez do verde: ?faixa=ds
  return enviaVendaFase(req, res, PAGINA_OFICIAL, FASE_PADRAO);

  // ⏸️ BRAÇO 197 PAUSADO EM 15/07/2026 (decisão do Edu).
  // Motivo: o R$197 passou a ser a oferta relâmpago do grupo VIP (/oferta-relampago,
  // 2 últimos dias do mês). Enquanto o split servia R$197 a ~50% do tráfego frio TODO
  // DIA, a "relâmpago exclusiva" não era exclusiva nem escassa. Página pública agora
  // travada em R$297 (fase 2). O QA ?preco=197 continua funcionando.
  // Pra retomar o teste: apagar este return e descomentar o bloco abaixo.
  return enviaVendaFase(req, res, PAGINA_OFICIAL, 2);

  /* eslint-disable no-unreachable */
  // let v = leCookie(req, 'led_preco');
  // if (v !== '197' && v !== '297') {
  //   v = Math.random() < 0.5 ? '197' : '297';
  //   res.cookie('led_preco', v, { maxAge: PRECO_MAXAGE, path: '/', sameSite: 'lax' });
  // }
  // enviaVendaFase(req, res, PAGINA_OFICIAL, v === '297' ? 2 : 1);
}

// ⭐ PÁGINA OFICIAL DOS ANÚNCIOS — URL FIXA E ÚNICA. Split A/B de PREÇO (197 x 297) por dentro.
app.get('/lash-2-metodo-led', splitPreco);
app.get('/metodo-led', splitPreco); // alias curto — mesmo split de preço
// Acesso DIRETO às variantes (QA/preview manual) — NÃO gravam o cookie de split. Respeitam ?preco.
app.get('/lash-2-metodo-led-b', (req, res) => enviaVenda(req, res, 'lash-2-metodo-led-b.html')); // B direto
app.get('/metodo-led-b', (req, res) => enviaVenda(req, res, 'lash-2-metodo-led-b.html'));        // alias B direto
app.get('/lash-2-metodo-led-a', (req, res) => enviaVenda(req, res, 'lash-2-metodo-led.html'));   // A direto (QA)
// C direto (QA) — página nova de conversão (29/07/2026). Roda na MESMA fase de preço da página
// oficial (FASE_PADRAO), então o preço e o checkout são idênticos aos da A e a única variável é a
// página. NÃO recebe tráfego: enquanto a rota /lash-2-metodo-led continuar em splitPreco, esta URL
// só é acessível por link direto. Ver o patch de split 50/50 antes de mandar tráfego pra cá.
app.get('/lash-2-metodo-led-c', (req, res) => enviaVendaFase(req, res, 'lash-2-metodo-led-c.html', FASE_PADRAO));
// PÁGINA D — versão enxuta (objeção respondida cedo, depoimento em vídeo, ancoragem de mercado).
// Mesma fase/checkout/preço da oficial, então a única variável é a página. Rota ADITIVA: não
// recebe tráfego enquanto /lash-2-metodo-led continuar em splitPreco. Para promover a D a
// oficial, trocar PAGINA_OFICIAL para 'lash-2-metodo-led-d.html' (uma linha).
app.get('/lash-2-metodo-led-d', (req, res) => enviaVendaFase(req, res, 'lash-2-metodo-led-d.html', FASE_PADRAO));
app.get('/metodo-led-d', (req, res) => enviaVendaFase(req, res, 'lash-2-metodo-led-d.html', FASE_PADRAO));
// PÁGINA OFICIAL PADRÃO travada em R$297 (mesmo template do /lash-2-metodo-led, fase 2 fixa):
// âncora "De R$497 por R$297" (12× R$30,72) + checkout FfyBeg0. Link limpo e estável (NÃO usa cookie de split).
app.get('/lash-2-metodo-led-297', (req, res) => enviaVendaFase(req, res, PAGINA_OFICIAL, 2));

// ============================================================
//  OFERTA RELÂMPAGO — /oferta-relampago (De R$497/R$297 por R$197 · checkout BMda0X4).
//  Vende SÓ nos 2 ÚLTIMOS dias do mês, no fuso America/Sao_Paulo. Fora da janela a
//  página continua no ar, mas o CTA vira botão bloqueado + popup de aviso.
//
//  Por que "2 últimos dias" e não "dia 30 e 31": fevereiro não tem dia 30 nem 31
//  (a oferta NUNCA abriria) e meses de 30 dias teriam 1 dia só em vez de 2.
//  "2 últimos dias" cai em 30–31, 29–30 ou 27–28 conforme o mês, sempre 2 dias.
//
//  ⚠️ O gate é da PÁGINA, não do checkout: pay.kiwify.com.br/BMda0X4 continua
//  vendendo direto pra quem tiver o link salvo. Fechar de verdade exige desativar
//  a oferta na Kiwify (ou usar um checkout dedicado só da relâmpago).
//
//  Override QA (não grava nada): ?relampago=1 força aberta; ?relampago=0 força fechada.
// ============================================================
// Usa a MESMA página oficial do /lash-2-metodo-led (design oficial) renderizada na
// fase 1 (R$197 · BMda0X4) — o motor renderVenda() já troca preço, labels e checkout.
// Assim a relâmpago e a página pública nunca divergem de design nem de copy.
// ⚠️ DESACOPLADO de PAGINA_OFICIAL em 30/07/2026, quando a D virou a oficial.
// renderRelampago() faz três replaces por string EXATA que só existem no HTML da
// página A: o selo (`<div class="oferta-card mt-l">`, que na D é `oferta-card--f2`)
// e, quando a janela fecha, a remoção do CTA de compra
// (`<a href="...BMda0X4" class="cta">Garantir minha vaga por R$197</a>`).
// A D tem 7 CTAs e nenhum com esse texto: apontar a relâmpago para ela faria o
// bloqueio da oferta encerrada falhar em silêncio, deixando os 7 botões vendendo
// R$197 fora da janela. Enquanto renderRelampago() não for reescrito para a D,
// esta rota fica travada na A de propósito.
const RELAMPAGO_PAGINA = 'lash-2-metodo-led.html';
const RELAMPAGO_CHECKOUT = 'https://pay.kiwify.com.br/BMda0X4';

// Estado da relâmpago: aberta nos 2 últimos dias do mês corrente (horário de Brasília).
function estadoRelampago(req) {
  const [ano, mes, dia] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // dia 0 do mês seguinte
  const q = String((req && req.query && req.query.relampago) || '');
  if (q === '1') return { aberta: true, ultimoDoMes: false };  // QA: força aberta
  if (q === '0') return { aberta: false, ultimoDoMes: false }; // QA: força fechada
  return { aberta: dia >= ultimoDia - 1, ultimoDoMes: dia === ultimoDia };
}

// CSS dos badges + popup. Só tokens do design system da página (atelier.css):
// --chocolate (acento/CTA), --branco-quente, --papel, --tinta, --tinta-suave,
// --filete, --pedra. Filete 1px e sem box-shadow, como manda a IDV.
const RELAMPAGO_CSS = `
<style>
  /* Faixa fixa no topo — mostra o estado sem precisar rolar */
  .rel-faixa { position: sticky; top: 0; z-index: 60; display: flex; align-items: center;
    justify-content: center; gap: 10px; padding: 11px 16px; text-align: center;
    font-family: var(--f-body); font-size: 13px; font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase; }
  .rel-faixa--no-ar    { background: var(--chocolate); color: var(--branco-quente); }
  .rel-faixa--esgotada { background: var(--pedra); color: var(--tinta); }
  .rel-faixa b { font-weight: 800; }
  @media (max-width: 460px) { .rel-faixa { font-size: 11px; letter-spacing: .06em; padding: 9px 12px; } }

  /* Selo dentro do card de oferta */
  .rel-selo { display: inline-flex; align-items: center; gap: 8px; border-radius: 100px;
    padding: 7px 16px; margin-bottom: 14px; font-family: var(--f-body); font-size: 12px;
    font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  .rel-selo::before { content: ""; width: 6px; height: 6px; border-radius: 50%; }
  .rel-selo--no-ar    { border: 1px solid var(--chocolate); color: var(--chocolate); }
  .rel-selo--no-ar::before    { background: var(--chocolate); }
  .rel-selo--esgotada { border: 1px solid var(--filete); color: var(--tinta-suave); }
  .rel-selo--esgotada::before { background: var(--tinta-suave); }

  /* Botão bloqueado + aviso (só no estado esgotada) */
  .cta--bloqueado { background: var(--filete) !important; color: var(--tinta-suave) !important; cursor: not-allowed; }
  .cta--bloqueado:hover { transform: none; opacity: 1; }
  .rel-aviso { font-family: var(--f-body); font-size: 14px; line-height: 1.5; color: var(--tinta-suave);
    border: 1px solid var(--filete); border-radius: 12px; padding: 12px 16px; margin: 0 auto 16px;
    max-width: 420px; text-align: center; }
</style>`;

const faixa = (aberta, ultimoDoMes) => aberta
  ? `<div class="rel-faixa rel-faixa--no-ar">&#9889; Oferta Relâmpago no ar &middot; <b>termina ${ultimoDoMes ? 'hoje' : 'amanhã'}</b></div>`
  : `<div class="rel-faixa rel-faixa--esgotada">Oferta Relâmpago esgotada</div>`;

const selo = (aberta) => aberta
  ? `<p class="rel-selo rel-selo--no-ar">&#9889; Oferta Relâmpago</p>`
  : `<p class="rel-selo rel-selo--esgotada">Oferta Relâmpago esgotada</p>`;

// Popup injetado só quando a oferta está fechada.
// O texto NÃO revela que a oferta volta todo mês — dizer "abre de novo dia 30" ensina
// a base a esperar, que é exatamente o hábito que a estratégia do grupo quer matar.
const RELAMPAGO_POPUP = `
<div id="rel-modal" class="rel-modal" role="dialog" aria-modal="true" aria-labelledby="rel-tit" hidden>
  <div class="rel-modal__fundo" data-rel-fechar></div>
  <div class="rel-modal__card" role="document">
    <div class="rel-modal__icone" aria-hidden="true">&#9888;</div>
    <p id="rel-tit" class="rel-modal__tit">Ops! Essa condição não está disponível agora</p>
    <p class="rel-modal__txt">Essa oferta foi aberta por tempo limitado e já encerrou. O Método LED continua disponível pelo valor normal, com o mesmo conteúdo e o mesmo suporte de sempre.</p>
    <a href="/lash-2-metodo-led" class="rel-modal__cta">Ver o Método LED</a>
    <button type="button" class="rel-modal__fechar" data-rel-fechar>Agora não</button>
  </div>
</div>
<style>
  .rel-modal[hidden] { display: none; }
  .rel-modal { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .rel-modal__fundo { position: absolute; inset: 0; background: rgba(36,28,21,.62); }
  .rel-modal__card { position: relative; background: var(--papel); border: 1px solid var(--filete);
    border-radius: 18px; padding: 32px 26px 26px; max-width: 420px; width: 100%; text-align: center; }
  .rel-modal__icone { font-size: 34px; line-height: 1; color: var(--chocolate); margin-bottom: 14px; }
  .rel-modal__tit { font-family: var(--f-display); font-style: italic; font-size: 24px; line-height: 1.25;
    color: var(--tinta); margin: 0 0 10px; }
  .rel-modal__txt { font-family: var(--f-body); font-size: 15px; line-height: 1.6; color: var(--tinta-suave); margin: 0 0 22px; }
  .rel-modal__cta { display: block; font-family: var(--f-body); font-weight: 600; font-size: 15px;
    background: var(--chocolate); color: var(--branco-quente); border-radius: 100px; padding: 15px 24px; text-decoration: none; }
  .rel-modal__fechar { display: block; margin: 12px auto 0; background: none; border: 0; cursor: pointer;
    font-family: var(--f-body); font-size: 14px; color: var(--tinta-suave); text-decoration: underline; }
</style>
<script>
  (function () {
    var modal = document.getElementById('rel-modal');
    if (!modal) return;
    function abre(e) { if (e) e.preventDefault(); modal.hidden = false; document.body.style.overflow = 'hidden'; }
    function fecha() { modal.hidden = true; document.body.style.overflow = ''; }
    document.querySelectorAll('[data-rel-bloqueado]').forEach(function (el) { el.addEventListener('click', abre); });
    modal.querySelectorAll('[data-rel-fechar]').forEach(function (el) { el.addEventListener('click', fecha); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !modal.hidden) fecha(); });
  })();
</script>`;

function renderRelampago(req) {
  const { aberta, ultimoDoMes } = estadoRelampago(req);

  // Base: a página oficial na fase 1 (R$197 · BMda0X4), mesmo design do /lash-2-metodo-led.
  let html = renderVenda(RELAMPAGO_PAGINA, 1);

  // CSS dos badges + faixa fixa no topo do body.
  html = html.replace('</head>', RELAMPAGO_CSS + '\n</head>');
  html = html.replace('<body>', '<body>\n' + faixa(aberta, ultimoDoMes));

  // Selo dentro do card de oferta.
  html = html.replace('<div class="oferta-card mt-l">', '<div class="oferta-card mt-l">\n        ' + selo(aberta));

  if (aberta) return html; // checkout ativo

  // Fechada: remove o CTA de compra (é o único link pro checkout na página) e explica.
  html = html.replace(
    '<a href="' + RELAMPAGO_CHECKOUT + '" class="cta">Garantir minha vaga por R$197</a>',
    '<p class="rel-aviso">Essa condição já encerrou. O Método LED segue disponível pelo valor normal.</p>\n' +
    '          <a href="#" class="cta cta--bloqueado" data-rel-bloqueado="1" aria-disabled="true">&#128274; Oferta encerrada</a>'
  );
  return html.replace('</body>', RELAMPAGO_POPUP + '\n</body>');
}

function enviaRelampago(req, res) {
  res.set('Cache-Control', 'no-store'); // a virada da janela precisa aparecer na hora
  res.type('html').send(renderRelampago(req));
}

app.get('/oferta-relampago', enviaRelampago); // ⭐ URL oficial da relâmpago do grupo VIP
// Aliases antigos (links já colados no grupo/WhatsApp continuam funcionando)
const paraRelampago = (req, res) => {
  const qs = req.originalUrl.indexOf('?');
  res.redirect(302, '/oferta-relampago' + (qs === -1 ? '' : req.originalUrl.slice(qs)));
};
app.get('/lancamento-197', paraRelampago);
app.get('/lancamento', paraRelampago);
// Formação Presencial — R$1.997 à vista / 12× R$206,54, checkout eZ1ZPoU.
// Preço atualizado em 30/07/2026, depois de o checkout novo ser verificado renderizando
// (eZ1ZPoU cobra R$1.997; o antigo 9dKsbFP cobrava R$1.197). A ancoragem "De R$1.500" foi
// REMOVIDA em vez de reescrita: com o preço de venda em R$1.997, um "de" menor que o "por"
// lê como erro, e não há preço cheio acima de R$1.997 documentado em lugar nenhum.
// ⚠️ O checkout antigo 9dKsbFP CONTINUA ATIVO cobrando R$1.197. Nenhuma página do site
//    aponta mais para ele, mas link já compartilhado (bio, grupo, e-mail, anúncio antigo)
//    segue vendendo pelo preço velho até ser desativado no painel da Kiwify.
app.get('/presencial', pagina('lancamento-presencial.html'));            // venda — Formação Presencial
app.get('/lancamento-presencial', pagina('lancamento-presencial.html')); // alias interno (mesma página)
app.get('/lancamento-497', pagina('lancamento-497.html')); // LED online — perpétua (R$497 · 12x R$51,40)
app.get('/lancamento-297', pagina('lancamento-297.html')); // LED online — oferta 7 dias (R$297 · 12x R$30,72)
app.get('/curso', pagina('curso.html'));           // venda — perpétua (R$497)
app.get('/oferta-secreta-vip', pagina('oferta-secreta-vip.html')); // SECRETA — grupo VIP (De R$497 por R$297 · 12x R$30,72 · checkout FfyBeg0)
app.get('/oferta-especial', pagina('oferta-especial.html')); // PÚBLICO FRIO — educacional, tema claro+ouro, oferta R$297 revelada (checkout FfyBeg0). Destino dos anúncios de tráfego frio.
app.get('/apostila', pagina('apostila.html')); // LOW TICKET — apostila digital do Método LED (PDF, R$67,90, IDV Atelier Sálvia). ⚠️ CTA #oferta até configurar checkout Kiwify.

// ============================================================
//  PROFISSÃO LASH — curso de extensão de cílios para INICIANTES
//  Funil de CAPTAÇÃO (sem preço em nenhuma página): anúncio → /profissao-lash
//  → clique no CTA → /entrar-profissao-lash (dispara Lead) → grupo de WhatsApp.
//
//  ⚠️ Produto e público DIFERENTES do Método LED / Lash 2.0. Não misturar:
//     /vip e /lash-grupo-vip continuam sendo a captação do Método LED (avançado).
//
//  A /entrar-profissao-lash tem um gate: se a constante GRUPO_WHATSAPP
//  dentro do HTML não for um convite válido, ela NÃO redireciona e NÃO
//  dispara Lead, em vez de mandar o lead pra lugar nenhum. Hoje aponta
//  para o grupo "Curso INICIANTE on-line".
// ============================================================

// URL OFICIAL — é esta que vai nos anúncios pagos.
app.get('/captacao-iniciante-online', pagina('profissao-lash.html'));

// Aliases antigos → 302 pra oficial, preservando a query string (UTMs).
// Existem só para não quebrar link já compartilhado; não usar em anúncio novo.
const paraCaptacaoIniciante = (req, res) => {
  const qs = req.originalUrl.indexOf('?');
  res.redirect(302, '/captacao-iniciante-online' + (qs === -1 ? '' : req.originalUrl.slice(qs)));
};
app.get('/profissao-lash', paraCaptacaoIniciante);
app.get('/lash-iniciante', paraCaptacaoIniciante);

// ============================================================
//  PÁGINA DE VENDAS do Profissão Lash (curso iniciante) — 31/08/2026
//  Rota separada da captação DE PROPÓSITO: /captacao-iniciante-online
//  continua sendo a URL dos 3 anúncios ativos e não pode ser mexida.
//  Esta aqui é a página com a VSL, a grade das 39 aulas e a oferta.
// ============================================================
app.get('/profissao-lash-curso', pagina('profissao-lash-curso.html'));

// ============================================================
//  PÁGINA DE VENDAS do Profissão Lash ONLINE + PRESENCIAL — 01/09/2026
//  Oferta diferente e mais cara (R$ 1.497, checkout VluGxKq): o curso online
//  completo MAIS um dia de prática ao vivo em Cambuí, MG, com material incluso.
//  ⚠️ Nada a ver com /presencial e /lancamento-presencial, que continuam sendo
//  a Formação Presencial do Método LED (R$ 1.997) e não podem ser mexidas.
// ============================================================
app.get('/profissao-lash-presencial', pagina('profissao-lash-presencial.html'));

// FORMULÁRIO DE QUALIFICAÇÃO — rota própria (01/09/2026).
// O formulário saiu de dentro da página de venda e virou página separada, só
// com ele, no modelo do formulário de referência. A página de venda constrói
// o desejo e NÃO mostra preço; o valor aparece só aqui, na última pergunta.
// ⚠️ A rota contém "presencial": o ramo próprio no pixel.js e no analytics.js
//    é testado ANTES do ramo da Formação Presencial LED.
app.get('/inscricao-presencial', pagina('inscricao-presencial.html'));
app.get('/profissao-lash-presencial/inscricao', (_req, res) =>
  res.redirect(301, '/inscricao-presencial'));   // atalho, caso alguém divulgue assim

app.get('/entrar-profissao-lash', pagina('entrar-profissao-lash.html')); // Lead + redirect pro grupo

// Páginas de obrigado (pós-compra) — usar como URL de redirecionamento no checkout Kiwify
app.get('/obrigado', pagina('obrigado.html'));                       // online — acesso chega no e-mail
app.get('/obrigado-presencial', pagina('obrigado-presencial.html')); // presencial — bônus no e-mail + equipe entra em contato
app.get('/obrigado-apostila', pagina('obrigado-apostila.html'));     // OTO pós-compra da apostila — upsell do curso R$197 (checkout BMda0X4)

// Obrigado do Profissão Lash — uma por oferta, porque a mensagem muda:
//   online   → o acesso chega no e-mail e ela começa hoje
//   combo    → o acesso chega no e-mail E a data da prática é agendada com ela
// ⚠️ Nenhuma das duas dispara Purchase: quem dispara é a Kiwify (pixel + CAPI).
app.get('/obrigado-profissao-lash', pagina('obrigado-profissao-lash.html'));
app.get('/obrigado-profissao-lash-presencial', pagina('obrigado-profissao-lash-presencial.html'));

// Página de LINKS (link na bio) — Método LED online, presencial e Pinça LED Pro
app.get('/links', pagina('links/index.html'));
app.get('/bio', pagina('links/index.html')); // alias curto

// ============================================================
//  WEBHOOK KIWIFY → META CAPI (Purchase server-side, 1x por venda)
//  Fonte ÚNICA de Purchase APÓS desligar o pixel FB nativo da Kiwify (corte pós-pico).
//  ⚠️ Enquanto o pixel nativo da Kiwify estiver ligado, NÃO registrar este webhook
//     na Kiwify (viraria 3ª fonte). Rota inerte até a Kiwify apontar pra cá.
//  Precisa das ENV: META_CAPI_TOKEN, KIWIFY_WEBHOOK_TOKEN (e opcional META_TEST_EVENT_CODE).
// ============================================================
const { makeHandler } = require('./webhook-kiwify');
app.post('/webhooks/kiwify', express.raw({ type: '*/*' }), makeHandler());
app.get('/webhooks/kiwify/health', (_req, res) =>
  res.json({ ok: true, capi_token: !!process.env.META_CAPI_TOKEN, test_mode: !!process.env.META_TEST_EVENT_CODE }));

// ============================================================
//  POLÍTICA DE PRIVACIDADE
//  Obrigatória para os formulários instantâneos do Meta (Lead Ads): sem a
//  URL de uma política válida o formulário não pode ser veiculado.
//  ⚠️ Antes disso estas rotas caíam no fallback `res.redirect('/')` e
//     devolviam a HOME com 200 — pareciam existir e não existiam.
// ============================================================
app.get('/politica-de-privacidade', pagina('politica-de-privacidade.html'));
app.get('/privacidade', pagina('politica-de-privacidade.html'));  // alias curto
app.get('/privacy', pagina('politica-de-privacidade.html'));      // alias em inglês


// ============================================================
//  FUNIL DE QUALIFICAÇÃO — Profissão Lash Online + Presencial
//  O formulário da /profissao-lash-presencial substituiu o checkout direto:
//  a pessoa se candidata, a Nataly qualifica e fecha pelo WhatsApp.
//
//  ⚠️ Tem de ser montado AQUI, antes do express.static e do catch-all da
//     linha de baixo. O catch-all transforma 404 em 302 para "/", então um
//     POST /api/lead-presencial montado depois receberia um redirecionamento
//     em vez da API.
//
//  Módulo isolado em ./funil-presencial: banco, API, avisos e painel /crm.
//  Nada aqui tem relação com a Haus, com o Roberta OS ou com o CRM da agência.
// ============================================================
try {
  const funil = require('./funil-presencial/rotas');
  app.use(funil);

  // A migração roda no boot: garante o schema sem passo manual de deploy.
  // Se o banco estiver fora do ar, o SITE CONTINUA DE PÉ — só o funil fica
  // indisponível. Uma página de vendas não pode cair por causa do CRM.
  const bd = require('./funil-presencial/db');
  const avisos = require('./funil-presencial/notificador');
  const auth = require('./funil-presencial/auth');
  bd.migrar()
    .then(() => {
      avisos.iniciaWorker(60000);
      setInterval(() => auth.limpaExpiradas().catch(() => {}), 3600000).unref();
    })
    .catch((e) => console.error('[funil] banco indisponível no boot:', e.message));
} catch (e) {
  console.error('[funil] módulo não carregou (o site segue normal):', e.message);
}


// ============================================================
//  Estáticos (css, img, fontes, vídeo) — AGORA COM CACHE
// ============================================================
//  Estava `max-age=0`: cada visita revalidava CADA arquivo. Na primeira visita
//  isso não custa bytes, mas custa uma ida e volta por arquivo — e o funil tem
//  DUAS páginas em sequência (a de venda e o formulário) que compartilham as
//  fontes, o pixel.js e o analytics.js. Sem cache, o segundo passo do funil
//  refazia toda a conversa com o servidor para receber "não mudou nada".
//
//  Os prazos são deliberadamente diferentes, e o critério é UM: quanto tempo eu
//  aguento esperar se precisar trocar o arquivo NO MESMO NOME.
//   · vídeo (21 MB, nunca muda)  → 30 dias
//   · imagem e fonte             → 7 dias
//   · js e css                   → 1 hora. É pouco de propósito: um conserto no
//     pixel.js no meio de uma campanha tem de chegar no mesmo dia, e uma hora
//     já mata a revalidação dentro da sessão, que é o ganho que importa.
app.use(express.static(PUBLIC, {
  setHeaders: (res, caminho) => {
    const ext = path.extname(caminho).toLowerCase();
    let segundos = 0;
    if (ext === '.mp4' || ext === '.webm') segundos = 30 * 24 * 3600;
    else if (['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg', '.ico',
              '.woff2', '.woff', '.ttf'].indexOf(ext) !== -1) segundos = 7 * 24 * 3600;
    /* 🔴 js e css NAO sao cacheados por tempo, de proposito.
       Em 02/09/2026 o pixel.js chegou a ser servido pela Cloudflare com
       `cf-cache-status: HIT`, `age: 3333` e `max-age=14400` — quatro horas.
       Como o HTML e servido com `max-age=0` e atualiza na hora, abria-se uma
       janela de ate 4h em que o visitante rodava HTML NOVO com SCRIPT VELHO.
       Essa combinacao quebra a pagina de um jeito que nao reproduz em teste
       nenhum: o HTML chama o que o script antigo nao tem, da erro e o
       formulario trava. Com campanha no ar, e dinheiro entrando em pagina morta.

       `no-cache` NAO desliga o cache: manda revalidar sempre. Com o ETag que o
       express ja envia, a resposta comum vira um 304 sem corpo — barato — e
       fica impossivel rodar codigo velho. */
    else if (ext === '.js' || ext === '.css') {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return;
    }
    if (segundos) res.setHeader('Cache-Control', 'public, max-age=' + segundos);
  },
}));

// 404 → volta pra captação
app.use((_req, res) => res.redirect('/'));

app.listen(PORT, () => console.log(`Nataly Cursos rodando na porta ${PORT}`));

/**
 * Health-check dos checkouts Kiwify em uso nas páginas de venda.
 *
 * Por que existe: o QOSVIDR (R$247) é o único checkout que recebe tráfego pago,
 * e o site tem vários checkouts ativos com preços diferentes. Se um cair ou tiver
 * o preço alterado no painel, os CTAs viram link morto ou passam a cobrar outro
 * valor, e a página continua respondendo 200 — a falha é silenciosa e só aparece
 * na receita.
 *
 * Por que Puppeteer e não curl: o HTML cru dos checkouts Kiwify é idêntico entre
 * si (é só o shell do JS). curl dá falso positivo. Só dá pra saber renderizando.
 *
 * Uso: node scripts/health-checkouts.js
 * Sai com código 1 se qualquer checkout estiver morto ou com preço divergente.
 */

const puppeteer = require('puppeteer');

// Parcela em 12× é a assinatura confiável do preço — o valor cheio nem sempre
// aparece no innerText do checkout renderizado.
const CHECKOUTS = [
  { slug: 'QOSVIDR', preco: 247, parcela: '25,55', uso: 'oferta relâmpago — ÚNICO com tráfego pago' },
  { slug: 'FfyBeg0', preco: 297, parcela: '30,72', uso: 'padrão histórico / rollback FASE_PADRAO=2' },
  { slug: 'BMda0X4', preco: 197, parcela: '20,37', uso: 'oferta relâmpago VIP / lancamento-197' },
  // 🔴 Acrescentados em 02/09/2026: sao os checkouts que a ARVORE DO FUNIL
  //    entrega hoje, e nenhum dos tres de cima e. A campanha de R$ 120/dia
  //    aponta para /profissao-lash-presencial, e quem termina o formulario cai
  //    num destes — vigiar so os antigos era vigiar o produto errado.
  { slug: 'y1Pz2US', preco: 497, parcela: '51,40', uso: 'Profissão Lash online — recomendado pela árvore' },
  // 🔴 VluGxKq (online + presencial) SAIU da vigilância em 03/09/2026. O combo
  //    virou R$ 1.197 à vista no PIX, cobrado FORA da Kiwify, e a árvore nunca
  //    devolveu link de checkout para caminho presencial — vigiar o slug seria
  //    cobrar da página um número (R$ 1.497 / 154,82) que ela não usa mais e
  //    disparar alarme falso toda madrugada. O produto segue existindo lá.
];
// Nenhum presencial entra (eZ1ZPoU R$ 1.997 e o combo online + presencial): a
// árvore não devolve link de checkout para caminho presencial — a Nataly combina
// a data antes de cobrar. Vigiar um link que a página nunca mostra só daria ruído.

const SINAL_DE_MORTE = /não (está )?dispon|indispon|não encontrad|expirad|inativ|página não/i;

(async () => {
  /* Chrome do sistema, como fazem o `verificar-layout.js` e o
     `teste-formulario.js`. Sem `executablePath` o puppeteer procura um Chrome
     na cache dele (~/.cache/puppeteer), que nao existe nesta maquina — e a
     mensagem "Could not find Chrome (ver. 148...)" nao parece um problema de
     configuracao, parece um problema do site. */
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const navegador = await puppeteer.launch({ headless: 'new', executablePath: CHROME });
  const alertas = [];

  for (const { slug, preco, parcela, uso } of CHECKOUTS) {
    const aba = await navegador.newPage();
    await aba.setViewport({ width: 390, height: 844, isMobile: true });

    try {
      const resposta = await aba.goto(`https://pay.kiwify.com.br/${slug}`, {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });
      // O checkout monta o preço em JS depois do networkidle.
      await new Promise((r) => setTimeout(r, 3500));
      const texto = await aba.evaluate(() => document.body.innerText);

      if (resposta.status() !== 200) {
        alertas.push(`${slug} (R$${preco}) — HTTP ${resposta.status()}. ${uso}`);
      } else if (SINAL_DE_MORTE.test(texto)) {
        alertas.push(`${slug} (R$${preco}) — checkout REMOVIDO ou inativo. ${uso}`);
      } else if (!texto.includes(parcela)) {
        const achados = [...new Set(texto.match(/R\$\s?[\d.,]+/g) || [])].slice(0, 5).join(' ');
        alertas.push(`${slug} — esperava 12× R$${parcela} (R$${preco}), não encontrei. Achei: ${achados}. ${uso}`);
      } else {
        console.log(`ok    ${slug}  R$${preco}  (12× R$${parcela})`);
      }
    } catch (erro) {
      alertas.push(`${slug} (R$${preco}) — falhou ao carregar: ${erro.message.slice(0, 120)}. ${uso}`);
    }

    await aba.close();
  }

  await navegador.close();

  if (alertas.length) {
    console.error('\n🚨 CHECKOUT COM PROBLEMA — os CTAs das páginas de venda podem estar mortos:\n');
    alertas.forEach((a) => console.error(`  - ${a}`));
    console.error('\nConferir em https://dashboard.kiwify.com.br → Produtos → Checkouts\n');
    process.exit(1);
  }

  console.log('\nTodos os checkouts em uso estão ativos e com o preço certo.');
})();

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
];

const SINAL_DE_MORTE = /não (está )?dispon|indispon|não encontrad|expirad|inativ|página não/i;

(async () => {
  const navegador = await puppeteer.launch({ headless: 'new' });
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

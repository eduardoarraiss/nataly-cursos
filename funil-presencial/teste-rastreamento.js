/* Mapa de eventos do funil, medido de ponta a ponta:
   página de venda → clique no CTA → formulário (11 etapas) → etapa da faixa
   de investimento → envio → recomendação → clique no checkout.

   ⚠️ headless:false de propósito: o Meta suprime o pixel em Chrome headless
      (proteção anti-bot) e o teste daria falso negativo.
   ⚠️ O GA4 AGRUPA eventos e envia com ~5s de atraso, e vários num POST só —
      é preciso ler o CORPO da requisição, não apenas a query, e esperar. */
const P='/Users/eduardoarrais/Documents/HAUS/cases-apresentacao/node_modules/puppeteer';
const CH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE=process.argv[2]||'http://127.0.0.1:3999';
const puppeteer=require(P);

function eventosGA(url,corpo){
  const out=[];
  try{ new URL(url).searchParams.forEach((v,k)=>{ if(k==='en') out.push(v); }); }catch(e){}
  if(corpo) corpo.split('\n').filter(Boolean).forEach(l=>{
    const v=new URLSearchParams(l).get('en'); if(v) out.push(v);
  });
  return out;
}
const evM=u=>{try{return new URL(u).searchParams.get('ev')}catch(e){return '?'}};

(async()=>{
  const b=await puppeteer.launch({headless:false,executablePath:CH,args:['--window-size=430,900']});
  const p=await b.newPage(); await p.setViewport({width:390,height:800});
  const meta=[], ga=[];
  p.on('request',r=>{const u=r.url();
    if(u.includes('facebook.com/tr')) meta.push(u);
    if(/google-analytics\.com|analytics\.google\.com/.test(u)) ga.push(...eventosGA(u,r.postData()));});
  const errosJS=[]; p.on('pageerror',e=>errosJS.push(e.message));

  // ---------- 1. página de venda ----------
  await p.goto(BASE+'/profissao-lash-presencial?utm_source=ig&utm_campaign=presencial-set&utm_content=ad-mapa-01',
    {waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,2500));
  await p.evaluate(()=>document.getElementById('oferta').scrollIntoView());
  await new Promise(r=>setTimeout(r,2000));
  const vendaM=meta.map(evM), vendaG=ga.slice();
  const nM=meta.length, nG=ga.length;

  // ---------- 2. clique no CTA ----------
  await p.evaluate(()=>{
    const a=document.querySelector('a[data-intencao="oferta"]'); a.scrollIntoView(); a.click();
  });
  await p.waitForNavigation({waitUntil:'networkidle2',timeout:15000}).catch(()=>{});
  await new Promise(r=>setTimeout(r,2500));
  const rota=await p.evaluate(()=>location.pathname+location.search);
  const cliqueM=meta.slice(nM).map(evM), cliqueG=ga.slice(nG);
  const nM2=meta.length, nG2=ga.length;

  // ---------- 3. formulário: preenche até a etapa do preço ----------
  await p.evaluate(()=>document.getElementById('comecar').click());
  await new Promise(r=>setTimeout(r,400));
  await p.evaluate(()=>{
    const v=(id,val)=>{const e=document.getElementById(id);e.value=val;e.dispatchEvent(new Event('input',{bubbles:true}))};
    const r=(n,val)=>{const e=document.querySelector(`input[name="${n}"][value="${val}"]`);e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))};
    v('f-nome','Mapa Eventos'); v('f-cidade','Cambuí'); v('f-estado','MG');
    v('f-telefone','35991117777'); v('f-instagram','@mapa.eventos');
    /* 'ja-lash' faz a pergunta CONDICIONAL entrar na fila, então este percurso
       tem 11 etapas — é o caminho mais longo, e o que exercita a árvore
       inteira. A resposta 'tecnica-led' + 'online' leva ao Método LED online
       (R$ 297), que é o caminho COM checkout: é ele que prova que o
       InitiateCheckout sai com o valor certo. */
    r('situacao','ja-lash'); r('busca','tecnica-led');
    r('faixa_idade','25-34'); r('meta_renda','5k-10k');
    r('quando_comecar','agora'); r('disponibilidade','sim');
    r('prefere_formato','online'); r('faixa_investimento','acima-2000');
  });
  for(let i=0;i<10;i++){ await p.evaluate(()=>document.getElementById('avancar').click()); await new Promise(r=>setTimeout(r,300)); }
  await new Promise(r=>setTimeout(r,2500));
  const etapa=await p.evaluate(()=>{
    const v=document.querySelector('.etapa[data-etapa="10"]');
    /* Aqui NÃO pode haver preço nosso: a etapa pergunta a faixa DELA.
       Devolvemos o texto inteiro para o veredito medir isso. */
    return {visivel:!v.hidden, texto:v.textContent};
  });
  const precoM=meta.slice(nM2).map(evM), precoG=ga.slice(nG2);
  const nM3=meta.length, nG3=ga.length;

  // ---------- 4. envio ----------
  await p.evaluate(()=>document.getElementById('avancar').click());
  await new Promise(r=>setTimeout(r,12000));   // GA4 agrupa com ~5s de atraso
  const envioM=meta.slice(nM3).map(evM), envioG=ga.slice(nG3);
  const fim=await p.evaluate(()=>({
    visivel:!document.getElementById('obrigado').hidden,
    produto:document.getElementById('rec-nome').textContent,
    preco:document.getElementById('rec-preco').textContent,
    href:document.getElementById('rec-cta').getAttribute('href'),
    ctaVisivel:!document.getElementById('rec-cta').hidden
  }));
  const nM4=meta.length, nG4=ga.length;

  // ---------- 5. o clique no checkout ----------
  // 🔴 A parte NOVA de 01/09/2026. Antes da árvore nenhum caminho desta página
  // levava a checkout; hoje metade leva. O que se mede aqui é o valor: a rota
  // /inscricao-presencial contém "presencial", então sem o override de produto
  // este clique sairia valendo R$ 1.997 — para quem comprou um curso de R$ 297.
  await p.evaluate(()=>{
    const a=document.getElementById('rec-cta');
    if(!a||a.hidden) return;
    a.setAttribute('target','_blank');   // não navega, para o CDP não perder o resto
    a.click();
  });
  await new Promise(r=>setTimeout(r,3000));
  const checkoutM=meta.slice(nM4).map(evM), checkoutG=ga.slice(nG4);
  // segundo clique: a trava de 1 por sessão tem de segurar
  await p.evaluate(()=>{const a=document.getElementById('rec-cta'); if(a&&!a.hidden) a.click();});
  await new Promise(r=>setTimeout(r,2000));

  // ---------- relatório ----------
  console.log('\n================ MAPA DE EVENTOS ================');
  const linha=(o,m,g)=>console.log(('  '+o).padEnd(30)+'Meta: '+(m.join(', ')||'—').padEnd(34)+'GA4: '+(g.join(', ')||'—'));
  linha('1. página de venda', vendaM, vendaG);
  linha('2. clique no CTA', cliqueM, cliqueG);
  linha('3. etapa do preço', precoM, precoG);
  linha('4. envio', envioM, envioG);
  linha('5. clique no checkout', checkoutM, checkoutG);
  console.log('\n  rota depois do clique:', rota);
  console.log('  etapa do investimento visível:', etapa.visivel);
  console.log('  produto recomendado:', fim.produto, '·', fim.preco);
  console.log('  checkout na tela:', fim.ctaVisivel, '|', fim.href);

  const todosM=meta.map(evM), todosG=ga;
  let F=0; const t=(n,c,e)=>{if(!c)F++;console.log((c?'ok     ':'FALHA  ')+n+(!c&&e?'  → '+e:''))};
  console.log('\n================ VEREDITO ================');
  // O GA4 AGRUPA e envia com atraso: um evento pedido na etapa 3 pode chegar
  // no balde 4. Por isso o GA4 é conferido de forma CUMULATIVA (apareceu em
  // algum momento), e não balde a balde — senão o teste dá falso negativo.
  t('venda: PageView', vendaM.includes('PageView'));
  t('venda: ViewContent', vendaM.includes('ViewContent'));
  t('venda: ScrollOferta', vendaM.includes('ScrollOferta'));
  t('venda: GA4 view_item', vendaG.includes('view_item'));
  t('clique: IniciouInscricao no Meta (intenção)', cliqueM.includes('IniciouInscricao'));
  t('clique levou para /inscricao-presencial', rota.indexOf('/inscricao-presencial')===0, rota);
  t('as UTMs foram adiante no link', /utm_content=ad-mapa-01/.test(rota), rota);
  t('o link carimbou qual CTA trouxe a pessoa', /cta=oferta/.test(rota), rota);
  t('formulário: PageView próprio', cliqueM.filter(e=>e==='PageView').length>=1);
  t('formulário: ViewContent próprio', cliqueM.includes('ViewContent'));
  // O select_item do GA4 é disparado na CHEGADA, não no clique: medido no CDP,
  // o gtag não sobrevive ao unload (ele agrupa; o event_callback só diz
  // "enfileirado"). O fbq sobrevive, por isso o Meta recebe no clique.
  t('chegada: GA4 select_item (intenção)', todosG.includes('select_item'));
  t('investimento: etapa 10 visível', etapa.visivel);

  /* ---------- A CAPTURA PARCIAL (02/09/2026) ----------
     Enquanto ela preenchia, o formulário gravou o lead. O que se mede aqui é
     que essa gravação NÃO se disfarçou de conversão.

     🔴 ESTE É O CHECK MAIS CARO DA SEÇÃO. `Lead` é o evento pelo qual a
        campanha do Meta otimiza (R$ 120/dia, subindo agora). Se ele
        disparasse a cada etapa, o algoritmo aprenderia a procurar gente que
        abandona o formulário — e a gente pagaria, todo dia, para trazer mais
        abandono. O erro não apareceria em lugar nenhum: o painel continuaria
        certo, os leads continuariam chegando, e só o custo por venda subiria
        sem explicação.
     ⚠️ Contado nos BALDES ANTERIORES ao envio (venda + clique + preço). No
        balde do envio o `Lead` é obrigatório — é lá que ele nasce. */
  const antesDoEnvio = vendaM.concat(cliqueM, precoM);
  t('🔴 o parcial NÃO dispara Lead antes do envio',
    antesDoEnvio.filter(e => e === 'Lead').length === 0,
    'saiu Lead antes de ela terminar: ' + antesDoEnvio.join(', '));
  t('o parcial tem evento PRÓPRIO no Meta (LeadParcial)',
    antesDoEnvio.includes('LeadParcial'),
    'nenhum LeadParcial durante o preenchimento — a gravação parcial não rodou? ' +
    antesDoEnvio.join(', '));
  t('o parcial dispara LeadParcial UMA vez por sessão',
    todosM.filter(e => e === 'LeadParcial').length === 1,
    'saíram ' + todosM.filter(e => e === 'LeadParcial').length + ' LeadParcial');
  t('e o GA4 recebe lead_partial (nome próprio, nunca generate_lead)',
    todosG.includes('lead_partial'));
  t('🔴 generate_lead do GA4 também só no envio',
    vendaG.concat(cliqueG, precoG).filter(e => e === 'generate_lead').length === 0,
    'o GA4 contou uma conversão antes de ela terminar');
  /* 🔴 O check que sustenta o pedido inteiro do Eduardo: ela não pode ver um
     preço que não é o dela. Na etapa da faixa, preço nosso NENHUM. */
  t('investimento: NENHUM preço nosso na tela', !/297|497|1\.497|1\.997/.test(etapa.texto||''),
    (String(etapa.texto||'').match(/R\$[^\n]{0,12}/g)||[]).join(' | '));
  t('investimento: ViuInvestimento no Meta', precoM.includes('ViuInvestimento'));
  t('investimento: GA4 view_price_step', todosG.includes('view_price_step'));
  t('envio: Lead', envioM.includes('Lead'));
  t('envio: GA4 generate_lead', todosG.includes('generate_lead'));
  t('envio: ViuRecomendacao', envioM.includes('ViuRecomendacao'));
  t('tela de recomendação apareceu', fim.visivel);
  t('recomendou o Método LED online', /Método LED — online/.test(fim.produto||''), fim.produto);
  t('com o preço DESSE produto', fim.preco==='R$ 297', fim.preco);
  t('e o checkout DESSE produto', /FfyBeg0/.test(fim.href||''), fim.href);
  t('as UTMs foram até o checkout', /utm_content=ad-mapa-01/.test(fim.href||''), fim.href);
  t('ZERO Purchase', !todosM.includes('Purchase') && !todosG.includes('purchase'));
  /* ⚠️ ESTE TESTE MUDOU DE LADO EM 01/09/2026. Ele exigia ZERO
     InitiateCheckout, e estava certo: antes da árvore, ninguém entrava em
     checkout por esta página. Hoje o caminho online termina num checkout
     Kiwify, então a ausência do evento passaria a ser o defeito. */
  t('checkout: InitiateCheckout no Meta', checkoutM.includes('InitiateCheckout'));
  t('checkout: GA4 begin_checkout', todosG.includes('begin_checkout'));
  t('intenção contada UMA vez só (Meta)', todosM.filter(e=>e==='IniciouInscricao').length===1,
    'contou '+todosM.filter(e=>e==='IniciouInscricao').length);
  t('intenção contada UMA vez só (GA4)', todosG.filter(e=>e==='select_item').length===1,
    'contou '+todosG.filter(e=>e==='select_item').length);
  t('investimento contado UMA vez só', todosM.filter(e=>e==='ViuInvestimento').length===1,
    'contou '+todosM.filter(e=>e==='ViuInvestimento').length);
  /* Dois cliques no mesmo botão, UM evento. Sem a trava, uma página com CTA
     repetido conta um IC por clique — foi o que deixou o A/B do Método LED
     ilegível, e o vício não pode voltar por uma porta nova. */
  t('checkout contado UMA vez só (Meta)', todosM.filter(e=>e==='InitiateCheckout').length===1,
    'contou '+todosM.filter(e=>e==='InitiateCheckout').length);
  t('checkout contado UMA vez só (GA4)', todosG.filter(e=>e==='begin_checkout').length===1,
    'contou '+todosG.filter(e=>e==='begin_checkout').length);

  /* 🔴 O VALOR. A rota contém "presencial": sem o override de produto, este
     evento sairia com R$ 1.997 para quem clicou num checkout de R$ 297 — e o
     Meta otimizaria a campanha inteira por um número que não existe. */
  const icUrl=meta.find(u=>evM(u)==='InitiateCheckout');
  if(icUrl){const sp=new URL(icUrl).searchParams;
    t('InitiateCheckout com o VALOR do produto certo', sp.get('cd[value]')==='297',
      'veio ' + sp.get('cd[value]'));
    t('InitiateCheckout com o content_id certo', /lash2-online/.test(sp.get('cd[content_ids]')||''),
      sp.get('cd[content_ids]'));
  } else { t('InitiateCheckout foi capturado', false); }
  const leadUrl=meta.find(u=>evM(u)==='Lead');
  if(leadUrl){const sp=new URL(leadUrl).searchParams;
    t('Lead SEM valor de compra', !sp.get('cd[value]'));
    t('Lead com eventID (dedupe)', !!sp.get('eid'));
    t('Lead carrega o criativo', sp.get('cd[criativo]')==='ad-mapa-01', sp.get('cd[criativo]'));
    /* Sem isto o Meta otimiza pela média de quatro ofertas de R$ 297 a
       R$ 1.997 — e a média de preços tão distantes não descreve nenhuma. */
    t('Lead DIZ QUAL PRODUTO', /lash2-online/.test(sp.get('cd[content_ids]')||''),
      sp.get('cd[content_ids]'));
    t('Lead diz o formato', sp.get('cd[formato]')==='online', sp.get('cd[formato]'));}
  t('evento com nome próprio por produto', todosM.includes('Lead_lash2-online'),
    todosM.filter(e=>e.indexOf('Lead')===0).join(', '));
  t('nenhum erro de JS', errosJS.length===0, errosJS.join(' | '));

  await b.close();
  console.log('\n'+(F?F+' FALHA(S)':'RASTREAMENTO: tudo certo'));
  process.exit(F?1:0);
})();

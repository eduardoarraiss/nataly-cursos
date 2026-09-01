/* Mapa de eventos do funil, medido de ponta a ponta:
   página de venda → clique no CTA → formulário → etapa do preço → envio.

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
    r('situacao','ja-lash'); r('faixa_idade','25-34'); r('meta_renda','5k-10k');
    r('quando_comecar','agora'); r('disponibilidade','sim');
  });
  for(let i=0;i<8;i++){ await p.evaluate(()=>document.getElementById('avancar').click()); await new Promise(r=>setTimeout(r,300)); }
  await new Promise(r=>setTimeout(r,2500));
  const etapa=await p.evaluate(()=>{
    const v=document.querySelector('.etapa[data-etapa="9"]');
    return {visivel:!v.hidden, preco:(document.querySelector('.valor__n')||{}).textContent};
  });
  const precoM=meta.slice(nM2).map(evM), precoG=ga.slice(nG2);
  const nM3=meta.length, nG3=ga.length;

  // ---------- 4. envio ----------
  await p.evaluate(()=>{const e=document.querySelector('input[name="aceita_valor"][value="sim"]');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))});
  await p.evaluate(()=>document.getElementById('avancar').click());
  await new Promise(r=>setTimeout(r,12000));   // GA4 agrupa com ~5s de atraso
  const envioM=meta.slice(nM3).map(evM), envioG=ga.slice(nG3);
  const fim=await p.evaluate(()=>!document.getElementById('obrigado').hidden);

  // ---------- relatório ----------
  console.log('\n================ MAPA DE EVENTOS ================');
  const linha=(o,m,g)=>console.log(('  '+o).padEnd(30)+'Meta: '+(m.join(', ')||'—').padEnd(34)+'GA4: '+(g.join(', ')||'—'));
  linha('1. página de venda', vendaM, vendaG);
  linha('2. clique no CTA', cliqueM, cliqueG);
  linha('3. etapa do preço', precoM, precoG);
  linha('4. envio', envioM, envioG);
  console.log('\n  rota depois do clique:', rota);
  console.log('  etapa do preço visível:', etapa.visivel, '| valor exibido:', etapa.preco);
  console.log('  tela de agradecimento:', fim);

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
  t('preço: etapa 9 visível', etapa.visivel);
  t('preço: ViuInvestimento no Meta', precoM.includes('ViuInvestimento'));
  t('preço: GA4 view_price_step', todosG.includes('view_price_step'));
  t('envio: Lead', envioM.includes('Lead'));
  t('envio: GA4 generate_lead', todosG.includes('generate_lead'));
  t('tela de agradecimento apareceu', fim);
  t('ZERO Purchase', !todosM.includes('Purchase') && !todosG.includes('purchase'));
  t('ZERO InitiateCheckout', !todosM.includes('InitiateCheckout') && !todosG.includes('begin_checkout'));
  t('intenção contada UMA vez só (Meta)', todosM.filter(e=>e==='IniciouInscricao').length===1,
    'contou '+todosM.filter(e=>e==='IniciouInscricao').length);
  t('intenção contada UMA vez só (GA4)', todosG.filter(e=>e==='select_item').length===1,
    'contou '+todosG.filter(e=>e==='select_item').length);
  t('investimento contado UMA vez só', todosM.filter(e=>e==='ViuInvestimento').length===1,
    'contou '+todosM.filter(e=>e==='ViuInvestimento').length);
  const leadUrl=meta.find(u=>evM(u)==='Lead');
  if(leadUrl){const sp=new URL(leadUrl).searchParams;
    t('Lead SEM valor de compra', !sp.get('cd[value]'));
    t('Lead com eventID (dedupe)', !!sp.get('eid'));
    t('Lead carrega o criativo', sp.get('cd[criativo]')==='ad-mapa-01', sp.get('cd[criativo]'));}
  t('nenhum erro de JS', errosJS.length===0, errosJS.join(' | '));

  await b.close();
  console.log('\n'+(F?F+' FALHA(S)':'RASTREAMENTO: tudo certo'));
  process.exit(F?1:0);
})();

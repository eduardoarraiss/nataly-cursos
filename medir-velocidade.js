/* Mede a VELOCIDADE de carregamento das paginas de venda, no celular e na
   PRIMEIRA visita (cache desligado). Nao otimiza nada: so mede, para que o
   "depois" tenha um "antes" com que ser comparado.

   Mede por rota: LCP, FCP, DOMContentLoaded, load, numero de requisicoes,
   bytes transferidos (encodedDataLength lido pelo CDP, que e o que trafega
   de verdade na rede), quebra por tipo e as 10 maiores requisicoes.

   Roda cada rota 3 VEZES e reporta a MEDIANA — uma amostra so nao decide.

   Uso: node medir-velocidade.js [base] [rotulo]
   Grava tambem /tmp/nr-velocidade-<rotulo>.json para comparar depois.
   Sai 0 se mediu, 2 se o puppeteer nao rodou (nunca finge que mediu). */
const P='/Users/eduardoarrais/Documents/HAUS/cases-apresentacao/node_modules/puppeteer';
const CH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE=process.argv[2]||'http://127.0.0.1:3999';
const ROTULO=(process.argv[3]||'baseline').replace(/[^\w.-]/g,'-');
const ROTAS=['/profissao-lash-presencial','/inscricao-presencial'];
const REPETICOES=3;
/* headless: e o mesmo modo do verificar-layout.js. Aqui nao se mede pixel,
   se mede rede e tempo — o que importa e ser O MESMO modo no antes e no
   depois, porque janela aberta muda o custo de pintura. */
const MODO='headless (new)';

const fs=require('fs');
const mediana=a=>{ const s=[...a].sort((x,y)=>x-y); const m=s.length>>1;
  return s.length%2? s[m] : Math.round((s[m-1]+s[m])/2); };
const kb=b=>(b/1024).toFixed(1);
const curta=u=>{ try{ const x=new URL(u); let s=x.pathname; if(s.length>52) s='…'+s.slice(-51);
  return s+(x.search? '?…':''); }catch(e){ return String(u).slice(0,52); } };
/* o CDP devolve tipos com inicial maiuscula (Document, Script, XHR…);
   o pedido e uma cesta fixa, entao tudo que nao cai nela vira "other" */
const TIPOS=['document','script','stylesheet','image','media','font','other'];
function cesta(t){
  const x=String(t||'').toLowerCase();
  return TIPOS.indexOf(x)!==-1? x : 'other';
}

async function umaPassada(b,rota){
  const p=await b.newPage();
  await p.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await p.setCacheEnabled(false);           /* primeira visita, sempre */
  const cdp=await p.target().createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});

  /* Duas metades do mesmo pedido: responseReceived traz a URL e o tipo,
     loadingFinished traz o encodedDataLength FINAL (o de responseReceived
     ainda nao conta o corpo). Casar pelo requestId e o que da o byte fiel. */
  const req=new Map();
  cdp.on('Network.requestWillBeSent',e=>{
    const r=req.get(e.requestId)||{}; r.url=r.url||e.request.url;
    r.tipo=r.tipo||cesta(e.type); req.set(e.requestId,r); });
  cdp.on('Network.responseReceived',e=>{
    const r=req.get(e.requestId)||{}; r.url=e.response.url; r.tipo=cesta(e.type);
    r.status=e.response.status; r.doCache=!!e.response.fromDiskCache; req.set(e.requestId,r); });
  cdp.on('Network.loadingFinished',e=>{
    const r=req.get(e.requestId)||{}; r.bytes=e.encodedDataLength||0; r.fim=true;
    req.set(e.requestId,r); });
  cdp.on('Network.loadingFailed',e=>{
    const r=req.get(e.requestId)||{}; r.falhou=true; req.set(e.requestId,r); });

  await p.goto(BASE+rota,{waitUntil:'load',timeout:60000});
  /* o LCP so se estabiliza depois que a pagina para de pintar; sem esta
     espera o maior elemento medido e o primeiro, nao o maior */
  await new Promise(r=>setTimeout(r,2500));

  const t=await p.evaluate(()=>new Promise(res=>{
    const out={lcp:null,fcp:null,dcl:null,load:null};
    const nav=performance.getEntriesByType('navigation')[0];
    if(nav){ out.dcl=Math.round(nav.domContentLoadedEventEnd);
             out.load=Math.round(nav.loadEventEnd); }
    try{ const po=new PerformanceObserver(l=>{
        for(const e of l.getEntries()) out.lcp=Math.round(e.startTime); });
      po.observe({type:'largest-contentful-paint',buffered:true}); }catch(e){}
    try{ const pf=new PerformanceObserver(l=>{
        for(const e of l.getEntries()) if(e.name==='first-contentful-paint') out.fcp=Math.round(e.startTime); });
      pf.observe({type:'paint',buffered:true}); }catch(e){}
    setTimeout(()=>res(out),300);
  }));

  const itens=[...req.values()].filter(r=>r.url && !/^data:/.test(r.url) && (r.fim||r.status));
  const porTipo={}; TIPOS.forEach(k=>porTipo[k]=0);
  let total=0;
  itens.forEach(r=>{ const n=r.bytes||0; total+=n; porTipo[r.tipo]=(porTipo[r.tipo]||0)+n; });
  const maiores=itens.filter(r=>r.bytes).sort((a,b2)=>b2.bytes-a.bytes).slice(0,10)
    .map(r=>({url:curta(r.url),tipo:r.tipo,bytes:r.bytes}));

  await cdp.detach().catch(()=>{});
  await p.close();
  return {lcp:t.lcp,fcp:t.fcp,dcl:t.dcl,load:t.load,
          reqs:itens.length,bytes:total,porTipo,maiores};
}

(async()=>{
  let puppeteer; try{ puppeteer=require(P); }catch(e){
    console.log('AVISO: puppeteer indisponivel — a medicao de velocidade NAO rodou');
    process.exit(2); }
  let b;
  try{ b=await puppeteer.launch({headless:'new',executablePath:CH}); }
  catch(e){ console.log('AVISO: Chrome nao abriu ('+e.message+') — NAO rodou'); process.exit(2); }

  console.log('=================================================================');
  console.log('VELOCIDADE — rotulo "'+ROTULO+'"   base '+BASE);
  console.log('modo: '+MODO+' · viewport 390x844 @2x · cache DESLIGADO · '+REPETICOES+' passadas, valor = MEDIANA');
  console.log('=================================================================');

  const saida={rotulo:ROTULO,base:BASE,modo:MODO,quando:new Date().toISOString(),
    viewport:{width:390,height:844,dsf:2},repeticoes:REPETICOES,rotas:{}};
  let ok=0;

  for(const rota of ROTAS){
    const passadas=[];
    for(let i=0;i<REPETICOES;i++){
      try{ passadas.push(await umaPassada(b,rota)); }
      catch(e){ console.log('AVISO  '+rota+' passada '+(i+1)+' falhou: '+e.message); }
    }
    if(!passadas.length){ console.log('FALHA  '+rota+' — nenhuma passada completou\n'); continue; }
    ok++;
    const num=k=>mediana(passadas.map(p=>p[k]).filter(v=>typeof v==='number'));
    const med={lcp:num('lcp'),fcp:num('fcp'),dcl:num('dcl'),load:num('load'),
      reqs:num('reqs'),bytes:num('bytes')};
    const porTipo={}; TIPOS.forEach(k=>porTipo[k]=mediana(passadas.map(p=>p.porTipo[k]||0)));
    /* a lista das maiores vem da passada cuja carga total ficou mais perto
       da mediana — assim a lista e coerente com o numero reportado */
    const ref=passadas.reduce((a,c)=>Math.abs(c.bytes-med.bytes)<Math.abs(a.bytes-med.bytes)?c:a,passadas[0]);

    console.log('\n--- '+rota+'  ('+passadas.length+' passadas) ---');
    console.log('  LCP .................. '+med.lcp+' ms   (passadas: '+passadas.map(p=>p.lcp).join(', ')+')');
    console.log('  FCP .................. '+med.fcp+' ms   (passadas: '+passadas.map(p=>p.fcp).join(', ')+')');
    console.log('  DOMContentLoaded ..... '+med.dcl+' ms');
    console.log('  load ................. '+med.load+' ms');
    console.log('  requisicoes .......... '+med.reqs+'      (passadas: '+passadas.map(p=>p.reqs).join(', ')+')');
    console.log('  bytes transferidos ... '+kb(med.bytes)+' KB  (passadas: '+passadas.map(p=>kb(p.bytes)).join(', ')+')');
    console.log('  por tipo:');
    TIPOS.forEach(k=>{ const v=porTipo[k]||0;
      const pc=med.bytes? (v*100/med.bytes).toFixed(1) : '0.0';
      console.log('    '+k.padEnd(11)+' '+String(kb(v)).padStart(9)+' KB  ('+pc+'%)'); });
    console.log('  10 maiores requisicoes:');
    ref.maiores.forEach((m,i)=>console.log('    '+String(i+1).padStart(2)+'. '+
      String(kb(m.bytes)).padStart(8)+' KB  ['+m.tipo+'] '+m.url));

    saida.rotas[rota]={mediana:med,porTipo,maiores:ref.maiores,
      passadas:passadas.map(p=>({lcp:p.lcp,fcp:p.fcp,dcl:p.dcl,load:p.load,reqs:p.reqs,bytes:p.bytes}))};
  }

  await b.close();
  if(!ok){ console.log('\nNADA foi medido.'); process.exit(2); }
  const arq='/tmp/nr-velocidade-'+ROTULO+'.json';
  fs.writeFileSync(arq,JSON.stringify(saida,null,2));
  console.log('\nJSON gravado em '+arq);
  process.exit(0);
})();

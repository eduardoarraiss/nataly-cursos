/* Mede a SEGUNDA VISITA (cache LIGADO): carrega a rota duas vezes na MESMA
   pagina/contexto e reporta o que a 2a carga custa de verdade na rede.
   Isso mede o efeito do Cache-Control — o que veio do disco nao paga bytes.

   Uso: node medir-segunda-visita.js [base]
   Sai 2 se o puppeteer/Chrome nao rodou (nunca finge que mediu). */
const P='/Users/eduardoarrais/Documents/HAUS/cases-apresentacao/node_modules/puppeteer';
const CH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE=process.argv[2]||'http://127.0.0.1:3999';
const ROTAS=['/profissao-lash-presencial','/inscricao-presencial'];
const kb=b=>(b/1024).toFixed(1);
const TIPOS=['document','script','stylesheet','image','media','font','other'];
const cesta=t=>{const x=String(t||'').toLowerCase();return TIPOS.indexOf(x)!==-1?x:'other';};

(async()=>{
  let puppeteer; try{ puppeteer=require(P); }catch(e){
    console.log('AVISO: puppeteer indisponivel — NAO rodou'); process.exit(2); }
  let b; try{ b=await puppeteer.launch({headless:'new',executablePath:CH}); }
  catch(e){ console.log('AVISO: Chrome nao abriu ('+e.message+') — NAO rodou'); process.exit(2); }

  console.log('=================================================================');
  console.log('SEGUNDA VISITA (cache LIGADO)   base '+BASE);
  console.log('mesma pagina, 2 cargas seguidas · viewport 390x844 @2x');
  console.log('=================================================================');

  for(const rota of ROTAS){
    const p=await b.newPage();
    await p.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
    await p.setCacheEnabled(true);
    const cdp=await p.target().createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled',{cacheDisabled:false});

    let req=new Map();
    cdp.on('Network.requestWillBeSent',e=>{const r=req.get(e.requestId)||{};
      r.url=r.url||e.request.url; r.tipo=r.tipo||cesta(e.type); req.set(e.requestId,r);});
    cdp.on('Network.responseReceived',e=>{const r=req.get(e.requestId)||{};
      r.url=e.response.url; r.tipo=cesta(e.type); r.status=e.response.status;
      r.cache=!!(e.response.fromDiskCache); req.set(e.requestId,r);});
    cdp.on('Network.requestServedFromCache',e=>{const r=req.get(e.requestId)||{};
      r.cache=true; req.set(e.requestId,r);});
    cdp.on('Network.loadingFinished',e=>{const r=req.get(e.requestId)||{};
      r.bytes=e.encodedDataLength||0; r.fim=true; req.set(e.requestId,r);});

    const resume=()=> {
      const itens=[...req.values()].filter(r=>r.url && !/^data:/.test(r.url) && (r.fim||r.status));
      const porTipo={}; TIPOS.forEach(k=>porTipo[k]=0);
      let total=0, doCache=0, r304=0;
      itens.forEach(r=>{const n=r.bytes||0; total+=n; porTipo[r.tipo]+=n;
        if(r.cache) doCache++; if(r.status===304) r304++;});
      return {reqs:itens.length,bytes:total,porTipo,doCache,r304,itens};
    };

    /* 1a carga: enche o cache */
    await p.goto(BASE+rota,{waitUntil:'load',timeout:60000});
    await new Promise(r=>setTimeout(r,1500));
    const a=resume();

    /* 2a carga: mesma pagina, mesmo contexto — so o que o cache NAO cobriu paga */
    req=new Map();
    await p.goto(BASE+rota,{waitUntil:'load',timeout:60000});
    await new Promise(r=>setTimeout(r,1500));
    const d=resume();

    console.log('\n--- '+rota+' ---');
    console.log('  1a carga (cache frio) ... '+a.reqs+' reqs · '+kb(a.bytes)+' KB');
    console.log('  2a carga (cache quente) . '+d.reqs+' reqs · '+kb(d.bytes)+' KB'+
      '   ('+d.doCache+' servidas do disco, '+d.r304+' respostas 304)');
    console.log('  economia da 2a visita ... '+kb(a.bytes-d.bytes)+' KB'+
      (a.bytes? ' ('+((a.bytes-d.bytes)*100/a.bytes).toFixed(1)+'%)':''));
    console.log('  2a carga, por tipo:');
    TIPOS.forEach(k=>{ if(a.porTipo[k]||d.porTipo[k])
      console.log('    '+k.padEnd(11)+String(kb(d.porTipo[k])).padStart(8)+' KB   (era '+kb(a.porTipo[k])+' KB)'); });
    console.log('  o que AINDA paga bytes na 2a carga:');
    d.itens.filter(r=>r.bytes>0).sort((x,y)=>y.bytes-x.bytes).slice(0,10)
      .forEach((r,i)=>{ let u; try{u=new URL(r.url).pathname;}catch(e){u=r.url;}
        console.log('    '+String(i+1).padStart(2)+'. '+String(kb(r.bytes)).padStart(8)+
          ' KB  ['+r.tipo+'] '+(u.length>50?'…'+u.slice(-49):u)+'  status '+(r.status||'?')); });

    await cdp.detach().catch(()=>{});
    await p.close();
  }
  await b.close();
  process.exit(0);
})();

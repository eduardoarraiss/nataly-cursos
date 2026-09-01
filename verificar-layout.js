/* Mede no DOM se algum elemento transborda o pai que deveria conte-lo.
   Existe porque o cartao da bio transbordava 232px e TODOS os checks de
   texto passavam: o overflow do BODY era zero e o alinhamento estava certo.
   Auditar a largura da CAIXA, nao o alinhamento do texto.

   Cobre tambem o FORMULARIO de qualificacao (percorrendo as 9 etapas, porque
   as etapas escondidas nao tem caixa e passariam sem ser medidas) e o painel
   /crm, que exige sessao.

   Uso: node verificar-layout.js [base] [senha-do-crm]
   Sai 0 se limpo, 1 se algo vaza, 2 se nao rodou. */
const P='/Users/eduardoarrais/Documents/HAUS/cases-apresentacao/node_modules/puppeteer';
const CH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE=process.argv[2]||'http://127.0.0.1:3999';
const SENHA=process.argv[3]||process.env.CRM_SENHA||'';
const USUARIO=process.env.CRM_USUARIO||'nataly';
const ROTAS=['/profissao-lash-presencial','/inscricao-presencial','/obrigado-profissao-lash','/obrigado-profissao-lash-presencial'];
const LARGURAS=[320,390,430,900,1280];
const SELETORES='.bloco,.bio,.nums,.oferta,.estreito,.largo,.wrap,.par,'+
  '.tela,.abertura,.etapa,.ops,.op,.campo,.dupla,.valor,.valor__l,.acoes,.passos,.setas';

/* mede a pagina ja carregada: body que rola de lado + caixa que vaza do pai */
function medida(SEL){
  const maus=[];
  const doc=document.documentElement;
  if(doc.scrollWidth>doc.clientWidth) maus.push('BODY rola de lado ('+doc.scrollWidth+' > '+doc.clientWidth+')');
  document.querySelectorAll(SEL).forEach(el=>{
    if(el.offsetParent===null&&getComputedStyle(el).position!=='fixed') return; /* escondido */
    const pa=el.parentElement; if(!pa) return;
    const cs=getComputedStyle(pa);
    /* pai que rola de proposito (kanban, tabela) nao conta como vazamento */
    if(cs.overflowX==='auto'||cs.overflowX==='scroll') return;
    const a=el.getBoundingClientRect(), pb=pa.getBoundingClientRect();
    if(a.width>pb.width+1||a.right>pb.right+1||a.left<pb.left-1)
      maus.push((el.className||el.tagName)+' — '+Math.round(a.width)+'px dentro de pai de '+Math.round(pb.width)+'px');
  });
  return maus;
}

(async()=>{
  let puppeteer; try{ puppeteer=require(P); }catch(e){
    console.log('AVISO: puppeteer indisponivel — checagem de layout NAO rodou'); process.exit(2); }
  const b=await puppeteer.launch({headless:'new',executablePath:CH});
  let falhas=0;

  /* ---------- 1. as paginas publicas ---------- */
  for(const rota of ROTAS){
    for(const w of LARGURAS){
      const p=await b.newPage();
      await p.setViewport({width:w,height:900,deviceScaleFactor:1});
      await p.goto(BASE+rota,{waitUntil:'networkidle2'});
      const r=await p.evaluate(medida,SELETORES);
      if(r.length){ falhas+=r.length; r.forEach(m=>console.log('FALHA  '+rota+' @'+w+'px  '+m)); }
      else console.log('ok     '+rota+' @'+w+'px  nenhuma caixa vaza do pai');
      await p.close();
    }
  }

  /* ---------- 2. o FORMULARIO, etapa por etapa ----------
     O formulario virou ROTA PROPRIA (/inscricao-presencial). As 9 etapas
     escondidas nao tem caixa: sem percorre-las, uma etapa que vaza passaria
     despercebida porque a medida so ve a etapa visivel. A etapa 9 (o
     investimento) e a mais alta de todas e a que mais arrisca vazar. */
  for(const w of LARGURAS){
    const p=await b.newPage();
    await p.setViewport({width:w,height:900,deviceScaleFactor:1});
    await p.goto(BASE+'/inscricao-presencial',{waitUntil:'networkidle2'});
    let ruins=0;
    for(let i=0;i<=9;i++){
      const r=await p.evaluate((sel,etapa)=>{
        document.querySelectorAll('.etapa').forEach(f=>{
          f.hidden=(parseInt(f.getAttribute('data-etapa'),10)!==etapa); });
        const form=document.getElementById('insc-form');
        if(form) form.hidden=(etapa===0);
        const maus=[];
        const doc=document.documentElement;
        if(doc.scrollWidth>doc.clientWidth) maus.push('BODY rola de lado ('+doc.scrollWidth+' > '+doc.clientWidth+')');
        document.querySelectorAll(sel).forEach(el=>{
          if(el.offsetParent===null&&getComputedStyle(el).position!=='fixed') return;
          const pa=el.parentElement; if(!pa) return;
          const cs=getComputedStyle(pa);
          if(cs.overflowX==='auto'||cs.overflowX==='scroll') return;
          const a=el.getBoundingClientRect(), pb=pa.getBoundingClientRect();
          if(a.width>pb.width+1||a.right>pb.right+1||a.left<pb.left-1)
            maus.push('etapa '+etapa+': '+(el.className||el.tagName)+' — '+Math.round(a.width)+'px em pai de '+Math.round(pb.width)+'px');
        });
        return maus;
      },SELETORES,i);
      if(r.length){ falhas+=r.length; ruins+=r.length; r.forEach(m=>console.log('FALHA  formulario @'+w+'px  '+m)); }
    }
    // a tela de agradecimento tambem precisa caber
    const rf=await p.evaluate((sel)=>{
      document.querySelectorAll('.etapa').forEach(f=>f.hidden=true);
      document.getElementById('insc-form').hidden=true;
      document.getElementById('obrigado').hidden=false;
      const maus=[];
      const doc=document.documentElement;
      if(doc.scrollWidth>doc.clientWidth) maus.push('BODY rola de lado na tela final');
      document.querySelectorAll(sel).forEach(el=>{
        if(el.offsetParent===null) return;
        const pa=el.parentElement; if(!pa) return;
        const a=el.getBoundingClientRect(), pb=pa.getBoundingClientRect();
        if(a.width>pb.width+1) maus.push('tela final: '+(el.className||el.tagName));
      });
      return maus;
    },SELETORES);
    if(rf.length){ falhas+=rf.length; ruins+=rf.length; rf.forEach(m=>console.log('FALHA  formulario @'+w+'px  '+m)); }
    if(!ruins) console.log('ok     formulario @'+w+'px  as 9 etapas e a tela final cabem na caixa');
    await p.close();
  }

  /* ---------- 3. o painel /crm ---------- */
  if(!SENHA){
    console.log('AVISO  /crm nao medido: sem CRM_SENHA (passe como 2o argumento)');
  }else{
    for(const w of LARGURAS){
      const p=await b.newPage();
      await p.setViewport({width:w,height:900,deviceScaleFactor:1});
      await p.goto(BASE+'/crm/entrar',{waitUntil:'networkidle2'});
      const entrou=await p.evaluate(async(u,s)=>{
        const r=await fetch('/crm/entrar',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({usuario:u,senha:s})});
        return r.ok;
      },USUARIO,SENHA);
      if(!entrou){ console.log('FALHA  /crm nao autenticou @'+w+'px'); falhas++; await p.close(); continue; }
      await p.goto(BASE+'/crm',{waitUntil:'networkidle2'});
      await new Promise(r=>setTimeout(r,900));   /* espera o fetch dos leads */
      const r=await p.evaluate(medida,SELETORES+',.cab,.filtros,.aba,.cartao,.linha,.coluna,.drawer');
      if(r.length){ falhas+=r.length; r.forEach(m=>console.log('FALHA  /crm @'+w+'px  '+m)); }
      else console.log('ok     /crm @'+w+'px  nenhuma caixa vaza do pai');
      await p.close();
    }
  }

  await b.close();
  console.log(falhas? '\n'+falhas+' VAZAMENTO(S) DE CAIXA.' : '\nLayout: nenhuma caixa vaza.');
  process.exit(falhas?1:0);
})();

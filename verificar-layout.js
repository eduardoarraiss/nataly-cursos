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
/* As credenciais podem vir de CRM_SENHA/CRM_USUARIO (formato antigo) OU de
   CRM_CONTAS, que e o formato multi-usuario ("email:senha,email:senha"). Sem
   ler CRM_CONTAS, o gate rodava com senha vazia e PULAVA o painel inteiro
   dizendo "nao medido" — ou seja, aprovava sem ter olhado. */
function daContas(){
  const cru=String(process.env.CRM_CONTAS||'').trim();
  if(!cru) return null;
  const par=cru.split(',')[0];
  const i=par.lastIndexOf(':');
  if(i<1) return null;
  return {u:par.slice(0,i).trim(), s:par.slice(i+1)};
}
const _c=daContas();
const SENHA=process.argv[3]||process.env.CRM_SENHA||(_c?_c.s:'')||'';
const USUARIO=process.env.CRM_USUARIO||(_c?_c.u:'')||'nataly';
const ROTAS=['/links','/bio','/profissao-lash-presencial','/inscricao-presencial','/obrigado-profissao-lash','/obrigado-profissao-lash-presencial'];
const LARGURAS=[320,390,430,900,1280];
const SELETORES='.bloco,.bio,.nums,.oferta,.estreito,.largo,.wrap,.par,'+
  /* pagina de links (bio): o cartao ja transbordou 232px aqui uma vez */
  '.head,.links,.card,.card__body,.card__titulo,.card__sub,.badge,.card__arw,'+
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
     O formulario virou ROTA PROPRIA (/inscricao-presencial). As etapas
     escondidas nao tem caixa: sem percorre-las, uma etapa que vaza passaria
     despercebida porque a medida so ve a etapa visivel.

     ⚠️ A LISTA E DE IDs, NAO UM CONTADOR DE 0 A 9. A arvore trouxe a etapa
     '5.5' (condicional, so para quem ja e lash) e levou o total ate '10'. Um
     `for(i=0;i<=9;i++)` com parseInt deixaria a 5.5 e a 10 SEM MEDIR — e a
     etapa 10, com cinco opcoes de faixa, e das mais altas que existem aqui. */
  const ETAPAS=['0','1','2','3','4','5','5.5','6','7','8','9','10'];
  for(const w of LARGURAS){
    const p=await b.newPage();
    await p.setViewport({width:w,height:900,deviceScaleFactor:1});
    await p.goto(BASE+'/inscricao-presencial',{waitUntil:'networkidle2'});
    let ruins=0;
    for(const i of ETAPAS){
      const r=await p.evaluate((sel,etapa)=>{
        document.querySelectorAll('.etapa').forEach(f=>{
          f.hidden=(f.getAttribute('data-etapa')!==etapa); });
        const form=document.getElementById('insc-form');
        if(form) form.hidden=(etapa==='0');
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
    /* A tela final agora e QUATRO telas: uma por produto, e a versao online
       ganha ainda o botao de checkout e a caixa "o presencial existe". Medir
       so a generica deixaria de fora justamente a mais cheia. Os nomes sao
       longos de proposito — e o nome longo que estoura a caixa. */
    const FINAIS=[
      {nome:'presencial LED', d:{id:'lash2-presencial',nome:'Método LED — presencial',
        preco:'R$ 1.997',parcela:'12x de R$ 206,54',formato:'presencial',checkout:null,
        porque:'Você consegue vir até Cambuí e o valor cabe no que você me disse.',
        inclui:['Um dia inteiro de formação ao vivo comigo, em Cambuí, MG',
                'Demonstração prática do Método LED, de perto',
                'Dois encontros online comigo depois da formação'],
        presencial_possivel:null,sugestao:false}},
      {nome:'online com menção ao presencial', d:{id:'lash2-online',nome:'Método LED — online',
        preco:'R$ 297',parcela:'12x de R$ 30,72',formato:'online',
        checkout:'https://pay.kiwify.com.br/FfyBeg0',
        porque:'Dá para começar hoje pelo online, no seu ritmo, sem apertar o seu bolso agora.',
        inclui:['A técnica do Método LED em vídeo, passo a passo',
                'O protocolo de durabilidade que eu uso no estúdio','Acesso vitalício, no seu ritmo'],
        presencial_possivel:{nome:'Método LED — presencial',preco:'R$ 1.997',parcela:'12x de R$ 206,54'},
        sugestao:true}},
      {nome:'combo Profissão Lash', d:{id:'profissao-lash-presencial',
        nome:'Profissão Lash — online + presencial',preco:'R$ 1.497',parcela:'12x de R$ 154,82',
        formato:'presencial',checkout:null,
        porque:'É o caminho que combina com o que você me contou sobre a sua rotina.',
        inclui:['Um dia de prática ao vivo comigo, em Cambuí, MG',
                'Todo o material da prática incluso, você não leva nada',
                'O curso online completo, com as 39 aulas teóricas'],
        presencial_possivel:null,sugestao:false}},
    ];
    let rf=[];
    for(const caso of FINAIS){
      const r2=await p.evaluate((sel,dado,rotulo)=>{
        document.querySelectorAll('.etapa').forEach(f=>f.hidden=true);
        document.getElementById('insc-form').hidden=true;
        document.getElementById('obrigado').hidden=false;
        /* desenha a recomendacao pelos mesmos ids que o JS da pagina usa */
        document.getElementById('rec-nome').textContent=dado.nome;
        document.getElementById('rec-porque').textContent=dado.porque;
        document.getElementById('rec-preco').textContent=dado.preco;
        document.getElementById('rec-parcela').textContent='ou '+dado.parcela;
        const ul=document.getElementById('rec-inclui'); ul.innerHTML='';
        dado.inclui.forEach(t=>{const li=document.createElement('li');li.textContent=t;ul.appendChild(li);});
        const cta=document.getElementById('rec-cta');
        cta.hidden=!dado.checkout; if(dado.checkout) cta.setAttribute('href',dado.checkout);
        const ex=document.getElementById('rec-extra');
        ex.hidden=!dado.presencial_possivel;
        if(dado.presencial_possivel){
          document.getElementById('rec-extra-txt').textContent=
            'E fica sabendo: o '+dado.presencial_possivel.nome+' existe, por '+
            dado.presencial_possivel.preco+' ('+dado.presencial_possivel.parcela+
            '). Se você quiser fazer a prática ao vivo comigo, me fala no WhatsApp '+
            'que a gente vê as condições juntas.';
        }
        document.getElementById('rec').hidden=false;
        const maus=[];
        const doc=document.documentElement;
        if(doc.scrollWidth>doc.clientWidth)
          maus.push('BODY rola de lado na tela final ('+rotulo+'): '+doc.scrollWidth+' > '+doc.clientWidth);
        document.querySelectorAll(sel).forEach(el=>{
          if(el.offsetParent===null) return;
          const pa=el.parentElement; if(!pa) return;
          const cs=getComputedStyle(pa);
          if(cs.overflowX==='auto'||cs.overflowX==='scroll') return;
          const a=el.getBoundingClientRect(), pb=pa.getBoundingClientRect();
          if(a.width>pb.width+1)
            maus.push('tela final ('+rotulo+'): '+(el.className||el.tagName)+
                      ' — '+Math.round(a.width)+'px em pai de '+Math.round(pb.width)+'px');
        });
        return maus;
      },SELETORES+',.rec,.rec__porque,.rec__extra,.rec__cta,.valor__l',caso.d,caso.nome);
      rf=rf.concat(r2);
    }
    if(rf.length){ falhas+=rf.length; ruins+=rf.length; rf.forEach(m=>console.log('FALHA  formulario @'+w+'px  '+m)); }
    if(!ruins) console.log('ok     formulario @'+w+'px  as '+(ETAPAS.length-1)+' etapas e as telas finais cabem na caixa');
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
      await new Promise(r=>setTimeout(r,1100));   /* espera o fetch dos leads */
      /* ⚠️ Medir SO a aba Lista deixava kanban e graficos sem gate nenhum —
         e sao eles que tem caixa de largura fixa (coluna de 320px, SVG
         desenhado em pixel), justamente onde o vazamento nasce. */
      const SEL_CRM=SELETORES+',.filtros,.filtros-grade,.aba,.abas,.cartao,.linha,.coluna,'+
        '.kpis,.kpi,.kanban,.kcard,.kcard__pe,.k-atalhos,.fig,.tela,.duo,.graficos,'+
        '.legenda,.medidor,.rolagem,.mais-filtros,.painel,.bloco,.acoes-lead,.status-botoes';
      let ruimAqui=0;
      for(const aba of ['abaLista','abaKanban','abaNumeros','abaAvisos']){
        await p.evaluate(id=>document.getElementById(id).click(),aba);
        await new Promise(r=>setTimeout(r,650));
        const r=await p.evaluate(medida,SEL_CRM);
        if(r.length){ falhas+=r.length; ruimAqui+=r.length;
          r.forEach(m=>console.log('FALHA  /crm '+aba+' @'+w+'px  '+m)); }
      }
      /* a gaveta de detalhe tambem e caixa, e e a mais estreita de todas */
      await p.evaluate(id=>document.getElementById(id).click(),'abaLista');
      await new Promise(r=>setTimeout(r,500));
      const abriu=await p.evaluate(()=>{
        const tr=document.querySelector('tbody tr[data-abre]');
        if(!tr) return false; tr.click(); return true;
      });
      if(abriu){
        await new Promise(r=>setTimeout(r,900));
        const rg=await p.evaluate(medida,SEL_CRM);
        if(rg.length){ falhas+=rg.length; ruimAqui+=rg.length;
          rg.forEach(m=>console.log('FALHA  /crm gaveta @'+w+'px  '+m)); }
      }
      if(!ruimAqui) console.log('ok     /crm @'+w+'px  4 abas + gaveta, nenhuma caixa vaza do pai');
      await p.close();
    }
  }

  /* ============================================================
     4. CONTRASTE MEDIDO no painel — texto e MARCA DE GRAFICO
     ============================================================
     Nao e conferencia de paleta no papel: le a cor COMPUTADA de cada
     elemento visivel e a cor de fundo que de fato esta atras dele
     (subindo a arvore ate achar um fundo opaco), e calcula a razao WCAG.
     Um token pode estar certo e o elemento herdar outro fundo — so a
     medida no DOM pega isso.

     Piso: 4.5:1 para texto, 3:1 para texto grande (>=24px, ou >=18.66px
     em negrito) e 3:1 para marca de grafico e borda de estado. */
  function mediContraste(){
    function canal(c){ c/=255; return c<=0.03928? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }
    function lum(rgb){ return 0.2126*canal(rgb[0])+0.7152*canal(rgb[1])+0.0722*canal(rgb[2]); }
    function raz(a,b){ const x=lum(a),y=lum(b),hi=Math.max(x,y),lo=Math.min(x,y); return (hi+0.05)/(lo+0.05); }
    function le(cor){
      const m=String(cor||'').match(/rgba?\(([^)]+)\)/);
      if(!m) return null;
      const p=m[1].split(',').map(v=>parseFloat(v.trim()));
      return {rgb:[p[0],p[1],p[2]], a:(p.length>3? p[3] : 1)};
    }
    function mistura(frente,fundo){
      return [0,1,2].map(i=>Math.round(frente.rgb[i]*frente.a + fundo[i]*(1-frente.a)));
    }
    /* o fundo REAL atras do elemento: sobe a arvore ate um fundo opaco,
       empilhando as camadas semitransparentes no caminho */
    function fundoDe(el){
      const pilha=[]; let n=el;
      while(n && n!==document.documentElement){
        const c=le(getComputedStyle(n).backgroundColor);
        if(c && c.a>0){ pilha.push(c); if(c.a>=1) break; }
        n=n.parentElement;
      }
      let base=[255,255,255];
      const raiz=le(getComputedStyle(document.documentElement).backgroundColor);
      if(raiz && raiz.a>=1) base=raiz.rgb;
      for(let i=pilha.length-1;i>=0;i--) base=mistura(pilha[i],base);
      return base;
    }
    function visivel(el){
      const cs=getComputedStyle(el);
      if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0) return false;
      const r=el.getBoundingClientRect();
      return r.width>2 && r.height>2;
    }
    const maus=[]; const vistos=new Set();

    /* --- 4a. todo texto visivel --- */
    document.querySelectorAll('body *').forEach(el=>{
      if(el.closest('.sr')||el.classList.contains('sr')) return;
      if(el.tagName==='SVG'||el.ownerSVGElement) return;
      let temTexto=false;
      for(const n of el.childNodes) if(n.nodeType===3 && n.textContent.trim()) temTexto=true;
      if(!temTexto || !visivel(el)) return;
      const cs=getComputedStyle(el);
      const cor=le(cs.color); if(!cor) return;
      const fundo=fundoDe(el);
      const frente = cor.a>=1 ? cor.rgb : mistura(cor,fundo);
      const px=parseFloat(cs.fontSize);
      const peso=parseInt(cs.fontWeight,10)||400;
      const grande = px>=24 || (px>=18.66 && peso>=700);
      const piso = grande? 3 : 4.5;
      const v=raz(frente,fundo);
      const chave=(el.className||el.tagName)+'|'+cs.color+'|'+px;
      if(v<piso && !vistos.has(chave)){
        vistos.add(chave);
        maus.push('TEXTO '+v.toFixed(2)+':1 (piso '+piso+') — '+
          (el.className||el.tagName).toString().slice(0,44)+' '+Math.round(px)+'px "'+
          el.textContent.trim().slice(0,28)+'"');
      }
    });

    /* --- 4b. marca de grafico: preenchimento do SVG contra a figura ---
       Cobre tambem a faisca dentro do azulejo (.kpi svg): ela e desenho de
       dado como qualquer outro, so que menor — e ficava fora da medida se o
       seletor parasse em .fig. */
    document.querySelectorAll(
      '.fig svg path[fill], .fig svg polyline[stroke], .fig svg polygon[fill], .fig svg circle[fill],'+
      '.kpi svg polyline[stroke], .kpi svg polygon[fill]').forEach(el=>{
      const f=el.getAttribute('fill')||el.getAttribute('stroke');
      if(!f || f==='transparent' || f==='none' || f==='currentColor') return;
      if(el.getAttribute('fill-opacity')) return;   /* area da faisca, de proposito fraca */
      const cor=le(getComputedStyle(el).fill!=='none'? getComputedStyle(el).fill : getComputedStyle(el).stroke);
      if(!cor) return;
      /* a superficie e a figura OU o azulejo — `closest('.fig')` sozinho
         devolvia null na faisca e a medida caia no branco padrao */
      const fundo=fundoDe(el.closest('.fig, .kpi')||el.parentElement);
      const v=raz(cor.rgb,fundo);
      const chave='viz|'+f;
      if(v<3 && !vistos.has(chave)){
        vistos.add(chave);
        maus.push('MARCA DE GRAFICO '+v.toFixed(2)+':1 (piso 3) — '+f+' sobre o fundo da figura');
      }
    });

    /* --- 4c. os segmentos do medidor de qualificacao --- */
    document.querySelectorAll('.medidor span').forEach(el=>{
      const c=le(getComputedStyle(el).backgroundColor); if(!c) return;
      const fundo=fundoDe(el.parentElement.parentElement);
      const v=raz(c.rgb,fundo);
      const chave='medidor|'+getComputedStyle(el).backgroundColor;
      if(v<3 && !vistos.has(chave)){
        vistos.add(chave);
        maus.push('MEDIDOR '+v.toFixed(2)+':1 (piso 3) — '+getComputedStyle(el).backgroundColor);
      }
    });
    return maus;
  }

  if(SENHA){
    const p=await b.newPage();
    await p.setViewport({width:1280,height:1000,deviceScaleFactor:1});
    await p.goto(BASE+'/crm/entrar',{waitUntil:'networkidle2'});
    await p.evaluate(async(u,s)=>{ await fetch('/crm/entrar',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:u,senha:s})}); },USUARIO,SENHA);
    await p.goto(BASE+'/crm',{waitUntil:'networkidle2'});
    await new Promise(r=>setTimeout(r,1100));
    let ruimC=0;
    for(const aba of ['abaLista','abaKanban','abaNumeros','abaAvisos']){
      await p.evaluate(id=>document.getElementById(id).click(),aba);
      await new Promise(r=>setTimeout(r,650));
      const r=await p.evaluate(mediContraste);
      if(r.length){ falhas+=r.length; ruimC+=r.length;
        r.forEach(m=>console.log('FALHA  contraste /crm '+aba+'  '+m)); }
    }
    /* a gaveta tem tinta propria e precisa ser medida aberta */
    await p.evaluate(id=>document.getElementById(id).click(),'abaLista');
    await new Promise(r=>setTimeout(r,500));
    const abriuC=await p.evaluate(()=>{ const tr=document.querySelector('tbody tr[data-abre]');
      if(!tr) return false; tr.click(); return true; });
    if(abriuC){
      await new Promise(r=>setTimeout(r,900));
      const r=await p.evaluate(mediContraste);
      if(r.length){ falhas+=r.length; ruimC+=r.length;
        r.forEach(m=>console.log('FALHA  contraste /crm gaveta  '+m)); }
    }
    if(!ruimC) console.log('ok     /crm  contraste medido: texto >=4.5:1 e marca de grafico >=3:1 nas 4 abas e na gaveta');
    await p.close();
  }

  /* ============================================================
     5. O PAINEL FUNCIONA — numeros, WhatsApp, filtro e kanban
     ============================================================
     Checagem de layout nao pega regressao de comportamento. E foi
     exatamente comportamento que quebrou aqui uma vez: o filtro de
     produto existia na tela, entrava no CSV e NAO recarregava a lista,
     porque faltava o listener de 'change'. Nenhum check de caixa veria. */
  if(SENHA){
    const p=await b.newPage();
    const errosJs=[];
    p.on('pageerror',e=>errosJs.push(e.message));
    await p.setViewport({width:1280,height:1000,deviceScaleFactor:1});
    await p.goto(BASE+'/crm/entrar',{waitUntil:'networkidle2'});
    await p.evaluate(async(u,s)=>{ await fetch('/crm/entrar',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:u,senha:s})}); },USUARIO,SENHA);
    await p.goto(BASE+'/crm',{waitUntil:'networkidle2'});
    await new Promise(r=>setTimeout(r,1200));
    const dizOk=m=>console.log('ok     /crm  '+m);
    const dizMal=m=>{ console.log('FALHA  /crm  '+m); falhas++; };

    /* --- 5a. os numeros do topo batem com a API --- */
    const api=await p.evaluate(async()=>{
      const r=await fetch('/crm/api/leads?limite=2000',{credentials:'same-origin'});
      const L=(await r.json()).leads||[];
      const ABERTOS=['novo','contatado','em-conversa','proposta-enviada'];
      const c={novo:0,quente:0,prop:0,ganho:0,total:L.length};
      L.forEach(l=>{
        if(l.status==='novo') c.novo++;
        if(l.qualificacao==='quente'&&ABERTOS.indexOf(l.status)!==-1) c.quente++;
        if(l.status==='proposta-enviada') c.prop++;
        if(l.status==='ganho') c.ganho++;
      });
      return c;
    });
    const tela=await p.evaluate(()=>({
      azulejos:[...document.querySelectorAll('.kpi')].map(k=>({
        r:k.querySelector('.kpi__r').textContent.trim(),
        n:parseInt(k.querySelector('.kpi__n').textContent.replace(/\D/g,''),10)})),
      resumo:document.getElementById('resumoLinha').textContent
    }));
    const val=r=>{ const x=tela.azulejos.find(y=>y.r===r); return x? x.n : null; };
    [['Novos sem contato',api.novo],['Quentes na fila',api.quente],['Em proposta',api.prop]]
      .forEach(([r,esperado])=>{
        val(r)===esperado? dizOk('azulejo "'+r+'" bate com a API ('+esperado+')')
          : dizMal('azulejo "'+r+'" mostra '+val(r)+' e a API diz '+esperado);
      });
    tela.resumo.indexOf('Total: '+api.total.toLocaleString('pt-BR'))!==-1
      ? dizOk('o total da linha de resumo bate com a API ('+api.total+')')
      : dizMal('total do resumo nao bate com a API ('+api.total+'): "'+tela.resumo.slice(0,70)+'"');
    tela.azulejos.length>=4? dizOk('os 4 numeros do dia estao no topo')
      : dizMal('so '+tela.azulejos.length+' numero(s) no topo');

    /* --- 5b. WhatsApp: verde, presente e SEM TEXTO PRE-ESCRITO ---
       🔴 O texto pronto na voz da Nataly foi barrado pelo Edu em 01/09/2026,
       e havia em dois lugares. Este check existe para nao voltar. */
    const wa=await p.evaluate(()=>({
      links:[...document.querySelectorAll('a[href*="wa.me"], a[href*="api.whatsapp"], a[href*="web.whatsapp"]')]
        .map(a=>a.getAttribute('href')),
      verde:(()=>{ const a=document.querySelector('a.bt-wa'); if(!a) return null;
        return getComputedStyle(a).backgroundColor; })()
    }));
    wa.links.length? dizOk(wa.links.length+' botao(oes) de WhatsApp na lista')
      : dizMal('nenhum botao de WhatsApp na lista de leads');
    const comTexto=wa.links.filter(h=>/[?&](text|message|body)=/i.test(h));
    comTexto.length
      ? dizMal('LINK DE WHATSAPP COM MENSAGEM PRONTA — a conversa tem de abrir VAZIA: '+comTexto[0])
      : dizOk('todo link de WhatsApp abre a conversa VAZIA (sem ?text=)');
    wa.links.every(h=>/^https:\/\/wa\.me\/\d+$/.test(h))
      ? dizOk('links no formato wa.me/<numero>, sem parametro nenhum')
      : dizMal('link de WhatsApp fora do formato: '+wa.links.find(h=>!/^https:\/\/wa\.me\/\d+$/.test(h)));
    wa.verde && wa.verde!=='rgba(0, 0, 0, 0)'? dizOk('o botao do WhatsApp e verde ('+wa.verde+')')
      : dizMal('o botao do WhatsApp perdeu o verde');

    /* --- 5c. o filtro de produto RECARREGA a lista --- */
    const antes=await p.evaluate(()=>document.querySelectorAll('tbody tr').length);
    await p.select('#fProduto','lash2-online');
    await new Promise(r=>setTimeout(r,900));
    const dep=await p.evaluate(()=>({
      linhas:document.querySelectorAll('tbody tr').length,
      fora:[...document.querySelectorAll('tbody td[data-rot="Produto indicado"]')]
        .map(t=>t.textContent).filter(t=>t.indexOf('Método LED online')===-1).length,
      csv:document.getElementById('btCsv').getAttribute('href')
    }));
    dep.linhas>0 && dep.linhas<antes
      ? dizOk('o filtro de produto recarrega a lista ('+antes+' -> '+dep.linhas+')')
      : dizMal('o filtro de produto NAO recarregou a lista (antes '+antes+', depois '+dep.linhas+') — falta o listener de change?');
    dep.fora===0? dizOk('a lista filtrada so tem o produto escolhido')
      : dizMal(dep.fora+' linha(s) de outro produto na lista filtrada');
    dep.csv.indexOf('produto_id=lash2-online')!==-1? dizOk('o CSV leva junto o filtro de produto')
      : dizMal('o CSV nao leva o filtro de produto: '+dep.csv);
    await p.click('#btLimpar'); await new Promise(r=>setTimeout(r,900));
    const zerou=await p.evaluate(()=>document.getElementById('fProduto').value+'|'+document.getElementById('fPeriodo').value);
    zerou==='|'? dizOk('"Limpar filtros" zera produto e periodo tambem')
      : dizMal('"Limpar filtros" deixou filtro ligado: '+zerou);

    /* --- 5d. kanban: as tres formas de mover --- */
    await p.click('#abaKanban'); await new Promise(r=>setTimeout(r,700));
    const k=await p.evaluate(()=>({
      colunas:[...document.querySelectorAll('.coluna')].map(c=>c.getAttribute('data-status')),
      cartoes:document.querySelectorAll('.kcard').length,
      menus:document.querySelectorAll('.kmover').length,
      alcas:document.querySelectorAll('.kpega').length
    }));
    const ESPERADAS=['novo','contatado','em-conversa','proposta-enviada','ganho','perdido'];
    k.colunas.join(',')===ESPERADAS.join(',')? dizOk('o kanban tem as 6 colunas do funil, na ordem')
      : dizMal('colunas do kanban: '+k.colunas.join(','));
    k.cartoes>0 && k.menus===k.cartoes
      ? dizOk('todo cartao tem o menu "Mover" — quem nao arrasta tambem move ('+k.cartoes+')')
      : dizMal('cartao sem menu "Mover" ('+k.menus+' menus para '+k.cartoes+' cartoes)');
    k.alcas===k.cartoes? dizOk('todo cartao tem alca de arraste, separada do corpo')
      : dizMal('cartao sem alca de arraste');

    if(k.cartoes){
      /* pelo MENU */
      const alvo=await p.evaluate(()=>{
        const c=document.querySelector('.coluna[data-status="novo"] .kcard');
        return c? c.getAttribute('data-id') : null;
      });
      if(alvo){
        await p.evaluate(()=>{ const s=document.querySelector('.coluna[data-status="novo"] .kcard .kmover');
          s.value='em-conversa'; s.dispatchEvent(new Event('change',{bubbles:true})); });
        await new Promise(r=>setTimeout(r,1300));
        const naTela=await p.evaluate(id=>{ const c=document.querySelector('.kcard[data-id="'+id+'"]');
          return c? c.closest('.coluna').getAttribute('data-status') : 'sumiu'; },alvo);
        const noBanco=await p.evaluate(async id=>{ const r=await fetch('/crm/api/lead/'+id,{credentials:'same-origin'});
          return (await r.json()).lead.status; },alvo);
        naTela==='em-conversa'? dizOk('o menu "Mover" muda o cartao de coluna, sem arrastar')
          : dizMal('o menu "Mover" nao moveu o cartao (foi para '+naTela+')');
        noBanco==='em-conversa'? dizOk('a mudanca pelo menu foi GRAVADA no banco')
          : dizMal('a mudanca pelo menu nao chegou ao banco (la esta "'+noBanco+'")');

        /* pelo TECLADO */
        const antesT=await p.evaluate(id=>document.querySelector('.kcard[data-id="'+id+'"]')
          .closest('.coluna').getAttribute('data-status'),alvo);
        await p.evaluate(id=>document.querySelector('.kcard[data-id="'+id+'"] .kpega').focus(),alvo);
        await p.keyboard.press('Space');
        await new Promise(r=>setTimeout(r,250));
        const narrou=await p.evaluate(()=>document.getElementById('anuncio').textContent);
        narrou.indexOf('Peguei')!==-1? dizOk('Espaco PEGA o cartao e o leitor de tela e avisado')
          : dizMal('Espaco nao anunciou o "pegar" (anunciou: "'+narrou.slice(0,50)+'")');
        await p.keyboard.press('ArrowRight');
        await new Promise(r=>setTimeout(r,250));
        await p.keyboard.press('Space');
        await new Promise(r=>setTimeout(r,1300));
        const depT=await p.evaluate(id=>{ const c=document.querySelector('.kcard[data-id="'+id+'"]');
          return c? c.closest('.coluna').getAttribute('data-status') : 'sumiu'; },alvo);
        const bancoT=await p.evaluate(async id=>{ const r=await fetch('/crm/api/lead/'+id,{credentials:'same-origin'});
          return (await r.json()).lead.status; },alvo);
        depT!==antesT && depT!=='sumiu'
          ? dizOk('so pelo TECLADO da para mover o cartao ('+antesT+' -> '+depT+')')
          : dizMal('o teclado nao move o cartao (continua em '+depT+')');
        bancoT===depT? dizOk('a mudanca pelo teclado foi GRAVADA no banco')
          : dizMal('teclado: a tela diz '+depT+' e o banco diz '+bancoT);
      }
    }
    await p.close();

    /* --- 5e. arraste por PONTEIRO, na largura do celular ---
       O arraste nativo do HTML5 nao existe no toque: no celular o cartao
       simplesmente nao saia do lugar. Este check mede o gesto de verdade. */
    const m=await b.newPage();
    m.on('pageerror',e=>errosJs.push('mobile: '+e.message));
    await m.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1});
    await m.goto(BASE+'/crm/entrar',{waitUntil:'networkidle2'});
    await m.evaluate(async(u,s)=>{ await fetch('/crm/entrar',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:u,senha:s})}); },USUARIO,SENHA);
    await m.goto(BASE+'/crm',{waitUntil:'networkidle2'});
    await new Promise(r=>setTimeout(r,1200));
    await m.click('#abaKanban'); await new Promise(r=>setTimeout(r,700));
    const src=await m.evaluate(()=>{
      const c=document.querySelector('.coluna[data-status="novo"] .kcard');
      if(!c) return null;
      c.querySelector('.kpega').scrollIntoView({block:'center'});
      const g=c.querySelector('.kpega').getBoundingClientRect();
      return {id:c.getAttribute('data-id'), de:c.closest('.coluna').getAttribute('data-status'),
              x:g.x+g.width/2, y:g.y+g.height/2, alto:g.height};
    });
    if(!src){ console.log('AVISO  /crm  sem cartao no kanban para testar o arraste'); }
    else{
      src.alto>=44? console.log('ok     /crm  a alca de arraste tem '+Math.round(src.alto)+'px de altura (minimo 44)')
        : (console.log('FALHA  /crm  alca de arraste com so '+Math.round(src.alto)+'px — alvo de toque menor que 44px'), falhas++);
      await m.mouse.move(src.x,src.y);
      await m.mouse.down();
      for(let i=1;i<=12;i++){ await m.mouse.move(src.x+i*26,src.y); await new Promise(r=>setTimeout(r,25)); }
      const durante=await m.evaluate(()=>({
        fantasma:!!document.querySelector('.kcard.fantasma'),
        alvo:(document.querySelector('.coluna.alvo')||{getAttribute:()=>null}).getAttribute('data-status')}));
      durante.fantasma? console.log('ok     /crm  o arraste no toque leva um cartao fantasma sob o dedo')
        : (console.log('FALHA  /crm  o arraste no toque nao comecou (sem fantasma) — o kanban voltou a ser so-mouse?'), falhas++);
      durante.alvo? console.log('ok     /crm  a coluna sob o dedo se destaca ('+durante.alvo+')')
        : (console.log('FALHA  /crm  nenhuma coluna se destaca durante o arraste'), falhas++);
      await m.mouse.up();
      await new Promise(r=>setTimeout(r,1300));
      const dep2=await m.evaluate(id=>{ const c=document.querySelector('.kcard[data-id="'+id+'"]');
        return c? c.closest('.coluna').getAttribute('data-status') : 'sumiu'; },src.id);
      (dep2!==src.de && dep2!=='sumiu')
        ? console.log('ok     /crm  ARRASTAR NO CELULAR funciona ('+src.de+' -> '+dep2+')')
        : (console.log('FALHA  /crm  arrastar no celular NAO moveu o cartao (continua em '+dep2+')'), falhas++);
    }
    /* nenhuma tela pode rolar de lado a 320px — o kanban rola por dentro */
    const est=await b.newPage();
    await est.setViewport({width:320,height:800,deviceScaleFactor:1});
    await est.goto(BASE+'/crm/entrar',{waitUntil:'networkidle2'});
    await est.evaluate(async(u,s)=>{ await fetch('/crm/entrar',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:u,senha:s})}); },USUARIO,SENHA);
    await est.goto(BASE+'/crm',{waitUntil:'networkidle2'});
    await new Promise(r=>setTimeout(r,1200));
    for(const aba of ['abaLista','abaKanban','abaNumeros','abaAvisos']){
      await est.evaluate(id=>document.getElementById(id).click(),aba);
      await new Promise(r=>setTimeout(r,650));
      const rola=await est.evaluate(()=>({d:document.documentElement.scrollWidth,c:document.documentElement.clientWidth,
        k:(()=>{const x=document.querySelector('.kanban'); return x? getComputedStyle(x).overflowX : null;})()}));
      rola.d<=rola.c
        ? console.log('ok     /crm '+aba+' @320px  o corpo nao rola de lado'+(rola.k? ' (kanban rola por dentro: '+rola.k+')':''))
        : (console.log('FALHA  /crm '+aba+' @320px  o CORPO rola de lado ('+rola.d+' > '+rola.c+')'), falhas++);
    }
    await est.close();
    await m.close();

    if(errosJs.length){ errosJs.forEach(e=>console.log('FALHA  /crm  erro de JS na pagina: '+e)); falhas+=errosJs.length; }
    else console.log('ok     /crm  nenhum erro de JS durante as interacoes');
  }

  await b.close();
  console.log(falhas? '\n'+falhas+' VAZAMENTO(S) DE CAIXA.' : '\nLayout: nenhuma caixa vaza.');
  process.exit(falhas?1:0);
})();

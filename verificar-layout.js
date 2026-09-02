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

/* ---------- as abas do painel, LIDAS DO DOM ----------
   🔴 Estavam decoradas: `['abaLista','abaKanban','abaNumeros','abaAvisos']`,
   repetido em tres lugares. Em 02/09/2026 a reescrita do painel renomeou
   `abaNumeros` para `abaPainel`, e este verificador estourou com
   "Cannot read properties of null (reading 'click')" no meio da secao 3:
   51 dos 86 checks simplesmente NAO RODARAM — e o `verificar-pv.sh` ainda
   assim fechou com "TUDO CERTO. As paginas podem ser divulgadas."

   Ler do DOM faz a proxima renomeacao nao quebrar nada. E se o painel vier
   SEM aba nenhuma, isso vira erro alto aqui, nunca uma lista vazia que faria
   o laco rodar zero vezes e parecer aprovado. */

/* ---------- clicar SEM derrubar o verificador ----------
   🔴 `document.querySelector(x).click()` estoura com "Cannot read properties
   of null" quando o seletor nao casa — e como isso e uma rejeicao nao tratada,
   o processo MORRE no meio, sem rodape. Ja aconteceu duas vezes em 02/09/2026:
   uma aba renomeada, e depois uma lista vazia. Nos dois casos o
   `verificar-pv.sh` contou so as FALHAs impressas ANTES do crash e nao percebeu
   que dezenas de checagens simplesmente nao rodaram.
   Aqui o clique que nao acha alvo devolve `false`, e quem chamou decide o que
   dizer. Nunca derruba nada. */
async function clica(pagina, seletor){
  return pagina.evaluate((s)=>{ const el=document.querySelector(s);
    if(!el) return false; el.click(); return true; }, seletor);
}

async function abasDe(pagina){
  const ids = await pagina.evaluate(() =>
    Array.from(document.querySelectorAll('[role="tab"][id]')).map(e => e.id));
  if(!ids.length) throw new Error('o painel /crm nao tem nenhuma aba [role=tab] — o verificador nao mediria nada');
  return ids;
}

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
        /* 02/09/2026: a recomendacao virou TELA PROPRIA, antes do "recebido".
           Medir a #obrigado aqui deixaria de fora exatamente a tela cheia. */
        document.getElementById('recomendacao').hidden=false;
        document.getElementById('obrigado').hidden=true;
        /* desenha a recomendacao pelos mesmos ids que o JS da pagina usa */
        document.getElementById('rec-nome').textContent=dado.nome;
        document.getElementById('rec-porque').textContent=dado.porque;
        document.getElementById('rec-preco').textContent=dado.preco;
        document.getElementById('rec-parcela').textContent='ou '+dado.parcela;
        const ul=document.getElementById('rec-inclui'); ul.innerHTML='';
        dado.inclui.forEach(t=>{const li=document.createElement('li');li.textContent=t;ul.appendChild(li);});
        /* O botao existe nos DOIS caminhos, com papeis diferentes: <a> que
           navega para o checkout no online, <button> que confirma no
           presencial. A caixa "turma pequena" so no presencial. */
        const cta=document.getElementById('rec-cta');
        const cnf=document.getElementById('rec-confirmar');
        const exc=document.getElementById('rec-exclusivo');
        cta.hidden=!dado.checkout; if(dado.checkout) cta.setAttribute('href',dado.checkout);
        cnf.hidden=!!dado.checkout;
        exc.hidden=!!dado.checkout;
        const ex=document.getElementById('rec-extra');
        ex.hidden=!dado.presencial_possivel;
        if(dado.presencial_possivel){
          document.getElementById('rec-extra-txt').textContent=
            'E fica sabendo: o '+dado.presencial_possivel.nome+' existe, por '+
            dado.presencial_possivel.preco+' ('+dado.presencial_possivel.parcela+
            '). Se você quiser fazer a prática ao vivo comigo, me fala no WhatsApp '+
            'que a gente vê as condições juntas.';
        }
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
      },SELETORES+',.rec,.rec__porque,.rec__extra,.rec__cta,.rec__seleta,.valor__l',caso.d,caso.nome);
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
      for(const aba of await abasDe(p)){
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
    for(const aba of await abasDe(p)){
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

    /* 🔴 A VISTA DE ENTRADA NAO E MAIS A LISTA (02/09/2026).
       O painel virou quatro secoes com barra lateral, entra no "Painel" e
       ainda LEMBRA a ultima secao usada. Qualquer check que leia `tbody tr`
       tem de LEVAR a pagina ate a secao Leads primeiro — senao mede uma tela
       que nao tem tabela nenhuma, acha zero linha e reprova o painel certo.
       Foi o que aconteceu aqui: seis checks da secao 5f acusaram "lista
       vazia" com a lista cheia, do outro lado da navegacao.

       `abreFiltros` existe pela mesma razao: os sete campos agora moram numa
       gaveta em TODA largura (antes ficavam abertos no desktop), e
       `page.click` nao clica no que esta com display:none. */
    async function vaPara(pagina, aba){
      await pagina.evaluate(id=>{
        const b=document.getElementById(id);
        if(!b) throw new Error('a secao "'+id+'" nao existe no painel');
        b.click();
      }, aba);
      await new Promise(r=>setTimeout(r,800));
    }
    async function abreFiltros(pagina){
      await pagina.evaluate(()=>{ const d=document.getElementById('maisFiltros'); if(d) d.open=true; });
      await new Promise(r=>setTimeout(r,200));
    }

    /* --- 5a. os numeros do topo batem com a API --- */
    await vaPara(p,'abaPainel');
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
    /* A linha de resumo virou uma fileira de fichas (rotulo em cima, numero
       embaixo), entao o texto e "Total 149" e nao mais "Total: 149". O check
       le o par rotulo+numero em vez de uma frase inteira — assim ele mede o
       DADO e nao a pontuacao. */
    tela.resumo.replace(/\s+/g,' ').indexOf('Total '+api.total.toLocaleString('pt-BR'))!==-1
      ? dizOk('o total da linha de resumo bate com a API ('+api.total+')')
      : dizMal('total do resumo nao bate com a API ('+api.total+'): "'+tela.resumo.slice(0,70)+'"');
    tela.azulejos.length>=4? dizOk('os 4 numeros do dia estao no topo')
      : dizMal('so '+tela.azulejos.length+' numero(s) no topo');

    /* O botao do WhatsApp e as linhas da tabela vivem na secao Leads. */
    await vaPara(p,'abaLista');

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
    await abreFiltros(p);
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
    /* --- 5f. A VISTA DOS QUE PARARAM NO MEIO (02/09/2026) ---
       O painel passou a mostrar dois mundos: quem terminou o formulario e
       quem parou no meio. Este check prova as tres coisas que o Eduardo
       pediu — distinguir, filtrar, e dizer ONDE parou — medindo a tela de
       verdade em vez de procurar palavra no fonte.

       Roda numa aba propria porque ele SEMEIA um parcial pela API publica
       antes de olhar: sem semente, o filtro "Pararam no meio" devolveria
       lista vazia e todos os checks passariam sem ter visto nada. Um gate
       que aprova a lista vazia e um gate que mente. */
    const pp=await b.newPage();
    pp.on('pageerror',e=>errosJs.push('parcial: '+e.message));
    await pp.setViewport({width:390,height:844,deviceScaleFactor:1});
    await pp.goto(BASE+'/inscricao-presencial',{waitUntil:'networkidle2'});
    const semeou=await pp.evaluate(async()=>{
      const uid='layout-parcial-'+Date.now();
      const r=await fetch('/api/lead-parcial',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({nome:'Layout Parou No Preco',telefone:'(35) 99716-4668',
          cidade:'Cambui',instagram:'@layout_parcial',situacao:'ja-lash',busca:'tecnica-led',
          disponibilidade:'sim',prefere_formato:'presencial',
          ultima_etapa:'10',lead_uid:uid})});
      return (await r.json()).gravado===true;
    });
    semeou? dizOk('semeei um parcial que parou na pergunta do preco')
      : dizMal('nao consegui semear um parcial pela API publica — o resto desta secao nao prova nada');

    await pp.goto(BASE+'/crm/entrar',{waitUntil:'networkidle2'});
    await pp.evaluate(async(u,s)=>{ await fetch('/crm/entrar',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:u,senha:s})}); },USUARIO,SENHA);
    await pp.goto(BASE+'/crm',{waitUntil:'networkidle2'});
    await new Promise(r=>setTimeout(r,1500));

    /* o azulejo com o numero, e o subtitulo do preco */
    const az=await pp.evaluate(()=>{
      const k=[...document.querySelectorAll('.kpi')]
        .find(x=>x.querySelector('.kpi__r') && x.querySelector('.kpi__r').textContent.indexOf('Pararam no meio')!==-1);
      if(!k) return null;
      return {n:parseInt(k.querySelector('.kpi__n').textContent.replace(/\D/g,''),10),
              sub:(k.querySelector('.kpi__p')||{textContent:''}).textContent,
              clicavel:k.tagName==='BUTTON'};
    });
    if(!az) dizMal('o azulejo "Pararam no meio" nao esta no topo — o numero mais comercial do painel esta escondido');
    else{
      az.n>=1? dizOk('o azulejo "Pararam no meio" mostra '+az.n)
        : dizMal('o azulejo diz 0 mesmo com um parcial semeado');
      /* O PEDIDO LITERAL: "um parcial que travou no preco e uma informacao
         comercial forte — deixe-a visivel, nao escondida no detalhe". */
      az.sub.indexOf('pergunta do preço')!==-1
        ? dizOk('e diz, ali mesmo, quantas pararam na pergunta do preco')
        : dizMal('o azulejo nao diz quantas pararam no preco: "'+az.sub.slice(0,60)+'"');
      az.clicavel? dizOk('o azulejo leva a lista dessas pessoas (e um botao)')
        : dizMal('o azulejo nao e clicavel — o dado esta la e nao leva a lugar nenhum');
    }

    /* a lista, com o filtro ligado */
    await vaPara(pp,'abaLista');
    await abreFiltros(pp);
    const antesP=await pp.evaluate(()=>document.querySelectorAll('tbody tr').length);
    await pp.select('#fCompleto','nao');
    await new Promise(r=>setTimeout(r,1200));
    const vista=await pp.evaluate(()=>({
      linhas:document.querySelectorAll('tbody tr').length,
      marcadas:document.querySelectorAll('tbody tr.lin-parcial').length,
      pilulas:[...document.querySelectorAll('tbody .pil.q-parcial')].map(x=>x.textContent),
      ondeParou:[...document.querySelectorAll('tbody td[data-rot="Produto indicado"]')].map(t=>t.textContent),
      csv:document.getElementById('btCsv').getAttribute('href')
    }));
    vista.linhas>0? dizOk('o filtro "Pararam no meio" devolve '+vista.linhas+' pessoa(s)')
      : dizMal('o filtro "Pararam no meio" devolveu lista vazia');
    vista.marcadas===vista.linhas && vista.linhas>0
      ? dizOk('toda linha de parcial esta marcada visualmente ('+vista.marcadas+')')
      : dizMal('so '+vista.marcadas+' de '+vista.linhas+' linhas marcadas como parcial');
    vista.pilulas.length===vista.linhas && vista.pilulas.every(t=>t.indexOf('Parou no meio')!==-1)
      ? dizOk('cada uma traz a pilula propria "Parou no meio" (e nao "frio")')
      : dizMal('faltou a pilula de parcial em alguma linha: '+JSON.stringify(vista.pilulas.slice(0,3)));
    vista.ondeParou.some(t=>t.indexOf('Parou na')!==-1)
      ? dizOk('a lista diz em qual pergunta cada uma parou')
      : dizMal('a lista nao diz onde a pessoa parou: '+JSON.stringify(vista.ondeParou.slice(0,2)));
    vista.ondeParou.some(t=>t.indexOf('faixa de investimento')!==-1)
      ? dizOk('e quem travou no preco aparece dizendo isso, por extenso')
      : dizMal('quem parou no preco nao esta identificada na lista');
    vista.csv.indexOf('completo=nao')!==-1? dizOk('o CSV leva junto o filtro de completo')
      : dizMal('o CSV nao leva o filtro de completo: '+vista.csv);

    /* a gaveta: quem abre a ficha precisa saber que NAO e inscricao */
    /* Se a lista veio vazia (e uma das FALHAs acima diz exatamente isso), nao
       ha ficha para abrir. Antes isto derrubava o verificador inteiro e as 16
       checagens seguintes nunca rodavam. */
    const abriuParcial = await clica(pp, 'tbody tr');
    if(!abriuParcial) dizMal('nao ha linha de parcial na lista para abrir a gaveta — as checagens da gaveta nao rodaram');
    await new Promise(r=>setTimeout(r,1000));
    const gav=await pp.evaluate(()=>{
      const g=document.querySelector('.gaveta, [aria-modal="true"]')||document.body;
      return {texto:g.textContent, alerta:!!g.querySelector('.faixa-parcial')};
    });
    gav.alerta? dizOk('a gaveta abre com o aviso de formulario incompleto')
      : dizMal('a gaveta de um parcial nao avisa que ela nao terminou');
    gav.texto.indexOf('não viu preço nenhum')!==-1
      ? dizOk('a gaveta diz que ela NAO viu preco nenhum')
      : dizMal('a gaveta nao diz que ela nao viu preco — a Nataly ligaria falando de um curso que ninguem indicou');
    gav.texto.indexOf('Onde parou')!==-1? dizOk('a gaveta diz onde ela parou')
      : dizMal('a gaveta nao diz onde ela parou');

    /* e o corpo nao pode rolar de lado com essas linhas novas */
    for(const w of [320,390]){
      await pp.setViewport({width:w,height:800,deviceScaleFactor:1});
      await new Promise(r=>setTimeout(r,500));
      const rl=await pp.evaluate(()=>({d:document.documentElement.scrollWidth,c:document.documentElement.clientWidth}));
      rl.d<=rl.c? dizOk('a lista de parciais @'+w+'px nao rola de lado')
        : dizMal('a lista de parciais @'+w+'px faz o CORPO rolar de lado ('+rl.d+' > '+rl.c+')');
    }
    await pp.close();

    /* nenhuma tela pode rolar de lado a 320px — o kanban rola por dentro */
    const est=await b.newPage();
    await est.setViewport({width:320,height:800,deviceScaleFactor:1});
    await est.goto(BASE+'/crm/entrar',{waitUntil:'networkidle2'});
    await est.evaluate(async(u,s)=>{ await fetch('/crm/entrar',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:u,senha:s})}); },USUARIO,SENHA);
    await est.goto(BASE+'/crm',{waitUntil:'networkidle2'});
    await new Promise(r=>setTimeout(r,1200));
    for(const aba of await abasDe(est)){
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

  /* ============================================================
     6. A NAVEGACAO NOVA, O PAINEL E A PORTA (02/09/2026)
     ============================================================
     A pagina unica virou quatro vistas com barra lateral, o painel
     ganhou tela propria e a tela de login mudou de identidade. Nada
     disso tinha gate: os checks de caixa e de contraste medem o que
     esta na tela, nunca se a estrutura e a que foi pedida.

     Tudo aqui e medido no DOM RENDERIZADO. Procurar a palavra no fonte
     provaria que alguem escreveu "lateral", nao que existe uma. */
  if(SENHA){
    const dizOk6=m=>console.log('ok     /crm  '+m);
    const dizMal6=m=>{ console.log('FALHA  /crm  '+m); falhas++; };

    async function entra(pagina){
      await pagina.goto(BASE+'/crm/entrar',{waitUntil:'networkidle2'});
      await pagina.evaluate(async(u,s)=>{ await fetch('/crm/entrar',{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:u,senha:s})}); },USUARIO,SENHA);
      await pagina.goto(BASE+'/crm',{waitUntil:'networkidle2'});
      await new Promise(r=>setTimeout(r,1400));
    }

    /* ---------- 6a. a barra e UMA SO, em duas posicoes ---------- */
    const n1=await b.newPage();
    const errosNav=[];
    n1.on('pageerror',e=>errosNav.push(e.message));
    await n1.setViewport({width:1280,height:900});
    await entra(n1);

    const est=await n1.evaluate(()=>{
      const navs=document.querySelectorAll('[role="tablist"]');
      const itens=[...document.querySelectorAll('[role="tab"]')];
      const ids=itens.map(i=>i.id);
      return {
        navs:navs.length,
        itens:itens.length,
        ids:ids.join(','),
        /* id repetido = duas barras espelhadas, que e o erro que a decisao
           de usar UM elemento em duas posicoes existe para evitar */
        idsUnicos:new Set(ids).size===ids.length,
        marcados:itens.filter(i=>i.getAttribute('aria-selected')==='true').length,
        /* so o item ativo fica na ordem de tabulacao: o padrao de tablist */
        tabbable:itens.filter(i=>i.getAttribute('tabindex')!=='-1').length,
        paineis:[...document.querySelectorAll('[role="tabpanel"]')].length,
        visiveis:[...document.querySelectorAll('[role="tabpanel"]')].filter(s=>!s.hidden).length
      };
    });
    est.navs===1
      ? dizOk6('a navegacao e UM elemento so ('+est.itens+' secoes), nao duas barras espelhadas')
      : dizMal6('ha '+est.navs+' listas de navegacao — duas barras significam id duplicado e foco parando duas vezes');
    est.idsUnicos? dizOk6('nenhum id de secao repetido ('+est.ids+')')
      : dizMal6('id de secao REPETIDO: '+est.ids);
    est.itens>=4? dizOk6('as quatro secoes existem')
      : dizMal6('so '+est.itens+' secao(oes) na navegacao');
    est.marcados===1? dizOk6('exatamente uma secao marcada como ativa')
      : dizMal6(est.marcados+' secoes marcadas como ativas ao mesmo tempo');
    est.tabbable===1? dizOk6('so a secao ativa esta na ordem de tabulacao (padrao de tablist)')
      : dizMal6(est.tabbable+' itens tabulaveis — o Tab passaria por todos antes de chegar no conteudo');
    est.visiveis===1? dizOk6('so um painel visivel de cada vez')
      : dizMal6(est.visiveis+' paineis visiveis ao mesmo tempo');

    /* geometria: no desktop e COLUNA a esquerda, encostada no topo */
    const lat=await n1.evaluate(()=>{
      const l=document.querySelector('.lateral'); if(!l) return null;
      const r=l.getBoundingClientRect(), cs=getComputedStyle(l);
      const it=[...document.querySelectorAll('[role="tab"]')].map(x=>x.getBoundingClientRect());
      return {x:Math.round(r.left), larg:Math.round(r.width), alt:Math.round(r.height),
        pos:cs.position,
        /* empilhados = coluna; lado a lado = fileira */
        empilhados: it.length>1 && it[1].top>=it[0].bottom-1,
        alvoMin: Math.round(Math.min.apply(null,it.map(i=>i.height)))};
    });
    if(!lat) dizMal6('a barra lateral (.lateral) nao existe no desktop');
    else{
      (lat.x<=1 && lat.larg>=180 && lat.larg<=300)
        ? dizOk6('@1280px a barra e uma COLUNA de '+lat.larg+'px encostada na esquerda')
        : dizMal6('@1280px a barra nao e coluna lateral (x='+lat.x+' largura='+lat.larg+')');
      lat.empilhados? dizOk6('…com as secoes empilhadas uma sob a outra')
        : dizMal6('as secoes do desktop estao lado a lado — continua sendo fileira de abas');
      lat.pos==='sticky'||lat.pos==='fixed'
        ? dizOk6('…e ela acompanha a rolagem ('+lat.pos+')')
        : dizMal6('a barra lateral rola junto com o conteudo e some ('+lat.pos+')');
    }

    /* a seta do teclado tem de andar na lista VERTICAL: para baixo */
    const antesSeta=await n1.evaluate(()=>document.getElementById('tituloVista').textContent);
    await n1.evaluate(()=>document.querySelector('[role="tab"][aria-selected="true"]').focus());
    await n1.keyboard.press('ArrowDown');
    await new Promise(r=>setTimeout(r,700));
    const depoisSeta=await n1.evaluate(()=>document.getElementById('tituloVista').textContent);
    depoisSeta!==antesSeta
      ? dizOk6('a seta para BAIXO troca de secao na lista vertical ('+antesSeta+' -> '+depoisSeta+')')
      : dizMal6('a seta para baixo nao troca de secao — no desktop a lista e vertical e a seta tem de acompanhar');

    /* ---------- 6b. o titulo diz onde ela esta ---------- */
    const abas6=await abasDe(n1);
    let titulosOk=true;
    for(const aba of abas6){
      await n1.evaluate(id=>document.getElementById(id).click(),aba);
      await new Promise(r=>setTimeout(r,650));
      const t=await n1.evaluate(id=>({
        titulo:document.getElementById('tituloVista').textContent.trim(),
        rotulo:document.getElementById(id).querySelector('.rot').textContent.trim(),
        doc:document.title
      }),aba);
      if(t.titulo!==t.rotulo){ titulosOk=false;
        dizMal6('a secao "'+t.rotulo+'" mostra o titulo "'+t.titulo+'" — a tela mente sobre onde ela esta'); }
      if(t.doc.indexOf(t.rotulo)!==0){ titulosOk=false;
        dizMal6('o titulo da ABA DO NAVEGADOR nao acompanha a secao ("'+t.doc+'")'); }
    }
    if(titulosOk) dizOk6('o titulo da tela e o da aba do navegador acompanham a secao');

    /* ---------- 6c. os filtros so aparecem onde recortam algo ---------- */
    let filtrosOk=true;
    for(const [aba,deveAparecer] of [['abaPainel',false],['abaKanban',true],['abaLista',true],['abaAvisos',false]]){
      await n1.evaluate(id=>document.getElementById(id).click(),aba);
      await new Promise(r=>setTimeout(r,650));
      const vis=await n1.evaluate(()=>{
        const f=document.getElementById('filtros');
        return !!(f && f.offsetParent!==null);
      });
      if(vis!==deveAparecer){ filtrosOk=false;
        dizMal6('os filtros '+(vis?'APARECEM':'SOMEM')+' em '+aba+' e deveria ser o contrario'); }
    }
    if(filtrosOk) dizOk6('os filtros aparecem em Leads e Pipeline e somem no Painel e nos Avisos');

    /* 🔴 O PAINEL NAO PODE MENTIR: com filtro ligado, ele mostra um recorte
       e os filtros estao escondidos. Se ele nao AVISAR, ela le um numero
       menor achando que e o total. */
    await n1.evaluate(()=>document.getElementById('abaLista').click());
    await new Promise(r=>setTimeout(r,500));
    await n1.evaluate(()=>{ const d=document.getElementById('maisFiltros'); if(d) d.open=true; });
    await n1.select('#fQualif','quente');
    await new Promise(r=>setTimeout(r,1100));
    await n1.evaluate(()=>document.getElementById('abaPainel').click());
    await new Promise(r=>setTimeout(r,900));
    const avisou=await n1.evaluate(()=>{
      const n=document.getElementById('notaGraficos');
      return {txt:n?n.textContent:'', saida:!!(n&&n.querySelector('button'))};
    });
    avisou.txt.indexOf('recorte filtrado')!==-1
      ? dizOk6('com filtro ligado o Painel AVISA que os numeros sao um recorte')
      : dizMal6('o Painel mostra numeros filtrados sem dizer que sao filtrados: "'+avisou.txt.slice(0,60)+'"');
    avisou.saida? dizOk6('…e da o caminho de volta ali mesmo')
      : dizMal6('o Painel avisa do recorte mas nao oferece como sair dele');
    await n1.evaluate(()=>document.getElementById('abaLista').click());
    await new Promise(r=>setTimeout(r,400));
    await n1.evaluate(()=>{ const d=document.getElementById('maisFiltros'); if(d) d.open=true; });
    await n1.click('#btLimpar');
    await new Promise(r=>setTimeout(r,1100));

    /* ---------- 6d. o painel de fato tem graficos, e todos desenham ---------- */
    await n1.evaluate(()=>document.getElementById('abaPainel').click());
    await new Promise(r=>setTimeout(r,1100));
    const dash=await n1.evaluate(()=>{
      const figs=[...document.querySelectorAll('#pPainel .fig')];
      return {
        n:figs.length,
        titulos:figs.map(f=>f.querySelector('h3').textContent.trim()),
        /* uma figura sem SVG e sem explicacao e uma caixa branca vazia */
        mudas:figs.filter(f=>{
          const t=f.querySelector('.tela');
          return !t || (!t.querySelector('svg') && !t.querySelector('.viz-vazio'));
        }).map(f=>f.querySelector('h3').textContent.trim()),
        /* toda figura tem de ter o caminho em tabela: leitor de tela, quem
           nao separa as cores, e quem so quer o numero exato */
        semTabela:figs.filter(f=>!f.querySelector('details.tabela-viz'))
                      .map(f=>f.querySelector('h3').textContent.trim()),
        /* o "porque" de cada uma: gráfico sem pergunta é enfeite */
        semPorque:figs.filter(f=>{
          const p=f.querySelector('.porque');
          return !p || p.textContent.trim().length<20;
        }).map(f=>f.querySelector('h3').textContent.trim()),
        azulejos:document.querySelectorAll('#pPainel .kpi').length,
        periodos:document.querySelectorAll('#segPeriodo button').length
      };
    });
    dash.n>=6? dizOk6('o painel tem '+dash.n+' graficos com tela propria (antes eram 4, espremidos)')
      : dizMal6('o painel tem so '+dash.n+' grafico(s) — o pedido era um dash robusto');
    dash.mudas.length===0? dizOk6('toda figura desenha, ou diz por escrito que nao tem o que mostrar')
      : dizMal6('figura(s) sem desenho e sem explicacao (caixa branca vazia): '+dash.mudas.join(' · '));
    dash.semTabela.length===0? dizOk6('toda figura carrega a versao em tabela')
      : dizMal6('figura(s) sem tabela — inacessivel para leitor de tela: '+dash.semTabela.join(' · '));
    dash.semPorque.length===0? dizOk6('toda figura diz a que pergunta responde')
      : dizMal6('figura(s) sem o "porque": '+dash.semPorque.join(' · '));
    dash.azulejos>=5? dizOk6('os numeros do dia moram no painel ('+dash.azulejos+' azulejos)')
      : dizMal6('so '+dash.azulejos+' azulejo(s) no painel');
    dash.periodos>=4? dizOk6('o painel tem o seletor de periodo proprio ('+dash.periodos+' opcoes)')
      : dizMal6('o painel nao tem seletor de periodo — com os filtros escondidos, ela nao consegue recortar por data');

    /* os dois graficos NOVOS, pelo nome */
    for(const t of ['Ha quanto tempo estao esperando','Onde o formulario perde gente']){
      const achou=dash.titulos.some(x=>x.normalize('NFD').replace(/[̀-ͯ]/g,'')===t);
      achou? dizOk6('grafico presente: "'+t+'"')
           : dizMal6('sumiu o grafico "'+t+'" — ele foi aceito por mudar uma decisao');
    }

    /* o seletor de periodo tem de MEXER nos numeros, nao so acender */
    const antesP6=await n1.evaluate(()=>document.querySelector('#pPainel .kpi .kpi__n').textContent);
    await n1.evaluate(()=>{
      const b=[...document.querySelectorAll('#segPeriodo button')].find(x=>x.getAttribute('data-v')==='1');
      if(b) b.click();
    });
    await new Promise(r=>setTimeout(r,900));
    const dep6=await n1.evaluate(()=>({
      n:document.querySelector('#pPainel .kpi .kpi__n').textContent,
      marcado:(document.querySelector('#segPeriodo button[aria-pressed="true"]')||{}).textContent,
      /* o OUTRO controle do mesmo estado tem de concordar: dois controles,
         um estado. Se discordarem, ela ve "Hoje" e exporta o periodo todo. */
      select:document.getElementById('fPeriodo').value
    }));
    dep6.select==='1'
      ? dizOk6('o segmentado e o select de periodo escrevem no MESMO estado')
      : dizMal6('o segmentado diz "'+dep6.marcado+'" e o select ficou em "'+dep6.select+'" — dois estados para o mesmo filtro');
    dep6.n!==antesP6? dizOk6('mudar o periodo mexe nos numeros ('+antesP6.trim()+' -> '+dep6.n.trim()+')')
      : console.log('AVISO  /crm  o periodo nao mudou o numero do primeiro azulejo (pode ser a base de teste)');
    await n1.evaluate(()=>{
      const b=[...document.querySelectorAll('#segPeriodo button')].find(x=>x.getAttribute('data-v')==='');
      if(b) b.click();
    });
    await new Promise(r=>setTimeout(r,700));

    /* ---------- 6e. no celular a barra vai para BAIXO e nao cobre nada ---------- */
    const n2=await b.newPage();
    n2.on('pageerror',e=>errosNav.push('celular: '+e.message));
    await n2.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    await entra(n2);
    const cel=await n2.evaluate(()=>{
      const l=document.querySelector('.lateral'); if(!l) return null;
      const r=l.getBoundingClientRect(), cs=getComputedStyle(l);
      const it=[...document.querySelectorAll('[role="tab"]')].map(x=>x.getBoundingClientRect());
      const main=document.querySelector('main.envolve');
      const mcs=getComputedStyle(main);
      return {
        pos:cs.position,
        colada: Math.round(r.bottom) >= window.innerHeight-1,
        larguraCheia: Math.round(r.width) >= window.innerWidth-1,
        emFileira: it.length>1 && it[1].left>=it[0].right-1,
        alvoMin: Math.round(Math.min.apply(null,it.map(i=>i.height))),
        alturaBarra: Math.round(r.height),
        respiro: Math.round(parseFloat(mcs.paddingBottom)),
        rotulos: [...document.querySelectorAll('[role="tab"] .rot')].map(x=>x.textContent.trim()).join(',')
      };
    });
    if(!cel) dizMal6('a navegacao sumiu no celular');
    else{
      (cel.pos==='fixed' && cel.colada && cel.larguraCheia)
        ? dizOk6('@390px a MESMA barra vira barra INFERIOR fixa, de ponta a ponta')
        : dizMal6('@390px a navegacao nao e barra inferior fixa (pos='+cel.pos+' colada='+cel.colada+' cheia='+cel.larguraCheia+')');
      cel.emFileira? dizOk6('…com as quatro secoes lado a lado, ao alcance do polegar')
        : dizMal6('no celular as secoes continuam empilhadas — a barra ocuparia a tela toda');
      /* 44px e o minimo de alvo de toque; a barra ja tem 52 por item */
      cel.alvoMin>=44? dizOk6('…e cada alvo de toque tem '+cel.alvoMin+'px (minimo 44)')
        : dizMal6('alvo de toque da navegacao com so '+cel.alvoMin+'px');
      /* 🔴 barra FIXA sobre conteudo rolavel: sem respiro no pe do <main>,
         a ultima linha da lista fica PARA SEMPRE atras da barra. */
      cel.respiro>=cel.alturaBarra
        ? dizOk6('…e o conteudo tem '+cel.respiro+'px de respiro no pe, maior que a barra ('+cel.alturaBarra+'px)')
        : dizMal6('a barra inferior ('+cel.alturaBarra+'px) COBRE o fim do conteudo (respiro de so '+cel.respiro+'px)');
      cel.rotulos.split(',').every(x=>x.length>0)
        ? dizOk6('…e todo icone leva rotulo escrito ("'+cel.rotulos+'"), nunca so o desenho')
        : dizMal6('ha item de navegacao so com icone: "'+cel.rotulos+'"');
    }

    /* a ultima linha da lista tem de ser alcancavel de verdade */
    await n2.evaluate(()=>document.getElementById('abaLista').click());
    await new Promise(r=>setTimeout(r,900));
    const fim=await n2.evaluate(async()=>{
      window.scrollTo(0,document.body.scrollHeight);
      await new Promise(r=>setTimeout(r,400));
      const linhas=document.querySelectorAll('tbody tr');
      if(!linhas.length) return null;
      const u=linhas[linhas.length-1].getBoundingClientRect();
      const barra=document.querySelector('.lateral').getBoundingClientRect();
      return {fundoLinha:Math.round(u.bottom), topoBarra:Math.round(barra.top)};
    });
    if(fim===null) console.log('AVISO  /crm  sem linha na lista para conferir o fim da rolagem');
    else fim.fundoLinha<=fim.topoBarra
      ? dizOk6('rolando ate o fim, a ultima linha da lista PARA acima da barra inferior')
      : dizMal6('a barra inferior cobre a ultima linha da lista (linha termina em '+fim.fundoLinha+', barra comeca em '+fim.topoBarra+')');
    await n2.close();
    await n1.close();

    /* ---------- 6f. a lista NAO pode esconder o botao do WhatsApp ----------
       A barra lateral levou ~236px da largura do conteudo e a tabela precisa
       de ~1140. Num notebook de 1400px ela passou a rolar de lado, e o que
       saia da tela era justo a coluna de Acao. Rolar para alcancar o botao
       mais usado do painel e o oposto de fluido. */
    for(const w of [1280,1440]){
      const t=await b.newPage();
      await t.setViewport({width:w,height:900});
      await entra(t);
      await t.evaluate(()=>document.getElementById('abaLista').click());
      await new Promise(r=>setTimeout(r,900));
      const r=await t.evaluate(()=>{
        const bt=document.querySelector('tbody td.td-acao a.bt-wa');
        if(!bt) return null;
        const c=bt.getBoundingClientRect();
        const noAlvo=document.elementFromPoint(Math.round(c.left+c.width/2), Math.round(c.top+c.height/2));
        return {dentro: c.right<=window.innerWidth+1 && c.left>=0,
                clicavel: !!(noAlvo && (noAlvo===bt || bt.contains(noAlvo)))};
      });
      if(!r){ console.log('AVISO  /crm  sem botao de WhatsApp na lista @'+w+'px'); continue; }
      (r.dentro && r.clicavel)
        ? dizOk6('@'+w+'px o botao do WhatsApp esta na tela e clicavel sem rolar de lado')
        : dizMal6('@'+w+'px o botao do WhatsApp saiu da tela ou esta coberto (dentro='+r.dentro+' clicavel='+r.clicavel+')');
      await t.close();
    }

    if(errosNav.length){ errosNav.forEach(e=>console.log('FALHA  /crm  erro de JS na navegacao: '+e)); falhas+=errosNav.length; }
    else console.log('ok     /crm  nenhum erro de JS ao percorrer as quatro secoes');
  }

  /* ============================================================
     7. A PORTA — /crm/entrar
     ============================================================
     Nunca teve gate de layout nem de contraste, e e por ela que se
     entra em dado pessoal de terceiro. Nao exige sessao: roda sempre. */
  {
    const le=await b.newPage();
    const errosLogin=[];
    le.on('pageerror',e=>errosLogin.push(e.message));
    for(const w of [320,390,430,1280]){
      await le.setViewport({width:w,height:820});
      await le.goto(BASE+'/crm/entrar',{waitUntil:'networkidle2'});
      const r=await le.evaluate(sel=>{
        const maus=[];
        const doc=document.documentElement;
        if(doc.scrollWidth>doc.clientWidth) maus.push('BODY rola de lado ('+doc.scrollWidth+' > '+doc.clientWidth+')');
        document.querySelectorAll(sel+',.caixa,.campo-senha,input,button').forEach(el=>{
          if(el.offsetParent===null&&getComputedStyle(el).position!=='fixed') return;
          const pa=el.parentElement; if(!pa) return;
          const cs=getComputedStyle(pa);
          if(cs.overflowX==='auto'||cs.overflowX==='scroll') return;
          const a=el.getBoundingClientRect(), pb=pa.getBoundingClientRect();
          if(a.width>pb.width+1||a.right>pb.right+1||a.left<pb.left-1)
            maus.push((el.className||el.tagName)+' — '+Math.round(a.width)+'px em pai de '+Math.round(pb.width)+'px');
        });
        return maus;
      },SELETORES);
      if(r.length){ falhas+=r.length; r.forEach(m=>console.log('FALHA  /crm/entrar @'+w+'px  '+m)); }
      else console.log('ok     /crm/entrar @'+w+'px  nada vaza e o corpo nao rola de lado');
    }

    /* contraste medido, com a MESMA regua do painel */
    await le.setViewport({width:390,height:820});
    await le.goto(BASE+'/crm/entrar',{waitUntil:'networkidle2'});
    const cl=await le.evaluate(mediContraste);
    if(cl.length){ falhas+=cl.length; cl.forEach(m=>console.log('FALHA  contraste /crm/entrar  '+m)); }
    else console.log('ok     /crm/entrar  contraste medido: todo texto >=4.5:1 (>=3:1 se grande)');

    /* o campo de 16px: abaixo disso o Safari do iPhone da zoom sozinho
       ao focar e a caixa sai da tela */
    const px=await le.evaluate(()=>['usuario','senha']
      .map(id=>id+':'+Math.round(parseFloat(getComputedStyle(document.getElementById(id)).fontSize))));
    px.every(x=>parseInt(x.split(':')[1],10)>=16)
      ? console.log('ok     /crm/entrar  os campos tem 16px — o iPhone nao da zoom sozinho ao focar')
      : (console.log('FALHA  /crm/entrar  campo com menos de 16px, o Safari dara zoom e a caixa sai da tela: '+px.join(' ')), falhas++);

    /* alvos de toque */
    const alvos=await le.evaluate(()=>[...document.querySelectorAll('button, input')]
      .map(e=>({q:(e.id||e.type), h:Math.round(e.getBoundingClientRect().height)}))
      .filter(x=>x.h<40));
    alvos.length===0
      ? console.log('ok     /crm/entrar  todo campo e botao tem pelo menos 40px de altura')
      : (console.log('FALHA  /crm/entrar  alvo pequeno demais: '+alvos.map(a=>a.q+' '+a.h+'px').join(', ')), falhas++);

    /* 🔴 O OLHO. As senhas daqui tem simbolo e maiuscula no meio: digitar
       as cegas no celular erra, e sem o olho o suporte vira "esqueci a
       senha". Ele ja existia — este check impede que ele saia num redesenho. */
    const olho=await le.evaluate(async()=>{
      const c=document.getElementById('senha'), b=document.getElementById('olho');
      if(!b) return null;
      c.value='Teste123$';
      const antes=c.type;
      b.click(); await new Promise(r=>setTimeout(r,60));
      const depois=c.type, rot=b.getAttribute('aria-label'), pre=b.getAttribute('aria-pressed');
      const foco=document.activeElement===c, cursor=c.selectionStart;
      b.click(); await new Promise(r=>setTimeout(r,60));
      return {antes, depois, volta:c.type, rot, pre, foco, cursor, tam:c.value.length};
    });
    if(!olho) { console.log('FALHA  /crm/entrar  SUMIU o olho de revelar a senha'); falhas++; }
    else{
      (olho.antes==='password' && olho.depois==='text' && olho.volta==='password')
        ? console.log('ok     /crm/entrar  o olho revela e esconde a senha')
        : (console.log('FALHA  /crm/entrar  o olho nao alterna o campo ('+olho.antes+' -> '+olho.depois+' -> '+olho.volta+')'), falhas++);
      (olho.pre==='true' && /Ocultar/i.test(olho.rot||''))
        ? console.log('ok     /crm/entrar  …e conta o estado ao leitor de tela')
        : (console.log('FALHA  /crm/entrar  o olho nao conta o estado (aria-pressed='+olho.pre+' rotulo="'+olho.rot+'")'), falhas++);
      (olho.foco && olho.cursor===olho.tam)
        ? console.log('ok     /crm/entrar  …e devolve o foco ao campo com o cursor no fim')
        : (console.log('FALHA  /crm/entrar  o olho rouba o foco ou joga o cursor para o comeco (foco='+olho.foco+' cursor='+olho.cursor+')'), falhas++);
    }

    /* 🔴 O TRIM. Espaco colado ao copiar a senha e a causa nº 1 de "senha
       incorreta" com a senha certa — o teclado do celular acrescenta um
       espaco depois de colar. Medido no que SAI na requisicao, nao no fonte. */
    const enviado=await le.evaluate(async()=>{
      let corpo=null;
      const orig=window.fetch;
      window.fetch=function(u,o){ corpo=o&&o.body; return Promise.resolve(
        {ok:false, json:()=>Promise.resolve({ok:false,mensagem:'teste'})}); };
      document.getElementById('usuario').value='  alguem@exemplo.com  ';
      document.getElementById('senha').value='  senha-com-espaco  ';
      document.getElementById('form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
      await new Promise(r=>setTimeout(r,150));
      window.fetch=orig;
      return corpo;
    });
    if(!enviado){ console.log('FALHA  /crm/entrar  o formulario nao enviou nada'); falhas++; }
    else{
      let j={}; try{ j=JSON.parse(enviado); }catch(e){}
      (j.usuario==='alguem@exemplo.com' && j.senha==='senha-com-espaco')
        ? console.log('ok     /crm/entrar  usuario e senha vao APARADOS (espaco colado nao derruba o login)')
        : (console.log('FALHA  /crm/entrar  o espaco colado esta indo junto: '+JSON.stringify(j)), falhas++);
    }

    /* a IDV: a porta e a sala tem de ser o MESMO lugar */
    await le.goto(BASE+'/crm/entrar',{waitUntil:'networkidle2'});
    const corPorta=await le.evaluate(()=>({
      fundo:getComputedStyle(document.body).backgroundColor,
      tinta:getComputedStyle(document.querySelector('h1')).color}));
    await le.evaluate(async(u,s)=>{ await fetch('/crm/entrar',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:u,senha:s})}); },USUARIO,SENHA);
    await le.goto(BASE+'/crm',{waitUntil:'networkidle2'});
    await new Promise(r=>setTimeout(r,900));
    /* Sem elemento, dizer o que houve — nao estourar. Rodar o gate sem
       CRM_CONTAS deixava o login falhar, o /crm redirecionava para a porta,
       `#tituloVista` nao existia e o getComputedStyle(null) ABORTAVA a suite
       inteira no meio, escondendo tudo que vinha depois. */
    const corSala=await le.evaluate(()=>{
      const t=document.querySelector('#tituloVista');
      if(!t) return {erro:'nao entrei no painel (login falhou? sem CRM_CONTAS?) — URL '+location.pathname};
      return {fundo:getComputedStyle(document.body).backgroundColor,
              tinta:getComputedStyle(t).color};
    });
    if(corSala.erro){ console.log('FALHA  /crm/entrar  '+corSala.erro); falhas++; }
    else
    (corPorta.fundo===corSala.fundo && corPorta.tinta===corSala.tinta)
      ? console.log('ok     /crm/entrar  a porta e a sala usam o MESMO fundo e a MESMA tinta ('+corSala.fundo+' / '+corSala.tinta+')')
      : (console.log('FALHA  /crm/entrar  login e painel tem identidades diferentes — porta '+
          JSON.stringify(corPorta)+' vs sala '+JSON.stringify(corSala)), falhas++);

    if(errosLogin.length){ errosLogin.forEach(e=>console.log('FALHA  /crm/entrar  erro de JS: '+e)); falhas+=errosLogin.length; }
    else console.log('ok     /crm/entrar  nenhum erro de JS na tela de login');
    await le.close();
  }

  /* ============================================================
     5g. CONTRASTE NAS PAGINAS PUBLICAS
     ============================================================
     🔴 ESTA LACUNA CUSTOU CARO EM 02/09/2026. `mediContraste` existia desde
     sempre, mas so era chamada dentro do `if(SENHA)` — ou seja, so no /crm. As
     paginas que a aluna realmente ve nao tinham medida NENHUMA.

     No mesmo dia, a dobra "Onde fica Cambui" entrou com o tempo de viagem em
     --chocolate. Aquela dobra vive dentro do `.bloco`, que e pretinho: o par
     media 2,24:1 contra um piso de 4,5:1, e passou por TODOS os checks — o
     texto estava certo, a caixa nao vazava, nada rolava de lado. So foi pego
     porque alguem mediu a mao. Isso nao pode depender de alguem lembrar.

     Mede tambem as telas que so existem depois de o JS desenhar: as etapas do
     formulario uma a uma (as escondidas nao tem caixa e passariam sem medida),
     o combo de estado ABERTO, a recomendacao nos dois caminhos e o recebido. */
  {
    const PUB=['/profissao-lash-presencial','/inscricao-presencial'];
    let ruimP=0;
    for(const w of [320,390,900]){
      for(const rota of PUB){
        const pc=await b.newPage();
        await pc.setViewport({width:w,height:900,deviceScaleFactor:1});
        await pc.goto(BASE+rota,{waitUntil:'networkidle2'});
        await new Promise(r=>setTimeout(r,500));
        let r=await pc.evaluate(mediContraste);
        if(r.length){ falhas+=r.length; ruimP+=r.length;
          r.forEach(m=>console.log('FALHA  contraste '+rota+' @'+w+'px  '+m)); }

        if(rota==='/inscricao-presencial'){
          for(const et of ['0','1','2','3','4','5','5.5','6','7','8','9','10']){
            await pc.evaluate(e=>{
              document.querySelectorAll('.etapa').forEach(f=>f.hidden=(f.getAttribute('data-etapa')!==e));
              document.getElementById('insc-form').hidden=(e==='0');},et);
            r=await pc.evaluate(mediContraste);
            if(r.length){ falhas+=r.length; ruimP+=r.length;
              r.forEach(m=>console.log('FALHA  contraste etapa '+et+' @'+w+'px  '+m)); }
          }
          /* o combo de estado ABERTO: a lista tem tinta propria */
          await pc.evaluate(()=>{
            document.querySelectorAll('.etapa').forEach(f=>f.hidden=(f.getAttribute('data-etapa')!=='2'));
            document.getElementById('insc-form').hidden=false;
            document.getElementById('f-estado-busca').focus();});
          await new Promise(r2=>setTimeout(r2,400));
          r=await pc.evaluate(mediContraste);
          if(r.length){ falhas+=r.length; ruimP+=r.length;
            r.forEach(m=>console.log('FALHA  contraste combo aberto @'+w+'px  '+m)); }

          /* a recomendacao nos dois caminhos, e depois o recebido */
          for(const pres of [true,false]){
            await pc.evaluate(pres=>{
              document.querySelectorAll('.etapa').forEach(f=>f.hidden=true);
              document.getElementById('insc-form').hidden=true;
              document.getElementById('obrigado').hidden=true;
              document.getElementById('recomendacao').hidden=false;
              document.getElementById('rec-nome').textContent='Método LED — presencial';
              document.getElementById('rec-porque').textContent='Você consegue vir até Cambuí e o valor cabe no que você me disse.';
              document.getElementById('rec-preco').textContent='R$ 1.997';
              document.getElementById('rec-parcela').textContent='ou 12x de R$ 206,54';
              const ul=document.getElementById('rec-inclui'); ul.innerHTML='';
              ['Um dia inteiro de formação ao vivo comigo, em Cambuí, MG'].forEach(t=>{
                const li=document.createElement('li'); li.textContent=t; ul.appendChild(li);});
              document.getElementById('rec-nota').textContent='Ao confirmar, eu recebo as suas respostas e te chamo no WhatsApp.';
              document.getElementById('rec-exclusivo').hidden=!pres;
              document.getElementById('rec-confirmar').hidden=!pres;
              document.getElementById('rec-cta').hidden=pres;
              if(!pres) document.getElementById('rec-cta').setAttribute('href','https://pay.kiwify.com.br/x');
              document.getElementById('rec-extra').hidden=false;
              document.getElementById('rec-extra-txt').textContent='E fica sabendo: o Método LED presencial existe, por R$ 1.997.';
            },pres);
            r=await pc.evaluate(mediContraste);
            if(r.length){ falhas+=r.length; ruimP+=r.length;
              r.forEach(m=>console.log('FALHA  contraste recomendacao/'+(pres?'presencial':'online')+' @'+w+'px  '+m)); }
          }
          await pc.evaluate(()=>{document.getElementById('recomendacao').hidden=true;
            document.getElementById('obrigado').hidden=false;});
          r=await pc.evaluate(mediContraste);
          if(r.length){ falhas+=r.length; ruimP+=r.length;
            r.forEach(m=>console.log('FALHA  contraste recebido @'+w+'px  '+m)); }
        }
        await pc.close();
      }
    }
    if(!ruimP) console.log('ok     contraste medido nas paginas publicas: PV, formulario (12 etapas), '+
      'combo aberto, recomendacao (2 caminhos) e recebido, em 320/390/900px');
  }

  /* ============================================================
     6. O FLUXO DA RECOMENDACAO — medido no navegador, com o DEDO
     ============================================================
     Isto nao e checagem de layout: e a prova do COMPORTAMENTO que o Eduardo
     pediu, e mora aqui porque aqui ja ha um navegador de verdade.

     Duas coisas se provam, e as duas ja quebraram em producao:

       1. 🔴 O `Lead` NAO PODE SAIR ANTES DO CLIQUE. E o evento pelo qual a
          campanha de R$ 120/dia otimiza. Ate 02/09/2026 ele saia no fim das
          perguntas — ensinando o algoritmo a procurar quem so olha o preco.
          Medido pela REDE (facebook.com/tr?ev=...), que e a unica fonte que
          nao mente: interceptar `fbq` no JS provaria a chamada, nao o hit.

       2. 🔴 O BOTAO TEM DE EXISTIR NOS DOIS CAMINHOS. No presencial ele
          simplesmente nao estava na tela, e o Eduardo relatou "o botao nao faz
          nada" no celular. Medido em viewport de iPhone COM TOQUE e tocado com
          `touchscreen.tap`: clique de mouse nao prova alvo de dedo.

     ⚠️ NAVEGADOR PROPRIO, COM JANELA. O resto deste arquivo roda em
     `headless:'new'` — e em headless o pixel do Meta simplesmente NAO DISPARA.
     Medido: nesta mesma secao, em headless, `ViuRecomendacao`, `Lead` e
     `InitiateCheckout` saem todos ZERO com a pagina funcionando perfeitamente.
     Um gate assim nao mede o pixel: ele reprova o pixel sempre, ou — pior, se
     alguem inverter a asserção para calar o ruido — aprova sempre. Entao esta
     secao abre o seu proprio Chrome com janela, mede, e fecha.

     Grava lead, entao so contra o local. */
  if(BASE.indexOf('127.0.0.1')!==-1||BASE.indexOf('localhost')!==-1){
   const bj=await puppeteer.launch({headless:false,executablePath:CH,
     args:['--window-size=430,900','--window-position=0,0']});
   for(const caminho of ['presencial','online']){
    const f=await bj.newPage();
    const errosF=[]; f.on('pageerror',e=>errosF.push(e.message));
    const eventos=[]; let marco='perguntas';
    f.on('request',r=>{ const u=r.url();
      if(u.indexOf('facebook.com/tr')!==-1){
        try{ const ev=new URL(u).searchParams.get('ev'); if(ev) eventos.push(marco+':'+ev); }catch(e){}
      }});
    await f.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
    const dizOkF=m=>console.log('ok     fluxo/'+caminho+'  '+m);
    const dizMalF=m=>{ console.log('FALHA  fluxo/'+caminho+'  '+m); falhas++; };
    try{
      await f.goto(BASE+'/inscricao-presencial?utm_source=gate&utm_campaign=layout',{waitUntil:'networkidle2'});
      /* rola ate o elemento antes de tocar: `tap` usa coordenada de VIEWPORT,
         entao um botao abaixo da dobra receberia o toque no lugar errado — e o
         gate reportaria "o botao nao faz nada" por culpa do proprio gate. */
      const toca=async sel=>{
        await f.waitForSelector(sel,{visible:true,timeout:8000});
        const el=await f.$(sel);
        await f.evaluate(e=>e.scrollIntoView({block:'center'}),el);
        await new Promise(r=>setTimeout(r,200));
        const bx=await el.boundingBox();
        await f.touchscreen.tap(bx.x+bx.width/2,bx.y+bx.height/2);
        await new Promise(r=>setTimeout(r,300));
      };
      const digita=async(sel,v)=>{ await f.waitForSelector(sel,{visible:true}); await f.type(sel,v,{delay:6}); };
      const marca=(nome,valor)=>toca('input[name="'+nome+'"][value="'+valor+'"] + .marca');

      await toca('#comecar');
      await digita('#f-nome','Gate Fluxo '+caminho);
      await toca('#avancar');
      await digita('#f-cidade','Pouso Alegre');

      /* o combo de estado (02/09/2026), pelo teclado e sem acento */
      await digita('#f-estado-busca','sao paulo');
      await new Promise(r=>setTimeout(r,320));
      const combo=await f.evaluate(()=>({
        aberto:document.getElementById('f-estado-busca').getAttribute('aria-expanded'),
        n:document.querySelectorAll('#lista-estados .combo__op').length,
        ativo:document.getElementById('f-estado-busca').getAttribute('aria-activedescendant')}));
      (combo.aberto==='true'&&combo.n===1&&combo.ativo==='uf-SP')
        ? dizOkF('o combo de estado acha "sao paulo" sem acento e marca a opcao')
        : dizMalF('o combo de estado nao filtrou: '+JSON.stringify(combo));
      await f.keyboard.press('Enter');
      await new Promise(r=>setTimeout(r,280));
      const dep=await f.evaluate(()=>({
        escrito:document.getElementById('f-estado-busca').value,
        enviado:document.getElementById('f-estado').value,
        etapa:([...document.querySelectorAll('.etapa')].find(x=>!x.hidden)||{getAttribute:()=>null}).getAttribute('data-etapa')}));
      (dep.enviado==='SP'&&dep.escrito==='São Paulo')
        ? dizOkF('Enter escolhe o estado e manda a sigla ('+dep.escrito+' -> '+dep.enviado+')')
        : dizMalF('Enter no combo nao escolheu: '+JSON.stringify(dep));
      /* 🔴 Enter escolhendo o estado nao pode pular a pergunta junto. */
      dep.etapa==='2'
        ? dizOkF('e NAO pula para a pergunta seguinte no mesmo toque')
        : dizMalF('Enter no combo pulou para a etapa '+dep.etapa+' — falta stopPropagation');

      await toca('#avancar');
      await digita('#f-telefone','35997164668');
      await toca('#avancar');
      await digita('#f-instagram','@gate_fluxo');
      await toca('#avancar');
      await marca('situacao','outra-area');
      await marca('faixa_idade','25-34');
      await toca('#avancar');
      await marca('meta_renda','2k-5k');
      await marca('quando_comecar','agora');
      await toca('#avancar');
      await toca('#avancar');                        /* objetivo e opcional */
      await marca('disponibilidade', caminho==='online'?'nao':'sim');
      await toca('#avancar');
      await marca('prefere_formato', caminho==='online'?'online':'presencial');
      await toca('#avancar');
      await marca('faixa_investimento', caminho==='online'?'ate-500':'acima-2000');

      marco='antes-do-clique';
      await toca('#avancar');                        /* pede a recomendacao */
      await new Promise(r=>setTimeout(r,2400));

      const t2=await f.evaluate(()=>{
        const vis=el=>!!el&&!el.hidden&&el.getBoundingClientRect().height>0;
        const cta=document.getElementById('rec-cta'), cnf=document.getElementById('rec-confirmar');
        return {rec:vis(document.getElementById('recomendacao')),
                obr:vis(document.getElementById('obrigado')),
                nome:(document.getElementById('rec-nome')||{}).textContent||'',
                preco:(document.getElementById('rec-preco')||{}).textContent||'',
                cta:vis(cta), cnf:vis(cnf), exc:vis(document.getElementById('rec-exclusivo')),
                rolagem:Math.round(window.scrollY)};
      });

      (t2.rec&&!t2.obr) ? dizOkF('a tela da recomendacao abre, e a do "recebido" NAO')
        : dizMalF('as telas trocaram de lugar (recomendacao '+t2.rec+', recebido '+t2.obr+')');
      (t2.nome&&t2.preco) ? dizOkF('e mostra o produto e o preco ('+t2.nome+' / '+t2.preco+')')
        : dizMalF('a recomendacao abriu VAZIA (nome "'+t2.nome+'", preco "'+t2.preco+'")');
      t2.rolagem===0 ? dizOkF('a tela comeca no topo dela')
        : dizMalF('a tela nasceu rolada em '+t2.rolagem+'px — a recomendacao fica acima da dobra sem ninguem ver');

      /* 🔴 EXATAMENTE UM botao visivel. No presencial ja foi ZERO. */
      const quantos=(t2.cta?1:0)+(t2.cnf?1:0);
      quantos===1
        ? dizOkF('exatamente um botao de garantir a vaga na tela ('+(t2.cta?'<a> do checkout':'<button> de confirmar')+')')
        : dizMalF('havia '+quantos+' botoes visiveis (a='+t2.cta+' button='+t2.cnf+') — no presencial ja ficou ZERO');
      if(caminho==='presencial'){
        (t2.cnf&&!t2.cta) ? dizOkF('o presencial recebe o botao que CONFIRMA, sem link de pagamento')
          : dizMalF('o presencial nao recebeu o botao certo');
        t2.exc ? dizOkF('e a caixa de turma pequena aparece')
          : dizMalF('a caixa de turma pequena nao apareceu no presencial');
      } else {
        (t2.cta&&!t2.cnf) ? dizOkF('o online recebe o <a> que leva ao checkout')
          : dizMalF('o online nao recebeu o link do checkout');
        !t2.exc ? dizOkF('e a caixa de turma pequena NAO aparece (e coisa do presencial)')
          : dizMalF('a caixa de turma pequena vazou para o caminho online');
      }

      /* 🔴 NENHUM Lead pode ter saido ate aqui. */
      const leadsAntes=eventos.filter(e=>/:Lead$|:Lead_/.test(e));
      leadsAntes.length===0
        ? dizOkF('🔴 nenhum Lead disparou antes do clique (so ViuRecomendacao)')
        : dizMalF('🔴 o Lead saiu ANTES do clique ('+leadsAntes.join(', ')+') — a campanha aprenderia a trazer quem so olha o preco');
      eventos.some(e=>e.indexOf('ViuRecomendacao')!==-1)
        ? dizOkF('o ViuRecomendacao saiu na tela da recomendacao')
        : dizMalF('o ViuRecomendacao nao saiu — perdemos a medida de quem viu o preco');

      /* o toque, com o dedo */
      marco='no-clique';
      const alvo=t2.cta?'#rec-cta':'#rec-confirmar';
      const el=await f.$(alvo);
      if(!el){ dizMalF('nao ha botao nenhum para tocar na tela da recomendacao'); }
      else {
        const cx=await f.evaluate(e=>{const r=e.getBoundingClientRect();return {h:Math.round(r.height)};},el);
        cx.h>=44 ? dizOkF('o botao tem '+cx.h+'px de altura (minimo de alvo de dedo: 44)')
          : dizMalF('o botao tem so '+cx.h+'px — alvo de toque menor que 44px');
        await f.evaluate(e=>e.scrollIntoView({block:'center'}),el);
        await new Promise(r=>setTimeout(r,240));
        const bx=await el.boundingBox();
        await f.touchscreen.tap(bx.x+bx.width/2,bx.y+bx.height/2);
        await new Promise(r=>setTimeout(r,2800));

        const leadsDepois=eventos.filter(e=>e.indexOf('no-clique:Lead')===0);
        leadsDepois.length>0
          ? dizOkF('🔴 e o Lead sai NO CLIQUE ('+leadsDepois.join(', ')+')')
          : dizMalF('🔴 o Lead NAO saiu no clique — a campanha ficaria sem conversao para otimizar');

        if(caminho==='presencial'){
          const t3=await f.evaluate(()=>{
            const vis=el=>!!el&&!el.hidden&&el.getBoundingClientRect().height>0;
            return {obr:vis(document.getElementById('obrigado')),
                    rec:vis(document.getElementById('recomendacao')),
                    titulo:((document.querySelector('#obrigado h2')||{}).textContent||'').trim()};
          });
          (t3.obr&&!t3.rec) ? dizOkF('o clique leva a tela do recebido ('+t3.titulo+')')
            : dizMalF('o clique nao abriu a tela do recebido (recebido '+t3.obr+', recomendacao '+t3.rec+')');
        } else {
          const url=f.url();
          url.indexOf('pay.kiwify')!==-1 ? dizOkF('o clique leva ao checkout Kiwify')
            : dizMalF('o clique nao levou ao checkout (parou em '+url.slice(0,80)+')');
          url.indexOf('utm_source=gate')!==-1
            ? dizOkF('e a decoracao de UTM sobreviveu (a venda entra na Kiwify com origem)')
            : dizMalF('o checkout perdeu os utm_* — a venda entraria sem origem nenhuma');
          eventos.some(e=>e.indexOf('no-clique:InitiateCheckout')===0)
            ? dizOkF('e o InitiateCheckout dispara no clique')
            : dizMalF('o InitiateCheckout nao disparou no caminho do checkout');
        }
      }
    }catch(e){
      dizMalF('o fluxo travou: '+(e&&e.message));
    }
    if(errosF.length){ errosF.forEach(x=>console.log('FALHA  fluxo/'+caminho+'  erro de JS: '+x)); falhas+=errosF.length; }
    else console.log('ok     fluxo/'+caminho+'  nenhum erro de JS no formulario');
    await f.close();
   }
   await bj.close();
  } else {
    console.log('aviso  fluxo da recomendacao nao exercitado (grava lead) — rode contra o local');
  }

  await b.close();
  console.log(falhas? '\n'+falhas+' VAZAMENTO(S) DE CAIXA.' : '\nLayout: nenhuma caixa vaza.');
  /* 🔴 MARCADOR DE FIM, lido pelo `verificar-pv.sh`.
     Contar linhas "FALHA" nao distingue "mediu tudo e achou 8 problemas" de
     "mediu um terco, achou 8 e morreu". Sem uma marca de que o verificador
     CHEGOU AO FIM, uma corrida truncada com pelo menos uma falha passa como se
     tivesse medido tudo — foi o buraco que sobrou do conserto anterior. */
  console.log('FIM-LAYOUT truncado=0 falhas=' + falhas);
  process.exit(falhas?1:0);
})().catch((e) => {
  console.log('FALHA  o verificador de layout ABORTOU: ' + (e && e.message));
  console.log(e && e.stack ? String(e.stack).split('\n').slice(0,4).join('\n') : '');
  console.log('FIM-LAYOUT truncado=1 falhas=?');
  process.exit(3);
});

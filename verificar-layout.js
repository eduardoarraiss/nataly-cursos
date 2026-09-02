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

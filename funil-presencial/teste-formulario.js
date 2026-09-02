/* O formulário num Chrome de verdade: validação, foco, máscara, rascunho,
   navegação pelas setas, teclado, a ÁRVORE DE DECISÃO e as duas telas finais.
   Duas passadas, porque o caminho muda de tamanho conforme a resposta:
     · quem NÃO é lash percorre 10 perguntas e termina num presencial;
     · quem JÁ é lash percorre 11 (a condicional entra) e, se pedir online,
       termina numa tela COM botão de checkout.
   Uso: node funil-presencial/teste-formulario.js [base] */
const P='/Users/eduardoarrais/Documents/HAUS/cases-apresentacao/node_modules/puppeteer';
const CH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE=(process.argv[2]||'http://127.0.0.1:3999')+'/inscricao-presencial';
const puppeteer=require(P);
let F=0,T=0;
const ok=(n,c,e)=>{T++; if(c) console.log('ok     '+n); else {F++; console.log('FALHA  '+n+(e?'  → '+e:''));}};
const pausa=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const b=await puppeteer.launch({headless:'new',executablePath:CH});
  const p=await b.newPage();
  await p.setViewport({width:390,height:844});
  const erros=[]; p.on('pageerror',e=>erros.push(e.message));
  await p.goto(BASE,{waitUntil:'networkidle2'});

  // ---- abertura ----
  let s=await p.evaluate(()=>({
    abertura:!document.querySelector('.etapa[data-etapa="0"]').hidden,
    formEscondido:document.getElementById('insc-form').hidden,
    barra:document.getElementById('barra').style.width,
    subirEscondido:document.getElementById('subir').hidden,
    foto:!!document.querySelector('.abertura__foto'),
    fotoSrc:(document.querySelector('.abertura__foto')||{}).getAttribute&&document.querySelector('.abertura__foto').getAttribute('src')
  }));
  ok('abre na tela de boas-vindas', s.abertura===true);
  ok('o formulário começa escondido', s.formEscondido===true);
  ok('a barra começa vazia', s.barra==='0%', s.barra);
  ok('não dá para voltar da abertura', s.subirEscondido===true);
  ok('TEM a foto da Nataly', s.foto===true);
  ok('é a foto certa', /nataly/.test(s.fotoSrc||''), s.fotoSrc);

  // ---- comecar ----
  await p.click('#comecar'); await pausa(400);
  s=await p.evaluate(()=>({
    n:document.querySelector('.etapa[data-etapa="1"] .n').textContent,
    barra:document.getElementById('barra').style.width,
    foco:document.activeElement.id,
    visiveis:[...document.querySelectorAll('.etapa')].filter(f=>!f.hidden).length
  }));
  ok('vai para a pergunta 1', /Pergunta 1 de 10/.test(s.n), s.n);
  ok('só uma etapa visível', s.visiveis===1, String(s.visiveis));
  ok('a barra anda para 10%', s.barra==='10%', s.barra);
  ok('o foco vai para o campo', s.foco==='f-nome', s.foco);

  // ---- validacao ----
  await p.click('#avancar'); await pausa(250);
  s=await p.evaluate(()=>({
    erro:document.getElementById('e-nome').hidden?null:document.getElementById('e-nome').textContent,
    n:document.querySelector('.etapa[data-etapa="1"]').hidden,
    foco:document.activeElement.id,
    inv:document.getElementById('f-nome').getAttribute('aria-invalid')
  }));
  ok('etapa vazia não avança', s.n===false);
  ok('a mensagem de erro é útil', /nome/i.test(s.erro||''), s.erro);
  ok('o foco vai para o campo com erro', s.foco==='f-nome', s.foco);
  ok('marca aria-invalid', s.inv==='true');

  await p.type('#f-nome','Renata Oliveira Dias'); await pausa(200);
  s=await p.evaluate(()=>({e:document.getElementById('e-nome').hidden,
                           i:document.getElementById('f-nome').getAttribute('aria-invalid')}));
  ok('o erro some assim que corrige', s.e===true);
  ok('aria-invalid é removido', s.i===null);

  // ---- Enter avanca ----
  await p.focus('#f-nome'); await p.keyboard.press('Enter'); await pausa(350);
  s=await p.evaluate(()=>({n:document.querySelector('.etapa[data-etapa="2"]').hidden,foco:document.activeElement.id}));
  ok('Enter avança', s.n===false);
  ok('o foco segue para o próximo campo', s.foco==='f-cidade', s.foco);

  // ---- seta de voltar preserva ----
  await p.click('#subir'); await pausa(350);
  s=await p.evaluate(()=>({v:document.getElementById('f-nome').value,
                           n:document.querySelector('.etapa[data-etapa="1"]').hidden}));
  ok('o botão de voltar leva uma etapa atrás', s.n===false);
  ok('voltar não perde o que digitou', s.v==='Renata Oliveira Dias', s.v);

  // ---- mascara ----
  await p.click('#avancar'); await pausa(300);
  await p.type('#f-cidade','Itajubá'); await p.type('#f-estado','mg');
  await p.click('#avancar'); await pausa(300);
  await p.type('#f-telefone','35998887766');
  s=await p.evaluate(()=>({v:document.getElementById('f-telefone').value,
                           im:document.getElementById('f-telefone').getAttribute('inputmode')}));
  ok('a máscara formata o telefone', s.v==='(35) 99888-7766', s.v);
  ok('teclado numérico no celular', s.im==='numeric');

  // ---- rascunho sobrevive ao refresh ----
  await pausa(400);
  await p.reload({waitUntil:'networkidle2'}); await pausa(600);
  s=await p.evaluate(()=>({nome:document.getElementById('f-nome').value,
                           cid:document.getElementById('f-cidade').value,
                           tel:document.getElementById('f-telefone').value,
                           etapa:[...document.querySelectorAll('.etapa')].find(f=>!f.hidden).getAttribute('data-etapa')}));
  ok('RASCUNHO sobrevive ao refresh (nome)', s.nome==='Renata Oliveira Dias', s.nome);
  ok('rascunho sobrevive (cidade)', s.cid==='Itajubá', s.cid);
  ok('rascunho sobrevive (telefone)', s.tel==='(35) 99888-7766', s.tel);
  ok('volta na etapa em que parou', s.etapa==='3', s.etapa);

  // ---- ate o fim ----
  await p.click('#avancar'); await pausa(300);
  await p.type('#f-instagram','@renata.lashes');
  await p.click('#avancar'); await pausa(300);
  await p.click('input[name="situacao"][value="outra-area"]');
  await p.click('input[name="faixa_idade"][value="25-34"]');
  await p.click('#avancar'); await pausa(300);
  await p.click('input[name="meta_renda"][value="2k-5k"]');
  await p.click('input[name="quando_comecar"][value="agora"]');
  await p.click('#avancar'); await pausa(300);
  await p.type('#f-objetivo','Quero sair do meu emprego e viver disso');
  await p.click('#avancar'); await pausa(300);
  s=await p.evaluate(()=>document.querySelector('.etapa[data-etapa="8"] .q').textContent);
  ok('etapa 8 é a de Cambuí', /Cambuí/.test(s), s.slice(0,50));
  await p.click('input[name="disponibilidade"][value="sim"]');
  await p.click('#avancar'); await pausa(400);

  // ---- quem NAO e lash PULA a condicional ----
  s=await p.evaluate(()=>({
    existe:!!document.querySelector('.etapa[data-etapa="5.5"]'),
    vis:document.querySelector('.etapa[data-etapa="5.5"]')
        ? !document.querySelector('.etapa[data-etapa="5.5"]').hidden : null
  }));
  ok('a pergunta condicional EXISTE no HTML', s.existe===true);
  ok('mas quem nao e lash nunca a ve', s.vis===false);

  // ---- a preferencia de formato vem ANTES do dinheiro ----
  s=await p.evaluate(()=>({
    vis:!document.querySelector('.etapa[data-etapa="9"]').hidden,
    q:document.querySelector('.etapa[data-etapa="9"] .q').textContent
  }));
  ok('depois de Cambui vem a PREFERENCIA, nao o preco', s.vis===true);
  ok('e ela pergunta como prefere aprender', /prefere aprender/.test(s.q), s.q.slice(0,60));

  await p.click('input[name="prefere_formato"][value="presencial"]');
  await p.click('#avancar'); await pausa(350);

  // ---- a etapa do investimento: A FAIXA DELA, sem preco nosso ----
  s=await p.evaluate(()=>{
    const et=document.querySelector('.etapa[data-etapa="10"]');
    return {
      vis:!et.hidden,
      n:et.querySelector('.n').textContent,
      txt:et.textContent,
      opcoes:et.querySelectorAll('input[name="faixa_investimento"]').length,
      barra:document.getElementById('barra').style.width,
      botao:document.getElementById('avancar').textContent
    };
  });
  ok('a ultima etapa e a do investimento', s.vis===true);
  ok('diz que e a ultima, de 10', /Pergunta 10 de 10 · a última/.test(s.n), s.n);
  ok('oferece as cinco faixas', s.opcoes===5, String(s.opcoes));
  ok('a barra chega a 100%', s.barra==='100%', s.barra);
  ok('o botao promete a recomendacao', /indico/.test(s.botao), s.botao);
  /* 🔴 O CHECK QUE SUSTENTA O PEDIDO INTEIRO: nesta tela ela nao pode ver
     preco NENHUM dos nossos quatro produtos. Se um numero vazar para ca, ele
     vaza igual para as quatro rotas da arvore — ou seja, mente para a maioria. */
  ok('NENHUM preco nosso aparece na etapa do investimento',
     !/297|497|1\.497|1\.997/.test(s.txt), (s.txt.match(/R\$[^<]{0,14}/g)||[]).join(' | '));

  await p.click('input[name="faixa_investimento"][value="500-1500"]');
  await p.click('#avancar');
  await pausa(2500);

  // ---- tela final PRESENCIAL: recomenda o combo e NAO da checkout ----
  s=await p.evaluate(()=>({
    fim:!document.getElementById('obrigado').hidden,
    form:document.getElementById('insc-form').hidden,
    nome:document.getElementById('nome-fim').textContent,
    txt:document.getElementById('obrigado').textContent,
    rec:!document.getElementById('rec').hidden,
    produto:document.getElementById('rec-nome').textContent,
    preco:document.getElementById('rec-preco').textContent,
    parcela:document.getElementById('rec-parcela').textContent,
    porque:document.getElementById('rec-porque').textContent,
    itens:document.querySelectorAll('#rec-inclui li').length,
    ctaEscondido:document.getElementById('rec-cta').hidden,
    nota:document.getElementById('rec-nota').textContent,
    extraEscondido:document.getElementById('rec-extra').hidden,
    linkKiwify:!!document.querySelector('a[href*="pay.kiwify"]'),
    produtoJs:JSON.stringify(window.NR_PRODUTO||null),
    rascunho:localStorage.getItem('nr_insc_presencial_v2')
  }));
  ok('a tela final aparece', s.fim===true);
  ok('o formulario some', s.form===true);
  ok('chama pelo primeiro nome', s.nome==='Renata', s.nome);
  ok('diz qual e a opcao ideal', /opção ideal para você/.test(s.txt));
  ok('a recomendacao aparece', s.rec===true);
  ok('recomenda o combo presencial', /online \+ presencial/.test(s.produto), s.produto);
  ok('mostra o preco DESSE produto', s.preco==='R$ 1.497', s.preco);
  ok('e o parcelamento DESSE produto', /154,82/.test(s.parcela), s.parcela);
  ok('explica por que, na voz da Nataly', s.porque.length>30, s.porque.slice(0,60));
  ok('lista o que esta incluso', s.itens>=5, String(s.itens));
  ok('🔴 NAO da checkout no presencial', s.ctaEscondido===true);
  ok('e nao ha link da Kiwify na pagina', s.linkKiwify===false);
  ok('explica que a data vem antes do pagamento', /combina a data/.test(s.nota), s.nota.slice(0,70));
  ok('nao menciona presencial (ela ja recebeu o presencial)', s.extraEscondido===true);
  ok('diz em quanto tempo a Nataly responde', /24 horas/.test(s.txt));
  ok('da o WhatsApp da Nataly', /99716-4668/.test(s.txt));
  ok('o produto assume os eventos', /profissao-lash-presencial/.test(s.produtoJs), s.produtoJs);
  ok('o rascunho e apagado', s.rascunho===null);
  ok('nenhum erro de JS', erros.length===0, erros.join(' | '));

  await p.close();

  // ============================================================
  // SEGUNDA PASSADA — quem JA E LASH: a condicional entra na fila,
  // o total vira 11, e o caminho online termina COM checkout.
  // ============================================================
  console.log('\n-- 2a passada: quem ja trabalha com cilios, pedindo online --');
  const p2=await b.newPage();
  await p2.setViewport({width:390,height:844});
  const erros2=[]; p2.on('pageerror',e=>erros2.push(e.message));
  await p2.goto(BASE,{waitUntil:'networkidle2'});

  await p2.click('#comecar'); await pausa(300);
  await p2.type('#f-nome','Carla Menezes'); await p2.click('#avancar'); await pausa(250);
  await p2.type('#f-cidade','Cambuí'); await p2.type('#f-estado','MG');
  await p2.click('#avancar'); await pausa(250);
  await p2.type('#f-telefone','35997776655'); await p2.click('#avancar'); await pausa(250);
  await p2.type('#f-instagram','@carla.lash'); await p2.click('#avancar'); await pausa(250);

  await p2.click('input[name="situacao"][value="ja-lash"]');
  await p2.click('input[name="faixa_idade"][value="25-34"]');
  await p2.click('#avancar'); await pausa(350);

  s=await p2.evaluate(()=>{
    const et=document.querySelector('.etapa[data-etapa="5.5"]');
    return {vis:!et.hidden, n:et.querySelector('.n').textContent,
            q:et.querySelector('.q').textContent,
            opcoes:[...et.querySelectorAll('input[name="busca"]')].map(i=>i.value)};
  });
  ok('quem ja e lash RECEBE a pergunta condicional', s.vis===true);
  ok('ela pergunta o que a pessoa busca', /está buscando agora/.test(s.q), s.q.slice(0,60));
  ok('com as tres saidas da arvore',
     s.opcoes.join(',')==='aperfeicoar-cilios,tecnica-led,nao-sei', s.opcoes.join(','));
  ok('e o total sobe para 11', /de 11/.test(s.n), s.n);

  await p2.click('input[name="busca"][value="tecnica-led"]');
  await p2.click('#avancar'); await pausa(300);
  await p2.click('input[name="meta_renda"][value="5k-10k"]');
  await p2.click('input[name="quando_comecar"][value="agora"]');
  await p2.click('#avancar'); await pausa(300);
  await p2.click('#avancar'); await pausa(300);             /* objetivo e opcional */
  await p2.click('input[name="disponibilidade"][value="sim"]');
  await p2.click('#avancar'); await pausa(300);
  /* Ela PODE vir, mas pede online. A preferencia dela tem de ganhar do
     dinheiro e da distancia — e por isso que essa pergunta existe. */
  await p2.click('input[name="prefere_formato"][value="online"]');
  await p2.click('#avancar'); await pausa(300);
  await p2.click('input[name="faixa_investimento"][value="acima-2000"]');
  await p2.click('#avancar'); await pausa(2500);

  s=await p2.evaluate(()=>({
    produto:document.getElementById('rec-nome').textContent,
    preco:document.getElementById('rec-preco').textContent,
    ctaEscondido:document.getElementById('rec-cta').hidden,
    href:document.getElementById('rec-cta').getAttribute('href'),
    nota:document.getElementById('rec-nota').textContent,
    passo3:(document.getElementById('passo-3')||{}).hidden,
    produtoJs:JSON.stringify(window.NR_PRODUTO||null)
  }));
  ok('pode vir mas pediu online → recebe o LED ONLINE', /Método LED — online/.test(s.produto), s.produto);
  ok('com o preco do LED online', s.preco==='R$ 297', s.preco);
  ok('🔴 o checkout APARECE no caminho online', s.ctaEscondido===false);
  ok('e e o checkout DESTE produto (FfyBeg0)', /FfyBeg0/.test(s.href||''), s.href);
  ok('nao promete combinar data (nao ha pratica a marcar)', s.passo3===true);
  ok('o valor certo assume os eventos', /"value":297/.test(s.produtoJs), s.produtoJs);
  ok('nenhum erro de JS na 2a passada', erros2.length===0, erros2.join(' | '));

  await b.close();
  console.log('\n'+(F?F+' FALHA(S) de '+T:'TUDO CERTO — '+T+' checagens'));
  process.exit(F?1:0);
})();

/* As 9 etapas do formulário num Chrome de verdade: validação, foco, máscara,
   rascunho, navegação pelas setas, teclado e envio.
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
  ok('vai para a pergunta 1', /Pergunta 1 de 9/.test(s.n), s.n);
  ok('só uma etapa visível', s.visiveis===1, String(s.visiveis));
  ok('a barra anda para 11%', s.barra==='11%', s.barra);
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

  // ---- a etapa do preco ----
  s=await p.evaluate(()=>({
    vis:!document.querySelector('.etapa[data-etapa="9"]').hidden,
    n:document.querySelector('.etapa[data-etapa="9"] .n').textContent,
    valor:document.querySelector('.valor__n').textContent,
    parcela:document.querySelector('.valor__p').textContent,
    itens:document.querySelectorAll('.valor__l li').length,
    barra:document.getElementById('barra').style.width,
    botao:document.getElementById('avancar').textContent,
  }));
  ok('a última etapa é a do investimento', s.vis===true);
  ok('diz que é a última', /última/.test(s.n), s.n);
  ok('mostra o valor', s.valor.indexOf('1.497')!==-1, s.valor);
  ok('mostra o parcelamento', s.parcela.indexOf('154,82')!==-1, s.parcela);
  ok('lista o que está incluso', s.itens===8, String(s.itens));
  ok('a barra chega a 100%', s.barra==='100%', s.barra);
  ok('o botão vira Enviar', /Enviar/.test(s.botao), s.botao);

  await p.click('input[name="aceita_valor"][value="preciso-parcelar"]');
  await p.click('#avancar');
  await pausa(2500);

  s=await p.evaluate(()=>({
    fim:!document.getElementById('obrigado').hidden,
    form:document.getElementById('insc-form').hidden,
    nome:document.getElementById('nome-fim').textContent,
    txt:document.getElementById('obrigado').textContent,
    rascunho:localStorage.getItem('nr_insc_presencial')
  }));
  ok('a tela de agradecimento aparece', s.fim===true);
  ok('o formulário some', s.form===true);
  ok('chama pelo primeiro nome', s.nome==='Renata', s.nome);
  ok('diz em quanto tempo a Nataly responde', /24 horas/.test(s.txt));
  ok('dá o WhatsApp da Nataly', /99716-4668/.test(s.txt));
  ok('o rascunho é apagado', s.rascunho===null);
  ok('nenhum erro de JS', erros.length===0, erros.join(' | '));

  await b.close();
  console.log('\n'+(F?F+' FALHA(S) de '+T:'TUDO CERTO — '+T+' checagens'));
  process.exit(F?1:0);
})();

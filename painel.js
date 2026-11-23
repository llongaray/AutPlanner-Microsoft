'use strict';
const $ = selector => document.querySelector(selector);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
let cards = [], config = {}, running = false, cancelled = false, tabId = null, attached = false;
let totals = {cards:0,added:0,existing:0,errors:0};

function log(message) {
  const line = '[' + new Date().toLocaleTimeString('pt-BR') + '] ' + message;
  $('#log').textContent += line + '\n';
  $('#log').scrollTop = $('#log').scrollHeight;
  console.log(line);
}
function status(message) {
  $('#status').textContent = message;
  $('#stats').textContent = totals.cards + ' cards validados · ' + totals.added + ' itens inseridos · ' + totals.existing + ' existentes · ' + totals.errors + ' erros';
}
function selected() {
  return cards.filter(card => document.querySelector('input[data-code="' + CSS.escape(card.code) + '"]')?.checked);
}
function count() {
  const list = selected();
  $('#count').textContent = 'Selecionadas: ' + list.length + ' Stories · ' + list.reduce((sum,card) => sum + card.tasks.length,0) + ' itens previstos';
}
function selectWhere(predicate) {
  for (const card of cards) document.querySelector('input[data-code="' + CSS.escape(card.code) + '"]').checked = predicate(card);
  count();
}
// Os dados são privados: não fazem parte do repositório público.
const validateCards = value => {
  if (!Array.isArray(value) || !value.length || !value.every(c =>
    typeof c.code === 'string' && typeof c.id === 'string' &&
    Array.isArray(c.tasks) && c.tasks.every(t => typeof t === 'string'))) {
    throw Error('cards.json inválido. Esperado: lista com code, id, title e tasks.');
  }
  if (new Set(value.map(c => c.code)).size !== value.length)
    throw Error('cards.json contém códigos duplicados.');
  return value;
};
const validateConfig = value => {
  if (!value || typeof value !== 'object' ||
      !/^https:\/\/planner\.cloud\.microsoft\//.test(value.taskUrlBase || '') ||
      !value.taskUrlBase.endsWith('/task/') || !value.tid) {
    throw Error('config.local.json inválido. Informe taskUrlBase HTTPS terminado em /task/ e tid.');
  }
  return value;
};
async function optionalBundled(filename) {
  try {
    const result = await fetch(chrome.runtime.getURL(filename));
    return result.ok ? await result.json() : null;
  } catch { return null; }
}
async function loadStored() {
  const stored = await chrome.storage.local.get(['cardsData', 'plannerConfig']);
  let loadedCards = stored.cardsData;
  let loadedConfig = stored.plannerConfig;
  if (!loadedCards) loadedCards = await optionalBundled('cards.json');
  if (!loadedConfig) loadedConfig = await optionalBundled('config.local.json');
  return [loadedCards, loadedConfig];
}
function setupStatus(message) {
  $('#setup-status').textContent = message;
  status(message);
}
async function importFiles() {
  if (running) return setupStatus('Não é possível alterar a configuração durante uma execução.');
  const cardsFile = $('#cards-file').files[0];
  const configFile = $('#config-file').files[0];
  if (!cardsFile && !configFile)
    return setupStatus('Selecione cards.json e config.local.json, ou pelo menos o arquivo que falta.');
  try {
    const [previousCards, previousConfig] = await loadStored();
    const parsedCards = cardsFile ? JSON.parse(await cardsFile.text()) : previousCards;
    const parsedConfig = configFile ? JSON.parse(await configFile.text()) : previousConfig;
    cards = validateCards(parsedCards);
    config = validateConfig(parsedConfig);
    await chrome.storage.local.set({cardsData: cards, plannerConfig: config});
    renderCards();
    $('#setup-status').textContent = 'Configuração importada e armazenada neste perfil do Chrome. ' + cards.length + ' cards.';
    $('#cards-file').value = '';
    $('#config-file').value = '';
  } catch (error) {
    setupStatus('Falha ao importar: ' + error.message);
  }
}
function renderCards() {
  $('#list').replaceChildren();
  for (const card of cards) {
    const label = document.createElement('label');
    label.className = 'opt';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.code = card.code;
    checkbox.addEventListener('change', count);
    label.append(checkbox,document.createTextNode(card.code + ' — ' + (card.title||'').replace(/^.*?—\s*/, '') + ' (' + card.tasks.length + ' itens)'));
    $('#list').append(label);
  }
  $('#all').onclick = () => selectWhere(() => true);
  $('#none').onclick = () => selectWhere(() => false);
  $('#run').onclick = run;
  $('#stop').onclick = () => {cancelled = true;status('Interrupção solicitada...');};
  $('#copy').onclick = () => navigator.clipboard.writeText($('#log').textContent);
  selectWhere(() => false);
  status('Configuração carregada. Selecione uma Story para o primeiro teste.');
}
async function init() {
  $('#import').addEventListener('click', importFiles);
  $('#copy').onclick = () => navigator.clipboard.writeText($('#log').textContent);
  $('#setup-status').textContent = 'Carregando configuração local...';
  try {
    const [loadedCards, loadedConfig] = await loadStored();
    if (!loadedCards || !loadedConfig) {
      const missing = [!loadedCards && 'cards.json', !loadedConfig && 'config.local.json'].filter(Boolean).join(' e ');
      return setupStatus('Configuração ausente: ' + missing + '. Importe o(s) arquivo(s) abaixo.');
    }
    cards = validateCards(loadedCards);
    config = validateConfig(loadedConfig);
    renderCards();
    $('#setup-status').textContent = 'Configuração pronta: ' + cards.length + ' cards. Seus dados ficam armazenados localmente neste perfil.';
  } catch (error) {
    setupStatus('Erro na configuração: ' + error.message + '. Reimporte os arquivos.');
  }
}
async function script(fn,args=[]) {
  const results=await chrome.scripting.executeScript({target:{tabId},func:fn,args});
  return results?.[0]?.result;
}
async function cdp(method,params={}) {return chrome.debugger.sendCommand({tabId},method,params);}
function isPlanner(url) {
  try {return ['planner.cloud.microsoft','tasks.office.com'].includes(new URL(url).hostname);} catch {return false;}
}
async function findTab() {
  const tabs=(await chrome.tabs.query({})).filter(t=>isPlanner(t.url));
  if (!tabs.length) throw Error('Abra o Planner em uma aba deste perfil antes de executar.');
  return tabs.find(t=>t.active) || tabs[0];
}
async function navigate(card) {
  const url=config.taskUrlBase+encodeURIComponent(card.id)+'?tid='+encodeURIComponent(config.tid);
  // Altere a URL apenas na mudança de Story. A leitura não deve causar reload.
  const current = await chrome.tabs.get(tabId);
  const sameTask = (() => {
    try {
      const a = new URL(current.url);
      const b = new URL(url);
      return a.origin === b.origin && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '') && a.searchParams.get('tid') === b.searchParams.get('tid');
    } catch { return false; }
  })();
  if (!sameTask) await chrome.tabs.update(tabId,{url,active:true});
  for(let i=0;i<90;i++){
    if(cancelled)throw Error('Interrompido pelo usuário.');
    await sleep(400);
    try {
      const state=await script(inspect,[card.code]);
      if(state?.ready)return state;
    }catch {}
  }
  throw Error(card.code+': não foi possível localizar a checklist do card.');
}
function inspect(code){
  const n=x=>String(x??'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
  const vis=e=>!!e?.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
  const roots=[...document.querySelectorAll('[role="dialog"],[aria-modal="true"],main')].filter(vis);
  const root=roots.find(e=>n(e.textContent).includes(n(code)))||document.body;
  const headings=[...root.querySelectorAll('h1,h2,h3,[role="heading"],input,textarea')].filter(vis).map(e=>n(e.value||e.textContent));
  const title=headings.some(t=>t.includes(n(code)))||[...root.querySelectorAll('div,span')].filter(e=>vis(e)&&!e.children.length).some(e=>n(e.textContent).startsWith(n(code)));
  const checklist=[...root.querySelectorAll('div,span,label,h2,h3')].filter(vis).some(e=>n(e.textContent).includes('lista de verificação')&&n(e.textContent).length<160);
  const texts=[...root.querySelectorAll('input,textarea,[role="checkbox"],label,span,div')].filter(vis).filter(e=>!e.children.length||e.matches('input,textarea')).map(e=>n(e.value||e.textContent)).filter(Boolean);
  return{ready:!!title&&!!checklist,texts};
}
const exists=(scan,item)=>scan?.texts?.includes(norm(item));
function focusEntry(){
  const n=x=>String(x??'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
  const vis=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const pattern=/adicionar um item|adicionar (uma )?etapa|add (an )?item|new checklist|novo item/i;
  const fields=()=>[...document.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]')].filter(vis);
  const matches=e=>pattern.test([e.placeholder,e.getAttribute('aria-label'),e.getAttribute('data-placeholder')].join(' '));
  let field=fields().find(e=>matches(e)&&!(e.value||e.textContent||'').trim());
  if(!field){
    const targets=[...document.querySelectorAll('span,p,button,div,[role="button"]')].filter(vis).filter(e=>{
      const text=n(e.textContent);
      return text&&text.length<140&&/^(adicionar um item|adicione etapas para concluir esta tarefa.*|adicionar (uma )?etapa|add an item|add checklist item)/.test(text)&&(!e.children.length||e.matches('button,[role="button"]'));
    });
    if(targets.length)targets[targets.length-1].click();
    field=fields().find(e=>matches(e)&&!(e.value||e.textContent||'').trim());
  }
  if(!field)return{ok:false,error:'Campo de adicionar etapa não encontrado.'};
  field.focus();
  const box=field.getBoundingClientRect();
  return{ok:true,x:box.x,y:box.y};
}
function inspectActive(){
  const el=document.activeElement;
  return{
    label:[el?.getAttribute('placeholder'),el?.getAttribute('aria-label'),el?.getAttribute('data-placeholder')].filter(Boolean).join(' '),
    value:el?.value??el?.textContent??'',
    editable:!!el&&el.matches('input,textarea,[contenteditable="true"],[role="textbox"]')
  };
}
async function click(x,y){
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
}
async function enter(){
  await cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await cdp('Input.dispatchKeyEvent',{type:'char',text:'\r',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
}
async function persisted(card,item){
  for(let attempt=1;attempt<=5;attempt++){
    if(cancelled)throw Error('Interrompido pelo usuário.');
    await sleep(attempt===1?1200:1800);
    // Inspecione a mesma página; nunca reabra o card dentro do polling.
    const fresh=await script(inspect,[card.code]);
    if(exists(fresh,item)){
      if(attempt>1)log(card.code+': item confirmado após leitura '+attempt+'/5');
      return true;
    }
    log(card.code+': aguardando sincronização '+attempt+'/5');
  }
  return false;
}
async function insert(card,item){
  if(exists(await script(inspect,[card.code]),item))return 'existing';
  let field=await script(focusEntry);
  if(!field?.ok){await sleep(500);field=await script(focusEntry);}
  if(!field?.ok)throw Error(field?.error||'Campo de nova etapa não encontrado.');
  await click(Math.round(field.x+40),Math.round(field.y+12));
  await sleep(160);
  const before=await script(inspectActive);
  if(!before?.editable||!/adicionar um item|adicionar (uma )?etapa|add (an )?item|new checklist|novo item/i.test(before.label||''))throw Error('Foco não está no campo de nova etapa.');
  if(norm(before.value)!=='')throw Error('Campo de nova etapa não está vazio; cancelado para evitar sobrescrita.');
  await cdp('Input.insertText',{text:item});
  await sleep(400);
  const after=await script(inspectActive);
  if(norm(after?.value)!==norm(item)){
    if(await persisted(card,item))return 'added';
    throw Error('Texto não foi confirmado, nem persistiu: '+item);
  }
  await enter();
  await sleep(700);
  if(await persisted(card,item))return 'added';
  throw Error('O Planner não confirmou a persistência do item: '+item);
}
async function run(){
  if(running)return;
  const queue=selected();
  if(!queue.length)return status('Selecione pelo menos uma Story.');
  if(!confirm('Atualizar '+queue.length+' Stories? Recomendado testar apenas uma Story primeiro.'))return;
  running=true;cancelled=false;totals={cards:0,added:0,existing:0,errors:0};
  $('#run').disabled=true;$('#stop').disabled=false;$('#progress').value=0;$('#log').textContent='';
  try{
    const tab=await findTab();tabId=tab.id;
    log('Planner encontrado: '+(tab.title||tab.url));
    await chrome.debugger.attach({tabId},'1.3');attached=true;
    await cdp('Input.setIgnoreInputEvents',{ignore:false});
    for(let index=0;index<queue.length;index++){
      if(cancelled)break;
      const card=queue[index];
      status('Processando '+card.code+' ('+(index+1)+'/'+queue.length+')');
      log('Abrindo '+card.code);
      await navigate(card);
      for(let i=0;i<card.tasks.length;i++){
        if(cancelled)break;
        const item=card.tasks[i];
        if(exists(await script(inspect,[card.code]),item)){
          totals.existing++;
          log(card.code+': '+(i+1)+'/'+card.tasks.length+' já existente');
          continue;
        }
        const result=await insert(card,item);
        if(result==='added'){totals.added++;log(card.code+': '+(i+1)+'/'+card.tasks.length+' inserido');}
        else{totals.existing++;log(card.code+': '+(i+1)+'/'+card.tasks.length+' já existente');}
        const scan=await script(inspect,[card.code]);
        if(!exists(scan,item)&&!(await persisted(card,item)))throw Error(card.code+': item não persistiu: '+item);
      }
      if(cancelled)break;
      let final=await script(inspect,[card.code]);
      let missing=card.tasks.filter(item=>!exists(final,item));
      for(let retry=1;missing.length&&retry<=4;retry++){
        log(card.code+': aguardando atualização da lista '+retry+'/4 (sem atualizar página)');
        await sleep(1800);
        final=await script(inspect,[card.code]);
        missing=card.tasks.filter(item=>!exists(final,item));
      }
      if(missing.length)throw Error(card.code+': itens não confirmados: '+missing.join(' | '));
      totals.cards++;
      $('#progress').value=100*totals.cards/queue.length;
      log('SUCESSO '+card.code+': '+card.tasks.length+' itens validados');
    }
    status(cancelled?'Interrompido pelo usuário.':'SUCESSO! '+totals.cards+' Stories validadas; '+totals.added+' itens inseridos.');
    log(cancelled?'Interrompido':'FINALIZADO COM SUCESSO');
  }catch(error){
    totals.errors++;status('ERRO: '+error.message);log('ERRO: '+(error.stack||error.message));
  }finally{
    if(attached){try{await chrome.debugger.detach({tabId});}catch{}attached=false;}
    running=false;$('#run').disabled=false;$('#stop').disabled=true;
  }
}
init().catch(error=>status('Erro de configuração: '+error.message));

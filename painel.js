'use strict';
const $ = selector => document.querySelector(selector);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
const taskText = task => typeof task === 'string' ? task : task.text;
const taskCompleted = task => typeof task !== 'string' && task.completed === true;
let cards = [], config = {}, running = false, cancelled = false, tabId = null, attached = false;
let boardContext = null; // Capturado da aba autenticada, nunca dos placeholders JSON.
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
function configurePrefixSelector() {
  const select = $('#prefix');
  const choices = [...new Set(cards.map(card => card.code.replace(/\d+$/, '')))].sort();
  select.replaceChildren();
  for(const prefix of choices){
    const option=document.createElement('option');
    option.value=prefix;
    option.textContent=prefix;
    select.append(option);
  }
  $('#prefix-all').onclick = () => selectWhere(card=>card.code.startsWith(select.value));
}
// Os dados são privados: não fazem parte do repositório público.
const validateCards = value => {
  if (!Array.isArray(value) || !value.length || !value.every(c =>
    typeof c.code === 'string' && typeof c.id === 'string' &&
    !/SUBSTITUIR|EXEMPLO|PLACEHOLDER|SEU_ID/i.test(c.id) &&
    Array.isArray(c.tasks) && c.tasks.every(t =>
      typeof t === 'string' && t.trim().length > 0 ||
      t && typeof t === 'object' && typeof t.text === 'string' &&
      t.text.trim().length > 0 && (t.completed === undefined || typeof t.completed === 'boolean')))) {
    throw Error('cards.json inválido. Esperado: lista com code, id, title e tasks.');
  }
  if (new Set(value.map(c => c.code)).size !== value.length)
    throw Error('cards.json contém códigos duplicados.');
  for (const card of value) {
    if (new Set(card.tasks.map(x => norm(taskText(x)))).size !== card.tasks.length)
      throw Error(card.code + ': checklist com itens duplicados no JSON.');
  }
  return value;
};
const validateConfig = value => {
  if (!value || typeof value !== 'object' ||
      !/^https:\/\/planner\.cloud\.microsoft\//.test(value.taskUrlBase || '') ||
      !value.taskUrlBase.endsWith('/task/') ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.tid || '')) {
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
  configurePrefixSelector();
  $('#run').onclick = run;
  $('#stop').onclick = () => {cancelled = true;status('Interrupção solicitada...');};
  $('#copy').onclick = () => navigator.clipboard.writeText($('#log').textContent);
  $('#save-log').onclick = () => {
    const blob=new Blob([$('#log').textContent || 'Nenhum evento.'],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download='aray-planner-relatorio-'+new Date().toISOString().slice(0,10)+'.txt';
    anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  };
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
function boardFromTab(url) {
  const parsed = new URL(url);
  if (parsed.hostname !== 'planner.cloud.microsoft') return null;
  const match = parsed.pathname.match(/^(\/(?:ui\/web|webui(?:\/v1)?)\/plan\/[^/]+\/view\/board)(?:\/task\/[^/]+)?\/?$/);
  if (!match) return null;
  parsed.pathname = match[1];
  parsed.hash = '';
  const tenant = parsed.searchParams.get('tid');
  if (!tenant || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(tenant)) return null;
  return parsed;
}
async function findTab() {
  const tabs = (await chrome.tabs.query({})).filter(t => isPlanner(t.url));
  if (!tabs.length) throw Error('Abra o Planner em uma aba deste perfil antes de executar.');
  const configuredPath=new URL(config.taskUrlBase).pathname;
  const planId=configuredPath.match(/\/plan\/([^/]+)\/view\/board\/task\/$/)?.[1];
  if(!planId) throw Error('config.local.json: endereço do plano não reconhecido.');
  const boards=tabs.filter(t => boardFromTab(t.url) && /\/view\/board(?:\/|$)/.test(new URL(t.url).pathname));
  const candidate=boards.find(t => new URL(t.url).pathname.includes('/plan/'+planId+'/view/board'));
  if(!candidate) throw Error('Nenhuma aba do Plano '+planId+' está aberta em Quadro. Abra o plano correto antes de executar.');
  boardContext = boardFromTab(candidate.url);
  log('Plano autenticado reconhecido pela URL da aba aberta; contexto de tenant validado.');
  return candidate;
}
async function navigate(card) {
  if (!boardContext) throw Error('Contexto de autenticação do Planner não carregado.');
  const target = new URL(boardContext.href);
  target.pathname = boardContext.pathname.replace(/\/$/, '') + '/task/' + encodeURIComponent(card.id);
  // Preservar a query-string da aba já autenticada. NÃO criar tenant fictício.
  const current = await chrome.tabs.get(tabId);
  if (current.url !== target.href) {
    await chrome.tabs.update(tabId, {url:target.href,active:true});
  }
  for (let i=0;i<75;i++) {
    if (cancelled) throw Error('Interrompido pelo usuário.');
    await sleep(400);
    try {
      const view = await script(inspect,[card.code]);
      if (view?.ready) return view;
      if (i >= 4) {
        const diagnostic = await script(() => {
          const t = document.body?.innerText?.trim() || '';
          return t.length < 700 && /TenantId not found|NotFound.*TenantId|tenant.*not found/i.test(t) ? t.slice(0,700) : null;
        });
        if (diagnostic) throw Error('O Planner rejeitou o contexto do tenant. Abra novamente o quadro na sua conta Microsoft 365 e tente outra vez.');
      }
    } catch (error) {
      if (/Planner rejeitou o contexto/.test(error.message)) throw error;
    }
  }
  throw Error(card.code + ': a tarefa não abriu na aba autenticada. Confira se o ID do card pertence a este plano.');
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
  const vis = el => !!el?.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const pattern = /adicionar um item|adicionar (uma )?etapa|add (an )?item|new checklist|novo item/i;
  const fields = () => [...document.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]')].filter(vis);
  const matches = el => pattern.test([
    el.getAttribute('placeholder'),el.getAttribute('aria-label'),el.getAttribute('data-placeholder')
  ].filter(Boolean).join(' '));
  // Cada tentativa deve abandonar a referência anterior: o Planner recria o input via React.
  const inputs = fields();
  inputs.forEach(el => delete el.dataset.arayChecklistEntry);
  let field = inputs.find(el => matches(el) && !(el.value || el.textContent || '').trim());
  if(!field){
    const n = text => String(text||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
    const targets = [...document.querySelectorAll('span,p,button,div,[role="button"]')].filter(vis).filter(el=>{
      const text=n(el.textContent);
      return text && text.length<140 &&
        /^(adicionar um item|adicione etapas para concluir esta tarefa.*|adicionar (uma )?etapa|add an item|add checklist item)/.test(text) &&
        (!el.children.length || el.matches('button,[role="button"]'));
    });
    if(targets.length) targets[targets.length-1].click();
    field = fields().find(el => matches(el) && !(el.value || el.textContent || '').trim());
  }
  if(!field) return {ok:false,error:'Campo vazio de adicionar etapa não encontrado.'};
  field.scrollIntoView({block:'nearest',inline:'nearest'});
  field.dataset.arayChecklistEntry = '1';
  field.focus({preventScroll:true});
  const rect = field.getBoundingClientRect();
  if(rect.width < 5 || rect.height < 5) return {ok:false,error:'Campo de checklist sem dimensões válidas.'};
  return {ok:true,focused:document.activeElement===field,x:rect.x+rect.width/2,y:rect.y+rect.height/2};
}
function inspectActive(){
  const el = document.activeElement;
  return {
    label:[el?.getAttribute('placeholder'),el?.getAttribute('aria-label'),el?.getAttribute('data-placeholder')].filter(Boolean).join(' '),
    value:el?.value ?? el?.textContent ?? '',
    editable:!!el && el.matches('input,textarea,[contenteditable="true"],[role="textbox"]'),
    newChecklistEntry:!!el && el.isConnected && el.dataset.arayChecklistEntry === '1'
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
  if(exists(await script(inspect,[card.code]),item)) return 'existing';
  let ready=false, lastReason='';
  // O DOM da tarefa pode mudar imediatamente após um Enter. O campo é localizado
  // novamente, em vez de reutilizar coordenadas ou referências de um input anterior.
  for(let attempt=1;attempt<=5;attempt++){
    if(cancelled) throw Error('Interrompido pelo usuário.');
    if(exists(await script(inspect,[card.code]),item)) return 'existing';
    await sleep(attempt===1?250:450);
    const entry=await script(focusEntry);
    if(!entry?.ok){lastReason=entry?.error||'campo não encontrado';continue;}
    // O foco por DOM pode bastar. Caso o Planner exija ativação, usa clique CDP no centro real.
    let active=await script(inspectActive);
    if(!active?.newChecklistEntry || !active?.editable){
      await click(Math.round(entry.x),Math.round(entry.y));
      await sleep(200);
      active=await script(inspectActive);
    }
    if(!active?.newChecklistEntry || !active?.editable){
      lastReason='o Planner recriou o campo antes de confirmar o foco';
      log(card.code+': aguardando campo de nova etapa ('+attempt+'/5)');
      continue;
    }
    if(norm(active.value)!==''){
      lastReason='campo de nova etapa não está vazio';
      log(card.code+': foco em campo ocupado; nova tentativa segura ('+attempt+'/5)');
      continue;
    }
    ready=true;
    break;
  }
  if(!ready) throw Error(card.code+': foco não estabilizou após 5 tentativas ('+lastReason+'); nenhum texto foi sobrescrito.');
  await cdp('Input.insertText',{text:item});
  await sleep(450);
  const after=await script(inspectActive);
  if(norm(after?.value)!==norm(item)){
    if(await persisted(card,item)) return 'added';
    throw Error(card.code+': texto do novo item não confirmado, interrupção segura: '+item);
  }
  await enter();
  await sleep(700);
  if(await persisted(card,item)) return 'added';
  throw Error(card.code+': Planner não confirmou a persistência do item: '+item);
}
function locateChecklistCheckbox(item) {
  const normalized = text => String(text || '').normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR');
  const visible = el => !!el?.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const isCheck = el => el.matches('input[type="checkbox"],[role="checkbox"],button[aria-checked]');
  const candidates = [...document.querySelectorAll('span,label,div,p,input,textarea,[contenteditable]')]
    .filter(el => visible(el) && !el.matches('[type="checkbox"]') && normalized(el.value || el.textContent) === normalized(item))
    .sort((a,b) => a.querySelectorAll('*').length-b.querySelectorAll('*').length);
  for (const candidate of candidates) {
    let row = candidate;
    for (let depth=0; depth<6 && row;depth++,row=row.parentElement) {
      const bounds=row.getBoundingClientRect();
      if (bounds.height>125 || bounds.width<150) break;
      const boxes=[...row.querySelectorAll('input[type="checkbox"],[role="checkbox"],button[aria-checked]')].filter(visible);
      if (boxes.length !== 1) continue;
      const checkbox=boxes[0];
      const rect=checkbox.getBoundingClientRect();
      const aria=checkbox.getAttribute('aria-checked');
      const checked=checkbox.matches('input') ? checkbox.checked : (aria === 'true');
      return {found:true,checked:!!checked,x:rect.left+rect.width/2,y:rect.top+rect.height/2};
    }
  }
  return {found:false};
}
async function setNewTaskCompleted(card,text) {
  // Nunca altera tarefas preexistentes. Chamado apenas quando insert() confirmou criação.
  let state=await script(locateChecklistCheckbox,[text]);
  if (!state?.found) throw Error(card.code+': não localizei o checkbox do item novo para marcar como concluído: '+text);
  if (state.checked) return;
  await click(Math.round(state.x),Math.round(state.y));
  for(let i=0;i<5;i++) {
    await sleep(450);
    state=await script(locateChecklistCheckbox,[text]);
    if (state?.found && state.checked) return;
  }
  throw Error(card.code+': o Planner não confirmou a conclusão da Task nova: '+text);
}
function locateCloseButton(code) {
  const normLocal=t=>String(t || '').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
  const vis=el=>!!el?.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  const dialogs=[...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].filter(vis);
  const dialog=dialogs.find(el=>normLocal(el.textContent).includes(normLocal(code)))||dialogs[0];
  if(!dialog) return {found:false,reason:'nenhum diálogo aberto'};
  const box=dialog.getBoundingClientRect();
  const buttons=[...dialog.querySelectorAll('button,[role="button"]')].filter(vis);
  // Preferência: botão Fechar no cabeçalho; nunca usar controles do chat ou do checklist.
  const matches=buttons.filter(el=>{
    const r=el.getBoundingClientRect();
    if(r.top>box.top+110 || r.right<box.right-125) return false;
    const name=[el.getAttribute('aria-label'),el.getAttribute('title'),el.textContent].join(' ').trim();
    return /fechar|close|dismiss/i.test(name) || (!name && !!el.querySelector('svg'));
  }).sort((a,b)=>b.getBoundingClientRect().right-a.getBoundingClientRect().right);
  if(!matches.length) return {found:false,reason:'botão fechar não identificado no cabeçalho'};
  const r=matches[0].getBoundingClientRect();
  return {found:true,x:r.left+r.width/2,y:r.top+r.height/2};
}
async function closeFinishedCard(card) {
  const button=await script(locateCloseButton,[card.code]);
  if(!button?.found) {
    // Evita clicar no controle errado caso o Planner altere o DOM.
    log(card.code+': checklist concluído; feche manualmente o card ('+(button?.reason||'seletor indisponível')+').');
    return false;
  }
  await click(Math.round(button.x),Math.round(button.y));
  for(let i=0;i<6;i++) {
    await sleep(250);
    const view=await script(inspect,[card.code]);
    if(!view?.ready) { log(card.code+': janela do card fechada'); return true; }
  }
  log(card.code+': itens validados, mas não foi possível confirmar o fechamento do card.');
  return false;
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
        const task=card.tasks[i];
        const item=taskText(task);
        if(exists(await script(inspect,[card.code]),item)){
          totals.existing++;
          log(card.code+': '+(i+1)+'/'+card.tasks.length+' já existente');
          continue;
        }
        const result=await insert(card,item);
        if(result==='added'){
          totals.added++;
          log(card.code+': '+(i+1)+'/'+card.tasks.length+' inserido');
          if(taskCompleted(task)) {
            await setNewTaskCompleted(card,item);
            log(card.code+': '+(i+1)+'/'+card.tasks.length+' marcado como concluído');
          }
        }
        else{totals.existing++;log(card.code+': '+(i+1)+'/'+card.tasks.length+' já existente');}
        const scan=await script(inspect,[card.code]);
        if(!exists(scan,item)&&!(await persisted(card,item)))throw Error(card.code+': item não persistiu: '+item);
      }
      if(cancelled)break;
      let final=await script(inspect,[card.code]);
      let missing=card.tasks.filter(task=>!exists(final,taskText(task)));
      for(let retry=1;missing.length&&retry<=4;retry++){
        log(card.code+': aguardando atualização da lista '+retry+'/4 (sem atualizar página)');
        await sleep(1800);
        final=await script(inspect,[card.code]);
        missing=card.tasks.filter(task=>!exists(final,taskText(task)));
      }
      if(missing.length)throw Error(card.code+': itens não confirmados: '+missing.map(taskText).join(' | '));
      totals.cards++;
      $('#progress').value=100*totals.cards/queue.length;
      log('SUCESSO '+card.code+': '+card.tasks.length+' itens validados');
      await closeFinishedCard(card);
    }
    const complete = !cancelled && totals.cards === queue.length;
    status(complete ? 'SUCESSO! '+totals.cards+' Stories validadas; '+totals.added+' itens inseridos.' : 'INTERROMPIDO: '+totals.cards+' de '+queue.length+' Stories validadas.');
    log(complete ? 'FINALIZADO COM SUCESSO' : 'EXECUÇÃO INTERROMPIDA — Stories restantes não processadas');
  }catch(error){
    totals.errors++;status('ERRO: '+error.message);log('ERRO: '+(error.stack||error.message));
  }finally{
    if(attached){try{await chrome.debugger.detach({tabId});}catch{}attached=false;}
    running=false;$('#run').disabled=false;$('#stop').disabled=true;
  }
}
init().catch(error=>status('Erro de configuração: '+error.message));

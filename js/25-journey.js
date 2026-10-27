/* The journey owns visibility and navigation only. Existing form nodes and calculators stay alive. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id),main=$('main'),panels=new Map(),positions={};
  let current='welcome',last='weather',thermal='wall',fd='model',restoring=false,queued=false,signature='',navigation=0,navigating=false,navPosition='';
  const savedModes=new Set();
  const icons={data:'M4 5h6l2 3h8v12H4z M8 12h8 M8 16h5',rooms:'M3 10l9-7 9 7 M5 9v12h14V9 M10 21v-7h4v7',weather:'M12 3v2 M3 12h2 M19 12h2 M5 5l2 2 M17 7l2-2 M8 12a4 4 0 118 0 M5 19h14 M7 16h10',thermal:'M4 4h16v16H4z M8 4v16 M12 4v16 M16 4v16',gains:'M9 18h6 M10 21h4 M8 13a6 6 0 118 0l-1 3H9z',ac:'M3 4h18v9H3z M6 9h12 M7 16v4 M12 16v5 M17 16v4',fd:'M3 5h18v13H3z M8 22h8 M12 18v4 M8 9l4 4 4-4',solver:'M8 5h13 M3 5h1 M8 12h13 M3 12h1 M8 19h13 M3 19h1',list:'M8 5h13 M3 5h1 M8 12h13 M3 12h1 M8 19h13 M3 19h1'};
  const icon=key=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(icons[key]||icons.data)+'"/></svg>';
  const defs=[
    ['data','データ読込','同じ物件の資料を選び、読込結果を確認して反映しましょう。'],
    ['rooms','部屋・形状確認','部屋名・階・窓の位置と、階段・吹き抜けを確認しましょう。'],
    ['weather','日時・気象','いつ・どこで、何℃の室内を調べるかを決めます。'],
    ['thermal','断熱性能','取得済みの性能を使い、足りない部位だけ設定しましょう。'],
    ['gains','部屋の使い方・日射','部屋ごとの人数・家電と、窓から入る日射を確認します。'],
    ['ac','エアコン','負荷に対する台数・風量と、吹出温度を確認します。'],
    ['fd','FD受渡し','モデルと条件CSVを、順番にFlowDesignerへ渡しましょう。'],
    ['solver','解析設定・実行','FlowDesigner側で条件を確認し、解析を開始します。']
  ].map(([key,title,description])=>({key,title,description}));
  const pipeDefs=[['pipeInput','データ読込'],['pipeReview','部屋・形状確認'],['pipeThermal','解析条件'],['pipeRun','IDF保存・SQL取込'],['pipeTime','時刻選択'],['pipeExport','FD用出力']].map(([key,title])=>({key,title,description:'EP → CFD の設定を進めます。入力した条件は各操作で保存・反映してください。'}));
  const coupled=()=>document.body.classList.contains('pipeline-mode');
  function steps(){return coupled()?pipeDefs:defs.filter(s=>appMode!=='manual'||!['data','rooms'].includes(s.key));}
  function section(key){const el=document.createElement('section');el.id='journey-'+key;el.className='journey-screen';el.dataset.journeyScreen=key;el.hidden=true;panels.set(key,el);return el;}
  // Capture each old section as a range of siblings, without cloning controls or rebinding their events.
  const ranges=[['weather','common','step1'],['thermal','step1','step2'],['gains','step2','step3'],['ac','step3','idfmesh'],['fd','idfmesh','step4'],['solver','step4',null]];
  for(const [key,start,end]of ranges){const first=$(start),stop=end?$(end):main.querySelector(':scope > footer'),panel=section(key);first.before(panel);let node=first;while(node&&node!==stop){const next=node.nextSibling;panel.append(node);node=next;}}
  const data=section('data'),rooms=section('rooms');main.prepend(rooms);main.prepend(data);
  const roomEmpty=document.createElement('div');roomEmpty.className='journey-empty';roomEmpty.innerHTML='<h2>先にモデルを読み込みましょう</h2><p>モデルを読み込むと、ここで部屋・階・階段や吹き抜けを確認できます。</p><button type="button" class="journey-primary" data-journey-go="data">データ読込へ</button>';rooms.append(roomEmpty);
  const manual=document.createElement('p');manual.className='journey-empty';manual.textContent='手動入力では、日時・気象から順に設定します。部屋は「部屋の使い方・日射」で追加できます。';data.append(manual);
  const sourcePanels=[$('atPanel'),$('epPanel')];for(const el of sourcePanels)if(el)data.append(el);
  for(const [id,list]of [['atPanel',['atRoomViewer','atFloorReview']],['epPanel',['epRoomViewer']]]){
    const source=$(id),group=document.createElement('div');group.className='journey-source-rooms';source.append(group);list.forEach(name=>{if($(name))group.append($(name));});
    const content=document.createElement('div');content.className='journey-source-data';source.prepend(content);[...source.childNodes].filter(n=>n!==content&&n!==group).forEach(n=>content.append(n));
  }
  const overview=section('overview');main.prepend(overview);overview.append($('requiredSetupGuide'));
  const otherOverview=document.createElement('div');otherOverview.className='journey-other-overview';overview.append(otherOverview);
  const welcome=section('welcome');main.prepend(welcome);
  welcome.innerHTML='<div class="journey-welcome"><div><h1>家のデータから、<br>解析の準備をはじめましょう。</h1><p>資料を読み込み、部屋と条件を確認して、FlowDesignerへ。<br>ひとつずつ進めれば、必要な設定がそろいます。</p><button type="button" class="journey-primary" id="journeyResume" hidden>前回の続きから</button><p id="journeyResumeNote" class="journey-muted"></p></div><svg class="journey-house" viewBox="0 0 300 230" role="img" aria-label="資料・建物・解析条件をFlowDesignerへ渡す工程図"><g fill="none" stroke="#3c7565" stroke-width="2"><path d="M60 120l75-65 75 65v90H60z M135 55v155 M60 150h150 M90 150v60 M170 150v60 M25 42h62v54H25z M35 57h42 M35 69h32 M35 81h22 M225 140h52v42h-52z M251 182v15 M235 197h32 M90 70h22 M210 160h15"/><path d="M100 65l12 5-12 5 M215 155l10 5-10 5"/></g><g fill="#215c48" font-family="sans-serif" font-size="14"><text x="26" y="30">資料</text><text x="110" y="38">部屋・条件</text><text x="233" y="127">FD</text></g></svg></div><div class="journey-entry-block"><h2>1. 解析の進め方を選ぶ</h2><div id="journeyFlowChoices"></div><h2>2. 入力方法を選ぶ</h2><p>今までの入力は、入力方法ごとに保存されています。</p><div id="journeyModeChoices"></div><button type="button" class="journey-primary" id="journeyStart">この方法ではじめる →</button></div>';
  const citations=main.querySelector(':scope > footer');if(citations){const details=document.createElement('details');details.id='journeyReferences';details.className='journey-references';const summary=document.createElement('summary');summary.textContent='計算の出典と前提';details.append(summary,citations);welcome.append(details);}
  $('journeyFlowChoices').append(document.querySelector('.workflow-tabs'));$('journeyModeChoices').append($('modeTabs'));
  $('flowCfd').innerHTML='<b>CFDのみ</b><span>部屋・断熱・空調を設定して、FDへ渡す</span>';
  $('flowCoupled').innerHTML='<b>EP → CFD</b><span>EnergyPlusで計算した結果を、FDへつなぐ</span>';
  const modeDescriptions={manual:'資料の数値を見ながら、自分で入力',architrend:'3DSとCSV・Excel・PDFを使って入力',energyplus:'計算済みのIDF・SQLを使って入力'};
  $('modeTabs').querySelectorAll('[data-mode]').forEach(btn=>{btn.querySelector('.tab-idx')?.remove();const small=document.createElement('small');small.textContent=modeDescriptions[btn.dataset.mode];btn.append(small);});
  $('atRemainInfo').removeAttribute('style');document.querySelector('.header-utils').prepend($('atRemainInfo'));
  const heading=document.createElement('header');heading.id='journeyHeading';heading.className='journey-heading';heading.innerHTML='<div><p id="journeyLocation"></p><h1 id="journeyTitle" tabindex="-1"></h1><p id="journeyDescription"></p></div><div><span id="journeyRequired" role="status"></span><button type="button" data-journey-go="overview">作業一覧を開く</button></div>';main.prepend(heading);
  const footer=document.createElement('footer');footer.id='journeyFooter';footer.className='journey-footer';footer.innerHTML='<nav class="journey-dock-actions" aria-label="前後の工程へ移動"><button type="button" id="journeyBack">← 戻る</button><div class="journey-dock-note"><span>入力は自動保存。反映は各設定のボタンで行います。</span><button type="button" data-journey-go="overview">作業一覧</button></div><button type="button" id="journeyNext" class="journey-primary"></button></nav>';main.append(footer);
  const context=document.createElement('button');context.type='button';context.className='journey-context';context.dataset.journeyGo='welcome';context.textContent='入力方法を確認・変更';document.querySelector('.header-utils').prepend(context);
  const compact=document.createElement('span');compact.id='journeyCompactCurrent';document.querySelector('.header-name').append(compact);document.querySelector('.header-name').href='#journey-welcome';document.querySelector('.header-name').setAttribute('aria-label','CFD Boundary Tool — 入力方法へ');
  // Retain the legacy status nodes: calculators still update them; visible progress is derived below.
  const legacy=document.createElement('div');legacy.hidden=true;legacy.id='journeyLegacyStatus';$('sidenav').querySelectorAll('[id]').forEach(el=>legacy.append(el));main.append(legacy);
  const stepNav=$('sidenav');stepNav.classList.add('journey-step-nav');stepNav.setAttribute('aria-label','解析の工程');main.before(stepNav);
  $('navToggle').hidden=false;$('navBackdrop').hidden=false;
  function measureDock(){if(!footer.hidden)document.documentElement.style.setProperty('--journey-dock-height',Math.ceil(footer.getBoundingClientRect().height)+'px');}
  new ResizeObserver(measureDock).observe(footer);
  function revealStep(button,center=false){
    if(!button)return;const bounds=stepNav.getBoundingClientRect(),item=button.getBoundingClientRect();
    if(item.top<bounds.top+8||item.bottom>bounds.bottom-8)stepNav.scrollTo({top:stepNav.scrollTop+item.top-bounds.top-(bounds.height-item.height)/2,behavior:'instant'});
  }
  let navWidth=0;
  new ResizeObserver(()=>{const width=stepNav.clientWidth;if(width&&width!==navWidth){navWidth=width;revealStep(stepNav.querySelector('[aria-current="step"]'),true);}}).observe(stepNav);
  document.fonts.ready.then(()=>revealStep(stepNav.querySelector('[aria-current="step"]'),true));
  stepNav.addEventListener('keydown',e=>{
    const button=e.target.closest('button[data-journey-go]');if(!button||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
    const buttons=[...stepNav.querySelectorAll('button')],index=buttons.indexOf(button),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1)));
    e.preventDefault();buttons[next].focus({preventScroll:true});revealStep(buttons[next]);
  });
  // Standalone explanations belong to their relevant screen, rather than every screen's preamble.
  ['legendManual','legendAt','legendEp'].forEach(id=>{if($(id))panels.get('weather').prepend($(id));});
  for(const child of [...main.children])if(child.matches('p.desc'))child.hidden=true;
  document.querySelectorAll('.done-label').forEach(el=>el.hidden=true);
  const tabbar=document.createElement('nav');tabbar.className='journey-part-tabs';tabbar.setAttribute('aria-label','断熱の部位');tabbar.innerHTML=[['wall','外壁'],['roof','屋根'],['ceiling','天井・小屋裏'],['other','床・窓・扉と計算条件']].map(([key,label])=>'<button type="button" data-journey-thermal="'+key+'" aria-pressed="false">'+label+'</button>').join('');$('insulationGuide').prepend(tabbar);
  $('insulationGuide').querySelector('.insulation-guide-note').textContent='床・基礎・窓・外部扉は「床・窓・扉と計算条件」で確認できます。屋根と天井の値は区別し、共通する条件を二重に入力せずに使います。';
  const fdbar=document.createElement('nav');fdbar.className='journey-part-tabs journey-fd-tabs';fdbar.setAttribute('aria-label','FD受渡しの順番');fdbar.innerHTML=[['model','1 形状を出力'],['transfer','2 FDで色CSVを取得'],['colors','3 色CSVを読込'],['conditions','4 条件CSVを出力']].map(([key,label])=>'<button type="button" data-journey-fd="'+key+'">'+label+'</button>').join('');panels.get('fd').prepend(fdbar);
  const fdhelp=document.createElement('div');fdhelp.id='journeyFdTransfer';fdhelp.className='journey-fd-help';fdhelp.innerHTML='<h2>FlowDesignerで色対応CSVを取得する</h2><p>対象のFDプロジェクトを開き、出力した形状とパーツを取り込んで確定します。FDのSSLスクリプトから色対応CSVを出力し、次の「色CSVを読込」で選んでください。</p><img src="assets/architrend/workflow.svg" alt="資料を読み込み、部屋と条件を確認してFDへ受け渡す流れ"><p><b>形状や色を変えたら、色対応CSVを取り直してください。</b>別のプロジェクトや古いCSVは使いません。</p><button type="button" data-journey-fd="colors">色CSVを読み込む画面へ →</button>';panels.get('fd').append(fdhelp);
  const fdModel=[$('idfmesh'),$('idfmesh').nextElementSibling],fdConditions=[$('ssl'),$('ssl').nextElementSibling];
  const fdReady=document.createElement('p');fdReady.id='journeyFdReady';fdReady.className='journey-fd-ready';fdConditions[1].querySelector('.stage-work').prepend(fdReady);
  const catRow=$('sslCatInput').closest('.row2'),flowRow=$('sslFlowUnit').closest('.row2'),matRow=$('sslMatWood').closest('.row2'),assign=$('sslAssignWrap'),exportRow=$('sslExportBtn').parentElement;
  for(const el of [catRow,catRow.previousElementSibling,assign,assign.previousElementSibling])el.dataset.journeyFdSection='colors';
  for(const el of [flowRow,matRow,$('sslMatList'),$('sslMatList').nextElementSibling,exportRow,exportRow.previousElementSibling,$('sslWarnList')])el.dataset.journeyFdSection='conditions';
  // Long explanations remain available, but no longer push the first input off the screen.
  window.boundaryInstallVisualGuides?.(panels);
  for(const [key,panel]of panels)panel.querySelectorAll('.stage-guide').forEach((aside,index)=>{const help=document.createElement('details');help.id='journeyHelp-'+key+'-'+index;const summary=document.createElement('summary');summary.textContent=key==='fd'?'FDに取り込む手順・初回の準備':'この工程の見方・補足説明';while(aside.firstChild)help.append(aside.firstChild);help.prepend(summary);aside.append(help);});
  // Keep the gain formulas beside their diagram, rather than a second preamble above the room list.
  const gainHelp=panels.get('gains').querySelector('.stage-guide'),gainDiagram=$('visualGuide-gains')?.querySelector('.task-visual-body>div');
  if(gainHelp&&gainDiagram){gainHelp.querySelector('summary').textContent='計算式・日射補正の補足';gainDiagram.append(gainHelp);}
  const pipeHost=$('pipelinePanel');if(pipeHost)for(const def of pipeDefs){const el=$(def.key);if(el)el.dataset.journeyPipe=def.key;}
  function placeSource(){if(!['welcome','overview'].includes(current)&&!steps().some(s=>s.key===current)){open(steps()[0].key,{focus:false});return;}if(coupled())return;const slot=panels.get(current==='rooms'?'rooms':'data');sourcePanels.forEach(el=>{if(el&&el.parentElement!==slot)slot.append(el);});}
  window.boundaryJourneyPlaceSource=placeSource;
  function resize(){
    window.dispatchEvent(new Event('resize'));
    if(typeof Chart!=='undefined')Object.values(Chart.instances||{}).forEach(chart=>{if(chart.canvas?.getClientRects().length)chart.resize();});
    if(current==='rooms'&&typeof atDrawRoomScene==='function')atDrawRoomScene();
  }
  function applyPart(){
    tabbar.hidden=appMode!=='architrend';
    document.querySelectorAll('[data-journey-thermal]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.journeyThermal===thermal)));
    document.querySelectorAll('[data-insulation-card]').forEach(c=>c.hidden=c.dataset.insulationCard!==thermal);
    panels.get('thermal').dataset.part=appMode==='architrend'?thermal:'other';
  }
  function applyFd(){
    fdbar.querySelectorAll('[data-journey-fd]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.journeyFd===fd)));
    fdModel.forEach(el=>el.hidden=fd!=='model');fdConditions.forEach(el=>el.hidden=!['colors','conditions'].includes(fd));fdhelp.hidden=fd!=='transfer';
    panels.get('fd').dataset.fdPart=fd;
    const count=typeof sslColors!=='undefined'?sslColors.length:0;
    fdReady.textContent=count?'色対応CSV：'+count+'色を読込済み。属性の対応を確認してから、条件CSVを書き出してください。':'先に「3 色CSVを読込」で、対象のFDプロジェクトから出したCSVを選んでください。';
  }
  function keyFor(el){
    if(!el)return null;const screen=el.closest('[data-journey-screen]');if(screen)return screen.dataset.journeyScreen;
    const pipe=el.closest('[data-journey-pipe]');if(pipe)return pipe.dataset.journeyPipe;
    return null;
  }
  function open(key,{focus=true,remember=true,restorePosition=true,startAtTop=false}={}){
    const list=steps();if(!['welcome','overview'].includes(key)&&!list.some(s=>s.key===key))key=list[0].key;
    document.body.dataset.journeyDirection=list.findIndex(s=>s.key===key)<list.findIndex(s=>s.key===current)?'back':'forward';
    const targetY=positions[key]||0,ticket=++navigation;navigating=true;
    if(current!==key){if(remember)positions[current]=window.scrollY;const previous=panels.get(current);if(previous)previous.style.minHeight='';current=key;}
    if(!['welcome','overview'].includes(key))last=key;
    if($('atThermalDialog')?.open)architrendCloseThermal();
    document.body.dataset.journeyCurrent=current;document.body.classList.add('journey-mode');
    placeSource();for(const [name,el]of panels)el.hidden=name!==current;
    // The pipeline keeps its service and data; only the visible section changes.
    if(pipeHost){pipeHost.dataset.journeyActive=String(coupled()&&!['welcome','overview'].includes(current));pipeHost.querySelectorAll('[data-journey-pipe]').forEach(el=>el.classList.toggle('journey-pipe-current',el.dataset.journeyPipe===current));}
    applyPart();applyFd();render();
    document.body.classList.remove('nav-open');$('navToggle')?.setAttribute('aria-expanded','false');
    requestAnimationFrame(()=>requestAnimationFrame(()=>{if(ticket!==navigation)return;resize();if(restorePosition){
      const viewer=current==='rooms'&&reviewHost();
      // Start model work between the fixed bars, without the introductory content above it.
      if(startAtTop)window.scrollTo({top:0,left:0,behavior:'instant'});
      else if(viewer&&!viewer.hidden)viewer.scrollIntoView({block:'start',behavior:'instant'});
      else window.scrollTo({top:targetY,behavior:'instant'});
    }navigating=false;if(focus){const title=current==='welcome'?welcome.querySelector('h1'):$('journeyTitle');title.tabIndex=-1;title.focus({preventScroll:true});}}));
    if(!restoring)saveStateDebounced();
    window.dispatchEvent(new CustomEvent('boundary-journey-changed',{detail:{screen:current}}));
  }
  window.boundaryJourneyOpen=open;
  function reveal(el){
    if(!el)return;const thermalSection=el.closest('[data-thermal-section]');if(thermalSection&&$('atThermalDialog').open)setDialogPart(thermalSection.dataset.thermalSection);let key=keyFor(el);
    if(el.closest('.journey-source-rooms'))key='rooms';else if(el.closest('.journey-source-data'))key='data';
    if(key==='thermal'&&el.closest('.stage-split'))thermal='other';
    if(key==='thermal'&&el.closest('[data-insulation-card]'))thermal=el.closest('[data-insulation-card]').dataset.insulationCard;
    if(key==='fd'){fd=el.closest('.stage-split')===fdModel[1]?'model':el.id==='idfmesh'?'model':el.id==='ssl'?'colors':el.closest('#journeyFdTransfer')?'transfer':el.closest('[data-boundary-action]')?.contains($('sslExportBtn'))||el===$('sslExportBtn')?'conditions':'colors';}
    if(key&&key!==current)open(key,{focus:false,restorePosition:false});else{applyPart();applyFd();}
    window.boundaryRoomReveal?.(el);
    for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  }
  window.boundaryJourneyReveal=reveal;
  function taskKey(task){
    if(task.key==='documents'||task.key==='model')return 'data';if(task.stage===1)return 'rooms';if(task.stage===3)return 'fd';
    if(task.key.startsWith('thermal:')||task.key.startsWith('envelope:'))return 'thermal';
    if(task.key==='gains'||task.key==='windows')return 'gains';if(task.key==='ac')return 'ac';if(task.key==='solver')return 'solver';
    const el=document.querySelector(task.selector||'body');return keyFor(el)||'weather';
  }
  function reportFor(key,report,tasks,pipe){
    if(key==='solver'&&!coupled())return {state:'external',label:report.issues?.some(i=>keyFor(document.querySelector(i.selector||'body'))==='solver')?'要入力・FDで確認':'FDで確認・実行'};
    if(coupled()){
      if(key==='pipeInput')return {state:pipe?.model?'ready':'required',label:pipe?.model?'読込済み':'モデルを読み込む'};
      if(key==='pipeThermal'&&pipe?.model&&window.boundarySetupTasks){const count=window.boundarySetupTasks(pipe.model).reduce((n,t)=>n+(t.pending?.length||0),0);return {state:count?'required':'ready',label:count?'確認する条件 '+count+' 項目':'条件確認済み'};}
      if(key==='pipeRun')return {state:pipe?.job?'external':'required',label:pipe?.job?'IDF作成済み・計算結果を確認':'IDF未作成'};
      if(key==='pipeTime')return {state:pipe?.selectionSaved?'ready':'external',label:pipe?.selectionSaved?'時刻選択済み':'計算後に時刻を選択'};
      if(key==='pipeExport')return {state:$('pipeExportStatus').textContent?'ready':'external',label:$('pipeExportStatus').textContent?'出力済み':!$('pipeDownload').disabled?'出力できます':'計算結果を取り込んでから出力'};
      return {state:'external',label:pipe?.model?'形状・対応を確認':'先にモデルを読込'};
    }
    if(appMode==='architrend'){
      const local=tasks.filter(t=>taskKey(t)===key);
      if(local.length){const rest=local.filter(t=>t.state!=='ready');return {state:rest.some(t=>t.state==='pending')?'pending':rest.length?'required':'ready',label:rest.some(t=>t.state==='pending')?'変更が未反映':rest.length?'要確認 '+rest.length:'設定済み',remaining:rest.filter(t=>t.blocking).length};}
    }
    const issues=(report.issues||[]).filter(i=>{const el=document.querySelector(i.selector||'body');return (i.target?'thermal':keyFor(el))===key;}),checks=(report.checks||[]).filter(i=>keyFor(document.querySelector(i.selector||('#'+i.id)))===key);
    return {state:issues.length?'required':checks.length?'ready':'external',label:issues.length?'要入力 '+issues.length:checks.length?'設定済み':key==='solver'?'FDで確認':key==='fd'?'FDで受渡し':'確認する',remaining:issues.filter(i=>i.blocking).length};
  }
  function render(){
    document.body.dataset.journeyInput=appMode;
    window.boundaryRefreshVisualGuides?.(appMode);
    const list=steps(),index=list.findIndex(s=>s.key===current),def=list[index],isSpecial=['welcome','overview'].includes(current);
    heading.hidden=current==='welcome';footer.hidden=current==='welcome';stepNav.hidden=current==='welcome';
    $('journeyLocation').textContent=current==='overview'?'すべての工程':(index+1)+' / '+list.length+' 工程';
    $('journeyTitle').textContent=def?.title||'残りの作業と設定済み';$('journeyDescription').textContent=def?.description||'必要な設定を開き、反映すると進み具合が更新されます。';
    compact.textContent=current==='welcome'?'入力方法の選択':current==='overview'?'作業一覧':(index+1)+' / '+list.length+'　'+def?.title;
    const status=window.boundaryRequiredReport?.()||{issues:[],checks:[]},snapshot=appMode==='architrend'?window.boundaryWorkflowSnapshot?.():null,remaining=snapshot?snapshot.required:(status.issues||[]).filter(i=>i.blocking).length,tasks=snapshot?.tasks||[],pipe=coupled()?window.boundaryPipeline?.getState():null;
    $('journeyRequired').textContent=coupled()?'EP → CFD の工程':remaining?'必須の残り '+remaining+(snapshot?' 作業':' 項目'):status.active?'必須入力は設定済み':'条件に応じて必須項目を表示';
    const states=new Map(list.map(s=>[s.key,reportFor(s.key,status,tasks,pipe)]));
    const html='<ol>'+list.map((s,i)=>{const state=states.get(s.key);return '<li><button type="button" data-journey-go="'+s.key+'" data-step-state="'+state.state+'"'+(current===s.key?' aria-current="step"':'')+'>'+icon(s.key)+'<span><b>'+(i+1)+'. '+s.title+'</b><small data-journey-state="'+state.state+'">'+state.label+'</small></span></button></li>';}).join('')+'</ol>';
    if(signature!==html){const active=stepNav.contains(document.activeElement)?document.activeElement?.dataset.journeyGo:null,left=stepNav.scrollLeft,top=stepNav.scrollTop;stepNav.innerHTML=html;signature=html;stepNav.scrollLeft=left;stepNav.scrollTop=top;if(active)stepNav.querySelector('[data-journey-go="'+active+'"]')?.focus({preventScroll:true});}
    const positionKey=(coupled()?'pipeline':appMode)+':'+current;
    if(navPosition!==positionKey){navPosition=positionKey;requestAnimationFrame(()=>{measureDock();revealStep(stepNav.querySelector('[aria-current="step"]'),true);});}
    footer.querySelector('[data-journey-go="overview"]').setAttribute('aria-current',current==='overview'?'page':'false');
    $('journeyBack').textContent=isSpecial?'← 元の工程へ':index===0?'← 入力方法へ':'← '+list[index-1].title;
    $('journeyNext').textContent=isSpecial?'続きへ：'+(list.find(s=>s.key===last)?.title||list[0].title)+' →':index===list.length-1?'作業一覧を確認 →':'次へ：'+list[index+1].title+' →';
    const hasSaved=savedModes.has(appMode);
    $('journeyResume').hidden=!hasSaved;$('journeyResumeNote').textContent=hasSaved?'保存済みの入力・割当を引き継いで再開できます。':'';
    $('journeyStart').textContent=(coupled()?'EP → CFD':{manual:'手動入力',architrend:'アーキトレンド',energyplus:'計算済みEPデータ'}[appMode])+'ではじめる →';
    $('journeyModeChoices').hidden=coupled();
    roomEmpty.hidden=appMode==='architrend'?!!(typeof atMesh!=='undefined'&&atMesh?.rooms?.length):!!(typeof epParse!=='undefined'&&epParse);
    otherOverview.hidden=!coupled()&&appMode==='architrend';
    if(!otherOverview.hidden){const html='<h2>各工程を開いて、入力と条件を確認</h2><p>画面を開くだけでは、反映や完了にはなりません。FDでの反映・解析開始はFD側で確認します。</p><ul>'+list.map(s=>'<li><div><b>'+s.title+'</b><span data-journey-state="'+states.get(s.key).state+'">'+states.get(s.key).label+'</span></div><button type="button" data-journey-go="'+s.key+'">設定を開く →</button></li>').join('')+'</ul>';if(otherOverview.innerHTML!==html)otherOverview.innerHTML=html;}
  }
  function queue(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;render();applyPart();});}
  const refresh=window.boundaryRefreshRequiredGuide;window.boundaryRefreshRequiredGuide=function(){const result=refresh?.apply(this,arguments);queue();return result;};
  const run=runAll;runAll=function(){const result=run.apply(this,arguments);queue();return result;};
  const mode=setModeUI;setModeUI=function(){const result=mode.apply(this,arguments);const saved=loadModeState(appMode);if(saved)savedModes.add(appMode);placeSource();queue();return result;};
  const originalOpen=window.boundaryOpenInsulation;window.boundaryOpenInsulation=function(target){thermal=target;open('thermal',{focus:false,restorePosition:false});const item=window.boundaryInsulationStatus?.().find(s=>s.target===target);if(item?.editor==='common'&&item.fieldIds?.length)reveal($(item.fieldIds[0]));return originalOpen?.(target);};
  const taskOpen=window.boundaryOpenWorkflowTask;window.boundaryOpenWorkflowTask=function(key){const task=window.boundaryWorkflowSnapshot?.().tasks.find(t=>t.key===key);if(task){if(task.key.startsWith('thermal:'))thermal=task.key.split(':')[1];open(taskKey(task),{focus:false,restorePosition:false});if(task.selector)reveal(document.querySelector(task.selector));}return taskOpen?.(key);};
  const originalThermal=architrendShowThermal;architrendShowThermal=function(target){thermal=target;open('thermal',{focus:false});return originalThermal(target);};
  // Preserve full thermal editors; target tabs live in the protected-focus dialog as well.
  const dialogTabs=document.createElement('nav');dialogTabs.className='journey-part-tabs';dialogTabs.setAttribute('aria-label','断熱の設定対象');dialogTabs.innerHTML=[['wall','外壁'],['roof','屋根'],['ceiling','天井・小屋裏']].map(([key,label])=>'<button type="button" data-journey-dialog-part="'+key+'">'+label+'</button>').join('');$('atThermalDialogBody').before(dialogTabs);
  const origShow=architrendShowThermal;architrendShowThermal=function(target){const result=origShow(target);setDialogPart(target);return result;};
  function setDialogPart(target){thermal=target;const dialog=$('atThermalDialog');dialog.dataset.journeyPart=target;dialog.dataset.target=target;$('atThermalDialogTitle').textContent={wall:'外壁の設定',roof:'屋根の設定',ceiling:'天井・小屋裏の設定'}[target];dialogTabs.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.journeyDialogPart===target)));refreshArchitrendThermalDialogStatus();applyPart();}
  document.addEventListener('click',e=>{
    const go=e.target.closest('[data-journey-go]');if(go){e.preventDefault();open(go.dataset.journeyGo);return;}
    const part=e.target.closest('[data-journey-thermal]');if(part){thermal=part.dataset.journeyThermal;applyPart();requestAnimationFrame(resize);saveStateDebounced();return;}
    const f=e.target.closest('[data-journey-fd]');if(f){fd=f.dataset.journeyFd;applyFd();saveStateDebounced();resize();return;}
    const d=e.target.closest('[data-journey-dialog-part]');if(d){thermal=d.dataset.journeyDialogPart;setDialogPart(thermal);$('atThermalDialog').dataset.target=thermal;$('atThermalDialogTitle').textContent={wall:'外壁の設定',roof:'屋根の設定',ceiling:'天井・小屋裏の設定'}[thermal];refreshArchitrendThermalDialogStatus();applyPart();saveStateDebounced();return;}
  });
  // Reveal hidden destination first; existing listeners can then open details/focus the actual field.
  document.addEventListener('click',e=>{
    const action=e.target.closest('button')?.closest('[data-boundary-action]'),screen=action?.closest('.journey-screen');
    if(screen)screen.style.minHeight=screen.getBoundingClientRect().height+'px';
    const b=e.target.closest('[data-workflow-open],[data-required-action],[data-workflow-home],[data-workflow-jump],#atWindowNorthCheck,a[href^="#"]');if(!b)return;
    if(b.id==='atWindowNorthCheck'){reveal($('atNorthDeg'));return;}
    if(b.hasAttribute('data-workflow-home')){open('overview',{focus:false});return;}
    if(b.dataset.workflowOpen)return;
    if(b.hasAttribute('data-required-action')){const issue=window.boundaryRequiredReport?.().issues[Number(b.dataset.requiredAction)];if(issue?.target){thermal=issue.target;open('thermal',{focus:false});}else if(issue)reveal(document.querySelector(issue.selector));return;}
    const id=b.dataset.workflowJump||b.getAttribute('href')?.slice(1);if(id)reveal($(id));
  },true);
  $('journeyBack').onclick=()=>{const list=steps(),i=list.findIndex(s=>s.key===current);open(i<0?last:i===0?'welcome':list[i-1].key);};
  $('journeyNext').onclick=()=>{const list=steps(),i=list.findIndex(s=>s.key===current);open(i<0?last:i===list.length-1?'overview':list[i+1].key,{startAtTop:true});};
  $('journeyStart').onclick=()=>open(steps()[0].key);$('journeyResume').onclick=()=>open(last);
  document.querySelector('.workflow-tabs').addEventListener('click',()=>{placeSource();if(current!=='welcome')open(steps()[0].key);else render();});
  document.addEventListener('input',queue);document.addEventListener('change',queue);
  if(pipeHost)new MutationObserver(queue).observe(pipeHost,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
  ['architrend-data-ready','architrend-input-applied','architrend-model-ready','architrend-model-invalidated','architrend-thermal-changed','architrend-room-mapping-changed'].forEach(name=>window.addEventListener(name,queue));
  window.addEventListener('scroll',()=>{if(!navigating)positions[current]=scrollY;},{passive:true});
  window.addEventListener('resize',event=>{
    if(event.isTrusted&&current==='rooms'&&innerHeight>560)requestAnimationFrame(()=>{
      const viewer=reviewHost();if(viewer&&!viewer.hidden)viewer.scrollIntoView({block:'start',behavior:'instant'});
    });
  });
  function detailKey(el){const room=el.closest('.room-card');if(room&&el.dataset.gainPanel){const key=room.dataset.atRoomKey?'at:'+room.dataset.atRoomKey:room.dataset.epZone?'ep:'+room.dataset.epZone:'index:'+[...document.querySelectorAll('.room-card')].indexOf(room);return 'gains:'+key+':'+el.dataset.gainPanel;}return el.id||el.dataset.basicDetail+(room?':'+[...document.querySelectorAll('.room-card')].indexOf(room):'');}
  const gather=gatherState;gatherState=function(){const s=gather.apply(this,arguments);s.journey={version:1,screen:current,last,thermal,fd,positions:{...positions,[current]:scrollY},details:[...document.querySelectorAll('details[id],details[data-basic-detail]')].map(el=>({key:detailKey(el),open:el.open}))};return s;};
  function restore(saved){const state=saved?.journey;if(!state||state.version!==1)return;restoring=true;try{for(const [key,value]of Object.entries(state.positions||{}))if(Number.isFinite(value)&&value>=0)positions[key]=value;last=typeof state.last==='string'?state.last:steps()[0].key;thermal=['wall','roof','ceiling','other'].includes(state.thermal)?state.thermal:'wall';fd=['model','transfer','colors','conditions'].includes(state.fd)?state.fd:'model';const details=new Map((state.details||[]).map(d=>[d.key,d.open]));document.querySelectorAll('details[id],details[data-basic-detail]').forEach(el=>{if(details.has(detailKey(el)))el.open=!!details.get(detailKey(el));});open(state.screen||last,{focus:false,remember:false});}finally{restoring=false;}}
  const apply=applyState;applyState=function(s){if(['manual','architrend','energyplus'].includes(s?.mode)&&s.mode!==appMode){saveStateNow();setModeUI(s.mode);}const result=apply.apply(this,arguments);restore(s);if(s&&!s.journey&&!steps().some(step=>step.key===current)&&current!=='welcome')open(steps()[0].key,{focus:false});return result;};
  const persist=window.boundarySessionSave;window.boundarySessionSave=function(){const result=persist.apply(this,arguments);if(result&&current!=='welcome'){savedModes.add(appMode);queue();}return result;};
  const saved=typeof loadModeState==='function'?loadModeState(appMode):null;
  if(saved)savedModes.add(appMode);
  if(coupled()&&$('pipeAtHost'))$('pipeAtHost').append($('atPanel'));
  document.body.classList.add('journey-mode');if(saved?.journey)restore(saved);else open('welcome',{focus:false});
})();

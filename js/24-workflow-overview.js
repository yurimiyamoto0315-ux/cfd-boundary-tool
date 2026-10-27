/* A read-only view of live settings. Opening a task never confirms or applies it. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stages=['資料の読込','部屋・階の確認','解析条件の設定','FDへ渡す'];
  const originLabels={document:'資料から取得',model:'モデルから取得',estimate:'自動推定・概算',manual:'手入力',standard:'標準値',input:'入力値',calculation:'自動計算'};
  let filter='pending',stageFilter=null,showAll=false,lastSignature='',lastCounts='',lastTasks=[];
  const edited=new Map();
  function restoreOrigins(saved){
    edited.clear();
    for(const item of saved?.workflowOrigins||[]){
      if(Array.isArray(item)&&item.length===2&&typeof item[0]==='string'&&typeof item[1]==='string'&&$(item[0])?.type==='number'&&(item[1]===''||Number.isFinite(Number(item[1]))))edited.set(item[0],item[1]);
    }
  }
  function sourceData(){return typeof atLastParse!=='undefined'?atLastParse:null;}
  function currentMesh(){return typeof atMesh!=='undefined'?atMesh:null;}
  function same(a,b){return a!==null&&a!==undefined&&b!==''&&Number.isFinite(+a)&&Number.isFinite(+b)&&Math.abs(+a-+b)<1e-7;}
  function origin(id,parsed){
    const el=$(id);if(!el)return 'input';
    if(edited.get(id)===el.value)return 'manual';
    if(id==='roomVol'&&el.dataset.at3dsAuto==='true')return 'model';
    const data=parsed?.result,map={uFloor1:'uFloor'},key=map[id]||id;
    if(parsed?.applied!==false&&same(data?.[key],el.value))return 'document';
    if(id==='uaVal'&&same(data?.uaEstimateApplied?.ua,el.value))return 'estimate';
    const initial=el.tagName==='SELECT'?[...el.options].find(o=>o.defaultSelected)?.value:el.defaultValue;
    return initial!==undefined&&initial!==''&&el.value===initial?'standard':'input';
  }
  function thermalOrigins(target,parsed,item,saved){
    if(item.editor==='common')return item.fieldIds.map(id=>origin(id,parsed));
    const ids=new Set((currentMesh()?.meshFaces||[]).filter(f=>target==='wall'?/^wall_/.test(f.sslKey||''):target==='roof'?f.sslKey==='roof':f.nameJa==='天井').map(f=>String(f.atFaceId)));
    const assignments=(saved?.assignments||[]).filter(([id])=>ids.has(String(id)));
    if(target==='ceiling'&&assignments.some(([,a])=>a.attic))return ['estimate'];
    const all=assignments.map(([,a])=>a.groupId);
    return all.length?[...new Set(all.map(id=>id==='__manual'?'manual':'document'))]:[];
  }
  function build(report){
    const parsed=sourceData(),mesh=currentMesh(),issues=report.issues||[],checks=report.checks||[],tasks=[],consumed=new Set();
    const take=predicate=>issues.filter(i=>!consumed.has(i.key)&&predicate(i)).map(i=>{consumed.add(i.key);return i;});
    const add=t=>tasks.push({origins:[],fields:[],blocking:false,...t});
    const sourceProblems=take(i=>i.key==='source-review');
    const importState=typeof atImportState!=='undefined'?atImportState:{};
    const validSource=!!parsed&&!['invalid','loading'].includes(importState.status);
    add({key:'documents',stage:0,title:'CSV・Excel・PDFの読込結果を反映',state:importState.status==='loading'?'loading':!validSource?'required':parsed.applied===false?'pending':'ready',blocking:true,
      text:sourceProblems[0]?.reason||(importState.status==='loading'?'資料を読み込んでいます。読込が終わるまでお待ちください。':importState.status==='invalid'?'資料を読み込めませんでした。読込結果を確認して選び直してください。':!validSource?'同じ物件の資料を選びます。PDFはまとめて選べます。':parsed.applied===false?'読込はできています。内容を確認して「確認して入力へ反映」を押してください。':'読込結果を設定へ反映しています。取得した値をそのまま使えます。'),
      selector:validSource&&parsed.applied===false?'#atApplyImportBtn':validSource?'#atReview':sourceProblems[0]?.selector||((importState.codes||[]).some(c=>c.startsWith('PDF_'))?'#atPdfInput':'#atCsvInput'),origins:validSource?['document']:[]});
    const modelSourceState=$('at3dsStatus')?.dataset.status,modelBlocked=['loading','invalid'].includes(modelSourceState);
    const modelProblems=take(i=>i.key==='model-review'||i.key==='export-global'&&modelBlocked);
    add({key:'model',stage:0,title:'3Dモデルの読込',state:modelSourceState==='loading'?'loading':!mesh||modelBlocked?'required':modelProblems.length||mesh.readiness?.ready===false?'review':'ready',blocking:true,
      text:modelSourceState==='loading'?'3Dモデルを読み込んでいます。読込が終わるまでお待ちください。':modelSourceState==='invalid'?'モデルを読み込めませんでした。3DSの出力内容を確認して選び直してください。':!mesh?'床・内壁・天井を含む3DSを選びます。':modelProblems[0]?.reason|| (mesh.readiness?.ready===false?'大きさ・階数・床の読込結果を確認してください。':'3Dモデルを読み込みました。部屋・階の確認へ進めます。'),selector:mesh&&!modelBlocked?'#atRoomViewer':'#at3dsInput',origins:mesh&&!modelBlocked?['model']:[]});
    const roomIssues=take(i=>['floor-review','stair-review'].includes(i.key));
    for(const i of roomIssues)add({key:i.key,stage:1,title:i.label,state:'review',blocking:i.blocking,text:i.reason,selector:i.selector,origins:[i.key==='floor-review'&&(mesh?.rooms||[]).some(r=>r.inferredFloor)?'estimate':'model']});
    const rooms=mesh?.rooms||[],unassigned=rooms.filter(r=>!r.name||r.name==='未割当');
    if(!roomIssues.some(i=>i.key==='floor-review')&&rooms.some(r=>Number(r.floor)>1))add({key:'floor-review',stage:1,title:'階段・吹き抜けの床',state:'ready',text:'現在の床・吹抜けの指定を使用します。図で確認・変更できます。',selector:'#atRoomViewer',origins:[...new Set(rooms.filter(r=>Number(r.floor)>1).map(r=>r.floorReviewed||r.floorVoid?'manual':r.inferredFloor?'estimate':'model'))]});
    if(!roomIssues.some(i=>i.key==='stair-review')&&rooms.some(r=>r.stair||r.stairAutoNeedsReview!==undefined))add({key:'stair-review',stage:1,title:'階段の配置・経路',state:'ready',text:'現在の階段の指定を使用します。図で確認・変更できます。',selector:'#atRoomViewer',origins:['model']});
    add({key:'rooms',stage:1,title:'部屋名・階・配置を確認',state:!mesh?'waiting':!rooms.length||unassigned.length?'review':'ready',
      text:!mesh?'モデル読込後に確認できます。':!rooms.length?'部屋区画を取得できていません。内壁を含むモデルか確認してください。':unassigned.length?'名前が未割当の区画が '+unassigned.length+' 件あります。図面を見ながら必要な部屋を指定してください。':rooms.length+' 区画に部屋名が設定されています。配置は図で確認・変更できます。',
      selector:mesh?'#atRoomViewer':'#at3dsInput',origins:rooms.length?[rooms.some(r=>r.manualAssignment)?'manual':'estimate']:[]});
    const thermal=window.boundaryInsulationStatus?.()||[],thermalSnapshot=thermal.some(t=>t.editor!=='common')?window.boundaryThermalSnapshot?.():null;
    for(const item of thermal){
      if(item.state==='not-needed')continue;
      const related=take(i=>i.target===item.target||item.fieldIds?.some(id=>i.selector==='#'+id));
      add({key:'thermal:'+item.target,stage:2,title:item.label,state:!mesh?'waiting':item.state==='ready'&&!related.length?'ready':item.state==='pending'?'pending':item.state==='unavailable'?'review':'required',blocking:!!mesh,
        text:item.reason+' '+item.nextAction,target:item.target,selector:'#insulationGuide',origins:thermalOrigins(item.target,parsed,item,thermalSnapshot),fields:[]});
    }
    const thermalIds=new Set(thermal.flatMap(t=>t.fieldIds||[]));
    const groups=new Map();
    const groupFor=section=>section==='日時・気象'?['climate','日時・場所・気温',2]:section==='窓'?['windows','窓の性能と部屋への対応',2]:section==='部屋・発熱'?['gains','部屋の人数・発熱',2]:section==='エアコン'?['ac','エアコンの風量・温度',2]:section==='解析設定'?['solver','解析の初期条件',2]:section==='FDへ渡す'?['fd','FDの材質・色の対応',3]:['envelope:'+section,section+'の条件',2];
    const group=section=>{const [key,title,stage]=groupFor(section);if(!groups.has(key))groups.set(key,{key,title,stage,problems:[],fields:[]});return groups.get(key);};
    for(const c of checks)if(!thermalIds.has(c.id))group(c.section).fields.push({...c,origin:c.id?origin(c.id,parsed):'input'});
    for(const i of take(()=>true))group(i.section).problems.push(i);
    const cards=[...document.querySelectorAll('#roomsWrap .room-card')];
    if(cards.length&&!groups.has('gains'))group('部屋・発熱');
    const colors=typeof sslColors!=='undefined'?sslColors:[],assign=typeof sslAssign!=='undefined'?sslAssign:{};
    const explicit=colors.length>0&&colors.every(c=>assign[c.rgb]),keys=explicit?colors.map(c=>assign[c.rgb]):(mesh?.meshFaces||[]).map(f=>f.sslKey||'');
    const acUsed=keys.some(k=>k==='ac_supply'||k==='ac_return')||(typeof atPartAcUnits==='function'&&atPartAcUnits().length>0);
    if(acUsed&&!groups.has('ac'))group('エアコン');
    for(const g of groups.values()){
      const problem=g.problems[0],hasFields=g.fields.length>0;
      add({key:g.key,title:g.title,stage:g.stage,state:g.problems.length?'required':!validSource&&g.key==='gains'?'waiting':'ready',blocking:g.problems.some(p=>p.blocking),
        text:problem?g.problems.length+' 項目を確認してください。'+problem.reason:g.key==='gains'?cards.length+' 室の入力を使用します。人数や家電の使い方はここから変更できます。':g.key==='ac'?'現在の負荷・風量で計算しています。条件を変更すると再計算します。':hasFields?g.fields.length+' 項目が入力済みです。値と出所を確認・変更できます。':'現在の設定を使用します。',
        selector:problem?.selector||g.fields[0]?.selector||(g.key==='gains'?'#roomsWrap':g.key==='ac'?'#step3':'#ssl'),
        target:problem?.target,origins:g.key==='ac'?['calculation']:[...new Set(g.fields.map(f=>f.origin))],fields:g.fields});
    }
    if(!colors.length)add({key:'fd-handoff',stage:3,title:'FDの色対応CSVを読み込む',state:'waiting',text:'条件を設定して色分けモデルをFDへ取り込んだら、FDから色対応CSVを出して読み込みます。',selector:'#ssl'});
    else if(!groups.has('fd'))add({key:'fd',stage:3,title:'FDの材質・色の対応',state:'ready',text:'読み込んだ色はすべて対応先が設定されています。',selector:'#ssl',origins:['document']});
    // Absence of checks must never turn an empty project into completed conditions.
    if(!tasks.some(t=>t.stage===2&&t.state!=='waiting'))add({key:'conditions',stage:2,title:'資料を使って解析条件を設定',state:'waiting',text:'資料・モデルを読み込むと、今回必要な設定だけがここに並びます。',selector:'#atPanel'});
    tasks.sort((a,b)=>a.stage-b.stage);
    const required=tasks.filter(t=>t.blocking&&t.state!=='ready'),review=tasks.filter(t=>!t.blocking&&t.state!=='ready'),completed=tasks.filter(t=>t.state==='ready');
    return {tasks,required:required.length,review:review.length,completed:completed.length,total:tasks.length,percent:tasks.length?Math.floor(completed.length/tasks.length*100):0};
  }
  const stateLabel=t=>t.state==='ready'?'設定済み':t.state==='pending'?(t.key==='documents'?'読込済み・未反映':'変更が未反映'):t.state==='loading'?'読み込み中':t.state==='waiting'?'このあと設定':t.blocking?'必須・要確認':'確認おすすめ';
  function badges(origins){return [...new Set(origins)].map(o=>'<span class="workflow-origin" data-origin="'+esc(o)+'">'+esc(originLabels[o]||originLabels.input)+'</span>').join('');}
  function row(t){return '<li class="workflow-task" data-workflow-task="'+esc(t.key)+'" data-state="'+esc(t.state)+'"><div class="workflow-task-copy"><div class="workflow-task-heading"><b>'+esc(t.title)+'</b><span class="workflow-state">'+esc(stateLabel(t))+'</span></div><p>'+esc(t.text)+'</p><div class="workflow-origins">'+badges(t.origins)+'</div>'+(t.fields.length?'<details data-workflow-values="'+esc(t.key)+'"><summary>入力値と出所を見る（'+t.fields.length+'項目）</summary><dl>'+t.fields.map(f=>{const el=f.id?$(f.id):document.querySelector(f.selector),v=el?.tagName==='SELECT'?el.selectedOptions[0]?.textContent:el?.value;return '<div><dt>'+esc(f.label)+'</dt><dd><strong>'+esc(v||'未入力')+'</strong>'+badges([f.origin])+'<span class="workflow-field-state">'+(f.valid?'入力済み':'要入力')+'</span></dd></div>';}).join('')+'</dl></details>':'')+'</div><button type="button" data-workflow-open="'+esc(t.key)+'" aria-label="'+esc(t.title)+'の設定を開く">'+(t.state==='ready'?'確認・変更':'設定を開く')+' <span aria-hidden="true">→</span></button></li>';}
  function scrollTo(el){
    for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
    if(!el.matches('input,select,textarea,button,a,[tabindex]'))el.tabIndex=-1;
    el.scrollIntoView({block:el.matches('input,select,textarea,button')?'center':'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});el.focus({preventScroll:true});
  }
  window.boundaryOpenWorkflowTask=function(key){
    const task=lastTasks.find(t=>t.key===key);if(!task)return;
    if(task.target&&typeof window.boundaryOpenInsulation==='function'){window.boundaryOpenInsulation(task.target);return;}
    let el;try{el=document.querySelector(task.selector);}catch{return;}
    if(el?.closest('[hidden]')||el&&getComputedStyle(el).display==='none')el=null;
    if(!el)el=$(task.stage===0?'atPanel':task.stage===1?'atRoomViewer':task.stage===3?'ssl':'step1');
    if(el)scrollTo(el);
  };
  function updateSidebar(tasks){
    const sets={1:tasks.filter(t=>t.key.startsWith('thermal:')||t.key.startsWith('envelope:')),2:tasks.filter(t=>['gains','windows'].includes(t.key)),3:tasks.filter(t=>t.key==='ac')};
    for(const [n,list]of Object.entries(sets)){const el=$('st'+n);if(!el)continue;const pending=list.filter(t=>t.state!=='ready').length;el.textContent=!list.length?'対象なし':pending?'残'+pending:'設定済';el.className='st'+(list.length&&!pending?' done':'');}
  }
  window.boundaryWorkflowSnapshot=()=>build(window.boundaryRequiredReport?.()||{issues:[],checks:[]});
  window.boundaryRenderWorkflow=function(report){
    const host=$('requiredSetupGuide');if(!host)return;
    host.hidden=false;host.classList.add('workflow-guide');document.body.dataset.workflow='architrend';
    const snapshot=build(report);lastTasks=snapshot.tasks;updateSidebar(lastTasks);
    const selected=lastTasks.filter(t=>(stageFilter===null||t.stage===stageFilter)&&(filter==='all'||(filter==='done'?t.state==='ready':t.state!=='ready')));
    const shown=showAll?selected:selected.slice(0,5),next=lastTasks.find(t=>t.blocking&&t.state!=='ready')||lastTasks.find(t=>t.state!=='ready');
    const counts=[snapshot.required,snapshot.review,snapshot.completed].join(':');
    const html='<header class="workflow-heading"><div><p class="workflow-eyebrow">あなたの作業一覧</p><h2>次にすることが、ここで分かります。</h2><p>必要な設定を開いて反映すると、一覧も更新されます。</p></div><div class="workflow-progress"><strong>'+snapshot.completed+'<small> / '+snapshot.total+' 設定済み</small></strong><div role="progressbar" aria-label="ツールの設定の進み具合" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+snapshot.percent+'"><span style="width:'+snapshot.percent+'%"></span></div></div></header>'+
      '<nav class="workflow-stages" aria-label="設定の4段階">'+stages.map((title,index)=>{const list=lastTasks.filter(t=>t.stage===index),n=list.filter(t=>t.state!=='ready').length;return '<button type="button" data-workflow-stage="'+index+'" aria-pressed="'+(stageFilter===index)+'"'+(next?.stage===index?' aria-current="step"':'')+'><span class="workflow-stage-number">'+(index+1)+'</span><span><b>'+title+'</b><small>'+(!list.length?'対象なし':n?'残り '+n+' 作業':'設定済み')+'</small></span></button>';}).join('')+'</nav>'+
      '<div class="workflow-next"><div><b>'+(next?'次にすること：'+esc(next.title):'ツール側の設定がそろいました')+'</b><p>'+(next?esc(next.text):'色分けモデルと条件CSVの受渡しを確認してください。FDでの反映・解析完了は、FD側で確認します。')+'</p></div>'+(next?'<button type="button" data-workflow-open="'+esc(next.key)+'">'+(next.key==='documents'&&sourceData()?.applied===false?'読込結果を確認':'この設定を開く')+' →</button>':'<button type="button" data-workflow-jump="ssl">FDへの受渡しを確認 →</button>')+'</div>'+
      '<div class="workflow-counts"><span><i class="workflow-count-dot is-required" aria-hidden="true"></i><b>'+snapshot.required+'</b> 必須の残り</span><span><i class="workflow-count-dot is-review" aria-hidden="true"></i><b>'+snapshot.review+'</b> 確認おすすめ・このあと</span><span><i class="workflow-count-dot is-done" aria-hidden="true"></i><b>'+snapshot.completed+'</b> 設定済み</span></div>'+
      '<div class="workflow-filters" role="group" aria-label="作業一覧の表示">'+[['pending','残りの作業'],['done','設定済み'],['all','すべて']].map(([key,label])=>'<button type="button" data-workflow-filter="'+key+'" aria-pressed="'+(filter===key)+'">'+label+'</button>').join('')+(stageFilter!==null?'<button type="button" data-workflow-stage="all" class="workflow-clear-stage">全段階を表示 ×</button>':'')+'</div>'+
      '<ul class="workflow-task-list">'+shown.map(row).join('')+'</ul>'+(!shown.length?'<p class="workflow-empty">'+(filter==='done'?'設定済みの項目は、反映するとここに並びます。':'この表示範囲に残りの作業はありません。')+'</p>':'')+(selected.length>5?'<button type="button" class="workflow-show-all" data-workflow-show-all>'+ (showAll?'一覧を短く表示':'残り '+(selected.length-5)+' 作業も表示')+'</button>':'')+
      '<p class="workflow-legend"><b>値の出所</b>は「資料から取得・自動推定・手入力」などで表示。<b>状態</b>は「設定済み・変更が未反映」などで別に表示します。標準値・推定値は、今回の条件に合うか確認してください。</p><p class="workflow-note">進み具合はツール側の設定状況です。FDでの反映や解析の完了を示すものではありません。</p>';
    if(html!==lastSignature||!host.querySelector('.workflow-heading')){
      const focused=host.contains(document.activeElement)?document.activeElement:null,token=focused&&['data-workflow-open','data-workflow-filter','data-workflow-stage','data-workflow-show-all'].find(a=>focused.hasAttribute(a)),tokenValue=token&&focused.getAttribute(token);
      const open=[...host.querySelectorAll('[data-workflow-values][open]')].map(d=>d.dataset.workflowValues);
      host.innerHTML=html;lastSignature=html;
      for(const details of host.querySelectorAll('[data-workflow-values]'))details.open=open.includes(details.dataset.workflowValues);
      if(token){const replacement=[...host.querySelectorAll('['+token+']')].find(el=>el.getAttribute(token)===tokenValue);replacement?.focus({preventScroll:true});}
    }
    let live=$('workflowLive');if(!live){live=document.createElement('p');live.id='workflowLive';live.className='visually-hidden';live.setAttribute('role','status');live.setAttribute('aria-live','polite');host.after(live);}
    if(lastCounts&&lastCounts!==counts)live.textContent='一覧を更新しました。必須の残り '+snapshot.required+' 作業、設定済み '+snapshot.completed+' 作業です。';lastCounts=counts;
    const remain=$('atRemainInfo');if(remain){remain.hidden=false;remain.style.display='';remain.style.color='';remain.textContent='残り '+(snapshot.required+snapshot.review)+' · 設定済み '+snapshot.completed+'　一覧へ';}
  };
  document.addEventListener('input',e=>{const el=e.target;if(el.id&&!el.closest('#requiredSetupGuide')&&/^(INPUT|SELECT)$/.test(el.tagName)&&el.type!=='file')edited.set(el.id,el.value);});
  document.addEventListener('click',e=>{
    const button=e.target.closest?.('[data-workflow-open],[data-workflow-filter],[data-workflow-stage],[data-workflow-show-all],[data-workflow-home],[data-workflow-jump]');if(!button)return;
    if(button.hasAttribute('data-workflow-open')){window.boundaryOpenWorkflowTask(button.dataset.workflowOpen);return;}
    if(button.hasAttribute('data-workflow-home')){scrollTo($('requiredSetupGuide'));return;}
    if(button.dataset.workflowJump){scrollTo($(button.dataset.workflowJump));return;}
    if(button.hasAttribute('data-workflow-filter')){filter=button.dataset.workflowFilter;showAll=false;}
    if(button.hasAttribute('data-workflow-stage')){const value=button.dataset.workflowStage;stageFilter=value==='all'?null:Number(value);filter='all';showAll=false;}
    if(button.hasAttribute('data-workflow-show-all'))showAll=!showAll;
    window.boundaryRefreshRequiredGuide?.();
  });
  for(const name of ['architrend-import-invalidated','architrend-model-invalidated'])window.addEventListener(name,()=>edited.clear());
  // Numeric edit provenance follows the existing local save/backup, with no new storage or source files.
  const gather=gatherState;gatherState=function(){const saved=gather.apply(this,arguments);saved.workflowOrigins=[...edited].filter(([id,v])=>$(id)?.type==='number'&&(v===''||Number.isFinite(Number(v))));return saved;};
  const apply=applyState;applyState=function(saved){restoreOrigins(saved);const result=apply.apply(this,arguments);window.boundaryRefreshRequiredGuide?.();return result;};
  restoreOrigins(typeof loadModeState==='function'?loadModeState(appMode):null);
  // Other workflows retain their own completion semantics and controls.
  const setUI=setModeUI;setModeUI=function(mode){delete document.body.dataset.workflow;lastSignature='';lastCounts='';restoreOrigins(typeof loadModeState==='function'?loadModeState(mode):null);const result=setUI.apply(this,arguments);window.boundaryRefreshRequiredGuide?.();return result;};
})();

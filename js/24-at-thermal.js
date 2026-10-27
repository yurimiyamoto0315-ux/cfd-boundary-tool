/* Explicit ARCHITREND specification-to-face assignments. Memory only. */
(function(){
  'use strict';
  const labels={wall:'外壁',roof:'屋根',floor:'外気側の床',ceiling:'小屋裏に接する天井'};
  const state={source:null,mesh:null,signature:'',baseSignature:'',sections:[],assignments:new Map(),bulkDrafts:new Map(),bulkDirty:new Set(),faceDrafts:new Map(),revision:0,cache:null};
  let renderedSource=null,renderedMesh=null,renderedSignature=null;
  const retiredColors=[];
  let previousColors=[];
  let notifying=false;
  const number=value=>value!==''&&value!==null&&value!==undefined&&Number.isFinite(Number(value))?Number(value):null;
  const positive=value=>number(value)>0;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const currentData=()=>typeof atLastParse!=='undefined'&&atLastParse?atLastParse.result:null;
  const currentMesh=()=>typeof atMesh!=='undefined'?atMesh:null;
  const faceId=face=>face&&face.atFaceId!=null?String(face.atFaceId):'';
  function invalidateCache(){
    if(state.cache){
      previousColors=state.cache.categories.map(c=>({...c.color}));
      if(state.cache.exported)retiredColors.push(...previousColors);
    }
    state.cache=null;
  }
  function emit(reason){
    if(notifying||!window.dispatchEvent||typeof CustomEvent==='undefined')return;
    notifying=true;
    try{window.dispatchEvent(new CustomEvent('architrend-thermal-changed',{detail:{reason,requiresFresh3ds:true}}));}finally{notifying=false;}
  }
  function clear(reason,notify=true){
    const had=state.assignments.size>0;
    invalidateCache();state.source=null;state.mesh=null;state.signature='';state.baseSignature='';state.sections=[];state.assignments.clear();state.bulkDrafts.clear();state.bulkDirty.clear();state.faceDrafts.clear();state.revision++;
    window.boundaryAttic?.reset();
    if(notify&&had)emit(reason);
  }
  function targets(face,target){
    if(!face)return false;
    if(target==='wall')return /^wall_/.test(face.sslKey||'');
    if(target==='roof')return face.sslKey==='roof';
    if(target==='floor')return face.sslKey==='floor_out'||face.cantilever===true;
    return target==='ceiling'&&face.nameJa==='天井';
  }
  function ensure(required,data){
    const mesh=currentMesh();
    const north=typeof atNorthDeg==='function'?atNorthDeg():0;
    const faces=mesh&&mesh.meshFaces||[];
    const baseSignature=JSON.stringify([required,faces.map(f=>[faceId(f),f.sslKey,f.nameJa,f.modelToolAz,(f.verts||[]).map(p=>[p.x,p.y,p.z])]),north]);
    const signature=JSON.stringify([baseSignature,(mesh?.rooms||[]).map(r=>[r.z,r.zTop,r.ring])]);
    if(state.source===data&&state.mesh===mesh&&state.signature===signature)return;
    const had=state.assignments.size>0;
    const roomsOnly=state.source===data&&state.mesh===mesh&&state.baseSignature===baseSignature;
    const keepIds=new Set(roomsOnly?state.sections.filter(s=>s.target!=='ceiling').flatMap(s=>s.faces.map(faceId)):[]);
    const keptAssignments=[...state.assignments].filter(([id])=>keepIds.has(id));
    const keptDrafts=roomsOnly?[...state.bulkDrafts].filter(([target])=>target!=='ceiling'):[];
    const keptDirty=roomsOnly?[...state.bulkDirty].filter(target=>target!=='ceiling'):[],keptFaces=roomsOnly?[...state.faceDrafts].filter(([id])=>keepIds.has(id)):[];
    invalidateCache();state.source=data;state.mesh=mesh;state.signature=signature;state.baseSignature=baseSignature;state.assignments=new Map(keptAssignments);state.bulkDrafts=new Map(keptDrafts);state.revision++;
    state.bulkDirty=new Set(keptDirty);state.faceDrafts=new Map(keptFaces);
    window.boundaryAttic?.reset();
    const sections=new Map();
    const atticFaces=window.boundaryAttic&&mesh?window.boundaryAttic.classify(mesh):null;
    const problems=(required||[]).slice();
    if(data&&atticFaces?.top.length&&!problems.some(p=>p.target==='ceiling'))problems.push({code:'CEILING_BOUNDARY',target:'ceiling'});
    problems.forEach(problem=>{
      const target=problem.target;
      if(!sections.has(target))sections.set(target,{target,label:labels[target]||'要確認の面',codes:[],groups:[],faces:target==='ceiling'&&atticFaces?[...atticFaces.top,...atticFaces.uncertain]:faces.filter(f=>targets(f,target))});
      const section=sections.get(target);section.codes.push(problem.code);
      if(target!=='ceiling')(problem.groups||[]).forEach(group=>{
        const id=String(group.id||'');
        if(id&&!section.groups.some(g=>g.id===id))section.groups.push({id,u:positive(group.u)?Number(group.u):positive(group.area)&&positive(group.heatLoss)?Number(group.heatLoss)/Number(group.area):null});
      });
    });
    state.sections=[...sections.values()];
    if(had)emit('source-or-model-changed');
  }
  function live(){
    const data=currentData(),required=data&&data.csvDiagnostics&&data.csvDiagnostics.requiredManual||[];
    ensure(required,data);return data;
  }
  function sectionFor(id){return state.sections.find(s=>s.faces.some(f=>faceId(f)===String(id)));}
  function assignmentValid(section,assignment){
    if(!assignment||!positive(assignment.u)||!assignment.groupId)return false;
    if(assignment.groupId!=='__manual'&&!section.groups.some(g=>g.id===assignment.groupId))return false;
    return section.target!=='ceiling'||assignment.confirmed===true&&number(assignment.temperature)!==null&&number(assignment.temperature)>-273.15&&(!assignment.attic||window.boundaryAttic?.isFresh(assignment.attic)===true);
  }
  function assess(){
    const codes=[];let total=0,assigned=0;
    if(state.sections.length&&!state.mesh)codes.push('THERMAL_MODEL_REQUIRED');
    const ids=new Set();
    state.sections.forEach(section=>{
      if(!section.faces.length)codes.push(section.target==='ceiling'?'CEILING_MODEL_REQUIRED':'THERMAL_TARGET_MISSING');
      section.faces.forEach(face=>{
        total++;const id=faceId(face);
        if(!id||ids.has(id)){codes.push('THERMAL_FACE_ID');return;}ids.add(id);
        if(assignmentValid(section,state.assignments.get(id)))assigned++;
        else codes.push(section.target==='ceiling'?'CEILING_ASSIGNMENT_REQUIRED':'SPEC_FACE_ASSIGNMENT_REQUIRED');
      });
      if(sectionPending(section))codes.push(section.target==='ceiling'?'CEILING_DRAFT_PENDING':'SPEC_DRAFT_PENDING');
    });
    return {ready:codes.length===0,codes:[...new Set(codes)],total,assigned};
  }
  function normalizedAssignment(section,choice){
    const groupId=String(choice.groupId||'');
    const group=section.groups.find(g=>g.id===groupId);
    const u=group&&positive(group.u)?group.u:number(choice.u);
    return {groupId,u,temperature:number(choice.temperature),confirmed:choice.confirmed===true,...(choice.attic?{attic:choice.attic}:{})};
  }
  function setAssignment(id,choice,notify=true){
    const section=sectionFor(id);if(!section)return false;
    const assignment=normalizedAssignment(section,choice);
    if(section.target==='ceiling'&&!choice.attic)window.boundaryAttic?.manualOverride();
    invalidateCache();state.assignments.set(String(id),assignment);state.revision++;
    if(notify)emit('assignment-changed');
    return assignmentValid(section,assignment);
  }
  function sameAssignment(section,a,b){
    return !!a&&!!b&&a.groupId===b.groupId&&a.u===b.u&&(section.target!=='ceiling'||a.temperature===b.temperature&&a.confirmed===b.confirmed);
  }
  function facePending(section,id){return state.faceDrafts.has(id)&&!sameAssignment(section,state.assignments.get(id),normalizedAssignment(section,state.faceDrafts.get(id)));}
  function sectionPending(section){return state.bulkDirty.has(section.target)&&!bulkStatus(section).applied||section.faces.some(f=>facePending(section,faceId(f)));}
  function bulkChoice(section){
    if(state.bulkDrafts.has(section.target))return state.bulkDrafts.get(section.target);
    const choices=section.faces.map(f=>state.assignments.get(faceId(f))),first=choices[0];
    return first&&choices.every(a=>sameAssignment(section,first,a))?first:{};
  }
  function bulkStatus(section){
    const assigned=section.faces.filter(f=>assignmentValid(section,state.assignments.get(faceId(f)))).length;
    const choice=normalizedAssignment(section,bulkChoice(section));
    const matches=section.faces.length>0&&assignmentValid(section,choice)&&section.faces.every(f=>sameAssignment(section,choice,state.assignments.get(faceId(f))));
    if(matches)return {applied:true,text:'反映済み：'+section.label+' '+assigned+'面 ／ U='+choice.u+' W/m²K'+(section.target==='ceiling'?' ／ 上側温度 '+choice.temperature+'℃':'')+'。'};
    if(state.bulkDirty.has(section.target))return {applied:false,text:'変更が未反映です。'+section.label+'の仕様・数値を確認して反映してください。適用済み '+assigned+' / '+section.faces.length+'面。'};
    if(assigned>0&&assigned===section.faces.length)return {applied:false,text:'面ごとに異なる設定が反映されています。まとめて変更する場合だけ、仕様を選んで反映してください。'};
    return {applied:false,text:'現在の設定済み '+assigned+' / '+section.faces.length+'面。入力欄の設定を使うには、反映ボタンを押してください。'};
  }
  function updateBulkStatus(section){
    const host=document.getElementById('atThermalReview'),el=host&&host.querySelector&&[...host.querySelectorAll('[data-thermal-status]')].find(e=>e.dataset.thermalStatus===section.target);
    if(el){const status=bulkStatus(section);el.textContent=status.text;el.dataset.applied=String(status.applied);el.dataset.state=status.applied?'applied':'pending';}
  }
  function reservedColors(){
    const colors=typeof epShadeReservedColors==='function'?epShadeReservedColors().slice():[];
    if(typeof IDF_MESH_PALETTE!=='undefined')Object.values(IDF_MESH_PALETTE).forEach(c=>colors.push(c));
    if(typeof WINDOW_U_COLOR_PALETTE!=='undefined')WINDOW_U_COLOR_PALETTE.forEach(c=>colors.push(c));
    if(typeof SSL_FIXED_COLORS!=='undefined')SSL_FIXED_COLORS.forEach(c=>{const n=parseInt(String(c.hex).replace('#',''),16);colors.push({r:n>>16&255,g:n>>8&255,b:n&255});});
    if(typeof gainVolumeColor==='function')for(let i=0;i<128;i++)colors.push(gainVolumeColor(i));
    (state.mesh&&state.mesh.gainVolumes||[]).forEach(g=>{if(g.color)colors.push(g.color);});
    return colors;
  }
  function orientation(face){
    if(typeof atOrientFromFace==='function')return atOrientFromFace(face);
    return String(face.sslKey||'').replace(/^wall_/,'').split('#')[0];
  }
  function paramsFor(section,face,a){
    if(section.target==='ceiling')return [{id:54,label:'種類',fixed:'外気温と熱通過率'},{id:57,label:'小屋裏温度',fixed:String(a.temperature)},{id:58,label:'熱通過率',fixed:String(a.u)}];
    let params;
    if(section.target==='wall'){
      if(typeof sslWallParams!=='function')return null;
      params=sslWallParams(orientation(face));
    }else if(typeof SSL_CATEGORIES!=='undefined'){
      const category=SSL_CATEGORIES.find(c=>c.key===(section.target==='roof'?'roof':'floor_out'));
      params=category&&category.params;
    }
    if(!params)return null;
    return params.map(p=>p.id===58?{id:58,label:'熱通過率',fixed:String(a.u)}:{...p});
  }
  function buildCategories(){
    if(state.cache&&[...state.assignments.values()].some(a=>a.attic&&!window.boundaryAttic?.isFresh(a.attic)))invalidateCache();
    if(state.cache)return state.cache;
    const categories=[],byFace=new Map(),reserved=reservedColors(),groups=new Map();let cursor=0;
    const allocate=()=>{
      for(;cursor<3375;cursor++){
        const n=(cursor*157)%3375,c={r:8+(n%15)*17,g:8+(Math.floor(n/15)%15)*17,b:8+Math.floor(n/225)*17};
        if(reserved.every(p=>Math.max(Math.abs(c.r-p.r),Math.abs(c.g-p.g),Math.abs(c.b-p.b))>=25)&&[...retiredColors,...previousColors].every(p=>Math.max(Math.abs(c.r-p.r),Math.abs(c.g-p.g),Math.abs(c.b-p.b))>12)){cursor++;reserved.push(c);return c;}
      }
      return null;
    };
    state.sections.forEach(section=>section.faces.forEach(face=>{
      const id=faceId(face),a=state.assignments.get(id);if(!assignmentValid(section,a))return;
      const orient=section.target==='wall'?orientation(face):section.target;
      const signature=JSON.stringify([section.target,a.groupId,orient,a.u,a.temperature]);
      let category=groups.get(signature);
      if(!category){
        const color=allocate(),params=paramsFor(section,face,a);if(!color||!params)return;
        const index=categories.length+1;
        category={key:'at_spec:'+state.revision+':'+index,label:section.label+' / 割当 '+index+(section.target==='wall'?' / '+orient:''),params,color,priority:10,u:a.u,mat:'AT_THERMAL_'+state.revision+'_'+index};
        groups.set(signature,category);categories.push(category);
      }
      byFace.set(id,category);
    }));
    state.cache={categories,byFace,exported:false};return state.cache;
  }
  function inputControls(section,id,a={},bulk=false){
    if(bulk)a=bulkChoice(section);else a=state.faceDrafts.get(id)||a;
    const attr=bulk?'data-thermal-bulk="'+escape(section.target)+'"':'data-thermal-face="'+escape(id)+'"';
    const option=(value,label)=>'<option value="'+escape(value)+'"'+(a.groupId===value?' selected':'')+'>'+escape(label)+'</option>';
    const choices=section.groups.map((g,i)=>option(g.id,'仕様 '+(i+1)+(positive(g.u)?' / U='+g.u.toFixed(4):' / Uを入力'))).join('');
    const manual=section.target==='ceiling';
    const group=section.groups.find(g=>g.id===a.groupId);
    const fixed=group&&positive(group.u);
    return '<div class="pipe-row" '+attr+'>'+(manual?'<input type="hidden" data-thermal-key="groupId" value="__manual">':'<label>仕様<select data-thermal-key="groupId" aria-label="'+escape(section.label+' '+(bulk?'まとめて':'面 '+id)+' 仕様')+'">'+option('','仕様を選ぶ')+choices+option('__manual','U値を手入力')+'</select></label>')+
      '<label>断熱性能（U値）<span class="at-thermal-unit">W/m²K</span><input type="number" min="0" step="any" placeholder="資料にある数値" data-thermal-key="u" value="'+escape(fixed?group.u:a.u??'')+'"'+(fixed?' readonly':'')+'></label>'+
      (manual?'<label>天井の上の空間の温度<span class="at-thermal-unit">小屋裏温度・℃</span><input type="number" step="any" placeholder="解析条件として確認した温度" data-thermal-key="temperature" value="'+escape(a.temperature??'')+'"></label><label class="at-thermal-confirm"><input type="checkbox" data-thermal-key="confirmed"'+(a.confirmed?' checked':'')+'>対象の天井'+(bulk?'すべて':'')+'の上が小屋裏であることを確認しました</label>':'')+
      '</div>'+ (bulk?'<div class="boundary-action-bar" data-boundary-action="thermal:'+escape(section.target)+'"><p class="at-thermal-bulk-status boundary-action-status" data-thermal-status="'+escape(section.target)+'" data-applied="'+bulkStatus(section).applied+'" data-state="'+(bulkStatus(section).applied?'applied':'pending')+'" role="status">'+escape(bulkStatus(section).text)+'</p><button type="button" data-thermal-apply="'+escape(section.target)+'">'+escape(section.label)+' '+section.faces.length+'面に反映する</button></div>':
      '<div class="boundary-action-bar" data-boundary-action="face:'+escape(id)+'"><p class="boundary-action-status" role="status" data-state="'+(facePending(section,id)?'pending':assignmentValid(section,state.assignments.get(id))?'applied':'pending')+'">'+escape(facePending(section,id)?'この面の変更は未反映です。':assignmentValid(section,state.assignments.get(id))?'反映済み：'+section.label+' ／ U='+state.assignments.get(id).u+' W/m²K'+(section.target==='ceiling'?' ／ 上側温度 '+state.assignments.get(id).temperature+'℃':''):'この面の仕様・数値を確認して反映してください。')+'</p><button type="button" data-thermal-face-apply="'+escape(id)+'">この面に反映する</button></div>');
  }
  function render(){
    live();const host=document.getElementById('atThermalReview');if(!host)return;
    const sameView=renderedSource===state.source&&renderedMesh===state.mesh&&renderedSignature===state.signature;
    const opened=new Set(sameView&&host.querySelectorAll?[...host.querySelectorAll('[data-thermal-detail][open]')].map(el=>el.dataset.thermalDetail):[]);
    const active=sameView&&document.activeElement,row=active&&host.contains&&host.contains(active)&&active.closest('[data-thermal-face],[data-thermal-bulk]');
    const action=active?.dataset?.thermalApply,faceAction=active?.dataset?.thermalFaceApply;
    const focus=row?{face:row.dataset.thermalFace,bulk:row.dataset.thermalBulk,key:active.dataset.thermalKey}:null;
    const atticFocus=active&&host.contains&&host.contains(active)?{key:active.dataset.atticKey,apply:active.hasAttribute('data-attic-apply')}:null;
    renderedSource=state.source;renderedMesh=state.mesh;renderedSignature=state.signature;
    host.hidden=!state.sections.length||(typeof appMode!=='undefined'&&!!appMode&&appMode!=='architrend');if(host.hidden){host.innerHTML='';return;}
    const report=assess();
    const categoryUnavailable=report.ready&&report.total&&buildCategories().byFace.size!==report.total;
    host.innerHTML='<h3>断熱の設定を、資料と見比べましょう。</h3><p>場所によって断熱材が違う場合は、同じ設定にまとめず、それぞれに指定します。</p><p class="at-thermal-progress" role="status">設定済み '+report.assigned+' / '+report.total+'面</p>'+(categoryUnavailable?'<p role="alert">出力用の色・カテゴリを安全に生成できません。値と配布ファイルを確認し、ツールを開き直して3DSと色対応CSVを作り直してください。</p>':'')+state.sections.map(section=>{
      if(!section.faces.length)return '<section data-thermal-section="'+escape(section.target)+'"><h4>'+escape(section.label)+'</h4><p role="alert">'+(section.target==='ceiling'?'実際の天井面がありません。ARCHITRENDから天井を含む3DSを書き出し直してください。屋根面では代用できません。':'対象となる面がありません。3DSの部位分類と外皮形状を確認してください。')+'</p></section>';
      if(section.target==='ceiling'&&window.boundaryAttic)return '<section class="at-thermal-card" data-thermal-section="ceiling">'+window.boundaryAttic.html(section,state.source,state.mesh,inputControls(section,'',{},true))+'<details class="at-thermal-details" data-thermal-detail="ceiling"><summary>詳細：天井を面ごとに直接指定（'+section.faces.length+'面）</summary>'+section.faces.map((face,i)=>'<fieldset><legend>天井 '+(i+1)+' / ID '+escape(faceId(face))+'</legend>'+inputControls(section,faceId(face),state.assignments.get(faceId(face))||{})+'</fieldset>').join('')+'</details></section>';
      return '<section class="at-thermal-card" data-thermal-section="'+escape(section.target)+'"><h4>'+escape(section.label)+'</h4>'+(section.target==='ceiling'?'<div class="at-thermal-explainer"><img src="assets/architrend/attic.svg" width="660" height="300" alt="屋根の下の空間が小屋裏。その下の天井にU値と小屋裏温度を設定します。階の間の天井とは区別します。"><div><b>「小屋裏」は、屋根と天井の間の空間です。</b><p>この欄は、その空間に接する天井のための設定です。まず図面や断熱仕様書で、断熱材の位置を確認してください。</p><p><b>U値：</b>熱の通りやすさ。小さいほど熱が伝わりにくくなります。資料の「天井」の値を使います。</p><p><b>温度：</b>小屋裏の解析条件です。分からないときは設計者に確認し、確認できるまで空欄にしておきます。</p></div></div><p class="at-thermal-notice">1階と2階の間など、上に部屋がある天井にこの設定は使いません。まとめて反映する前に、対象のすべてが小屋裏に接していることを確認してください。屋根のU値・外気温で代用しないでください。</p>':'')+'<p class="at-thermal-step">① 数値を確認して入力 → ② 対象を確認 → ③ 設定を反映</p>'+inputControls(section,'',{},true)+'<details class="at-thermal-details" data-thermal-detail="'+escape(section.target)+'"><summary>面ごとに確認・違う設定を使う（'+section.faces.length+'面）</summary>'+section.faces.map((face,i)=>'<fieldset><legend>面 '+(i+1)+' / '+escape(section.target==='wall'?orientation(face):section.label)+' / ID '+escape(faceId(face))+'</legend>'+inputControls(section,faceId(face),state.assignments.get(faceId(face))||{})+'</fieldset>').join('')+'</details></section>';
    }).join('')+'<p class="at-thermal-after">設定を変えたら、色分け3DSを出力し直し、FDから色対応CSVを取り直してください。</p>';
    if(window.boundaryAttic&&host.querySelector)window.boundaryAttic.bind(host);
    if(host.querySelectorAll){
      host.querySelectorAll('[data-thermal-detail]').forEach(el=>{el.open=opened.has(el.dataset.thermalDetail);});
      if(focus){
        const replacement=[...host.querySelectorAll('[data-thermal-face],[data-thermal-bulk]')].find(el=>el.dataset.thermalFace===focus.face&&el.dataset.thermalBulk===focus.bulk);
        replacement?.querySelector('[data-thermal-key="'+focus.key+'"]')?.focus({preventScroll:true});
      }
      if(action)host.querySelector('[data-thermal-apply="'+action+'"]')?.focus({preventScroll:true});
      if(faceAction)[...host.querySelectorAll('[data-thermal-face-apply]')].find(el=>el.dataset.thermalFaceApply===faceAction)?.focus({preventScroll:true});
      if(atticFocus?.key||atticFocus?.apply)host.querySelector(atticFocus.apply?'[data-attic-apply]':'[data-attic-key="'+atticFocus.key+'"]')?.focus({preventScroll:true});
    }
    if(typeof refreshArchitrendEnvelopeHints==='function')refreshArchitrendEnvelopeHints();
  }
  function choiceFrom(container){
    const get=key=>container.querySelector('[data-thermal-key="'+key+'"]');
    return {groupId:get('groupId').value,u:get('u').value,temperature:get('temperature')&&get('temperature').value,confirmed:!!(get('confirmed')&&get('confirmed').checked)};
  }
  function bind(){
    const host=document.getElementById('atThermalReview');if(!host)return;
    host.addEventListener('input',event=>{
      const row=event.target.closest('[data-thermal-bulk],[data-thermal-face]');if(!row)return;
      if(row.dataset.thermalFace){state.faceDrafts.set(row.dataset.thermalFace,choiceFrom(row));const status=row.nextElementSibling?.querySelector('.boundary-action-status');if(status){status.textContent='この面の変更は未反映です。「この面に反映する」を押してください。';status.dataset.state='pending';}return;}
      const section=state.sections.find(s=>s.target===row.dataset.thermalBulk);if(!section)return;
      state.bulkDrafts.set(section.target,choiceFrom(row));state.bulkDirty.add(section.target);updateBulkStatus(section);
    });
    host.addEventListener('change',event=>{
      const bulk=event.target.closest('[data-thermal-bulk]');
      if(bulk){
        const section=state.sections.find(s=>s.target===bulk.dataset.thermalBulk),choice=choiceFrom(bulk);
        const group=section&&section.groups.find(g=>g.id===choice.groupId),input=bulk.querySelector('[data-thermal-key="u"]');
        input.readOnly=!!(group&&positive(group.u));if(input.readOnly)input.value=String(group.u);
        state.bulkDrafts.set(section.target,choiceFrom(bulk));state.bulkDirty.add(section.target);updateBulkStatus(section);
        return;
      }
      const row=event.target.closest('[data-thermal-face]');if(!row)return;
      live();const section=sectionFor(row.dataset.thermalFace);if(!section)return;
      const choice=choiceFrom(row),group=section.groups.find(g=>g.id===choice.groupId),input=row.querySelector('[data-thermal-key="u"]');input.readOnly=!!(group&&positive(group.u));if(input.readOnly)input.value=String(group.u);
      state.faceDrafts.set(row.dataset.thermalFace,choiceFrom(row));
      const status=row.nextElementSibling?.querySelector('.boundary-action-status');if(status){status.textContent='この面の変更は未反映です。「この面に反映する」を押してください。';status.dataset.state='pending';}
    });
    host.addEventListener('click',event=>{
      const button=event.target.closest('[data-thermal-apply],[data-thermal-face-apply]');if(!button)return;
      const face=button.dataset.thermalFaceApply,bar=button.closest('[data-boundary-action]'),row=bar?.previousElementSibling;
      if(!row)return;
      const section=face?sectionFor(face):state.sections.find(s=>s.target===button.dataset.thermalApply),choice=choiceFrom(row);
      if(!section||!assignmentValid(section,normalizedAssignment(section,choice))){const status=bar.querySelector('.boundary-action-status');if(status){status.textContent='未反映：仕様と0より大きいU値'+(section?.target==='ceiling'?'、温度と確認チェック':'')+'を確認してください。適用済みの設定は変更していません。';status.dataset.state='error';}return;}
      if(face){state.faceDrafts.delete(face);setAssignment(face,choice);render();}else window.boundaryThermalAssignAll(button.dataset.thermalApply,choice);
    });
  }
  window.boundaryThermalReadiness=function(required,data){
    ensure(required||[],data);const report=assess();
    if(report.ready&&report.total&&buildCategories().byFace.size!==report.total)return {ready:false,codes:['THERMAL_CATEGORY_UNAVAILABLE']};
    return report;
  };
  window.boundaryThermalPalette=function(face){
    live();const category=buildCategories().byFace.get(faceId(face));
    return category?{...category.color,mat:category.mat,u:category.u,sslKey:category.key}:null;
  };
  window.boundaryThermalCategories=function(){live();return buildCategories().categories.map(c=>({...c,params:c.params.map(p=>({...p})),color:{...c.color}}));};
  window.boundaryThermalMarkExported=function(){live();const cache=buildCategories();cache.exported=true;return cache.categories.length;};
  window.boundaryThermalCategoryByColor=function(rgb){
    const color=Array.isArray(rgb)?{r:rgb[0],g:rgb[1],b:rgb[2]}:typeof rgb==='string'?(()=>{const n=rgb.split(/[ ,]+/).map(Number);return {r:n[0],g:n[1],b:n[2]};})():rgb;
    return window.boundaryThermalCategories().find(c=>color&&c.color.r===color.r&&c.color.g===color.g&&c.color.b===color.b)||null;
  };
  window.boundaryThermalAssign=function(id,choice){live();const valid=setAssignment(id,choice||{});render();return valid;};
  window.boundaryThermalAssignAll=function(target,choice){
    live();const section=state.sections.find(s=>s.target===target);if(!section)return false;
    choice=choice||{};
    const group=section.groups.find(g=>g.id===String(choice.groupId||''));
    state.bulkDrafts.set(target,{...choice,u:group&&positive(group.u)?group.u:choice.u??''});
    if(!section.faces.length||!assignmentValid(section,normalizedAssignment(section,choice))){state.bulkDirty.add(target);render();return false;}
    state.bulkDirty.delete(target);section.faces.forEach(f=>state.faceDrafts.delete(faceId(f)));
    let valid=section.faces.length>0;section.faces.forEach(face=>{if(!setAssignment(faceId(face),choice||{},false))valid=false;});
    emit('bulk-assignment-changed');render();return valid;
  };
  window.boundaryThermalReset=function(){clear('reset');render();};
  window.boundaryThermalClimateChanged=function(){
    if([...state.assignments.values()].some(a=>a.attic)){invalidateCache();state.revision++;emit('attic-climate-changed');}
    render();
  };
  window.boundaryThermalRender=render;
  window.boundaryThermalSummary=function(target){
    live();const section=state.sections.find(s=>s.target===target);
    if(!section)return {total:0,assigned:0,ready:false,missing:true,settings:[]};
    const settings=new Map();let assigned=0;
    for(const face of section.faces){
      const a=state.assignments.get(faceId(face));if(!assignmentValid(section,a))continue;
      assigned++;const key=JSON.stringify([a.u,a.temperature]);
      if(!settings.has(key))settings.set(key,{u:a.u,temperature:a.temperature,count:0});settings.get(key).count++;
    }
    const pendingDraft=sectionPending(section)||target==='ceiling'&&window.boundaryAttic?.hasPendingDraft()===true;
    const stale=section.faces.some(f=>{const a=state.assignments.get(faceId(f));return a?.attic&&window.boundaryAttic?.isFresh(a.attic)!==true;});
    return {total:section.faces.length,assigned,ready:section.faces.length>0&&assigned===section.faces.length,pendingDraft,stale,settings:[...settings.values()]};
  };
  window.boundaryThermalSnapshot=function(){
    live();
    return {version:1,signature:state.signature,assignments:[...state.assignments],bulkDrafts:[...state.bulkDrafts],bulkDirty:[...state.bulkDirty],faceDrafts:[...state.faceDrafts],revision:state.revision,
      cache:state.cache?{categories:state.cache.categories,byFace:[...state.cache.byFace].map(([id,c])=>[id,c.key]),exported:state.cache.exported}:null,
      retiredColors:retiredColors.slice(),previousColors:previousColors.slice(),attic:window.boundaryAttic?.exportState()};
  };
  window.boundaryThermalRestore=function(saved){
    live();if(!saved||saved.version!==1||saved.signature!==state.signature)return false;
    state.assignments=new Map(saved.assignments||[]);state.bulkDrafts=new Map(saved.bulkDrafts||[]);
    state.faceDrafts=new Map(saved.faceDrafts||[]);state.bulkDirty=new Set(saved.bulkDirty||state.sections.filter(s=>state.bulkDrafts.has(s.target)&&!bulkStatus(s).applied).map(s=>s.target));
    state.revision=Number(saved.revision)||state.revision;
    retiredColors.splice(0,retiredColors.length,...(saved.retiredColors||[]));previousColors=(saved.previousColors||[]).slice();
    window.boundaryAttic?.restoreState(saved.attic);
    state.cache=null;
    if(saved.cache){const categories=saved.cache.categories||[],byKey=new Map(categories.map(c=>[c.key,c]));state.cache={categories,byFace:new Map((saved.cache.byFace||[]).filter(([,key])=>byKey.has(key)).map(([id,key])=>[id,byKey.get(key)])),exported:!!saved.cache.exported};}
    render();return true;
  };
  if(window.addEventListener){
    ['architrend-import-invalidated','architrend-model-invalidated'].forEach(name=>window.addEventListener(name,()=>{clear(name,false);render();}));
    ['architrend-data-ready','architrend-model-ready'].forEach(name=>window.addEventListener(name,render));
  }
  bind();render();
})();

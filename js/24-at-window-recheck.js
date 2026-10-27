// Diagnose orientation separately; transferring conditions always uses the existing strict matcher.
(function(global){
  'use strict';
  let modelInvalid=false,lastResult=null,autoNorthApplying=false,autoNorthQueued=false;
  const northAttempts=new WeakMap();
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const blank=value=>value==null||String(value).trim()==='';
  const etaValid=value=>finite(value)&&value>=0&&value<=1;
  const uValid=value=>finite(value)&&value>0;
  const hasGeometry=value=>!blank(value.atFaceId)||!blank(value.atMeshWindowIndex);
  function index(value,length){if(blank(value)||!/^\d+$/.test(String(value)))return null;const n=Number(value);return Number.isSafeInteger(n)&&n<length?n:null;}
  function sourceAz(window){return finite(window.az)?window.az:typeof AT_AZ!=='undefined'&&finite(AT_AZ[window.orient])?AT_AZ[window.orient]:null;}
  function modelAz(window){
    if(finite(window.az))return window.az;
    if(finite(window.face?.modelToolAz))return window.face.modelToolAz-(typeof atNorthDeg==='function'?atNorthDeg():0);
    return typeof AT_AZ!=='undefined'&&finite(AT_AZ[window.orient])?AT_AZ[window.orient]:null;
  }
  function context(){
    if(typeof appMode==='undefined'||appMode!=='architrend'||modelInvalid||typeof atMesh==='undefined'||!atMesh||typeof atLastParse==='undefined'||!atLastParse?.result)return null;
    if(typeof architrendImportReadiness!=='function'||typeof atAssignWindowsToRooms!=='function'||typeof atMatchWindowSet!=='function'||typeof atPdfWindowCandidates!=='function')return null;
    const status=architrendImportReadiness().status,source=atLastParse.result;
    if(!['ready','needs-review'].includes(status)||atMesh.windowMatchSource!==source||!Array.isArray(source.windows)||!source.windows.length)return null;
    const windows=atAssignWindowsToRooms(atMesh.meshFaces,atMesh.rooms,atMesh.stats);if(!windows.length)return null;
    return {mesh:atMesh,source,windows,matching:atMatchWindowSet(windows,source.windows)};
  }
  function inspect(ctx){
    const {windows,source,matching}=ctx,counts={source:source.windows.length,model:windows.length,totalPairs:windows.length*source.windows.length,floorPairs:0,strictPairs:0,orientationRelaxedPairs:0,orientationOnlyModel:0,sourceAzUnknown:source.windows.filter(w=>sourceAz(w)===null).length,
      unique:matching.hits.filter(h=>h?.method==='unique').length,equivalent:matching.hits.filter(h=>h?.method==='equivalent').length,sourceRemaining:source.windows.length-matching.used.size,modelRemaining:matching.hits.filter(h=>!h).length,etaMissing:matching.hits.filter(h=>!h||!etaValid(h.w.eta)).length};
    for(const window of windows){
      const floor=typeof csvFloor==='function'?csvFloor(window.floor):String(window.floor||'');
      counts.floorPairs+=source.windows.filter(w=>floor&&(typeof csvFloor==='function'?csvFloor(w.floor):String(w.floor||''))===floor).length;
      const strict=atPdfWindowCandidates(window,source.windows),az=modelAz(window);counts.strictPairs+=strict.length;
      // The temporary clones are only evidence of an orientation mismatch.
      // Unknown source directions are never supplied or guessed here.
      if(az===null)continue;
      const relaxed=atPdfWindowCandidates(window,source.windows.map(w=>sourceAz(w)===null?w:{...w,az}));
      counts.orientationRelaxedPairs+=relaxed.length;if(!strict.length&&relaxed.length)counts.orientationOnlyModel++;
    }
    const roomRows=[...document.querySelectorAll('.room-card .win-row')],queue=typeof atUnassignedWindows==='undefined'?[]:atUnassignedWindows;
    counts.roomLinked=windows.filter((_,i)=>roomRows.filter(row=>modelIndex(row.dataset||{},windows)===i).length===1&&!queue.some(w=>hasGeometry(w)&&modelIndex(w,windows)===i)).length;
    counts.roomPending=windows.length-counts.roomLinked;
    const codes=[];if(counts.orientationOnlyModel)codes.push('WINDOW_ORIENTATION_MISMATCH');if(counts.sourceAzUnknown)codes.push('WINDOW_SOURCE_DIRECTION_UNKNOWN');
    if(matching.reasons.some(r=>r==='MULTIPLE_DIFFERENT_CONDITIONS'))codes.push('WINDOW_MATCH_AMBIGUOUS');
    if(matching.reasons.some(r=>r==='SOURCE_MODEL_COUNT_MISMATCH'))codes.push('WINDOW_SOURCE_MODEL_COUNT_MISMATCH');
    return {ready:true,counts,codes};
  }
  const matchKey=ctx=>JSON.stringify([ctx.windows.map(modelAz),ctx.matching.hits.map(hit=>hit?[hit.i,hit.method]:null)]);
  global.boundaryWindowOrientationState=function(){const ctx=context();return ctx?inspect(ctx):{ready:false,counts:{},codes:['WINDOW_RECHECK_NOT_AVAILABLE']};};
  const sameAngle=(a,b)=>finite(a)&&finite(b)&&Math.abs(((a-b+540)%360+360)%360-180)<1e-4;
  function northReview(){return typeof atMesh!=='undefined'&&atMesh?atMesh.northMatchReview:null;}
  function northConfirmed(){
    const review=northReview(),current=typeof atNorthDeg==='function'?atNorthDeg():null;
    return !!review&&['manual','saved'].includes(review.kind)&&sameAngle(review.angle,current);
  }
  function northPlan(ctx){
    if(!ctx||typeof global.boundaryPlanNorthMatch!=='function')return {ready:false,autoEligible:false,status:'unavailable',counts:{},codes:['NORTH_MATCH_UNAVAILABLE'],candidates:[],proposedNorth:null};
    const currentNorth=typeof atNorthDeg==='function'?atNorthDeg():null,review=northReview(),contradictions=[];
    if(ctx.mesh.readiness?.ready===false)contradictions.push('NORTH_MODEL_REVIEW_REQUIRED');
    for(const window of ctx.windows){
      if(!window.roomKey)continue;const room=(ctx.mesh.rooms||[]).find(room=>room.key===window.roomKey);
      if(!room)contradictions.push('NORTH_ROOM_REFERENCE_CONFLICT');
      else if(csvFloor(room.floor)!==csvFloor(window.floor))contradictions.push('NORTH_ROOM_FLOOR_CONFLICT');
    }
    for(const room of ctx.mesh.rooms||[]){
      const source=Number.isInteger(room.pdfIndex)&&ctx.source.rooms?.[room.pdfIndex];
      if(source&&csvFloor(source.floor)&&csvFloor(room.floor)!==csvFloor(source.floor))contradictions.push('NORTH_ROOM_FLOOR_CONFLICT');
    }
    for(const row of document.querySelectorAll('.room-card .win-row')){
      const i=modelIndex(row.dataset||{},ctx.windows),field=row.querySelector('.wAz');
      if(i===null||field?.validity?.badInput||field&&!blank(field.value)&&!sameAngle(Number(field.value),modelAz(ctx.windows[i])))contradictions.push('NORTH_WINDOW_DIRECTION_PRESERVED');
    }
    for(const queued of typeof atUnassignedWindows==='undefined'?[]:atUnassignedWindows){
      if(!hasGeometry(queued))continue;const i=modelIndex(queued,ctx.windows);
      if(i===null||!blank(queued.wAz)&&!sameAngle(Number(queued.wAz),modelAz(ctx.windows[i])))contradictions.push('NORTH_WINDOW_DIRECTION_PRESERVED');
    }
    if([...document.querySelectorAll('#atUnassignedList .uRoom')].some(field=>field.value))contradictions.push('NORTH_WINDOW_DRAFT_PRESERVED');
    if(!document.getElementById('atNorthDeg')||typeof atSetNorthAngle!=='function')contradictions.push('NORTH_CONTROLS_UNAVAILABLE');
    const view=typeof reviewView==='function'?reviewView():null,preserveNorth=!!review||!!view?.restored||!sameAngle(currentNorth,0);
    return global.boundaryPlanNorthMatch(ctx.windows,ctx.source.windows,{currentNorth,candidates:atPdfWindowCandidates,match:atMatchWindowSet,floor:csvFloor,preserveNorth,contradictions:[...new Set(contradictions)]});
  }
  global.boundaryNorthMatchState=function(){return northPlan(context());};
  global.boundaryNorthReadiness=function(){
    const ctx=context(),plan=northPlan(ctx),blocked=!!ctx&&!northConfirmed()&&plan.codes.includes('NORTH_ROTATION_AMBIGUOUS');
    return {ready:!blocked,codes:blocked?['NORTH_ROTATION_AMBIGUOUS']:[],counts:plan.counts,
      message:blocked?'北方向の候補が複数あります。図面の北矢印を確認し、現在の北方向で確定してください。':''};
  };
  if(typeof global.architrendWindowReadiness==='function'){
    const previous=global.architrendWindowReadiness;
    global.architrendWindowReadiness=function(){const state=previous.apply(this,arguments),north=global.boundaryNorthReadiness();return north.ready?state:{...state,ready:false,codes:[...new Set([...(state.codes||[]),...north.codes])],message:north.message};};
  }
  function applyNorth(automatic){
    const ctx=context(),plan=northPlan(ctx);
    if(!ctx||!plan.ready||automatic&&!plan.autoEligible)return {...plan,applied:false};
    if(sameAngle(typeof atNorthDeg==='function'?atNorthDeg():null,plan.proposedNorth))return {...plan,applied:false};
    if(typeof syncUnassignedFromDom==='function')syncUnassignedFromDom();
    const previous=atNorthDeg(),previousReview=ctx.mesh.northMatchReview;
    ctx.mesh.northMatchReview={kind:automatic?'automatic':'manual',angle:plan.proposedNorth,evidence:'strict-window-set'};autoNorthApplying=true;
    try{
      atSetNorthAngle(plan.proposedNorth);
      const current=context();
      if(!current||current.mesh!==ctx.mesh||current.source!==ctx.source||current.matching.hits.some(hit=>!hit)||current.matching.used.size!==ctx.source.windows.length)throw new Error('NORTH_APPLY_FAILED');
      if(typeof global.boundaryRecheckWindows==='function')global.boundaryRecheckWindows();
      global.dispatchEvent(new CustomEvent('architrend-room-mapping-changed',{detail:{source:'north-window-match'}}));
      if(typeof saveStateDebounced==='function')saveStateDebounced();
      return {...plan,applied:true,automatic};
    }catch(error){
      atSetNorthAngle(previous);if(previousReview)ctx.mesh.northMatchReview=previousReview;else delete ctx.mesh.northMatchReview;
      return {...plan,ready:false,applied:false,codes:['NORTH_APPLY_FAILED']};
    }finally{autoNorthApplying=false;}
  }
  global.boundaryTryAutoNorth=function(){return applyNorth(true);};
  function scheduleNorth(ctx,plan){
    if(!plan.autoEligible||autoNorthQueued||autoNorthApplying||northAttempts.get(ctx.mesh)===ctx.source)return;
    autoNorthQueued=true;Promise.resolve().then(()=>{
      autoNorthQueued=false;const current=context();if(!current||current.mesh!==ctx.mesh||current.source!==ctx.source){if(current)render();return;}
      const fresh=northPlan(current);if(!fresh.autoEligible)return;northAttempts.set(current.mesh,current.source);global.boundaryTryAutoNorth();
    });
  }
  function modelIndex(target,windows){
    if(!blank(target.atFaceId)){const matches=windows.flatMap((w,i)=>String(w.face?.atFaceId)===String(target.atFaceId)?[i]:[]);return matches.length===1?matches[0]:null;}
    return index(target.atMeshWindowIndex,windows.length);
  }
  function numericSame(value,expected){return blank(expected)?blank(value):!blank(value)&&Number.isFinite(Number(value))&&Number(value)===Number(expected);}
  function sourceQueueUnchanged(queued,source,globalU,roomDraft){
    if(roomDraft)return false;
    const expected={wAz:source.az??'',wEta:source.eta??'',wArea:source.area??'',wU:uValid(source.u)?source.u:uValid(globalU)?globalU:''};
    return String(queued.wName??'')===String(source.id??'')&&Object.entries(expected).every(([key,value])=>numericSame(queued[key],value))&&['glassSel','attachSel'].every(key=>blank(queued[key])||String(queued[key])==='0');
  }
  function queueDrafts(){
    const drafts=new Map();if(typeof atUnassignedWindows==='undefined')return drafts;
    for(const row of document.querySelectorAll('#atUnassignedList .at-unassigned-row')){const queued=atUnassignedWindows[Number(row.dataset.idx)];if(queued)drafts.set(queued,row.querySelector('.uRoom')?.value||'');}
    return drafts;
  }
  // Reconnect only queued windows. Never recreate rooms or move a window that
  // the user already placed in a room card. Old backups may lack source indices.
  function recoverRoomLinks(ctx,targets,owners,drafts,counts,representedSources,duplicateSources){
    if(ctx.mesh.readiness?.ready===false||typeof addWindow!=='function')return;
    const records=new Map(),resolved=new Map(),remove=new Set();
    const choice=w=>drafts.get(w)||w.roomChoiceKey||w.roomChoice;
    for(const w of atUnassignedWindows||[]){
      if(hasGeometry(w))continue;
      let i=index(w.atSourceWindowIndex,ctx.source.windows.length);
      if(blank(w.atSourceWindowIndex)){
        const ids=ctx.source.windows.flatMap((s,j)=>String(s.id)===String(w.wName)?[j]:[]);
        if(ids.length===1)i=ids[0];
      }
      if(i===null)continue;
      if(!records.has(i))records.set(i,[]);records.get(i).push(w);
      if(sourceQueueUnchanged(w,ctx.source.windows[i],ctx.source.uWin,choice(w)))resolved.set(w,i);
    }
    for(const [i,windows]of records)if(windows.length>1){counts.duplicateSources++;duplicateSources.add(i);}
    for(let i=0;i<ctx.windows.length;i++){
      const mw=ctx.windows[i],hit=ctx.matching.hits[i];if(!hit)continue;
      if(blank(mw.face?.atFaceId)||ctx.windows.filter(w=>String(w.face?.atFaceId)===String(mw.face.atFaceId)).length!==1)continue;
      const linked=targets.filter(t=>t.i===i);
      if((owners.get(i)||0)>1)continue;
      const sourceRecords=records.get(hit.i)||[];
      if(sourceRecords.length>1)continue;
      const queued=linked[0]?.queued||(!linked.length&&sourceRecords.length===1&&resolved.has(sourceRecords[0])?sourceRecords[0]:null);
      if(!queued||choice(queued))continue;
      if([...document.querySelectorAll('.room-card .win-row')].some(row=>modelIndex(row.dataset||{},ctx.windows)===null&&row.querySelector('.wName')?.value===queued.wName))continue;
      const rooms=(ctx.mesh.rooms||[]).filter(r=>r.key&&r.key===mw.roomKey);
      if(rooms.length!==1)continue;const room=rooms[0];
      if(room.floorVoid||!(room.keep||room.habitable)||!csvFloor(room.floor)||csvFloor(room.floor)!==csvFloor(mw.floor))continue;
      const cards=[...document.querySelectorAll('.room-card')].filter(c=>c.dataset.atRoomKey===room.key);
      // Creating a missing card is safe only for an already named room that the
      // current model keeps. Existing cards and their input fields stay intact.
      if(cards.length>1)continue;
      let card=cards[0];
      if(!card&&!blank(room.name)&&typeof atAddRoomCardFromMesh==='function')card=document.getElementById(atAddRoomCardFromMesh(room));
      if(!card)continue;
      addWindow(card.id,{...queued,atFaceId:String(mw.face.atFaceId),atMeshWindowIndex:String(i),skipRerun:true});
      remove.add(queued);counts.roomAssigned++;
      representedSources.add(hit.i);
      if(!linked.length){
        resolved.delete(queued);counts.sourceQueueLinked++;
      }
    }
    // Mark legacy records only after proving their full unchanged source value.
    // The normal duplicate-removal pass can then retire a represented source.
    for(const [w,i]of resolved)if(blank(w.atSourceWindowIndex)&&records.get(i)?.length===1)w.atSourceWindowIndex=String(i);
    atUnassignedWindows=atUnassignedWindows.filter(w=>!remove.has(w));
  }
  global.boundaryRecheckWindows=function(){
    const ctx=context();if(!ctx)return {ready:false,counts:{},codes:['WINDOW_RECHECK_NOT_AVAILABLE']};
    const host=document.getElementById('atWindowRecheck'),visible=host?.getClientRects().length,top=visible?host.getBoundingClientRect().top:null,focused=document.activeElement?.id;
    const drafts=queueDrafts();if(typeof syncUnassignedFromDom==='function')syncUnassignedFromDom();
    const targets=[];for(const row of document.querySelectorAll('.room-card .win-row')){const i=modelIndex(row.dataset||{},ctx.windows);if(i!==null)targets.push({i,row});}
    for(const queued of typeof atUnassignedWindows==='undefined'?[]:atUnassignedWindows){if(!hasGeometry(queued))continue;const i=modelIndex(queued,ctx.windows);if(i!==null)targets.push({i,queued});}
    const owners=new Map();for(const target of targets)owners.set(target.i,(owners.get(target.i)||0)+1);
    const counts={etaFilled:0,uFilled:0,sourceQueueRemoved:0,sourceQueueDrafts:0,duplicateLinks:0,roomAssigned:0,sourceQueueLinked:0,duplicateSources:0},representedSources=new Set(),duplicateSources=new Set();
    for(const target of targets){
      if(owners.get(target.i)!==1){counts.duplicateLinks++;continue;}
      const hit=ctx.matching.hits[target.i];if(!hit)continue;
      representedSources.add(hit.i);
      for(const [key,value,valid,count]of [['wEta',hit.w.eta,etaValid,'etaFilled'],['wU',hit.w.u,uValid,'uFilled']]){
        if(!valid(value))continue;
        if(target.row){const field=target.row.querySelector('.'+key);if(field&&blank(field.value)&&!field.validity?.badInput){field.value=String(value);counts[count]++;}}
        else if(blank(target.queued[key])){target.queued[key]=String(value);counts[count]++;}
      }
      if(target.queued)target.queued.matchReason='';
    }
    recoverRoomLinks(ctx,targets,owners,drafts,counts,representedSources,duplicateSources);
    if(typeof atUnassignedWindows!=='undefined')atUnassignedWindows=atUnassignedWindows.filter(queued=>{
      if(hasGeometry(queued))return true;const i=index(queued.atSourceWindowIndex,ctx.source.windows.length);
      if(i===null||duplicateSources.has(i)||!ctx.matching.used.has(i)||!representedSources.has(i))return true;
      if(!sourceQueueUnchanged(queued,ctx.source.windows[i],ctx.source.uWin,drafts.get(queued)||queued.roomChoiceKey||queued.roomChoice)){counts.sourceQueueDrafts++;return true;}
      counts.sourceQueueRemoved++;return false;
    });
    const state=inspect(ctx),previous=ctx.mesh.windowMatchSummary||{};
    ctx.mesh.windowMatchSummary={...previous,unique:state.counts.unique,equivalent:state.counts.equivalent,sourceRemaining:state.counts.sourceRemaining,modelRemaining:state.counts.modelRemaining,solarMissing:state.counts.etaMissing,etaMissing:state.counts.etaMissing};
    const codes=[...state.codes];if(counts.sourceQueueDrafts)codes.push('WINDOW_SOURCE_DRAFT_REVIEW_REQUIRED');if(counts.duplicateLinks||counts.duplicateSources)codes.push('WINDOW_DUPLICATE_LINK');
    lastResult={mesh:ctx.mesh,source:ctx.source,key:matchKey(ctx),state:{ready:true,counts:{...state.counts,...counts},codes}};
    if(counts.etaFilled||counts.uFilled||counts.sourceQueueRemoved||counts.roomAssigned){
      // Existing listeners retire old outputs and schedule a local save; no room/model reconstruction is called.
      global.dispatchEvent(new CustomEvent('architrend-room-mapping-changed',{detail:{source:'window-recheck'}}));
      if(typeof runAll==='function')runAll();if(typeof refreshNeedManual==='function')refreshNeedManual();if(typeof saveStateDebounced==='function')saveStateDebounced();
    }
    if(typeof renderUnassignedWindows==='function')renderUnassignedWindows();
    for(const row of document.querySelectorAll('#atUnassignedList .at-unassigned-row')){const queued=atUnassignedWindows[Number(row.dataset.idx)],choice=row.querySelector('.uRoom'),draft=drafts.get(queued);if(choice&&draft)choice.value=draft;}
    if(focused==='atWindowRecheckBtn'){
      document.getElementById(focused)?.focus({preventScroll:true});
      if(top!==null&&host?.getClientRects().length)global.scrollBy(0,host.getBoundingClientRect().top-top);
    }
    return lastResult.state;
  };
  function render(){
    const anchor=document.getElementById('atWindowMatchSummary')||document.getElementById('atUnassignedBox');if(!anchor)return;
    let host=document.getElementById('atWindowRecheck');if(!host){host=document.createElement('div');host.id='atWindowRecheck';host.className='box';anchor.insertAdjacentElement('afterend',host);}
    const ctx=context();host.hidden=!ctx;if(!ctx){host.replaceChildren();lastResult=null;return;}
    const state=inspect(ctx),warning=state.counts.orientationOnlyModel>0;host.style.borderColor=warning?'#bd741a':'';host.style.background=warning?'#fff4df':'';
    host.innerHTML='<p role="status" style="margin:0 0 8px"><strong>'+ (warning?'北方向と資料方位のずれを確認':'窓と部屋の対応を確認')+'</strong></p>'+
      '<p class="small" style="margin:0 0 8px">部屋への割当 '+state.counts.roomLinked+'/'+state.counts.model+' 枚。'+(warning?'階・大きさは合いますが、方位が一致しない窓が '+state.counts.orientationOnlyModel+' 枚あります。モデルと資料の北方向を確認してください。':'階・方位・大きさが対応する窓は、3DS上の位置から部屋へ割り当てられます。')+' 部屋や発熱設定を作り直さず、窓の空欄のη0・U値も補います。入力済みの値・選択中の割当先は保持します。</p>'+
      '<div style="display:flex;flex-wrap:wrap;gap:8px"><button type="button" id="atWindowNorthCheck">モデルの北方向を確認</button><button type="button" id="atWindowRecheckBtn">窓を照合して部屋へ自動割当</button></div><p id="atWindowRecheckResult" class="small" role="status" style="margin:8px 0 0"></p>';
    const north=document.getElementById('atNorthDeg'),button=host.querySelector('#atWindowNorthCheck');button.hidden=!north;
    button.onclick=()=>{const input=document.getElementById('atNorthDeg');if(!input)return;for(let node=input.parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;input.scrollIntoView({block:'center'});input.focus({preventScroll:true});input.select();};
    host.querySelector('#atWindowRecheckBtn').onclick=global.boundaryRecheckWindows;
    const result=lastResult&&lastResult.mesh===ctx.mesh&&lastResult.source===ctx.source&&lastResult.key===matchKey(ctx)?lastResult.state:null;
    if(result)host.querySelector('#atWindowRecheckResult').textContent='部屋へ '+result.counts.roomAssigned+' 枚を割当。η0 '+result.counts.etaFilled+' 件、U値 '+result.counts.uFilled+' 件を補完。資料の未対応 '+result.counts.sourceRemaining+' 枚、3DS側の未対応 '+result.counts.modelRemaining+' 枚。'+(result.counts.sourceQueueDrafts?'編集済みの未割当資料は確認用に残しています。':'');
    if(typeof global.boundaryPlanNorthMatch!=='function')return;
    const plan=northPlan(ctx),review=northReview(),note=document.createElement('p');note.id='atNorthMatchNote';note.className='small';note.setAttribute('role','status');
    const angle=finite(plan.proposedNorth)?Number(plan.proposedNorth.toFixed(2))+'°':'';
    note.textContent=review?.kind==='automatic'&&plan.ready&&sameAngle(review.angle,plan.proposedNorth)?'窓全件の階・大きさ・複数の向きから北方向を自動調整しました。入力済みの窓条件は保持しています。':
      plan.ready&&plan.status==='preserved'?'北方向の入力・保存済みの設定を保持しています。窓全件から求めた候補は '+angle+' です。':
      plan.ready&&plan.status==='aligned'?'現在の北方向で、窓全件の厳密な照合が成立しています。':
      plan.autoEligible?'窓全件が一対一で一致する北方向を確認しました。未編集の北方向へ自動反映します。':
      plan.codes.includes('NORTH_ROTATION_AMBIGUOUS')?(northConfirmed()?'図面で確認した北方向を保持しています。窓配置だけでは北方向の候補を一つに絞れません。':'複数の北方向で同じ窓配置が成立します。図面の北矢印を確認し、モデルの北方向を指定してください。'):
      plan.codes.includes('NORTH_MODEL_ROOM_REVIEW_REQUIRED')?'部屋・階・手入力の方位に確認が必要です。入力済みの設定を保持し、北方向の自動変更を保留しています。':
      '窓の向き・大きさだけでは北方向を一意に判断できません。図面の北矢印か、確認した北方向を入力してください。';
    host.appendChild(note);
    if(plan.ready&&plan.status==='preserved'&&!sameAngle(typeof atNorthDeg==='function'?atNorthDeg():null,plan.proposedNorth)){
      const apply=document.createElement('button');apply.id='atNorthMatchApply';apply.type='button';apply.textContent='候補の '+angle+' を確認して使う';apply.onclick=()=>applyNorth(false);host.appendChild(apply);
    }
    if(plan.codes.includes('NORTH_ROTATION_AMBIGUOUS')&&!northConfirmed()){
      const confirm=document.createElement('button');confirm.id='atNorthMatchConfirm';confirm.type='button';confirm.textContent='図面の北矢印を確認し、現在の北方向で確定する';
      confirm.onclick=()=>{const current=context();if(!current||current.mesh!==ctx.mesh||current.source!==ctx.source)return;markManualNorth(atNorthDeg());
        global.dispatchEvent(new CustomEvent('architrend-room-mapping-changed',{detail:{source:'north-confirmed'}}));
        if(typeof refreshNeedManual==='function')refreshNeedManual();if(typeof saveStateDebounced==='function')saveStateDebounced();render();};host.appendChild(confirm);
    }
    scheduleNorth(ctx,plan);
  }
  if(typeof global.renderUnassignedWindows==='function'){const previous=global.renderUnassignedWindows;global.renderUnassignedWindows=function(){const value=previous.apply(this,arguments);render();return value;};}
  if(typeof global.setModeUI==='function'){const previous=global.setModeUI;global.setModeUI=function(){const value=previous.apply(this,arguments);render();return value;};}
  function markManualNorth(value){if(autoNorthApplying||typeof appMode==='undefined'||appMode!=='architrend'||typeof atMesh==='undefined'||!atMesh)return;atMesh.northMatchReview={kind:'manual',angle:finite(Number(value))?Number(value):typeof atNorthDeg==='function'?atNorthDeg():0,evidence:'user-input'};}
  if(typeof global.atSetNorthAngle==='function'){const previous=global.atSetNorthAngle;global.atSetNorthAngle=function(value){if(finite(Number(value)))markManualNorth(value);return previous.apply(this,arguments);};}
  if(typeof global.atRoomReviewState==='function'){const previous=global.atRoomReviewState;global.atRoomReviewState=function(){const state=previous.apply(this,arguments),review=typeof appMode!=='undefined'&&appMode==='architrend'?northReview():null;return state&&review?{...state,northMatchReview:{kind:review.kind,angle:review.angle}}:state;};}
  if(typeof global.atRestoreRoomReviewState==='function'){const previous=global.atRestoreRoomReviewState;global.atRestoreRoomReviewState=function(state){
    if(typeof appMode!=='undefined'&&appMode==='architrend'&&state&&finite(state.northDeg)&&typeof atMesh!=='undefined'&&atMesh){const review=state.northMatchReview;atMesh.northMatchReview=review&&['manual','automatic','saved'].includes(review.kind)&&sameAngle(review.angle,state.northDeg)?{kind:review.kind,angle:review.angle}:{kind:'saved',angle:state.northDeg};}
    return previous.apply(this,arguments);
  };}
  document.addEventListener('input',event=>{if(event.target?.id==='atNorthDeg'||event.target?.id==='atNorthRange')markManualNorth(event.target.value);});
  global.addEventListener('architrend-model-invalidated',()=>{modelInvalid=true;render();});
  global.addEventListener('architrend-model-ready',()=>{modelInvalid=false;render();});
  for(const event of ['architrend-data-ready','architrend-import-invalidated'])global.addEventListener(event,render);
  global.addEventListener('architrend-data-ready',event=>{
    if(!event.detail?.restored)return;
    Promise.resolve().then(()=>{if(typeof atLastParse!=='undefined'&&atLastParse?.applied!==false)global.boundaryRecheckWindows();});
  });
})(typeof window==='undefined'?globalThis:window);

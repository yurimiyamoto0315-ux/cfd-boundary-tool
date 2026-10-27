// User-requested room unions. Source meshes remain unchanged.
function atConfigureMergedRoom(plan,options){
  const room=plan.room,sources=plan.sourceSnapshots||[],catalog=options.catalog||[];
  const indices=[...new Set(sources.flatMap(r=>[r.pdfIndex,...(r.mergedPdfIndices||[])])).values()].filter(i=>Number.isInteger(i)&&i>=0&&i<catalog.length);
  const sameName=indices.filter(i=>catalog[i].name===options.name);
  const index=sameName.length===1?sameName[0]:indices.includes(room.pdfIndex)?room.pdfIndex:indices[0];
  room.pdfIndex=Number.isInteger(index)?index:null;
  room.pdfArea=catalog[index]?.area??null;room.pdfType=catalog[index]?.type||'';
  room.mergedPdfIndices=indices;room.mergedPdfRefs=indices.map(i=>({key:catalog[i].key,name:catalog[i].name,floor:catalog[i].floor}));
  room.name=String(options.name||'').trim();room.habitable=!!options.habitable;room.keep=room.habitable;
  room.inferredFloor=sources.some(r=>r.inferredFloor);
  room.floorFaceIds=[...new Set(sources.flatMap(r=>r.floorFaceIds||[]))];
  room.floorVoid=Number(room.floor)>1&&!!options.floorVoid;
  if(room.inferredFloor||room.floorVoid)room.floorReviewed=true;
  if(options.openingGapMm!==undefined&&String(options.openingGapMm).trim()!==''&&Number.isFinite(Number(options.openingGapMm)))room.openingGapMm=Number(options.openingGapMm);else delete room.openingGapMm;
  if(room.floorVoid){
    room.openingPreviousUse={habitable:!!options.habitable,keep:!!options.habitable,explicitGainTarget:false};
    if(plan.conditions?.fields)room.openingPreviousFields={...plan.conditions.fields};
  }
  if(room.floorVoid){room.habitable=false;room.keep=false;}
  const fields=plan.conditions?.fields;
  if(room.floorVoid&&fields){
    const hasGains=fields.occCount===''||Number(fields.occCount)*Number(fields.peopleSensRate)>0||Number(fields.occCount)*Number(fields.peopleMoistRate)>0||['equipSensRate','equipMoistRate','extraSens','extraMoist'].some(k=>Number(fields[k])>0);
    room.openingPreviousUse.explicitGainTarget=!options.habitable&&hasGains;
    room.openingPreviousUse.keep=!!options.habitable||hasGains;
  }
  room.explicitGainTarget=!!(!room.floorVoid&&!room.habitable&&fields&&(fields.occCount===''||Number(fields.occCount)*Number(fields.peopleSensRate)>0||Number(fields.occCount)*Number(fields.peopleMoistRate)>0||['equipSensRate','equipMoistRate','extraSens','extraMoist'].some(k=>Number(fields[k])>0)));
  room.manualAssignment=true;room.manualMerged=true;room.reviewed=true;room.matchSource='manual-merge';
  for(const key of ['pdfMatch','pdfMatchCandidates','roomMatch','roomMatchGroup','stair','stairPath','stairPathEdited','stairAutoNeedsReview','stairAutoSeedSignature'])delete room[key];
  room.stairManual=!!options.stair&&!room.floorVoid;room.stairOff=!room.stairManual;
  return room;
}
function atRoomMergeActive(){return !!reviewView().merge;}
function atBeginRoomMerge(presentation='editor',render=true){
  const room=reviewMesh()?.rooms.find(r=>r.key===reviewView().selected);
  if(!room||appMode!=='architrend')return;
  reviewView().merge={presentation,primaryKey:room.key,keys:[room.key],name:room.name||'',nameEdited:false,
    stair:typeof atIsStairRoom==='function'&&atIsStairRoom(room),stairEdited:false,habitable:!!room.habitable,heatEdited:false,floorVoid:!!room.floorVoid,openingGapMm:room.openingGapMm??''};
  reviewView().floor=String(room.floor);if(render)atRenderRoomViewer();
}
function atShiftSelectRoom(key){
  if(appMode!=='architrend')return atSelectViewerRoom(key);
  const room=reviewMesh()?.rooms.find(r=>r.key===key);if(!room)return;
  if(!atRoomMergeActive()){
    const primary=reviewMesh()?.rooms.find(r=>r.key===reviewView().selected);
    if(!primary||String(primary.floor)!==String(room.floor)){reviewView().selected=key;atRenderRoomViewer();return;}
    if(primary.key===key)return;
    atBeginRoomMerge('popup',false);
  }
  atToggleRoomMerge(key);
}
function atCancelRoomMerge(){reviewView().merge=null;atRenderRoomViewer();}
function atToggleRoomMerge(key){
  const state=reviewView().merge,room=reviewMesh()?.rooms.find(r=>r.key===key),primary=reviewMesh()?.rooms.find(r=>r.key===state?.primaryKey);
  if(!state||!room||!primary)return;
  if(String(room.floor)!==String(primary.floor))return;
  if(state.keys.includes(key))state.keys=state.keys.filter(k=>k!==key);else state.keys.push(key);
  if(!state.keys.includes(state.primaryKey)&&state.keys.length)state.primaryKey=state.keys[0];
  const sources=reviewMesh().rooms.filter(r=>state.keys.includes(r.key));
  if(!state.nameEdited)state.name=sources.find(r=>r.key===state.primaryKey)?.name||sources.find(r=>r.name)?.name||'';
  if(!state.stairEdited)state.stair=sources.some(r=>typeof atIsStairRoom==='function'&&atIsStairRoom(r));
  if(!state.heatEdited)state.habitable=sources.some(r=>r.habitable)||typeof isHabitableRoomName==='function'&&isHabitableRoomName(state.name);
  atRenderRoomViewer();
}
function atRoomMergeError(code){
  if(code==='ROOM_MERGE_SELECTION_INVALID')return '図または一覧で、結合する区画を2つ以上選んでください。';
  if(code==='ROOM_MERGE_NOT_ADJACENT'||code==='ROOM_MERGE_POINT_CONTACT')return '辺で接する区画を選んでください。離れた区画や角だけで接する区画は結合できません。';
  if(/FLOOR/.test(code))return '同じ階の区画を選んでください。';
  if(/HEIGHT/.test(code))return '床と天井の高さが異なるため結合できません。';
  if(code==='ROOM_MERGE_HOLE')return '囲まれた別の区画が残るため結合できません。結合する範囲を見直してください。';
  if(code==='MERGE_NAME_REQUIRED')return '結合後の部屋名を入力してください。';
  if(code==='MERGE_OPENING_GAP_INVALID')return '階間の厚みは0～2000 mmで入力してください。元データから取得する場合は空欄にしてください。';
  if(/^MERGE_CONDITIONS/.test(code))return '内部発熱の未入力値・人数・原単位を確認してください。入力済みの条件を保ったまま結合できません。';
  return '区画が重なる、または外形を一つにできないため結合できません。選択範囲を見直してください。';
}
function atCurrentRoomMergePlan(){
  const state=reviewView().merge;
  if(!state)return {ready:false,code:'ROOM_MERGE_SELECTION_INVALID'};
  const plan=atPlanRoomMerge(reviewMesh().rooms,state.keys,{primaryKey:state.primaryKey,name:state.name});
  if(!plan.ready)return plan;
  if(state.floorVoid&&String(state.openingGapMm??'').trim()!==''&&(!Number.isFinite(Number(state.openingGapMm))||Number(state.openingGapMm)<0||Number(state.openingGapMm)>2000))return {...plan,ready:false,code:'MERGE_OPENING_GAP_INVALID'};
  if(!state.name.trim())return {...plan,ready:false,code:'MERGE_NAME_REQUIRED'};
  const sources=plan.sourceSnapshots.map(room=>{
    const card=atRoomCard(room.key);let fields=null;
    if(card){fields={};for(const key of ['roomArea','occCount','peopleSensRate','peopleMoistRate','equipSensRate','equipMoistRate','extraSens','extraMoist'])fields[key]=card.querySelector('.'+key)?.value??'';}
    return {room,fields};
  });
  const conditions=atPlanMergedRoomConditions(sources,plan.room.area,{habitable:state.habitable,defaults:TOOL_DEFAULTS,primaryKey:state.primaryKey});
  if(!conditions.ready)return {...plan,ready:false,code:conditions.code};
  return {...plan,conditions};
}
function atRoomMergeEditorHtml(compact=false){
  const state=reviewView().merge,rooms=reviewMesh().rooms.filter(r=>state.keys.includes(r.key)),esc=escapeHtml;
  return `<div class="at-rv-selection">${compact?rooms.length+'区画を1室にまとめる':'① 結合する区画を選ぶ'}<span>${rooms.length}区画を選択中：${rooms.map(r=>'区画 '+atRoomNumber(r)).join('、')||'未選択'}</span></div>
    <label for="atMergeRoomName">② 結合後の部屋名</label><input id="atMergeRoomName" type="text" maxlength="100" value="${esc(state.name)}" placeholder="例：階段室、LDK">
    <label class="at-rv-check"><input id="atMergeStair" type="checkbox" ${state.stair?'checked':''}>階段室として使う</label>
    <label class="at-rv-check"><input id="atMergeHabitable" type="checkbox" ${state.habitable?'checked':''}>居室として発熱を入れる</label>
    ${compact?'<details class="at-rv-merge-options"><summary>吹抜けの設定・引き継ぐ内容</summary>':''}
    ${rooms.some(r=>Number(r.floor)>1)?`<label class="at-rv-check"><input id="atMergeFloorVoid" type="checkbox" ${state.floorVoid?'checked':''}>階段開口・吹抜け（上階床＋下階天井を抜く）</label><label for="atMergeOpeningGapMm">階間の厚み（mm、取得できない場合だけ入力）</label><input id="atMergeOpeningGapMm" type="number" min="0" max="2000" step="1" value="${esc(String(state.openingGapMm??''))}" placeholder="元データから自動取得">`:''}
    <p class="small">選択した区画を再クリックすると外せます。窓・人数・追加発熱を引き継ぎ、発熱の総量を保つよう原単位を再計算します。床なしの場合は独立した発熱領域を作らず、窓を未割当へ戻します。</p>${compact?'</details>':''}`;
}
function atRoomMergePopupHtml(){
  return `<div class="at-rv-merge-popup" role="dialog" aria-modal="false" aria-label="部屋を結合する"><span class="at-merge-badge">部屋の結合</span><div class="at-merge-popup-body">${atRoomMergeEditorHtml(true)}<p class="at-merge-tip">Shift＋クリックで追加・解除できます。Escでキャンセル。</p></div><div class="at-merge-popup-footer boundary-action-bar" data-boundary-action="merge"><p id="atRoomEditMessage" class="boundary-action-status" data-state="pending" role="status" aria-live="polite"></p><button type="button" class="at-rv-confirm" data-action="merge-apply" disabled>結合する</button><button type="button" class="at-rv-merge-cancel" data-action="merge-cancel">キャンセル</button></div></div>`;
}
function atRefreshRoomMergeStatus(){
  if(!atRoomMergeActive())return;
  const plan=atCurrentRoomMergePlan(),message=document.getElementById('atRoomEditMessage'),button=document.querySelector('[data-action="merge-apply"]');
  if(message)message.textContent=plan.ready?'結合後 '+plan.room.area.toFixed(2)+' m² ／ '+reviewView().merge.keys.length+'区画 → 1室'+(plan.conditions.warnings?.length?'。在室人数は未入力のまま引き継ぎます。':''):atRoomMergeError(plan.code);
  if(button)button.disabled=!plan.ready;
}
function atBindRoomMergeEditor(){
  if(!atRoomMergeActive())return;
  const state=reviewView().merge;
  const name=document.getElementById('atMergeRoomName');
  if(name)name.oninput=()=>{
    state.name=name.value;state.nameEdited=true;
    if(!state.stairEdited){state.stair=/階段/.test(state.name);document.getElementById('atMergeStair').checked=state.stair;}
    if(!state.heatEdited){state.habitable=typeof isHabitableRoomName==='function'&&isHabitableRoomName(state.name);document.getElementById('atMergeHabitable').checked=state.habitable;}
    atRefreshRoomMergeStatus();
  };
  const stair=document.getElementById('atMergeStair'),heat=document.getElementById('atMergeHabitable');
  if(stair)stair.onchange=()=>{state.stair=stair.checked;state.stairEdited=true;atRefreshRoomMergeStatus();};
  if(heat)heat.onchange=()=>{state.habitable=heat.checked;state.heatEdited=true;atRefreshRoomMergeStatus();};
  const floor=document.getElementById('atMergeFloorVoid');
  if(floor)floor.onchange=()=>{state.floorVoid=floor.checked;if(floor.checked){state.habitable=false;heat.checked=false;state.heatEdited=true;}atRefreshRoomMergeStatus();};
  const gap=document.getElementById('atMergeOpeningGapMm');
  if(gap)gap.oninput=()=>{state.openingGapMm=gap.validity.badInput?'INVALID':gap.value;atRefreshRoomMergeStatus();};
  atRefreshRoomMergeStatus();
}
function atApplyRoomMerge(){
  const plan=atCurrentRoomMergePlan();if(!plan.ready){atRefreshRoomMergeStatus();return;}
  const state=reviewView().merge;
  const merged=atConfigureMergedRoom(plan,{...state,catalog:reviewView().catalog});
  atSnapshotRoomEdit();
  // Move window rows before removing their old cards, preserving edited values.
  const cards=plan.sourceKeys.map(atRoomCard).filter(Boolean);
  const rows=cards.flatMap(card=>[...card.querySelectorAll('.win-row')]);
  let primary=atRoomCard(merged.key);
  if(!primary&&cards.length){primary=cards[0];primary.dataset.atRoomKey=merged.key;}
  if(primary){
    rows.forEach(row=>primary.querySelector('.winList').appendChild(row));
    cards.filter(card=>card!==primary).forEach(card=>card.remove());
  }
  reviewMesh().rooms=plan.rooms;reviewMesh().roomMatchPlan=null;reviewMesh().gainVolumes=null;
  if(typeof atRememberRoomOpening==='function')atRememberRoomOpening(merged);
  reviewView().selected=merged.key;reviewView().merge=null;reviewView().restored=false;
  for(const key of plan.sourceKeys)if(reviewView().editorDrafts)delete reviewView().editorDrafts[key];
  atSyncEditedRoom(merged);
  primary=atRoomCard(merged.key);
  if(primary)for(const [key,value] of Object.entries(plan.conditions.fields))primary.querySelector('.'+key).value=value;
  // A source with explicit non-zero gains still needs a card even if its name
  // is not in the living-room vocabulary.
  atSyncMeshWindowsToRooms();atUpdateRoomVolume();
  reviewView().pending=null;reviewView().pending=atRoomReviewState();
  window.dispatchEvent(new CustomEvent('architrend-room-mapping-changed'));
  atFinishRoomEdit();
  const message=document.getElementById('atRoomEditMessage');
  window.boundaryActionMessage?.(message,'結合しました：'+plan.sourceKeys.length+'区画 → '+merged.name+' ／ '+merged.area.toFixed(2)+' m²。「元に戻す」で結合前へ戻せます。'+(plan.conditions.warnings?.length?' 在室人数を確認してください。':'')+(merged.stairAutoNeedsReview?' 自動階段が区画外へ出るため、経路を調整するまで出力を停止しています。':''));
}
if(typeof module!=='undefined'&&module.exports)module.exports={atConfigureMergedRoom};

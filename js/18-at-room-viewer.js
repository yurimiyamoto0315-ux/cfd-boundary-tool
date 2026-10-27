const epRoomView = {floor:'1', selected:'', plan:false, yaw:-0.45, tilt:0.85,
  zoom:1, northDeg:0, catalog:[], pending:null, undo:[], drag:null, restored:false};
function reviewMesh(){
  if(typeof appMode!=='undefined' && appMode==='energyplus' && typeof epViewMesh!=='undefined' && epViewMesh && epViewMesh.meshFaces) return epViewMesh;
  return (typeof atMesh!=='undefined') ? atMesh : null;
}
function reviewView(){
  if(typeof appMode!=='undefined' && appMode==='energyplus') return epRoomView;
  return atRoomView;
}
function reviewHost(){
  const id=(typeof appMode!=='undefined' && appMode==='energyplus') ? 'epRoomViewer' : 'atRoomViewer';
  return document.getElementById(id);
}
function atCaptureRoomEditorDraft(){
  const host=reviewHost(),mesh=reviewMesh(),key=host?.dataset.editorRoomKey;
  if(!key||host._editorMesh!==mesh||typeof atRoomMergeActive==='function'&&atRoomMergeActive())return;
  const name=document.getElementById('atRoomNameEdit'),heat=document.getElementById('atRoomHeatTarget'),choice=document.getElementById('atRoomPdfChoice');if(!name||!heat)return;
  const view=reviewView();if(view.editorMesh&&view.editorMesh!==mesh)view.editorDrafts={};view.editorMesh=mesh;
  (view.editorDrafts||(view.editorDrafts={}))[key]={name:name.value,heat:heat.checked,pdf:choice?.value??'-1'};
}
function atRestoreRoomEditorDraft(room){
  const view=reviewView(),mesh=reviewMesh();if(view.editorMesh&&view.editorMesh!==mesh)view.editorDrafts={};view.editorMesh=mesh;
  const draft=view.editorDrafts?.[room?.key];if(!draft)return;
  const name=document.getElementById('atRoomNameEdit'),heat=document.getElementById('atRoomHeatTarget'),choice=document.getElementById('atRoomPdfChoice');
  if(name)name.value=draft.name;if(heat)heat.checked=room.floorVoid?false:draft.heat;if(choice&&[...choice.options].some(o=>o.value===draft.pdf))choice.value=draft.pdf;
  if(draft.name.trim()!==room.name||(!room.floorVoid&&draft.heat!==!!room.habitable)||Number(draft.pdf)!==(room.pdfIndex??-1))window.boundaryActionMessage?.(document.getElementById('atRoomEditMessage'),'部屋の変更は未確定です。下のボタンで確定してください。','pending');
}
// Room identity is editable independently of the inferred 3DS footprint.
// No network dependency: orthographic 3D projection of the imported mesh in SVG.
const atRoomView = {floor:'1', selected:'', plan:false, yaw:-0.45, tilt:0.85,
  zoom:1, northDeg:0, catalog:[], pending:null, undo:[], drag:null};
const AT_ROOM_COLORS = ['#70b4a4','#e4b76c','#8faed1','#ce91a3','#a8b878','#b09ac7','#79bfc9','#d4a284'];
const AT_ROOM_REVIEW_EXTRACTION_REVISION='room-extraction-20261023-3-opening';
function atReviewCopy(value){return JSON.parse(JSON.stringify(value));}
function atReviewNumber(value){const rounded=Math.round(value*1e6)/1e6;return Number.isFinite(value)&&Number.isFinite(rounded)?rounded:null;}
function atReviewRoomShape(room,full){
  if(!room||!Number.isFinite(room.z)||!Array.isArray(room.ring)||room.ring.length<3||room.ring.length>10000)return null;
  let points=room.ring.map(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)?[atReviewNumber(p.x),atReviewNumber(p.y)]:null);
  if(points.some(p=>!p||p.some(v=>v===null))||atReviewNumber(room.z)===null)return null;
  const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
  if(same(points[0],points[points.length-1]))points.pop();
  let changed=true;
  while(changed&&points.length>3){
    changed=false;
    for(let i=0;i<points.length;i++){
      const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length];
      if(same(a,b)||Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<1e-10&&
        (b[0]-a[0])*(b[0]-c[0])+(b[1]-a[1])*(b[1]-c[1])<=0){points.splice(i,1);changed=true;break;}
    }
  }
  if(points.length<3)return null;
  const variants=[];
  for(const ring of [points,points.slice().reverse()]){
    const minimum=ring.reduce((best,p)=>p[0]<best[0]||p[0]===best[0]&&p[1]<best[1]?p:best,ring[0]);
    ring.forEach((p,i)=>{if(same(p,minimum))variants.push(JSON.stringify(ring.slice(i).concat(ring.slice(0,i))));});
  }
  const geometry=[atReviewNumber(room.z),variants.sort()[0]];
  if(full){
    if(atReviewNumber(room.zTop)===null||atReviewNumber(room.area)===null||!(room.zTop>room.z)||!(room.area>0))return null;
    geometry.push(atReviewNumber(room.zTop),atReviewNumber(room.area));
  }
  return JSON.stringify(geometry);
}
function atReviewImportOptions(mesh){
  const options=mesh.reviewImportOptions||{};
  return {unit:String(options.unit??'auto'),storyCount:options.storyCount==null||options.storyCount==='auto'?'auto':Number(options.storyCount),
    upperFloorZMm:options.upperFloorZMm==null?null:Number(options.upperFloorZMm),effectiveUnit:String(mesh.unitInfo?.unit||mesh.unit||'')};
}
function atReviewExtraction(mesh){
  if(mesh.reviewExtraction)return mesh.reviewExtraction;
  mesh.reviewSourceRooms=atReviewCopy(mesh.rooms||[]);
  const rooms=(mesh.rooms||[]).map(r=>({key:String(r.key),shape:atReviewRoomShape(r,false),full:atReviewRoomShape(r,true),
    inferredFloor:!!r.inferredFloor,floorProjectionSource:String(r.floorProjectionSource||''),floorFaceIds:Array.isArray(r.floorFaceIds)?r.floorFaceIds.map(String).sort():[]})).sort((a,b)=>a.key.localeCompare(b.key));
  const extraction={revision:AT_ROOM_REVIEW_EXTRACTION_REVISION,options:atReviewImportOptions(mesh),rooms};
  // The complete canonical record is compared as well as this compact marker.
  const value=JSON.stringify(extraction);let hash=2166136261;
  for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619)>>>0;
  extraction.fingerprint=value.length.toString(16)+'-'+hash.toString(16);
  mesh.reviewExtraction=extraction;return extraction;
}
function atReviewEditableRoom(fresh,saved){
  const result=atReviewCopy(fresh);
  for(const key of ['name','habitable','keep','reviewed','manualAssignment','matchSource','pdfIndex','pdfArea','pdfType',
    'mergedPdfIndices','mergedPdfRefs','explicitGainTarget','stairManual','stairOff','stairPath','stairPathEdited']){
    if(Object.prototype.hasOwnProperty.call(saved,key)&&saved[key]!==undefined)result[key]=atReviewCopy(saved[key]);
  }
  if(saved.openingReviewRequired===true){result.openingReviewRequired=true;atReviewOpeningBackups(result,saved);}
  return result;
}
function atRememberRoomOpening(room){
  if(!room.floorVoid){delete room.floorOpeningSource;return;}
  const boundary=typeof atRoomOpeningSignature==='function'?atRoomOpeningSignature(room,reviewMesh()):null;
  if(typeof boundary==='string'&&boundary)room.floorOpeningSource={version:1,shape:atReviewRoomShape(room,false),boundary};
  else delete room.floorOpeningSource;
}
function atReviewOpeningBackups(fresh,saved){
  const previous=saved.openingPreviousUse;
  if(previous&&typeof previous==='object'){
    const use={};for(const key of ['habitable','explicitGainTarget','keep'])if(typeof previous[key]==='boolean')use[key]=previous[key];
    if(Object.keys(use).length)fresh.openingPreviousUse=use;
  }
  const fields=saved.openingPreviousFields;
  if(fields&&typeof fields==='object'){
    const values={};
    for(const key of ['roomArea','occCount','peopleSensRate','peopleMoistRate','equipSensRate','equipMoistRate','extraSens','extraMoist']){
      const value=fields[key];if(value===''||typeof value==='number'&&Number.isFinite(value)&&value>=0||typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0)values[key]=value;
    }
    if(Object.keys(values).length)fresh.openingPreviousFields=values;
  }
}
function atReviewMigrateOpening(fresh,saved){
  const source=saved.floorOpeningSource;
  if(!saved.floorVoid)return false;
  atReviewOpeningBackups(fresh,saved);
  const boundary=typeof atRoomOpeningSignature==='function'?atRoomOpeningSignature(fresh,reviewMesh()):null;
  if(!source||source.version!==1||source.shape!==atReviewRoomShape(fresh,false)||!boundary||source.boundary!==boundary){
    fresh.floorVoid=false;fresh.openingReviewRequired=true;
    fresh.stairManual=false;fresh.stairOff=true;delete fresh.stair;delete fresh.stairPath;delete fresh.stairPathEdited;
    return false;
  }
  fresh.floorVoid=true;fresh.floorReviewed=true;fresh.habitable=false;fresh.keep=false;fresh.explicitGainTarget=false;
  fresh.openingReviewRequired=false;
  fresh.stairManual=false;fresh.stairOff=true;delete fresh.stair;delete fresh.stairPath;delete fresh.stairPathEdited;
  fresh.floorOpeningSource=atReviewCopy(source);
  if(saved.openingGapMm===null||saved.openingGapMm===''||Number.isFinite(saved.openingGapMm)&&saved.openingGapMm>=0)fresh.openingGapMm=saved.openingGapMm;
  return true;
}
function atReviewOpeningCompatible(room,mesh){
  if(!room.floorVoid)return true;
  const source=room.floorOpeningSource;
  return !!(source&&source.version===1&&source.shape===atReviewRoomShape(room,false)&&typeof atRoomOpeningSignature==='function'&&
    source.boundary&&source.boundary===atRoomOpeningSignature(room,mesh));
}
function atReviewMergeLeaves(room,depth=0){
  if(!room||depth>24)return null;
  if(!room.manualMerged)return [room];
  if(!Array.isArray(room.mergeSources)||room.mergeSources.length<2)return null;
  const leaves=[];
  for(const source of room.mergeSources){const part=atReviewMergeLeaves(source,depth+1);if(!part)return null;leaves.push(...part);if(leaves.length>512)return null;}
  return leaves;
}
function atMigrateRoomReview(saved,freshRooms){
  let rooms=atReviewCopy(freshRooms),openingDiscardedCount=0;const used=new Set(),keyMap=Object.create(null),safeSaved=new Set();
  const locate=source=>{
    const signature=atReviewRoomShape(source,false);if(!signature)return null;
    const hits=freshRooms.filter(r=>!used.has(String(r.key))&&atReviewRoomShape(r,false)===signature);
    // Equal overlapping source regions are ambiguous even if one key matches.
    return hits.length===1?hits[0]:null;
  };
  for(const old of saved.filter(r=>r.manualMerged)){
    const leaves=atReviewMergeLeaves(old);if(!leaves)continue;
    const matches=leaves.map(locate);if(matches.some(r=>!r)||new Set(matches.map(r=>String(r.key))).size!==matches.length)continue;
    if(typeof atPlanRoomMerge!=='function')continue;
    const primaryLeaf=leaves.findIndex(r=>String(r.key)===String(old.key)),primary=matches[primaryLeaf>=0?primaryLeaf:0];
    const plan=atPlanRoomMerge(rooms,matches.map(r=>String(r.key)),{primaryKey:String(primary.key)});
    if(!plan.ready)continue;
    const merged=atReviewEditableRoom(plan.room,old);merged.manualMerged=true;merged.manualAssignment=true;
    const sources=plan.sourceSnapshots||[],projected=sources.filter(r=>r.inferredFloor);
    merged.inferredFloor=projected.length>0;
    merged.floorFaceIds=[...new Set(sources.flatMap(r=>Array.isArray(r.floorFaceIds)?r.floorFaceIds:[]))];
    const projectionSources=[...new Set(projected.map(r=>String(r.floorProjectionSource||'')).filter(Boolean))];
    merged.floorProjectionSource=projectionSources.includes('footprint-unconfirmed')?'footprint-unconfirmed':projectionSources.length===1?projectionSources[0]:projectionSources.length?'mixed-projection':'';
    // A matching footprint does not confirm a newly projected floor or void.
    merged.floorVoid=false;if(merged.inferredFloor)merged.floorReviewed=false;
    if(old.floorVoid&&!atReviewMigrateOpening(merged,old))openingDiscardedCount++;
    rooms=plan.rooms.map(r=>r.key===merged.key?merged:r);
    matches.forEach(r=>used.add(String(r.key)));keyMap[String(old.key)]=String(merged.key);safeSaved.add(old);
  }
  for(const old of saved.filter(r=>!r.manualMerged)){
    const fresh=locate(old);if(!fresh)continue;
    const restored=atReviewEditableRoom(fresh,old);rooms=rooms.map(r=>r.key===fresh.key?restored:r);
    if(old.floorVoid&&!atReviewMigrateOpening(restored,old))openingDiscardedCount++;
    used.add(String(fresh.key));keyMap[String(old.key)]=String(fresh.key);safeSaved.add(old);
  }
  return {rooms,keyMap,restoredCount:safeSaved.size,discardedCount:saved.length-safeSaved.size,openingDiscardedCount};
}
function atReconcileRestoredRoomCards(){
  const mesh=reviewMesh(),compat=mesh&&mesh.reviewCardCompatibility;
  if(appMode!=='architrend'||!compat||compat.reconciled)return;
  compat.reconciled=true;
  const queued=typeof atUnassignedWindows!=='undefined'?atUnassignedWindows:[];
  const claimed=new Set();
  document.querySelectorAll('.room-card').forEach(card=>{
    const key=card.dataset.atRoomKey;if(!key)return;
    const target=Object.prototype.hasOwnProperty.call(compat.keyMap,key)?compat.keyMap[key]:null;
    if(target&&!claimed.has(target)){card.dataset.atRoomKey=target;claimed.add(target);return;}
    card.querySelectorAll('.win-row').forEach(row=>{
      const win=atWindowRowData(row);
      const prior=win.atFaceId?queued.findIndex(w=>w.atFaceId===win.atFaceId):-1;
      if(prior>=0)queued[prior]=win;else queued.push(win);
    });
    if(typeof card.remove==='function')card.remove();
  });
  if(typeof atUnassignedWindows!=='undefined')atUnassignedWindows=queued;
  for(const room of mesh.rooms||[]){
    let card=atRoomCard(room.key);
    if(!card&&room.keep&&typeof atAddRoomCardFromMesh==='function'){atAddRoomCardFromMesh(room);card=atRoomCard(room.key);}
    const name=card&&card.querySelector('.roomName');if(name)name.value=room.name||'';
  }
  if(typeof atSyncMeshWindowsToRooms==='function')atSyncMeshWindowsToRooms();
  if(typeof atAssignableRooms!=='undefined')atAssignableRooms=(mesh.rooms||[]).filter(r=>r.keep||r.habitable).map(r=>Object.assign({},r));
}
function atRoomReviewRestoreNotice(){
  const code=reviewMesh()?.reviewRestoreStatus?.code;
  if(code==='ROOM_REVIEW_OPTIONS_CHANGED')return '読込設定が変わったため、保存済みの区画・条件は復元していません。各階を確認してください。 ';
  if(code==='ROOM_REVIEW_OUTDATED_PARTIAL')return '部屋の読取り結果が変わりました。形が一致した区画の編集だけ引き継いでいます。各階の部屋と条件を確認してください。 ';
  if(code==='ROOM_REVIEW_OUTDATED_IGNORED')return '保存済みの区画と現在の読取り結果が一致しないため、新しい区画を使用しています。各階の部屋と条件を確認してください。 ';
  return '';
}
function atViewerPdfIndices(room){
  return typeof atRoomPdfIndices==='function'?atRoomPdfIndices(room):[room.pdfIndex,...(room.mergedPdfIndices||[])].filter(i=>Number.isInteger(i)&&i>=0);
}

function atSetRoomCatalog(rooms){
  if(!Array.isArray(rooms))return;
  const before=reviewView().catalog||[];
  if(JSON.stringify(before)===JSON.stringify(rooms))return;
  const normalizeName=value=>(typeof normalizeArchitrendPlanRoomName==='function'&&normalizeArchitrendPlanRoomName(value))||String(value||'').normalize('NFKC').trim();
  const normalizeFloor=value=>typeof csvFloor==='function'?csvFloor(value):String(value||'').normalize('NFKC').replace(/(?:階|F)$/i,'');
  // A new plan changes list order. Reconcile confirmed identities by name/floor.
  const mesh=reviewMesh();
  if(mesh)(mesh.rooms||[]).forEach(r=>{
    if(!r.manualAssignment)return;
    if(r.manualMerged){
      const refs=r.mergedPdfRefs||atViewerPdfIndices(r).map(i=>before[i]).filter(Boolean);
      const indices=refs.map(ref=>{
        const keyed=rooms.map((p,i)=>({p,i})).filter(({p})=>ref.key&&p.key===ref.key);
        if(keyed.length===1)return keyed[0].i;
        const same=rooms.map((p,i)=>({p,i})).filter(({p})=>normalizeName(p.name)===normalizeName(ref.name)&&normalizeFloor(p.floor)===normalizeFloor(ref.floor));
        return same.length===1?same[0].i:null;
      }).filter(i=>Number.isInteger(i));
      r.mergedPdfIndices=[...new Set(indices)];
      r.mergedPdfRefs=r.mergedPdfIndices.map(i=>({key:rooms[i].key,name:rooms[i].name,floor:rooms[i].floor}));
    }
    if(!Number.isInteger(r.pdfIndex)||r.pdfIndex<0)return;
    const prior=before[r.pdfIndex],name=prior&&prior.name||r.name;
    const floor=normalizeFloor(prior&&prior.floor||r.floor||'');
    const candidates=rooms.map((p,i)=>({p,i})).filter(({p})=>normalizeName(p.name)===normalizeName(name)&&(!p.floor||!floor||normalizeFloor(p.floor)===floor));
    const keyed=prior&&prior.key?candidates.filter(({p})=>p.key===prior.key):[];
    const matched=keyed.length===1?keyed[0]:candidates.length===1?candidates[0]:null;
    r.pdfIndex=matched?matched.i:null;
    if(matched){r.pdfArea=matched.p.area;r.pdfType=matched.p.type||'';}
  });
  reviewView().catalog=JSON.parse(JSON.stringify(rooms));
}
function atRoomReviewState(){
  if(!reviewMesh() || !reviewMesh().reviewHash) return reviewView().pending;
  return {version:4, hash:reviewMesh().reviewHash, fileName:reviewMesh().fileName,extraction:atReviewCopy(atReviewExtraction(reviewMesh())),
    northDeg:reviewView().northDeg, rooms:JSON.parse(JSON.stringify(reviewMesh().rooms)), catalog:reviewView().catalog,
    parts:typeof atPartReviewData==='function'?atPartReviewData():null};
}
function atRestoreRoomReviewState(state){
  reviewView().pending=state && [1,2,3,4].includes(state.version) ? state : null;
  if(reviewView().pending) reviewView().catalog=reviewView().pending.catalog||[];
  if(reviewView().pending && isFinite(reviewView().pending.northDeg)) reviewView().northDeg=reviewView().pending.northDeg;
  atRestoreRoomAssignments();
}
function atRestoreRoomAssignments(){
  const s=reviewView().pending;
  if(!reviewMesh() || !s || !reviewMesh().reviewHash || s.hash!==reviewMesh().reviewHash) return false;
  const valid=Array.isArray(s.rooms) && s.rooms.every(r=>
    typeof r.key==='string' && Number.isFinite(r.floor) && Number.isFinite(r.z) &&
    Number.isFinite(r.zTop) && Number.isFinite(r.area) && Array.isArray(r.ring) &&
    r.ring.length>=3 && r.ring.every(p=>Number.isFinite(p.x) && Number.isFinite(p.y)));
  if(!valid||new Set(s.rooms.map(r=>r.key)).size!==s.rooms.length) return false;
  const mesh=reviewMesh(),extraction=atReviewExtraction(mesh),prior=s.extraction;
  if(prior&&JSON.stringify(prior.options)!==JSON.stringify(extraction.options)){
    mesh.reviewRestoreStatus={code:'ROOM_REVIEW_OPTIONS_CHANGED',restoredCount:0,discardedCount:s.rooms.length};
    mesh.reviewCardCompatibility={keyMap:{},reconciled:false};return false;
  }
  const complete=prior&&prior.revision===extraction.revision&&prior.fingerprint===extraction.fingerprint&&
    JSON.stringify(prior.rooms)===JSON.stringify(extraction.rooms)&&s.rooms.every(r=>atReviewOpeningCompatible(r,mesh));
  if(complete){
    mesh.rooms=atReviewCopy(s.rooms);mesh.reviewRestoreStatus={code:'ROOM_REVIEW_RESTORED',restoredCount:s.rooms.length,discardedCount:0};
    mesh.reviewCardCompatibility=null;
  }else{
    const migrated=atMigrateRoomReview(s.rooms,mesh.reviewSourceRooms||mesh.rooms);mesh.rooms=migrated.rooms;
    mesh.reviewRestoreStatus={code:migrated.discardedCount||migrated.openingDiscardedCount?'ROOM_REVIEW_OUTDATED_PARTIAL':'ROOM_REVIEW_MIGRATED',
      restoredCount:migrated.restoredCount,discardedCount:migrated.discardedCount,openingDiscardedCount:migrated.openingDiscardedCount};
    mesh.reviewCardCompatibility={keyMap:migrated.keyMap,reconciled:false};
    if(!migrated.restoredCount){mesh.reviewRestoreStatus.code='ROOM_REVIEW_OUTDATED_IGNORED';return false;}
  }
  if(typeof atNormalizeRoomStories==='function' && reviewMesh()===atMesh)
    reviewMesh().rooms=atNormalizeRoomStories(reviewMesh().rooms,reviewMesh().meshFaces);
  if(typeof atPartRestoreReview==='function') atPartRestoreReview(complete?s.parts:s.parts?Object.assign({},s.parts,{overrides:{}}):null);
  if(typeof atPlanStairsForMesh==='function') atPlanStairsForMesh(reviewMesh());
  if(typeof atApplyRoomGainFlags==='function') atApplyRoomGainFlags(reviewMesh());
  reviewMesh().gainVolumes=null;
  if(isFinite(s.northDeg)) reviewView().northDeg=s.northDeg;
  atApplyNorthToMesh();
  atUpdateRoomVolume();
  atRenderRoomViewer();
  reviewView().pending=atRoomReviewState();
  return true;
}
async function atRoomModelLoaded(buffer){
  const mesh=reviewMesh();if(!mesh)return;
  // Capture the new extractor's untouched rooms before any saved edit is read.
  atReviewExtraction(mesh);
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  if(reviewMesh()!==mesh)return;
  mesh.reviewHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  reviewView().undo=[];
  reviewView().merge=null;
  reviewView().selected='';
  reviewView().zoom=1;
  reviewView().restored=atRestoreRoomAssignments();
  if(!reviewView().restored){
    if(typeof atPartRestoreReview==='function') atPartRestoreReview(null);
    reviewView().northDeg=0;
    atApplyNorthToMesh();
    if(!atLastParse) reviewView().catalog=[];
  }
  atUpdateRoomVolume();
}
function atRoomTitle(r){ return (r.name || '未割当')+(r.floorVoid?'（階段開口・吹抜け）':''); }
function atRoomMatchNote(r){
  if(r.stairAutoNeedsReview)return '自動階段が区画外へ出るため出力を停止しています。図の階段経路を調整してください。';
  if(r.manualAssignment)return '手動で確定した割当を保持しています。';
  if(r.pdfMatch){
    const area=Number.isFinite(r.pdfMatch.areaDifference)?'（面積差 '+r.pdfMatch.areaDifference.toFixed(2)+' m²）':'';
    return r.pdfMatch.reason+area+'。平面図と位置を確認してください。';
  }
  if((r.pdfMatchCandidates||[]).length)return '面積・位置・隣接関係から対応を一意に判断できません。平面図の部屋を選んでください。';
  return '平面図と位置を確認し、対応する部屋を選んでください。';
}
function atRoomNumber(r){ return reviewMesh().rooms.indexOf(r)+1; }
function atRoomColor(r){ return AT_ROOM_COLORS[(atRoomNumber(r)-1)%AT_ROOM_COLORS.length]; }
function atUpdateRoomVolume(){
  if(!reviewMesh() || typeof atMeshLivingVolume!=='function') return 0;
  const total=atMeshLivingVolume(reviewMesh());
  const el=document.getElementById('roomVol');
  const tag=document.getElementById('roomVolTag');
  const info=document.getElementById('roomVolAutoInfo');
  if(total>0 && el){
    el.value=(Math.round(total*10)/10).toFixed(1);
    el.dataset.at3dsAuto='true';
    const wrap=el.closest('div');
    if(wrap){ wrap.classList.remove('field-user','need-manual'); wrap.classList.add('at-filled'); }
  }
  if(tag){ tag.textContent=total>0?'3DS自動':'要設定'; tag.className=total>0?'tag-at':'tag-req'; }
  if(info) info.textContent=total>0?'居室の床面積 × 認識階高（換気用。窓だけの非居室は含みません）':'3DSから部屋を認識すると自動入力します';
  return total;
}
function atClearRoomVolumeAuto(){
  const el=document.getElementById('roomVol');
  const tag=document.getElementById('roomVolTag');
  const info=document.getElementById('roomVolAutoInfo');
  if(el){ delete el.dataset.at3dsAuto; const wrap=el.closest('div'); if(wrap) wrap.classList.add('field-user'); }
  if(tag){ tag.textContent='要設定'; tag.className='tag-req'; }
  if(info) info.textContent='';
}
function atApplyNorthToMesh(){
  if(!reviewMesh()) return;
  const counts={};
  (reviewMesh().meshFaces||[]).forEach(f=>{
    if(/^wall_/.test(f.sslKey) && isFinite(f.modelToolAz)){
      const orient=at3dsOrientFromToolAz(at3dsWrap180(f.modelToolAz-reviewView().northDeg));
      const shade=String(f.sslKey).match(/#\d+$/);
      f.sslKey='wall_'+orient+(shade?shade[0]:'');
      f.nameJa='外壁'+orient;
    }
    if((f.atSourceDoor || f.atOriginalKey==='window' && typeof atParts!=='undefined' && atParts.overrides && atParts.overrides[String(f.atFaceId)]==='door') && isFinite(f.modelToolAz)){
      const orient=at3dsOrientFromToolAz(at3dsWrap180(f.modelToolAz-reviewView().northDeg));
      f.sslKey='extdoor_'+orient;
      f.nameJa='ドア';
      f.atReplacedByPart=false;
    }
    counts[f.nameJa]=(counts[f.nameJa]||0)+1;
  });
  if(reviewMesh().stats) reviewMesh().stats.counts=counts;
}
function atUpdateNorthAffectedWindows(){
  if(typeof appMode!=='undefined' && appMode==='energyplus' && typeof epSyncWindowAzimuths==='function') epSyncWindowAzimuths();
  if(!reviewMesh() || typeof atAssignWindowsToRooms!=='function') return;
  const wins=atAssignWindowsToRooms(reviewMesh().meshFaces,reviewMesh().rooms,reviewMesh().stats);
  atNorthExcludedCount=0;
  wins.forEach((w,i)=>{
    const row=document.querySelector('.win-row[data-at-mesh-window-index="'+i+'"]');
    if(row){
      const az=row.querySelector('.wAz');
      if(az) az.value=String(Math.round(w.az*10)/10);
    }
    atUnassignedWindows.forEach(u=>{
      if(String(u.atMeshWindowIndex)===String(i)) u.wAz=String(Math.round(w.az*10)/10);
    });
  });
  renderUnassignedWindows();
}
function atSetNorthAngle(value){
  const raw=Number(value);
  if(!isFinite(raw)) return;
  reviewView().northDeg=at3dsWrap180(raw);
  atApplyNorthToMesh();
  atUpdateNorthAffectedWindows();
  const num=document.getElementById('atNorthDeg');
  const range=document.getElementById('atNorthRange');
  if(num) num.value=String(Math.round(reviewView().northDeg*10)/10);
  if(range) range.value=String(reviewView().northDeg);
  atDrawRoomScene();
  if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
  runAll();
  saveStateDebounced();
}
function atRoomCard(key){
  return Array.from(document.querySelectorAll('.room-card')).find(c=>c.dataset.atRoomKey===key);
}
function atWindowRowData(row){
  const w={atMeshWindowIndex:row.dataset.atMeshWindowIndex||'',atFaceId:row.dataset.atFaceId||''};
  ['wName','wAz','glassSel','attachSel','wEta','wArea','wU'].forEach(k=>{
    const el=row.querySelector('.'+k); if(el) w[k]=el.value;
  });
  return w;
}
function atSyncMeshWindowsToRooms(){
  if(typeof appMode!=='undefined' && appMode==='energyplus') return;
  if(!reviewMesh() || typeof atAssignWindowsToRooms!=='function') return;
  if(typeof atApplyRoomGainFlags==='function') atApplyRoomGainFlags(reviewMesh());
  const meshWins=atAssignWindowsToRooms(reviewMesh().meshFaces,reviewMesh().rooms,reviewMesh().stats);
  const rows=new Map();
  document.querySelectorAll('.win-row[data-at-mesh-window-index]').forEach(row=>{
    const id=row.dataset.atFaceId||((row.dataset.atMeshWindowIndex!==undefined&&row.dataset.atMeshWindowIndex!=='')
      ?meshWins[Number(row.dataset.atMeshWindowIndex)]?.face?.atFaceId:null);
    if(id!=null){row.dataset.atFaceId=String(id);rows.set(String(id),row);}
  });
  const queued=new Map();
  (atUnassignedWindows||[]).forEach(w=>{
    const id=w.atFaceId||((w.atMeshWindowIndex!==undefined&&w.atMeshWindowIndex!=='')
      ?meshWins[Number(w.atMeshWindowIndex)]?.face?.atFaceId:null);
    if(id!=null&&id!=='') queued.set(String(id),w);
  });
  const nextUnassigned=(atUnassignedWindows||[]).filter(w=>!w.atFaceId && (w.atMeshWindowIndex===undefined || w.atMeshWindowIndex===''));
  const valid=new Set(meshWins.map(w=>String(w.face.atFaceId)));
  rows.forEach((row,id)=>{if(!valid.has(id)) row.remove();});
  meshWins.forEach((mw,i)=>{
    const index=String(i);
    const faceId=String(mw.face.atFaceId);
    const room=(reviewMesh().rooms||[]).find(r=>r.key===mw.roomKey);
    if(room && (room.keep || room.habitable) && !atRoomCard(room.key)){
      atAddRoomCardFromMesh(room);
    }
    const card=room && (room.keep || room.habitable) ? atRoomCard(room.key) : null;
    const row=rows.get(faceId);
    const saved=row ? atWindowRowData(row) : queued.get(faceId);
    if(row){row.dataset.atMeshWindowIndex=index;row.dataset.atFaceId=faceId;}
    if(card){
      if(row){
        const list=card.querySelector('.winList');
        if(row.parentElement!==list) list.appendChild(row);
      }else if(saved){
        addWindow(card.id,Object.assign({},saved,{atMeshWindowIndex:index,atFaceId:faceId,skipRerun:true}));
      }
    }else if(saved){
      if(!nextUnassigned.some(w=>String(w.atFaceId)===faceId)){
        nextUnassigned.push(Object.assign({},saved,{atMeshWindowIndex:index,atFaceId:faceId}));
      }
      if(row) row.remove();
    }
  });
  atUnassignedWindows=nextUnassigned;
  document.querySelectorAll('.room-card').forEach(card=>{
    const badge=card.querySelector('.room-window-link');
    if(!badge) return;
    const count=card.querySelectorAll('.win-row[data-at-mesh-window-index]').length;
    badge.textContent=count ? '3DS位置から自動 '+count+'枚' : '';
  });
  renderUnassignedWindows();
}
function atSnapshotRoomEdit(){
  reviewView().undo.push({rooms:JSON.parse(JSON.stringify(reviewMesh().rooms)), state:gatherState()});
  if(reviewView().undo.length>30) reviewView().undo.shift();
}
function atSyncEditedRoom(r){
  if(typeof atPlanStairsForMesh==='function') atPlanStairsForMesh(reviewMesh());
  if(typeof atApplyRoomGainFlags==='function') atApplyRoomGainFlags(reviewMesh());
  let card=atRoomCard(r.key);
  if(r.epZone && typeof epWriteRoomToCard==='function') epWriteRoomToCard(r);
  if(r.keep && !card && !(r.epZone && typeof appMode!=='undefined' && appMode==='energyplus')){ atAddRoomCardFromMesh(r); card=atRoomCard(r.key); }
  if(card && !r.keep && !(r.epZone && typeof appMode!=='undefined' && appMode==='energyplus')){
    card.querySelectorAll('.win-row').forEach(row=>{
      atUnassignedWindows.push(atWindowRowData(row));
    });
    card.remove();
    renderUnassignedWindows();
  }else if(card){
    card.querySelector('.roomName').value=r.name;
    if(typeof atSyncRoomCardKind==='function') atSyncRoomCardKind(card, r);
  }
  atAssignableRooms=reviewMesh().rooms.filter(r=>r.keep || r.habitable).map(r=>Object.assign({},r));
  reviewMesh().gainVolumes=atBuildGainVolumes(reviewMesh());
  if(typeof atCompleteRoomOpeningEdit==='function')atCompleteRoomOpeningEdit(r);
}
function atFinishRoomEdit(){
  atSyncMeshWindowsToRooms();
  atUpdateRoomVolume();
  runAll();
  if(appMode==='architrend')reviewView().pending=atRoomReviewState();
  saveStateNow();
  atRenderRoomViewer();
}
function atAssignPdfRoom(r,index){
  if(r.manualMerged&&r.pdfIndex!==index){r.mergedPdfIndices=[];r.mergedPdfRefs=[];}
  const p=reviewView().catalog[index];
  r.pdfIndex=p ? index : null;
  r.pdfArea=p ? p.area : null;
  r.pdfType=p ? p.type : '';
  r.name=p ? p.name : '';
  r.habitable=p ? isArchitrendLivingRoom(p) : false;
  r.manualAssignment=true;
  r.reviewed=false;
  delete r.pdfMatch;delete r.pdfMatchCandidates;delete r.roomMatch;delete r.roomMatchGroup;
  r.matchSource='manual';
}
function atRematchAfterRoomConfirmation(){
  if(typeof appMode!=='undefined'&&appMode!=='architrend')return;
  if(typeof atSpatialPlanRoomMatches!=='function'||!reviewMesh()||!reviewView().catalog.length)return;
  const rooms=reviewMesh().rooms||[],before=new Map(rooms.map(r=>[r.key,[r.name,!!r.keep,!!r.habitable].join('|')]));
  atMatchMeshRoomsToPdf(rooms,reviewView().catalog);
  for(const room of rooms){
    if(before.get(room.key)!==[room.name,!!room.keep,!!room.habitable].join('|'))atSyncEditedRoom(room);
  }
}
function atCommitRoomEdit(){
  const r=reviewMesh().rooms.find(r=>r.key===reviewView().selected);
  if(!r) return;
  const name=document.getElementById('atRoomNameEdit').value.trim();
  const message=document.getElementById('atRoomEditMessage');
  if(!name){
    message.textContent=reviewView().catalog.length?'部屋名を入力するか、PDFの部屋を選んでください。':'部屋名を入力してください。';message.dataset.state='error';
    return;
  }
  const choiceEl=document.getElementById('atRoomPdfChoice');
  const index=choiceEl?Number(choiceEl.value):-1;
  const habitable=document.getElementById('atRoomHeatTarget').checked;
  if(typeof atApplyRoomFloorEdit==='function'&&atApplyRoomFloorEdit(atReviewCopy(r))===false){
    message.textContent='開口の寸法を確認してください。変更はまだ反映していません。';message.dataset.state='error';return;
  }
  atSnapshotRoomEdit();
  // Selecting an occupied PDF identity swaps it, so the same PDF row is never silently duplicated.
  const other=index>=0 && reviewMesh().rooms.find(q=>q!==r && q.pdfIndex===index);
  if(other){
    atAssignPdfRoom(other,Number.isInteger(r.pdfIndex) ? r.pdfIndex : -1);
    if(!other.name)other.manualAssignment=false;
    atSyncEditedRoom(other);
  }
  atAssignPdfRoom(r,index);
  r.name=name;
  r.habitable=habitable;
  if(typeof atApplyRoomFloorEdit==='function')atApplyRoomFloorEdit(r);
  atRememberRoomOpening(r);
  r.reviewed=true;
  atSyncEditedRoom(r);
  atRematchAfterRoomConfirmation();
  window.dispatchEvent(new CustomEvent('architrend-room-mapping-changed'));
  atFinishRoomEdit();
  window.boundaryActionMessage?.(document.getElementById('atRoomEditMessage'),'確定済み：区画 '+atRoomNumber(r)+' ／ '+r.floor+'F '+r.name+' ／ '+(r.habitable?'居室として発熱を設定':'非居室として設定')+'。');
}
function atCommitRoomOpeningEdit(){
  if(appMode!=='architrend')return;
  const r=reviewMesh()?.rooms.find(room=>room.key===reviewView().selected),input=document.getElementById('atRoomFloorVoid');
  if(!r||!(Number(r.floor)>1)||!input||typeof atApplyRoomFloorEdit!=='function')return;
  const message=document.getElementById('atRoomOpeningMessage'),trial=atReviewCopy(r);
  if(atApplyRoomFloorEdit(trial)===false){window.boundaryActionMessage?.(message,'開口の寸法を確認してください。変更はまだ反映していません。','error');return;}
  const signature=room=>JSON.stringify([!!room.floorVoid,!!room.floorReviewed,!!room.openingReviewRequired,room.openingGapMm,room.stairManual,room.stairOff,room.stairPath]);
  if(signature(r)===signature(trial)&&atReviewOpeningCompatible(r,reviewMesh())){window.boundaryActionMessage?.(message,'反映済み：区画 '+atRoomNumber(r)+' ／ '+(r.floorVoid?'階段開口・吹抜け':'床あり')+'。');return;}
  atSnapshotRoomEdit();
  if(atApplyRoomFloorEdit(r)===false)return;
  atRememberRoomOpening(r);atSyncEditedRoom(r);
  window.dispatchEvent(new CustomEvent('architrend-room-mapping-changed'));
  atFinishRoomEdit();
  const current=document.getElementById('atRoomOpeningMessage'),status=typeof atRoomFloorReadiness==='function'?atRoomFloorReadiness(reviewMesh()):{ready:true};
  window.boundaryActionMessage?.(current,'反映済み：区画 '+atRoomNumber(r)+' ／ '+(r.floorVoid?r.floor+'階床と'+(Number(r.floor)-1)+'階天井を開口。'+(!status.ready?' '+status.message:' 図で開口を確認してください。'):r.floor+'階を床ありに設定。'));
}
function atUndoRoomEdit(){
  reviewView().merge=null;
  const prev=reviewView().undo.pop();
  if(!prev) return;
  reviewMesh().rooms=prev.rooms;
  applyState(prev.state);
  atUnassignedWindows=prev.state.atUnassigned||[];
  atAssignableRooms=prev.state.atRoomCandidates||[];
  renderUnassignedWindows();
  reviewMesh().gainVolumes=atBuildGainVolumes(reviewMesh());
  window.dispatchEvent(new CustomEvent('architrend-room-mapping-changed'));
  atFinishRoomEdit();
}
function atSelectViewerRoom(key){
  if(typeof atRoomMergeActive==='function'&&atRoomMergeActive()){atToggleRoomMerge(key);return;}
  reviewView().selected=key;
  reviewView().inspectorPanel='room';reviewView().resetInspectorScroll=true;
  atRenderRoomViewer();
}
function atStairEditorHtml(r){
  const n=((r.stair&&r.stair.treads)||[]).length;
  const nR=((r.stair&&r.stair.risers)||[]).length;
  const note=r.stair && r.stair.note ? `<p class="small at-rv-stair-note">${escapeHtml(r.stair.note)}</p>` : '';
  const rise=r.stair ? (r.stair.toZ-r.stair.fromZ).toFixed(2) : '—';
  const going=r.stair && r.stair.going ? r.stair.going.toFixed(2) : '—';
  return `<div class="at-rv-stair">
      <p class="small">到達 ${rise} m · 踏面 ${n} / 蹴上 ${nR} / 進み ${going} m。頂点は水平・垂直です。</p>
      ${note}
    </div>`;
}
function atStairEditState(r){return JSON.stringify([r.stairPath,r.stairManual,r.stairOff,r.stair]);}
function atFinishStairEdit(r,before){
  if(appMode==='architrend'&&r&&before!==atStairEditState(r))window.dispatchEvent(new CustomEvent('architrend-room-mapping-changed'));
  if(typeof refreshIdfMeshUi==='function')refreshIdfMeshUi();
  if(appMode==='architrend')reviewView().pending=atRoomReviewState();
  if(typeof saveStateDebounced==='function')saveStateDebounced();
  atRenderRoomViewer();
}
function atStairEditAction(kind){
  const r=reviewMesh() && (reviewMesh().rooms||[]).find(q=>q.key===reviewView().selected);
  if(!r || typeof atIsStairRoom!=='function' || !atIsStairRoom(r)) return;
  const before=atStairEditState(r);atSnapshotRoomEdit();
  if(kind==='add' && typeof atStairAddCorner==='function') atStairAddCorner(r);
  else if(kind==='flip' && typeof atStairFlipPath==='function') atStairFlipPath(r);
  else if(kind==='reset' && typeof atStairResetPath==='function') atStairResetPath(r);
  else if(kind==='clear' && typeof atStairClearRoom==='function') atStairClearRoom(r);
  atFinishStairEdit(r,before);
}
function atStairCreateAction(){
  const r=reviewMesh() && (reviewMesh().rooms||[]).find(q=>q.key===reviewView().selected);
  if(!r || typeof atStairCreateRoom!=='function') return;
  const before=atStairEditState(r);atSnapshotRoomEdit();
  atStairCreateRoom(r);
  reviewView().plan=true;
  atFinishStairEdit(r,before);
}
function atPlanFloorBaseRooms(rooms){
  return (rooms||[]).map(p=>{
    const room=JSON.parse(JSON.stringify(p));
    if(room.floorSource==='user-layout'&&room.floorOriginal){
      room.floor=room.floorOriginal.floor;
      room.floorSource=room.floorOriginal.floorSource;
      if(room.floorOriginal.floorEvidenceIncomplete)room.floorEvidenceIncomplete=true;
    }
    return room;
  });
}
function atResetRoomHistoryAfterFloorEdit(){
  atRoomView.undo=[];atRoomView.pending=null;atRoomView.restored=false;
  atRoomView.pending=atRoomReviewState();
}
function atRenderPlanFloorReview(){
  const host=document.getElementById('atPlanFloorReview');
  if(!host)return;
  const catalog=atRoomView.catalog||[],plans=catalog.filter(p=>p.sourceKind==='plan');
  const active=(typeof appMode==='undefined'||appMode==='architrend')&&!!reviewMesh()&&plans.some(p=>!p.floor||p.floorSource==='user-layout');
  host.hidden=!active;
  if(!active){host.innerHTML='';delete host.dataset.catalogToken;return;}
  const token=JSON.stringify(plans.map(p=>[p.key,p.sourcePage,p.plan]));
  const oldChoice=host.dataset.catalogToken===token&&host.querySelector('select')?.value;
  const confirmed=plans.find(p=>p.floorLayoutMode)?.floorLayoutMode||'';
  const mode=oldChoice||confirmed||'';
  host.dataset.catalogToken=token;
  const options=[['left1-right2','左が1階・右が2階'],['left2-right1','左が2階・右が1階'],['top1-bottom2','上が1階・下が2階'],['top2-bottom1','上が2階・下が1階']];
  host.innerHTML=`<h4>平面図の階を確認</h4>
    <p>${confirmed?'確認した図面の並びで階を指定しています。':'PDFから階を確定できない部屋があります。'}PDFを見て図面の並びを選ぶと、同じ階の近い面積へ自動割当できます。</p>
    <div class="at-plan-floor-controls"><label for="atPlanFloorLayout">PDFの図面の並び<select id="atPlanFloorLayout"><option value="">並びを選んでください</option>${options.map(([value,label])=>`<option value="${value}" ${mode===value?'selected':''}>${label}</option>`).join('')}</select></label>
    <button type="button" id="atPlanFloorApply" disabled>階を確認して自動割当</button></div>
    <div id="atPlanFloorPreview" class="at-plan-floor-preview"></div>
    <p id="atPlanFloorMessage" class="small" aria-live="polite"></p>
    <button type="button" id="atPlanFloorRelease" hidden>階が異なる確定済み割当を解除</button>`;
  const choice=host.querySelector('select'),button=host.querySelector('button'),preview=host.querySelector('#atPlanFloorPreview'),message=host.querySelector('#atPlanFloorMessage');
  const release=host.querySelector('#atPlanFloorRelease');
  function readLayout(){
    const result=typeof atPlanFloorLayout==='function'?atPlanFloorLayout(atPlanFloorBaseRooms(atRoomView.catalog),choice.value):{ready:false,codes:[],groups:[]};
    result.manualConflicts=result.ready?(reviewMesh()?.rooms||[]).filter(r=>r.manualAssignment&&Number.isInteger(r.pdfIndex)&&r.pdfIndex>=0&&result.rooms[r.pdfIndex]?.floor&&String(result.rooms[r.pdfIndex].floor)!==String(r.floor)):[];
    return result;
  }
  function showPreview(){
    const result=readLayout();button.disabled=!result.ready||result.manualConflicts.length>0;release.hidden=!result.manualConflicts.length;
    preview.innerHTML=result.ready?result.groups.map(group=>{
      const names=catalog.filter(p=>group.roomKeys.includes(p.key)).map(p=>p.name);
      return `<div class="at-plan-floor-group"><b>p.${group.sourcePage} ${escapeHtml(group.label)} ／ ${group.count}室</b><p>${names.map(escapeHtml).join('、')}</p></div>`;
    }).join(''):'';
    message.textContent=!choice.value?'選択だけでは反映しません。下に表示される室名と階を確認してからボタンを押してください。':result.ready?'室名と階がPDFと合っていることを確認して、ボタンを押してください。面積だけで区別できない部屋は保留します。':result.codes.includes('PLAN_FLOOR_LAYOUT_SOURCE_CONFLICT')?'読み取った階表示と選択した並びが一致しません。PDFを確認し、各区画の部屋を個別に指定してください。':'図面を2つのまとまりに分けられませんでした。各区画の部屋を個別に指定してください。';
    if(result.manualConflicts.length)message.textContent='選択した階と確定済みの割当が異なります：'+result.manualConflicts.map(r=>'区画 '+atRoomNumber(r)+'（'+r.name+'）').join('、')+'。並びを見直すか、下のボタンで該当割当を解除してください。';
  }
  choice.onchange=showPreview;
  release.onclick=()=>{
    const result=readLayout();if(!result.ready||!result.manualConflicts.length)return;
    for(const room of result.manualConflicts){
      atAssignPdfRoom(room,-1);room.manualAssignment=false;room.keep=false;room.habitable=false;room.reviewed=false;delete room.matchSource;
      atSyncEditedRoom(room);
    }
    atResetRoomHistoryAfterFloorEdit();
    window.dispatchEvent(new CustomEvent('architrend-room-mapping-changed'));
    atFinishRoomEdit();
  };
  button.onclick=()=>{
    const result=readLayout();if(!result.ready||result.manualConflicts.length)return;
    const base=atPlanFloorBaseRooms(atRoomView.catalog);
    result.rooms.forEach((p,i)=>{
      if(p.sourceKind!=='plan')return;
      p.floorOriginal=base[i].floorOriginal||{floor:base[i].floor||'',floorSource:base[i].floorSource||'',floorEvidenceIncomplete:!!base[i].floorEvidenceIncomplete};
      p.floorLayoutMode=choice.value;
    });
    // Keep the confirmation with this PDF, including subsequent CSV merges.
    for(const parsed of [typeof atLastParse!=='undefined'?atLastParse:null,typeof atPdfParse!=='undefined'?atPdfParse:null]){
      if(!parsed?.result?.planRoomPages?.length)continue;
      parsed.result.rooms=JSON.parse(JSON.stringify(result.rooms));
      parsed.result.habitableRooms=parsed.result.rooms.filter(isArchitrendLivingRoom);
      parsed.result.excludedRooms=parsed.result.rooms.filter(p=>!isArchitrendLivingRoom(p));
      parsed.result.planRoomDiagnostics=(parsed.result.planRoomDiagnostics||[]).filter(d=>d.code!=='PLAN_FLOOR_UNKNOWN');
      parsed.warnings=(parsed.warnings||[]).filter(w=>w!=='平面図で階を確定できない部屋があります。配置と階を確認してください。');
    }
    atMatchMeshRoomsToPdf(reviewMesh().rooms,result.rooms);
    for(const room of reviewMesh().rooms)atSyncEditedRoom(room);
    atResetRoomHistoryAfterFloorEdit();
    window.dispatchEvent(new CustomEvent('architrend-room-mapping-changed'));
    atFinishRoomEdit();
    const status=document.getElementById('atPlanFloorMessage');
    if(status)status.textContent='階を反映し、室名を再照合しました。手動指定待ちの部屋だけ右側で指定してください。部屋を変更した後は、色分け3DSを出し直し、FDの色CSVを取り直してください。';
  };
  showPreview();
}
function atRenderRoomViewer(){
  atCaptureRoomEditorDraft();
  atRenderPlanFloorReview();
  const host=typeof reviewHost==='function' ? reviewHost() : document.getElementById('atRoomViewer');
  if(!host) return;
  const disclosures=new Map([...host.querySelectorAll('details[data-rv-disclosure]')].map(el=>[el.dataset.rvDisclosure,el.open]));
  const sideScroll=reviewView().resetInspectorScroll?0:host.querySelector('.at-rv-side')?.scrollTop||0;
  reviewView().resetInspectorScroll=false;
  const other=document.getElementById(host.id==='epRoomViewer' ? 'atRoomViewer' : 'epRoomViewer');
  if(other && other!==host){ other.innerHTML=''; other.hidden=true; }
  host.hidden=!reviewMesh();
  if(!reviewMesh()) return;
  const rooms=reviewMesh().rooms||[];
  const planPages=[...new Set((reviewView().catalog||[]).filter(p=>p.sourceKind==='plan').map(p=>Number(p.sourcePage)).filter(p=>p>0))];
  document.querySelectorAll('[data-at-rename-key]').forEach(el=>{
    const r=rooms.find(r=>r.key===el.dataset.atRenameKey);
    if(r) el.value=r.name||'';
  });
  const floors=Array.from(new Set(rooms.map(r=>String(r.floor)))).sort((a,b)=>Number(a)-Number(b));
  if(reviewView().floor!=='all' && !floors.includes(reviewView().floor)) reviewView().floor=floors[0]||'1';
  const visible=rooms.filter(r=>reviewView().floor==='all' || String(r.floor)===reviewView().floor);
  if(!visible.some(r=>r.key===reviewView().selected)) reviewView().selected=visible[0]?.key||'';
  const selected=rooms.find(r=>r.key===reviewView().selected);
  const merging=typeof atRoomMergeActive==='function'&&appMode==='architrend'&&atRoomMergeActive();
  const mergePopup=merging&&reviewView().merge.presentation==='popup';
  host.classList.toggle('is-merging',!!merging);
  host.classList.toggle('is-merge-popup',!!mergePopup);
  const checked=rooms.filter(r=>r.reviewed).length;
  const assignedPdf=reviewView().catalog.filter((p,i)=>rooms.some(r=>atViewerPdfIndices(r).includes(i))).length;
  const automatic=rooms.filter(r=>r.pdfMatch&&!r.manualAssignment).length;
  const livingVolume=typeof atMeshLivingVolume==='function'?atMeshLivingVolume(reviewMesh()):0;
  const esc=escapeHtml;
  const stairIs=selected && typeof atIsStairRoom==='function' && atIsStairRoom(selected);
  const stairTools=merging?'':stairIs
    ? `<button type="button" data-action="stair-add">折れを足す</button><button type="button" data-action="stair-flip">階段を反転</button><button type="button" data-action="stair-reset">直線に戻す</button><button type="button" data-action="stair-clear">階段をやめる</button>`
    : `<button type="button" data-action="stair-create" ${selected?'':'disabled'}>この区画に階段</button>`;
  const panel=merging?'room':reviewView().inspectorPanel==='edit'?'edit':'room';
  host.innerHTML=`
    <div class="at-rv-command">
      <div class="at-rv-command-row">
        <label class="at-rv-floor-choice" for="atRoomFloorSelect">表示する階
          <select id="atRoomFloorSelect" data-view-control="true" ${merging?'disabled':''}>${[...floors,'all'].map(f=>`<option value="${esc(f)}" ${reviewView().floor===f?'selected':''}>${f==='all'?'全階':esc(f)+'F'}</option>`).join('')}</select>
        </label>
        <div class="at-rv-toolbar" role="group" aria-label="見え方">
          <button type="button" data-view="plan" aria-pressed="${reviewView().plan}">平面</button>
          <button type="button" data-view="3d" aria-pressed="${!reviewView().plan}">3D</button>
        </div>
        <button type="button" data-action="reset" title="回転と拡大を初期状態に戻します">全体を表示</button>
        <button type="button" data-action="undo" ${reviewView().undo.length&&!merging?'':'hidden'} title="直前に確定した部屋・形状の変更を取り消します">変更を取り消す</button>
        <div class="at-rv-metrics"><span class="at-rv-progress">${planPages.length?'室名割当 '+assignedPdf+'/'+reviewView().catalog.length+' · 自動 '+automatic:'確認済み '+checked+'/'+rooms.length}</span><span class="at-rv-volume">居室 ${livingVolume.toFixed(1)} m³</span></div>
      </div>
    </div>
    <div class="at-rv-workspace"><div class="at-rv-stage">
      <svg id="atRoomScene" viewBox="0 0 900 570" role="group" aria-label="3DSの部屋配置。各部屋は右の一覧からも選べます。"></svg>
      <div class="at-rv-help" role="status">${merging?'結合する区画をクリックしてください':typeof atParts!=='undefined'&&atParts.mode==='door'?'ドアを置く壁をクリックしてください':reviewView().plan?'図の部屋をクリックして選択':'部屋をクリックして選択・ドラッグで回転'} · ホイールで拡大</div>
    </div><aside class="at-rv-side" aria-label="部屋の編集">
      <div class="at-rv-panel-switch" role="group" aria-label="作業の切り替え"><button type="button" data-rv-tab="room" aria-pressed="${panel==='room'}">部屋の確認</button><button type="button" data-rv-tab="edit" aria-pressed="${panel==='edit'}" ${merging?'disabled':''}>配置・編集</button></div>
      <section data-rv-panel="room" ${panel==='room'?'':'hidden'}>
      <h3>${merging?'区画を結合':'部屋を確認'}</h3>
      <p class="at-rv-steps">${merging?'区画を選び、まとめる部屋の名前を指定します。':'図の部屋を選び、名前と用途を確認します。'}</p>
      <div id="atRoomEditor">${merging?(mergePopup?atRoomMergePopupHtml():atRoomMergeEditorHtml()):selected ? `
        <div class="at-rv-selection">区画 ${atRoomNumber(selected)} <span>${selected.floor}F · ${selected.area.toFixed(2)} m² · 階高 ${atRoomHeight(selected).toFixed(2)} m · ${atRoomVolume(selected).toFixed(1)} m³</span></div>
        ${reviewView().catalog.length ? `<label for="atRoomPdfChoice">図面の部屋と対応づける</label>
        <select id="atRoomPdfChoice"><option value="-1">自由入力・PDFと未対応</option>${reviewView().catalog.map((p,i)=>{
          const assigned=rooms.find(r=>atViewerPdfIndices(r).includes(i) && r!==selected);
          const combined=rooms.find(r=>r.manualMerged&&r.pdfIndex!==i&&atViewerPdfIndices(r).includes(i));
          return `<option value="${i}" ${combined?'disabled':''} ${selected.pdfIndex===i?'selected':''}>${p.floor?esc(p.floor)+'F':'階不明'} / ${esc(p.name)} / ${p.area>0?Number(p.area).toFixed(2)+' m²':'面積記載なし'}${p.sourceKind==='plan'?'［平面図 p.'+p.sourcePage+'］':''}${combined?'（区画'+atRoomNumber(combined)+'へ結合済み）':assigned?'（区画'+atRoomNumber(assigned)+'と入替）':''}</option>`;
        }).join('')}</select>` : ''}
        <label for="atRoomNameEdit">部屋名</label>
        <input id="atRoomNameEdit" type="text" maxlength="100" value="${esc(selected.name)}" placeholder="例：LDK、洋室1、収納">
        <label class="at-rv-check" title="窓がある部屋は、チェックを外しても直達日射を内部発熱に残します。居室だけ換気体積と人体・機器を足します。"><input id="atRoomHeatTarget" type="checkbox" ${selected.habitable?'checked':''}>居室として発熱を入れる</label>
        <p class="small">${esc(atRoomMatchNote(selected))}${selected.pdfArea>0?` PDF ${Number(selected.pdfArea).toFixed(2)} m² ／ 3DS ${selected.area.toFixed(2)} m²`:''}</p>
      `:'<p>床から部屋を認識できませんでした。床・内壁を含む3DSを選択してください。</p>'}</div>
      ${selected&&!mergePopup?`<div class="at-rv-commit-bar boundary-action-bar" data-boundary-action="room">
        <p id="atRoomEditMessage" class="boundary-action-status" data-state="${selected.reviewed?'applied':'pending'}" aria-live="polite">${merging?'':selected.reviewed?'確定済み：区画 '+atRoomNumber(selected)+' ／ '+esc(selected.name):selected.pdfMatch?'自動割当：'+esc(selected.name)+'。変更する場合は、部屋を指定して確定してください。':'未確定：部屋を指定して、下のボタンを押してください。'}</p>
        ${merging?'<button type="button" class="at-rv-confirm" data-action="merge-apply" disabled>選択した区画を1室に結合</button><button type="button" class="at-rv-merge-cancel" data-action="merge-cancel">結合をやめる</button>':'<button type="button" class="at-rv-confirm" data-action="commit">この部屋を確定</button>'}
        ${!merging&&appMode==='architrend'&&Number(selected.floor)>1&&typeof atRoomFloorEditorHtml==='function'?`<details class="at-rv-details at-rv-opening" data-rv-disclosure="opening:${esc(selected.key)}" data-boundary-action="opening"><summary>床・吹抜けの設定</summary>${atRoomFloorEditorHtml(selected)}<p id="atRoomOpeningMessage" class="boundary-action-status" role="status">変更後に反映してください。</p><button type="button" data-action="floor-opening-apply">床・吹抜けの設定を反映</button></details>`:''}
      </div>`:''}
      <div class="at-rv-lists ${merging?'at-rv-merge-list':''}">
        <details class="at-rv-details" data-rv-disclosure="rooms" ${merging?'open':''}><summary>表示中の部屋（${visible.length}）</summary>
        <div class="at-rv-list" aria-label="表示中の部屋">${visible.map(r=>`
          <button type="button" data-room="${esc(r.key)}" aria-pressed="${merging?reviewView().merge.keys.includes(r.key):r===selected}" class="at-rv-room">
            <i style="background:${atRoomColor(r)}"></i><span><b>${merging?(reviewView().merge.keys.includes(r.key)?'☑ ':'☐ '):''}${atRoomNumber(r)}. ${esc(atRoomTitle(r))}</b><small>${r.floor}F · ${r.area.toFixed(2)} m² · ${atRoomVolume(r).toFixed(1)} m³ · ${r.reviewed?'手動確定':r.pdfMatch?'自動割当':'未割当'}${r.habitable?' · 居室':r.explicitGainTarget?' · 入力した発熱':(r.keep?' · 日射のみ':' · 発熱なし')}</small></span>
          </button>`).join('')}</div></details>
      </div>
      </section>
      <section data-rv-panel="edit" ${panel==='edit'?'':'hidden'}>
        <h3>配置・編集</h3><p class="at-rv-steps">行いたい操作を開いてください。</p>
        <details class="at-rv-details" data-rv-disclosure="doors" ${typeof atParts!=='undefined'&&(atParts.mode==='door'||atParts.selected)?'open':''}><summary>ドアを配置・修正する</summary>${typeof atPartToolbarHtml==='function'?atPartToolbarHtml():''}</details>
        ${appMode==='architrend'?`<details class="at-rv-details" data-rv-disclosure="merge"><summary>複数の区画を1室にまとめる</summary><p>図で区画を選び、1つの部屋に結合します。</p><button type="button" data-action="merge-start" ${selected?'':'disabled'}>結合する区画を選ぶ</button></details>`:''}
        <details class="at-rv-details" data-rv-disclosure="stairs"><summary>階段を設定する</summary><p>図で選んだ区画に階段を設定します。</p>${stairTools}${stairIs?atStairEditorHtml(selected):''}</details>
        <details class="at-rv-details" data-rv-disclosure="north"><summary>北方向を合わせる</summary><p>平面図の上を0°とし、時計回りに指定します。</p><div class="at-rv-orientation"><label for="atNorthDeg">方位角</label><div class="at-rv-angle"><input id="atNorthDeg" type="number" min="-180" max="180" step="1" value="${reviewView().northDeg}"><span>°</span></div><input id="atNorthRange" type="range" min="-180" max="180" step="1" value="${reviewView().northDeg}" aria-label="北方向の角度"><button type="button" data-action="north-zero">0°に戻す</button></div></details>
        <details class="at-rv-details" data-rv-disclosure="parts"><summary>配置済みパーツ・窓の変更</summary>${typeof atPartSideHtml==='function'?atPartSideHtml():''}</details>
      </section>
      <details class="at-rv-details at-rv-import-info" data-rv-disclosure="source"><summary>読み込み結果・未対応の部屋</summary><p class="at-rv-footer" id="atRoomReviewStatus" aria-live="polite"></p></details>
    </aside></div>`;
  for(const el of host.querySelectorAll('details[data-rv-disclosure]'))if(disclosures.has(el.dataset.rvDisclosure))el.open=disclosures.get(el.dataset.rvDisclosure);
  const revealTool=reviewView().revealTool;
  if(revealTool){host.querySelector('[data-rv-disclosure="'+revealTool+'"]')?.setAttribute('open','');reviewView().revealTool='';}
  if(merging)host.querySelector('[data-rv-disclosure="rooms"]').open=true;
  host.querySelector('.at-rv-side').scrollTop=sideScroll;
  const unused=reviewView().catalog.filter((p,i)=>!rooms.some(r=>atViewerPdfIndices(r).includes(i)));
  const statusEl=document.getElementById('atRoomReviewStatus');
  statusEl.textContent=
    atRoomReviewRestoreNotice()+
    (reviewMesh().gainColorError?'部屋の色分け数が上限を超えたため出力を停止しています。 ':'')+
    (reviewView().restored?'同じ3DSの保存済み割当を復元しました。 ':'')+
    (planPages.length?'平面図 p.'+planPages.join('・')+'：'+reviewView().catalog.length+'室 / 自動割当 '+rooms.filter(r=>r.pdfMatch&&!r.manualAssignment).length+'区画 / 手動指定待ち '+unused.length+'室。 ':'')+
    '北方向 '+reviewView().northDeg.toFixed(0)+'°。修正は自動保存・設定JSONに含まれます。形状を含めて保存し、再開時に復元します。'+
    (unused.length?' 未対応のPDF部屋: '+unused.map(p=>(p.floor||'?')+'F '+p.name).join('、'):'');
  statusEl.title=statusEl.textContent;
  host.onclick=e=>{
    if(reviewView().suppressClick){ reviewView().suppressClick=false; return; }
    const btn=e.target.closest('button');
    if(!btn) return;
    if(btn.dataset.rvTab){
      reviewView().inspectorPanel=btn.dataset.rvTab;
      reviewView().resetInspectorScroll=true;
      if(btn.dataset.rvTab==='room'&&typeof atParts!=='undefined')atParts.mode='select';
      atRenderRoomViewer();host.querySelector('[data-rv-tab="'+btn.dataset.rvTab+'"]')?.focus({preventScroll:true});return;
    }
    if(typeof atPartHandleButton==='function' && atPartHandleButton(btn)) return;
    if(btn.dataset.floor){ reviewView().floor=btn.dataset.floor; reviewView().zoom=1; atRenderRoomViewer(); }
    else if(btn.dataset.room){
      if(e.shiftKey&&appMode==='architrend')atShiftSelectRoom(btn.dataset.room);else atSelectViewerRoom(btn.dataset.room);
      host.querySelector('button[data-room="'+CSS.escape(btn.dataset.room)+'"]')?.focus({preventScroll:true});
    }
    else if(btn.dataset.view){ reviewView().plan=btn.dataset.view==='plan'; atRenderRoomViewer(); }
    else if(btn.dataset.action==='commit') atCommitRoomEdit();
    else if(btn.dataset.action==='floor-opening-apply')atCommitRoomOpeningEdit();
    else if(btn.dataset.action==='merge-start'){reviewView().inspectorPanel='room';reviewView().resetInspectorScroll=true;if(merging)atCancelRoomMerge();else{atBeginRoomMerge();host.querySelector('#atMergeRoomName')?.focus({preventScroll:true});}}
    else if(btn.dataset.action==='merge-apply') atApplyRoomMerge();
    else if(btn.dataset.action==='merge-cancel') atCancelRoomMerge();
    else if(btn.dataset.action==='undo') atUndoRoomEdit();
    else if(btn.dataset.action==='north-zero') atSetNorthAngle(0);
    else if(btn.dataset.action==='reset'){ reviewView().yaw=-0.45; reviewView().tilt=0.85; reviewView().zoom=1; atDrawRoomScene(); }
    else if(btn.dataset.action==='stair-create') atStairCreateAction();
    else if(btn.dataset.action==='stair-add') atStairEditAction('add');
    else if(btn.dataset.action==='stair-flip') atStairEditAction('flip');
    else if(btn.dataset.action==='stair-reset') atStairEditAction('reset');
    else if(btn.dataset.action==='stair-clear') atStairEditAction('clear');
  };
  host.onkeydown=e=>{
    if(e.key==='Escape'&&atRoomMergeActive()){
      e.preventDefault();atCancelRoomMerge();const start=host.querySelector('[data-action="merge-start"]');atRevealRoomControl(start);start?.focus({preventScroll:true});
    }else if(e.shiftKey&&(e.key==='Enter'||e.key===' ')&&e.target.closest('button[data-room]')&&appMode==='architrend'){
      e.preventDefault();const key=e.target.closest('button[data-room]').dataset.room;atShiftSelectRoom(key);
      host.querySelector('button[data-room="'+CSS.escape(key)+'"]')?.focus({preventScroll:true});
    }
  };
  const choice=document.getElementById('atRoomPdfChoice');
  host._editorMesh=reviewMesh();host.dataset.editorRoomKey=selected?.key||'';
  if(selected&&!merging)atRestoreRoomEditorDraft(selected);
  if(merging)atBindRoomMergeEditor();
  if(choice) choice.onchange=()=>{
    const p=reviewView().catalog[Number(choice.value)];
    if(p){
      document.getElementById('atRoomNameEdit').value=p.name;
      document.getElementById('atRoomHeatTarget').checked=isArchitrendLivingRoom(p);
    }
    const occupied=rooms.some(r=>r!==selected && r.pdfIndex===Number(choice.value));
    host.querySelector('[data-action="commit"]').textContent=occupied?'割当先と入れ替えて確定':'この部屋を確定';
    document.getElementById('atRoomEditMessage').textContent=p?'未確定：区画 '+atRoomNumber(selected)+' → '+p.name+'。下のボタンで反映します。':'未確定：部屋名を入力して確定してください。';
    document.getElementById('atRoomEditMessage').dataset.state='pending';atCaptureRoomEditorDraft();
  };
  for(const id of ['atRoomNameEdit','atRoomHeatTarget']){
    const field=document.getElementById(id);
    if(field)field.addEventListener('input',()=>{
      document.getElementById('atRoomEditMessage').textContent='変更は未確定です。下のボタンで反映してください。';
      document.getElementById('atRoomEditMessage').dataset.state='pending';atCaptureRoomEditorDraft();
    });
  }
  for(const id of ['atRoomFloorVoid','atRoomOpeningGapMm'])document.getElementById(id)?.addEventListener('input',()=>window.boundaryActionMessage?.(document.getElementById('atRoomOpeningMessage'),'床・吹抜けの変更は未反映です。下のボタンで反映してください。','pending'));
  const northNum=document.getElementById('atNorthDeg');
  const floorChoice=document.getElementById('atRoomFloorSelect');
  if(floorChoice)floorChoice.onchange=()=>{reviewView().floor=floorChoice.value;reviewView().zoom=1;reviewView().resetInspectorScroll=true;if(floorChoice.value==='all'&&typeof atParts!=='undefined')atParts.mode='select';atRenderRoomViewer();};
  const northRange=document.getElementById('atNorthRange');
  if(northNum) northNum.onchange=()=>atSetNorthAngle(northNum.value);
  if(northRange) northRange.oninput=()=>atSetNorthAngle(northRange.value);
  const doorKind=document.getElementById('atDoorPartKind');
  if(doorKind) doorKind.onchange=()=>{atParts.doorKind=doorKind.value;atRenderRoomViewer();};
  const doorWidth=document.getElementById('atPartDoorWidth');
  if(doorWidth) doorWidth.onchange=()=>atPartSetDoorWidth(atParts.selected, doorWidth.value);
  const doorOpen=document.getElementById('atPartDoorOpen');
  if(doorOpen) doorOpen.onchange=()=>atPartSetDoorOpen(atParts.selected, doorOpen.checked);
  const selectedKind=document.getElementById('atSelectedDoorKind');
  if(selectedKind) selectedKind.onchange=()=>atPartSetKind(atParts.selected,selectedKind.value);
  const partAngle=document.getElementById('atPartAngle');
  if(partAngle) partAngle.onchange=()=>atPartRotateAc(atParts.selected,partAngle.value);
  const blowDir=document.getElementById('atPartBlowDir');
  if(blowDir) blowDir.onchange=()=>atPartSetBlowDir(atParts.selected,blowDir.value);
  atBindRoomScene();
  atDrawRoomScene();
  if(typeof atRenderFloorReview==='function')atRenderFloorReview();
}
// Task links and keyboard navigation may target an editor inside a collapsed group.
function atRevealRoomControl(el){
  const panel=el?.closest('[data-rv-panel]'),host=el?.closest('.at-room-viewer');
  if(!host)return;
  if(panel){reviewView().inspectorPanel=panel.dataset.rvPanel;host.querySelectorAll('[data-rv-panel]').forEach(p=>p.hidden=p!==panel);host.querySelectorAll('[data-rv-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.rvTab===panel.dataset.rvPanel)));}
  for(let p=el.parentElement;p&&p!==host;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
}
if(typeof window!=='undefined')window.boundaryRoomReveal=atRevealRoomControl;
if(typeof window!=='undefined'&&window.addEventListener){
  for(const event of ['architrend-import-invalidated','architrend-model-invalidated'])window.addEventListener(event,()=>{atRoomView.merge=null;atRoomView.editorDrafts={};atRoomView.editorMesh=null;const host=reviewHost();if(host)host._editorMesh=null;atRenderRoomViewer();});
}

// Clip wall triangles to the displayed story, retaining floor-level context.
function atClipRoomFace(points,z,above){
  const out=[];
  for(let i=0;i<points.length;i++){
    const a=points[i], b=points[(i+1)%points.length];
    const ina=above?a.z>=z:a.z<=z, inb=above?b.z>=z:b.z<=z;
    if(ina) out.push(a);
    if(ina!==inb){ const t=(z-a.z)/(b.z-a.z); out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:z}); }
  }
  return out;
}
function atRoomLabelPoint(r){
  const b=atRingBBox(r.ring), cx=(b.minx+b.maxx)/2, cy=(b.miny+b.maxy)/2;
  if(atPointInRing(cx,cy,r.ring)) return {x:cx,y:cy};
  for(let y=1;y<10;y++) for(let x=1;x<10;x++){
    const p={x:b.minx+b.dx*x/10,y:b.miny+b.dy*y/10};
    if(atPointInRing(p.x,p.y,r.ring)) return p;
  }
  return r.ring[0];
}
function atDrawRoomScene(){
  const svg=document.getElementById('atRoomScene');
  if(!svg || !reviewMesh()) return;
  const rooms=reviewMesh().rooms.filter(r=>reviewView().floor==='all' || String(r.floor)===reviewView().floor);
  if(!rooms.length){ svg.innerHTML=''; return; }
  const raw=p=>{
    if(reviewView().plan) return {x:p.x,y:-p.y,d:p.z};
    const c=Math.cos(reviewView().yaw),s=Math.sin(reviewView().yaw);
    const x=p.x*c-p.y*s,y=p.x*s+p.y*c;
    return {x:x,y:-y*Math.sin(reviewView().tilt)-p.z*Math.cos(reviewView().tilt),d:y*Math.cos(reviewView().tilt)-p.z*Math.sin(reviewView().tilt)};
  };
  const corners=rooms.flatMap(r=>{
    const z1=r.z;
    let z2=r.z+0.7;
    if(r.stair) z2=Math.max(z2, r.stair.toZ||z2);
    return r.ring.flatMap(p=>[raw({...p,z:z1}), raw({...p,z:z2})]);
  });
  const minx=Math.min(...corners.map(p=>p.x)),maxx=Math.max(...corners.map(p=>p.x));
  const miny=Math.min(...corners.map(p=>p.y)),maxy=Math.max(...corners.map(p=>p.y));
  const scale=Math.min(790/Math.max(1,maxx-minx),440/Math.max(1,maxy-miny))*reviewView().zoom;
  const midX=(minx+maxx)/2, midY=(miny+maxy)/2;
  reviewView().proj={scale, midX, midY, yaw:reviewView().yaw, tilt:reviewView().tilt, plan:reviewView().plan};
  const project=p=>{ const q=raw(p); return {x:450+(q.x-midX)*scale,y:275+(q.y-midY)*scale,d:q.d}; };
  const points=vs=>vs.map(p=>{const q=project(p); return q.x.toFixed(1)+','+q.y.toFixed(1);}).join(' ');
  const depths=vs=>vs.reduce((n,p)=>n+raw(p).d,0)/vs.length;
  const layers=[];
  const labelBoxes=[];
  const stories=Array.from(new Set(rooms.map(r=>r.floor)));
  stories.forEach(floor=>{
    const rs=rooms.filter(r=>r.floor===floor), z=Math.min(...rs.map(r=>r.z));
    const parts=[];
    const sceneFaces=appMode==='architrend'&&typeof atResolvedRoomFloorFaces==='function'?atResolvedRoomFloorFaces(reviewMesh()):(reviewMesh().meshFaces||[]);
    sceneFaces.forEach(f=>{
      const isWin=f.sslKey==='window';
      const isExt=/^extdoor_/.test(f.sslKey||'');
      if(!atIsPartition(f) && !isWin && !isExt) return;
      const triangles=f.tris?.length?f.tris.map(t=>t.map(i=>f.verts[i])):[f.verts||[]];
      triangles.forEach(vs=>{
        if(vs.length<3 || vs.some(p=>!p)) return;
        const bottom=f.interstoryOpeningLining?Math.min(...vs.map(p=>p.z)):z-0.04;
        if(f.interstoryOpeningLining&&Math.abs(Math.max(...vs.map(p=>p.z))-z)>0.05)return;
        let cut=atClipRoomFace(vs,bottom,true);
        cut=atClipRoomFace(cut,z+0.7,false);
        if(cut.length<3) return;
        let fill=isWin?'#b8d9e5':isExt?'#e07a3d':'#e5e9e7';
        if(!isWin && !isExt && /^wall_/.test(f.sslKey||'') && typeof appMode!=='undefined' && appMode==='energyplus' && typeof idfMeshPaletteForFace==='function'){
          const pal=idfMeshPaletteForFace(f);
          if(pal) fill='rgb('+pal.r+','+pal.g+','+pal.b+')';
        }
        parts.push({d:depths(cut),html:`<polygon points="${points(cut)}" fill="${fill}" stroke="#738780" stroke-width="0.65" opacity="0.7"/>`});
      });
    });
    rs.forEach(r=>{
      const vs=r.ring.map(p=>({...p,z:r.z+0.035}));
      const selected=typeof atRoomMergeActive==='function'&&atRoomMergeActive()?reviewView().merge.keys.includes(r.key):r.key===reviewView().selected;
      parts.push({d:depths(vs),html:`<polygon data-scene-room="${escapeHtml(r.key)}" points="${points(vs)}" fill="${r.floorVoid?'url(#atFloorVoidHatch)':atRoomColor(r)}" fill-opacity="${r.floorVoid?0.8:selected?0.94:0.68}" stroke="${selected?'#153f35':'#456357'}" stroke-width="${selected?3:1.3}" ${r.reviewed?'':'stroke-dasharray="6 4"'}><title>${escapeHtml(r.floor+'F '+atRoomTitle(r))}</title></polygon>`});
    });
    parts.sort((a,b)=>b.d-a.d);
    const labels=rs.map(r=>{
      const p=project({...atRoomLabelPoint(r),z:r.z+0.06});
      const title=atRoomTitle(r), short=title.length>12?title.slice(0,12)+'…':title;
      // Keep both text lines inside the viewBox. Search sideways as well as
      // vertically so dense, narrow plans do not push names beyond the canvas.
      const w=Math.max(110,short.length*16+48), left=w/2+12,right=888-w/2;
      const candidates=[];
      const add=(x,y)=>candidates.push({x:Math.max(left,Math.min(right,x)),y:Math.max(28,Math.min(538,y))});
      add(p.x,p.y);
      for(let y=28;y<=538;y+=36){
        add(p.x,y);
        for(let x=left;x<=right;x+=24)add(x,y);
        add(right,y);
      }
      const overlap=c=>labelBoxes.reduce((n,b)=>n+Math.max(0,(b.w+w)/2+8-Math.abs(b.x-c.x))*Math.max(0,36-Math.abs(b.y-c.y)),0);
      candidates.forEach(c=>{c.score=overlap(c)*1e6+(c.x-p.x)**2+(c.y-p.y)**2;});
      candidates.sort((a,b)=>a.score-b.score);
      const {x,y}=candidates[0];
      labelBoxes.push({x,y,w});
      const line=Math.hypot(x-p.x,y-p.y)>5?`<path d="M${p.x},${p.y} L${x},${y}" stroke="#527263" fill="none" stroke-width="0.8" pointer-events="none"/>`:'';
      return line+`<text data-scene-room="${escapeHtml(r.key)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="at-rv-label"><title>${escapeHtml(title)}</title><tspan x="${x.toFixed(1)}">${atRoomNumber(r)}. ${escapeHtml(short)}</tspan><tspan x="${x.toFixed(1)}" dy="16" class="at-rv-label-sub">${r.floor}F · ${r.area.toFixed(2)} m²</tspan></text>`;
    });
    layers.push({z,html:parts.map(p=>p.html).join('')+labels.join('')});
  });
  layers.sort((a,b)=>a.z-b.z);
  const allPts=rooms.flatMap(r=>r.ring);
  const bx0=Math.min(...allPts.map(p=>p.x)), bx1=Math.max(...allPts.map(p=>p.x));
  const by0=Math.min(...allPts.map(p=>p.y)), by1=Math.max(...allPts.map(p=>p.y));
  const center={x:(bx0+bx1)/2,y:(by0+by1)/2,z:Math.max(...rooms.map(r=>r.zTop))+0.25};
  const arrowLen=Math.max(bx1-bx0,by1-by0)*0.18;
  const nr=reviewView().northDeg*Math.PI/180;
  const tip={x:center.x+Math.sin(nr)*arrowLen,y:center.y+Math.cos(nr)*arrowLen,z:center.z};
  const pc=project(center), pt=project(tip);
  const compass=`<defs>
      <pattern id="atFloorVoidHatch" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="10" height="10" fill="transparent"/><path d="M-2,2 L2,-2 M0,10 L10,0 M8,12 L12,8" stroke="#7f8e88" stroke-width="1"/></pattern>
      <marker id="atNorthArrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#d14e32"/></marker>
      <marker id="atStairArrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#d14e32"/></marker>
    </defs>
    <g class="at-rv-compass"><line x1="${pc.x}" y1="${pc.y}" x2="${pt.x}" y2="${pt.y}" marker-end="url(#atNorthArrow)"/><text x="${pt.x}" y="${pt.y-10}" text-anchor="middle">N</text></g>`;
  svg.innerHTML=compass+layers.map(l=>l.html).join('')+atStairSceneHtml(rooms, project)
    +(typeof atPartSceneHtml==='function'?atPartSceneHtml(rooms,project):'');
}
function atStairSceneHtml(rooms, project){
  const pts=vs=>vs.map(p=>{const q=project(p); return q.x.toFixed(1)+','+q.y.toFixed(1);}).join(' ');
  let html='';
  (rooms||[]).forEach(r=>{
    const panels=(r.stair && r.stair.panels)||[];
    if(panels.length){
      panels.forEach(p=>{
        const vs=p.verts||[];
        if(vs.length<3) return;
        const riser=p.kind==='riser';
        const fill=riser?'#9a9a9a':(p.kind==='landing'?'#d0d0d0':'#b4b4b4');
        html+=`<polygon class="${riser?'at-rv-stair-riser':'at-rv-stair-tread'}" points="${pts(vs)}" fill="${fill}" fill-opacity="0.82" stroke="#6e6e6e" stroke-width="0.7"/>`;
      });
      return;
    }
    const treads=(r.stair && r.stair.treads)||[];
    treads.forEach(t=>{
      const vs=(t.ring||[]).map(p=>({x:p.x,y:p.y,z:t.zTop||t.z||r.z}));
      if(vs.length<3) return;
      html+=`<polygon class="at-rv-stair-tread" points="${pts(vs)}" fill="${t.kind==='landing'?'#d0d0d0':'#b4b4b4'}" fill-opacity="0.82" stroke="#6e6e6e" stroke-width="0.7"/>`;
    });
  });
  const sel=(rooms||[]).find(r=>r.key===reviewView().selected);
  const path=sel && sel.stairPath;
  if(sel && path && path.length>=2){
    const z0=sel.z+0.05, z1=(sel.stair && sel.stair.toZ)!=null ? sel.stair.toZ : sel.zTop;
    const total=typeof atStairPathLen==='function' ? atStairPathLen(path) : 1;
    const line=path.map((p,i)=>{
      const t=path.length===1 ? 0 : i/(path.length-1);
      const q=project({x:p.x,y:p.y,z:z0+(z1-z0)*t});
      return q.x.toFixed(1)+','+q.y.toFixed(1);
    }).join(' ');
    html+=`<polyline class="at-rv-stair-path-hit" data-stair-path="${escapeHtml(sel.key)}" points="${line}" fill="none" stroke="transparent" stroke-width="18"/>`;
    html+=`<polyline class="at-rv-stair-path" points="${line}" fill="none" stroke="#d14e32" stroke-width="2.4" marker-end="url(#atStairArrow)"/>`;
    path.forEach((p,i)=>{
      const t=path.length===1 ? 0 : i/(path.length-1);
      const q=project({x:p.x,y:p.y,z:z0+(z1-z0)*t});
      html+=`<rect class="at-rv-stair-vertex" data-stair-vertex="${i}" data-stair-room="${escapeHtml(sel.key)}" x="${(q.x-6).toFixed(1)}" y="${(q.y-6).toFixed(1)}" width="12" height="12" fill="#fff" stroke="#d14e32" stroke-width="2"><title>${i===0?'下FL':(i===path.length-1?'上FL':'折れ')}</title></rect>`;
    });
    if(total) html+=`<!-- ${total.toFixed(2)} -->`;
  }
  return html ? `<g class="at-rv-stairs">${html}</g>` : '';
}
function atSceneSvgPoint(e, svg){
  // SVG may be letterboxed as the work area changes shape.
  const matrix=svg.getScreenCTM?.();
  if(matrix&&typeof DOMPoint!=='undefined'){
    const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());
    return {x:p.x,y:p.y};
  }
  const r=svg.getBoundingClientRect();
  return {x:(e.clientX-r.left)/r.width*900, y:(e.clientY-r.top)/r.height*570};
}
function atSceneUnprojectXY(sx, sy, z){
  const p=reviewView().proj;
  if(!p || !(p.scale>0)) return {x:0, y:0};
  const qx=(sx-450)/p.scale+p.midX;
  const qy=(sy-275)/p.scale+p.midY;
  if(p.plan) return {x:qx, y:-qy};
  const c=Math.cos(p.yaw), s=Math.sin(p.yaw);
  const st=Math.sin(p.tilt), ct=Math.cos(p.tilt);
  const xrot=qx;
  const yrot=-(qy+(z||0)*ct)/(Math.abs(st)<1e-4 ? 1e-4 : st);
  return {x:xrot*c+yrot*s, y:-xrot*s+yrot*c};
}
function atBindRoomScene(){
  const svg=document.getElementById('atRoomScene');
  if(!svg) return;
  svg.onpointerdown=e=>{
    if(e.button!==0) return;
    const merging=typeof atRoomMergeActive==='function'&&atRoomMergeActive();
    const shiftSelect=e.shiftKey&&appMode==='architrend';
    if(!merging&&!shiftSelect&&typeof atPartPointerDown==='function' && atPartPointerDown(e,svg)) return;
    const vertex=merging||shiftSelect?null:e.target.closest('[data-stair-vertex]');
    reviewView().drag={x:e.clientX,y:e.clientY,yaw:reviewView().yaw,tilt:reviewView().tilt,moved:false,
      shiftSelect,
      key:e.target.closest('[data-scene-room]')?.dataset.sceneRoom,
      vertex:vertex?Number(vertex.dataset.stairVertex):-1,
      roomKey:vertex?vertex.dataset.stairRoom:''};
    if(reviewView().drag.vertex>=0){
      const r=reviewMesh().rooms.find(q=>q.key===reviewView().drag.roomKey);
      reviewView().drag.stairBefore=r?atStairEditState(r):'';
      atSnapshotRoomEdit();
    }
    svg.setPointerCapture(e.pointerId);
  };
  svg.onpointermove=e=>{
    if(!atRoomMergeActive()&&!reviewView().drag?.shiftSelect&&typeof atPartPointerMove==='function' && atPartPointerMove(e,svg)) return;
    const d=reviewView().drag; if(!d) return;
    if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>5) d.moved=true;
    if(d.vertex>=0){
      const r=(reviewMesh().rooms||[]).find(q=>q.key===d.roomKey);
      if(!r) return;
      const sp=atSceneSvgPoint(e, svg);
      const world=atSceneUnprojectXY(sp.x, sp.y, r.z);
      if(typeof atStairMoveVertex==='function') atStairMoveVertex(r, d.vertex, world);
      atDrawRoomScene();
      return;
    }
    if(d.moved && !d.shiftSelect && !reviewView().plan){
      reviewView().yaw=d.yaw+(e.clientX-d.x)*0.007;
      reviewView().tilt=Math.max(0.25,Math.min(1.5,d.tilt+(e.clientY-d.y)*0.005));
      atDrawRoomScene();
    }
  };
  svg.onpointerup=e=>{
    if(!atRoomMergeActive()&&!reviewView().drag?.shiftSelect&&typeof atPartPointerUp==='function' && atPartPointerUp(e,svg)) return;
    const d=reviewView().drag; reviewView().drag=null;
    if(svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    if(d && d.vertex>=0){
      reviewView().suppressClick=true;
      const r=reviewMesh().rooms.find(q=>q.key===d.roomKey);
      atFinishStairEdit(r,d.stairBefore);
      return;
    }
    if(d && !d.moved && d.key){
      if(d.shiftSelect)atShiftSelectRoom(d.key);
      else if(atRoomMergeActive()||d.key!==reviewView().selected)atSelectViewerRoom(d.key);
    }
  };
  svg.onpointercancel=()=>{
    const d=reviewView().drag;reviewView().drag=null;
    if(typeof atParts!=='undefined')atParts.drag=null;
    if(d&&d.vertex>=0)atFinishStairEdit(reviewMesh().rooms.find(q=>q.key===d.roomKey),d.stairBefore);
  };
  svg.onkeydown=e=>{
    const dir=e.target.closest('[data-part-dir]');
    const del=e.target.closest('[data-part-delete]');
    if(dir&&(e.key==='Enter'||e.key===' ')){
      e.preventDefault();
      if(typeof atPartAskBlowDirEdit==='function') atPartAskBlowDirEdit(dir.dataset.partDir);
    }
    if(del&&(e.key==='Enter'||e.key===' ')){
      e.preventDefault();
      atPartRemove(del.dataset.partDelete);
    }
  };
  svg.ondblclick=e=>{
    e.preventDefault();
    if(atRoomMergeActive()||e.shiftKey)return;
    const r=(reviewMesh().rooms||[]).find(q=>q.key===reviewView().selected);
    if(!r || typeof atIsStairRoom!=='function' || !atIsStairRoom(r)) return;
    if(e.target.closest('[data-stair-vertex]')) return;
    const sp=atSceneSvgPoint(e, svg);
    const world=atSceneUnprojectXY(sp.x, sp.y, r.z);
    const before=atStairEditState(r);atSnapshotRoomEdit();
    if(typeof atStairInsertAt==='function') atStairInsertAt(r, world);
    reviewView().suppressClick=true;
    atFinishStairEdit(r,before);
  };
  svg.addEventListener('wheel',e=>{
    e.preventDefault(); reviewView().zoom=Math.max(0.5,Math.min(3,reviewView().zoom*Math.exp(-e.deltaY*0.001)));
    atDrawRoomScene();
  },{passive:false});
}

// Editing the existing calculation card uses the same persistent identity.
document.addEventListener('change',function(e){
  if(appMode!=='architrend' || !e.target.matches('.roomName')) return;
  const card=e.target.closest('.room-card');
  const r=reviewMesh()?.rooms.find(r=>r.key===card?.dataset.atRoomKey);
  if(!r) return;
  const value=e.target.value;
  e.target.value=r.name;
  atSnapshotRoomEdit();
  e.target.value=value;
  atRenameMeshRoom(r.key,value);
  atFinishRoomEdit();
});

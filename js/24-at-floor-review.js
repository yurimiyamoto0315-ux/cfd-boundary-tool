// A ceiling projection is a room-layout candidate, not proof of a solid floor.
function atRoomFloorStatus(room,mesh){
  if(room.floorVoid)return {state:'void',text:'床なし：階段開口・吹抜けとして設定済み'};
  if(!room.inferredFloor)return {state:'source',text:'床あり：元の3DSに床面があります'};
  if(room.floorReviewed)return {state:'confirmed',text:'床あり：補完する床を確認済み'};
  if(atRoomFloorAutomatic(room,mesh))return {state:'automatic',text:'床あり：資料と上階天井を照合して自動補完'};
  return {state:'pending',text:'要確認：床の補完候補です。まだ出力しません'};
}
function atRoomFloorEditorHtml(room){
  if(!(Number(room.floor)>1)||typeof appMode!=='undefined'&&appMode!=='architrend')return '';
  const gap=Number.isFinite(room.openingGapMm)?String(room.openingGapMm):'';
  const mesh=typeof reviewMesh==='function'?reviewMesh():null,info=mesh?.interstoryOpeningResult?.openings?.find(o=>o.roomKey===room.key);
  const status=atRoomFloorStatus(room,mesh);
  const measured=info?.gapSource==='source-ceiling'&&Number.isFinite(info.gapMm)?`取得した階間厚：${Number(info.gapMm.toFixed(3))} mm。`:'';
  const detailsOpen=room.floorVoid&&!Number.isFinite(info?.gapMm)||gap!=='';
  return `<div class="at-floor-status" data-floor-state="${status.state}" role="status">${status.text}</div><p class="at-floor-choice-help">床のある部屋はチェックを外して反映。階段が上がってくる場所・吹抜けはチェックを入れて反映します。</p><label class="at-rv-check"><input id="atRoomFloorVoid" type="checkbox" ${room.floorVoid?'checked':''}>階段開口・吹抜けにする（床なし）</label>${room.openingReviewRequired?'<p class="small">床・天井の形が変わったため、開口の指定を再確認して反映してください。</p>':''}<details class="at-floor-advanced" ${detailsOpen?'open':''}><summary>階間の厚み・開口のしくみ（詳細）</summary><p class="small">床なしにすると、この範囲の${room.floor}階床と${Number(room.floor)-1}階天井を抜き、階間の隙間を縦の壁で閉じます。下階からの階段は残します。</p><label class="at-rv-gap-label" for="atRoomOpeningGapMm">階間の厚み（mm）<input id="atRoomOpeningGapMm" type="number" min="0" max="2000" step="1" value="${gap}" placeholder="元データから自動取得"></label><p class="small">${measured}天井高さが取得できないときだけ入力してください。0 は厚みなしです。</p></details>`;
}
function atApplyRoomFloorEdit(room){
  if(typeof appMode!=='undefined'&&appMode!=='architrend')return true;
  const input=document.getElementById('atRoomFloorVoid');
  if(!(Number(room.floor)>1)||!input)return true;
  const field=document.getElementById('atRoomOpeningGapMm'),raw=String(field?.value??'').trim();
  if(input.checked&&(field?.validity?.badInput||raw!==''&&(!Number.isFinite(Number(raw))||Number(raw)<0||Number(raw)>2000)))return false;
  const wasVoid=!!room.floorVoid,wasPending=!!room.openingReviewRequired;
  if(input.checked&&!wasVoid&&(!wasPending||!room.openingPreviousUse)){
    room.openingPreviousUse={habitable:!!room.habitable,explicitGainTarget:!!room.explicitGainTarget,keep:!!room.keep};
    const card=typeof atRoomCard==='function'?atRoomCard(room.key):null;
    if(card){room.openingPreviousFields={};for(const key of ['roomArea','occCount','peopleSensRate','peopleMoistRate','equipSensRate','equipMoistRate','extraSens','extraMoist'])room.openingPreviousFields[key]=card.querySelector('.'+key)?.value??'';}
  }
  if(raw===''||!Number.isFinite(Number(raw))||Number(raw)<0||Number(raw)>2000)delete room.openingGapMm;else room.openingGapMm=Number(raw);
  room.floorVoid=input.checked;room.floorReviewed=true;
  if(room.floorVoid){
    room.habitable=false;room.explicitGainTarget=false;room.keep=false;
    if(typeof atStairClearRoom==='function')atStairClearRoom(room);
  }else if((wasVoid||wasPending)&&room.openingPreviousUse){
    Object.assign(room,room.openingPreviousUse);room.openingRestoreFields=true;
    delete room.openingPreviousUse;
  }
  room.openingReviewRequired=false;
  return true;
}
function atCompleteRoomOpeningEdit(room){
  if(!room.openingRestoreFields)return;
  const card=typeof atRoomCard==='function'?atRoomCard(room.key):null;
  if(card)for(const [key,value] of Object.entries(room.openingPreviousFields||{})){const field=card.querySelector('.'+key);if(field)field.value=value;}
  delete room.openingRestoreFields;delete room.openingPreviousFields;
}
function atRoomOpeningSignature(room,mesh){
  if(!room||!mesh||!Number.isFinite(room.z)||!Array.isArray(room.ring))return null;
  const below=(mesh.rooms||[]).filter(r=>Number.isFinite(r.z)&&r.z<room.z-0.1);
  const lower=below.length?Math.max(...below.map(r=>r.z)):null;
  const bounds=atRingBBox(room.ring),faces=(mesh.meshFaces||[]).filter(f=>{
    const verts=f.verts||[];if(verts.length<3||!verts.every(v=>Number.isFinite(v.z)))return false;
    const lo=Math.min(...verts.map(v=>v.z)),hi=Math.max(...verts.map(v=>v.z)),b=atFaceBBox(f);
    return hi-lo<0.01&&hi<=room.z+0.05&&(lower===null||lo>lower+0.1)&&
      b.maxx>=bounds.minx&&b.minx<=bounds.maxx&&b.maxy>=bounds.miny&&b.miny<=bounds.maxy&&
      (f.sslKey==='innerwall'||f.sslKey==='floor_out'||f.sslKey==='floor1');
  }).map(f=>{
    const coordinate=v=>[v.x,v.y,v.z].map(n=>Math.round(n*1e6)/1e6).join(','),verts=f.verts||[];
    const triangles=f.tris?.length?f.tris:atRoomFloorTriangles({ring:verts});
    return [f.sslKey,f.nameJa||'',triangles.map(t=>t.map(i=>coordinate(verts[i])).sort().join(';')).sort().join('/')].join('|');
  }).sort();
  return JSON.stringify({version:1,upper:room.z,lower,faces});
}
// A projected room is solid only when a real upper ceiling and a current,
// one-to-one source room independently support its closed region. This never
// changes the user's floor/opening choices or manufactures a missing layout.
function atPlanProjectedFloorEvidence(mesh,pdfRooms){
  const rooms=mesh?.rooms||[],pdfs=Array.isArray(pdfRooms)?pdfRooms:[],faces=mesh?.meshFaces||[],decisions=[];
  const key=r=>String(r.key),floor=v=>/^[1-9]\d?$/.test(String(v??''))?String(Number(v)):'';
  const byId=new Map(),claims=new Map(),roomKeys=new Set(),duplicateKeys=new Set();
  rooms.forEach(r=>{const k=key(r);if(roomKeys.has(k))duplicateKeys.add(k);roomKeys.add(k);if(Number.isInteger(r.pdfIndex)){if(!claims.has(r.pdfIndex))claims.set(r.pdfIndex,[]);claims.get(r.pdfIndex).push(r);}});
  faces.forEach(f=>{if(!byId.has(f.atFaceId))byId.set(f.atFaceId,[]);byId.get(f.atFaceId).push(f);});
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const area=poly=>{if(poly.length<3)return 0;const o=poly[0];let n=0;poly.forEach((p,i)=>{const q=poly[(i+1)%poly.length];n+=(p.x-o.x)*(q.y-o.y)-(q.x-o.x)*(p.y-o.y);});return Math.abs(n)/2;};
  function intersection(subject,clip){
    let polygon=subject.map(p=>({x:p.x,y:p.y}));const direction=cross(...clip)>=0?1:-1;
    for(let i=0;i<3&&polygon.length;i++){
      const a=clip[i],b=clip[(i+1)%3],next=[];
      for(let j=0;j<polygon.length;j++){
        const p=polygon[j],q=polygon[(j+1)%polygon.length],dp=cross(a,b,p)*direction,dq=cross(a,b,q)*direction;
        if(dp>=-1e-10)next.push(p);
        if((dp>=-1e-10)!==(dq>=-1e-10)){const t=dp/(dp-dq);next.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});}
      }polygon=next;
    }return area(polygon);
  }
  const triangles=f=>{
    const vs=f?.verts||[],ts=f?.tris||[];
    if(!ts.length||ts.length>1024||vs.some(p=>!p||![p.x,p.y,p.z].every(Number.isFinite)))return null;
    if(ts.some(t=>!Array.isArray(t)||t.length!==3||t.some(i=>!Number.isInteger(i)||!vs[i])))return null;
    const out=ts.map(t=>t.map(i=>vs[i]));return out.every(t=>area(t)>1e-10)?out:null;
  };
  const triangleKey=ts=>ts.map(t=>t.map(p=>[p.x,p.y].map(n=>Math.round(n*1e7)/1e7).join(',')).sort().join(';')).sort().join('|');
  const sourceChecks=new Map();
  function ceilingSupports(projected,room,roomTris){
    if(!Number.isFinite(room.z)||(projected.verts||[]).some(p=>!Number.isFinite(p.z)||Math.abs(p.z-room.z)>.01))return false;
    const sources=byId.get(projected.floorProjectionCeilingId)||[];if(sources.length!==1)return false;
    const source=sources[0];
    if(source.generatedFloor||source.sslKey!=='innerwall'||source.nameJa!=='天井')return false;
    const zs=(source.verts||[]).map(p=>p.z);if(!zs.length||Math.max(...zs)-Math.min(...zs)>.05)return false;
    const top=zs.reduce((a,b)=>a+b,0)/zs.length;
    if(!(top>room.z+1.2&&Math.abs(top-room.zTop)<.15))return false;
    const ceiling=triangles(source),projection=triangles(projected);
    if(!ceiling||!projection||triangleKey(ceiling)!==triangleKey(projection))return false;
    if(!sourceChecks.has(source)){
      let valid=true;for(let i=0;i<ceiling.length&&valid;i++)for(let j=i+1;j<ceiling.length;j++)if(intersection(ceiling[i],ceiling[j])>1e-8){valid=false;break;}
      sourceChecks.set(source,valid);
    }
    if(!sourceChecks.get(source))return false;
    const covered=roomTris.reduce((sum,t)=>sum+ceiling.reduce((n,s)=>n+intersection(t,s),0),0);
    return Math.abs(covered-room.area)<=Math.max(1e-7,room.area*1e-8);
  }
  rooms.filter(r=>r.inferredFloor).forEach(room=>{
    const decision={roomKey:key(room),state:'hold',codes:[]},hold=code=>{decision.codes.push(code);return decision;};decisions.push(decision);
    if(room.floorReviewed||room.floorVoid||room.manualAssignment||room.manualMerged||room.openingReviewRequired){decision.state='manual';return;}
    if(duplicateKeys.has(key(room)))return hold('AT3DS_FLOOR_ROOM_AMBIGUOUS');
    if(room.floorProjectionSource!=='storey-ceiling')return hold('AT3DS_UPPER_LAYOUT_MISSING');
    const ids=Array.isArray(room.floorFaceIds)?room.floorFaceIds:[],projected=ids.flatMap(id=>byId.get(id)||[]);
    if(ids.length!==1||projected.length!==1||!projected[0].generatedFloor||projected[0].floorProjectionSource!=='storey-ceiling')return hold('AT3DS_FLOOR_SOURCE_REQUIRED');
    const ring=room.ring||[],indices=atRoomFloorTriangles(room),roomTris=indices.map(t=>t.map(i=>ring[i]));
    if(!(Number.isFinite(room.area)&&room.area>0)||!roomTris.length||Math.abs(roomTris.reduce((n,t)=>n+area(t),0)-room.area)>Math.max(1e-7,room.area*1e-8)||!ceilingSupports(projected[0],room,roomTris))return hold('AT3DS_FLOOR_SOURCE_REQUIRED');
    const index=room.pdfIndex,p=Number.isInteger(index)?pdfs[index]:null,match=room.pdfMatch;
    if(!p||!match||match.pdfIndex!==index||match.requiresReview!==false||match.roomKeys?.length!==1||String(match.roomKeys[0])!==key(room)||room.roomMatchGroup||(claims.get(index)||[]).length!==1||room.name!==p.name)return hold('AT3DS_FLOOR_ROOM_MATCH_REQUIRED');
    if(!floor(p.floor)||floor(p.floor)!==floor(room.floor))return hold('AT3DS_FLOOR_SOURCE_LEVEL_REQUIRED');
    if(p.sourceAreaMissing||p.sourceAreaConfirmed===false||p.sourceAreaAggregate||p.sourceAreaCombined||!(Number.isFinite(p.area)&&p.area>0)||Math.abs(p.area-room.area)>Math.max(.08,p.area*.01))return hold('AT3DS_FLOOR_SOURCE_AREA_REQUIRED');
    if(!p.name||/吹|階段|STAIR|VOID|OPEN|小屋裏|屋根裏|床下|バルコニー|ベランダ|テラス|ポーチ|車庫/i.test(p.name)||room.stairManual||room.stairPath||room.stair)return hold('AT3DS_FLOOR_OPENING_REVIEW_REQUIRED');
    decision.state='solid';decision.codes=['AT3DS_FLOOR_SOURCE_CONFIRMED'];
  });
  return {version:1,decisions,counts:{automatic:decisions.filter(d=>d.state==='solid').length,manual:decisions.filter(d=>d.state==='manual').length,pending:decisions.filter(d=>d.state==='hold').length}};
}
function atSetProjectedFloorSources(mesh,pdfRooms){
  if(!mesh)return null;
  mesh.projectedFloorSourceRooms=Array.isArray(pdfRooms)?pdfRooms:null;
  delete mesh.projectedFloorEvidenceCache;delete mesh.resolvedFloorCache;
  return atCurrentProjectedFloorEvidence(mesh);
}
function atCurrentProjectedFloorEvidence(mesh){
  const pdfs=mesh?.projectedFloorSourceRooms||[];
  const signature=JSON.stringify({rooms:(mesh?.rooms||[]).map(r=>[r.key,r.floor,r.z,r.zTop,r.area,r.ring,r.name,r.pdfIndex,r.pdfMatch,r.roomMatchGroup,r.floorFaceIds,r.floorProjectionSource,!!r.inferredFloor,!!r.floorReviewed,!!r.floorVoid,!!r.manualAssignment,!!r.manualMerged,!!r.openingReviewRequired,!!r.stairManual,!!r.stairPath,!!r.stair]),
    pdfs:pdfs.map(p=>[p.name,p.floor,p.area,p.sourceAreaMissing,p.sourceAreaConfirmed,p.sourceAreaAggregate,p.sourceAreaCombined]),faces:(mesh?.meshFaces||[]).map(f=>[f.atFaceId,f.sslKey,f.nameJa,!!f.generatedFloor,f.floorProjectionSource,f.floorProjectionCeilingId,f.verts,f.tris])});
  if(mesh?.projectedFloorEvidenceCache?.signature===signature)return mesh.projectedFloorEvidenceCache.plan;
  const plan=atPlanProjectedFloorEvidence(mesh,pdfs);if(mesh)mesh.projectedFloorEvidenceCache={signature,plan};return plan;
}
function atRoomFloorAutomatic(room,mesh){
  return atCurrentProjectedFloorEvidence(mesh).decisions.some(d=>d.roomKey===String(room.key)&&d.state==='solid');
}
function atRoomFloorReadiness(mesh){
  if((mesh?.rooms||[]).some(r=>r.openingReviewRequired))return {ready:false,codes:['AT_OPENING_REVIEW_REQUIRED'],message:'保存した開口と現在の天井・床の形状が変わっています。対象区画の開口指定を確認し、「開口の変更を反映」を押してください。'};
  if((mesh?.rooms||[]).some(r=>r.floorVoid!==undefined&&typeof r.floorVoid!=='boolean'))return {ready:false,codes:['AT_OPENING_SELECTION_INVALID'],message:'開口の指定が不正です。区画を選び直して開口の変更を反映してください。'};
  const evidence=atCurrentProjectedFloorEvidence(mesh),automatic=new Set(evidence.decisions.filter(d=>d.state==='solid').map(d=>d.roomKey));
  const pending=(mesh?.rooms||[]).filter(r=>r.inferredFloor&&!r.floorReviewed&&!automatic.has(String(r.key)));
  if((mesh?.rooms||[]).some(r=>r.floorVoid)){
    atResolvedRoomFloorFaces(mesh);
    const opening=mesh.interstoryOpeningResult;
    if(!opening?.ready)return {ready:false,codes:(opening?.diagnostics||[]).map(d=>d.code),message:atInterstoryOpeningMessage(opening)};
  }
  if((mesh?.rooms||[]).some(r=>r.inferredFloor&&r.floorReviewed&&!r.floorVoid&&!atRoomFloorTriangles(r).length))return {ready:false,codes:['AT3DS_PROJECTED_FLOOR_INVALID'],message:'上階床の外形を正しく出力できません。区画の形状を確認してください。'};
  const missing=pending.some(r=>r.floorProjectionSource==='footprint-unconfirmed');
  return {ready:!pending.length,codes:pending.length?['AT3DS_PROJECTED_FLOOR_REVIEW_REQUIRED',...(missing?['AT3DS_UPPER_LAYOUT_MISSING']:[])]:[],
    message:missing?'元の3DSに床面や上階天井の根拠が不足しています。候補区画を図面と照合し、床あり／階段開口・吹抜けを確定してください。図と違う場合は、床・内壁・天井を含めて再出力してください。':pending.length?'上階の床・吹抜けが未確認です。図面と照合し、モデル下の「床・吹抜けの確認」で確定してください。':''};
}
function atInterstoryOpeningMessage(result){
  const codes=(result?.diagnostics||[]).map(d=>d.code).join(' ');
  if(/CEILING_AMBIGUOUS|CEILING_PARTIAL_CONFLICT|STEP/.test(codes))return '下階の天井高さが複数あり、段差部分の壁を確定できません。区画を分けるか、天井と段差壁を含む元モデルを確認してください。';
  if(/GAP_CONFLICT/.test(codes))return '同じ階で指定した階間の厚みが一致しません。開口ごとの値を確認してください。';
  if(/LOWER_STORY_UNKNOWN/.test(codes))return '直下の階を確認できません。下階を含むモデルと階の指定を確認してください。';
  if(/GAP|CEILING|HEIGHT|LEVEL/.test(codes))return '下階天井と上階床の高さを確認できません。開口の「階間の厚み」を入力して再度反映してください。';
  return '階段開口・吹抜けの形状を確定できません。選択した区画と階間の厚みを確認してください。';
}
function atRenderFloorReview(){
  const host=document.getElementById('atFloorReview');if(!host)return;
  const mesh=typeof atMesh!=='undefined'?atMesh:null,rooms=(mesh?.rooms||[]).filter(r=>r.inferredFloor);
  host.hidden=!rooms.length||appMode!=='architrend';if(host.hidden){host.innerHTML='';return;}
  const floors=[...new Set(rooms.map(r=>r.floor))];
  const automatic=new Set(atCurrentProjectedFloorEvidence(mesh).decisions.filter(d=>d.state==='solid').map(d=>d.roomKey));
  const missing=rooms.some(r=>!r.floorReviewed&&!automatic.has(String(r.key))&&r.floorProjectionSource==='footprint-unconfirmed');
  const pendingCount=rooms.filter(r=>!r.floorReviewed&&!automatic.has(String(r.key))).length;
  host.dataset.floorPending=String(pendingCount);
  const wasOpen=host.querySelector('details')?.open||false;
  host.innerHTML='<details class="at-floor-review-details"'+(wasOpen?' open':'')+'><summary>床・吹抜けの確認'+(pendingCount?'（未確認 '+pendingCount+' 区画）':'（確認済み）')+'</summary><p>3DSに床面がない区画の補完を確認します。図面と照合し、吹抜け・階段開口は図の部屋を選んで右の「床・吹抜けの設定」で指定してください。残りを床として確定する場合は、下の操作を使います。</p>'+(missing?'<p>上階天井がない区画は、モデルの外形や壁から作った候補です。図面と違う場合は、上階の床・内壁・天井を含む3DSを再出力してください。</p>':'')+floors.map(f=>{
    const onFloor=rooms.filter(r=>r.floor===f),pending=onFloor.filter(r=>!r.floorReviewed&&!automatic.has(String(r.key))),voids=onFloor.filter(r=>r.floorVoid),auto=onFloor.filter(r=>automatic.has(String(r.key))).length;
    return `<div class="at-floor-review-row boundary-action-bar" data-boundary-action="floor:${f}"><div><p class="boundary-action-status" role="status" aria-live="polite" data-state="${pending.length?'pending':'applied'}">${f}階：${pending.length?'未確認 '+pending.length+'区画':'確認済み '+onFloor.length+'区画'}${auto?' ／ 資料と上階天井で自動確認 '+auto+'区画':''} ／ 床あり ${onFloor.length-voids.length}区画・床なし ${voids.length}区画</p><label><input type="checkbox" data-floor-check="${f}">この階の区画と吹抜け位置を図面で確認した</label></div><button type="button" data-floor-confirm="${f}" disabled>${f}階の床を確定する</button></div>`;
  }).join('')+'</details>';
  host.querySelectorAll('[data-floor-check]').forEach(input=>input.onchange=()=>{host.querySelector('[data-floor-confirm="'+input.dataset.floorCheck+'"]').disabled=!input.checked;});
  host.querySelectorAll('[data-floor-confirm]').forEach(button=>button.onclick=()=>{
    const chosen=host.querySelector('[data-floor-check="'+button.dataset.floorConfirm+'"]');if(!chosen?.checked)return;
    if(typeof atSnapshotRoomEdit==='function')atSnapshotRoomEdit();
    rooms.filter(r=>String(r.floor)===button.dataset.floorConfirm).forEach(r=>r.floorReviewed=true);
    mesh.gainVolumes=null;
    window.dispatchEvent(new CustomEvent('architrend-room-mapping-changed'));
    if(typeof atFinishRoomEdit==='function')atFinishRoomEdit();
    if(typeof refreshIdfMeshUi==='function')refreshIdfMeshUi();
  });
}
function atRoomFloorTriangles(room){
  const ring=room.ring||[];if(ring.length<3||typeof idfMeshEarClip2!=='function')return [];
  const origin=ring[0],local=ring.map(p=>({x:p.x-origin.x,y:p.y-origin.y}));
  if(local.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return [];
  let twice=0;local.forEach((p,i)=>{const q=local[(i+1)%local.length];twice+=p.x*q.y-q.x*p.y;});
  const order=local.map((_,i)=>i);if(twice<0){local.reverse();order.reverse();}
  const raw=idfMeshEarClip2(local),tris=raw.map(t=>t.map(i=>order[i]));
  const area=tris.reduce((sum,t)=>{const [a,b,c]=t.map(i=>ring[i]);return sum+Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2;},0);
  return area>0&&Math.abs(area-Math.abs(twice)/2)<Math.max(1e-7,area*1e-8)?tris:[];
}
function atRoomFloorParts(room,mesh){
  const tris=atRoomFloorTriangles(room);if(!tris.length)return [];
  const known=(mesh.meshFaces||[]).filter(f=>!f.generatedFloor&&typeof atIsFloorFace==='function'&&atIsFloorFace(f)&&Math.abs(atFaceZ(f)-room.z)<0.05);
  if(!known.length||typeof atSplitPlate!=='function')return [room.ring];
  return atSplitPlate({verts:room.ring.map(p=>({x:p.x,y:p.y,z:room.z})),tris,floorExcludeFaces:known},[]);
}
function atRoomFloorHasActualSurface(room,mesh){
  const parts=atRoomFloorParts(room,mesh),remaining=parts.reduce((s,r)=>s+atRingAreaM2(r),0);
  return atRoomFloorTriangles(room).length>0&&room.area-remaining>Math.max(1e-6,room.area*1e-7);
}
function atResolvedRoomFloorFaces(mesh){
  const faces=mesh.meshFaces||[],rooms=(mesh.rooms||[]).filter(r=>r.inferredFloor);
  const openings=(mesh.rooms||[]).filter(r=>r.floorVoid);
  if(!rooms.length&&!openings.length&&!faces.some(f=>f.generatedFloor)){mesh.interstoryOpeningResult=null;return faces;}
  const evidence=atCurrentProjectedFloorEvidence(mesh),automatic=new Set(evidence.decisions.filter(d=>d.state==='solid').map(d=>d.roomKey));
  const signature=JSON.stringify({rooms:(mesh.rooms||[]).map(r=>[r.key,r.z,r.zTop,r.ring,!!r.inferredFloor,!!r.floorVoid,!!r.floorReviewed,r.floorProjectionSource,r.openingGapMm]),
    metadata:faces.map(f=>[f.sslKey,f.nameJa,f.atReplacedByPart]),automatic:evidence.decisions,epoch:typeof window!=='undefined'?window.boundaryExportEpoch:null});
  const cached=mesh.resolvedFloorCache;
  if(cached&&cached.signature===signature&&cached.source.length===faces.length&&cached.source.every((f,i)=>f===faces[i]))return cached.faces;
  const kept=faces.filter(f=>!f.generatedFloor);
  rooms.forEach(function(room){
    if(!room.floorReviewed&&!automatic.has(String(room.key)))return;
    atRoomFloorParts(room,mesh).forEach((ring,index)=>{
    const verts=ring.map(p=>({x:p.x,y:p.y,z:room.z})),tris=atRoomFloorTriangles({ring});
    if(verts.length<3||!tris.length)return;
    kept.push({sslKey:'innerwall',nameJa:'内床',idfName:'confirmed-floor-'+room.key+'-'+index,zone:'',
      generatedFloor:true,floorProjectionSource:room.floorProjectionSource,
      verts,tris,atFaceId:'confirmed-floor-'+room.key+'-'+index});
    });
  });
  let resolved=kept;
  if(openings.length){
    const planned=typeof atPlanInterstoryOpenings==='function'?atPlanInterstoryOpenings(kept,mesh.rooms):{ready:false,faces:kept,diagnostics:[{code:'OPENING_MODULE_UNAVAILABLE'}]};
    mesh.interstoryOpeningResult=planned;resolved=planned.faces||kept;
  }else mesh.interstoryOpeningResult=null;
  mesh.resolvedFloorCache={source:faces.slice(),signature,faces:resolved};
  return resolved;
}
if(typeof window!=='undefined')window.addEventListener('architrend-model-invalidated',atRenderFloorReview);

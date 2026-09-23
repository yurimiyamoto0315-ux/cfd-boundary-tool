// Room identity is editable independently of the inferred 3DS footprint.
// No network dependency: orthographic 3D projection of the imported mesh in SVG.
const atRoomView = {floor:'1', selected:'', plan:false, yaw:-0.45, tilt:0.85,
  zoom:1, northDeg:0, catalog:[], pending:null, undo:[], drag:null};
const AT_ROOM_COLORS = ['#70b4a4','#e4b76c','#8faed1','#ce91a3','#a8b878','#b09ac7','#79bfc9','#d4a284'];

function atSetRoomCatalog(rooms){
  if(rooms && rooms.length) atRoomView.catalog=JSON.parse(JSON.stringify(rooms));
}
function atRoomReviewState(){
  if(!atMesh || !atMesh.reviewHash) return atRoomView.pending;
  return {version:3, hash:atMesh.reviewHash, fileName:atMesh.fileName,
    northDeg:atRoomView.northDeg, rooms:JSON.parse(JSON.stringify(atMesh.rooms)), catalog:atRoomView.catalog,
    parts:typeof atPartReviewData==='function'?atPartReviewData():null};
}
function atRestoreRoomReviewState(state){
  atRoomView.pending=state && (state.version===1 || state.version===2 || state.version===3) ? state : null;
  if(atRoomView.pending) atRoomView.catalog=atRoomView.pending.catalog||[];
  if(atRoomView.pending && isFinite(atRoomView.pending.northDeg)) atRoomView.northDeg=atRoomView.pending.northDeg;
  atRestoreRoomAssignments();
}
function atRestoreRoomAssignments(){
  const s=atRoomView.pending;
  if(!atMesh || !s || !atMesh.reviewHash || s.hash!==atMesh.reviewHash) return false;
  const valid=Array.isArray(s.rooms) && s.rooms.every(r=>
    typeof r.key==='string' && Number.isFinite(r.floor) && Number.isFinite(r.z) &&
    Number.isFinite(r.zTop) && Number.isFinite(r.area) && Array.isArray(r.ring) &&
    r.ring.length>=3 && r.ring.every(p=>Number.isFinite(p.x) && Number.isFinite(p.y)));
  if(!valid) return false;
  atMesh.rooms=JSON.parse(JSON.stringify(s.rooms));
  if(typeof atPartRestoreReview==='function') atPartRestoreReview(s.parts);
  if(typeof atPlanStairsForMesh==='function') atPlanStairsForMesh(atMesh);
  if(typeof atApplyRoomGainFlags==='function') atApplyRoomGainFlags(atMesh);
  atMesh.gainVolumes=null;
  if(isFinite(s.northDeg)) atRoomView.northDeg=s.northDeg;
  atApplyNorthToMesh();
  atUpdateRoomVolume();
  atRenderRoomViewer();
  return true;
}
async function atRoomModelLoaded(buffer){
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  atMesh.reviewHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  atRoomView.undo=[];
  atRoomView.selected='';
  atRoomView.zoom=1;
  atRoomView.restored=atRestoreRoomAssignments();
  if(!atRoomView.restored){
    if(typeof atPartRestoreReview==='function') atPartRestoreReview(null);
    atRoomView.northDeg=0;
    atApplyNorthToMesh();
    if(!atLastParse) atRoomView.catalog=[];
  }
  atUpdateRoomVolume();
}
function atRoomTitle(r){ return r.name || '未割当'; }
function atRoomNumber(r){ return atMesh.rooms.indexOf(r)+1; }
function atRoomColor(r){ return AT_ROOM_COLORS[(atRoomNumber(r)-1)%AT_ROOM_COLORS.length]; }
function atUpdateRoomVolume(){
  if(!atMesh || typeof atMeshLivingVolume!=='function') return 0;
  const total=atMeshLivingVolume(atMesh);
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
  if(!atMesh) return;
  const counts={};
  (atMesh.meshFaces||[]).forEach(f=>{
    if(/^wall_/.test(f.sslKey) && isFinite(f.modelToolAz)){
      const orient=at3dsOrientFromToolAz(at3dsWrap180(f.modelToolAz-atRoomView.northDeg));
      f.sslKey='wall_'+orient;
      f.nameJa='外壁'+orient;
    }
    counts[f.nameJa]=(counts[f.nameJa]||0)+1;
  });
  if(atMesh.stats) atMesh.stats.counts=counts;
}
function atUpdateNorthAffectedWindows(){
  if(!atMesh || typeof atAssignWindowsToRooms!=='function') return;
  const wins=atAssignWindowsToRooms(atMesh.meshFaces,atMesh.rooms,atMesh.stats);
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
  atRoomView.northDeg=at3dsWrap180(raw);
  atApplyNorthToMesh();
  atUpdateNorthAffectedWindows();
  const num=document.getElementById('atNorthDeg');
  const range=document.getElementById('atNorthRange');
  if(num) num.value=String(Math.round(atRoomView.northDeg*10)/10);
  if(range) range.value=String(atRoomView.northDeg);
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
  if(!atMesh || typeof atAssignWindowsToRooms!=='function') return;
  if(typeof atApplyRoomGainFlags==='function') atApplyRoomGainFlags(atMesh);
  const meshWins=atAssignWindowsToRooms(atMesh.meshFaces,atMesh.rooms,atMesh.stats);
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
    const room=(atMesh.rooms||[]).find(r=>r.key===mw.roomKey);
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
  atRoomView.undo.push({rooms:JSON.parse(JSON.stringify(atMesh.rooms)), state:gatherState()});
  if(atRoomView.undo.length>30) atRoomView.undo.shift();
}
function atSyncEditedRoom(r){
  if(typeof atPlanStairsForMesh==='function') atPlanStairsForMesh(atMesh);
  if(typeof atApplyRoomGainFlags==='function') atApplyRoomGainFlags(atMesh);
  let card=atRoomCard(r.key);
  if(r.keep && !card){ atAddRoomCardFromMesh(r); card=atRoomCard(r.key); }
  if(card && !r.keep){
    card.querySelectorAll('.win-row').forEach(row=>{
      atUnassignedWindows.push(atWindowRowData(row));
    });
    card.remove();
    renderUnassignedWindows();
  }else if(card){
    card.querySelector('.roomName').value=r.name;
    if(typeof atSyncRoomCardKind==='function') atSyncRoomCardKind(card, r);
  }
  atAssignableRooms=atMesh.rooms.filter(r=>r.keep || r.habitable).map(r=>Object.assign({},r));
  atMesh.gainVolumes=atBuildGainVolumes(atMesh);
}
function atFinishRoomEdit(){
  atSyncMeshWindowsToRooms();
  atUpdateRoomVolume();
  runAll();
  saveStateNow();
  atRenderRoomViewer();
}
function atAssignPdfRoom(r,index){
  const p=atRoomView.catalog[index];
  r.pdfIndex=p ? index : null;
  r.pdfArea=p ? p.area : null;
  r.pdfType=p ? p.type : '';
  r.name=p ? p.name : '';
  r.habitable=p ? isArchitrendLivingRoom(p) : false;
  r.manualAssignment=true;
  r.reviewed=false;
}
function atCommitRoomEdit(){
  const r=atMesh.rooms.find(r=>r.key===atRoomView.selected);
  if(!r) return;
  const name=document.getElementById('atRoomNameEdit').value.trim();
  const message=document.getElementById('atRoomEditMessage');
  if(!name){ message.textContent='部屋名を入力するか、PDFの部屋を選んでください。'; return; }
  const index=Number(document.getElementById('atRoomPdfChoice').value);
  const habitable=document.getElementById('atRoomHeatTarget').checked;
  atSnapshotRoomEdit();
  // Selecting an occupied PDF identity swaps it, so the same PDF row is never silently duplicated.
  const other=index>=0 && atMesh.rooms.find(q=>q!==r && q.pdfIndex===index);
  if(other){
    atAssignPdfRoom(other,Number.isInteger(r.pdfIndex) ? r.pdfIndex : -1);
    atSyncEditedRoom(other);
  }
  atAssignPdfRoom(r,index);
  r.name=name;
  r.habitable=habitable;
  r.reviewed=true;
  atSyncEditedRoom(r);
  atFinishRoomEdit();
}
function atUndoRoomEdit(){
  const prev=atRoomView.undo.pop();
  if(!prev) return;
  atMesh.rooms=prev.rooms;
  applyState(prev.state);
  atUnassignedWindows=prev.state.atUnassigned||[];
  atAssignableRooms=prev.state.atRoomCandidates||[];
  renderUnassignedWindows();
  atMesh.gainVolumes=atBuildGainVolumes(atMesh);
  atFinishRoomEdit();
}
function atSelectViewerRoom(key){
  atRoomView.selected=key;
  atRenderRoomViewer();
}
function atStairEditorHtml(r){
  const n=((r.stair&&r.stair.treads)||[]).length;
  const nR=((r.stair&&r.stair.risers)||[]).length;
  const note=r.stair && r.stair.note ? `<p class="small at-rv-stair-note">${escapeHtml(r.stair.note)}</p>` : '';
  const rise=r.stair ? (r.stair.toZ-r.stair.fromZ).toFixed(2) : '—';
  const going=r.stair && r.stair.going ? r.stair.going.toFixed(2) : '—';
  return `<div class="at-rv-stair">
      <p class="small">頂点は水平・垂直だけ動きます。階段下など隣の区画へ線を延ばせます。踏面と蹴上げは壁間の厚みなしパネルです。</p>
      <div class="at-rv-room-geometry"><span>到達高さ <b>${rise} m</b></span><span>踏面 ${n} / 蹴上 ${nR} / 進み <b>${going} m</b></span></div>
      ${note}
      <div class="at-rv-stair-actions">
        <button type="button" data-action="stair-add">折れを足す</button>
        <button type="button" data-action="stair-flip">方向を反転</button>
        <button type="button" data-action="stair-reset">直線に戻す</button>
      </div>
    </div>`;
}
function atStairEditAction(kind){
  const r=atMesh && (atMesh.rooms||[]).find(q=>q.key===atRoomView.selected);
  if(!r || typeof atIsStairRoom!=='function' || !atIsStairRoom(r)) return;
  atSnapshotRoomEdit();
  if(kind==='add' && typeof atStairAddCorner==='function') atStairAddCorner(r);
  else if(kind==='flip' && typeof atStairFlipPath==='function') atStairFlipPath(r);
  else if(kind==='reset' && typeof atStairResetPath==='function') atStairResetPath(r);
  saveStateDebounced();
  atRenderRoomViewer();
}
function atRenderRoomViewer(){
  const host=document.getElementById('atRoomViewer');
  if(!host) return;
  host.hidden=!atMesh;
  if(!atMesh) return;
  const rooms=atMesh.rooms||[];
  document.querySelectorAll('[data-at-rename-key]').forEach(el=>{
    const r=rooms.find(r=>r.key===el.dataset.atRenameKey);
    if(r) el.value=r.name||'';
  });
  const floors=Array.from(new Set(rooms.map(r=>String(r.floor)))).sort((a,b)=>Number(a)-Number(b));
  if(atRoomView.floor!=='all' && !floors.includes(atRoomView.floor)) atRoomView.floor=floors[0]||'1';
  const visible=rooms.filter(r=>atRoomView.floor==='all' || String(r.floor)===atRoomView.floor);
  if(!visible.some(r=>r.key===atRoomView.selected)) atRoomView.selected=visible[0]?.key||'';
  const selected=rooms.find(r=>r.key===atRoomView.selected);
  const checked=rooms.filter(r=>r.reviewed).length;
  const livingVolume=typeof atMeshLivingVolume==='function'?atMeshLivingVolume(atMesh):0;
  const esc=escapeHtml;
  host.innerHTML=`
    <div class="at-rv-heading"><div><span class="at-rv-eyebrow">部屋の確認</span><h3>部屋の位置と名前を確認</h3></div>
      <div class="at-rv-metrics"><span class="at-rv-progress">確認済み ${checked} / ${rooms.length} 区画</span><span class="at-rv-volume">居室体積 ${livingVolume.toFixed(1)} m³</span></div></div>
    <p class="small">色の付いた床または一覧を選択 → 部屋名を修正 → 確定。破線は未確認です。収納・トイレ・未割当も表示します。階段は真上から中心線を引き、踏面と蹴上げが壁間に隙間なく並びます。</p>
    <div class="at-rv-toolbar" role="group" aria-label="表示する階">
      ${floors.map(f=>`<button type="button" data-floor="${esc(f)}" aria-pressed="${atRoomView.floor===f}">${esc(f)}F</button>`).join('')}
      <button type="button" data-floor="all" aria-pressed="${atRoomView.floor==='all'}">全階</button>
      <span class="at-rv-divider"></span>
      <button type="button" data-view="plan" aria-pressed="${atRoomView.plan}">真上から</button>
      <button type="button" data-view="3d" aria-pressed="${!atRoomView.plan}">3D</button>
      <button type="button" data-action="reset">視点を戻す</button>
      <button type="button" data-action="undo" ${atRoomView.undo.length?'':'disabled'}>元に戻す</button>
    </div>
    <div class="at-rv-orientation">
      <div class="at-rv-compass-mini" aria-hidden="true"><span style="transform:rotate(${atRoomView.northDeg}deg)">↑</span></div>
      <div><label for="atNorthDeg">北方向角</label><p class="small">平面図の上を0°、時計回りを正。外壁SAT・窓の直達日射・3DS/SSLの方位へ反映します。</p></div>
      <input id="atNorthRange" type="range" min="-180" max="180" step="1" value="${atRoomView.northDeg}" aria-label="北方向角スライダー">
      <div class="at-rv-angle"><input id="atNorthDeg" type="number" min="-180" max="180" step="1" value="${atRoomView.northDeg}"><span>°</span></div>
      <button type="button" data-action="north-zero">0°に戻す</button>
    </div>
    ${typeof atPartToolbarHtml==='function'?atPartToolbarHtml():''}
    <div class="at-rv-workspace"><div class="at-rv-stage">
      <svg id="atRoomScene" viewBox="0 0 900 570" role="group" aria-label="3DSの部屋配置。各部屋は右の一覧からも選べます。"></svg>
      <div class="at-rv-help">${selected && atIsStairRoom && atIsStairRoom(selected)
        ? (atRoomView.plan?'頂点は水平・垂直。線をダブルクリックで折れを足す':'頂点は水平・垂直。真上からが見やすいです')
        : (atRoomView.plan?'真上から表示':'ドラッグで回転')} · ホイールで拡大／縮小 · 床をクリックで選択</div>
      <div class="at-rv-model-note">読み込んだ3DSの解析メッシュ · 壁は低く切断表示 · 部屋形状は自動推定</div>
    </div><aside class="at-rv-side" aria-label="部屋の編集">
      <div id="atRoomEditor">${selected ? `
        <div class="at-rv-selection">区画 ${atRoomNumber(selected)} <span>${selected.floor}F · ${selected.area.toFixed(2)} m²</span></div>
        <div class="at-rv-room-geometry"><span>認識階高 <b>${atRoomHeight(selected).toFixed(2)} m</b></span><span>自動体積 <b>${atRoomVolume(selected).toFixed(1)} m³</b></span></div>
        <label for="atRoomPdfChoice">PDFの部屋を割り当て</label>
        <select id="atRoomPdfChoice"><option value="-1">自由入力・PDFと未対応</option>${atRoomView.catalog.map((p,i)=>{
          const assigned=rooms.find(r=>r.pdfIndex===i && r!==selected);
          return `<option value="${i}" ${selected.pdfIndex===i?'selected':''}>${esc(p.floor||'?')}F / ${esc(p.name)} / ${Number(p.area||0).toFixed(2)} m²${assigned?'（区画'+atRoomNumber(assigned)+'と入替）':''}</option>`;
        }).join('')}</select>
        <label for="atRoomNameEdit">表示・出力する部屋名</label>
        <input id="atRoomNameEdit" type="text" maxlength="100" value="${esc(selected.name)}" placeholder="例：LDK、洋室1、収納">
        <label class="at-rv-check"><input id="atRoomHeatTarget" type="checkbox" ${selected.habitable?'checked':''}>居室として人体・機器発熱を入れる</label>
        <p class="small">窓がある部屋は、チェックを外しても直達日射を内部発熱に残します。居室だけ換気体積と人体・機器を足します。</p>
        <button type="button" class="at-rv-confirm" data-action="commit">この内容で確定</button>
        <p id="atRoomEditMessage" class="small" aria-live="polite">${selected.reviewed?'確認済み。手動の割当を保持します。':'自動候補です。平面図と位置を確認してください。'}</p>
        ${selected.pdfArea!=null?`<p class="small">PDF面積 ${Number(selected.pdfArea).toFixed(2)} m² ／ 差 ${Math.abs(selected.area-selected.pdfArea).toFixed(2)} m²</p>`:''}
        ${typeof atIsStairRoom==='function' && atIsStairRoom(selected) ? atStairEditorHtml(selected) : ''}
      `:'<p>床から部屋を認識できませんでした。床・内壁を含む3DSを選択してください。</p>'}</div>
      <div class="at-rv-list" aria-label="表示中の部屋">${visible.map(r=>`
        <button type="button" data-room="${esc(r.key)}" aria-pressed="${r===selected}" class="at-rv-room">
          <i style="background:${atRoomColor(r)}"></i><span><b>${atRoomNumber(r)}. ${esc(atRoomTitle(r))}</b><small>${r.floor}F · ${r.area.toFixed(2)} m² · ${atRoomVolume(r).toFixed(1)} m³ · ${r.reviewed?'確認済み':'未確認'}${r.habitable?' · 居室':(r.keep?' · 日射のみ':' · 発熱なし')}</small></span>
        </button>`).join('')}</div>
      ${typeof atPartSideHtml==='function'?atPartSideHtml():''}
    </aside></div>
    <div class="at-rv-footer" id="atRoomReviewStatus" aria-live="polite"></div>`;
  const unused=atRoomView.catalog.filter((p,i)=>!rooms.some(r=>r.pdfIndex===i));
  document.getElementById('atRoomReviewStatus').textContent=
    (atRoomView.restored?'同じ3DSの保存済み割当を復元しました。 ':'')+
    '北方向 '+atRoomView.northDeg.toFixed(0)+'°。修正は自動保存・設定JSONに含まれます。再開時は同じ3DSを選択してください。'+
    (unused.length?' 未対応のPDF部屋: '+unused.map(p=>(p.floor||'?')+'F '+p.name).join('、'):'');
  host.onclick=e=>{
    if(atRoomView.suppressClick){ atRoomView.suppressClick=false; return; }
    const btn=e.target.closest('button');
    if(!btn) return;
    if(typeof atPartHandleButton==='function' && atPartHandleButton(btn)) return;
    if(btn.dataset.floor){ atRoomView.floor=btn.dataset.floor; atRoomView.zoom=1; atRenderRoomViewer(); }
    else if(btn.dataset.room) atSelectViewerRoom(btn.dataset.room);
    else if(btn.dataset.view){ atRoomView.plan=btn.dataset.view==='plan'; atRenderRoomViewer(); }
    else if(btn.dataset.action==='commit') atCommitRoomEdit();
    else if(btn.dataset.action==='undo') atUndoRoomEdit();
    else if(btn.dataset.action==='north-zero') atSetNorthAngle(0);
    else if(btn.dataset.action==='reset'){ atRoomView.yaw=-0.45; atRoomView.tilt=0.85; atRoomView.zoom=1; atDrawRoomScene(); }
    else if(btn.dataset.action==='stair-add') atStairEditAction('add');
    else if(btn.dataset.action==='stair-flip') atStairEditAction('flip');
    else if(btn.dataset.action==='stair-reset') atStairEditAction('reset');
  };
  const choice=document.getElementById('atRoomPdfChoice');
  if(choice) choice.onchange=()=>{
    const p=atRoomView.catalog[Number(choice.value)];
    if(p){
      document.getElementById('atRoomNameEdit').value=p.name;
      document.getElementById('atRoomHeatTarget').checked=isArchitrendLivingRoom(p);
    }
    const occupied=rooms.some(r=>r!==selected && r.pdfIndex===Number(choice.value));
    host.querySelector('[data-action="commit"]').textContent=occupied?'割当先と入れ替えて確定':'この内容で確定';
  };
  const northNum=document.getElementById('atNorthDeg');
  const northRange=document.getElementById('atNorthRange');
  if(northNum) northNum.onchange=()=>atSetNorthAngle(northNum.value);
  if(northRange) northRange.oninput=()=>atSetNorthAngle(northRange.value);
  const doorKind=document.getElementById('atDoorPartKind');
  if(doorKind) doorKind.onchange=()=>{atParts.doorKind=doorKind.value;atRenderRoomViewer();};
  const selectedKind=document.getElementById('atSelectedDoorKind');
  if(selectedKind) selectedKind.onchange=()=>atPartSetKind(atParts.selected,selectedKind.value);
  const partAngle=document.getElementById('atPartAngle');
  if(partAngle) partAngle.onchange=()=>atPartRotateAc(atParts.selected,partAngle.value);
  const blowDir=document.getElementById('atPartBlowDir');
  if(blowDir) blowDir.onchange=()=>atPartSetBlowDir(atParts.selected,blowDir.value);
  atBindRoomScene();
  atDrawRoomScene();
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
  if(!svg || !atMesh) return;
  const rooms=atMesh.rooms.filter(r=>atRoomView.floor==='all' || String(r.floor)===atRoomView.floor);
  if(!rooms.length){ svg.innerHTML=''; return; }
  const raw=p=>{
    if(atRoomView.plan) return {x:p.x,y:-p.y,d:p.z};
    const c=Math.cos(atRoomView.yaw),s=Math.sin(atRoomView.yaw);
    const x=p.x*c-p.y*s,y=p.x*s+p.y*c;
    return {x:x,y:-y*Math.sin(atRoomView.tilt)-p.z*Math.cos(atRoomView.tilt),d:y*Math.cos(atRoomView.tilt)-p.z*Math.sin(atRoomView.tilt)};
  };
  const corners=rooms.flatMap(r=>{
    const z1=r.z;
    let z2=r.z+0.7;
    if(r.stair) z2=Math.max(z2, r.stair.toZ||z2);
    return r.ring.flatMap(p=>[raw({...p,z:z1}), raw({...p,z:z2})]);
  });
  const minx=Math.min(...corners.map(p=>p.x)),maxx=Math.max(...corners.map(p=>p.x));
  const miny=Math.min(...corners.map(p=>p.y)),maxy=Math.max(...corners.map(p=>p.y));
  const scale=Math.min(790/Math.max(1,maxx-minx),440/Math.max(1,maxy-miny))*atRoomView.zoom;
  const midX=(minx+maxx)/2, midY=(miny+maxy)/2;
  atRoomView.proj={scale, midX, midY, yaw:atRoomView.yaw, tilt:atRoomView.tilt, plan:atRoomView.plan};
  const project=p=>{ const q=raw(p); return {x:450+(q.x-midX)*scale,y:275+(q.y-midY)*scale,d:q.d}; };
  const points=vs=>vs.map(p=>{const q=project(p); return q.x.toFixed(1)+','+q.y.toFixed(1);}).join(' ');
  const depths=vs=>vs.reduce((n,p)=>n+raw(p).d,0)/vs.length;
  const layers=[];
  const labelBoxes=[];
  const stories=Array.from(new Set(rooms.map(r=>r.floor)));
  stories.forEach(floor=>{
    const rs=rooms.filter(r=>r.floor===floor), z=Math.min(...rs.map(r=>r.z));
    const parts=[];
    (atMesh.meshFaces||[]).forEach(f=>{
      if(!atIsPartition(f) && f.sslKey!=='window') return;
      const triangles=f.tris?.length?f.tris.map(t=>t.map(i=>f.verts[i])):[f.verts||[]];
      triangles.forEach(vs=>{
        if(vs.length<3 || vs.some(p=>!p)) return;
        let cut=atClipRoomFace(vs,z-0.04,true);
        cut=atClipRoomFace(cut,z+0.7,false);
        if(cut.length<3) return;
        parts.push({d:depths(cut),html:`<polygon points="${points(cut)}" fill="${f.sslKey==='window'?'#b8d9e5':'#e5e9e7'}" stroke="#738780" stroke-width="0.65" opacity="0.7"/>`});
      });
    });
    rs.forEach(r=>{
      const vs=r.ring.map(p=>({...p,z:r.z+0.035}));
      const selected=r.key===atRoomView.selected;
      parts.push({d:depths(vs),html:`<polygon data-scene-room="${escapeHtml(r.key)}" points="${points(vs)}" fill="${atRoomColor(r)}" fill-opacity="${selected?0.94:0.68}" stroke="${selected?'#153f35':'#456357'}" stroke-width="${selected?3:1.3}" ${r.reviewed?'':'stroke-dasharray="6 4"'}><title>${escapeHtml(r.floor+'F '+atRoomTitle(r))}</title></polygon>`});
    });
    parts.sort((a,b)=>b.d-a.d);
    const labels=rs.map(r=>{
      const p=project({...atRoomLabelPoint(r),z:r.z+0.06});
      const title=atRoomTitle(r), short=title.length>12?title.slice(0,12)+'…':title;
      const w=Math.max(88,short.length*13+30), x=Math.max(w/2+5,Math.min(895-w/2,p.x));
      let y=p.y;
      for(let attempt=0;attempt<20;attempt++){
        if(!labelBoxes.some(b=>Math.abs(b.x-x)<(b.w+w)/2 && Math.abs(b.y-y)<34)) break;
        y=p.y+(attempt%2?-1:1)*Math.ceil((attempt+1)/2)*35;
      }
      labelBoxes.push({x,y,w});
      const line=Math.abs(y-p.y)>5?`<path d="M${p.x},${p.y} L${x},${y}" stroke="#527263" fill="none" stroke-width="0.8"/>`:'';
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
  const nr=atRoomView.northDeg*Math.PI/180;
  const tip={x:center.x+Math.sin(nr)*arrowLen,y:center.y+Math.cos(nr)*arrowLen,z:center.z};
  const pc=project(center), pt=project(tip);
  const compass=`<defs>
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
  const sel=(rooms||[]).find(r=>r.key===atRoomView.selected);
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
  const r=svg.getBoundingClientRect();
  return {x:(e.clientX-r.left)/r.width*900, y:(e.clientY-r.top)/r.height*570};
}
function atSceneUnprojectXY(sx, sy, z){
  const p=atRoomView.proj;
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
  svg.onpointerdown=e=>{
    if(e.button!==0) return;
    if(typeof atPartPointerDown==='function' && atPartPointerDown(e,svg)) return;
    const vertex=e.target.closest('[data-stair-vertex]');
    atRoomView.drag={x:e.clientX,y:e.clientY,yaw:atRoomView.yaw,tilt:atRoomView.tilt,moved:false,
      key:e.target.closest('[data-scene-room]')?.dataset.sceneRoom,
      vertex:vertex?Number(vertex.dataset.stairVertex):-1,
      roomKey:vertex?vertex.dataset.stairRoom:''};
    if(atRoomView.drag.vertex>=0) atSnapshotRoomEdit();
    svg.setPointerCapture(e.pointerId);
  };
  svg.onpointermove=e=>{
    if(typeof atPartPointerMove==='function' && atPartPointerMove(e,svg)) return;
    const d=atRoomView.drag; if(!d) return;
    if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>5) d.moved=true;
    if(d.vertex>=0){
      const r=(atMesh.rooms||[]).find(q=>q.key===d.roomKey);
      if(!r) return;
      const sp=atSceneSvgPoint(e, svg);
      const world=atSceneUnprojectXY(sp.x, sp.y, r.z);
      if(typeof atStairMoveVertex==='function') atStairMoveVertex(r, d.vertex, world);
      atDrawRoomScene();
      return;
    }
    if(d.moved && !atRoomView.plan){
      atRoomView.yaw=d.yaw+(e.clientX-d.x)*0.007;
      atRoomView.tilt=Math.max(0.25,Math.min(1.5,d.tilt+(e.clientY-d.y)*0.005));
      atDrawRoomScene();
    }
  };
  svg.onpointerup=e=>{
    if(typeof atPartPointerUp==='function' && atPartPointerUp(e,svg)) return;
    const d=atRoomView.drag; atRoomView.drag=null;
    if(svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    if(d && d.vertex>=0){
      atRoomView.suppressClick=true;
      if(typeof saveStateDebounced==='function') saveStateDebounced();
      atRenderRoomViewer();
      return;
    }
    if(d && !d.moved && d.key && d.key!==atRoomView.selected) atSelectViewerRoom(d.key);
  };
  svg.onpointercancel=()=>{ atRoomView.drag=null; if(typeof atParts!=='undefined') atParts.drag=null; };
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
    const r=(atMesh.rooms||[]).find(q=>q.key===atRoomView.selected);
    if(!r || typeof atIsStairRoom!=='function' || !atIsStairRoom(r)) return;
    if(e.target.closest('[data-stair-vertex]')) return;
    const sp=atSceneSvgPoint(e, svg);
    const world=atSceneUnprojectXY(sp.x, sp.y, r.z);
    atSnapshotRoomEdit();
    if(typeof atStairInsertAt==='function') atStairInsertAt(r, world);
    atRoomView.suppressClick=true;
    if(typeof saveStateDebounced==='function') saveStateDebounced();
    atRenderRoomViewer();
  };
  svg.addEventListener('wheel',e=>{
    e.preventDefault(); atRoomView.zoom=Math.max(0.5,Math.min(3,atRoomView.zoom*Math.exp(-e.deltaY*0.001)));
    atDrawRoomScene();
  },{passive:false});
}

// Editing the existing calculation card uses the same persistent identity.
document.addEventListener('change',function(e){
  if(appMode!=='architrend' || !e.target.matches('.roomName')) return;
  const card=e.target.closest('.room-card');
  const r=atMesh?.rooms.find(r=>r.key===card?.dataset.atRoomKey);
  if(!r) return;
  const value=e.target.value;
  e.target.value=r.name;
  atSnapshotRoomEdit();
  e.target.value=value;
  atRenameMeshRoom(r.key,value);
  atFinishRoomEdit();
});

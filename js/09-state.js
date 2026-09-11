// ========================= 保存 / 読込 =========================
const STORE_KEY = 'cfdBoundaryToolState_v2';
function modeStoreKey(mode){ return STORE_KEY+'_'+(mode||'manual'); }
let saveTimer=null;
function saveStateNow(){
  try{
    const s = gatherState();
    if(!s.mode) return;
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
    localStorage.setItem(modeStoreKey(s.mode), JSON.stringify(s));
    const info=document.getElementById('saveInfo');
    if(info) info.textContent = '自動保存済み ('+new Date().toLocaleTimeString()+')';
  }catch(err){}
}
function saveStateDebounced(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStateNow, 600);
}
function loadModeState(mode){
  try{
    const keyed=JSON.parse(localStorage.getItem(modeStoreKey(mode)));
    if(keyed) return keyed;
  }catch(err){}
  try{
    const last=JSON.parse(localStorage.getItem(STORE_KEY));
    if(last && last.mode===mode) return last;
    if(mode==='manual' && last && !last.mode && (last.rooms||[]).length) return last;
  }catch(err){}
  return null;
}
function gatherState(){
  const s = {mode: appMode, inputs:{}, checks:{}, rooms:[], atUnassigned: atUnassignedWindows.slice(),
    atRoomCandidates:atAssignableRooms.slice(), atNorthExcludedCount,
    epParse: appMode==='energyplus' ? epParse : null,
    epIdfName: appMode==='energyplus' ? epIdfName : '',
    epSqlName: appMode==='energyplus' ? epSqlName : '',
    epSqlPeak: appMode==='energyplus' ? epSqlPeak : null};
  document.querySelectorAll('input[id], select[id]').forEach(el=>{
    if(el.type==='file') return;
    if(el.id==='atPdfInput' || el.id==='epIdfInput' || el.id==='epSqlInput') return;
    if(el.type==='checkbox') s.checks[el.id]=el.checked;
    else s.inputs[el.id]=el.value;
  });
  document.querySelectorAll('.room-card').forEach(card=>{
    const r = {name:card.querySelector('.roomName').value, fields:{}, windows:[],
      isNonHabitable:card.dataset.nonHabitable==='true', atRoomKey:card.dataset.atRoomKey||'',
      epZone:card.dataset.epZone||''};
    ['peopleSensRate','occCount','peopleMoistRate','equipSensRate','roomArea','equipMoistRate','extraSens','extraMoist'].forEach(cls=>{
      const el = card.querySelector('.'+cls);
      if(el) r.fields[cls] = el.value;
    });
    card.querySelectorAll('.win-row').forEach(w=>{
      const win={};
      ['wName','wAz','glassSel','attachSel','wEta','wArea','wU'].forEach(cls=>{
        const el = w.querySelector('.'+cls);
        if(el) win[cls] = el.value;
      });
      r.windows.push(win);
    });
    s.rooms.push(r);
  });
  return s;
}
function applyState(s){
  if(!s) return;
  for(const id in (s.inputs||{})){
    if(id==='winGlass') continue; // winFrame復元後に選択肢を再構築してから反映する
    const el = document.getElementById(id);
    if(el) el.value = s.inputs[id];
  }
  if('winFrame' in (s.inputs||{})) populateWinGlass();
  if('winGlass' in (s.inputs||{})){
    const el = document.getElementById('winGlass');
    if(el) el.value = s.inputs.winGlass;
  }
  for(const id in (s.checks||{})){
    const el = document.getElementById(id);
    if(el) el.checked = s.checks[id];
  }
  document.getElementById('roomsWrap').innerHTML='';
  roomCount=0; winCounter=0;
  (s.rooms||[]).forEach(r=>addRoom(r));
}
function exportJSON(){
  const blob = new Blob([JSON.stringify(gatherState(), null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cfd_boundary_settings.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
function importJSON(input){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e=>{
    try{ applyState(JSON.parse(e.target.result)); runAll(); }
    catch(err){ alert('JSONの読み込みに失敗しました: '+err.message); }
  };
  reader.readAsText(file);
  input.value='';
}
function resetAll(){
  if(!confirm('入力内容をすべてリセットしますか?')) return;
  localStorage.removeItem(STORE_KEY);
  ['manual','architrend','energyplus'].forEach(m=>localStorage.removeItem(modeStoreKey(m)));
  location.reload();
}


function roundWinU(u){
  return Math.round(u*1000)/1000;
}
function uniqueSortedWinU(list){
  const us = [];
  (list||[]).forEach(u=>{
    if(!(u>0)) return;
    const n = roundWinU(u);
    if(us.indexOf(n)<0) us.push(n);
  });
  us.sort(function(a,b){ return a-b; });
  return us;
}
function windowUColorForIndex(i){
  const pal = (typeof WINDOW_U_COLOR_PALETTE!=='undefined') ? WINDOW_U_COLOR_PALETTE : [{r:80,g:180,b:220}];
  const n = pal.length || 1;
  return pal[((i%n)+n)%n];
}
function windowUColorGroupsFromUs(us){
  return (us||[]).map(function(u,i){
    const c = windowUColorForIndex(i);
    return {u:u, color:c, mat:(us.length>1 ? ('WINU'+i) : 'WINDOW')};
  });
}
function winDummyThickness(u, hi, ho, lam){
  if(!(u>0) || !(hi>0) || !(ho>0) || !(lam>0)) return null;
  const rBody = 1/u - 1/ho - 1/hi;
  if(!(rBody>0)) return null;
  return rBody * lam;
}
function collectRoomWindowUs(){
  const list = [];
  document.querySelectorAll('.win-row .wU').forEach(function(el){
    const u = parseFloat(el.value);
    if(u>0) list.push(u);
  });
  return uniqueSortedWinU(list);
}
function num(id){ return parseFloat(document.getElementById(id).value)||0; }
function fillIfEmpty(el, value){
  if(!el) return;
  if(el.value==='' || el.value==null) el.value = String(value);
}
function applySharedToolDefaults(){
  fillIfEmpty(document.getElementById('uFloor1'), TOOL_DEFAULTS.uFloor1);
  fillIfEmpty(document.getElementById('uFound'), TOOL_DEFAULTS.uFound);
  fillIfEmpty(document.getElementById('ach'), TOOL_DEFAULTS.ach);
  fillIfEmpty(document.getElementById('solarFc'), TOOL_DEFAULTS.solarFc);
  const latEl = document.getElementById('lat');
  const lonEl = document.getElementById('lon');
  const latN = latEl ? parseFloat(latEl.value) : NaN;
  const lonN = lonEl ? parseFloat(lonEl.value) : NaN;
  const geoMissing = !isFinite(latN) || !isFinite(lonN) ||
    (Math.abs(latN)<1e-9 && Math.abs(lonN)<1e-9);
  if(geoMissing){
    if(latEl) latEl.value = String(TOOL_DEFAULTS.lat);
    if(lonEl) lonEl.value = String(TOOL_DEFAULTS.lon);
  }
  fillIfEmpty(document.getElementById('calcDate'), TOOL_DEFAULTS.calcDate);
  const hourEl = document.getElementById('detailHour');
  if(hourEl && (hourEl.value==='' || hourEl.value==null || parseFloat(hourEl.value)===0)){
    hourEl.value = String(TOOL_DEFAULTS.detailHour);
  }
  document.querySelectorAll('.room-card').forEach(card=>{
    const zero = card.dataset.nonHabitable==='true';
    fillIfEmpty(card.querySelector('.peopleSensRate'), zero ? 0 : TOOL_DEFAULTS.peopleSensRate);
    fillIfEmpty(card.querySelector('.peopleMoistRate'), zero ? 0 : TOOL_DEFAULTS.peopleMoistRate);
    fillIfEmpty(card.querySelector('.equipSensRate'), zero ? 0 : TOOL_DEFAULTS.equipSensRate);
    fillIfEmpty(card.querySelector('.equipMoistRate'), zero ? 0 : TOOL_DEFAULTS.equipMoistRate);
  });
}
function hasInput(id){
  const el = document.getElementById(id);
  return !!(el && String(el.value).trim() !== '');
}
function numOrNull(id){
  if(!hasInput(id)) return null;
  const v = parseFloat(document.getElementById(id).value);
  return isFinite(v) ? v : null;
}
function readLatLon(){
  if(!hasInput('lat') || !hasInput('lon')){
    return {ok:false, reason:'緯度・経度が空欄です。敷地の値を入力してから実行してください。'};
  }
  const lat = parseFloat(document.getElementById('lat').value);
  const lon = parseFloat(document.getElementById('lon').value);
  if(!isFinite(lat) || !isFinite(lon)){
    return {ok:false, reason:'緯度・経度の数値が不正です。'};
  }
  // 空欄→0 や未設定のまま API/太陽位置を叩くと赤道・本初子午線になり、4月最暑や夜ピークSATになる
  if(Math.abs(lat) < 1e-9 && Math.abs(lon) < 1e-9){
    return {ok:false, reason:'緯度・経度が 0 のままです。敷地の座標を入力してください。'};
  }
  return {ok:true, lat, lon};
}
function fmtU(v){ return (v===null || v===undefined || !isFinite(v)) ? '—' : v; }
function getDateParts(){
  const fallback = (typeof TOOL_DEFAULTS!=='undefined' && TOOL_DEFAULTS.calcDate) ? TOOL_DEFAULTS.calcDate : '2026-07-25';
  const v = (document.getElementById('calcDate') && document.getElementById('calcDate').value) || fallback;
  const parts = String(v).split('-').map(Number);
  const y=parts[0], mo=parts[1], d=parts[2];
  if(!isFinite(y) || !isFinite(mo) || !isFinite(d) || mo<1 || mo>12 || d<1 || d>31){
    const fb = fallback.split('-').map(Number);
    return {y:fb[0], mo:fb[1], d:fb[2]};
  }
  return {y,mo,d};
}

// ========================= コピー =========================
document.addEventListener('click', function(e){
  const btn = e.target.closest('.copy-btn');
  if(!btn) return;
  const text = (btn.dataset.copy||'').replace(/&#10;/g,'\n');
  navigator.clipboard.writeText(text).then(()=>{
    const o = btn.textContent;
    btn.textContent = 'コピーしました';
    setTimeout(()=>{ btn.textContent = o; }, 900);
  });
});
function cfdRow(label, value, copyText){
  const c = (copyText!==undefined? copyText : value);
  return '<div class="cfd-value"><span class="k">'+label+'</span><span class="v">'+value+'</span><button class="copy-btn" data-copy="'+c+'">コピー</button></div>';
}
function cfdRowNoCopy(label, value){
  return '<div class="cfd-value"><span class="k">'+label+'</span><span class="v">'+value+'</span></div>';
}


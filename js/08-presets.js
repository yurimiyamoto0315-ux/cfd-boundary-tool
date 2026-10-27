// ========================= プリセット連動 =========================
function initSelectors(){
  const ts = document.getElementById('tatamiSel');
  ts.innerHTML = acCatalog.map((c,i)=>'<option value="'+i+'">'+c.tatami+'畳用</option>').join('');
  ts.value = '0';

  const wf = document.getElementById('winFrame');
  wf.innerHTML = Object.keys(jsmaWinTable).map(k=>'<option value="'+k+'">'+k+'</option>').join('');
  populateWinGlass();
  syncUWinFromTable();
}
function populateWinGlass(){
  const frame = document.getElementById('winFrame').value;
  const wg = document.getElementById('winGlass');
  wg.innerHTML = jsmaWinTable[frame].map((r,i)=>'<option value="'+i+'">'+r.label+'</option>').join('');
}
function selectedWinTableU(){
  const frame=document.getElementById('winFrame').value;
  const row=jsmaWinTable[frame]?.[+document.getElementById('winGlass').value];
  const value=row?.vals[+document.getElementById('winAttach').value];
  return Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
}
function updateWinPresetGuide(){
  const status=document.getElementById('winPresetStatus'),button=document.getElementById('winPresetApply');
  if(!status||!button)return;
  const u=selectedWinTableU(),input=document.getElementById('uWin');
  button.disabled=u===null;
  const current=input.value.trim()===''?null:Number(input.value);
  const same=u!==null&&current!==null&&Math.abs(current-u)<1e-8;
  status.dataset.state=current===null?'empty':same?'same':'different';
  status.textContent=u===null?'仕様を選び直してください。対応するU値を確認できません。':
    current===null?'U値はまだ空欄です。仕様を選び直すか、ボタンで U='+u+' を入力できます。':
    same?'U='+u+' を入力済みです。選択中の仕様と同じ値です。':
    '現在のU値は保持しています。ボタンを押すと、選択中の仕様の U='+u+' に置き換わります。';
}
function syncUWinFromTable(force=false){
  const el = document.getElementById('uWin');
  const wrap = el && el.closest('div');
  const u=selectedWinTableU();
  if(u===null){updateWinPresetGuide();return false;}
  document.getElementById('winTableInfo').textContent = '選択中の仕様: U='+u+' W/(m²K) (出典: JSMA 2025/7改訂)';
  if(!force&&wrap&&(wrap.classList.contains('ep-filled')||wrap.classList.contains('at-filled'))){
    updateWinPresetGuide();return false;
  }
  el.value=u;
  if(wrap){
    wrap.classList.remove('need-manual');
    if(force)wrap.classList.remove('ep-filled','at-filled');
  }
  updateWinPresetGuide();return true;
}
function applyWinTableU(){
  if(syncUWinFromTable(true))runAll();
}
document.addEventListener('change', function(e){
  let needsRerun = false;
  if(e.target.id==='tatamiSel'){
    document.getElementById('acMax').value = acCatalog[+e.target.value].max;
    needsRerun = true;
  }
  if(e.target.id==='dirSel' || e.target.id==='volSel'){
    const dirEl = document.getElementById('dirSel');
    const vol = document.getElementById('volSel').value;
    if(dirEl && !dirEl.disabled){
      document.getElementById('flowPerUnit').value = flowTable[dirEl.value][vol];
    }
    needsRerun = true;
  }
  if(e.target.id==='winFrame'){
    populateWinGlass();
    syncUWinFromTable();
    needsRerun = true;
  }
  if(e.target.id==='winGlass' || e.target.id==='winAttach'){
    syncUWinFromTable();
    needsRerun = true;
  }
  if(needsRerun) runAll();
});
document.getElementById('fetchHottestBtn').addEventListener('click', fetchHottestDay);
document.getElementById('geocodeAddressBtn').addEventListener('click', geocodeAddress);
document.addEventListener('input', function(e){
  if(e.target.matches('input, select')) runAll();
});


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
function syncUWinFromTable(){
  const el = document.getElementById('uWin');
  const wrap = el && el.closest('div');
  if(wrap && (wrap.classList.contains('ep-filled') || wrap.classList.contains('at-filled'))){
    return;
  }
  const frame = document.getElementById('winFrame').value;
  const row = jsmaWinTable[frame][+document.getElementById('winGlass').value];
  const attach = +document.getElementById('winAttach').value;
  if(!row) return;
  el.value = row.vals[attach];
  wrap && wrap.classList.remove('need-manual');
  document.getElementById('winTableInfo').textContent = '選択中の熱貫流率: U='+row.vals[attach]+' W/(m²K) (出典: JSMA 2025/7改訂)';
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


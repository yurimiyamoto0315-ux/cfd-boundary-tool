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
  if(appMode==='architrend' || appMode==='energyplus') return; // 連携モードでは表からの U 上書き禁止
  const frame = document.getElementById('winFrame').value;
  const row = jsmaWinTable[frame][+document.getElementById('winGlass').value];
  const attach = +document.getElementById('winAttach').value;
  document.getElementById('uWin').value = row.vals[attach];
  document.getElementById('winTableInfo').textContent = '選択中の熱貫流率: U='+row.vals[attach]+' W/(m²K) (出典: JSMA 2025/7改訂)';
}
document.addEventListener('change', function(e){
  let needsRerun = false;
  if(e.target.id==='tatamiSel'){
    document.getElementById('acMax').value = acCatalog[+e.target.value].max;
    needsRerun = true;
  }
  if(e.target.id==='dirSel' || e.target.id==='volSel'){
    const dir = document.getElementById('dirSel').value;
    const vol = document.getElementById('volSel').value;
    document.getElementById('flowPerUnit').value = flowTable[dir][vol];
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


// ========================= メイン再計算 =========================
let satChart=null, roomChart=null;
let transferRows=[];
function tr(step, target, item, value, copyVal){
  transferRows.push({step, target, item, value, copy:(copyVal!==undefined?copyVal:value)});
}

function runAll(){
  transferRows = [];
  const {y,mo,d} = getDateParts();
  const detailHour = num('detailHour');
  const geo = readLatLon();
  const lat = geo.ok ? geo.lat : null;
  const lon = geo.ok ? geo.lon : null;
  const tmax = numOrNull('tmax'), tmin = numOrNull('tmin'), tpeak = numOrNull('tpeak');
  const rho=num('rho'), alpha=num('alpha'), ho=num('ho')||23, roofCorr=num('roofCorr');
  const targetT=num('targetT'), initT=num('initT'), initRH=num('initRH');
  const taReady = (tmax!==null && tmin!==null && tpeak!==null);

  // ---- 太陽条件 (共通) ----
  // 緯度経度が空/0のまま計算すると経度0°扱いになり、日本の時計時刻で夜に日射ピークが出る
  let sp = {alt:0, az:0, sinAlt:0};
  let idn=0, isky=0;
  if(geo.ok){
    sp = solarPos(y,mo,d,detailHour,lat,lon);
    if(sp.alt>0){ idn=1098*Math.exp(-0.057/Math.sin(sp.alt)); isky=0.125*idn; }
  }
  const taNow = taReady ? taAt(detailHour, tmax, tmin, tpeak) : 0;
  const altDeg=(sp.alt*180/Math.PI), azDeg=(sp.az*180/Math.PI);
  let commonMsg = '';
  if(!geo.ok){
    commonMsg = '<span style="color:#DE5A3A; font-weight:600;">※'+geo.reason+' SAT・日射は計算しません。</span>';
  }else if(!taReady){
    commonMsg = '解析時刻の状態: 太陽高度 '+altDeg.toFixed(1)+'° / 方位角(南=0) '+azDeg.toFixed(1)+'° / 直達日射 I_DN '+idn.toFixed(0)+' W/m²'+
      ' <span style="color:#DE5A3A; font-weight:600;">※最高/最低気温・ピーク時刻が未入力のため外気温=0として仮表示しています。</span>';
  }else{
    commonMsg =
      '解析時刻の状態: 太陽高度 '+altDeg.toFixed(1)+'° / 方位角(南=0) '+azDeg.toFixed(1)+'° / 外気温 '+taNow.toFixed(1)+'℃ / 直達日射 I_DN '+idn.toFixed(0)+' W/m²'+
      (sp.alt<=0 ? ' <span style="color:#DE5A3A; font-weight:600;">※太陽高度が0以下です。日射はゼロとして計算します。</span>':'');
  }
  document.getElementById('commonSolarInfo').innerHTML = commonMsg;
  // ================= Step 1 =================
  // ドア隙間 (モデル高さは0.1m均一・開口率のみ表の値を使用)
  const gapKey = document.getElementById('doorType').value+'_'+document.getElementById('doorUC').value;
  const gap = doorGapTable[gapKey];
  document.getElementById('doorGapWrap').innerHTML =
    '<p class="small" style="margin:4px 0 8px;">モデル高さ: 上辺・アンダーカットとも <b>0.1 m</b> (100mm、解析メッシュに合わせて統一)</p>' +
    cfdRow('上辺パネル: 開口率 [%]', gap.topR) +
    cfdRow('アンダーカットパネル: 開口率 [%]', gap.ucR);
  tr('1-2','ドア隙間 (上辺)','モデル高さ [m] / 開口率 [%]', '0.1 / '+gap.topR, gap.topR);
  tr('1-2','ドア隙間 (UC)','モデル高さ [m] / 開口率 [%]', '0.1 / '+gap.ucR, gap.ucR);
  tr('1-1','ドア本体 (形状モデル)','厚み [m] (材質: 杉)', 0.03);
  tr('1-3','内壁・天井・床 (形状モデル)','厚み [m] (材質: 杉)', 0.03);

  // SAT 日変化 (参考グラフ)
  const hours=[]; for(let h=0; h<=24; h+=0.5) hours.push(h);
  const series={}; orientations.forEach(o=>series[o.name]=[]);
  const roofSeries=[];
  if(geo.ok){
    hours.forEach(hour=>{
      const s = solarPos(y,mo,d,hour,lat,lon);
      let hIdn=0, hIsky=0;
      if(s.alt>0){ hIdn=1098*Math.exp(-0.057/Math.sin(s.alt)); hIsky=0.125*hIdn; }
      const ta = taReady ? taAt(hour, tmax, tmin, tpeak) : 0;
      orientations.forEach(o=>{
        let iw=0;
        if(s.alt>0){
          const cosInc = Math.cos(s.alt)*Math.cos(s.az-o.az*Math.PI/180);
          const ib = hIdn*Math.max(cosInc,0);
          const idf = hIsky*0.5;
          const ir = (hIdn*s.sinAlt+hIsky)*rho*0.5;
          iw = ib+idf+ir;
        }
        series[o.name].push(ta + alpha*iw/ho);
      });
      let iRoof=0;
      if(s.alt>0) iRoof = hIdn*Math.max(s.sinAlt,0) + hIsky;
      roofSeries.push(ta + alpha*iRoof/ho - roofCorr);
    });
  }else{
    hours.forEach(()=>{
      orientations.forEach(o=> series[o.name].push(null));
      roofSeries.push(null);
    });
  }
  const labels = hours.map(h=>h+':00');
  const datasets = orientations.map(o=>({
    label:o.name, data:series[o.name], borderColor:o.color, backgroundColor:o.color,
    borderWidth:2, pointRadius:0, tension:0.3, spanGaps:false
  }));
  datasets.push({label:'屋根(水平)', data:roofSeries, borderColor:'#3D3D3D', backgroundColor:'#3D3D3D',
    borderWidth:2, borderDash:[5,3], pointRadius:0, tension:0.3, spanGaps:false});
  if(satChart) satChart.destroy();
  satChart = new Chart(document.getElementById('satChart'), {
    type:'line', data:{labels, datasets},
    options:{responsive:true, maintainAspectRatio:false, animation:false,
      scales:{ x:{ticks:{maxTicksLimit:13}}, y:{title:{display:true,text:'SAT (℃) ※参考'}} }}
  });

  // SAT 指定時刻
  if(!geo.ok){
    document.getElementById('satSolarInfo').innerHTML =
      '<div class="warn" style="grid-column:1/-1;">'+geo.reason+' 緯度・経度を入れるとSATグラフが正しくなります。</div>';
  }else{
    document.getElementById('satSolarInfo').innerHTML =
      '<div class="stat"><div class="lbl">太陽高度角</div><div class="val">'+altDeg.toFixed(1)+'°</div></div>'+
      '<div class="stat"><div class="lbl">太陽方位角 (南=0)</div><div class="val">'+azDeg.toFixed(1)+'°</div></div>'+
      '<div class="stat"><div class="lbl">I_DN (直達)</div><div class="val">'+idn.toFixed(0)+' W/m²</div></div>'+
      '<div class="stat"><div class="lbl">Isky (天空)</div><div class="val">'+isky.toFixed(0)+' W/m²</div></div>'+
      '<div class="stat"><div class="lbl">外気温 Ta</div><div class="val">'+(taReady?taNow.toFixed(1)+' ℃':'—')+'</div></div>';
  }

  const uWall = numOrNull('uWall'), uRoof = numOrNull('uRoof');
  const satByOri = {};
  let table = '<table><tr><th>方位</th><th>全天日射 Iw (W/m²)</th><th>SAT (℃) → 発生パネル「外気温」</th><th>熱通過率 (W/m²K)</th><th></th></tr>';
  orientations.forEach(o=>{
    let iw=0, sat=taNow;
    if(geo.ok && sp.alt>0){
      const cosInc = Math.cos(sp.alt)*Math.cos(sp.az-o.az*Math.PI/180);
      const ib = idn*Math.max(cosInc,0);
      const idf = isky*0.5;
      const ir = (idn*sp.sinAlt+isky)*rho*0.5;
      iw = ib+idf+ir;
      sat = taNow + alpha*iw/ho;
    }else if(!geo.ok){
      iw = 0; sat = NaN;
    }
    satByOri[o.name]=sat;
    const satTxt = isFinite(sat) ? sat.toFixed(2) : '—';
    table += '<tr><td>外壁 '+o.name+'</td><td>'+(geo.ok?iw.toFixed(1):'—')+'</td><td><b>'+satTxt+'</b></td><td>'+fmtU(uWall)+'</td>'+
      '<td>'+(isFinite(sat)?'<button class="copy-btn" data-copy="'+sat.toFixed(2)+'">SATコピー</button>':'')+'</td></tr>';
  });
  let iRoof=0, roofSat=taNow-roofCorr;
  if(geo.ok && sp.alt>0){ iRoof = idn*Math.max(sp.sinAlt,0)+isky; roofSat = taNow + alpha*iRoof/ho - roofCorr; }
  else if(!geo.ok){ roofSat = NaN; }
  table += '<tr style="font-weight:600; background:#F4F4F4;"><td>屋根 (水平)</td><td>'+(geo.ok?iRoof.toFixed(1):'—')+'</td><td><b>'+(isFinite(roofSat)?roofSat.toFixed(2):'—')+'</b></td><td>'+fmtU(uRoof)+'</td>'+
    '<td>'+(isFinite(roofSat)?'<button class="copy-btn" data-copy="'+roofSat.toFixed(2)+'">SATコピー</button>':'')+'</td></tr>';
  table += '</table>';
  document.getElementById('satTableWrap').innerHTML = table;
  if(typeof renderEpWallHeat==='function'){
    const wallWrap = document.getElementById('uWall') && document.getElementById('uWall').closest('div');
    if(appMode==='energyplus' && wallWrap && wallWrap.classList.contains('ep-filled')){
      applyEpWallUFromParse();
      if(typeof applyEpUaAndEnvelope==='function') applyEpUaAndEnvelope();
    }
    renderEpWallHeat(satByOri, roofSat, taNow);
  }
  if(geo.ok){
    ['北','東','南','西'].forEach(nm=>{
      tr('1-4','外壁 '+nm+' (発生パネル)','外気温 [℃] = SAT', satByOri[nm].toFixed(2));
      tr('1-4','外壁 '+nm+' (発生パネル)','熱通過率 [W/m²K]', fmtU(uWall));
    });
    tr('1-4','屋根 (発生パネル)','外気温 [℃] = SAT', roofSat.toFixed(2));
    tr('1-4','屋根 (発生パネル)','熱通過率 [W/m²K]', fmtU(uRoof));
  }

  // 1F床
  const uFloor1 = numOrNull('uFloor1');
  document.getElementById('uFloor1Disp').textContent = fmtU(uFloor1);
  document.getElementById('uFloor1Copy').dataset.copy = uFloor1==null ? '' : uFloor1;
  tr('1-5','1F床 (形状モデル)','熱通過率 [W/m²K]', fmtU(uFloor1));

  // 基礎外周
  const uFound = numOrNull('uFound');
  document.getElementById('foundWrap').innerHTML =
    cfdRow('発生パネル > 外気温 [℃] (SATではなく外気温そのまま)', taReady?taNow.toFixed(2):'—') +
    cfdRow('熱貫流率 (熱通過率) [W/m²K]', fmtU(uFound));
  if(taReady) tr('1-6','基礎外周 (発生パネル)','外気温 [℃]', taNow.toFixed(2));
  tr('1-6','基礎外周 (発生パネル)','熱通過率 [W/m²K]', fmtU(uFound));

  // 窓 疑似厚み
  const uWin=numOrNull('uWin'), hiWin=num('hiWin'), hoWin=num('hoWin'), lamWin=num('lamWin');
  const rBody = (uWin && uWin>0) ? (1/uWin - 1/hoWin - 1/hiWin) : NaN;
  const dWin = rBody*lamWin;
  if(uWin===null){
    const hasLocal = (typeof collectRoomWindowUs==='function') && collectRoomWindowUs().length>0;
    document.getElementById('winWarn').innerHTML = hasLocal ? '' : '<div class="warn">窓U値が未入力です。</div>';
    document.getElementById('winWrap').innerHTML = '';
  }else if(!(rBody>0)){
    document.getElementById('winWarn').innerHTML = '<div class="warn">U値が大きすぎて躯体熱抵抗が0以下になりました。U値・表面熱伝達率を確認してください。</div>';
    document.getElementById('winWrap').innerHTML = '';
  }else{
    document.getElementById('winWarn').innerHTML = '';
    document.getElementById('winWrap').innerHTML =
      cfdRowNoCopy('種類', '外気温と固体表面までの熱伝達率') +
      cfdRow('外気温 [℃]', taNow.toFixed(2)) +
      cfdRow('内表面熱伝達率 [W/m²K]', hiWin) +
      cfdRow('外表面熱伝達率 [W/m²K]', hoWin) +
      cfdRowNoCopy('厚みを考慮 (パネル実体は厚み0のまま)', 'はい') +
      cfdRowNoCopy('材質', 'ガラス板 (Low-E複層)') +
      cfdRow('躯体のみの熱抵抗 [㎡K/W] (参考)', rBody.toFixed(4)) +
      cfdRow('疑似厚み [m] (仮想の厚み・逆算値)', dWin.toFixed(4)) +
      cfdRow('初期温度 [℃]', initT);
    tr('1-7','窓 (発生パネル)','外気温 [℃]', taNow.toFixed(2));
    tr('1-7','窓 (発生パネル)','内表面熱伝達率 [W/m²K]', hiWin);
    tr('1-7','窓 (発生パネル)','外表面熱伝達率 [W/m²K]', hoWin);
    tr('1-7','窓 (発生パネル)','疑似厚み [m]', dWin.toFixed(4));
  }

  document.querySelectorAll('.win-row').forEach(function(w){
    const dummyEl = w.querySelector('.wDummy');
    if(!dummyEl) return;
    const uEl = w.querySelector('.wU');
    const uLocal = uEl && String(uEl.value).trim()!=='' ? parseFloat(uEl.value) : NaN;
    const uUse = (uLocal>0) ? uLocal : uWin;
    const dLocal = (typeof winDummyThickness==='function') ? winDummyThickness(uUse, hiWin, hoWin, lamWin) : null;
    dummyEl.textContent = (dLocal==null) ? '—' : (dLocal.toFixed(4)+' m');
  });
  const perUWrap = document.getElementById('winPerUWrap');
  if(perUWrap){
    const us = (typeof collectRoomWindowUs==='function') ? collectRoomWindowUs() : [];
    if(us.length>1){
      let html = '<table><tr><th>窓U W/m²K</th><th>疑似厚み m</th><th>3DS色</th></tr>';
      const groups = windowUColorGroupsFromUs(us);
      groups.forEach(function(g){
        const d = winDummyThickness(g.u, hiWin, hoWin, lamWin);
        const rgb = 'rgb('+g.color.r+','+g.color.g+','+g.color.b+')';
        html += '<tr><td>'+g.u+'</td><td>'+(d==null?'—':d.toFixed(4))+'</td>'+
          '<td class="l"><span style="display:inline-block;width:28px;height:12px;border:1px solid #C9C9C9;background:'+rgb+';vertical-align:middle;margin-right:6px;"></span>'+
          g.color.r+' '+g.color.g+' '+g.color.b+'</td></tr>';
        if(d!=null) tr('1-7','窓 U='+g.u+' (発生パネル)','疑似厚み [m]', d.toFixed(4));
      });
      html += '</table><p class="small" style="margin:6px 0 0;">共通欄のUは面積加重です。3DSは上の色でUを分け、SSLは同じ色の窓オブジェクトへその疑似厚みを書きます。日射は各窓のη0です。</p>';
      perUWrap.innerHTML = html;
    }else{
      perUWrap.innerHTML = '';
    }
  }

  // ================= Step 2: 内部発熱 (Step 3のエアコン計算より先に集計) =================
  document.getElementById('step2SolarInfo').innerHTML =
    '<div class="stat"><div class="lbl">直達日射 I_DN (自動)</div><div class="val">'+idn.toFixed(0)+' W/m²</div></div>'+
    '<div class="stat"><div class="lbl">太陽高度角</div><div class="val">'+altDeg.toFixed(1)+'°</div></div>'+
    '<div class="stat"><div class="lbl">太陽方位角 (南=0)</div><div class="val">'+azDeg.toFixed(1)+'°</div></div>';

  const results=[];
  document.querySelectorAll('.room-card').forEach(card=>{
    const name = card.querySelector('.roomName').value;
    let solarW = 0;
    card.querySelectorAll('.win-row').forEach(w=>{
      const wAzDeg = parseFloat(w.querySelector('.wAz').value);
      const wAz = wAzDeg*Math.PI/180;
      const wTilt = Math.PI/2; // 一般的な壁面窓として垂直固定
      const eta = parseFloat(w.querySelector('.wEta').value)||0;
      const area = parseFloat(w.querySelector('.wArea').value)||0;
      let q = 0;
      const northFacing=Math.abs(Math.abs(wAzDeg)-180)<0.5;
      if(sp.alt>0 && !northFacing){
        const cosInc = Math.cos(sp.alt)*Math.sin(wTilt)*Math.cos(sp.az-wAz) + Math.sin(sp.alt)*Math.cos(wTilt);
        const ib = idn*Math.max(cosInc,0);
        q = ib*eta*area;
      }
      solarW += q;
    });
    const occ = parseFloat(card.querySelector('.occCount').value)||0;
    const peopleSens = (parseFloat(card.querySelector('.peopleSensRate').value)||0)*occ;
    const peopleMoist = (parseFloat(card.querySelector('.peopleMoistRate').value)||0)*occ;
    const roomArea = parseFloat(card.querySelector('.roomArea').value)||0;
    const equipSens = (parseFloat(card.querySelector('.equipSensRate').value)||0)*roomArea;
    const equipMoist = (parseFloat(card.querySelector('.equipMoistRate').value)||0)*roomArea;
    const extraSens = parseFloat(card.querySelector('.extraSens').value)||0;
    const extraMoist = parseFloat(card.querySelector('.extraMoist').value)||0;
    const totalSens = solarW + peopleSens + equipSens + extraSens;
    const totalMoist = peopleMoist + equipMoist + extraMoist;

    card.querySelector('.peopleSensResult').textContent = peopleSens.toFixed(1)+' W';
    card.querySelector('.occCountEcho').textContent = occ+' 人';
    card.querySelector('.peopleMoistResult').textContent = peopleMoist.toFixed(1)+' g/h';
    card.querySelector('.equipSensResult').textContent = equipSens.toFixed(1)+' W';
    card.querySelector('.areaEcho').textContent = roomArea.toFixed(1)+' ㎡';
    card.querySelector('.equipMoistResult').textContent = equipMoist.toFixed(1)+' g/h';
    document.getElementById(card.id+'_summary').innerHTML =
      '<div class="stat"><div class="lbl">直達日射</div><div class="val">'+solarW.toFixed(0)+' W</div></div>'+
      '<div class="stat"><div class="lbl">人体顕熱</div><div class="val">'+peopleSens.toFixed(0)+' W</div></div>'+
      '<div class="stat"><div class="lbl">機器顕熱</div><div class="val">'+equipSens.toFixed(0)+' W</div></div>'+
      '<div class="stat"><div class="lbl">追加</div><div class="val">'+extraSens.toFixed(0)+' W</div></div>'+
      '<div class="stat hl"><div class="lbl">合計顕熱</div><div class="val">'+totalSens.toFixed(0)+' W</div></div>'+
      '<div class="stat hl"><div class="lbl">合計発湿</div><div class="val">'+totalMoist.toFixed(0)+' g/h</div></div>';
    document.getElementById(card.id+'_cfd').innerHTML =
      cfdRow('発生エリア > 発熱量 [W]', totalSens.toFixed(1)) +
      cfdRow('発湿量 [g/h]', totalMoist.toFixed(1)) +
      cfdRow('初期温度 [℃] (外気温と同じ)', taNow.toFixed(2)) +
      cfdRow('初期湿度 [%]', initRH);
    results.push({name, solarW, peopleSens, equipSens, extraSens, totalSens, totalMoist});
  });

  const grand = results.reduce((a,r)=>{
    a.solarW+=r.solarW; a.peopleSens+=r.peopleSens; a.equipSens+=r.equipSens;
    a.extraSens+=r.extraSens; a.totalSens+=r.totalSens; a.totalMoist+=r.totalMoist;
    return a;
  }, {solarW:0, peopleSens:0, equipSens:0, extraSens:0, totalSens:0, totalMoist:0});

  document.getElementById('grandTotalWrap').innerHTML =
    '<div class="summary-grid">'+
      '<div class="stat"><div class="lbl">直達日射 合計</div><div class="val">'+grand.solarW.toFixed(0)+' W</div></div>'+
      '<div class="stat"><div class="lbl">人体顕熱 合計</div><div class="val">'+grand.peopleSens.toFixed(0)+' W</div></div>'+
      '<div class="stat"><div class="lbl">機器顕熱 合計</div><div class="val">'+grand.equipSens.toFixed(0)+' W</div></div>'+
      '<div class="stat hl"><div class="lbl">全室 合計顕熱</div><div class="val">'+grand.totalSens.toFixed(0)+' W</div></div>'+
      '<div class="stat hl"><div class="lbl">全室 合計発湿</div><div class="val">'+grand.totalMoist.toFixed(0)+' g/h</div></div>'+
    '</div>';

  let rt = '<table><tr><th>室名</th><th>直達日射(W)</th><th>人体顕熱(W)</th><th>機器顕熱(W)</th><th>追加(W)</th><th>合計顕熱(W)</th><th>合計発湿(g/h)</th></tr>';
  results.forEach(r=>{
    rt += '<tr><td>'+r.name+'</td><td>'+r.solarW.toFixed(1)+'</td><td>'+r.peopleSens.toFixed(1)+'</td><td>'+r.equipSens.toFixed(1)+'</td><td>'+r.extraSens.toFixed(1)+'</td><td>'+r.totalSens.toFixed(1)+'</td><td>'+r.totalMoist.toFixed(1)+'</td></tr>';
  });
  rt += '<tr style="font-weight:600; background:#F4F4F4;"><td>全室合計</td><td>'+grand.solarW.toFixed(1)+'</td><td>'+grand.peopleSens.toFixed(1)+'</td><td>'+grand.equipSens.toFixed(1)+'</td><td>'+grand.extraSens.toFixed(1)+'</td><td>'+grand.totalSens.toFixed(1)+'</td><td>'+grand.totalMoist.toFixed(1)+'</td></tr></table>';
  document.getElementById('roomTableWrap').innerHTML = rt;

  if(roomChart) roomChart.destroy();
  roomChart = new Chart(document.getElementById('roomChart'), {
    type:'bar',
    data:{
      labels: results.map(r=>r.name),
      datasets:[
        {label:'直達日射', data:results.map(r=>r.solarW), backgroundColor:'#F2A45C'},
        {label:'人体顕熱', data:results.map(r=>r.peopleSens), backgroundColor:'#4FC4E4'},
        {label:'機器顕熱', data:results.map(r=>r.equipSens), backgroundColor:'#ED6A47'},
        {label:'追加', data:results.map(r=>r.extraSens), backgroundColor:'#9AA0A6'}
      ]
    },
    options:{responsive:true, maintainAspectRatio:false, animation:false,
      scales:{ x:{stacked:true}, y:{stacked:true, title:{display:true,text:'顕熱 (W)'}} }}
  });
  results.forEach(r=>{
    tr('2','発生エリア: '+r.name,'発熱量 [W]', r.totalSens.toFixed(1));
    tr('2','発生エリア: '+r.name,'発湿量 [g/h]', r.totalMoist.toFixed(1));
  });

  // ================= Step 3: エアコン =================
  document.getElementById('outTaDisp').value = taNow.toFixed(1);
  document.getElementById('roomTDisp').value = targetT;
  const cat = acCatalog[+document.getElementById('tatamiSel').value];
  document.getElementById('acRatedInfo').textContent = '参考: '+cat.tatami+'畳クラス 定格 '+cat.rated+' kW / 最大 '+cat.max+' kW';
  const dir = document.getElementById('dirSel').value;
  const vol = document.getElementById('volSel').value;
  document.getElementById('flowInfo').textContent = 'Z-Tシリーズ '+dir+'・'+vol+'風のフリーブロー値: '+flowTable[dir][vol]+' ㎥/h'+(dir==='30°' ? ' (実測値1点のみ・ノッチ共通)' : '');

  const acMax=num('acMax'), acCount=Math.max(1, Math.round(num('acCount')));
  const flowPer=num('flowPerUnit');
  const ua=num('uaVal'), envA=num('envArea');
  const dT = taNow - targetT;
  const qEnv = ua*envA*dT;
  const ventMode = document.getElementById('ventMode').value;
  let qVent = 0;
  if(ventMode!=='none'){
    qVent = RHOCP*num('ach')*num('roomVol')*dT;
    if(ventMode==='first') qVent *= (1 - num('hxRate')/100);
  }
  const qInt = grand.totalSens;
  const qReq = qEnv + qVent + qInt;
  document.getElementById('loadStats').innerHTML =
    '<div class="stat"><div class="lbl">外皮負荷</div><div class="val">'+qEnv.toFixed(0)+' W</div></div>'+
    '<div class="stat"><div class="lbl">換気負荷'+(ventMode==='none'?' (除外中)':'')+'</div><div class="val">'+qVent.toFixed(0)+' W</div></div>'+
    '<div class="stat"><div class="lbl">内部発熱+日射 (Step 2合計)</div><div class="val">'+qInt.toFixed(0)+' W</div></div>'+
    '<div class="stat hl"><div class="lbl">必要冷房処理熱量</div><div class="val">'+qReq.toFixed(0)+' W</div></div>';

  const vTotal = flowPer*acCount;
  const qPerUnit = qReq/acCount;
  let ts = targetT, dts = 0;
  if(vTotal>0){ dts = qReq/(RHOCP*vTotal); ts = targetT - dts; }
  document.getElementById('supplyStats').innerHTML =
    '<div class="stat"><div class="lbl">総風量 ('+acCount+'台)</div><div class="val">'+vTotal.toFixed(0)+' ㎥/h</div></div>'+
    '<div class="stat"><div class="lbl">1台あたり処理熱量</div><div class="val">'+qPerUnit.toFixed(0)+' W</div></div>'+
    '<div class="stat"><div class="lbl">必要温度差 ΔT</div><div class="val">'+dts.toFixed(2)+' K</div></div>'+
    '<div class="stat hl"><div class="lbl">吹出温度 (CFD入力・全台共通)</div><div class="val">'+ts.toFixed(2)+' ℃ <button class="copy-btn" data-copy="'+ts.toFixed(2)+'">コピー</button></div></div>'+
    '<div class="stat hl"><div class="lbl">吹出湿度 (CFD入力・業界慣行で95%RH固定)</div><div class="val">95 %RH <button class="copy-btn" data-copy="95">コピー</button></div></div>'+
    '<div class="stat"><div class="lbl">吸込温度 (=目標室温)</div><div class="val">'+targetT.toFixed(1)+' ℃</div></div>';

  let warns='';
  const capW = acMax*1000*acCount;
  if(qReq > capW){
    warns += '<div class="warn">能力不足: 必要処理熱量 '+qReq.toFixed(0)+' W が最大冷房能力 '+capW.toFixed(0)+' W ('+acMax+' kW × '+acCount+'台) を超えています。畳数クラスを上げるか台数を増やしてください。</div>';
  }else{
    warns += '<div class="small ok">能力チェックOK: 負荷率 '+(qReq/capW*100).toFixed(0)+'% (必要 '+qReq.toFixed(0)+' W / 最大 '+capW.toFixed(0)+' W)</div>';
  }
  if(ts < 5) warns += '<div class="warn">吹出温度が '+ts.toFixed(1)+' ℃と極端に低くなっています。実機では出せない温度です。風量を増やす・台数を増やす・負荷を見直すなどしてください。</div>';
  else if(ts < 10) warns += '<div class="warn">吹出温度が10℃を下回っています。実機の下限に近いため、風量アップや台数追加も検討してください。</div>';
  document.getElementById('acWarn').innerHTML = warns;
  renderAcCompare(qReq, flowPer, acMax, targetT, acCount);
  tr('3','エアコン (吹出・1台あたり)','風量 [㎥/h]', flowPer);
  tr('3','エアコン (吹出)','吹出温度 [℃]', ts.toFixed(2));
  tr('3','エアコン (吹出)','吹出湿度 [%RH] (業界慣行で95%RH固定)', '95');
  tr('3','エアコン (吸込)','吸込温度 [℃] (=目標室温)', targetT.toFixed(1));

  // ================= Step 4 =================
  document.getElementById('initTEcho').textContent = initT;
  document.getElementById('initRHEcho').textContent = initRH;
  const met = document.getElementById('metSel').value;
  const clo = document.getElementById('cloSel').value;
  const comfHum = num('comfHum');
  document.getElementById('comfWrap').innerHTML =
    cfdRow('快適性指標 > 湿度 [%]', comfHum) +
    cfdRow('運動量 (代謝量) met', met) +
    cfdRow('着衣量 clo', clo);
  tr('4','解析対象と初期値','初期温度 [℃] / 相対湿度 [%]', initT+' / '+initRH, initT);
  tr('4','特殊コマンド','コマンド (2行)', 'SATULIM ↵ /', 'SATULIM\n/');
  tr('4','快適性指標','湿度 [%]', comfHum);
  tr('4','快適性指標','代謝量 met', met);
  tr('4','快適性指標','着衣量 clo', clo);

  // ================= 転記一覧 =================
  let tt = '<table><tr><th style="width:50px;">手順</th><th>転記先</th><th>項目</th><th style="width:130px;">値</th><th style="width:70px;"></th></tr>';
  transferRows.forEach(r=>{
    tt += '<tr><td>'+r.step+'</td><td class="l">'+r.target+'</td><td class="l">'+r.item+'</td><td><b>'+r.value+'</b></td>'+
      '<td style="text-align:center;"><button class="copy-btn" data-copy="'+String(r.copy).replace(/"/g,'&quot;').replace(/\n/g,'&#10;')+'">コピー</button></td></tr>';
  });
  tt += '</table>';
  document.getElementById('transferWrap').innerHTML = tt;

  // ---- 進捗表示 ----
  for(let i=1;i<=5;i++){
    const done = document.getElementById('done'+i).checked;
    const el = document.getElementById('st'+i);
    el.textContent = done ? '済' : '未';
    el.className = 'st'+(done?' done':'');
  }

  saveStateDebounced();
}


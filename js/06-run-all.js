// ========================= メイン再計算 =========================
let satChart=null, roomChart=null;
let transferRows=[];
function tr(step, target, item, value, copyVal){
  transferRows.push({step, target, item, value, copy:(copyVal!==undefined?copyVal:value)});
}

function runAll(){
  transferRows = [];
  if(typeof atPartSyncAcCount==='function') atPartSyncAcCount(false);
  if(typeof atPartSyncAcFlow==='function') atPartSyncAcFlow();
  if(typeof applySharedToolDefaults==='function') applySharedToolDefaults({fillEmpty:false});
  if(typeof appMode!=='undefined' && appMode==='energyplus' && typeof applyEpWindowsToRooms==='function'){
    try{
      applyEpWindowsToRooms();
      if(typeof applyEpWindowUToRooms==='function') applyEpWindowUToRooms();
    }catch(err){
      console.error('EnergyPlus窓の反映に失敗', err);
    }
  }
  const {y,mo,d} = getDateParts();
  const detailHour = hasInput('detailHour') ? parseFloat(document.getElementById('detailHour').value) : TOOL_DEFAULTS.detailHour;
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
  const epSat = (typeof computeEpSatBundle==='function')
    ? computeEpSatBundle({month:mo, day:d, hour:detailHour, alpha:alpha, ho:ho, roofCorr:roofCorr, targetT:targetT,
        sunAlt:sp.alt, sunAz:sp.az, idn:idn, isky:isky, rho:rho, tmax:tmax, tmin:tmin, tpeak:tpeak})
    : null;
  const useEpSat = !!(epSat && epSat.ok);
  const oatNow = useEpSat && isFinite(epSat.oatAt) ? epSat.oatAt : taNow;
  let commonMsg = '';
  if(!geo.ok && !useEpSat){
    commonMsg = '<span style="color:#DE5A3A; font-weight:600;">※'+geo.reason+' SAT・日射は計算しません。</span>';
  }else if(!taReady && !useEpSat){
    commonMsg = '解析時刻の状態: 太陽高度 '+altDeg.toFixed(1)+'° / 方位角(南=0) '+azDeg.toFixed(1)+'° / 直達日射 I_DN '+idn.toFixed(0)+' W/m²'+
      ' <span style="color:#DE5A3A; font-weight:600;">※最高/最低気温・ピーク時刻が未入力のため外気温=0として仮表示しています。</span>';
  }else{
    commonMsg =
      '解析時刻の状態: 太陽高度 '+altDeg.toFixed(1)+'° / 方位角(南=0) '+azDeg.toFixed(1)+'° / 外気温 '+oatNow.toFixed(1)+'℃ / 直達日射 I_DN '+idn.toFixed(0)+' W/m²'+
      (useEpSat ? ' / SATは SQL の入射日射 + ISO13786 ETD' : '')+
      (sp.alt<=0 ? ' <span style="color:#DE5A3A; font-weight:600;">※太陽高度が0以下です。晴天モデルの日射はゼロです。</span>':'');
  }
  if(epSat && !epSat.ok && epSat.reason){
    commonMsg += ' <span style="color:#8C8C8C;">('+epSat.reason+')</span>';
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
  if(useEpSat){
    function epDayAt(arr, hour){
      if(!arr) return null;
      const h0=Math.floor(hour), h1=Math.ceil(hour);
      const a=arr[h0], b=arr[h1===h0?h0:h1];
      if(a==null && b==null) return null;
      if(hour===h0 || b==null) return a;
      if(a==null) return b;
      return a+(b-a)*(hour-h0);
    }
    hours.forEach(function(hour,i){
      orientations.forEach(function(o){
        const v=epDayAt(epSat.daySeries && epSat.daySeries[o.name], hour);
        if(v!=null) series[o.name][i]=v;
      });
      const rv=epDayAt(epSat.dayRoof, hour);
      if(rv!=null) roofSeries[i]=rv;
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
      scales:{ x:{ticks:{maxTicksLimit:13}}, y:{title:{display:true,text: useEpSat ? 'SAT (℃) SQL入射日射' : 'SAT (℃) ※参考'}} }}
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
      '<div class="stat"><div class="lbl">外気温 Ta</div><div class="val">'+(useEpSat && isFinite(epSat.oatAt)?epSat.oatAt.toFixed(1)+' ℃':(taReady?taNow.toFixed(1)+' ℃':'—'))+'</div></div>'+
      (useEpSat ? '<div class="stat"><div class="lbl">SAT手法</div><div class="val">ETD補正 '+epSat.nSurfaces+'面</div></div>' : '');
  }

  const uWall = numOrNull('uWall'), uRoof = numOrNull('uRoof');
  const assignedUText=(target,u)=>u===null&&typeof appMode!=='undefined'&&appMode==='architrend'&&window.boundaryThermalSummary?.(target)?.ready?'面ごとの設定を使用':fmtU(u);
  const satByOri = {};
  const shadeByOri = {};
  const shadeGroups = (useEpSat && epSat.shadeGroups) ? epSat.shadeGroups : [];
  shadeGroups.forEach(function(g){
    if(!shadeByOri[g.orient]) shadeByOri[g.orient]=[];
    shadeByOri[g.orient].push(g);
  });
  if(typeof assignEpShadeColors==='function') assignEpShadeColors(shadeGroups);
  if(typeof applyEpShadeToMesh==='function') applyEpShadeToMesh(shadeGroups);
  let shadeSplit = 0;
  let table = '<table><tr><th>方位</th><th>全天日射 Iw (W/m²)</th><th>SAT (℃)</th>'+(useEpSat?'<th>ETD (K)</th><th>φ (h) / η</th>':'')+'<th>CFD 外気温 (℃)</th><th>熱通過率 (W/m²K)</th><th></th></tr>';
  function shadeSwatch(g){
    const c = (g && g.color) || (typeof IDF_MESH_PALETTE!=='undefined' && IDF_MESH_PALETTE[g.sslKey]);
    if(!c) return '';
    return '<span style="display:inline-block;width:14px;height:10px;border:1px solid #C9C9C9;background:rgb('+c.r+','+c.g+','+c.b+');vertical-align:middle;margin-right:4px;"></span>';
  }
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
    let tCfd=sat, etd=null, iso=null, isol=null;
    if(useEpSat){
      if(epSat.satRawByOri && isFinite(epSat.satRawByOri[o.name])) sat=epSat.satRawByOri[o.name];
      if(epSat.isolByOri && isFinite(epSat.isolByOri[o.name])) { isol=epSat.isolByOri[o.name]; iw=isol; }
      if(epSat.etdByOri && isFinite(epSat.etdByOri[o.name])) etd=epSat.etdByOri[o.name];
      iso=epSat.isoByOri && epSat.isoByOri[o.name];
      if(isFinite(epSat.satByOri[o.name])) tCfd=epSat.satByOri[o.name];
    }
    const gs = shadeByOri[o.name];
    if(useEpSat && gs && gs.length>1){
      gs.slice().sort(function(a,b){ return a.index-b.index; }).forEach(function(g){
        shadeSplit++;
        const label = g.index<=1 ? ('外壁 '+o.name) : ('外壁 '+o.name+'#'+g.index);
        const gSat = isFinite(g.satRaw) ? g.satRaw : sat;
        const gIw = isFinite(g.isol) ? g.isol : iw;
        const gEtd = isFinite(g.etd) ? g.etd : null;
        const gU = (g.u>0) ? Math.round(g.u*1000)/1000 : uWall;
        const gT = g.tCfd;
        if(g.index<=1 && isFinite(gT)) satByOri[o.name]=gT;
        table += '<tr><td>'+shadeSwatch(g)+label+'</td><td>'+(isFinite(gIw)?gIw.toFixed(1):'—')+'</td><td>'+(isFinite(gSat)?gSat.toFixed(2):'—')+'</td>'+
          (useEpSat?('<td>'+(gEtd!=null && isFinite(gEtd)?gEtd.toFixed(2):'—')+'</td><td>'+(iso?iso.phi.toFixed(1)+' / '+iso.eta.toFixed(2):'—')+'</td>'):'')+
          '<td><b>'+(isFinite(gT)?gT.toFixed(2):'—')+'</b></td><td>'+fmtU(gU)+'</td>'+
          '<td>'+(isFinite(gT)?'<button class="copy-btn" data-copy="'+gT.toFixed(2)+'">SATコピー</button>':'')+'</td></tr>';
      });
      return;
    }
    if(useEpSat && gs && gs.length===1 && isFinite(gs[0].tCfd)) tCfd=gs[0].tCfd;
    satByOri[o.name]=tCfd;
    const satTxt = isFinite(sat) ? sat.toFixed(2) : '—';
    const tTxt = isFinite(tCfd) ? tCfd.toFixed(2) : '—';
    table += '<tr><td>外壁 '+o.name+'</td><td>'+(isFinite(iw)?iw.toFixed(1):'—')+'</td><td>'+satTxt+'</td>'+
      (useEpSat?('<td>'+(etd!=null && isFinite(etd)?etd.toFixed(2):'—')+'</td><td>'+(iso?iso.phi.toFixed(1)+' / '+iso.eta.toFixed(2):'—')+'</td>'):'')+
      '<td><b>'+tTxt+'</b></td><td>'+assignedUText('wall',uWall)+'</td>'+
      '<td>'+(isFinite(tCfd)?'<button class="copy-btn" data-copy="'+tCfd.toFixed(2)+'">SATコピー</button>':'')+'</td></tr>';
  });
  let iRoof=0, roofSat=taNow-roofCorr;
  if(geo.ok && sp.alt>0){ iRoof = idn*Math.max(sp.sinAlt,0)+isky; roofSat = taNow + alpha*iRoof/ho - roofCorr; }
  else if(!geo.ok){ roofSat = NaN; }
  let roofCfd=roofSat, roofEtd=null, roofIso=null;
  if(useEpSat){
    if(isFinite(epSat.roofSatRaw)) roofSat=epSat.roofSatRaw;
    if(isFinite(epSat.roofIsol)) iRoof=epSat.roofIsol;
    if(isFinite(epSat.roofEtd)) roofEtd=epSat.roofEtd;
    roofIso=epSat.roofIso;
    if(isFinite(epSat.roofSat)) roofCfd=epSat.roofSat;
  }
  table += '<tr style="font-weight:600; background:#F4F4F4;"><td>屋根 (水平)</td><td>'+(isFinite(iRoof)?iRoof.toFixed(1):'—')+'</td><td>'+(isFinite(roofSat)?roofSat.toFixed(2):'—')+'</td>'+
    (useEpSat?('<td>'+(roofEtd!=null && isFinite(roofEtd)?roofEtd.toFixed(2):'—')+'</td><td>'+(roofIso?roofIso.phi.toFixed(1)+' / '+roofIso.eta.toFixed(2):'—')+'</td>'):'')+
    '<td><b>'+(isFinite(roofCfd)?roofCfd.toFixed(2):'—')+'</b></td><td>'+assignedUText('roof',uRoof)+'</td>'+
    '<td>'+(isFinite(roofCfd)?'<button class="copy-btn" data-copy="'+roofCfd.toFixed(2)+'">SATコピー</button>':'')+'</td></tr>';
  table += '</table>';
  if(useEpSat){
    table += '<p class="small" style="margin:8px 0 0;">CFDの発生パネル「外気温」は <b>室温 + ETD</b> です (q = U × ETD)。SAT列は相当外気温度そのもの、φ は ISO 13786 の時間遅れ、η は減衰率です。</p>';
    if(shadeSplit){
      table += '<p class="small" style="margin:4px 0 0;">同じ方位でも CFD 外気温の差が 0.1℃を超える外壁は行を分け、3DS も別色にします。庇の下は解析時刻の日影で壁を分割し、日なたと日陰で色を変えます。分割した部分の面積加重平均は SQL のその面の値です。</p>';
    }
  }
  document.getElementById('satTableWrap').innerHTML = table;
  if(typeof renderEpWallHeat==='function'){
    const wallWrap = document.getElementById('uWall') && document.getElementById('uWall').closest('div');
    if(appMode==='energyplus' && wallWrap && wallWrap.classList.contains('ep-filled')){
      applyEpWallUFromParse();
      if(typeof applyEpUaAndEnvelope==='function') applyEpUaAndEnvelope();
    }
    renderEpWallHeat(satByOri, roofCfd, oatNow);
  }
  if(geo.ok || useEpSat){
    ['北','北東','東','南東','南','南西','西','北西'].forEach(nm=>{
      const gs = shadeByOri[nm];
      if(useEpSat && gs && gs.length){
        gs.forEach(function(g){
          if(!isFinite(g.tCfd)) return;
          const u = (g.u>0) ? Math.round(g.u*1000)/1000 : uWall;
          tr('1-4', g.target, '外気温 [℃] = SAT', g.tCfd.toFixed(2));
          tr('1-4', g.target, '熱通過率 [W/m²K]', fmtU(u));
        });
        return;
      }
      if(!isFinite(satByOri[nm])) return;
      tr('1-4','外壁 '+nm+' (発生パネル)','外気温 [℃] = SAT', satByOri[nm].toFixed(2));
      tr('1-4','外壁 '+nm+' (発生パネル)','熱通過率 [W/m²K]', fmtU(uWall));
    });
    if(isFinite(roofCfd)){
      tr('1-4','屋根 (発生パネル)','外気温 [℃] = SAT', roofCfd.toFixed(2));
      tr('1-4','屋根 (発生パネル)','熱通過率 [W/m²K]', fmtU(uRoof));
    }
    const uDoor = numOrNull('uDoor');
    ['北','北東','東','南東','南','南西','西','北西'].forEach(nm=>{
      if(!isFinite(satByOri[nm]) || uDoor==null) return;
      tr('1-4','外部扉 '+nm+' (発生パネル)','外気温 [℃] = SAT', satByOri[nm].toFixed(2));
      tr('1-4','外部扉 '+nm+' (発生パネル)','熱通過率 [W/m²K]', fmtU(uDoor));
    });
  }

  // 1F床は床下空気と室内のあいだなので形状モデルの熱通過率。
  // 2F持ち出し床は下面が外気なので、壁と同じ発生パネル。
  const uFloor1 = numOrNull('uFloor1');
  const floor1Wrap = document.getElementById('floor1Wrap');
  if(floor1Wrap){
    floor1Wrap.innerHTML =
      cfdRow('1F床 形状モデル > 熱通過率 [W/m²K]', fmtU(uFloor1)) +
      cfdRow('2F持ち出し 発生パネル > 外気温 [℃]', (useEpSat||taReady)?oatNow.toFixed(2):'—') +
      cfdRow('2F持ち出し 発生パネル > 熱通過率 [W/m²K]', fmtU(uFloor1));
  }
  tr('1-5','1F床 (形状モデル)','熱通過率 [W/m²K]', fmtU(uFloor1));
  if(useEpSat||taReady) tr('1-5','2F持ち出し床 (発生パネル)','外気温 [℃]', oatNow.toFixed(2));
  tr('1-5','2F持ち出し床 (発生パネル)','熱通過率 [W/m²K]', fmtU(uFloor1));

  // 基礎外周
  const uFound = numOrNull('uFound');
  document.getElementById('foundWrap').innerHTML =
    cfdRow('発生パネル > 外気温 [℃] (SATではなく外気温そのまま)', (useEpSat||taReady)?oatNow.toFixed(2):'—') +
    cfdRow('熱貫流率 (熱通過率) [W/m²K]', fmtU(uFound));
  if(useEpSat||taReady) tr('1-6','基礎外周 (発生パネル)','外気温 [℃]', oatNow.toFixed(2));
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
      cfdRow('外気温 [℃]', oatNow.toFixed(2)) +
      cfdRow('内表面熱伝達率 [W/m²K]', hiWin) +
      cfdRow('外表面熱伝達率 [W/m²K]', hoWin) +
      cfdRowNoCopy('厚みを考慮 (パネル実体は厚み0のまま)', 'はい') +
      cfdRowNoCopy('材質', (function(){
        const el=document.getElementById('sslMatGlass');
        if(el && String(el.value||'').trim()) return el.value.trim();
        return (typeof TOOL_DEFAULTS!=='undefined' && TOOL_DEFAULTS.sslMatGlass) ? TOOL_DEFAULTS.sslMatGlass : '1ガラス板(Low-E複層)';
      })()) +
      cfdRow('躯体のみの熱抵抗 [㎡K/W] (参考)', rBody.toFixed(4)) +
      cfdRow('疑似厚み [m] (仮想の厚み・逆算値)', dWin.toFixed(4)) +
      cfdRow('初期温度 [℃]', initT);
    tr('1-7','窓 (発生パネル)','外気温 [℃]', oatNow.toFixed(2));
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
    '<div class="stat"><div class="lbl">太陽方位角 (南=0)</div><div class="val">'+azDeg.toFixed(1)+'°</div></div>'+
    '<div class="stat"><div class="lbl">窓日射の扱い</div><div class="val">全量を顕熱に計上</div></div>';

  const results=[];
  const useEpWin = appMode==='energyplus' && typeof epTransmittedW==='function' && typeof epSqlWx!=='undefined' && epSqlWx && epSqlWx.nTransmitted>0;
  document.querySelectorAll('.room-card').forEach(card=>{
    const name = card.querySelector('.roomName').value;
    let solarW = 0;
    let winN = 0;
    card.querySelectorAll('.win-row').forEach(w=>{
      winN++;
      const wAzDeg = parseFloat(w.querySelector('.wAz').value);
      const wAz = wAzDeg*Math.PI/180;
      const eta = parseFloat(w.querySelector('.wEta').value)||0;
      const area = parseFloat(w.querySelector('.wArea').value)||0;
      const wName = (w.querySelector('.wName') && w.querySelector('.wName').value) || '';
      const epQ = useEpWin ? epTransmittedW(wName, mo, d, detailHour, area) : null;
      const idx=useEpWin?epWxIndex(epSqlWx,mo,d,detailHour):-1;
      const incident=idx>=0?epWxSeriesAt(epSqlWx.incident,wName,idx):null;
      const gain=windowSolarGain({alt:sp.alt,az:sp.az,windowAz:wAz,dni:idn,dhi:isky,rho,eta,area,transmitted:epQ,incident});
      solarW += gain.total;
      const hint = w.querySelector('.wSolarHint');
      if(hint){
        hint.textContent = epQ!=null
          ? 'EP透過 '+gain.transmitted.toFixed(0)+' W ＋ 吸収後の室内流入（ηによる概算）'+gain.absorbedInward.toFixed(0)+' W → '+gain.total.toFixed(0)+' W'+(incident==null?'／面日射がないため晴天日射で補完（遮蔽を再現しません）':'／EP面日射を使用')
          : '直達 '+gain.beam.toFixed(0)+' ＋ 散乱 '+gain.sky.toFixed(0)+' ＋ 地面反射 '+gain.ground.toFixed(0)+' W/m² × η '+eta.toFixed(2)+' × '+area.toFixed(2)+' m² → '+gain.total.toFixed(0)+' W（ガラス吸収後の室内流入を含む）';
      }    });
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
    const peopleLat = moistGPerHToLatentW(peopleMoist);
    const equipLat = moistGPerHToLatentW(equipMoist);
    const extraLat = moistGPerHToLatentW(extraMoist);
    const totalLat = peopleLat + equipLat + extraLat;

    card.querySelector('.peopleSensResult').textContent = peopleSens.toFixed(1)+' W';
    card.querySelector('.occCountEcho').textContent = occ+' 人';
    card.querySelector('.peopleMoistResult').textContent = peopleMoist.toFixed(1)+' g/h';
    card.querySelector('.equipSensResult').textContent = equipSens.toFixed(1)+' W';
    card.querySelector('.areaEcho').textContent = roomArea.toFixed(1)+' ㎡';
    card.querySelector('.equipMoistResult').textContent = equipMoist.toFixed(1)+' g/h';
    document.getElementById(card.id+'_summary').innerHTML =
      '<div class="stat"><div class="lbl">窓日射熱</div><div class="val">'+solarW.toFixed(0)+' W</div></div>'+
      '<div class="stat"><div class="lbl">人体顕熱</div><div class="val">'+peopleSens.toFixed(0)+' W</div></div>'+
      '<div class="stat"><div class="lbl">人体潜熱</div><div class="val">'+peopleLat.toFixed(0)+' W</div></div>'+
      '<div class="stat"><div class="lbl">機器顕熱</div><div class="val">'+equipSens.toFixed(0)+' W</div></div>'+
      '<div class="stat"><div class="lbl">追加</div><div class="val">'+extraSens.toFixed(0)+' W</div></div>'+
      '<div class="stat hl"><div class="lbl">合計顕熱</div><div class="val">'+totalSens.toFixed(0)+' W</div></div>'+
      '<div class="stat hl"><div class="lbl">合計潜熱</div><div class="val">'+totalLat.toFixed(0)+' W</div></div>'+
      '<div class="stat hl"><div class="lbl">合計発湿</div><div class="val">'+totalMoist.toFixed(0)+' g/h</div></div>';
    document.getElementById(card.id+'_cfd').innerHTML =
      cfdRow('発生エリア > 発熱量 [W]（顕熱）', totalSens.toFixed(1)) +
      cfdRow('発生エリア > 発湿量 [g/h]', totalMoist.toFixed(1)) +
      cfdRow('初期温度 [℃] (外気温と同じ)', oatNow.toFixed(2)) +
      cfdRow('初期湿度 [%]', initRH);
    results.push({roomId:card.id,name, solarW, peopleSens, peopleLat, equipSens, equipLat, extraSens, extraLat, totalSens, totalLat, totalMoist, winN});
  });

  const grand = results.reduce((a,r)=>{
    a.solarW+=r.solarW; a.peopleSens+=r.peopleSens; a.peopleLat+=r.peopleLat;
    a.equipSens+=r.equipSens; a.equipLat+=r.equipLat;
    a.extraSens+=r.extraSens; a.extraLat+=r.extraLat;
    a.totalSens+=r.totalSens; a.totalLat+=r.totalLat; a.totalMoist+=r.totalMoist;
    return a;
  }, {solarW:0, peopleSens:0, peopleLat:0, equipSens:0, equipLat:0, extraSens:0, extraLat:0, totalSens:0, totalLat:0, totalMoist:0});
  // Share the calculated values with the compact view; it does not calculate a second total.
  window.boundaryRoomGainResults={rooms:results,grand};

  const winRows = document.querySelectorAll('.win-row').length;
  const idfWins = (typeof appMode!=='undefined' && appMode==='energyplus' && typeof epParse!=='undefined' && epParse)
    ? (epParse.windowCount||(epParse.windows||[]).length||0) : 0;
  let solarWarn = '';
  if(results.length && grand.solarW===0){
    if(!geo.ok){
      solarWarn = '窓日射熱が0なのは、緯度・経度が無いからです。共通条件に敷地の座標を入れてください。';
    }else if(!(sp.alt>0)){
      solarWarn = '窓日射熱が0なのは、太陽高度が0以下（夜）だからです。共通条件の日付・時刻を見てください。いま '+detailHour+' 時 / 高度 '+altDeg.toFixed(1)+'° / I_DN '+idn.toFixed(0)+' W/m²。';
    }else if(!winRows){
      solarWarn = '窓日射熱が0なのは、部屋カードに窓行が無いからです。'
        +(idfWins ? 'IDFには窓が '+idfWins+' 枚あります。IDFファイルを選び直してください。' : 'IDFを選ぶと南面などの窓が載ります。');
    }else{
      solarWarn = '窓日射熱が0なのは、窓のη・面積、または読み込んだ日射が0のためです。I_DN は '+idn.toFixed(0)+' W/m² あります。';
    }
  }
  document.getElementById('grandTotalWrap').innerHTML =
    (solarWarn ? '<div class="warn">'+solarWarn+'</div>' : '')+
    '<div class="summary-grid">'+
      '<div class="stat"><div class="lbl">窓日射熱 合計</div><div class="val">'+grand.solarW.toFixed(0)+' W</div></div>'+
      '<div class="stat"><div class="lbl">人体顕熱 合計</div><div class="val">'+grand.peopleSens.toFixed(0)+' W</div></div>'+
      '<div class="stat"><div class="lbl">人体潜熱 合計</div><div class="val">'+grand.peopleLat.toFixed(0)+' W</div></div>'+
      '<div class="stat"><div class="lbl">機器顕熱 合計</div><div class="val">'+grand.equipSens.toFixed(0)+' W</div></div>'+
      '<div class="stat hl"><div class="lbl">全室 合計顕熱</div><div class="val">'+grand.totalSens.toFixed(0)+' W</div></div>'+
      '<div class="stat hl"><div class="lbl">全室 合計潜熱</div><div class="val">'+grand.totalLat.toFixed(0)+' W</div></div>'+
      '<div class="stat hl"><div class="lbl">全室 合計発湿</div><div class="val">'+grand.totalMoist.toFixed(0)+' g/h</div></div>'+
    '</div>';

  let rt = '<table><tr><th>室名</th><th>窓</th><th>直達日射(W)</th><th>人体顕熱(W)</th><th>人体潜熱(W)</th><th>機器顕熱(W)</th><th>追加(W)</th><th>合計顕熱(W)</th><th>合計潜熱(W)</th><th>合計発湿(g/h)</th></tr>';
  results.forEach(r=>{
    rt += '<tr><td>'+escapeHtml(r.name)+'</td><td>'+(r.winN||0)+'</td><td>'+r.solarW.toFixed(1)+'</td><td>'+r.peopleSens.toFixed(1)+'</td><td>'+r.peopleLat.toFixed(1)+'</td><td>'+r.equipSens.toFixed(1)+'</td><td>'+r.extraSens.toFixed(1)+'</td><td>'+r.totalSens.toFixed(1)+'</td><td>'+r.totalLat.toFixed(1)+'</td><td>'+r.totalMoist.toFixed(1)+'</td></tr>';
  });
  rt += '<tr style="font-weight:600; background:#F4F4F4;"><td>全室合計</td><td>'+winRows+'</td><td>'+grand.solarW.toFixed(1)+'</td><td>'+grand.peopleSens.toFixed(1)+'</td><td>'+grand.peopleLat.toFixed(1)+'</td><td>'+grand.equipSens.toFixed(1)+'</td><td>'+grand.extraSens.toFixed(1)+'</td><td>'+grand.totalSens.toFixed(1)+'</td><td>'+grand.totalLat.toFixed(1)+'</td><td>'+grand.totalMoist.toFixed(1)+'</td></tr></table>';
  document.getElementById('roomTableWrap').innerHTML = rt;

  if(roomChart) roomChart.destroy();
  const roomChartSets = [
    {label:'窓日射熱', data:results.map(r=>r.solarW), backgroundColor:'#F2A45C'},
    {label:'人体顕熱', data:results.map(r=>r.peopleSens), backgroundColor:'#4FC4E4'},
    {label:'人体潜熱', data:results.map(r=>r.peopleLat), backgroundColor:'#5B6FCF'},
    {label:'機器顕熱', data:results.map(r=>r.equipSens), backgroundColor:'#ED6A47'}
  ];
  if(results.some(function(r){ return r.equipLat; })){
    roomChartSets.push({label:'機器潜熱', data:results.map(r=>r.equipLat), backgroundColor:'#C45B8C'});
  }
  if(results.some(function(r){ return r.extraSens || r.extraLat; })){
    roomChartSets.push({label:'追加顕熱', data:results.map(r=>r.extraSens), backgroundColor:'#9AA0A6'});
  }
  if(results.some(function(r){ return r.extraLat; })){
    roomChartSets.push({label:'追加潜熱', data:results.map(r=>r.extraLat), backgroundColor:'#B8A078'});
  }
  roomChart = new Chart(document.getElementById('roomChart'), {
    type:'bar',
    data:{
      labels: results.map(r=>r.name),
      datasets: roomChartSets
    },
    options:{responsive:true, maintainAspectRatio:false, animation:false,
      scales:{ x:{stacked:true}, y:{stacked:true, title:{display:true,text:'顕熱・潜熱 (W)'}} }}
  });
  results.forEach(r=>{
    tr('2','発生エリア: '+r.name,'発熱量 [W]', r.totalSens.toFixed(1));
    tr('2','発生エリア: '+r.name,'発湿量 [g/h]', r.totalMoist.toFixed(1));
  });

  // ================= Step 3: エアコン =================
  document.getElementById('outTaDisp').value = oatNow.toFixed(1);
  document.getElementById('roomTDisp').value = targetT;
  const cat = acCatalog[+document.getElementById('tatamiSel').value];
  document.getElementById('acRatedInfo').textContent = '参考: '+cat.tatami+'畳クラス 定格 '+cat.rated+' kW / 最大 '+cat.max+' kW';
  const dir = document.getElementById('dirSel').value;
  const vol = document.getElementById('volSel').value;
  const acMax=num('acMax'), acCount=Math.max(0, Math.round(num('acCount')));
  const managedAc=typeof atParts!=='undefined' && atParts.managedAc && typeof appMode!=='undefined' && appMode==='architrend' && typeof atPartAcFlowSummary==='function';
  const acSummary=managedAc ? atPartAcFlowSummary(vol) : null;
  const usingPlaced=!!(acSummary && acSummary.units.length);
  let flowPer=num('flowPerUnit');
  let vTotal=flowPer*acCount;
  let flowInfoText='Z-Tシリーズ '+dir+'・'+vol+'風のフリーブロー値: '+((flowTable[dir]||{})[vol]||flowPer)+' ㎥/h'+(dir==='30°' ? ' (実測値1点のみ・ノッチ共通)' : '');
  if(usingPlaced){
    vTotal=acSummary.total;
    flowPer=acSummary.per;
    if(acSummary.same){
      flowInfoText='配置したエアコン '+acSummary.dir+'・'+vol+'風: 1台 '+acSummary.per+' ㎥/h × '+acCount+'台';
      if(acSummary.dir==='30°') flowInfoText+=' (実測値1点のみ・ノッチ共通)';
    }else{
      flowInfoText='配置したエアコン '+acCount+'台の風量合計（'+vol+'風）: '+vTotal.toFixed(0)+' ㎥/h（台ごとに風向が異なるため1台平均 '+Math.round(acSummary.per)+' ㎥/h）';
    }
  }
  document.getElementById('flowInfo').textContent = flowInfoText;

  const ua=numOrNull('uaVal'), envA=numOrNull('envArea');
  const ventMode = document.getElementById('ventMode').value;
  const ac=calculateAcLoadSupply({ua,envelopeArea:envA,outdoorTemperature:oatNow,
    targetTemperature:numOrNull('targetT'),weatherReady:taReady||useEpSat,ventMode,
    ach:numOrNull('ach'),volume:numOrNull('roomVol'),heatRecoveryPercent:numOrNull('hxRate'),
    internalSensible:grand.totalSens,internalLatent:grand.totalLat,count:acCount,totalFlow:vTotal,maxCapacityKw:numOrNull('acMax')});
  acCalculationState=ac;
  const qEnv=ac.envelope,qVent=ac.ventilation,qInt=ac.internal,qReq=ac.cooling;
  const watts=value=>Number.isFinite(value)?value.toFixed(0)+' W':'入力を確認';
  const shown=value=>value===null?'未入力':String(value);
  const detailLine=(label,expression,value)=>'<p style="margin:6px 0;"><b>'+label+'</b> '+expression+' = '+watts(value)+'</p>';
  document.getElementById('loadStats').innerHTML =
    '<div class="stat"><div class="lbl">外皮負荷（顕熱）</div><div class="val">'+watts(qEnv)+'</div></div>'+
    '<div class="stat"><div class="lbl">換気負荷'+(ventMode==='none'?' (除外中)':'')+'</div><div class="val">'+watts(qVent)+'</div></div>'+
    '<div class="stat"><div class="lbl">内部発熱+日射 (顕熱)</div><div class="val">'+watts(qInt)+'</div></div>'+
    '<div class="stat"><div class="lbl">内部発熱の発湿</div><div class="val">'+grand.totalMoist.toFixed(0)+' g/h</div></div>'+
    '<div class="stat hl"><div class="lbl">必要冷房処理熱量（顕熱）</div><div class="val">'+watts(qReq)+'</div></div>'+
    '<div style="grid-column:1/-1; padding:12px; background:#f4f8f5; border:1px solid #c7d8cd;">'+
      '<b>計算に使った値</b>'+detailLine('外皮',shown(ua)+' W/m²K × '+shown(envA)+' m² × ('+shown(ac.values.outdoorTemperature)+' − '+shown(ac.values.targetTemperature)+') K',qEnv)+
      (ventMode==='none'?'<p>換気負荷は除外しています。</p>':detailLine('換気','0.333 W/(m³/h・K) × '+shown(ac.values.ach)+' 回/h × '+shown(ac.values.volume)+' m³ × 温度差'+(ventMode==='first'?' × (1 − '+shown(ac.values.heatRecoveryPercent)+' / 100)':''),qVent))+
      detailLine('部屋の顕熱','窓からの日射 + 人体 + 機器・照明 + 追加発熱',qInt)+
      '<p class="small">吹出温度は顕熱の収支による参考値です。発湿の潜熱 '+grand.totalLat.toFixed(0)+' W は別に集計しています。機器能力の選定には除湿・外気の湿度条件も必要です。</p></div>';

  const qPerUnit=ac.perUnit,ts=ac.supplyTemperature,dts=ac.temperatureDifference;
  const tsText=ac.ready?ts.toFixed(2):'算定保留';
  document.getElementById('supplyStats').innerHTML =
    '<div class="stat"><div class="lbl">総風量 ('+acCount+'台)</div><div class="val">'+vTotal.toFixed(0)+' ㎥/h</div></div>'+
    '<div class="stat"><div class="lbl">1台あたり処理熱量（顕熱）</div><div class="val">'+watts(qPerUnit)+'</div></div>'+
    '<div class="stat"><div class="lbl">必要温度差 ΔT</div><div class="val">'+(ac.ready?dts.toFixed(2)+' K':'算定保留')+'</div></div>'+
    '<div class="stat hl"><div class="lbl">吹出温度 (CFD入力・全台共通)</div><div class="val">'+tsText+(ac.ready?' ℃ <button class="copy-btn" data-copy="'+tsText+'">コピー</button>':'')+'</div></div>'+
    '<div class="stat hl"><div class="lbl">吹出湿度（仮定値・除湿計算なし）</div><div class="val">'+(ac.ready?'95 %RH <button class="copy-btn" data-copy="95">コピー</button>':'温度の確認後に表示')+'</div></div>'+
    '<div class="stat"><div class="lbl">吸込温度 (=目標室温)</div><div class="val">'+targetT.toFixed(1)+' ℃</div></div>';

  let warns=ac.errors.map(error=>'<div class="warn" role="alert">'+escapeHtml(error.message)+'</div>').join('');
  const acMaxBlank = !String(document.getElementById('acMax').value||'').trim();
  const capW = acMax*1000*acCount;
  if(ac.loadReady&&acCount&&!acMaxBlank && qReq > capW){
    warns += '<div class="warn">能力不足: 必要処理熱量 '+qReq.toFixed(0)+' W が最大冷房能力 '+capW.toFixed(0)+' W ('+acMax+' kW × '+acCount+'台) を超えています。畳数クラスを上げるか台数を増やしてください。</div>';
  }else if(ac.loadReady&&acCount&&capW>0&&!acMaxBlank){
    warns += '<div class="small ok">能力チェックOK: 負荷率 '+(qReq/capW*100).toFixed(0)+'% (必要 '+qReq.toFixed(0)+' W / 最大 '+capW.toFixed(0)+' W)</div>';
  }
  if(ac.noCooling)warns += '<div class="small ok">この条件では顕熱の冷房負荷がありません。冷房処理熱量は0 W、吹出温度は目標室温です。</div>';
  if(ac.ready && ts < 10) warns += '<div class="warn">吹出温度が10℃を下回っています。風量アップや台数追加も検討してください。</div>';
  if(usingPlaced && !acSummary.same) warns += '<div class="warn">風向が台ごとに違うため、SSLの1台あたり風量は平均値です。FlowDesignerで吹出流量を台ごとに直してください。</div>';
  document.getElementById('acWarn').innerHTML = warns;
  renderAcCompare(qReq, flowPer, acMax, targetT, acCount);
  if(usingPlaced){
    acSummary.units.forEach((it,i)=>{
      tr('3','エアコン'+(i+1)+' ('+atPartAcDir(it)+' · '+it.floor+'F)','風量 [㎥/h]', acSummary.flows[i]);
    });
  }
  if(ac.ready){
    tr('3','エアコン (吹出・1台あたり)','風量 [㎥/h]', usingPlaced && !acSummary.same ? Math.round(flowPer) : flowPer);
    tr('3','エアコン (吹出)','吹出温度 [℃]', tsText);
    tr('3','エアコン (吹出)','吹出湿度 [%RH] (業界慣行で95%RH固定)', '95');
    tr('3','エアコン (吸込)','吸込温度 [℃] (=目標室温)', targetT.toFixed(1));
  }

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
  if(typeof refreshIdfMeshUi==='function' && typeof appMode!=='undefined' && appMode==='energyplus') refreshIdfMeshUi();

  // ---- 進捗表示 ----
  for(let i=1;i<=5;i++){
    const done = document.getElementById('done'+i).checked;
    const el = document.getElementById('st'+i);
    el.textContent = done ? '済' : '未';
    el.className = 'st'+(done?' done':'');
  }

  saveStateDebounced();
}


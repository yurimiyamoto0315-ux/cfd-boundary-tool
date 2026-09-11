// ========================= 住所・最厳日/時刻の自動取得 =========================
async function geocodeAddress(){
  const address=document.getElementById('siteAddress').value.trim();
  const btn=document.getElementById('geocodeAddressBtn');
  const info=document.getElementById('geocodeAddressInfo');
  if(!address){
    info.textContent='建設地住所を入力してください。';
    return;
  }
  btn.disabled=true;
  info.textContent='住所から緯度・経度を検索中…';
  try{
    const url='https://msearch.gsi.go.jp/address-search/AddressSearch?q='+encodeURIComponent(address);
    const res=await fetch(url);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json();
    if(!Array.isArray(data) || !data.length || !data[0].geometry) throw new Error('住所候補が見つかりません');
    const coords=data[0].geometry.coordinates;
    const lon=Number(coords[0]), lat=Number(coords[1]);
    if(!isFinite(lat) || !isFinite(lon)) throw new Error('座標を取得できません');
    document.getElementById('lat').value=lat.toFixed(6);
    document.getElementById('lon').value=lon.toFixed(6);
    const title=(data[0].properties&&data[0].properties.title)||address;
    info.textContent='取得完了: '+title+' → 緯度 '+lat.toFixed(6)+' / 経度 '+lon.toFixed(6)+' (出典: 国土地理院)。続けて最厳日・時刻を取得してください。';
    runAll();
  }catch(err){
    info.textContent='住所検索に失敗しました ('+err.message+')。住所を短くするか、緯度・経度を直接入力してください。';
  }finally{
    btn.disabled=false;
  }
}

// Open-Meteo Historical Weather API (無料・APIキー不要) から直近1年の時別気温を取得し、
// 日最高気温が最大の日を「最厳日」として解析日・解析時刻・最高/最低気温に自動反映する
async function fetchHottestDay(){
  const btn = document.getElementById('fetchHottestBtn');
  const info = document.getElementById('fetchHottestInfo');
  const geo = readLatLon();
  if(!geo.ok){
    info.textContent = geo.reason;
    return;
  }
  const {lat, lon} = geo;
  btn.disabled = true;
  info.textContent = '気象データを取得中… (Open-Meteo)';
  try{
    const end = new Date(); end.setDate(end.getDate()-6); // アーカイブAPIは直近数日分が未確定のため余裕を持たせる
    const start = new Date(end); start.setFullYear(start.getFullYear()-1);
    // ローカル日付でYYYY-MM-DDを組む (toISOStringはUTCなので日本だと日付が1日ずれる)
    const fmt = d=>{
      const y=d.getFullYear();
      const m=String(d.getMonth()+1).padStart(2,'0');
      const day=String(d.getDate()).padStart(2,'0');
      return y+'-'+m+'-'+day;
    };
    const url = 'https://archive-api.open-meteo.com/v1/archive?latitude='+lat+'&longitude='+lon+
      '&start_date='+fmt(start)+'&end_date='+fmt(end)+'&hourly=temperature_2m&timezone=Asia%2FTokyo';
    const res = await fetch(url);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    const times = data.hourly && data.hourly.time;
    const temps = data.hourly && data.hourly.temperature_2m;
    if(!times || !temps || !times.length) throw new Error('気象データが空でした');
    const byDate = {};
    for(let i=0;i<times.length;i++){
      const d = times[i].slice(0,10);
      const h = +times[i].slice(11,13);
      const t = temps[i];
      if(t===null || t===undefined) continue;
      if(!byDate[d]) byDate[d] = [];
      byDate[d].push({h:h, t:t});
    }
    let bestDate=null, bestMax=-Infinity, bestMin=Infinity, bestHour=14;
    for(const d in byDate){
      const arr = byDate[d];
      if(arr.length < 20) continue; // 欠損の多い日は除外
      let dMax=-Infinity, dMin=Infinity, dMaxH=14;
      arr.forEach(x=>{
        if(x.t>dMax){ dMax=x.t; dMaxH=x.h; }
        if(x.t<dMin) dMin=x.t;
      });
      if(dMax>bestMax){ bestMax=dMax; bestMin=dMin; bestHour=dMaxH; bestDate=d; }
    }
    if(!bestDate) throw new Error('最高気温の日を特定できませんでした');
    document.getElementById('calcDate').value = bestDate;
    document.getElementById('detailHour').value = bestHour;
    document.getElementById('tmax').value = bestMax.toFixed(1);
    document.getElementById('tmin').value = bestMin.toFixed(1);
    document.getElementById('tpeak').value = bestHour;
    info.textContent = '取得完了: 最厳日 '+bestDate+' / 解析時刻 '+bestHour+'時 / 最高'+bestMax.toFixed(1)+'℃ / 最低'+bestMin.toFixed(1)+'℃ (出典: Open-Meteo)。';
    runAll();
  }catch(err){
    info.textContent = '取得に失敗しました ('+err.message+')。オフライン、またはAPI一時停止の可能性があります。手動入力してください。';
  }finally{
    btn.disabled = false;
  }
}


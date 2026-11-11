// Shared asynchronous solar source. Browser and VBS/localhost use the same Worker.
(function(){
  'use strict';
  const M=window.BoundarySolarData,versions={pyodide:'314.0.7',pvlib:'0.16.1'};
  const field=id=>document.getElementById(id),value=id=>field(id)?.value??'';
  const numeric=id=>value(id).trim()!==''?Number(value(id)):null;
  let source='pvlib-clear',worker=null,sequence=0,workerEpoch=0,loadedEpoch=-1;
  let current=null,activeKey='',timer=null,status='idle',message='',fileSequence=0;
  let epwText=null,epwMeta=null,fileError='',fileLoading=false,mode=null,lastRender='';
  const pending=new Map(),cache=new Map();
  const stateIds=['calcDate','detailHour','lat','lon','tmax','tmin','tpeak','rho'];
  function modeIsEp(){return typeof appMode!=='undefined'&&appMode==='energyplus';}
  function notify(invalidateThermal=false){
    queueMicrotask(()=>{
      if(invalidateThermal)window.boundaryThermalClimateChanged?.();
      else window.boundaryThermalRender?.();
      window.dispatchEvent(new CustomEvent('boundary-solar-changed'));
    });
  }
  function invalidate(changed=true){current=null;activeKey='';clearTimeout(timer);status='idle';notify(changed);}
  function readableError(error){
    const text=String(error?.message||error),lines=text.trim().split('\n');
    const last=lines.at(-1)||text;
    return last.replace(/^ValueError:\s*/,'').slice(0,280);
  }
  function call(payload){
    if(!worker){
      worker=new Worker(new URL('solar/worker.mjs?v=20261028a',document.baseURI),{type:'module'});workerEpoch++;
      worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;pending.delete(data.id);clearTimeout(task.timeout);data.error?task.reject(new Error(readableError({message:data.error}))):task.resolve(data);};
      worker.onerror=event=>{
        event.preventDefault();
        for(const task of pending.values()){clearTimeout(task.timeout);task.reject(new Error('日射計算を起動できませんでした。配布ファイルと通信状態を確認し、再試行してください'));}
        pending.clear();worker?.terminate();worker=null;loadedEpoch=-1;
      };
    }
    return new Promise((resolve,reject)=>{
      const id=++sequence;
      const timeout=setTimeout(()=>{
        for(const task of pending.values()){clearTimeout(task.timeout);task.reject(new Error('日射計算が時間内に完了しませんでした。再試行するか、従来方式を選んでください'));}
        pending.clear();worker?.terminate();worker=null;loadedEpoch=-1;
      },180000);
      pending.set(id,{resolve,reject,timeout});worker.postMessage({id,payload});
    });
  }
  function surfaces(){
    const planes=new Map(),add=(tilt,az)=>{const spec=M.surfaceSpec(tilt,az);planes.set(spec.id,spec);};
    orientations.forEach(orientation=>add(90,orientation.az));add(0,-180);
    document.querySelectorAll('.win-row .wAz').forEach(input=>{if(input.value.trim()!==''&&Number.isFinite(Number(input.value)))add(90,Number(input.value));});
    const mesh=typeof atMesh!=='undefined'?atMesh:null;
    if(mesh&&window.BoundaryAtticModel){
      const north=typeof atNorthDeg==='function'?atNorthDeg():0;
      for(const patch of window.BoundaryAtticModel.geometry(mesh).patches){const plane=M.normalPlane(patch.normal,north);add(plane.tilt,plane.toolAz);}
    }
    return [...planes.values()].sort((a,b)=>a.id.localeCompare(b.id));
  }
  function request(){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value('calcDate')))throw new Error('解析対象の日付を入力してください');
    const hour=numeric('detailHour'),albedo=numeric('rho');
    if(hour===null||!Number.isFinite(hour)||hour<0||hour>24)throw new Error('解析時刻を0〜24時で入力してください');
    if(albedo===null||!Number.isFinite(albedo)||albedo<0||albedo>1)throw new Error('地面反射率を0〜1で入力してください');
    const input={source,date:value('calcDate'),hour,albedo,surfaces:surfaces()};
    if(source==='pvlib-epw'){
      if(!epwMeta||!epwText)throw new Error(fileLoading?'EPWを読み込み中です。':fileError||'この設定で使用するEPWを選択してください。保存後の再開時も再読込が必要です');
      if(!Number.isInteger(hour)||hour<1)throw new Error('EPWは1〜24時終了の時間帯を選んでください（例：14時＝13〜14時）');
      if(input.date.slice(5)==='02-29')throw new Error('このEPWに2月29日はありません');
      input.epwHash=epwMeta.hash;
    }else{
      for(const id of ['lat','lon','tmax','tmin','tpeak'])if(numeric(id)===null||!Number.isFinite(numeric(id)))throw new Error('敷地の緯度・経度、最高・最低気温、気温ピーク時刻を入力してください');
      Object.assign(input,{latitude:numeric('lat'),longitude:numeric('lon'),tmax:numeric('tmax'),tmin:numeric('tmin'),tpeak:numeric('tpeak')});
    }
    return input;
  }
  async function calculate(input,key){
    try{
      // A restarted worker has lost its in-memory EPW. Reload the current selection only.
      if(input.source==='pvlib-epw'&&loadedEpoch!==workerEpoch){
        const text=epwText,meta=(await call({command:'load-epw',text})).result;
        if(key!==activeKey)return;
        if(meta.hash!==input.epwHash)throw new Error('EPWの照合に失敗しました。読み直してください');
        loadedEpoch=workerEpoch;
      }
      const response=await call(input),result={...response.result,fingerprint:key};
      cache.set(key,result);if(cache.size>4)cache.delete(cache.keys().next().value);
      if(key!==activeKey)return;
      current=result;status='ready';message='';render();notify();
      if(typeof runAll==='function')runAll();
    }catch(error){
      if(key!==activeKey)return;
      current=null;status='error';message=readableError(error);render();notify();
      if(typeof runAll==='function')runAll();
    }
  }
  function read(){
    syncControls();
    if(modeIsEp()||source==='legacy'){render();return {ready:true,context:null,source:modeIsEp()?'energyplus':'legacy'};}
    let input,key;
    try{
      if(!/^https?:$/.test(location.protocol))throw new Error('この日射方式は公開Web版、またはVBSで起動したローカル版で使用できます。HTML直接起動では従来方式を選んでください');
      input=request();key=JSON.stringify({versions,...input});
    }catch(error){
      if(activeKey){activeKey='';current=null;clearTimeout(timer);notify();}
      status=fileLoading?'loading':'error';message=readableError(error);render();return {ready:false,message,context:null,source};
    }
    if(activeKey!==key){
      activeKey=key;current=cache.get(key)||null;clearTimeout(timer);
      status=current?'ready':'loading';message='';notify();
      if(!current)timer=setTimeout(()=>calculate(input,key),120);
    }
    render();
    return {ready:status==='ready'&&!!current,context:current,source,message:message||'日射条件を計算中です。完了後に条件を出力できます'};
  }
  function syncControls(){
    const ep=modeIsEp(),usingEpw=!ep&&source==='pvlib-epw';
    const set=(id,key,next)=>{const el=field(id);if(el&&el[key]!==next)el[key]=next;};
    set('solarSource','value',ep?'energyplus':source);set('solarSource','disabled',ep);set('solarEpwFields','hidden',!usingEpw);
    for(const id of ['tmax','tmin','tpeak','lat','lon','geocodeAddressBtn'])set(id,'disabled',usingEpw);
    set('fetchHottestBtn','disabled',usingEpw||ep);
    set('detailHour','step',usingEpw?'1':'0.5');set('detailHour','min',usingEpw?'1':'0');
    set('solarRetry','hidden',ep||source==='legacy'||status!=='error');
    set('solarCompare','hidden',ep||source!=='pvlib-clear'||!current);
  }
  function render(){
    const info=field('solarStatus');if(!info)return;
    const ep=modeIsEp();
    syncControls();
    const signature=JSON.stringify([ep,source,status,message,current?.fingerprint]);
    if(signature===lastRender)return;
    lastRender=signature;
    info.dataset.state=ep||source==='legacy'?'ready':status;
    if(ep){info.textContent='EnergyPlusの面日射・透過日射を使う既存の計算経路です。pvlibの日射を上乗せしません。';return;}
    if(source==='legacy'){info.textContent='従来方式を使用しています。保存済み案件の計算方法を保持します。';}
    else if(status==='ready'&&current){
      const p=current.provenance,h=current.hours[current.selected],offset=p.utcOffset;
      info.textContent=(source==='pvlib-epw'?`${p.name} ／ ${current.date} ${h-1}〜${h}時の1時間平均`:`晴天の推定 ／ ${current.date} ${h}時の瞬時値`)+
        ` ／ UTC${offset>=0?'+':''}${offset} ／ 緯度 ${p.latitude.toFixed(4)}・経度 ${p.longitude.toFixed(4)} ／ 標高 ${p.altitude.toFixed(0)} m（${p.altitudeSource}）`;
    }else info.textContent=message||(status==='loading'?'日射計算を準備中です。初回は約57 MBを読み込みます。画面の入力は続けられます。':'日時と気象条件を設定してください。');
    const detail=field('solarComponents');
    if(detail){
      if(status==='ready'&&current&&source!=='legacy'){
        const f=M.frame(current,current.hours[current.selected]),rows=[['外壁 南',90,0],['外壁 東',90,-90],['外壁 西',90,90],['外壁 北',90,180],['屋根 水平',0,-180]];
        detail.innerHTML=`<p>pvlib ${versions.pvlib} ／ NREL SPA・${current.provenance.weather}・等方天空<br>DNI ${f.dni.toFixed(1)} ／ DHI ${f.dhi.toFixed(1)} ／ GHI ${f.ghi.toFixed(1)} W/m² ／ 外気温 ${f.temperature.toFixed(1)} ℃</p>`+
          '<div class="solar-table-scroll"><table><caption>各面への入射日射（W/m²）</caption><thead><tr><th scope="col">面</th><th scope="col">直達</th><th scope="col">天空散乱</th><th scope="col">地面反射</th><th scope="col">合計</th></tr></thead><tbody>'+
          rows.map(([label,tilt,az])=>{const p=M.surface(current,tilt,az,f.hour);return '<tr><th scope="row">'+label+'</th>'+['beam','sky','ground','total'].map(k=>'<td>'+p[k].toFixed(1)+'</td>').join('')+'</tr>';}).join('')+'</tbody></table></div>';
      }else detail.textContent=source==='legacy'?'従来方式の計算根拠は「日射計算のしくみ」を参照してください。':message||'計算が完了すると表示します。';
    }
    if(field('solarComparison'))field('solarComparison').hidden=true;
  }
  function clearOutputs(){
    const note='<p class="solar-wait">日射条件の確認待ちです。共通条件の日射・気象を確認してください。</p>';
    for(const id of ['commonSolarInfo','satSolarInfo','satTableWrap','floor1Wrap','foundWrap','step2SolarInfo','grandTotalWrap','roomTableWrap','loadStats','supplyStats','acWarn','transferWrap','acCompareWrap'])if(field(id))field(id).innerHTML=note;
    document.querySelectorAll('.room-card [id$="_summary"]').forEach(el=>el.innerHTML=note);
    document.querySelectorAll('.wSolarHint').forEach(el=>el.textContent='日射条件を確認中です');
    if(typeof satChart!=='undefined'&&satChart){satChart.destroy();satChart=null;}
    if(typeof roomChart!=='undefined'&&roomChart){roomChart.destroy();roomChart=null;}
    window.boundaryRoomGainResults={ready:false,rooms:[],grand:null};
  }
  function snapshot(){return {version:1,source,versions,epw:epwMeta?{...epwMeta}:null,provenance:current?.provenance||null};}
  function exportComment(){
    const state=read(),base='solar_source='+state.source+' date='+value('calcDate');
    if(!state.context)return base+' hour='+value('detailHour');
    const p=state.context.provenance,hour=state.context.hours[state.context.selected];
    return base+(p.timeBasis==='hour-ending'?' hour_end=':' hour=')+hour+' time_basis='+p.timeBasis+' utc_offset='+p.utcOffset+
      ' pvlib='+versions.pvlib+' latitude='+p.latitude+' longitude='+p.longitude+' altitude_m='+p.altitude+
      (p.hash?' epw_sha256='+p.hash:'');
  }
  function restore(saved){
    source=['legacy','pvlib-clear','pvlib-epw'].includes(saved?.source)?saved.source:'legacy';
    fileSequence++;epwText=null;epwMeta=saved?.epw?{...saved.epw}:null;fileError='';fileLoading=false;loadedEpoch=-1;
    if(field('solarEpwInput'))field('solarEpwInput').value='';
    invalidate(false);syncControls();render();
  }
  function newMode(next){
    if(next===mode)return;
    mode=next;source='pvlib-clear';epwText=null;epwMeta=null;fileError='';fileLoading=false;fileSequence++;loadedEpoch=-1;
    if(field('solarEpwInput'))field('solarEpwInput').value='';invalidate(false);syncControls();
  }
  function setSource(next){
    if(!['legacy','pvlib-clear','pvlib-epw'].includes(next)||next===source)return;
    source=next;invalidate();syncControls();if(typeof runAll==='function')runAll();
  }
  async function selectFile(file){
    const id=++fileSequence;epwText=null;epwMeta=null;fileError='';fileLoading=true;loadedEpoch=-1;invalidate();
    if(typeof runAll==='function')runAll();
    try{
      if(!file)throw new Error('EPWを選択してください');
      if(file.size>10_000_000)throw new Error('EPWは10 MB以下の年間データを指定してください');
      const text=(await file.text()).replace(/^\uFEFF/,'');
      if(id!==fileSequence)return;
      const response=await call({command:'load-epw',text});if(id!==fileSequence)return;
      epwText=text;epwMeta=response.result;loadedEpoch=workerEpoch;
    }catch(error){if(id!==fileSequence)return;fileError=readableError(error);}
    if(id!==fileSequence)return;
    fileLoading=false;invalidate();if(typeof runAll==='function')runAll();
  }
  function compare(){
    if(!current||source!=='pvlib-clear')return;
    const parts=current.date.split('-').map(Number),hour=current.hours[current.selected];
    const f=M.legacyFrame({y:parts[0],mo:parts[1],d:parts[2],hour,lat:numeric('lat'),lon:numeric('lon'),tmax:numeric('tmax'),tmin:numeric('tmin'),tpeak:numeric('tpeak')},solarPos,taAt);
    const box=field('solarComparison');box.hidden=false;
    box.innerHTML='<p>同一日時・地点・外気温による入射日射の比較（W/m²）。差には太陽位置と晴天モデルの変更が含まれます。</p><div class="solar-table-scroll"><table><thead><tr><th scope="col">面</th><th scope="col">従来方式</th><th scope="col">pvlib</th><th scope="col">差</th></tr></thead><tbody>'+
      [['南',90,0],['東',90,-90],['西',90,90],['北',90,180],['水平屋根',0,-180]].map(([label,tilt,az])=>{const old=M.isotropic(f,tilt,az,numeric('rho')).total,now=M.surface(current,tilt,az,hour).total,diff=now-old;return '<tr><th scope="row">'+label+'</th><td>'+old.toFixed(1)+'</td><td>'+now.toFixed(1)+'</td><td>'+(diff>=0?'+':'')+diff.toFixed(1)+'</td></tr>';}).join('')+'</tbody></table></div>';
  }
  window.boundarySolar={read,readiness(){const s=read();return {ready:s.ready,message:s.message||'',source:s.source};},snapshot,restore,newMode,setSource,clearOutputs,exportComment,
    selectedNormal(normal){const state=read();if(!state.ready||!state.context)return null;const p=M.normalPlane(normal,typeof atNorthDeg==='function'?atNorthDeg():0);return M.surface(state.context,p.tilt,p.toolAz,state.context.hours[state.context.selected]);},
    get source(){return source;},get context(){return current;}};
  field('solarSource')?.addEventListener('change',event=>setSource(event.target.value));
  field('solarSource')?.addEventListener('input',event=>setSource(event.target.value));
  field('solarEpwInput')?.addEventListener('change',event=>selectFile(event.target.files?.[0]));
  field('solarRetry')?.addEventListener('click',()=>{invalidate();if(typeof runAll==='function')runAll();});
  field('solarCompare')?.addEventListener('click',compare);
  document.addEventListener('input',event=>{if(stateIds.includes(event.target.id))syncControls();});
  for(const name of ['architrend-model-ready','architrend-room-mapping-changed'])window.addEventListener(name,()=>{if(typeof runAll==='function')runAll();});
})();

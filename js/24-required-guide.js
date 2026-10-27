// Required inputs follow the selected export boundaries, rather than every form.
(function(){
  'use strict';
  const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const atMode=()=>typeof appMode!=='undefined'&&appMode==='architrend';
  const manualScope=()=>typeof appMode!=='undefined'&&appMode==='manual'&&typeof sslColors!=='undefined'&&sslColors.length>0;
  const underlyingExportReadiness=typeof window.boundaryExportReadiness==='function'?window.boundaryExportReadiness:null;
  const number=el=>el&&String(el.value).trim()!==''&&Number.isFinite(Number(el.value))?Number(el.value):null;
  const value=id=>number($(id)),present=id=>!!$(id)&&String($(id).value).trim()!=='';
  let lastReport={ready:true,issues:[]},refreshing=false,queued=false,moreOpen=false;
  function report(){
    const issues=[],checks=[],isAt=atMode(),mesh=isAt&&typeof atMesh!=='undefined'?atMesh:null,data=isAt&&typeof atLastParse!=='undefined'?atLastParse?.result:null;
    if(!isAt&&!manualScope()||isAt&&!mesh&&!data)return {ready:true,active:false,issues,checks};
    const sharedHosts=new Set(['#loadStats','#atThermalReview','#atUnassignedBox','#atRoomViewer','#atPanel','#atCsvInput']);
    const add=(key,label,reason,section,selector,target='',kind='required',blocking=true)=>{if(!issues.some(issue=>issue.key===key||issue.selector===selector&&!sharedHosts.has(selector)))issues.push({key,label,reason,section,selector,target,kind,blocking});};
    const observe=(key,label,valid,reason,section,selector,id)=>{checks.push({key,id,label,section,selector,valid:!!valid});if(!valid)add(key,label,reason,section,selector);};
    const check=(id,label,valid,reason,section='日時・気象')=>observe('field:'+id,label,valid,reason,section,'#'+id,id);
    const positive=(id,label,section)=>check(id,label,value(id)>0,'0より大きい数値を入力してください。',section);
    const colors=typeof sslColors!=='undefined'?sslColors:[],assign=typeof sslAssign!=='undefined'?sslAssign:{};
    const explicit=colors.length>0&&colors.every(color=>!!assign[color.rgb]),keys=explicit?colors.map(color=>assign[color.rgb]).filter(key=>key&&key!=='exclude'):(mesh?.meshFaces||[]).filter(face=>!face.atReplacedByPart).map(face=>face.sslKey||'');
    const uses=predicate=>keys.some(predicate),has=key=>keys.includes(key);
    const insulation=isAt&&typeof window.boundaryInsulationStatus==='function'?window.boundaryInsulationStatus():[];
    const statusFor=target=>insulation.find(status=>status.target===target);
    const targetUsed=target=>!explicit||uses(key=>{
      if(key.startsWith('at_spec:')){const category=window.boundaryThermalCategories?.().find(category=>category.key===key);return !!category&&(target==='wall'?category.label.startsWith('外壁'):target==='roof'?category.label.startsWith('屋根'):target==='ceiling'?category.label.includes('天井'):false);}
      return target==='wall'?/^wall_/.test(key):target==='roof'?key==='roof':target==='ceiling'?key==='innerwall'||key==='attic':false;
    });
    for(const status of insulation){
      if(!targetUsed(status.target)||['ready','not-needed'].includes(status.state))continue;
      const selector=status.fieldIds?.length?'#'+status.fieldIds[0]:'#atThermalReview';
      add('insulation:'+status.target,status.label,status.reason||'設定を確認して反映してください。','断熱・境界条件',selector,status.target,status.state,status.state!=='unavailable'||!!mesh);
    }
    if(mesh?.readiness?.ready===false)add('model-review','モデルの単位・階構成','モデルの確認項目を解決してください。','モデル・部屋','#atRoomViewer');
    if(typeof atRoomFloorReadiness==='function'&&mesh){const floor=atRoomFloorReadiness(mesh);if(!floor.ready)add('floor-review','階段・吹き抜けの床',floor.message||'床と天井の開口を確認してください。','モデル・部屋','#atRoomViewer');}
    if(mesh?.rooms?.some(room=>room.stairAutoNeedsReview))add('stair-review','結合した階段','階段の経路が区画内に入るよう調整してください。','モデル・部屋','#atRoomViewer');
    if(isAt&&typeof architrendImportReadiness==='function'){
      const imported=architrendImportReadiness(),pdfProblem=(imported.codes||[]).some(code=>code.startsWith('PDF_'));
      if(['invalid','loading','empty'].includes(imported.status))add('source-review','読込資料',imported.status==='loading'?'読込が終わるまでお待ちください。':imported.status==='empty'?'条件を作るCSV・PDFを読み込んでください。':pdfProblem?'PDFの読込結果を確認してください。画像の図面・表は、文字を選択できるPDFや同じ物件のCSVで補ってください。':'CSV・PDFの読込エラーを確認してください。','資料の読込',pdfProblem?'#atPdfInput':'#atCsvInput');
    }
    const windowState=isAt&&typeof architrendWindowReadiness==='function'?architrendWindowReadiness():null;
    if(windowState?.codes?.includes('WINDOW_ORIENTATION_MISMATCH'))add('window-orientation','モデルの北方向と資料の窓方位','モデルと資料で窓の方位が一致していません。北方向を確認してから「窓だけ照合し直す」を押してください。入力済みの窓条件は保持しています。','窓',$('atNorthDeg')?'#atNorthDeg':$('atWindowNorthCheck')&&!$('atWindowNorthCheck').hidden?'#atWindowNorthCheck':'#atRoomViewer');
    if(windowState?.codes?.includes('NORTH_ROTATION_AMBIGUOUS'))add('window-north-confirmation','図面で確認する北方向','窓配置から北方向を一つに絞れません。図面の北矢印を確認し、現在の北方向で確定してください。','窓',$('atNorthMatchConfirm')?'#atNorthMatchConfirm':$('atNorthDeg')?'#atNorthDeg':'#atRoomViewer');
    const separateEditor=target=>!!statusFor(target)&&statusFor(target).editor!=='common';
    if(uses(key=>/^wall_/.test(key))&&!separateEditor('wall'))positive('uWall','外壁のU値','外壁');
    if(has('roof')&&!separateEditor('roof'))positive('uRoof','屋根のU値','屋根');
    if(uses(key=>/^extdoor_/.test(key)))positive('uDoor','外部扉のU値','外部扉');
    if(has('floor1')||has('floor_out'))positive('uFloor1','床のU値','床');
    if(has('found'))positive('uFound','基礎の熱通過率','基礎');
    const specifications=uses(key=>key.startsWith('at_spec:'))?(window.boundaryThermalCategories?.()||[]).filter(category=>keys.includes(category.key)):[];
    const specWall=specifications.some(c=>c.label.startsWith('外壁')),specRoof=specifications.some(c=>c.label.startsWith('屋根')),specFloor=specifications.some(c=>c.label.startsWith('外気側の床'));
    const atticState=isAt?window.boundaryAttic?.exportState?.():null,estimatedCeiling=isAt&&targetUsed('ceiling')&&insulation.some(s=>s.target==='ceiling'&&!['not-needed','unavailable'].includes(s.state))&&!atticState?.manualOverride;
    const windowNeeded=has('window'),solarNeeded=windowNeeded||uses(key=>/^wall_|^extdoor_/.test(key))||has('roof')||specWall||specRoof||estimatedCeiling;
    const temperatureNeeded=solarNeeded||has('floor_out')||has('found')||specFloor;
    if(solarNeeded){
      check('calcDate','解析日',/^\d{4}-\d{2}-\d{2}$/.test($('calcDate')?.value||''),'解析する日付を指定してください。');
      check('detailHour','解析時刻',value('detailHour')!==null&&value('detailHour')>=0&&value('detailHour')<=24,'0〜24時で入力してください。');
      check('lat','敷地の緯度',value('lat')!==null&&Math.abs(value('lat'))<=90,'敷地の緯度を入力してください。');
      check('lon','敷地の経度',value('lon')!==null&&Math.abs(value('lon'))<=180,'敷地の経度を入力してください。');
      if(value('lat')===0&&value('lon')===0)add('geo-origin','敷地の場所','緯度・経度がどちらも0です。敷地の座標を確認してください。','日時・気象','#lat');
      check('alpha','日射吸収率',value('alpha')!==null&&value('alpha')>=0&&value('alpha')<=1,'0〜1で入力してください。');
      check('rho','地面の反射率',value('rho')!==null&&value('rho')>=0&&value('rho')<=1,'0〜1で入力してください。');
      positive('ho','外表面の熱伝達率','日時・気象');
      if(has('roof')||specRoof||estimatedCeiling)check('roofCorr','屋根の放射補正',value('roofCorr')!==null,'補正温度を入力してください。0も使えます。');
    }
    if(estimatedCeiling)check('targetT','目標室温',value('targetT')!==null&&value('targetT')>-273.15,'冷房負荷・エアコンの吹出温度・小屋裏温度の概算に共通で使う目標室温を入力してください。');
    if(temperatureNeeded){
      for(const [id,label]of [['tmax','最高気温'],['tmin','最低気温']])check(id,label,value(id)!==null&&value(id)>-273.15,'解析日の気温を入力してください。');
      check('tpeak','最高気温になる時刻',value('tpeak')!==null&&value('tpeak')>=0&&value('tpeak')<=24,'0〜24時で入力してください。');
      if(value('tmax')!==null&&value('tmin')!==null&&value('tmax')<value('tmin'))add('weather-order','最高・最低気温','最高気温は最低気温以上にしてください。','日時・気象','#tmax');
    }
    if(windowNeeded){
      for(const [id,label]of [['hiWin','窓の内表面熱伝達率'],['hoWin','窓の外表面熱伝達率'],['lamWin','窓材質の熱伝導率']])positive(id,label,'窓');
      const rows=[...document.querySelectorAll('.room-card .win-row')];
      const sourceWindows=data?.windows||[],sourceUAvailable=sourceWindows.length>0&&sourceWindows.every(w=>w.u>0);
      if(!rows.length&&!sourceUAvailable)positive('uWin','窓のU値','窓');
      rows.forEach((row,index)=>{
        const selector='[id="'+String(row.id).replace(/["\\]/g,'\\$&')+'"]',local=number(row.querySelector('.wU')),u=local>0?local:value('uWin');
        for(const [cls,label,valid,reason]of [['wEta','日射熱取得率',n=>n!==null&&n>=0&&n<=1,'資料かガラス仕様から0〜1で指定してください。'],['wArea','窓の面積',n=>n>0,'窓の面積を入力してください。'],['wAz','窓の方位',n=>n!==null,'窓の向きを指定してください。']])observe('window:'+index+':'+cls,'窓'+(index+1)+'の'+label,valid(number(row.querySelector('.'+cls))),reason,'窓',selector+' .'+cls);
        if(!(u>0))add('window:'+index+':u','窓'+(index+1)+'のU値','窓ごとのU値か、共通の窓U値を入力してください。','窓',selector+' .wU');
        else if(value('hiWin')>0&&value('hoWin')>0&&!(1/u-1/value('hiWin')-1/value('hoWin')>0))add('window:'+index+':resistance','窓'+(index+1)+'の熱抵抗','U値と表面熱伝達率の組合せでは疑似厚みを計算できません。','窓',selector+' .wU');
      });
      if(windowState?.codes?.some(code=>/ASSIGNMENT|MODEL|LINK/.test(code)))add('window-links','窓と部屋の対応','未割当の窓を部屋へ割り当て、3DSの窓との対応を確認してください。','窓','#atUnassignedBox');
      if(isAt&&typeof architrendWindowUReadiness==='function'&&!architrendWindowUReadiness().ready)add('window-u-links','窓のU値と形状の対応','仕様が異なる窓を、それぞれの3DS面へ割り当ててください。','窓','#atUnassignedBox');
    }
    const placed=typeof atPartAcUnits==='function'?atPartAcUnits():[],acNeeded=explicit?has('ac_supply')||has('ac_return'):placed.length>0||has('ac_supply')||has('ac_return');
    if(acNeeded&&typeof boundaryAcCalculationStatus==='function'){
      const ac=boundaryAcCalculationStatus(),fields={UA_MISSING:'uaVal',UA_REVIEW:'uaVal',ENVELOPE_AREA_MISSING:'envArea',WEATHER_MISSING:'tmax',TARGET_MISSING:'targetT',VENTILATION_RATE_MISSING:'ach',VOLUME_MISSING:'roomVol',HEAT_RECOVERY_INVALID:'hxRate',AC_NOT_PLACED:'acCount',FLOW_MISSING:'flowPerUnit',SUPPLY_TOO_LOW:'loadStats',INTERNAL_MISSING:'roomsWrap'};
      if(!ac)add('ac-calculation','エアコンの条件','負荷と風量を設定してください。','エアコン','#loadStats');
      else for(const error of ac.errors)add('ac:'+error.code,'エアコンの条件',error.message,'エアコン','#'+(fields[error.code]||'loadStats'));
    }
    if(uses(key=>key.startsWith('room:'))||!explicit&&(mesh?.rooms||[]).some(room=>room.keep)){
      const cards=[...document.querySelectorAll('.room-card')],names=new Set();
      cards.forEach((card,index)=>{
        const prefix='[id="'+card.id+'"]',name=card.querySelector('.roomName')?.value.trim();
        if(!name||names.has(name))add('room:'+index+':name','部屋'+(index+1)+'の名前','発熱を反映する部屋には、重複しない部屋名を付けてください。','部屋・発熱',prefix+' .roomName');names.add(name);
        const occ=number(card.querySelector('.occCount'));observe('room:'+index+':people','部屋'+(index+1)+'の在室人数',occ!==null&&occ>=0,'人数を0以上で指定してください。','部屋・発熱',prefix+' .occCount');
        if(occ>0)for(const [cls,label]of [['peopleSensRate','1人あたりの発熱'],['peopleMoistRate','1人あたりの発湿']]){const rate=number(card.querySelector('.'+cls));if(rate===null||rate<0)add('room:'+index+':'+cls,'部屋'+(index+1)+'の'+label,'0以上の値を指定してください。発生させない場合は0を入力します。','部屋・発熱',prefix+' .'+cls);}
        for(const [cls,label]of [['equipSensRate','機器・照明の発熱'],['equipMoistRate','機器・照明の発湿']]){const rate=number(card.querySelector('.'+cls));observe('room:'+index+':'+cls,'部屋'+(index+1)+'の'+label,rate!==null&&rate>=0,'0以上の値を指定してください。発生させない場合は0を入力します。','部屋・発熱',prefix+' .'+cls);}
        if(number(card.querySelector('.equipSensRate'))>0&&!(number(card.querySelector('.roomArea'))>0))add('room:'+index+':area','部屋'+(index+1)+'の床面積','機器・照明の発熱に使う床面積を入力してください。','部屋・発熱',prefix+' .roomArea');
      });
    }
    if(keys.length){
      check('initT','初期温度',value('initT')!==null&&value('initT')>=-273.15,'初期温度を入力してください。','解析設定');
      for(const [id,label]of [['initRH','初期湿度'],['comfHum','快適性計算の湿度']])check(id,label,value(id)!==null&&value(id)>=0&&value(id)<=100,'0〜100%で入力してください。','解析設定');
      positive('metSel','代謝量','解析設定');check('cloSel','着衣量',value('cloSel')!==null&&value('cloSel')>=0,'0以上で指定してください。','解析設定');
      if(windowNeeded)check('sslMatGlass','窓の材質',present('sslMatGlass'),'窓に使う材質を選んでください。','FDへ渡す');
      if(uses(key=>['innerwall','attic','doorbody'].includes(key)))check('sslMatWood','内壁・天井などの材質',present('sslMatWood'),'材質を選んでください。','FDへ渡す');
    }
    if(colors.length&&colors.some(color=>!assign[color.rgb]))add('fd-color-assignment','FDの色の割当','色ごとに反映する条件か「対象外」を選んでください。','FDへ渡す','#sslAssignWrap');
    if(isAt&&underlyingExportReadiness){
      const existing=underlyingExportReadiness('conditions'),covered=issues.some(issue=>/^(insulation:|model-review|floor-review|stair-review|source-review|window)/.test(issue.key));
      if(!existing.ready&&!covered)add('export-global','未確定の条件',existing.message||'読込資料と現在の条件を確認してください。','条件の確認','#atReview');
    }
    return {ready:!issues.some(issue=>issue.blocking),active:true,issues,checks};
  }
  function mark(report){
    document.querySelectorAll('[data-setup-required]').forEach(el=>{el.classList.remove('setup-required-field');el.removeAttribute('aria-invalid');el.removeAttribute('data-setup-required');});
    document.querySelectorAll('.setup-required-reason').forEach(el=>el.remove());
    if(!atMode()&&!manualScope()){document.querySelectorAll('[data-setup-legacy-hidden]').forEach(el=>{el.hidden=el.dataset.setupLegacyWasHidden==='true';delete el.dataset.setupLegacyHidden;delete el.dataset.setupLegacyWasHidden;});return;}
    document.querySelectorAll('.need-manual').forEach(el=>el.classList.remove('need-manual'));
    document.querySelectorAll('.tag-req').forEach(el=>{if(el.closest('#legendManual,#legendAt,#legendEp'))return;if(!el.dataset.setupLegacyHidden)el.dataset.setupLegacyWasHidden=String(el.hidden);el.hidden=true;el.dataset.setupLegacyHidden='true';});
    for(const issue of report.issues){
      let el;try{el=document.querySelector(issue.selector);}catch{continue;}
      if(!el||!el.matches('input,select,textarea'))continue;
      if(el.hasAttribute('data-setup-required'))continue;
      el.classList.add('setup-required-field');el.dataset.setupRequired='true';el.setAttribute('aria-invalid','true');
      const note=document.createElement('span');note.className='setup-required-reason';note.dataset.requiredReason=issue.key;note.textContent=issue.reason;el.insertAdjacentElement('afterend',note);
    }
  }
  function refresh(){
    if(refreshing)return lastReport;refreshing=true;
    try{
      lastReport=report();mark(lastReport);
      const host=$('requiredSetupGuide');if(host&&atMode()&&typeof window.boundaryRenderWorkflow==='function'){
        window.boundaryRenderWorkflow(lastReport);
      }else if(host){
        host.classList.remove('workflow-guide');
        const previous=host.querySelector('[data-required-more]');if(previous)moreOpen=previous.open;
        const list=(items,offset=0)=>'<ul class="setup-guide-list">'+items.map((issue,index)=>'<li><div><b>'+esc(issue.section)+' / '+esc(issue.label)+'</b><span>'+esc(issue.reason)+'</span></div><button type="button" data-required-action="'+(index+offset)+'">確認する</button></li>').join('')+'</ul>';
        const first=lastReport.issues.slice(0,4),remaining=lastReport.issues.slice(4);
        host.hidden=!lastReport.active;host.innerHTML=lastReport.active?'<div class="setup-guide-heading"><strong>'+(lastReport.ready?'必要な入力はそろっています':'確認・入力が必要な項目 '+lastReport.issues.length+'件')+'</strong><span>今回使う条件だけを表示しています。</span></div>'+(first.length?list(first)+(remaining.length?'<details data-required-more'+(moreOpen?' open':'')+'><summary>残り '+remaining.length+' 項目をすべて確認</summary>'+list(remaining,4)+'</details>':''):'<p>入力済みです。変更した断熱・小屋裏の条件は、反映済み表示も確認してください。</p>'):'';
      }
      const remain=$('atRemainInfo');if(remain&&!(atMode()&&window.boundaryRenderWorkflow)){remain.hidden=!atMode()||!lastReport.active;remain.style.display=atMode()&&lastReport.active?'':'none';remain.style.color=atMode()&&lastReport.active?(lastReport.ready?'#18704c':'#aa5b13'):'';remain.textContent=lastReport.active?(lastReport.ready?'必須入力OK':'必須 残'+lastReport.issues.length+'件'):'';}
      return lastReport;
    }finally{refreshing=false;}
  }
  function queue(){if(queued)return;queued=true;Promise.resolve().then(()=>{queued=false;refresh();});}
  window.boundaryRequiredReport=report;window.boundaryRefreshRequiredGuide=refresh;
  const oldManual=typeof refreshNeedManual==='function'?refreshNeedManual:null;
  refreshNeedManual=function(){if(!atMode()){const result=oldManual?.();refresh();return result;}if(typeof refreshArchitrendEnvelopeHints==='function')refreshArchitrendEnvelopeHints();return refresh();};
  if(typeof runAll==='function'){const original=runAll;runAll=function(){const result=original.apply(this,arguments);refresh();return result;};}
  // FileReader completion and automatic color assignment happen after change.
  if(typeof renderSslAssign==='function'){const original=renderSslAssign;renderSslAssign=function(){const result=original.apply(this,arguments);queue();return result;};}
  if(underlyingExportReadiness){window.boundaryExportReadiness=function(kind){const existing=underlyingExportReadiness.apply(this,arguments);if(!existing.ready||kind!=='conditions')return existing;const state=report(),blocked=state.issues.filter(issue=>issue.blocking);return blocked.length?{ready:false,message:'必要な入力を確認してください：'+blocked.map(issue=>issue.label).join('、'),codes:blocked.map(issue=>issue.key)}:existing;};}
  document.addEventListener('input',queue);document.addEventListener('change',queue);
  for(const event of ['architrend-data-ready','architrend-input-applied','architrend-model-ready','architrend-import-invalidated','architrend-model-invalidated','architrend-thermal-changed','architrend-room-mapping-changed'])window.addEventListener(event,queue);
  document.addEventListener('click',event=>{const button=event.target.closest?.('[data-required-action]');if(!button)return;const issue=lastReport.issues[Number(button.dataset.requiredAction)];if(!issue)return;if(issue.target&&typeof window.boundaryOpenInsulation==='function'){window.boundaryOpenInsulation(issue.target);return;}if(issue.target&&typeof architrendShowThermal==='function'){architrendShowThermal(issue.target);return;}const el=document.querySelector(issue.selector);if(!el)return;for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;el.scrollIntoView({behavior:'smooth',block:'center'});el.focus?.({preventScroll:true});});
  refresh();
})();

// Beginner controls for the local single-node estimate; all data stays in memory.
(function(){
  'use strict';
  const M=window.BoundaryAtticModel,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let options={},context=null,lastApplied='',manualOverride=false,draftDirty=false,sharedRoofU=null,sharedRoofOrigin='';
  let lastClimateEventKey='';
  let memoData=null,memoMesh=null;const memo=new Map();
  const value=id=>document.getElementById(id)?.value??'';
  const number=id=>value(id).trim()!==''&&Number.isFinite(Number(value(id)))?Number(value(id)):null;
  const climateIds=['calcDate','detailHour','lat','lon','tmax','tmin','tpeak','targetT','alpha','ho','rho','roofCorr','uRoof'];
  function climate(){
    const raw=climateIds.map(id=>value(id)),date=value('calcDate').match(/^(\d{4})-(\d{2})-(\d{2})$/),geo=typeof readLatLon==='function'?readLatLon():{ok:false};
    if(!date||!geo.ok||['detailHour','tmax','tmin','tpeak','targetT','alpha','ho','rho','roofCorr'].some(id=>number(id)===null)||typeof solarPos!=='function'||typeof taAt!=='function')return null;
    const hour=number('detailHour');if(hour<0||hour>24||number('tmax')<number('tmin')||number('tpeak')<0||number('tpeak')>24)return null;
    const sun=solarPos(+date[1],+date[2],+date[3],hour,geo.lat,geo.lon),direct=sun.alt>0?1098*Math.exp(-.057/Math.sin(sun.alt)):0;
    // Tool azimuth is south=0, east negative. Geometry is x=east,y=north.
    const north=typeof atNorthDeg==='function'?atNorthDeg()*Math.PI/180:0;
    const sx=-Math.cos(sun.alt)*Math.sin(sun.az),sy=-Math.cos(sun.alt)*Math.cos(sun.az);
    return {outdoor:taAt(hour,number('tmax'),number('tmin'),number('tpeak')),indoor:number('targetT'),alpha:number('alpha'),ho:number('ho'),rho:number('rho'),correction:number('roofCorr'),
      sunX:sx*Math.cos(north)+sy*Math.sin(north),sunY:-sx*Math.sin(north)+sy*Math.cos(north),sunZ:Math.max(0,sun.sinAlt),direct,diffuse:.125*direct,raw};
  }
  const currentData=()=>typeof atLastParse!=='undefined'?atLastParse?.result:null;
  const currentMesh=()=>typeof atMesh!=='undefined'?atMesh:null;
  function withActiveU(data){
    const explicit=window.boundaryThermalSummary?.('roof');
    if(explicit?.ready&&explicit.settings?.length===1)return {...data,activeRoofU:explicit.settings[0].u};
    const u=number('uRoof'),fromForm=u>0&&(sharedRoofU===null||u!==sharedRoofU||sharedRoofOrigin==='common');
    return fromForm&&M.specs(data,'屋根').length<=1?{...data,activeRoofU:u}:data;
  }
  function evaluate(opts){
    const data=currentData(),mesh=currentMesh(),c=climate();
    if(memoData!==data||memoMesh!==mesh){memo.clear();memoData=data;memoMesh=mesh;}
    const key=JSON.stringify([opts,c]);if(!memo.has(key)){if(memo.size>20)memo.clear();memo.set(key,M.estimate(withActiveU(data),mesh,opts,c));}return memo.get(key);
  }
  const option=(v,label,current)=>'<option value="'+esc(v)+'"'+(String(current??'')===String(v)?' selected':'')+'>'+esc(label)+'</option>';
  function uField(part,data){
    const imported=M.specs(data,part==='roof'?'屋根':'天井'),label=part==='roof'?'屋根':'天井';
    if(imported.length===1&&imported[0].u>0){options[part+'Spec']=imported[0].id;return '<div class="at-attic-imported"><b>'+label+'のU相当値：'+imported[0].u.toFixed(3)+' W/m²K</b><span>'+ (part==='roof'&&data?.activeRoofU>0?'共通の断熱設定「屋根U」を使用。':imported[0].source==='pdf'?'PDFの熱貫流率の欄から取得しました。':'読込データを使用（熱損失÷面積の概算）。温度差係数込みの場合は仕様書のU値を確認してください。')+' 詳細設定で修正できます。</span></div>';}
    const choices=imported.map(s=>s.u>0?option(s.id,s.label+' / U='+s.u.toFixed(3),options[part+'Spec']):'<option disabled>'+esc(s.label)+' / U値未取得</option>').join('');
    const insulated=(part==='roof'?options.insulation==='roof':options.insulation==='ceiling');
    const bare=insulated?'':option('bare','断熱なしを仮定（U=4.0）',options[part+'Spec']);
    const p=M.presets[part];
    return '<label>'+label+'の性能'+(imported.length>1?'（複数仕様から選択）':'（読込データにU値なし）')+'<select data-attic-key="'+part+'Spec">'+option('','選んでください',options[part+'Spec'])+choices+bare+
      (insulated?['light','medium','high'].map((k,i)=>option(k,['熱を通しやすめ','中程度の断熱','熱を通しにくめ'][i]+'を仮定（U='+p[k]+'）',options[part+'Spec'])).join(''):'')+option('manual','仕様書のU値を入力する',options[part+'Spec'])+'</select></label>'+
      '<label data-attic-manual="'+part+'" '+(options[part+'Spec']==='manual'?'':'hidden')+'>'+label+'のU値（W/m²K）<input data-attic-key="'+part+'U" type="number" min="0" max="20" step="any" value="'+esc(options[part+'U'])+'"></label>'+(imported.length>1?'<p class="small">複数の'+label+'仕様があります。この概算では、選んだU値を対象全体に使います。平均化・自動統合はしません。仕様ごとに分ける必要がある場合は詳細な熱モデルを使ってください。</p>':'');
  }
  function diagram(){return '<svg class="at-attic-diagram" viewBox="0 0 460 200" role="img" aria-label="天井断熱は部屋の天井に、屋根断熱は屋根の斜面に断熱材があります。"><path d="M35 90 125 20 215 90M55 76v95h140V76M55 98h140" fill="#f0f5ed" stroke="#557963" stroke-width="3"/><path d="M55 98h140" stroke="'+(options.insulation==='ceiling'?'#db6636':'#abc1ac')+'" stroke-width="8"/><text x="125" y="147" text-anchor="middle">部屋</text><text x="125" y="79" text-anchor="middle">小屋裏</text><path d="M245 90 335 20 425 90M265 76v95h140V76M265 98h140" fill="#f0f5ed" stroke="#557963" stroke-width="3"/><path d="m245 90 90-70 90 70" fill="none" stroke="'+(options.insulation==='roof'?'#db6636':'#abc1ac')+'" stroke-width="8"/><text x="335" y="147" text-anchor="middle">部屋</text><text x="335" y="79" text-anchor="middle">小屋裏</text><text x="125" y="195" text-anchor="middle">天井断熱</text><text x="335" y="195" text-anchor="middle">屋根断熱</text></svg>';}
  function html(section,data,mesh,manualControls){
    context={section,data,mesh};data=withActiveU(data);
    const g=M.geometry(mesh),c=climate(),evidence=M.insulationEvidence(data);
    if(options.insulation===undefined&&evidence)options.insulation=evidence;
    const sourceNotice=evidence==='ceiling'?'<p class="at-thermal-notice"><b>読込資料には「小屋裏に接する天井」の性能があり、天井断熱が候補です。</b> 天井のU値と、屋根そのもののU値は別です。天井断熱では、外皮計算に屋根U値が記載されない場合があります。'+(options.insulation==='roof'?' 今は「屋根断熱」を選んでいます。図面の断熱材の位置をもう一度確認してください。':' 図面でも天井の上に断熱材があることを確認してください。')+' 屋根の性能が不明なら、この概算に使う仮定を下で選びます。天井の取得値はそのまま使います。</p>':evidence==='roof'?'<p class="at-thermal-notice">読込資料の屋根性能から「屋根断熱」を候補にしました。図面の断熱材の位置を確認してください。</p>':'';
    return '<div class="at-attic-estimator" data-attic-form><h4>小屋裏温度は、条件から概算できます。</h4><p>温度の正解を入力する必要はありません。断熱位置を選び、取得できなかった条件だけ補います。</p>'+diagram()+
      '<label>① 断熱材は、どこにありますか？<select data-attic-key="insulation">'+option('','図面を見て選んでください',options.insulation)+option('ceiling','天井断熱：部屋の天井の上に断熱材がある',options.insulation)+option('roof','屋根断熱：屋根の斜面に断熱材がある',options.insulation)+'</select></label>'+sourceNotice+
      '<div class="at-attic-source"><b>読み込んだデータ・共通条件を使用</b><p>対象天井 '+g.ceilingArea.toFixed(2)+' m² ／ 対応する屋根 '+g.roofArea.toFixed(2)+' m² ／ 小屋裏容積 '+g.volume.toFixed(2)+' m³（3DS形状から）</p><p>'+(c?'解析時刻の外気 '+c.outdoor.toFixed(1)+'℃ ／ 目標室温 '+c.indoor.toFixed(1)+'℃ ／ 晴天日射・吸収率・放射補正を使用':'日時・場所・外気温・目標室温は、下の「日時・気象」で設定してください。')+'</p><p>階間の天井 '+g.inside.length+'面を除外。判定できない天井 '+g.uncertain.length+'面。</p></div>'+
      '<div class="at-attic-grid">'+uField('roof',data)+uField('ceiling',data)+
      '<label>② 小屋裏の外気との入れ替わり<select data-attic-key="vent">'+option('','換気の想定を選んでください',options.vent)+option('0','換気なしを仮定（0回/h）',options.vent)+option('0.5','少なめの入れ替わりを仮定（0.5回/h）',options.vent)+option('5','多めの入れ替わりを仮定（5回/h）',options.vent)+option('flow','換気量が分かる：m³/hで入力',options.vent)+'</select></label><label data-attic-manual="flow" '+(options.vent==='flow'?'':'hidden')+'>換気量（m³/h）<input data-attic-key="flow" type="number" min="0" step="any" value="'+esc(options.flow)+'"></label></div>'+
      '<p class="at-thermal-notice">選択肢のU値・換気回数は比較用の仮定で、実際の建物仕様や換気口からの自動判定ではありません。'+(options.insulation==='roof'?'屋根断熱でも天井自体の性能を使います。屋根U値を天井へコピーしません。':'')+' 部屋と空気がつながる小屋裏・別々に区切られた小屋裏は、この一室の概算では扱いません。</p>'+
      '<label class="at-thermal-confirm"><input type="checkbox" data-attic-key="confirmed" '+(options.confirmed?'checked':'')+'>断熱位置と仮定条件を確認しました。対象は部屋と空気がつながらない、ひと続きの小屋裏です。</label>'+
      '<div data-attic-preview role="status"></div><div class="boundary-action-bar" data-boundary-action="attic"><p class="boundary-action-status" data-attic-action-status role="status"></p><button type="button" data-attic-apply>天井 '+section.faces.length+'面へ概算条件を反映する</button></div><p class="small">屋根のU値は、共通の屋根条件にも共用します。面ごとに屋根仕様を分けている場合は、その設定を維持します。小屋裏温度は屋根・天井・換気の定常的な熱収支による概算です。蓄熱・妻壁からの熱・詳細な放射・温度むらは計算しません。</p>'+
      '<details class="at-thermal-details" data-thermal-detail="attic-advanced"><summary>詳細設定：取得値を補う・小屋裏温度を直接指定する</summary><label>小屋裏容積を補う（m³、空欄なら3DSから取得）<input data-attic-key="volume" type="number" min="0" step="any" value="'+esc(options.volume)+'" placeholder="'+g.volume.toFixed(2)+'"></label>'+['roof','ceiling'].map(k=>'<label>'+ (k==='roof'?'屋根':'天井')+'のU値を仕様書の値で上書き（W/m²K、空欄なら取得値）<input data-attic-key="'+k+'UOverride" type="number" min="0" step="any" value="'+esc(options[k+'UOverride'])+'"></label>').join('')+'<p>以下は測定値・別の解析結果など、温度が分かっている場合に使います。概算した温度とは別の指定になります。</p><div data-attic-manual-controls>'+manualControls+'</div></details></div>';
  }
  const messages={MODEL:'3DSの単位・階数・床の確認を先に完了してください。',INSULATION:'断熱材の位置を選んでください。',ROOF_U:'屋根の性能を選んでください。',CEILING_U:'天井の性能を選んでください。',CEILING_GEOMETRY:'天井が階間か小屋裏側かを確定できません。形状を確認してください。',ROOF_GEOMETRY:'屋根と天井の範囲を対応できません。屋根を含む3DSを確認してください。',CLIMATE:'下の「日時・気象」の日時・場所・気温・目標室温を設定してください。',VOLUME:'容積を上書きする場合は、0より大きいm³の数値を入力してください。',VENTILATION:'換気の想定を選び、必要なら風量を入力してください。',VENTILATION_VOLUME:'換気回数は選択済みです。小屋裏容積を取得できないため、形状を確認するか詳細設定で容積を補ってください。',CONFIRM:'断熱位置と仮定条件の確認チェックを入れてください。',NUMERIC:'条件を確認してください。有限の結果を計算できません。'};
  function requiredInputs(){
    if(!context)return [];
    const result=evaluate(options),keys={INSULATION:'insulation',ROOF_U:options.roofUOverride!==undefined&&options.roofUOverride!==''?'roofUOverride':options.roofSpec==='manual'?'roofU':'roofSpec',CEILING_U:options.ceilingUOverride!==undefined&&options.ceilingUOverride!==''?'ceilingUOverride':options.ceilingSpec==='manual'?'ceilingU':'ceilingSpec',VENTILATION:options.vent==='flow'?'flow':'vent',VENTILATION_VOLUME:'volume',VOLUME:'volume',CONFIRM:'confirmed'};
    return (result.codes||[]).filter(code=>keys[code]).map(code=>({selector:'[data-attic-key="'+keys[code]+'"]',reason:messages[code],key:'attic:'+code}));
  }
  function preview(host){
    const box=host.querySelector('[data-attic-preview]'),button=host.querySelector('[data-attic-apply]');if(!box)return;
    const result=evaluate(options);button.disabled=!result.ready;
    const status=host.querySelector('[data-attic-action-status]');if(status){const applied=result.ready&&result.fingerprint===lastApplied&&!draftDirty&&!manualOverride,roof=window.boundaryThermalSummary?.('roof');status.dataset.state=applied?'applied':'pending';status.textContent=applied?'反映済み：天井 '+context.section.faces.length+'面 ／ U='+result.ceilingU.toFixed(3)+' W/m²K ／ 小屋裏 '+result.temperature.toFixed(1)+'℃。'+(!roof||roof.missing?'共通の屋根U='+result.roofU.toFixed(3)+' W/m²Kも反映しました。':'屋根は面ごとの設定を維持しています。'):result.ready?'概算はまだ反映していません。対象の天井と条件を確認して反映してください。':'未反映：上の確認項目を解決すると反映できます。';}
    box.innerHTML=result.ready?'<div class="at-attic-result"><b>小屋裏の等価温度（概算） '+result.temperature.toFixed(1)+' ℃</b><p>計算に使用：屋根U '+result.roofU.toFixed(3)+' ／ 天井U '+result.ceilingU.toFixed(3)+' W/m²K ／ 換気 '+result.flow.toFixed(1)+' m³/h ／ 容積 '+result.volume.toFixed(2)+' m³</p><p>天井から部屋へ '+result.heat.toFixed(0)+' W（負なら部屋から小屋裏へ）</p><p>換気の仮定を0～5回/hに変えると '+Math.min(...result.sensitivity.map(s=>s.temperature)).toFixed(1)+'～'+Math.max(...result.sensitivity.map(s=>s.temperature)).toFixed(1)+'℃</p><p>'+(result.fingerprint===lastApplied?'この概算条件を反映済みです。':manualOverride?'詳細設定で温度を直接指定した面があります。概算を反映すると対象全体を置き換えます。':'まだ反映していません。下のボタンで反映します。')+'</p></div>':'<ul>'+result.codes.map(code=>'<li>'+esc(messages[code]||code)+'</li>').join('')+'</ul>';
  }
  function readForm(host){host.querySelectorAll('[data-attic-key]').forEach(el=>{options[el.dataset.atticKey]=el.type==='checkbox'?el.checked:el.value;});}
  function bind(host){
    const form=host.querySelector('[data-attic-form]');if(!form)return;
    form.oninput=event=>{if(!event.target.matches('[data-attic-key]'))return;draftDirty=true;readForm(form);preview(form);if(typeof refreshArchitrendEnvelopeHints==='function')refreshArchitrendEnvelopeHints();};
    form.onchange=event=>{
      if(!event.target.matches('[data-attic-key]'))return;draftDirty=true;readForm(form);
      if(event.target.dataset.atticKey==='insulation'){
        ['roof','ceiling'].forEach(part=>{
          const key=part+'Spec',insulated=part===options.insulation;
          if(insulated&&options[key]==='bare'||!insulated&&['light','medium','high'].includes(options[key]))options[key]='';
        });window.boundaryThermalRender();return;
      }
      ['roof','ceiling','flow'].forEach(key=>{const el=form.querySelector('[data-attic-manual="'+key+'"]');if(el)el.hidden=(key==='flow'?options.vent!=='flow':options[key+'Spec']!=='manual');});preview(form);
    };
    form.querySelector('[data-attic-apply]').onclick=()=>{
      readForm(form);let result=evaluate(options);if(!result.ready){preview(form);return;}
      const roof=window.boundaryThermalSummary?.('roof'),input=document.getElementById('uRoof');
      if(input&&(!roof||roof.missing)){
        const previous={value:input.value,u:sharedRoofU,origin:sharedRoofOrigin};
        const current=number('uRoof'),manual=current>0&&(sharedRoofU===null||current!==sharedRoofU||sharedRoofOrigin==='common');
        sharedRoofU=result.roofU;sharedRoofOrigin=manual&&!options.roofUOverride?'common':'options';input.value=String(result.roofU);
        memo.clear();result=evaluate(options);if(!result.ready){input.value=previous.value;sharedRoofU=previous.u;sharedRoofOrigin=previous.origin;memo.clear();preview(form);return;}
      }
      lastApplied=result.fingerprint;manualOverride=false;draftDirty=false;
      window.boundaryThermalAssignAll('ceiling',{groupId:'__manual',u:result.ceilingU,temperature:result.temperature,confirmed:true,attic:{options:{...options},fingerprint:result.fingerprint}});
      if(typeof runAll==='function')runAll();
    };
    preview(form);
  }
  window.boundaryAttic={html,bind,classify:M.classify,requiredInputs,hasPendingDraft(){return draftDirty;},exportState(){return {options:{...options},lastApplied,manualOverride,draftDirty,sharedRoofU,sharedRoofOrigin};},restoreState(s){options={...(s?.options||{})};lastApplied=s?.lastApplied||'';manualOverride=!!s?.manualOverride;draftDirty=!!s?.draftDirty;sharedRoofU=s?.sharedRoofU??null;sharedRoofOrigin=s?.sharedRoofOrigin||'';memo.clear();},manualOverride(){lastApplied='';manualOverride=true;draftDirty=false;},reset(){options={};context=null;lastApplied='';manualOverride=false;draftDirty=false;sharedRoofU=null;sharedRoofOrigin='';memo.clear();},isFresh(meta){const r=meta&&evaluate(meta.options);return !!r&&r.fingerprint===meta.fingerprint&&r.ready;}};
  function commonChanged(event){
    if(!climateIds.includes(event.target.id)||!context)return;
    const key=JSON.stringify(climateIds.map(id=>value(id)));if(key===lastClimateEventKey)return;
    lastClimateEventKey=key;window.boundaryThermalClimateChanged?.();
  }
  document.addEventListener('input',commonChanged);
  document.addEventListener('change',commonChanged);
})();

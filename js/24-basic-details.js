/* Progressive disclosure only: the existing controls, values and calculation stay intact. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const format=new Intl.NumberFormat('ja-JP',{maximumSignificantDigits:8});
  let queued=false;
  const finite=n=>n!==null&&Number.isFinite(n),positive=n=>finite(n)&&n>0,ratio=n=>finite(n)&&n>=0&&n<=1;
  const definitions={
    common:[['#alpha','壁・屋根の日射吸収率','',ratio],['#ho','壁・屋根の熱伝達率',' W/m²K',positive],['#rho','地面の反射率','',ratio],['#roofCorr','屋根の放射補正',' ℃',finite],['#solarFc','窓日射の対流成分比','',ratio],['#initT','計算開始時の温度',' ℃',n=>finite(n)&&n>=-273.15],['#initRH','計算開始時の湿度',' %',n=>finite(n)&&n>=0&&n<=100]],
    window:[['#hiWin','窓の内表面熱伝達率',' W/m²K',positive],['#hoWin','窓の外表面熱伝達率',' W/m²K',positive],['#lamWin','CFD材質の熱伝導率',' W/mK',positive]],
    room:[['.peopleSensRate','1人あたりの発熱',' W/人',n=>finite(n)&&n>=0],['.peopleMoistRate','1人あたりの発湿',' g/h/人',n=>finite(n)&&n>=0],['.equipSensRate','家電・照明の発熱',' W/m²',n=>finite(n)&&n>=0],['.equipMoistRate','家電などの発湿',' g/h/m²',n=>finite(n)&&n>=0],['.extraSens','追加の発熱',' W',finite],['.extraMoist','追加の発湿',' g/h',finite]],
    ac:[['#acMax','最大冷房能力',' kW',positive]]
  };
  function number(el){return el&&String(el.value).trim()!==''&&Number.isFinite(Number(el.value))?Number(el.value):null;}
  function fields(kind,root){
    return definitions[kind].map(([selector,label,unit,valid])=>{
      const el=root.querySelector(selector),n=number(el),optional=kind==='ac'||kind==='room'&&/^\.extra/.test(selector),unused=kind==='room'&&/^\.people/.test(selector)&&number(root.querySelector('.occCount'))===0;
      const initial=el?.defaultValue,initialNumber=initial!==''&&initial!==undefined&&Number.isFinite(Number(initial))?Number(initial):null;
      const blankOptional=optional&&n===null;
      const ok=unused||blankOptional||valid(n),tag=!ok?'要確認':unused?'人数0のため不使用':blankOptional?'未指定':n===initialNumber?'初期値のまま':'初期値と異なる';
      const text=blankOptional?(kind==='ac'?'未指定（能力判定なし）':'未入力（0として集計）'):n===null?'未入力':format.format(n)+unit;
      return {selector,label,text,tag,ok,el,changed:ok&&!unused&&!blankOptional&&n!==initialNumber};
    });
  }
  function notes(kind){
    if(kind==='common'){
      const message=$('commonSolarInfo')?.textContent||'';
      return message.includes('SATは SQL')?'日射と相当外気温度には、SQLの入射日射とETDを使用しています。':'最高・最低気温から外気温を求め、日射は晴天モデルで概算します。日時・場所・気温が未入力の間は、結果を確定できません。';
    }
    if(kind==='window')return '窓のU値からCFD用の仮の厚みを求めます。実際のガラス厚ではありません。日射の入りやすさ（η0）は部屋ごとの窓で設定します。';
    if(kind==='room')return 'ここに表示した原単位を人数・床面積に掛け、追加の負荷を足して集計します。窓からの日射は別に計算します。';
    const mode=$('ventMode')?.value,vent=mode==='none'?'換気負荷は除外中':mode==='first'?'第一種換気・熱交換あり':'第三種換気・熱交換なし';
    return '顕熱の収支から全台共通の吹出温度を概算。除湿計算は行わず、吹出湿度は95%RH固定です。'+vent+'。風量から熱量への換算係数は '+(typeof RHOCP!=='undefined'?format.format(RHOCP):'未取得')+' W/(m³/h・K) です。';
  }
  function refresh(){
    const report=window.boundaryRequiredReport?.(),issues=report?.issues||[];
    for(const host of document.querySelectorAll('[data-assumptions]')){
      const kind=host.dataset.assumptions;if(!definitions[kind])continue;
      const root=kind==='room'?host.closest('.room-card'):document,detail=host.nextElementSibling;
      const items=fields(kind,root),problems=items.filter(f=>!f.ok);
      const related=detail?.matches('[data-basic-detail]')?issues.filter(issue=>{try{return detail.contains(document.querySelector(issue.selector));}catch{return false;}}):[];
      const count=Math.max(problems.length,related.length),changed=items.some(f=>f.changed);
      host.dataset.assumptionState=count?'review':changed?'adjusted':'initial';
      host.dataset.assumptionIssues=String(count);
      const html='<div class="setting-assumptions-heading"><b>'+(kind==='room'?'使用中の値':'現在の計算条件')+'</b><span class="setting-assumption-state">'+(count?'詳細に要確認 '+count+' 項目':changed?'調整した値を使用中':'現在の値を使用中')+'</span></div><dl>'+items.map(f=>'<div data-assumption-field="'+esc(f.selector)+'"'+(!f.ok?' class="setting-value-review"':'')+'><dt>'+esc(f.label)+'</dt><dd><strong>'+esc(f.text)+'</strong><span>'+esc(f.tag)+'</span></dd></div>').join('')+'</dl><p class="setting-assumptions-note">'+esc(notes(kind))+'</p>'+(count?'<button type="button" data-open-basic-detail>要確認の詳細設定を開く</button>':'')+'<p class="setting-initial-note">「初期値」はツールの開始時の値です。資料や今回の解析条件に合うか確認してください。</p>';
      // Keep focus, disclosure state, and the user's scroll position untouched.
      if(host.innerHTML!==html)host.innerHTML=html;
      if(detail?.matches('[data-basic-detail]')){
        const summary=detail.querySelector(':scope > summary');let badge=summary?.querySelector('[data-detail-review]');
        if(count&&!badge&&summary){badge=document.createElement('span');badge.dataset.detailReview='';summary.append(badge);}
        if(badge){badge.hidden=!count;badge.textContent='要確認 '+count;}
      }
    }
  }
  function queue(){if(queued)return;queued=true;Promise.resolve().then(()=>{queued=false;refresh();});}
  window.boundaryRefreshBasicDetails=refresh;
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-open-basic-detail]');if(!button)return;
    const host=button.closest('[data-assumptions]'),detail=host?.nextElementSibling;if(!detail?.matches('[data-basic-detail]'))return;
    detail.open=true;
    const root=host.dataset.assumptions==='room'?host.closest('.room-card'):document;
    const invalid=fields(host.dataset.assumptions,root).find(f=>!f.ok)?.el;
    const target=invalid||detail.querySelector('[aria-invalid="true"],input,select');
    if(target){target.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});target.focus({preventScroll:true});}
  });
  document.addEventListener('input',queue);document.addEventListener('change',queue);
  for(const name of ['architrend-data-ready','architrend-input-applied','architrend-model-ready','architrend-import-invalidated','architrend-thermal-changed','architrend-room-mapping-changed'])window.addEventListener(name,queue);
  const run=runAll;runAll=function(){const result=run.apply(this,arguments);refresh();return result;};
  refresh();
})();

/* A compact view of the existing room controls and calculated results. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id),wrap=$('roomsWrap'),format=new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1});
  if(!wrap)return;
  const set=(el,value)=>{if(el&&el.textContent!==value)el.textContent=value;};
  const number=el=>el&&el.value.trim()!==''&&Number.isFinite(Number(el.value))?Number(el.value):null;
  const intro=wrap.parentElement.querySelector(':scope > .box');
  function disclosure(id,label){const d=document.createElement('details');d.id=id;d.dataset.gainsDisclosure='';d.className='gain-explanation';const summary=document.createElement('summary');summary.textContent=label;d.append(summary);return d;}
  const solar=disclosure('gainSolarDetails','日射の計算条件・連携データを確認');if(intro){intro.before(solar);solar.append(intro);}
  const totals=document.createElement('div');totals.className='gain-totals';totals.id='gainTotals';totals.innerHTML='<span>発熱合計 <strong data-gain-heat>—</strong> W <small>顕熱</small></span><span>発湿合計 <strong data-gain-moisture>—</strong> g/h</span>';
  const toolbar=document.createElement('div');toolbar.className='gain-toolbar';toolbar.innerHTML='<div><h2>部屋ごとの設定 <span class="gain-room-count"><b data-gain-count>0</b> 室</span></h2><p>部屋を開き、人数・面積を確認します。入力は自動で計算に使われます。</p></div><button type="button" data-gain-collapse>すべて閉じる</button>';
  const status=document.createElement('p');status.id='gainRoomStatus';status.className='gain-room-status';status.setAttribute('role','status');wrap.before(totals,toolbar,status);
  const solarNotice=disclosure('gainSolarNotice','日射は0 Wです（理由を見る）');solarNotice.className='gain-solar-notice';const solarReason=document.createElement('p');solarNotice.append(solarReason);totals.after(solarNotice);
  const breakdown=disclosure('gainBreakdown','全部屋の計算内訳・グラフを確認');
  const grand=$('grandTotalWrap'),chart=$('roomChart').closest('.box'),table=$('roomTableWrap'),nodes=[grand.previousElementSibling,grand,chart.previousElementSibling,chart,table];
  nodes[0].before(breakdown);nodes.forEach(el=>breakdown.append(el));breakdown.after(solar);
  const add=wrap.nextElementSibling;if(add?.tagName==='BUTTON'){add.classList.add('gain-add-room');add.type='button';}
  // Existing errors remain the authority. Basic field checks also identify incomplete
  // manual rooms before an FD color CSV has activated the export validation.
  function problems(card,report,names){
    const fields=new Set();
    for(const issue of report.issues||[]){try{const el=document.querySelector(issue.selector);if(el&&card.contains(el))fields.add(el);}catch{}}
    if(!report.active){
      const check=(selector,valid)=>{const el=card.querySelector(selector);if(el&&!valid(number(el)))fields.add(el);};
      const name=card.querySelector('.roomName');if(!name.value.trim()||names.filter(n=>n===name.value.trim()).length>1)fields.add(name);
      check('.occCount',n=>n!==null&&n>=0);
      if(number(card.querySelector('.occCount'))>0)for(const c of ['peopleSensRate','peopleMoistRate'])check('.'+c,n=>n!==null&&n>=0);
      for(const c of ['equipSensRate','equipMoistRate'])check('.'+c,n=>n!==null&&n>=0);
      if(number(card.querySelector('.equipSensRate'))>0)check('.roomArea',n=>n!==null&&n>0);
      card.querySelectorAll('.win-row').forEach(row=>{for(const [cls,valid]of [['wEta',n=>n!==null&&n>=0&&n<=1],['wArea',n=>n!==null&&n>0],['wAz',n=>n!==null]]){const el=row.querySelector('.'+cls);if(!valid(number(el)))fields.add(el);}});
    }
    return [...fields];
  }
  function refresh(){
    const cards=[...wrap.querySelectorAll('.room-card')],report=window.boundaryRequiredReport?.()||{},result=window.boundaryRoomGainResults,rows=new Map((result?.rooms||[]).map(r=>[r.roomId,r])),names=cards.map(c=>c.querySelector('.roomName').value.trim());let reviews=0;
    wrap.querySelectorAll('[data-gain-input-review]').forEach(el=>{delete el.dataset.gainInputReview;if(!el.hasAttribute('data-setup-required'))el.removeAttribute('aria-invalid');});
    for(const card of cards){
      const row=rows.get(card.id),issues=problems(card,report,names),windows=card.querySelectorAll('.win-row').length,occ=number(card.querySelector('.occCount')),area=number(card.querySelector('.roomArea'));
      if(issues.length)reviews++;
      if(!report.active)issues.forEach(el=>{el.dataset.gainInputReview='';el.setAttribute('aria-invalid','true');});
      const name=card.querySelector('.roomName').value.trim()||'部屋名を入力してください',badge=card.querySelector('[data-gain-state]');
      set(card.querySelector('[data-gain-name]'),name);set(badge,issues.length?'要確認 '+issues.length:'');badge.hidden=!issues.length;card.dataset.gainReview=String(issues.length>0);
      set(card.querySelector('[data-gain-meta]'),(card.dataset.nonHabitable==='true'?'窓日射のみ':(occ===null?'人数未入力':format.format(occ)+' 人'))+' ／ '+(area===null?'面積未入力':format.format(area)+' m²')+' ／ 窓 '+windows+' 枚');
      set(card.querySelector('[data-gain-total]'),issues.length?'入力を確認してください':row?'発熱 '+format.format(row.totalSens)+' W ／ 発湿 '+format.format(row.totalMoist)+' g/h':'—');
      const winIssues=issues.filter(el=>el.closest('.win-row')).length;set(card.querySelector('[data-gain-windows]'),'（'+windows+' 枚'+(winIssues?'・要確認 '+winIssues:'')+'）');
      card.querySelector('.gain-windows').dataset.review=String(winIssues>0);
    }
    const ready=cards.length&&reviews===0;
    set(status,!cards.length?'部屋がありません。「部屋を追加」するか、データを読み込んでください。':reviews?cards.length+' 室のうち '+reviews+' 室に要確認の項目があります。部屋名を押して開いてください。':'全 '+cards.length+' 室の入力を使用中。想定した人数・使い方か確認してください。');
    status.dataset.review=String(reviews>0);totals.dataset.review=String(!ready);set(toolbar.querySelector('[data-gain-count]'),String(cards.length));
    set(totals.querySelector('[data-gain-heat]'),ready&&result?format.format(result.grand.totalSens):'—');set(totals.querySelector('[data-gain-moisture]'),ready&&result?format.format(result.grand.totalMoist):'—');
    const reason=grand.querySelector('.warn')?.textContent||'';solarNotice.hidden=!reason;set(solarReason,reason);
  }
  let queued=false;function queue(){if(!queued){queued=true;queueMicrotask(()=>{queued=false;refresh();});}}
  document.addEventListener('click',e=>{if(e.target.closest('[data-gain-collapse]')){wrap.querySelectorAll('.gain-room-editor').forEach(d=>d.open=false);saveStateDebounced();}});
  document.addEventListener('toggle',e=>{if(!e.target.matches('[data-gains-disclosure]'))return;if(e.target===breakdown&&breakdown.open&&typeof roomChart!=='undefined')roomChart?.resize();saveStateDebounced();},true);
  document.addEventListener('input',queue);document.addEventListener('change',queue);
  new MutationObserver(queue).observe(wrap,{childList:true});
  const run=runAll;runAll=function(){const result=run.apply(this,arguments);refresh();return result;};
  const required=window.boundaryRefreshRequiredGuide;window.boundaryRefreshRequiredGuide=function(){const result=required?.apply(this,arguments);queue();return result;};
  window.boundaryRefreshGains=refresh;refresh();
})();

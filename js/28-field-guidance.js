/* Presentation only. Existing input IDs, values, validation and saves stay authoritative. */
(function(){
  'use strict';
  const controls='input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]),select,textarea';
  const optional=new Set(['siteAddress','acMax']);
  const initial=new Set(['alpha','ho','rho','roofCorr','solarFc','initT','initRH','hiWin','hoWin','lamWin']);
  const states={
    complete:['入力済み','値が入力されています。変更した値の反映・確定は、各画面の案内に沿って行ってください。'],
    required:['要入力','今回の条件で必要な設定です。下の案内に沿って入力・選択してください。'],
    manual:['入力・確認','ここは自分で入力・選択できます。今回の解析条件に合う値を確認してください。'],
    imported:['取得済み・変更可','資料やモデルから値を取得しました。確認し、必要な場合だけ変更してください。'],
    auto:['自動計算','ほかの設定から自動で表示します。この欄への手入力は不要です。'],
    assisted:['自動判定・変更可','まずは自動判定のままで進めます。モデルと違う場合だけ、確認して変更してください。'],
    guided:['別の設定欄を使用','この共通欄では入力せず、案内されている設定欄で確認します。'],
    upstream:['元の設定を確認','自動で表示する欄です。下の案内から元の設定を確認してください。この欄への手入力は不要です。'],
    initial:['初期値・変更可','ツールの初期値が入っています。今回の条件に合うか確認し、必要な場合だけ変更してください。'],
    optional:['任意・空欄可','この欄は空欄でも進められます。必要な場合に入力してください。'],
    unused:['現在は入力不要','現在の選択では入力できません。必要になると入力できるようになります。']
  };
  const labels=new WeakMap(),edited=new WeakMap(),previousModes=new WeakMap(),drafts=new WeakSet();let queued=false;
  function feedback(el,mode){
    const previous=previousModes.get(el);previousModes.set(el,mode);
    const target=el.type==='file'?document.getElementById(el.id.replace('Input','Requirement')):labels.get(el);
    if(!target)return;
    const success=mode==='complete'||mode==='imported';
    let icon=target.querySelector('.quiet-check');
    if(!success){icon?.remove();return;}
    if(icon&&previous===mode)return;
    icon?.remove();
    const animate=previous!==undefined&&previous!==mode;
    target.insertAdjacentHTML('beforeend',`<svg class="quiet-check" data-animate="${animate}" viewBox="0 0 44 44" aria-hidden="true" focusable="false"><g class="quiet-check-settle"><circle class="quiet-check-ring" cx="22" cy="22" r="18" pathLength="1"/><path class="quiet-check-mark" d="M13 22 L19 28 L31 16" pathLength="1"/></g></svg>`);
  }
  function labelFor(el){
    const associated=el.labels?.[0];if(associated)return associated;
    const previous=el.previousElementSibling;if(previous?.tagName==='LABEL')return previous;
    const direct=[...el.parentElement?.children||[]].filter(n=>n.tagName==='LABEL');
    return direct.length===1?direct[0]:null;
  }
  function documentValue(el){
    if(typeof appMode==='undefined'||appMode!=='architrend'||typeof atLastParse==='undefined'||!atLastParse||atLastParse.applied===false)return false;
    const data=atLastParse.result,same=value=>value!==null&&value!==undefined&&el.value!==''&&Number.isFinite(Number(el.value))&&Number.isFinite(Number(value))&&Math.abs(Number(value)-Number(el.value))<1e-7;
    const keys={uaVal:'ua',envArea:'envArea',uWall:'uWall',uRoof:'uRoof',uFloor1:'uFloor',uFound:'uFound',uWin:'uWin',uDoor:'uDoor'};
    if(keys[el.id])return same(data?.[keys[el.id]]);
    if(el.id==='roomVol'&&el.dataset.at3dsAuto==='true'&&el.value!=='')return true;
    const card=el.closest('.room-card'),key=card?.dataset.atRoomKey,mesh=typeof atMesh==='undefined'?null:atMesh,rooms=(mesh?.rooms||[]).filter(r=>r.key===key);
    if(el.matches('.roomArea')&&rooms.length===1)return same(Math.round(rooms[0].area*100)/100);
    const row=el.closest('.win-row');if(!row||rooms.length!==1)return false;
    const name=row.querySelector('.wName')?.value,level=String(rooms[0].floor),windows=(data?.windows||[]).filter(w=>w.id===name&&String(w.floor)===level);
    if(windows.length!==1)return false;const source=windows[0];
    if(el.matches('.wName'))return el.value===source.id;
    for(const [cls,key]of [['wEta','eta'],['wU','u'],['wArea','area'],['wAz','az']])if(el.classList.contains(cls))return same(source[key]);
    return false;
  }
  function classify(el){
    if(el.disabled)return 'unused';
    const required=el.dataset.setupRequired==='true'||el.getAttribute('aria-invalid')==='true';
    if(el.readOnly)return required?'upstream':el.closest('.at-envelope-guided')?'guided':'auto';
    if(required)return 'required';
    if(drafts.has(el))return 'manual';
    if(el.validity&&!el.validity.valid)return 'manual';
    if(['at3dsUnit','at3dsStories'].includes(el.id)&&el.value==='auto')return 'assisted';
    if(optional.has(el.id)||el.matches('.extraSens,.extraMoist,.glassSel,.attachSel')||el.dataset.fieldOptional==='true')return el.value.trim()!==''?'complete':'optional';
    if(el.dataset.fieldOrigin==='auto')return 'auto';
    if(edited.get(el)!==el.value&&el.value!==''&&(documentValue(el)||el.closest('.at-filled,.ep-filled,.field-ep')))return 'imported';
    if(edited.get(el)!==el.value&&(initial.has(el.id)||el.matches('.peopleSensRate,.peopleMoistRate,.equipSensRate,.equipMoistRate'))&&el.value!==''&&el.value===el.defaultValue)return 'initial';
    return el.value.trim()!==''?'complete':'manual';
  }
  function legend(){
    const heading=document.querySelector('.journey-heading');if(!heading||document.getElementById('fieldGuideLegend'))return;
    const host=document.createElement('div');host.id='fieldGuideLegend';host.className='field-guide-legend';host.setAttribute('aria-label','入力欄の見分け方');
    host.innerHTML='<b>入力欄の見分け方</b><span data-field-mode="manual">入力・確認</span><span data-field-mode="required">要入力</span><span data-field-mode="auto">自動取得・計算</span><span data-field-mode="optional">任意・空欄可</span>';
    heading.insertAdjacentElement('afterend',host);
  }
  function refresh(){
    legend();
    for(const el of document.querySelectorAll('#main '+controls.split(',').join(',#main '))){
      if(el.dataset.viewControl==='true')continue;
      if(el.type==='file'){el.dataset.fieldMode=el.dataset.setupRequired==='true'?'required':el.dataset.fileFieldMode||'manual';feedback(el,el.dataset.fieldMode);continue;} // Successful parsing, not file selection, marks an upload complete.
      const mode=classify(el);el.dataset.fieldMode=mode;
      let badge=labels.get(el),label=labelFor(el);
      if(!label){feedback(el,mode);continue;}
      if(!badge||!badge.isConnected||badge.parentElement!==label){
        badge?.remove();badge=document.createElement('span');badge.className='field-mode-label';badge.dataset.fieldGuidanceGenerated='true';
        // A label that wraps several controls gets one shared hint, not duplicates.
        const existing=label.querySelector('.field-mode-label');if(existing)existing.remove();
        label.append(badge);labels.set(el,badge);
      }
      if(el.id&&!label.htmlFor&&!label.contains(el))label.htmlFor=el.id;
      const text=mode==='optional'&&el.tagName==='SELECT'?'任意・変更時のみ':states[mode][0];
      const description=mode==='optional'&&el.tagName==='SELECT'?'必要な場合だけ選び直してください。ほかの欄へ直接入力する場合は、この選択を変更する必要はありません。':states[mode][1];
      badge.dataset.fieldMode=mode;if(badge.textContent!==text)badge.textContent=text;badge.title=description;
      feedback(el,mode);
      // The text label is readable without color; descriptions remain available
      // on inputs without replacing their existing error/help associations.
      if(!el.hasAttribute('aria-description')||el.dataset.fieldGuidanceDescription==='true'){
        el.setAttribute('aria-description',description);el.dataset.fieldGuidanceDescription='true';
      }
    }
  }
  function queue(){if(queued)return;queued=true;Promise.resolve().then(()=>{queued=false;refresh();});}
  window.boundaryRefreshFieldGuidance=refresh;
  document.addEventListener('input',event=>{if(event.isTrusted&&event.target?.matches?.(controls)&&event.target.type!=='file'){edited.set(event.target,event.target.value);drafts.add(event.target);}queue();});
  document.addEventListener('change',event=>{
    const el=event.target;
    if(event.isTrusted&&el?.matches?.(controls)&&el.type!=='file')drafts.delete(el);
    queue();
  });
  for(const event of ['boundary-journey-changed','architrend-data-ready','architrend-input-applied','architrend-model-ready','architrend-model-invalidated','architrend-import-invalidated','architrend-thermal-changed','architrend-room-mapping-changed'])window.addEventListener(event,queue);
  const main=document.getElementById('main');
  if(main)new MutationObserver(records=>{
    if(records.some(r=>r.type==='attributes'?(r.target.matches?.(controls)||/at-filled|ep-filled|field-ep/.test(r.oldValue||'')||r.target.matches?.('.at-filled,.ep-filled,.at-envelope-guided')):
      [...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&n.namespaceURI==='http://www.w3.org/1999/xhtml'&&!n.dataset.fieldGuidanceGenerated&&(n.matches(controls)||n.querySelector(controls)))))queue();
  }).observe(main,{subtree:true,childList:true,attributes:true,attributeOldValue:true,attributeFilter:['readonly','disabled','class','aria-invalid','data-setup-required','data-file-field-mode']});
  refresh();
})();

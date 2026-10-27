/* One editor for each physical boundary; cards only summarize the live settings. */
(function(){
  'use strict';
  const homes=new Map();let rendering=false;
  const number=id=>{const v=document.getElementById(id)?.value;return v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;};
  const data=()=>typeof atLastParse!=='undefined'?atLastParse?.result:null;
  const mesh=()=>typeof atMesh!=='undefined'?atMesh:null;
  const active=()=>typeof appMode!=='undefined'&&appMode==='architrend';
  const values=summary=>(summary?.settings||[]).map(s=>'U='+s.u.toFixed(3)+' W/m²K'+(s.temperature!==null&&s.temperature!==undefined?'・上側温度 '+s.temperature.toFixed(1)+'℃':'')+'（'+s.count+'面）').join(' ／ ');
  function summary(target){return window.boundaryThermalSummary?.(target)||{missing:true,total:0,assigned:0,ready:false};}
  function used(target,faces){
    if(typeof sslColors!=='undefined'&&sslColors.length&&typeof sslAssign!=='undefined'){
      const keys=sslColors.map(c=>sslAssign[c.rgb]||'');
      // Until all colors have a decision, keep the model's intended boundaries.
      if(keys.every(Boolean))return keys.some(key=>target==='wall'?/^wall_/.test(key):key===target)||keys.some(key=>window.boundaryThermalCategories?.().some(c=>c.key===key&&c.label.startsWith(target==='wall'?'外壁':'屋根')));
    }
    return faces.length>0;
  }
  function status(){
    const m=mesh(),source=data(),faces=m?.meshFaces||[];
    const classified=m&&window.boundaryAttic?.classify(m),ceilingSummary=summary('ceiling');
    const ceilingCount=ceilingSummary.missing?(classified?.top.length||0)+(classified?.uncertain.length||0):ceilingSummary.total;
    const hasCeiling=!ceilingSummary.missing||ceilingCount>0;
    return ['wall','roof','ceiling'].map(target=>{
      const label={wall:'外壁',roof:'屋根',ceiling:'天井・小屋裏'}[target],s=summary(target);
      const partFaces=faces.filter(f=>target==='wall'?/^wall_/.test(f.sslKey||''):target==='roof'?f.sslKey==='roof':f.nameJa==='天井');
      const base={target,label,total:s.missing?partFaces.length:s.total,assigned:s.assigned||0,fieldIds:[],editor:'thermal',editTarget:target};
      if(!m)return {...base,state:'unavailable',reason:'モデル読込後に対象の面を確認します。',nextAction:'まず3DSモデルを読み込んでください。',fieldIds:['at3dsInput'],editor:'common'};
      if(target==='ceiling'){
        if(!hasCeiling)return {...base,state:'not-needed',reason:'小屋裏側に設定する天井はありません。',nextAction:'階の間の天井には、小屋裏温度の設定は不要です。',editor:'ceiling'};
        const state=s.pendingDraft||s.stale?'pending':s.ready?'ready':s.total?'required':'unavailable';
        return {...base,total:ceilingCount,state,stale:s.stale,reason:s.stale?'気象・屋根の条件が変わったため、小屋裏温度の再計算が必要です。':s.ready?values(s):'小屋裏に接する天井のU値と、上側の温度を設定します。',nextAction:s.stale?'入力済みの条件を確認し、もう一度反映してください。温度の手入力は不要です。':s.pendingDraft?'変更を反映してください。現在の設定は下に表示しています。':s.ready?'設定済みです。変更する場合だけ開いてください。':'断熱位置と不足する条件を選び、天井へ反映してください。',editor:'ceiling'};
      }
      if(!s.missing){
        return {...base,state:s.pendingDraft?'pending':s.ready?'ready':s.total?'required':'unavailable',reason:s.ready?values(s):s.total?'資料に複数仕様・要確認の条件があります。':'対象の面を確認できません。',nextAction:s.pendingDraft?'入力した変更を反映してください。':s.ready?'面ごとの設定を使用中です。共通U値の入力は不要です。':'使う仕様と対象の面を確認して反映してください。'};
      }
      if(!used(target,partFaces))return {...base,state:'not-needed',reason:'この部位の条件は現在の出力対象にありません。',nextAction:'この部位のU値を追加する必要はありません。',editor:'common'};
      const manualAttic=window.boundaryAttic?.exportState(),id=target==='wall'?'uWall':'uRoof',u=number(id),shared=target==='roof'&&hasCeiling&&!(manualAttic?.manualOverride&&!manualAttic?.draftDirty);
      const imported=source?.[id]>0&&Math.abs(source[id]-u)<1e-6;
      return {...base,state:u>0?'ready':'required',assigned:u>0?partFaces.length:0,reason:u>0?'使用中のU値：'+u.toFixed(3)+' W/m²K。'+(imported?'読込データを使用。':''):shared?'屋根の性能は、天井・小屋裏と一緒に選びます。':'断熱仕様書のU値を入力してください。',nextAction:shared?'屋根・天井の設定を1回反映すると、屋根のU値も共用します。':u>0?'この値を対象の面に使用します。重ねて設定する必要はありません。':'下のU値を入力してください。入力するとそのまま使用します。',fieldIds:shared?[]:[id],editor:shared?'ceiling':'common',editTarget:shared?'ceiling':target};
    });
  }
  window.boundaryInsulationStatus=status;
  window.boundaryOpenInsulation=function(target){
    const item=status().find(s=>s.target===target);if(!item)return;
    if(item.editor==='common'){
      const el=document.getElementById(item.fieldIds[0]);el?.scrollIntoView({block:'center',behavior:'smooth'});el?.focus({preventScroll:true});return;
    }
    architrendShowThermal(item.editTarget);
    if(item.editTarget==='ceiling')document.getElementById('atThermalDialogTitle').textContent='屋根・天井・小屋裏の設定';
  };
  function moveInputs(on){
    for(const [target,id] of [['wall','uWall'],['roof','uRoof']]){
      const el=document.getElementById(id),slot=document.querySelector('[data-insulation-input="'+target+'"]');if(!el||!slot)continue;
      const wrap=el.parentElement;
      if(on&&!homes.has(id)){const anchor=document.createComment('shared '+id);wrap.before(anchor);homes.set(id,{anchor,wrap});slot.append(wrap);}
      else if(!on&&homes.has(id)){const home=homes.get(id);home.anchor.replaceWith(home.wrap);home.wrap.hidden=false;homes.delete(id);}
    }
    const box=document.getElementById('atEnvelopeReference');if(box){const h=box.querySelector('h3');if(h)h.textContent=on?'相当外気温度（SAT）の確認・外部扉':'1-4 屋根・外壁 (SAT + 熱通過率)';}
  }
  function render(){
    if(rendering)return;rendering=true;
    try{
      const host=document.getElementById('insulationGuide');if(!host)return;
      const on=active();moveInputs(on);host.hidden=!on;if(!on)return;
      const items=status(),pending=items.filter(s=>['required','pending','unavailable'].includes(s.state));
      const task=document.getElementById('insulationTaskSummary');task.dataset.ready=String(!pending.length);
      task.textContent=pending.length?'残り '+pending.length+' 項目：'+pending.map(s=>s.label).join('・')+'を確認してください。色の付いた項目が次の作業です。':'外壁・屋根・天井の設定を確認できました。床・窓などを含めた残りの必須項目は、上の一覧で確認できます。';
      for(const item of items){
        const card=host.querySelector('[data-insulation-card="'+item.target+'"]');card.dataset.state=item.state;
        card.querySelector('[data-insulation-state]').textContent=item.stale?'再反映が必要':({ready:'設定済み',required:'必須・未設定',pending:'変更が未反映',unavailable:'先に確認', 'not-needed':'設定不要'})[item.state];
        card.querySelector('[data-insulation-current]').textContent=(item.total&&item.editor!=='common'?item.assigned+' / '+item.total+'面を設定済み。':'')+item.reason;
        card.querySelector('[data-insulation-next]').textContent=item.nextAction;
        const slot=card.querySelector('[data-insulation-input]');if(slot)slot.hidden=item.editor!=='common'||item.state==='not-needed'||item.state==='unavailable';
        const button=card.querySelector('button[data-insulation-action]');button.hidden=item.editor==='common'||item.state==='not-needed';
        button.textContent=item.editor==='ceiling'?'屋根・天井をまとめて'+(item.state==='ready'?'確認・変更':'設定する'):item.state==='ready'?'現在の設定を確認・変更する':'仕様と対象の面を設定する';
      }
      markEditorRequirements();
    }finally{rendering=false;}
  }
  function markEditorRequirements(){
    const host=document.getElementById('atThermalReview');if(!host)return;
    host.querySelectorAll('[data-insulation-required]').forEach(el=>{el.classList.remove('setup-required-field');el.removeAttribute('aria-invalid');delete el.dataset.insulationRequired;});
    host.querySelectorAll('.insulation-required-reason').forEach(el=>el.remove());
    const mark=(el,reason)=>{if(!el)return;el.dataset.insulationRequired='true';el.classList.add('setup-required-field');el.setAttribute('aria-invalid','true');const note=document.createElement('span');note.className='insulation-required-reason';note.textContent=reason;if(el.type==='checkbox')el.parentElement.append(note);else el.after(note);};
    const attic=window.boundaryAttic?.exportState();
    if(!attic?.manualOverride||attic.draftDirty)for(const item of window.boundaryAttic?.requiredInputs?.()||[])mark(host.querySelector(item.selector),item.reason);
    for(const target of ['wall','roof']){
      const state=summary(target);if(state.missing||state.ready&&!state.pendingDraft)continue;
      const row=host.querySelector('[data-thermal-bulk="'+target+'"]');if(!row)continue;
      const group=row.querySelector('[data-thermal-key="groupId"]'),u=row.querySelector('[data-thermal-key="u"]');
      if(!group?.value)mark(group,'仕様の割当が必要です。まとめて選ぶか、下の「面ごとに確認」で指定してください。');
      else if(!(Number(u.value)>0))mark(u,'この仕様のU値を0より大きい数値で入力してください。');
      const apply=host.querySelector('[data-thermal-apply="'+target+'"]');if(apply)apply.classList.toggle('insulation-apply-required',true);
    }
    for(const apply of host.querySelectorAll('[data-thermal-apply]')){const state=summary(apply.dataset.thermalApply);if(state.ready&&!state.pendingDraft)apply.classList.remove('insulation-apply-required');}
    const estimate=host.querySelector('[data-attic-apply]'),ceiling=summary('ceiling');if(estimate)estimate.classList.toggle('insulation-apply-required',!ceiling.ready||ceiling.pendingDraft||ceiling.stale);
  }
  window.boundaryRefreshInsulationGuide=render;
  const oldHints=refreshArchitrendEnvelopeHints;
  refreshArchitrendEnvelopeHints=function(){const result=oldHints();render();return result;};
  document.getElementById('insulationGuide')?.addEventListener('click',e=>{const button=e.target.closest('[data-insulation-action]');if(button)window.boundaryOpenInsulation(button.dataset.insulationAction);});
  document.getElementById('atThermalReview')?.addEventListener('input',render);
  document.getElementById('atThermalReview')?.addEventListener('change',render);
  const run=runAll;runAll=function(){run();render();};
  for(const name of ['architrend-data-ready','architrend-model-ready','architrend-thermal-changed','architrend-import-invalidated','architrend-model-invalidated'])window.addEventListener(name,render);
  render();
})();

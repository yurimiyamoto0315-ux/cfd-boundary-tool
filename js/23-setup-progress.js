/* Missing values form a queue; read values stay visible with their source. */
window.createBoundarySetupProgress=function(host,options){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={imported:'資料から入力済み',provided:'前段で入力済み',confirmed:'確認済み',pending:'確認待ち'};
  let onlyPending=true,activeId=null,tasks=[];
  host.innerHTML=`<div class="setup-progress-head"><div><b>入力できているところは、そのままで。</b><p>資料から読めなかった条件だけ、順番に確認します。初期値も内容を確認してから使います。</p></div><label class="setup-mode"><input id="setupOnlyPending" type="checkbox" checked> 確認待ちだけ表示</label></div>
    <div id="setupCounts" class="setup-counts"></div><div id="setupMeter" class="setup-meter" role="progressbar" aria-label="計算条件の確認状況" aria-valuemin="0" aria-valuemax="100"><span></span></div>
    <details id="setupCompleted"><summary id="setupCompletedTitle">入力済みの内容を見る</summary><div id="setupCompletedList"></div></details>
    <div id="setupQueue"><label class="setup-queue-pick">確認する項目<select id="setupTaskSelect"></select></label>
      <article class="setup-task"><div class="setup-task-head"><img id="setupTaskImage" src="assets/setup/envelope.svg" alt=""><div><span id="setupTaskStage" class="setup-eyebrow"></span><h4 id="setupTaskTitle" tabindex="-1"></h4><p id="setupTaskDescription"></p></div></div>
        <div id="setupTaskRead"></div><div id="setupTaskFields" class="setup-task-fields"></div><p id="setupTaskError" class="setup-task-error" role="alert"></p>
        <div class="setup-task-actions"><button type="button" id="setupConfirmTask">この内容を確認して次へ →</button><button type="button" id="setupTaskDetails">この項目を詳しく見る</button></div>
      </article></div><div id="setupQueueDone" class="setup-queue-done" hidden><b>すべての項目がそろいました。</b><p>入力済みの内容をまとめて確認して、IDFを保存できます。</p><button type="button" id="setupQueueReview">設定全体を確認して保存へ →</button></div>`;
  const $=id=>host.querySelector('#'+id);
  const badge=f=>`<span class="setup-field-status is-${f.status}">${labels[f.status]}</span>`;
  const periods=list=>(list||[]).map(p=>p.startMonth+'月'+p.startDay+'日〜'+p.endMonth+'月'+p.endDay+'日').join('、')||'指定なし';
  function ranges(a){const out=[];for(let h=0;h<24;h++){if(!(a?.[h]>0))continue;const start=h;while(h<23&&a[h+1]>0)h++;out.push(start+'〜'+(h+1)+'時');}return out.join('、')||'使わない';}
  function valueText(f){
    const v=f.value;if(f.type==='construction'){const c=options.getModel().constructions[f.materialKey];return (c?.label||f.materialKey)+(c?.resistance!=null?' / 熱抵抗 '+c.resistance+' m²K/W':c?.layers?' / '+c.layers.length+'層':'');}
    if(f.type==='boundary')return [...new Set(v.map(([,b])=>({Ground:'地盤に直接接する',Outdoors:'床下・外気側',Adiabatic:'熱の出入りなし'}[b]||b)))].join(' / ');
    if(f.type==='checkbox')return v?'使う':'使わない';
    if(f.type==='living')return '在室・照明・家電の24時間の割合';
    if(f.type==='hvac')return v.mode==='season'?'暖房・冷房の期間を個別指定':ranges(v.hours);
    if(f.type==='assumptions')return '地中 '+v.settings.groundTemperature+'℃ / 活動量 '+v.settings.activityW+' W/人 ほか';
    return v==null?'計算しない':v+(f.unit?' '+f.unit:'');
  }
  function fieldHTML(f,i){
    const attrs=`data-task-field="${i}" id="setupTaskField${i}"`,v=f.value;
    let control='';
    if(f.type==='number'||f.type==='text')control=`<input ${attrs} type="${f.type}" ${f.type==='number'?`step="any" ${f.id.endsWith('heating')||f.id.endsWith('cooling')?'':'min="0"'}`:''} value="${esc(v??'')}" ${f.title==='照明の消費電力'?'placeholder="空欄：計算しない"':''}>${f.unit?`<span class="setup-input-unit">${esc(f.unit)}</span>`:''}`;
    if(f.type==='checkbox')control=`<label class="setup-check-control"><input ${attrs} type="checkbox" ${v?'checked':''}> この部屋で冷暖房を使う</label>`;
    if(f.type==='construction')control=`<select ${attrs}>${Object.entries(options.getModel().constructions).filter(([,c])=>c.kind?c.kind!=='glazing':!(c.u!=null&&!c.layers?.length)).map(([k,c])=>`<option value="${esc(k)}" ${k===f.materialKey?'selected':''}>${esc(c.label||k)}</option>`).join('')}</select><small>${esc(valueText(f))}。断熱材の厚みなどは「詳しく見る」で変更できます。</small>`;
    if(f.type==='boundary')control=`<select ${attrs}><option value="keep">${esc(valueText(f))}（現在の設定）</option><option value="Ground">地盤に直接接する（土間など）</option><option value="Outdoors">床下・外気側として扱う（簡略モデル）</option><option value="Adiabatic">熱の出入りなしとして扱う</option></select>`;
    if(f.type==='living')control=`<select ${attrs}><option value="keep">いまの時間割を使う</option><option value="away">日中は外出する例を入れる</option><option value="home">日中も在宅する例を入れる</option></select><div class="setup-mini-timeline">${[['peopleSchedule','在室'],['lightsSchedule','照明'],['equipmentSchedule','家電']].map(([k,label])=>`<div><b>${label}</b><span>${(v[k]||[]).map((n,h)=>`<i style="--use:${n}" title="${h}〜${h+1}時：${Math.round(n*100)}%"></i>`).join('')}</span></div>`).join('')}<small>0時 → 12時 → 24時 · 濃いほど多く使う時間です</small></div>`;
    if(f.type==='hvac')control=`<select ${attrs}><option value="keep">いまの運転時間を使う</option><option value="all">一日中、必要なときに使う</option><option value="morningEvening">朝と夜に使う（6〜9時・17〜24時）</option></select><small>現在：${esc(valueText(f))}${v.mode==='season'?' / 暖房 '+esc(periods(v.heating))+' / 冷房 '+esc(periods(v.cooling)):''}</small>`;
    if(f.type==='assumptions'){const s=v.settings;control=`<div class="setup-assumptions"><p>地中温度：<b>${esc(s.groundTemperature)}℃</b>（年間一定） / 人の活動量：<b>${esc(s.activityW)} W/人</b></p><p>熱のうち放射する割合：人体 ${esc(s.peopleRadiant)} / 照明 ${esc(s.lightsRadiant)} / 家電 ${esc(s.equipmentRadiant)}。家電の潜熱割合：${esc(s.equipmentLatent)}。</p><p>漏気：${v.infiltration.every(([,n])=>n==null)?'全室で計算しない':v.infiltration.map(([id,n])=>esc(options.getModel().rooms.find(r=>r.id===id)?.name||id)+' '+(n==null?'計算しない':esc(n)+'回/h')).join('、')}。</p><p>供給温度・湿度の制限：${['maxHeatingSupply','minCoolingSupply','maxHeatingHumidity','minCoolingHumidity','coolingSHR'].every(k=>s[k]==null)?'指定なし':Object.entries(s).filter(([k,n])=>['maxHeatingSupply','minCoolingSupply','maxHeatingHumidity','minCoolingHumidity','coolingSHR'].includes(k)&&n!=null).map(([k,n])=>esc(({maxHeatingSupply:'加熱上限℃',minCoolingSupply:'冷却下限℃',maxHeatingHumidity:'加熱湿度比',minCoolingHumidity:'冷却湿度比',coolingSHR:'冷房顕熱比'})[k])+' '+esc(n)).join(' / ')}。</p><p>換気・漏気の時間割も現在の設定を使います。「詳しく見る」で内容を変更できます。</p></div>`;}
    return `<div class="setup-task-field"><label for="setupTaskField${i}">${esc(f.title)} ${badge(f)}</label><div class="setup-field-control">${control}</div>${f.hint?`<small>${esc(f.hint)}</small>`:''}</div>`;
  }
  function current(){return tasks.find(t=>t.id===activeId);}
  function render(){
    const m=options.getModel();host.hidden=!m;if(!m)return;
    tasks=window.boundarySetupTasks(m);const fields=tasks.flatMap(t=>t.fields),pending=tasks.filter(t=>t.pending.length),count=status=>fields.filter(f=>f.status===status).length;
    $('setupCounts').innerHTML=Object.entries(labels).map(([k,title])=>`<div class="is-${k}"><b data-setup-count="${k}">${count(k)}</b><span>${title}</span></div>`).join('');
    const percent=fields.length?Math.round((fields.length-count('pending'))/fields.length*100):0;$('setupMeter').setAttribute('aria-valuenow',percent);$('setupMeter').querySelector('span').style.width=percent+'%';
    const completed=fields.length-count('pending');$('setupCompleted').hidden=!completed;$('setupCompletedTitle').textContent='入力済み・確認済み '+completed+'項目を見る（値と出典）';
    $('setupCompletedList').innerHTML=tasks.filter(t=>t.fields.some(f=>f.status!=='pending')).map(t=>`<div class="setup-completed-group"><b>${esc(t.title)}</b>${t.fields.filter(f=>f.status!=='pending').map(f=>`<div class="setup-completed-field"><span>${esc(f.title)}</span><strong>${esc(valueText(f))}</strong>${badge(f)}${f.source?`<small>出典：${esc(f.source)}</small>`:''}</div>`).join('')}<button type="button" data-completed-edit="${esc(t.id)}">内容を変更する</button></div>`).join('');
    if(!pending.some(t=>t.id===activeId))activeId=pending[0]?.id||null;
    const task=current();$('setupOnlyPending').checked=onlyPending;$('setupQueue').hidden=!onlyPending||!task;$('setupQueueDone').hidden=!onlyPending||!!task;
    options.mode(onlyPending,task?.step??3);
    if(!task)return;
    $('setupTaskSelect').innerHTML=pending.map((t,i)=>`<option value="${esc(t.id)}" ${t.id===activeId?'selected':''}>${i+1}. ${esc(t.title)}（あと${t.pending.length}項目）</option>`).join('');
    $('setupTaskStage').textContent=['建物の仕様','部屋の使い方','暮らしと空調'][task.step]+' / 残り'+pending.length+'件';
    $('setupTaskTitle').textContent=task.title;$('setupTaskDescription').textContent=task.description;
    $('setupTaskImage').src='assets/setup/'+['envelope','rooms','living'][task.step]+'.svg';
    $('setupTaskRead').innerHTML=task.fields.filter(f=>f.status!=='pending').map(f=>`<p>${badge(f)} ${esc(f.title)}：<b>${esc(valueText(f))}</b>${f.source?`<small>出典：${esc(f.source)}</small>`:''}</p>`).join('');
    $('setupTaskFields').innerHTML=task.pending.map(fieldHTML).join('');$('setupTaskError').textContent='';
  }
  function openTask(task){if(!task)return;if(task.advanced){options.openAdvanced(task.advanced);return;}onlyPending=false;render();options.openFull(task.step,task.roomIndex);}
  host.addEventListener('change',e=>{
    const t=e.target;if(t.id==='setupOnlyPending'){onlyPending=t.checked;render();return;}
    if(t.id==='setupTaskSelect'){activeId=t.value;render();return;}
    if(t.dataset.taskField==null)return;const f=current()?.pending[+t.dataset.taskField];if(!f?.set)return;
    if(t.value==='keep'&&t.tagName==='SELECT')return;
    const v=t.type==='checkbox'?t.checked:f.type==='number'?(t.value===''?null:+t.value):t.value;
    options.change(m=>f.set(m,v));
  });
  host.addEventListener('click',e=>{const b=e.target.closest('button');if(b?.dataset.completedEdit)openTask(tasks.find(t=>t.id===b.dataset.completedEdit));});
  $('setupTaskDetails').onclick=()=>openTask(current());
  $('setupConfirmTask').onclick=()=>{
    // Change events save edits before this runs. Re-read to confirm the saved values.
    tasks=window.boundarySetupTasks(options.getModel());const task=current();if(!task)return;
    const invalid=task.pending.filter(f=>!f.valid);if(invalid.length){$('setupTaskError').textContent=invalid.map(f=>f.title).join('、')+'の値を確認してください。';return;}
    const rest=tasks.filter(t=>t.id!==task.id&&t.pending.length),position=tasks.indexOf(task);activeId=rest.find(t=>tasks.indexOf(t)>position)?.id||rest[0]?.id||null;
    options.record(m=>window.confirmBoundarySetupFields(m,task.pending));
    $('setupTaskTitle').focus({preventScroll:true});
  };
  $('setupQueueReview').onclick=()=>options.review();
  return {render,full(){onlyPending=false;render();},pending(){onlyPending=true;render();},badge,labels};
};

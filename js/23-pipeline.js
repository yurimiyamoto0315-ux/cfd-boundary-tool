/* EP→CFD uses an independent thermal model and export path. Legacy SAT stays intact. */
(function(){
  'use strict';
  const KEY='cfdBoundaryPipeline_v1';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone=x=>JSON.parse(JSON.stringify(x));
  let state={version:1,workflow:'cfd',source:'architrend',model:null,job:null,runSignature:'',index:0,flows:{}}, token='', defaults=window.boundaryPipelineDefaults||null, result=null, weather='', weatherName='', pollTimer=null, categoryCsv='', selectedFace=null;
  try { const old=JSON.parse(localStorage.getItem(KEY)); if(old&&old.version===1) state=Object.assign(state,old); } catch(e){}
  const host=document.createElement('section'); host.id='pipelinePanel'; host.hidden=true;
  host.innerHTML=`
    <div class="pipe-hero"><div><h1>EP → CFD</h1><p>境界条件を設定してIDFを保存します。EnergyPlusの実行とSQL作成は各自で行います。</p></div><div><div id="pipeService" class="pipe-status" role="status">入力作成サービスを確認中…</div><button type="button" id="pipeShutdown">ツールを終了</button></div></div>
    <ol class="pipe-steps"><li><a href="#pipeInput"><b>01</b>モデル取込</a></li><li><a href="#pipeReview"><b>02</b>部屋・面</a></li><li><a href="#pipeThermal"><b>03</b>かんたん設定</a></li><li><a href="#pipeRun"><b>04</b>IDF保存・SQL取込</a></li><li><a href="#pipeTime"><b>05</b>時刻選択</a></li><li><a href="#pipeExport"><b>06</b>CFD用出力</a></li></ol>
    <section class="pipe-section" id="pipeInput"><h2>01 モデルの入口</h2>
      <div class="pipe-row pipe-source"><button type="button" id="pipeSourceAt">ARCHITREND</button><button type="button" id="pipeSourceRhino">Rhino</button></div>
      <div id="pipeAtHost"></div><div id="pipeRhinoInput"><p class="pipe-note">BT::Rooms に閉じた部屋形状、BT::Windows / Doors / Shades に開口・日除けを作り、専用スクリプトから書き出します。</p><a href="scripts/rhino_export.py" download>Rhino書出スクリプト</a></div>
      <div class="pipe-row"><label>建物JSON（Rhino・保存データの再開用）<input id="pipeModelFile" type="file" accept=".json"></label><button type="button" id="pipeBuildAt">取込済みARCHITRENDから部屋候補を作る</button><button type="button" id="pipeSample">単室サンプル</button></div>
      <div id="pipeInputStatus" class="pipe-errors" role="status" aria-live="polite" hidden></div>
      <p class="pipe-note" id="pipeAtNote">ARCHITRENDの部屋候補は床輪郭と高さから作ります。階間は独立ゾーンにせず、下階のボリュームに含めて上階床までつなげます。勾配天井・隣接面・窓の割当は次の画面で確認・修正してください。</p>
    </section>
    <section class="pipe-section" id="pipeReview"><h2>02 部屋・面を確認</h2>
      <div id="pipeGhost" class="ghost-viewer">
        <div class="ghost-toolbar"><strong>ゾーン構成 <span>GHOST VIEW</span></strong><div><button type="button" data-view="reset">立体・全体に合わせる</button><button type="button" data-view="top">真上</button><button type="button" data-view="front">正面</button><button type="button" data-view="minus" aria-label="縮小">−</button><button type="button" data-view="plus" aria-label="拡大">＋</button></div></div>
        <div class="ghost-layout"><div class="ghost-stage"><svg id="pipePreview" viewBox="0 0 900 560" aria-label="ゾーン構成の3D表示。ドラッグで回転、ホイールで拡大、Shiftとドラッグで移動。矢印キーでも回転できます。" tabindex="0"></svg><div class="ghost-hint">ドラッグ：回転　ホイール：拡大　Shift＋ドラッグ：移動<br>クリック：ゾーン選択　ダブルクリック：面を編集</div></div>
        <aside class="ghost-sidebar"><label>表示する高さ<select data-view="floor"><option value="">すべての高さ</option></select></label><div class="ghost-selected" data-view="selection" role="status">全ゾーン表示</div><label><input type="checkbox" data-view="isolate"> 選択ゾーンだけ表示</label><button type="button" data-view="all">選択解除・全体を表示</button><div class="ghost-zones" data-view="zones" aria-label="ゾーン一覧"></div></aside></div>
        <div class="ghost-options"><label>面の濃さ<input type="range" data-view="opacity" min="3" max="50" value="14"></label><label><input type="checkbox" data-view="roof" checked> 屋根・天井を表示</label><label><input type="checkbox" data-view="labels" checked> ゾーン名を表示</label></div>
      </div><p id="pipeGeometrySummary" class="pipe-note">モデルを読み込んでください。</p>
      <div class="pipe-row"><label>北方向（度）<input type="number" id="pipeNorth" value="0" step="1"></label><button type="button" id="pipePair">部屋同士の壁・床を自動でつなぐ</button><button type="button" id="pipeValidate">入力に問題がないか確認</button></div><div id="pipeValidation" class="pipe-errors" role="status">未検証</div>
      <details><summary>面・開口の境界と材料を編集</summary><div id="pipeFaces" class="pipe-scroll"></div></details>
      <div id="pipeFaceEditor" hidden><h3 id="pipeFaceTitle"></h3><label>頂点座標（1行に X Y Z、単位 m、室外から見て反時計回り）<textarea id="pipeVertices"></textarea></label><button type="button" id="pipeApplyVertices">この面の頂点を更新</button></div>
      <details><summary>建物データの詳細編集・追加</summary><p class="pipe-note">部屋・面の追加や分割は建物JSONを編集して反映できます。通常の条件変更は上の一覧を使ってください。</p><textarea id="pipeModelEditor" aria-label="建物JSON詳細"></textarea><button type="button" id="pipeApplyModel">詳細編集を反映</button><button type="button" id="pipeSaveModel">建物JSONを書き出す</button></details>
    </section>
    <section class="pipe-section" id="pipeThermal"><h2>03 計算条件をかんたん設定</h2>
      <aside id="pipeAtImport" class="pipe-source-import" hidden><div class="pipe-source-import-head"><div><span>ARCHITREND → IDF</span><h3>資料から反映した内容</h3></div><button type="button" id="pipeSyncAt">読み取り内容を再反映</button></div><div id="pipeAtImportCounts" class="pipe-source-counts"></div><details><summary>出典と、確認が必要な項目</summary><div id="pipeAtImportSources"></div><ul id="pipeAtImportNotes"></ul></details><p class="pipe-note">手修正した値・独自の材料仕様は保持します。取得できない項目は現在の値を残し、確認項目へ表示します。</p></aside>
      <div id="pipeSetup"></div>
      <details id="pipeAdvanced"><summary>詳しく設定する — 材料層・放射比・運転期間など</summary>
      <p class="pipe-note">ここに入れた値が IDF の Construction、People、Lights、ElectricEquipment、ZoneInfiltration、IdealLoads になります。構成名はそのまま Construction 名です。参考Uは材料の熱抵抗に室内側 0.11・外気側 0.04 m²K/W を足した目安で、EPの対流計算そのものではありません。窓のUは WindowMaterial:SimpleGlazingSystem の U-Factor です。面への割当は 02 の材料列です。</p>
      <div class="pipe-row"><label>暖房設定 ℃<input id="pipeHeating" type="number" value="20"></label><label>冷房設定 ℃<input id="pipeCooling" type="number" value="27"></label><label>地中温度 ℃<input id="pipeGround" type="number" value="18"></label><label>活動量 W/人<input id="pipeActivity" type="number" value="120" step="any"></label></div>
      <p class="pipe-note">地中温度は Site:GroundTemperature:BuildingSurface で、1月から12月まで同じ値です。活動量は People の Activity Level で、終日一定です。</p>
      <div class="pipe-row"><label>人体の放射比<input id="pipePeopleRadiant" type="number" value="0.3" min="0" max="1" step="any"></label><label>照明の放射比<input id="pipeLightsRadiant" type="number" value="0" min="0" max="1" step="any"></label><label>機器の放射比<input id="pipeEquipRadiant" type="number" value="0.3" min="0" max="1" step="any"></label><label>機器の潜熱比<input id="pipeEquipLatent" type="number" value="0" min="0" max="1" step="any"></label></div>
      <div class="pipe-row"><label>加熱供給上限 ℃<input id="pipeHeatSupply" type="number" step="any" placeholder="未設定"></label><label>冷却供給下限 ℃<input id="pipeCoolSupply" type="number" step="any" placeholder="未設定"></label><label>加熱供給湿度比<input id="pipeHeatHumid" type="number" step="any" placeholder="未設定"></label><label>冷却供給湿度比<input id="pipeCoolHumid" type="number" step="any" placeholder="未設定"></label><label>冷房顕熱比<input id="pipeShr" type="number" min="0" max="1" step="any" placeholder="未設定"></label></div>
      <p class="pipe-note">空欄の供給温度・湿度比・顕熱比は IdealLoads に書きません。顕熱比を入れると Dehumidification Control Type は ConstantSensibleHeatRatio です。加熱・冷却の能力制限は NoLimit です。</p>
      <div class="pipe-row"><label>空調の入り方<select id="pipeHvacMode"><option value="hourly">24時間スケジュール（暖房・冷房共通）</option><option value="season">期間で暖房と冷房を分ける</option></select></label><button type="button" id="pipeIworksHvac">iworksの空調条件を入れる</button></div>
      <p class="pipe-note">期間指定では暖房と冷房に別の Schedule:Year を書きます。期間内は終日運転、期間外は停止です。2月は28日までです。iworksの空調条件は、暖房24℃・冷房26℃、加熱供給50℃、冷却供給13℃、湿度比 0.0156 / 0.0077、顕熱比 0.7、暖房 1/1–4/16 と 11/9–12/31、冷房 5/6–10/18、機器と照明の放射比 0 です。外皮と人数はそのままです。</p>
      <div id="pipePeriods"></div>
      <h3>室の内部発熱と換気</h3>
      <p class="pipe-note">照明 W/m² を入れた室は Lights（Watts/Area）を書きます。空欄の室は書きません。機器 W/m² を入れた室は ElectricEquipment（Watts/Area）になり、その室の機器Wは使いません。空欄の室は機器Wを OtherEquipment の合計Wとして書きます。漏気は ZoneInfiltration:DesignFlowRate、換気は ZoneVentilation:DesignFlowRate（Natural）です。空欄の漏気は書きません。</p>
      <div id="pipeRooms" class="pipe-scroll"></div>
      <h3>構成</h3>
      <div class="pipe-row"><button type="button" id="pipeAddLayers">多層の構成を追加</button><button type="button" id="pipeAddGlazing">窓仕様を追加</button><button type="button" id="pipeAddNomass">熱抵抗だけの構成を追加</button></div>
      <div id="pipeMaterials"></div>
      <details open><summary>24時間スケジュール（全曜日共通の Schedule:Year）</summary><div id="pipeSchedules" class="pipe-hours"></div></details>
      <h3>この実行で書く IDF</h3>
      <div id="pipeIdfSheet" class="pipe-sheet">モデルを読み込むと、構成・室負荷・空調期間をここに出します。</div>
      </details>
    </section>
    <section class="pipe-section" id="pipeRun"><h2>04 IDFを保存・SQLを取り込む</h2>
      <p class="pipe-note">EnergyPlus 24.2 / IdealLoads / 年間解析。境界条件を確認してIDFを保存してください。EnergyPlusのインストールはIDF作成には不要です。</p>
      <div class="pipe-row"><button type="button" class="primary" id="pipeStart">IDFを作成・保存</button><button type="button" id="pipeArtifacts" disabled>入力・対応表・手順をZIP保存</button></div>
      <p class="pipe-note">保存したIDFと年間EPWをEnergyPlus 24.2のEP-Launchで選択し、ご自身で計算してください。Output:SQLiteはIDFに含まれます。正常終了とeplusout.errにSevere / Fatalがないことを確認して、生成されたeplusout.sqlを戻します。</p>
      <label><input id="pipeSqlConfirmed" type="checkbox"> このIDFと使用したEPWの結果であり、正常終了・エラーログを確認した（SQLだけでは入力条件の一致を証明できません）</label>
      <div class="pipe-row"><label>計算済み eplusout.sql<input id="pipeSql" type="file" accept=".sql" disabled></label></div>
      <div id="pipeJobStatus" class="pipe-status" role="status">IDF未作成</div></section>
    <section class="pipe-section" id="pipeTime"><h2>05 CFDで見る時刻</h2><div class="pipe-row"><label>対象室<select id="pipeTargetRoom"><option value="">建物全体</option></select></label><button type="button" id="pipeCoolPeak">冷房ピーク</button><button type="button" id="pipeHeatPeak">暖房ピーク</button><label>任意日時<select id="pipeTimeSelect"></select></label></div><p class="pipe-note">Hourly（1時間平均）の時刻帯終了時刻です。24時は当日の23〜24時を示します。</p><div id="pipeResults" class="pipe-scroll"></div></section>
    <section class="pipe-section" id="pipeExport"><h2>06 CFD用出力</h2><div class="pipe-output"><p>外皮・外部窓はEPの表面温度。内壁・室間床・天井は材質と厚みで伝熱を計算します。</p><p class="pipe-note">内壁の表面温度は固定せず、両室に共通する壁は1枚にまとめます。内壁に吸収される日射・正味放射熱は材料の発熱として渡すため、CFDの日射・輻射解析はOFFにしてください。</p><div id="pipeFlows" class="pipe-scroll"></div><p class="pipe-note">風量はm³/h。吹出温度の参考値は室温と顕熱負荷から算定します。位置・向き・流量・温度はFlowDesignerで設定してください。</p><div class="pipe-row"><label>FlowDesigner 色対応CSV（再出力時）<input id="pipeCategory" type="file" accept=".csv"></label><button type="button" class="primary" id="pipeDownload" disabled>CFDモデル・条件を出力</button><button type="button" id="pipeResultDownload" disabled>EP結果JSON</button></div><p id="pipeExportStatus" class="pipe-note" role="status"></p></div></section>`;
  $('main').prepend(host);
  // Older saved models already carry the user's explicit confirmation of all current values.
  if(state.model?.settings?.reviewed&&!state.model.setupReview)confirmAllBoundarySetupFields(state.model);
  const setupGuide=createBoundarySetupGuide($('pipeSetup'),{
    getModel:()=>state.model,
    defaults:()=>defaults,
    change:fn=>{if(!state.model)return;fn(state.model);if(state.model.rooms.some(r=>r.lightsWm2!=null))ensureSchedule('lightsSchedule');markThermal();render();},
    record:fn=>{if(!state.model)return;fn(state.model);changed();render();},
    openAdvanced:id=>{window.boundaryJourneyReveal?.($(id));$('pipeAdvanced').open=true;$(id).scrollIntoView({behavior:'smooth',block:'center'});}
  });
  const atAnchor=document.createComment('architrend-panel-location'); $('atPanel').before(atAnchor);
  function captureAtSources(){
    if(typeof atLastParse==='undefined'||!atLastParse)return;
    const files={...state.architrendSources?.files};
    for(const [key,id] of [['csv','atCsvInput'],['pdf','atPdfInput']])if($(id)?.files[0])files[key]=$(id).files[0].name;
    state.architrendSources={csv:atCsvParse?clone(atCsvParse):null,pdf:atPdfParse?clone(atPdfParse):null,files};
  }
  function restoreAtSources(){
    if(!state.architrendSources)return;
    atCsvParse=clone(state.architrendSources.csv||null);atPdfParse=clone(state.architrendSources.pdf||null);
    atLastParse=mergeArchitrendSources(atCsvParse,atPdfParse);
  }
  function syncAtModel(fresh=false){
    captureAtSources();
    if(!state.model||state.model.source!=='architrend'||!atLastParse?.result){persist();return;}
    const roomValues={},windowLinks={};
    document.querySelectorAll('.room-card[data-at-room-key]').forEach(card=>{
      const raw=cls=>{const text=card.querySelector('.'+cls)?.value;return text!=null&&text.trim()!==''&&Number.isFinite(+text)?+text:null;};
      const mesh=typeof atMesh!=='undefined'&&atMesh?.rooms.find(r=>r.key===card.dataset.atRoomKey);
      roomValues[card.dataset.atRoomKey]={people:raw('occCount'),equipmentW:raw('equipSensRate')!=null&&mesh?raw('equipSensRate')*mesh.area:null};
    });
    document.querySelectorAll('.win-row[data-at-face-id]').forEach(row=>{windowLinks[row.dataset.atFaceId]=row.querySelector('.wName')?.value;});
    const physical=()=>JSON.stringify({rooms:state.model.rooms,surfaces:state.model.surfaces,openings:state.model.openings,constructions:state.model.constructions});
    const before=physical();
    applyArchitrendToBoundaryModel(state.model,atLastParse.result,{fresh,defaults,rooms:typeof atMesh!=='undefined'&&atMesh?atMesh.rooms:[],roomValues,windowLinks,files:state.architrendSources?.files});
    if(before!==physical())markThermal();else persist();
    render();
  }
  function renderAtImport(){
    const report=state.model?.architrendImport;$('pipeAtImport').hidden=state.model?.source!=='architrend'||!report;
    if(!report)return;
    const c=report.counts;$('pipeAtImportCounts').innerHTML=[['外皮の性能',c.envelope+'面'],['窓のU値',c.windowU+'面'],['窓の日射性能',c.windowSolar+'面'],['部屋名・区分',c.rooms+'室'],['前段の人数入力',c.people+'室']].map(([a,b])=>'<div><small>'+esc(a)+'</small><b>'+esc(b)+'</b></div>').join('');
    const list=Object.entries(report.files||{}).map(([kind,name])=>'<p>'+esc(kind.toUpperCase()+': '+name)+'</p>');
    const specs=Object.entries(state.model.constructions).filter(([,c])=>c.architrendSource).map(([id,c])=>'<p><b>'+esc(c.label||id)+'</b><br>'+esc(c.architrendSource)+'</p>');
    $('pipeAtImportSources').innerHTML=list.concat(specs).join('');$('pipeAtImportNotes').innerHTML=report.notes.map(n=>'<li>'+esc(n)+'</li>').join('');
  }
  function persist(){try {localStorage.setItem(KEY,JSON.stringify(state));}catch(e){status('保存領域が不足しています。建物JSONを保存してください。');}}
  function status(text){$('pipeJobStatus').textContent=text;}
  function currentSignature(){return JSON.stringify(state.model);}
  function stale(){return !state.job||state.runSignature!==currentSignature()||state.weatherChanged;}
  function changed(){state.weatherChanged=!!state.weatherChanged; persist(); $('pipeDownload').disabled=true; $('pipeValidation').textContent='変更あり・再検証が必要です'; $('pipeValidation').classList.remove('pipe-ok'); if(state.job)status('条件を変更しました。IDFを再作成して手動で再計算してください'); updateButtons();}
  let busy=false;
  function updateButtons(){
    $('pipeStart').disabled=!token||!state.model||busy;
    $('pipeArtifacts').disabled=!state.job||!token||busy;
    $('pipeSql').disabled=!token||state.job?.mode!=='manual'||stale()||busy||!$('pipeSqlConfirmed').checked;
    $('pipeDownload').disabled=!result||stale()||busy;
    $('pipeResultDownload').disabled=!result;
  }

  async function api(path,body,binary=false){
    if(location.protocol==='file:')throw new Error('この操作はHTMLの直接起動では使えません。BoundaryTool.vbs をダブルクリックし、開いた画面で操作してください。');
    const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Boundary-Token':token},body:body===undefined?undefined:JSON.stringify(body)});
    if(!response.ok){let data;try{data=await response.json();}catch(e){throw new Error('ローカルサービスに接続できません');}throw new Error(data.error||response.statusText);}
    return binary?response.blob():response.json();
  }
  function inputStatus(message,error=false){const el=$('pipeInputStatus');el.hidden=false;el.textContent=message;el.classList.toggle('pipe-ok',!error);}
  function handle(fn){return async()=>{try{await fn();}catch(e){status(e.message);inputStatus(e.message,true);}};}
  function setWorkflow(value){
    state.workflow=value; const on=value==='coupled'; document.body.classList.toggle('pipeline-mode',on); host.hidden=!on;
    $('flowCfd').setAttribute('aria-pressed',String(!on)); $('flowCoupled').setAttribute('aria-pressed',String(on));
    if(on&&state.source==='architrend'){$('pipeAtHost').append($('atPanel')); if(appMode!=='architrend')selectMode('architrend');}
    else atAnchor.after($('atPanel'));
    window.boundaryJourneyPlaceSource?.();
    renderSource(); persist();
  }
  function renderSource(){const at=state.source==='architrend'; $('pipeSourceAt').setAttribute('aria-pressed',String(at)); $('pipeSourceRhino').setAttribute('aria-pressed',String(!at)); $('pipeAtHost').hidden=!at; $('pipeRhinoInput').hidden=at; $('pipeBuildAt').hidden=!at; $('pipeAtNote').hidden=!at;}
  function source(value){state.source=value; setWorkflow('coupled');}
  function hydrate(model){
    if(model.schemaVersion!==1)throw new Error('建物JSONのバージョンが不明です');
    if(!['m','mm','cm'].includes(model.units))throw new Error('建物JSONの単位が不明です');
    const scale={m:1,mm:.001,cm:.01}[model.units];
    model.sourceTransform=model.sourceTransform||{units:model.units,scaleToMetres:scale,origin:[0,0,0]};
    for(const key of ['surfaces','openings','shades']){model[key]=model[key]||[]; for(const s of model[key])s.vertices=s.vertices.map(p=>p.map(x=>x*scale));}
    model.units='m'; model.north=model.north||0;
    if(!defaults)throw new Error('ローカルサービスを起動してください');
    model.settings=Object.assign(clone(defaults.settings),model.settings||{});
    model.constructions=Object.assign(clone(defaults.constructions),model.constructions||{});
    for(const [key,c] of Object.entries(model.constructions)){
      const template=defaults.constructions[key]||defaults.constructions.partition;
      if(!c.cfdMaterial)c.cfdMaterial=template.cfdMaterial||'2杉(1)';
      if(!(c.cfdThickness>0))c.cfdThickness=template.cfdThickness||.03;
    }
    for(const s of model.surfaces)s.construction=s.construction||(s.boundary==='Surface'?'partition':s.type==='Floor'?'floor':s.type==='Roof'?'roof':'wall');
    for(const s of model.openings)s.construction=s.construction||(s.type==='Door'?'door':'window');
    if(model.settings.reviewed&&!model.setupReview)confirmAllBoundarySetupFields(model);
    state.model=model; selectedFace=null; result=null; state.flows={}; changed();render();
  }
  function table(headers,rows){return '<table><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(x=>'<tr>'+x.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
  function number(value,attrs){return '<input type="number" step="any" value="'+esc(value==null?0:value)+'" '+attrs+'>';}
  function textInput(value,attrs){return '<input value="'+esc(value==null?'':value)+'" '+attrs+'>';}
  function optNumber(value,attrs){return '<input type="number" step="any" placeholder="未入力" value="'+(value==null?'':esc(value))+'" '+attrs+'>';}
  function options(items,value){return items.map(([id,name])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(name)+'</option>').join('');}
  function constructionKind(c){
    if(c.kind==='layers'||c.kind==='glazing'||c.kind==='nomass') return c.kind;
    if(c.u!=null && !c.layers) return 'glazing';
    if(c.resistance!=null && !c.layers) return 'nomass';
    return 'layers';
  }
  function constructionPerf(c){
    const kind=constructionKind(c);
    if(kind==='glazing') return {kind,u:+c.u};
    const r=kind==='nomass'?+c.resistance:(c.layers||[]).reduce((sum,l)=>sum+(+l.conductivity>0?+l.thickness/+l.conductivity:NaN),0);
    return {kind,r,uOut:1/(r+.15),uIn:1/(r+.22)};
  }
  function fmt3(n){return Number.isFinite(+n)?(+n).toFixed(3):'—';}
  function layerVisible(l){if(l.visibleAbsorptance!=null) return l.visibleAbsorptance; if(l.solarAbsorptance!=null) return l.solarAbsorptance; return .7;}
  function constructionSummary(m,id){
    const c=m.constructions[id], p=constructionPerf(c), n=[...m.surfaces,...m.openings].filter(s=>s.construction===id).length, memo=c.label?c.label+'  ':'';
    if(p.kind==='glazing') return id+'  '+memo+'SimpleGlazing  U '+fmt3(c.u)+'  SHGC '+fmt3(c.shgc)+'  VT '+fmt3(c.visibleTransmittance)+'  割当 '+n+'面';
    if(p.kind==='nomass') return id+'  '+memo+'NoMass  R '+fmt3(c.resistance)+'  外気側の参考U '+fmt3(p.uOut)+'  室内側の参考U '+fmt3(p.uIn)+'  割当 '+n+'面';
    return id+'  '+memo+'多層'+(c.layers||[]).length+'  材料R '+fmt3(p.r)+'  外気側の参考U '+fmt3(p.uOut)+'  室内側の参考U '+fmt3(p.uIn)+'  割当 '+n+'面';
  }
  function idfSheet(m){
    const s=m.settings, lines=['Construction'];
    for(const id of Object.keys(m.constructions)) lines.push(constructionSummary(m,id));
    lines.push('', '設定温度  暖房 '+(s.heating)+' ℃ / 冷房 '+(s.cooling)+' ℃    活動量 '+(s.activityW??120)+' W/人    人体放射 '+(s.peopleRadiant??.3)+'    照明放射 '+(s.lightsRadiant??0)+'    機器放射 '+(s.equipmentRadiant??.3)+'    機器潜熱 '+(s.equipmentLatent??0));
    lines.push('地中温度 '+s.groundTemperature+' ℃ を12か月に書きます。');
    if((s.hvacMode||'hourly')==='season'){
      const span=list=>(list||[]).map(p=>p.startMonth+'/'+p.startDay+'–'+p.endMonth+'/'+p.endDay).join('、')||'なし';
      lines.push('暖房の運転期間 '+span(s.heatingPeriods));
      lines.push('冷房の運転期間 '+span(s.coolingPeriods));
      lines.push('IdealLoads の Availability は空調の24時間スケジュール、Heating Availability と Cooling Availability は上の期間です。');
    }else lines.push('IdealLoads の Availability は空調の24時間スケジュールです。暖房と冷房の期間は分けていません。');
    const extra=[];
    if(s.maxHeatingSupply!=null) extra.push('加熱供給上限 '+s.maxHeatingSupply+' ℃');
    if(s.minCoolingSupply!=null) extra.push('冷却供給下限 '+s.minCoolingSupply+' ℃');
    if(s.maxHeatingHumidity!=null) extra.push('加熱湿度比 '+s.maxHeatingHumidity);
    if(s.minCoolingHumidity!=null) extra.push('冷却湿度比 '+s.minCoolingHumidity);
    if(s.coolingSHR!=null) extra.push('顕熱比 '+s.coolingSHR+'（ConstantSensibleHeatRatio）');
    lines.push(extra.length?extra.join('、'):'供給温度・湿度比・顕熱比は未設定です。能力制限は NoLimit です。');
    lines.push('');
    for(const r of m.rooms){
      const light=r.lightsWm2==null?'照明は未入力':('照明 '+r.lightsWm2+' W/m²');
      const equip=r.equipmentWm2==null?('機器 '+((r.equipmentW)||0)+' W'):('機器 '+r.equipmentWm2+' W/m²（合計Wは使いません）');
      const inf=r.infiltrationACH==null?'漏気は未入力':('漏気 '+r.infiltrationACH+' 回/h');
      lines.push((r.name||r.id)+'  人数 '+(r.people||0)+'  '+light+'  '+equip+'  換気 '+(r.ventilationACH||0)+' 回/h  '+inf+(r.conditioned===false?'  非空調':''));
    }
    return lines.join('\n');
  }
  function refreshSheet(){if(state.model) $('pipeIdfSheet').textContent=idfSheet(state.model);setupGuide.render();}
  function paintSummary(key){const el=document.querySelector('[data-const-summary="'+CSS.escape(key)+'"]'); if(el&&state.model) el.textContent=constructionSummary(state.model,key); refreshSheet();}
  function markThermal(){if(!state.model) return; state.model.settings.reviewed=false; $('pipeReviewed').checked=false; changed();}
  function blankLayer(){return {name:'Layer',thickness:.012,conductivity:.14,density:600,specificHeat:1600,thermalAbsorptance:.9,solarAbsorptance:.7,visibleAbsorptance:.7};}
  function freshId(base){let id=base,n=2; while(state.model.constructions[id]) id=base+'_'+(n++); return id;}
  function periodsHtml(m){
    if((m.settings.hvacMode||'hourly')!=='season') return '';
    const block=(key,title)=>{
      const list=m.settings[key]||[];
      return '<h3>'+title+'</h3>'+list.map((p,i)=>'<div class="pipe-row">'+[['startMonth','開始月'],['startDay','開始日'],['endMonth','終了月'],['endDay','終了日']].map(([part,label])=>'<label>'+label+'<input type="number" min="1" max="31" step="1" data-period="'+key+'" data-index="'+i+'" data-part="'+part+'" value="'+esc(p[part])+'"></label>').join('')+'<button type="button" data-remove-period="'+key+'" data-index="'+i+'">この期間を削除</button></div>').join('')+'<button type="button" data-add-period="'+key+'">期間を追加</button>';
    };
    return block('heatingPeriods','暖房の運転期間')+block('coolingPeriods','冷房の運転期間');
  }
  function scheduleHtml(m){
    const rows=[['peopleSchedule','在室 People'],['lightsSchedule','照明 Lights'],['equipmentSchedule','機器'],['ventilationSchedule','換気'],['infiltrationSchedule','漏気'],['hvacSchedule','空調の可用性']];
    const head='<tr><th>時</th>'+Array.from({length:24},(_,h)=>'<th>'+h+'</th>').join('')+'</tr>';
    const body=rows.map(([key,name])=>{const own=m.settings[key]; const vals=(Array.isArray(own)&&own.length===24)?own:(defaults&&defaults.settings[key])||[]; return '<tr><th>'+esc(name)+'</th>'+Array.from({length:24},(_,h)=>'<td><input type="number" min="0" max="1" step="any" data-schedule="'+key+'" data-hour="'+h+'" value="'+esc(vals[h]==null?'':vals[h])+'" aria-label="'+esc(name+' '+h+'時')+'"></td>').join('')+'</tr>';}).join('');
    return '<table><thead>'+head+'</thead><tbody>'+body+'</tbody></table>';
  }
  function materialsHtml(m){
    return Object.entries(m.constructions).map(([key,c])=>{
      const kind=constructionKind(c), mat='data-material="'+esc(key)+'"';
      let body;
      if(kind==='glazing') body='<div class="pipe-row">'+[['u','U値 W/m²K'],['shgc','日射熱取得率 SHGC'],['visibleTransmittance','可視光透過率']].map(([k,label])=>'<label>'+label+number(c[k],mat+' data-key="'+k+'"')+'</label>').join('')+'</div>';
      else if(kind==='nomass') body='<div class="pipe-row">'+[['resistance','熱抵抗 m²K/W',c.resistance],['thermalAbsorptance','長波放射率',c.thermalAbsorptance??.9],['solarAbsorptance','日射吸収率',c.solarAbsorptance??.7],['visibleAbsorptance','可視吸収率',c.visibleAbsorptance!=null?c.visibleAbsorptance:(c.solarAbsorptance??.7)]].map(([k,label,value])=>'<label>'+label+number(value,mat+' data-key="'+k+'"')+'</label>').join('')+'</div>';
      else {
        body='<div class="pipe-scroll">'+table(['材料名','厚み m','熱伝導率','密度','比熱','長波放射率','日射吸収率','可視吸収率',''],(c.layers||[]).map((l,j)=>{
          const a=mat+' data-layer="'+j+'"';
          return [textInput(l.name||'',a+' data-key="name" aria-label="材料名"'),...['thickness','conductivity','density','specificHeat'].map(k=>number(l[k],a+' data-key="'+k+'"')),number(l.thermalAbsorptance??.9,a+' data-key="thermalAbsorptance"'),number(l.solarAbsorptance??.7,a+' data-key="solarAbsorptance"'),number(layerVisible(l),a+' data-key="visibleAbsorptance"'),c.layers.length>1?'<button type="button" data-remove-layer="'+esc(key)+'" data-index="'+j+'">層を削除</button>':''];
        }))+'</div><button type="button" data-add-layer="'+esc(key)+'">層を追加</button>';
      }
      return '<details class="pipe-const" open><summary><span data-const-summary="'+esc(key)+'">'+esc(constructionSummary(m,key))+'</span></summary><div class="pipe-row"><label>構成名（Construction）<input data-rename="'+esc(key)+'" value="'+esc(key)+'"></label><label>メモ'+textInput(c.label||'',mat+' data-key="label"')+'</label></div>'+body+'<p class="pipe-note">内壁へ使うときの FlowDesigner 材質と疑似厚みです。EPの層構成とは別です。</p><div class="pipe-row"><label>FlowDesignerの材質名'+textInput(c.cfdMaterial||'',mat+' data-key="cfdMaterial"')+'</label><label>CFD疑似厚み m'+number(c.cfdThickness,mat+' data-key="cfdThickness"')+'</label></div><div class="pipe-row"><button type="button" data-copy-construction="'+esc(key)+'">この構成を複製</button><button type="button" data-delete-construction="'+esc(key)+'">この構成を削除</button></div></details>';
    }).join('');
  }
  function render(){
    const m=state.model;if(!m){setupGuide.render();updateButtons();return;}
    $('pipeNorth').value=m.north;
    $('pipeRooms').innerHTML=table(['部屋','空調','人数','照明 W/m²','機器 W','機器 W/m²','換気 回/h','漏気 回/h'],m.rooms.map((r,i)=>['<input data-room="'+i+'" data-key="name" value="'+esc(r.name||r.id)+'" aria-label="部屋名">','<input type="checkbox" data-room="'+i+'" data-key="conditioned" '+(r.conditioned!==false?'checked':'')+' aria-label="空調対象">',number(r.people,'data-room="'+i+'" data-key="people" aria-label="人数"'),optNumber(r.lightsWm2,'data-room="'+i+'" data-key="lightsWm2" data-optional="1" aria-label="照明"'),number(r.equipmentW,'data-room="'+i+'" data-key="equipmentW" aria-label="機器W"'),optNumber(r.equipmentWm2,'data-room="'+i+'" data-key="equipmentWm2" data-optional="1" aria-label="機器W/m²"'),number(r.ventilationACH,'data-room="'+i+'" data-key="ventilationACH" aria-label="換気"'),optNumber(r.infiltrationACH,'data-room="'+i+'" data-key="infiltrationACH" data-optional="1" aria-label="漏気"')]));
    const constructs=Object.entries(m.constructions).map(([id,c])=>[id,id+(c.label?'  '+c.label:'')]);
    const items=[...m.surfaces.map(s=>({s,kind:'surfaces'})),...m.openings.map(s=>({s,kind:'openings'}))];
    $('pipeFaces').innerHTML=table(['面・開口','所属／親面','種別','境界','隣接面／開口','材料'],items.map(({s,kind})=>{
      const attr='data-face="'+esc(s.id)+'" data-kind="'+kind+'"';
      const sel=(key,choices)=>'<select '+attr+' data-key="'+key+'" aria-label="'+esc(s.id+' '+key)+'">'+options(choices,s[key]||'')+'</select>';
      return ['<button type="button" data-edit-face="'+esc(s.id)+'">'+esc(s.id)+'</button>',sel(kind==='surfaces'?'roomId':'surfaceId',kind==='surfaces'?m.rooms.map(r=>[r.id,r.name||r.id]):[['','未割当'],...m.surfaces.map(f=>[f.id,f.id])]),sel('type',(kind==='surfaces'?['Wall','Floor','Roof','Ceiling']:['Window','Door']).map(x=>[x,({Wall:'壁',Floor:'床',Roof:'屋根',Ceiling:'天井',Window:'窓',Door:'ドア'})[x]])),kind==='surfaces'?sel('boundary',['Outdoors','Ground','Surface','Adiabatic'].map(x=>[x,({Outdoors:'外気に接する',Ground:'地盤に接する',Surface:'別の部屋に接する',Adiabatic:'熱を通さない'})[x]])):'—',sel(kind==='surfaces'?'adjacentSurfaceId':'adjacentOpeningId',[['','なし'],...(kind==='surfaces'?m.surfaces:m.openings).filter(x=>x.id!==s.id).map(x=>[x.id,x.id])]),sel('construction',constructs)];
    }));
    $('pipeModelEditor').value=JSON.stringify(m,null,2);
    $('pipeHeating').value=m.settings.heating; $('pipeCooling').value=m.settings.cooling; $('pipeGround').value=m.settings.groundTemperature; $('pipeActivity').value=m.settings.activityW??120; $('pipePeopleRadiant').value=m.settings.peopleRadiant??.3; $('pipeLightsRadiant').value=m.settings.lightsRadiant??0; $('pipeEquipRadiant').value=m.settings.equipmentRadiant??.3; $('pipeEquipLatent').value=m.settings.equipmentLatent??0; $('pipeReviewed').checked=!!m.settings.reviewed;
    $('pipeHvacMode').value=m.settings.hvacMode||'hourly';
    [['pipeHeatSupply','maxHeatingSupply'],['pipeCoolSupply','minCoolingSupply'],['pipeHeatHumid','maxHeatingHumidity'],['pipeCoolHumid','minCoolingHumidity'],['pipeShr','coolingSHR']].forEach(([id,key])=>{$(id).value=m.settings[key]==null?'':m.settings[key];});
    $('pipePeriods').innerHTML=periodsHtml(m);
    $('pipeSchedules').innerHTML=scheduleHtml(m);
    $('pipeMaterials').innerHTML=materialsHtml(m);
    $('pipeIdfSheet').textContent=idfSheet(m);
    $('pipeTargetRoom').innerHTML=options([['','建物全体'],...m.rooms.map(r=>[r.id,r.name||r.id])],$('pipeTargetRoom').value);
    renderAtImport();setupGuide.render();preview();renderResults();updateButtons();
  }
  const ghostViewer=createBoundaryGhostViewer($('pipeGhost'),editFace);
  function preview(){ghostViewer.update(state.model);}
  function editFace(id){const s=[...state.model.surfaces,...state.model.openings,...state.model.shades].find(f=>f.id===id);if(!s)return;selectedFace=id;$('pipeFaceEditor').hidden=false;$('pipeFaceTitle').textContent=id;$('pipeVertices').value=s.vertices.map(p=>p.join(' ')).join('\n');preview();}
  async function validate(){
    if(!state.model)throw new Error('モデルを読み込んでください');
    const check=await api('/api/validate',{model:state.model,thermal:true});
    $('pipeValidation').textContent=check.errors.length?check.errors.join('\n'):'形状と材料の割当を確認しました。';$('pipeValidation').classList.toggle('pipe-ok',!check.errors.length);
    $('pipeGeometrySummary').textContent=check.rooms.map(r=>r.name+': '+r.volume.toFixed(2)+' m³ / '+r.floorArea.toFixed(2)+' m²').join('、');
    return check;
  }
  async function buildAt(){
    if(typeof atMesh==='undefined'||!atMesh)throw new Error('3DS本体がまだ読み込まれていません。上の3DSファイル選択で元のファイルを選び直してください。保存済みの部屋割当だけでは建物を作れません。');
    if(!atMesh.rooms||!atMesh.rooms.length)throw new Error('3DSから部屋を見つけられませんでした。上の部屋確認で床と部屋の割当を確認してください。');
    inputStatus('部屋候補を作成しています…');
    atMesh.rooms=atNormalizeRoomStories(atMesh.rooms,atMesh.meshFaces);
    if(atMesh.reviewHash&&typeof atRenderRoomViewer==='function')atRenderRoomViewer();
    for(const r of atMesh.rooms){
      if(!Array.isArray(r.ring)||r.ring.length<3||r.ring.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))||!Number.isFinite(r.z)||!Number.isFinite(r.zTop)||r.zTop<=r.z)
        throw new Error((r.name||r.key||'部屋')+'の床輪郭または高さが不正です。上の部屋確認で修正してください。');
    }
    const m={schemaVersion:1,source:'architrend',units:'m',north:typeof atNorthDeg==='function'?atNorthDeg():0,rooms:[],surfaces:[],openings:[],shades:[],settings:{reviewed:false}};
    for(const [i,r] of atMesh.rooms.entries()){
      const rid='AT_R'+(i+1);const ring=r.ring.map(p=>[p.x,p.y]);
      let area=0;for(let j=0;j<ring.length;j++){const a=ring[j],b=ring[(j+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];}if(area<0)ring.reverse();
      const card=[...document.querySelectorAll('.room-card')].find(c=>c.dataset.atRoomKey===r.key);
      const value=cls=>card&&card.querySelector('.'+cls)?Number(card.querySelector('.'+cls).value)||0:0;
      m.rooms.push({id:rid,sourceId:r.key,floor:r.floor,name:r.name||rid,conditioned:!!r.habitable,people:value('occCount'),equipmentW:value('equipSensRate')*(r.area||0),ventilationACH:0});
      const bottom=ring.map(p=>[...p,r.z]),top=ring.map(p=>[...p,r.zTop]);
      m.surfaces.push({id:rid+'_F',roomId:rid,type:'Floor',boundary:'Outdoors',vertices:bottom.slice().reverse()},{id:rid+'_R',roomId:rid,type:'Roof',boundary:'Outdoors',vertices:top});
      for(let j=0;j<ring.length;j++){const k=(j+1)%ring.length;m.surfaces.push({id:rid+'_W'+j,roomId:rid,type:'Wall',boundary:'Outdoors',vertices:[bottom[j],bottom[k],top[k],top[j]]});}
    }
    const vec=p=>[p.x,p.y,p.z];
    for(const [i,f] of (atMesh.meshFaces||[]).entries()){
      if(f.kind!=='window'&&f.sslKey!=='window')continue;
      const vs=f.verts.map(vec); let match=null;
      for(const s of m.surfaces){
        const a=s.vertices[0],b=s.vertices[1],c=s.vertices[2];const u=b.map((x,j)=>x-a[j]),v=c.map((x,j)=>x-a[j]);const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);
        if(!len)continue;
        const near=vs.every(p=>Math.abs(p.reduce((sum,x,j)=>sum+(x-a[j])*n[j],0)/len)<.15);
        if(near&&vs.every(p=>p.every((x,j)=>x>=Math.min(...s.vertices.map(q=>q[j]))-.15&&x<=Math.max(...s.vertices.map(q=>q[j]))+.15))){
          const projected=vs.map(p=>{const dist=p.reduce((sum,x,j)=>sum+(x-a[j])*n[j],0)/(len*len);return p.map((x,j)=>x-dist*n[j]);});
          const pn=idfMeshNewell(projected.map(p=>({x:p[0],y:p[1],z:p[2]})));if(pn.x*n[0]+pn.y*n[1]+pn.z*n[2]<0)projected.reverse();
          if(match){match=null;break;}match={id:'AT_WIN'+i,sourceId:f.atFaceId||f.idfName,surfaceId:s.id,type:'Window',vertices:projected};
        }
      }
      m.openings.push(match||{id:'AT_WIN'+i,surfaceId:'',type:'Window',vertices:vs});
    }
    hydrate(m);
    captureAtSources();
    $('pipeGeometrySummary').textContent=m.rooms.length+'室の部屋候補を表示しました。隣接面・熱条件は未検証です。';
    await serviceReady;
    if(!token){
      syncAtModel(true);
      inputStatus('部屋候補を表示しました。02で形を確認できます。隣接面の処理・検証・IDF保存には BoundaryTool.vbs から起動してください。直接開いた画面の設定は「建物JSONを書き出す」で保存し、起動後に読み込めます。',true);
      return;
    }
    const paired=await api('/api/pair',{model:state.model});state.model=paired.model;
    for(const s of state.model.surfaces)if(s.boundary==='Surface')s.construction='partition';
    syncAtModel(true);changed();render();status('部屋候補を作成しました。床の地盤／外気、屋根勾配、開口、人数・発熱を確認してください。');
    const check=await validate();
    inputStatus(check.valid?'部屋候補を作成しました。下の「02 部屋・面」に建物を表示しています。': '部屋候補を表示しましたが、修正が必要です。02の検証結果を確認してください。',!check.valid);
  }
  function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function poll(){
    clearTimeout(pollTimer);if(!state.job)return;
    const job=await api('/api/jobs/'+state.job.id);state.job=job;status(job.status+' — '+job.message+(stale()?'\n入力変更のため再計算が必要です':''));persist();
    if(job.status==='complete'){
      result=await api('/api/jobs/'+job.id+'/result');
      $('pipeTimeSelect').innerHTML=result.times.map((t,i)=>'<option value="'+i+'">'+t.month+'/'+t.day+' '+t.hour+':00</option>').join('');
      if(!state.selectionSaved)peak('cooling'); else renderResults();
    }else if(['queued','running'].includes(job.status))pollTimer=setTimeout(()=>poll().catch(e=>status(e.message)),1500);
    updateButtons();
  }
  function peak(kind){if(!result)return;const room=$('pipeTargetRoom').value;const ids=room?[room]:Object.keys(result.rooms);let max=-Infinity,best=0;for(let i=0;i<result.times.length;i++){const val=ids.reduce((sum,id)=>sum+result.rooms[id][kind][i],0);if(val>max){max=val;best=i;}}state.index=best;state.selectionSaved=true;renderResults();persist();}
  function renderResults(){
    if(!result||!state.runSignature){$('pipeResults').innerHTML='';$('pipeFlows').innerHTML='';$('pipeTimeSelect').innerHTML='';updateButtons();return;}const resultModel=JSON.parse(state.runSignature);state.index=Math.min(state.index,result.times.length-1);$('pipeTimeSelect').value=state.index;
    const target=$('pipeTargetRoom').value;$('pipeTargetRoom').innerHTML=options([['','建物全体'],...resultModel.rooms.map(r=>[r.id,r.name||r.id])],target);
    const i=state.index;const fixed=x=>Number(x).toFixed(2);
    $('pipeResults').innerHTML=table(['部屋','室温 ℃','冷房 W','暖房 W','対流発熱 W','潜熱 W'],resultModel.rooms.map(r=>{const v=result.rooms[r.id];return [esc(r.name||r.id),...['airTemperature','cooling','heating','convectiveGain','latentGain'].map(k=>fixed(v[k][i]))];}));
    $('pipeFlows').innerHTML=table(['部屋','給気','還気','外気','排気','EP外気目安','吹出温度 ℃','参考温度 ℃'],resultModel.rooms.map(r=>{
      const volume=(result.geometry||[]).find(g=>g.id===r.id)?.volume||0;
      const vent=(r.ventilationACH||0)*volume*resultModel.settings.ventilationSchedule[result.times[i].hour-1];
      const f=state.flows[r.id]||(state.flows[r.id]={supplyM3h:0,returnM3h:0,outdoorM3h:vent,exhaustM3h:vent,supplyTemperature:18});const v=result.rooms[r.id];const dt=(v.heating[i]-v.cooling[i])/(1.2*1006*(f.supplyM3h/3600));
      return [esc(r.name||r.id),...['supplyM3h','returnM3h','outdoorM3h','exhaustM3h'].map(k=>number(f[k],'data-flow-room="'+esc(r.id)+'" data-key="'+k+'" aria-label="'+esc((r.name||r.id)+' '+k)+'"')),fixed(vent),number(f.supplyTemperature,'data-flow-room="'+esc(r.id)+'" data-key="supplyTemperature" aria-label="'+esc(r.id+' 吹出温度')+'"'),f.supplyM3h>0?fixed(v.airTemperature[i]+dt):'風量を入力'];
    }));
    updateButtons();
  }
  $('flowCfd').onclick=()=>setWorkflow('cfd');$('flowCoupled').onclick=()=>setWorkflow('coupled');$('pipeSourceAt').onclick=()=>source('architrend');$('pipeSourceRhino').onclick=()=>source('rhino');
  $('pipeModelFile').onchange=handle(async()=>{const f=$('pipeModelFile').files[0];if(f)hydrate(JSON.parse(await f.text()));});
  $('pipeSample').onclick=handle(async()=>{const r=await fetch('samples/single-room.json');hydrate(await r.json());});
  $('pipeSyncAt').onclick=handle(()=>syncAtModel());
  window.addEventListener('architrend-data-ready',()=>{try{syncAtModel();}catch(e){inputStatus('資料の反映を確認してください: '+e.message,true);}});
  function invalidateArchitrendSource(){
    if(state.source!=='architrend'&&state.model?.source!=='architrend')return;
    state.architrendSources=null;state.job=null;state.runSignature='';result=null;categoryCsv='';
    if(state.model?.source==='architrend')state.model=null;
    persist();updateButtons();
    inputStatus('入力を読み直しています。現在の資料を確認してモデルを作成し直してください。',true);
  }
  window.addEventListener('architrend-import-invalidated',invalidateArchitrendSource);
  window.addEventListener('architrend-model-invalidated',invalidateArchitrendSource);
  $('pipeBuildAt').onclick=handle(async()=>{const button=$('pipeBuildAt');button.disabled=true;try{await buildAt();}finally{button.disabled=false;}});$('pipeValidate').onclick=handle(validate);
  $('pipePair').onclick=handle(async()=>{const data=await api('/api/pair',{model:state.model});state.model=data.model;for(const s of state.model.surfaces)if(s.boundary==='Surface')s.construction='partition';changed();render();await validate();});
  function ensureSchedule(key){if(!Array.isArray(state.model.settings[key])||state.model.settings[key].length!==24) state.model.settings[key]=(defaults&&defaults.settings[key]?defaults.settings[key].slice():Array(24).fill(1));}
  $('pipeRooms').onchange=e=>{if(!state.model)return;const t=e.target;if(!t.dataset.key)return;const room=state.model.rooms[+t.dataset.room]; if(t.dataset.optional) room[t.dataset.key]=t.value===''?null:+t.value; else if(t.type==='checkbox') room[t.dataset.key]=t.checked; else if(t.type==='number') room[t.dataset.key]=+t.value; else room[t.dataset.key]=t.value; if(room.lightsWm2!=null) ensureSchedule('lightsSchedule'); if(room.infiltrationACH!=null) ensureSchedule('infiltrationSchedule'); markThermal(); refreshSheet();};
  $('pipeFaces').onchange=e=>{const t=e.target;if(!t.dataset.face)return;const s=state.model[t.dataset.kind].find(x=>x.id===t.dataset.face);s[t.dataset.key]=t.value;markThermal();refreshSheet();};
  $('pipeFaces').onclick=e=>{const b=e.target.closest('[data-edit-face]');if(b)editFace(b.dataset.editFace);};

  $('pipeApplyVertices').onclick=handle(async()=>{const vs=$('pipeVertices').value.trim().split(/\r?\n/).map(l=>l.trim().split(/[ ,]+/).map(Number));if(vs.length<3||vs.some(p=>p.length!==3||p.some(x=>!Number.isFinite(x))))throw new Error('各行にXYZの3数値を入力してください');const s=[...state.model.surfaces,...state.model.openings,...state.model.shades].find(x=>x.id===selectedFace);s.vertices=vs;changed();render();});
  $('pipeApplyModel').onclick=handle(async()=>hydrate(JSON.parse($('pipeModelEditor').value)));
  $('pipeSaveModel').onclick=()=>download(new Blob([JSON.stringify(state.model,null,2)],{type:'application/json'}),'boundary-building.json');
  [['pipeNorth','north'],['pipeHeating','heating'],['pipeCooling','cooling'],['pipeGround','groundTemperature'],['pipeActivity','activityW'],['pipePeopleRadiant','peopleRadiant'],['pipeLightsRadiant','lightsRadiant'],['pipeEquipRadiant','equipmentRadiant'],['pipeEquipLatent','equipmentLatent']].forEach(([id,key])=>$(id).onchange=()=>{if(!state.model)return;if(key==='north'){state.model.north=+$(id).value;changed();}else{state.model.settings[key]=+$(id).value;markThermal();refreshSheet();}});
  [['pipeHeatSupply','maxHeatingSupply'],['pipeCoolSupply','minCoolingSupply'],['pipeHeatHumid','maxHeatingHumidity'],['pipeCoolHumid','minCoolingHumidity'],['pipeShr','coolingSHR']].forEach(([id,key])=>$(id).onchange=()=>{if(!state.model)return;state.model.settings[key]=$(id).value===''?null:+$(id).value;markThermal();refreshSheet();});
  $('pipeHvacMode').onchange=()=>{if(!state.model)return;state.model.settings.hvacMode=$('pipeHvacMode').value;if(state.model.settings.hvacMode==='season'){if(!(state.model.settings.heatingPeriods||[]).length) state.model.settings.heatingPeriods=[{startMonth:1,startDay:1,endMonth:1,endDay:31}]; if(!(state.model.settings.coolingPeriods||[]).length) state.model.settings.coolingPeriods=[{startMonth:6,startDay:1,endMonth:9,endDay:30}];} markThermal();render();};
  $('pipeIworksHvac').onclick=()=>{if(!state.model)return;Object.assign(state.model.settings,{heating:24,cooling:26,hvacMode:'season',heatingPeriods:[{startMonth:1,startDay:1,endMonth:4,endDay:16},{startMonth:11,startDay:9,endMonth:12,endDay:31}],coolingPeriods:[{startMonth:5,startDay:6,endMonth:10,endDay:18}],maxHeatingSupply:50,minCoolingSupply:13,maxHeatingHumidity:.0156,minCoolingHumidity:.0077,coolingSHR:.7,peopleRadiant:.3,lightsRadiant:0,equipmentRadiant:0,equipmentLatent:0});markThermal();render();};
  $('pipeAddLayers').onclick=()=>addConstruction('layers');
  $('pipeAddGlazing').onclick=()=>addConstruction('glazing');
  $('pipeAddNomass').onclick=()=>addConstruction('nomass');
  $('pipeReviewed').onchange=()=>{if(state.model){state.model.settings.reviewed=$('pipeReviewed').checked;if(state.model.settings.reviewed)confirmAllBoundarySetupFields(state.model);changed();setupGuide.render();}};
  $('pipeSchedules').onchange=e=>{const t=e.target;if(!t.dataset.schedule||!state.model)return;ensureSchedule(t.dataset.schedule);const arr=state.model.settings[t.dataset.schedule].slice();arr[+t.dataset.hour]=+t.value;state.model.settings[t.dataset.schedule]=arr;markThermal();refreshSheet();};
  $('pipePeriods').onchange=e=>{const t=e.target;if(!t.dataset.period)return;state.model.settings[t.dataset.period][+t.dataset.index][t.dataset.part]=+t.value;markThermal();refreshSheet();};
  $('pipePeriods').onclick=e=>{if(!state.model)return;const add=e.target.closest('[data-add-period]'),rm=e.target.closest('[data-remove-period]');if(add){state.model.settings[add.dataset.addPeriod].push({startMonth:1,startDay:1,endMonth:1,endDay:31});markThermal();render();}if(rm){const list=state.model.settings[rm.dataset.removePeriod];list.splice(+rm.dataset.index,1);if(!list.length) list.push({startMonth:1,startDay:1,endMonth:1,endDay:31});markThermal();render();}};
  $('pipeMaterials').onchange=e=>{const t=e.target;if(!state.model)return;if(t.dataset.rename){renameConstruction(t.dataset.rename,t.value);return;}if(!t.dataset.material)return;const c=state.model.constructions[t.dataset.material];const host=t.dataset.layer===undefined?c:c.layers[+t.dataset.layer];const text=t.dataset.key==='cfdMaterial'||t.dataset.key==='label'||t.dataset.key==='name';host[t.dataset.key]=text?t.value:+t.value;if(t.dataset.key==='solarAbsorptance'&&host.visibleAbsorptance==null){const vis=(t.closest('tr')||t.closest('.pipe-row'))?.querySelector('[data-key="visibleAbsorptance"]'); if(vis) vis.value=t.value;} markThermal();paintSummary(t.dataset.material);};
  $('pipeMaterials').onclick=e=>{if(!state.model)return;const t=e.target.closest('button');if(!t)return;if(t.dataset.addLayer){state.model.constructions[t.dataset.addLayer].layers.push(blankLayer());markThermal();render();}if(t.dataset.removeLayer){const layers=state.model.constructions[t.dataset.removeLayer].layers;if(layers.length>1) layers.splice(+t.dataset.index,1);markThermal();render();}if(t.dataset.copyConstruction){state.model.constructions[freshId(t.dataset.copyConstruction)]=clone(state.model.constructions[t.dataset.copyConstruction]);markThermal();render();}if(t.dataset.deleteConstruction){const id=t.dataset.deleteConstruction;if([...state.model.surfaces,...state.model.openings].some(s=>s.construction===id)){$('pipeIdfSheet').textContent=id+' は面に割り当てられているので削除できません。先に別の構成へ付け替えてください。';return;}delete state.model.constructions[id];markThermal();render();}};
  function renameConstruction(oldId,raw){
    const id=String(raw||'').trim();
    if(!state.model||id===oldId) return;
    if(!id||id.includes(',')||id.includes(';')||state.model.constructions[id]){render();$('pipeIdfSheet').textContent='構成名は空にできず、カンマとセミコロンは使えません。既存の名前とも重なりません。\n\n'+idfSheet(state.model);return;}
    const next={}; for(const [k,v] of Object.entries(state.model.constructions)) next[k===oldId?id:k]=v;
    state.model.constructions=next;
    for(const s of [...state.model.surfaces,...state.model.openings]) if(s.construction===oldId) s.construction=id;
    markThermal(); render();
  }
  function addConstruction(kind){
    if(!state.model||!defaults) return;
    const cfd=defaults.constructions.partition, win=defaults.constructions.window, id=freshId(kind==='glazing'?'Window':kind==='nomass'?'D':'C');
    state.model.constructions[id]=kind==='glazing'?{label:'窓',kind:'glazing',u:1.5,shgc:.4,visibleTransmittance:.5,cfdMaterial:win.cfdMaterial,cfdThickness:win.cfdThickness}:kind==='nomass'?{label:'熱抵抗',kind:'nomass',resistance:.4,thermalAbsorptance:.9,solarAbsorptance:.7,visibleAbsorptance:.7,cfdMaterial:cfd.cfdMaterial,cfdThickness:cfd.cfdThickness}:{label:'多層',kind:'layers',layers:[blankLayer()],cfdMaterial:cfd.cfdMaterial,cfdThickness:cfd.cfdThickness};
    markThermal(); render();
  }
  $('pipeStart').onclick=handle(async()=>{
    if(!state.model?.settings.reviewed){setupGuide.showReview();status('03の「確認して保存」で、設定の確認チェックを入れてください。');return;}
    busy=true; updateButtons();
    try {
      const signature=currentSignature();
      const check=await validate();if(!check.valid){status('形状や入力を修正してから保存してください。'+check.errors.join(' / '));window.boundaryJourneyReveal?.($('pipeValidation'));$('pipeValidation').scrollIntoView({behavior:'smooth',block:'center'});return;}
      if(signature!==currentSignature())throw new Error('検証中に入力が変更されました。もう一度IDFを作成してください');
      const job=await api('/api/prepare',{model:check.model});
      if(signature===currentSignature())state.model=check.model;
      state.job=job;state.runSignature=JSON.stringify(check.model);state.weatherChanged=false;state.selectionSaved=false;result=null;
      $('pipeSqlConfirmed').checked=false;persist();renderResults();status(job.message);
      download(await api('/api/jobs/'+job.id+'/idf',undefined,true),'model.idf');
    } finally {busy=false;updateButtons();}
  });
  $('pipeShutdown').onclick=handle(async()=>{if(!token)return;if(!confirm('入力はブラウザに保存済みです。入力作成サービスを終了しますか？'))return;await api('/api/shutdown',{});clearTimeout(pollTimer);token='';$('pipeService').textContent='終了しました。再開時は BoundaryTool.vbs を開いてください。';updateButtons();});
  $('pipeSqlConfirmed').onchange=updateButtons;
  $('pipeSql').onchange=handle(async()=>{
    const file=$('pipeSql').files[0];if(!file)return;
    if(stale()||!$('pipeSqlConfirmed').checked)throw new Error('このIDFの実行結果であることを確認してください');
    if(file.size>512000000)throw new Error('SQLは512MB以下を指定してください');
    busy=true;updateButtons();status('SQLを確認しています…');
    try {
      const response=await fetch('/api/jobs/'+state.job.id+'/sql',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Boundary-Token':token},body:file});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'SQL取込に失敗しました');
      state.job=data;state.selectionSaved=false;persist();await poll();
    } finally {busy=false;$('pipeSql').value='';updateButtons();}
  });
  $('pipeArtifacts').onclick=handle(async()=>download(await api('/api/jobs/'+state.job.id+'/artifacts',undefined,true),'ep-run-'+state.job.id+'.zip'));
  $('pipeCoolPeak').onclick=()=>peak('cooling');$('pipeHeatPeak').onclick=()=>peak('heating');$('pipeTimeSelect').onchange=()=>{state.index=+$('pipeTimeSelect').value;state.selectionSaved=true;renderResults();persist();};
  $('pipeFlows').onchange=e=>{const t=e.target;if(t.dataset.flowRoom){state.flows[t.dataset.flowRoom][t.dataset.key]=+t.value;persist();renderResults();}};
  $('pipeCategory').onchange=handle(async()=>{const f=$('pipeCategory').files[0];if(f)categoryCsv=new TextDecoder('shift-jis').decode(await f.arrayBuffer());});
  $('pipeDownload').onclick=handle(async()=>{if(stale())throw new Error('再計算が必要です');const blob=await api('/api/jobs/'+state.job.id+'/export',{model:state.model,index:state.index,flows:state.flows,categoryCsv},true);download(blob,'ep-cfd-'+state.index+'.zip');$('pipeExportStatus').textContent=categoryCsv?'モデル・面別条件・objParam.csvを書き出しました。':'モデルと条件を出力しました。色対応CSVを読み込むとobjParam.csvも出力します。';});
  $('pipeResultDownload').onclick=()=>download(new Blob([JSON.stringify({model:JSON.parse(state.runSignature),result},null,2)],{type:'application/json'}),'ep-results.json');
  // Preserve old settings and keep full pipeline data in the normal JSON backup.
  const originalGather=gatherState; gatherState=function(){const s=originalGather();s.schemaVersion=3;s.pipeline=clone(state);return s;};
  importJSON=async function(input){try{const f=input.files[0];if(!f)return;const s=JSON.parse(await f.text());if(s.mode&&s.mode!==appMode)selectMode(s.mode);applyState(s);runAll();if(s.pipeline){state=Object.assign({version:1,flows:{}},clone(s.pipeline));result=null;if(!s.resume)restoreAtSources();setWorkflow(state.workflow||'cfd');render();if(token&&state.job)await poll();}}catch(e){alert('JSONの読み込みに失敗しました: '+e.message);}finally{input.value='';}};
  resetAll=function(){if(!confirm('現在の入力とEP連携の保存状態をリセットしますか？'))return;window.boundarySessionClear?.();localStorage.removeItem(KEY);['cfdBoundaryToolState_v2',STORE_KEY].forEach(key=>['','_manual','_architrend','_energyplus'].forEach(suffix=>localStorage.removeItem(key+suffix)));location.reload();};
  restoreAtSources();setWorkflow(state.workflow);render();
  const serviceReady=api('/api/health').then(data=>{token=data.token;defaults=data.defaults;$('pipeService').textContent='入力作成サービス接続済み / EnergyPlus 24.2用IDF / SQLは手動作成';if(state.model)render();else updateButtons();if(state.job&&token)return poll();}).catch(()=>{$('pipeService').textContent='部屋候補の表示・条件編集はこの画面で利用できます。検証・IDF保存は BoundaryTool.vbs から起動してください（CMD不要）。';updateButtons();});
  window.boundaryPipeline={getState:()=>clone(state),setWorkflow,hydrate,validate,buildAt,stale,render,syncAtModel};
})();

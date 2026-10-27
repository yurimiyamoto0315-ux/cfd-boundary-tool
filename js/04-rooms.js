// ========================= Step 2: 部屋 =========================
let roomCount=0, winCounter=0;
function addRoom(defaults){
  roomCount++;
  const id = 'room'+roomCount;
  const div = document.createElement('div');
  const isNonHabitable=!!(defaults&&defaults.isNonHabitable);
  div.className='room-card'+(isNonHabitable?' non-habitable':'');
  div.id = id;
  div.dataset.nonHabitable=isNonHabitable?'true':'false';
  if(defaults&&defaults.atRoomKey) div.dataset.atRoomKey=defaults.atRoomKey;
  if(defaults&&defaults.epZone) div.dataset.epZone=defaults.epZone;
  div.innerHTML =
    '<details class="gain-room-editor" name="gain-room-editors" data-gains-disclosure data-gain-panel="editor" id="'+id+'_editor"'+(!defaults||!defaults.skipRerun?' open':'')+'>'+
    '<summary><span class="gain-room-heading"><strong data-gain-name>'+escapeHtml(defaults&&defaults.name||('部屋'+roomCount))+'</strong><span data-gain-state></span></span><span class="gain-room-meta" data-gain-meta></span><span class="gain-room-total" data-gain-total></span><span class="gain-room-chevron" aria-hidden="true"></span></summary>'+
    '<div class="gain-room-body">'+
    '<div class="room-header">'+
      '<input type="text" class="roomName" aria-label="部屋名" value="'+escapeHtml(defaults&&defaults.name||('部屋'+roomCount))+'">'+
      (isNonHabitable?'<span class="room-kind">非居室・窓日射用</span>':'')+
      '<button class="small-btn" onclick="document.getElementById(\''+id+'\').remove(); runAll();">部屋を削除</button>'+
    '</div>'+
    '<h3>人数と家電・照明</h3>'+
    '<div class="row2 setting-basic-fields">'+
      '<div><label>在室人数<input type="number" class="occCount" value="0" step="1"></label></div>'+
      '<div><label>床面積 (㎡)<input type="number" class="roomArea" value="10.0" step="0.1"></label></div>'+
    '</div>'+
    '<section class="setting-assumptions" data-assumptions="room" aria-label="この部屋で使っている発熱・発湿の条件"></section>'+
    '<details class="setting-details" data-basic-detail="room">'+
      '<summary>詳細設定：人・家電の発熱と発湿、追加の負荷</summary>'+
      '<p class="setting-help">下の「1人あたり」「床1㎡あたり」の値を、在室人数・床面積に掛けて計算します。資料や使い方に合わせて調整できます。</p>'+
      '<div class="row2">'+
        '<div><label>1人あたりの発熱 (W/人)<input type="number" class="peopleSensRate" value="'+TOOL_DEFAULTS.peopleSensRate+'" step="1"></label></div>'+
        '<div><label>1人あたりの発湿 (g/h/人)<input type="number" class="peopleMoistRate" value="'+TOOL_DEFAULTS.peopleMoistRate+'" step="1"></label></div>'+
        '<div><label>家電・照明の発熱 (W/㎡)<input type="number" class="equipSensRate" value="'+TOOL_DEFAULTS.equipSensRate+'" step="0.5"></label></div>'+
        '<div><label>家電などの発湿 (g/h/㎡)<input type="number" class="equipMoistRate" value="'+TOOL_DEFAULTS.equipMoistRate+'" step="0.5"></label></div>'+
        '<div><label>追加の発熱 (W・任意)<input type="number" class="extraSens" value="0" step="1"></label></div>'+
        '<div><label>追加の発湿 (g/h・任意)<input type="number" class="extraMoist" value="0" step="1"></label></div>'+
      '</div>'+
      '<p class="setting-help">現在の人数：<span class="occCountEcho">0 人</span> ／ 床面積：<span class="areaEcho">0 ㎡</span></p>'+
      '<dl class="setting-room-results"><div><dt>人体の発熱</dt><dd class="peopleSensResult">0 W</dd></div><div><dt>人体の発湿</dt><dd class="peopleMoistResult">0 g/h</dd></div><div><dt>家電・照明の発熱</dt><dd class="equipSensResult">0 W</dd></div><div><dt>家電などの発湿</dt><dd class="equipMoistResult">0 g/h</dd></div></dl>'+
    '</details>'+

    '<details class="gain-windows setting-details" data-gains-disclosure data-gain-panel="windows" id="'+id+'_windows"><summary>窓と日射 <span data-gain-windows></span><span class="room-window-link"></span></summary>'+
    '<p class="setting-help">窓の面積・向き・日射の入りやすさ（η0）を確認します。読み込んだ値はそのまま使えます。</p><div class="winList"></div>'+
    '<button type="button" class="small-btn" onclick="addWindow(\''+id+'\')">+ 窓を追加</button></details>'+
    '<details class="gain-room-results setting-details" data-gains-disclosure data-gain-panel="results" id="'+id+'_results"><summary>計算の内訳・FDへの入力値</summary>'+
    '<div class="summary-grid" style="margin-top:1rem;" id="'+id+'_summary"></div>'+
    '<h3>CFDへの入力値 (発生エリア)</h3>'+
    '<div id="'+id+'_cfd"></div></details></div></details>';
  document.getElementById('roomsWrap').appendChild(div);
  if(defaults&&defaults.fields){
    for(const cls in defaults.fields){
      const el = div.querySelector('.'+cls);
      if(el) el.value = defaults.fields[cls];
    }
  }
  if(defaults&&defaults.windows){
    defaults.windows.forEach(w=>{
      const opts = defaults.skipRerun ? Object.assign({}, w, {skipRerun:true}) : w;
      addWindow(id, opts);
    });
  }
  if(!(defaults&&defaults.skipRerun)) runAll();
  return id;
}
function addWindow(roomId, defaults){
  winCounter++;
  const wid = 'win'+winCounter;
  const div = document.createElement('div');
  div.className='win-row';
  div.id = wid;
  if(defaults && defaults.atMeshWindowIndex!=null) div.dataset.atMeshWindowIndex=String(defaults.atMeshWindowIndex);
  if(defaults && defaults.atFaceId!=null) div.dataset.atFaceId=String(defaults.atFaceId);
  let glassOpts = etaTable.map((g,i)=>'<option value="'+i+'">'+g.label+'</option>').join('');
  let attachOpts = attachTable.map((a,i)=>'<option value="'+i+'">'+a+'</option>').join('');
  div.innerHTML =
    '<div><label>名前</label><input type="text" class="wName" value="窓"></div>'+
    '<div><label>方位 (南=0,東=-90,西=90)</label><input type="number" class="wAz" value="0" step="1"></div>'+
    '<div><label>ガラス仕様</label><select class="glassSel" onchange="updateEta(\''+wid+'\')">'+glassOpts+'</select></div>'+
    '<div><label>付属部材</label><select class="attachSel" onchange="updateEta(\''+wid+'\')">'+attachOpts+'</select></div>'+
    '<div><label>η0</label><input type="number" class="wEta" value="0.54" step="0.01"></div>'+
    '<div><label>面積 (㎡)</label><input type="number" class="wArea" value="1.0" step="0.1"></div>'+
    '<div><label>U (W/m²K)</label><input type="number" class="wU" value="" step="0.01" placeholder="共通"></div>'+
    '<div><label>疑似厚み</label><div class="result wDummy">—</div></div>'+
    '<div class="small wSolarHint" style="grid-column:1/-1;"></div>'+
    '<button class="small-btn" onclick="document.getElementById(\''+wid+'\').remove(); runAll();">削除</button>';
  document.getElementById(roomId).querySelector('.winList').appendChild(div);
  if(defaults){
    for(const cls in defaults){
      if(cls==='skipRerun' || cls==='atMeshWindowIndex' || cls==='atFaceId') continue;
      const el = div.querySelector('.'+cls);
      if(el) el.value = defaults[cls];
    }
  }
  if(!(defaults&&defaults.skipRerun)) runAll();
}
function updateEta(wid){
  const div = document.getElementById(wid);
  const gi = +div.querySelector('.glassSel').value;
  const ai = +div.querySelector('.attachSel').value;
  div.querySelector('.wEta').value = etaTable[gi].vals[ai];
  runAll();
}


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
    '<div class="room-header">'+
      '<input type="text" class="roomName" value="'+(defaults&&defaults.name||('部屋'+roomCount))+'">'+
      (isNonHabitable?'<span class="room-kind">非居室・窓日射用</span>':'')+
      '<button class="small-btn" onclick="document.getElementById(\''+id+'\').remove(); runAll();">部屋を削除</button>'+
    '</div>'+
    '<h3 style="margin-top:0;">窓 (直達日射)</h3>'+
    '<div class="winList"></div>'+
    '<button class="small-btn" onclick="addWindow(\''+id+'\')">+ 窓を追加</button>'+

    '<h3>人体</h3>'+
    '<div class="calc-line">'+
      '<div><label>発熱原単位 (W/人)</label><input type="number" class="peopleSensRate" value="'+TOOL_DEFAULTS.peopleSensRate+'" step="1"></div>'+
      '<div class="eq">×</div>'+
      '<div><label>在室人数</label><input type="number" class="occCount" value="0" step="1"></div>'+
      '<div class="eq">=</div>'+
      '<div><label>顕熱 (W)</label><div class="result peopleSensResult">0 W</div></div>'+
    '</div>'+
    '<div class="calc-line">'+
      '<div><label>発湿原単位 (g/h/人)</label><input type="number" class="peopleMoistRate" value="'+TOOL_DEFAULTS.peopleMoistRate+'" step="1"></div>'+
      '<div class="eq">×</div>'+
      '<div><label>在室人数</label><div class="result occCountEcho">0 人</div></div>'+
      '<div class="eq">=</div>'+
      '<div><label>発湿 (g/h)</label><div class="result peopleMoistResult">0 g/h</div></div>'+
    '</div>'+

    '<h3>機器・照明</h3>'+
    '<div class="calc-line">'+
      '<div><label>発熱密度 (W/㎡)</label><input type="number" class="equipSensRate" value="'+TOOL_DEFAULTS.equipSensRate+'" step="0.5"></div>'+
      '<div class="eq">×</div>'+
      '<div><label>床面積 (㎡)</label><input type="number" class="roomArea" value="10.0" step="0.1"></div>'+
      '<div class="eq">=</div>'+
      '<div><label>顕熱 (W)</label><div class="result equipSensResult">0 W</div></div>'+
    '</div>'+
    '<div class="calc-line">'+
      '<div><label>発湿密度 (g/h/㎡、任意)</label><input type="number" class="equipMoistRate" value="'+TOOL_DEFAULTS.equipMoistRate+'" step="0.5"></div>'+
      '<div class="eq">×</div>'+
      '<div><label>床面積 (㎡)</label><div class="result areaEcho">0 ㎡</div></div>'+
      '<div class="eq">=</div>'+
      '<div><label>発湿 (g/h)</label><div class="result equipMoistResult">0 g/h</div></div>'+
    '</div>'+

    '<h3>追加 (任意・冷蔵庫ベース分など)</h3>'+
    '<div class="row3">'+
      '<div><label>追加 顕熱 (W)</label><input type="number" class="extraSens" value="0" step="1"></div>'+
      '<div><label>追加 発湿 (g/h)</label><input type="number" class="extraMoist" value="0" step="1"></div>'+
    '</div>'+

    '<div class="summary-grid" style="margin-top:1rem;" id="'+id+'_summary"></div>'+
    '<h3>CFDへの入力値 (発生エリア)</h3>'+
    '<div id="'+id+'_cfd"></div>';
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
    '<button class="small-btn" onclick="document.getElementById(\''+wid+'\').remove(); runAll();">削除</button>';
  document.getElementById(roomId).querySelector('.winList').appendChild(div);
  if(defaults){
    for(const cls in defaults){
      if(cls==='skipRerun') continue;
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


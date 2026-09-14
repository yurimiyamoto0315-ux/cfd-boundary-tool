// ========================= SSL連携 (SimpleSimLink objParam.csv 書き出し) =========================
// FlowDesignerのカテゴライズVBS (【SSL】オブジェクトIDカテゴライズcsv出力.vbs) が出力する
// objcatidlist.csv (A列: RGB値 / B列: オブジェクトIDスペース区切り) を読み込み、
// 色ごとに属性カテゴリを割当てて、SimpleSimLink読み込み用の objParam.csv を書き出す。
// 値はモード非依存の transferRows (06-run-all.js) から取得するため、
// 手動モード・アーキトレンド連携・EnergyPlus連携のいずれでも同じ出力になる。

var sslColors = [];   // [{rgb:'元のRGB文字列', css:'rgb(r,g,b)', ids:[1,2,...]}]
var sslAssign = {};   // rgb文字列 → カテゴリキー ('wall_北'|'window'|'room:リビング'|'exclude'|'')
var sslFileName = '';

// ---------- Shift-JIS エンコード ----------
// SSL側 (VbsUtility.SetCsvTable) は FSO.OpenTextFile = ANSI(CP932) で読むため、
// objParam.csv はShift-JISで出力する必要がある (マーカー「●データ」の一致に必須)。
// 使用する固定文字のみのマップ (CP932エンコーダで生成)。動的な値は原則ASCII。
const SSL_SJIS_MAP = {
"\u25CF":[0x81,0x9C],
"\u30C7":[0x83,0x66],
"\u30FC":[0x81,0x5B],
"\u30BF":[0x83,0x5E],
"\u958B":[0x8A,0x4A],
"\u59CB":[0x8E,0x6E],
"\u884C":[0x8D,0x73],
"\u30AA":[0x83,0x49],
"\u30D6":[0x83,0x75],
"\u30B8":[0x83,0x57],
"\u30A7":[0x83,0x46],
"\u30AF":[0x83,0x4E],
"\u30C8":[0x83,0x67],
"\u30D1":[0x83,0x70],
"\u30E9":[0x83,0x89],
"\u30E1":[0x83,0x81],
"\u5916":[0x8A,0x4F],
"\u6C17":[0x8B,0x43],
"\u6E29":[0x89,0xB7],
"\u3068":[0x82,0xC6],
"\u71B1":[0x94,0x4D],
"\u901A":[0x92,0xCA],
"\u904E":[0x89,0xDF],
"\u7387":[0x97,0xA6],
"\u56FA":[0x8C,0xC5],
"\u4F53":[0x91,0xCC],
"\u8868":[0x95,0x5C],
"\u9762":[0x96,0xCA],
"\u307E":[0x82,0xDC],
"\u3067":[0x82,0xC5],
"\u306E":[0x82,0xCC],
"\u4F1D":[0x93,0x60],
"\u9054":[0x92,0x42],
"\u539A":[0x8C,0xFA],
"\u307F":[0x82,0xDD],
"\u3092":[0x82,0xF0],
"\u8003":[0x8D,0x6C],
"\u616E":[0x97,0xB6],
"\u306F":[0x82,0xCD],
"\u3044":[0x82,0xA2],
"\u5168":[0x91,0x53],
"\u6D41":[0x97,0xAC],
"\u91CF":[0x97,0xCA],
"\u6749":[0x90,0x99],
"\u30AC":[0x83,0x4B],
"\u30B9":[0x83,0x58],
"\u677F":[0x94,0xC2],
"\u8907":[0x95,0xA1],
"\u5C64":[0x91,0x77],
"\u5408":[0x8D,0x87],
"\u77F3":[0x90,0xCE],
"\u818F":[0x8D,0x70],
"\u30DC":[0x83,0x7B],
"\u30C9":[0x83,0x68],
"\u30B3":[0x83,0x52],
"\u30F3":[0x83,0x93],
"\u30EA":[0x83,0x8A],
"\u65AD":[0x92,0x66],
"\u6750":[0x8D,0xDE],
"\u3057":[0x82,0xB5],
"\u306A":[0x82,0xC8],
"\uFF08":[0x81,0x69],
"\uFF09":[0x81,0x6A],
"\u969C":[0x8F,0xE1],
"\u5BB3":[0x8A,0x51],
"\u7269":[0x95,0xA8]
};

// 文字列 → Shift-JISバイト列。マップにない非ASCII文字は bad に集める
function sslEncodeSjis(text){
  const bytes = [];
  const bad = [];
  for(const ch of text){
    const code = ch.codePointAt(0);
    if(code < 128){
      bytes.push(code);
    }else if(SSL_SJIS_MAP[ch]){
      SSL_SJIS_MAP[ch].forEach(b=>bytes.push(b));
    }else if(bad.indexOf(ch) === -1){
      bad.push(ch);
    }
  }
  return {bytes: new Uint8Array(bytes), bad};
}

// ---------- カテゴリ → パラメータID 変換表 ----------
// パラメータIDは FdExtTools/FdPropCommandList.csv / FdModelCommandList.csv に基づく。
// tr: transferRows の [step, target, item] から値を取得
// fixed: 固定値 / input: 入力欄IDから取得 / flow: エアコン風量 (単位換算あり)
function sslWallParams(nm){
  return [
    {id:54, label:'種類', fixed:'外気温と熱通過率'},
    {id:57, label:'外気温(SAT)', tr:['1-4','外壁 '+nm+' (発生パネル)','外気温 [℃] = SAT']},
    {id:58, label:'熱通過率', tr:['1-4','外壁 '+nm+' (発生パネル)','熱通過率 [W/m²K]']}
  ];
}
const SSL_CATEGORIES = [
  {key:'wall_北', label:'外壁 北 (発生パネル)', params: sslWallParams('北')},
  {key:'wall_東', label:'外壁 東 (発生パネル)', params: sslWallParams('東')},
  {key:'wall_南', label:'外壁 南 (発生パネル)', params: sslWallParams('南')},
  {key:'wall_西', label:'外壁 西 (発生パネル)', params: sslWallParams('西')},
  {key:'roof', label:'屋根 (発生パネル)', params:[
    {id:54, label:'種類', fixed:'外気温と熱通過率'},
    {id:57, label:'外気温(SAT)', tr:['1-4','屋根 (発生パネル)','外気温 [℃] = SAT']},
    {id:58, label:'熱通過率', tr:['1-4','屋根 (発生パネル)','熱通過率 [W/m²K]']}
  ]},
  {key:'window', label:'窓 (発生パネル)', params:[
    {id:54, label:'種類', fixed:'外気温と固体表面までの熱伝達率'},
    {id:57, label:'外気温', tr:['1-7','窓 (発生パネル)','外気温 [℃]']},
    {id:59, label:'外表面熱伝達率', tr:['1-7','窓 (発生パネル)','外表面熱伝達率 [W/m²K]']},
    {id:60, label:'内表面熱伝達率', tr:['1-7','窓 (発生パネル)','内表面熱伝達率 [W/m²K]']},
    {id:61, label:'厚みを考慮', fixed:'はい'},
    {id:62, label:'材質', input:'sslMatGlass'},
    {id:63, label:'疑似厚み', tr:['1-7','窓 (発生パネル)','疑似厚み [m]']}
  ]},
  {key:'floor1', label:'1F床 (形状モデル・熱通過率)', params:[
    {id:23, label:'属性', fixed:'熱通過率'},
    {id:24, label:'熱通過率', tr:['1-5','1F床 (形状モデル)','熱通過率 [W/m²K]']}
  ]},
  {key:'found', label:'基礎外周 (発生パネル)', params:[
    {id:54, label:'種類', fixed:'外気温と熱通過率'},
    {id:57, label:'外気温', tr:['1-6','基礎外周 (発生パネル)','外気温 [℃]']},
    {id:58, label:'熱通過率', tr:['1-6','基礎外周 (発生パネル)','熱通過率 [W/m²K]']}
  ]},
  {key:'innerwall', label:'内壁・天井・床 (形状モデル・厚みを考慮)', params:[
    {id:23, label:'属性', fixed:'厚みを考慮'},
    {id:25, label:'材質', input:'sslMatWood'},
    {id:26, label:'疑似厚み', tr:['1-3','内壁・天井・床 (形状モデル)','厚み [m] (材質: 杉)']}
  ]},
  {key:'attic', label:'小屋裏内壁 (形状モデル・厚みを考慮)', params:[
    {id:23, label:'属性', fixed:'厚みを考慮'},
    {id:25, label:'材質', input:'sslMatWood'},
    {id:26, label:'疑似厚み', tr:['1-3','内壁・天井・床 (形状モデル)','厚み [m] (材質: 杉)']}
  ]},
  {key:'doorbody', label:'ドア本体 (形状モデル・厚みを考慮)', params:[
    {id:23, label:'属性', fixed:'厚みを考慮'},
    {id:25, label:'材質', input:'sslMatWood'},
    {id:26, label:'疑似厚み', tr:['1-1','ドア本体 (形状モデル)','厚み [m] (材質: 杉)']}
  ]},
  {key:'doorgap_top', label:'ドア隙間 上辺 (開口・圧損)', params:[
    {id:99, label:'開口率', tr:['1-2','ドア隙間 (上辺)','モデル高さ [m] / 開口率 [%]']}
  ]},
  {key:'doorgap_uc', label:'ドア隙間 アンダーカット (開口・圧損)', params:[
    {id:99, label:'開口率', tr:['1-2','ドア隙間 (UC)','モデル高さ [m] / 開口率 [%]']}
  ]},
  {key:'ac_supply', label:'エアコン吹出 (吹出口)', params:[
    {id:31, label:'設定方法', fixed:'流量'},
    {id:33, label:'流量', flow:true},
    {id:36, label:'吹出温度', tr:['3','エアコン (吹出)','吹出温度 [℃]']},
    {id:37, label:'吹出湿度', tr:['3','エアコン (吹出)','吹出湿度 [%RH] (業界慣行で95%RH固定)']}
  ]},
  {key:'ac_return', label:'エアコン吸込 (吸込口)', params:[
    {id:42, label:'設定方法', fixed:'流量'},
    {id:44, label:'流量', flow:true}
  ]},
  {key:'ac_body', label:'エアコン本体 (形状モデル・障害物)', params:[
    {id:1, label:'属性', fixed:'考慮しない（障害物）'}
  ]},
  {key:'fill_solid', label:'外形埋メ (形状モデル・障害物)', params:[
    {id:1, label:'属性', fixed:'考慮しない（障害物）'}
  ]}
];

// モデル全体設定 (オブジェクトID = m の行)。FdModelCommandList.csv のID。
function sslModelParams(){
  return [
    {id:3, label:'初期温度', tr:['4','解析対象と初期値','初期温度 [℃] / 相対湿度 [%]']},
    {id:8, label:'初期相対湿度', input:'initRH'},
    {id:80001, label:'特殊コマンド SATULIM', fixed:'SATULIM\\\\/'},
    {id:5304, label:'快適性 湿度', tr:['4','快適性指標','湿度 [%]']},
    {id:5305, label:'快適性 代謝量', tr:['4','快適性指標','代謝量 met']},
    {id:5306, label:'快適性 着衣量', tr:['4','快適性指標','着衣量 clo']}
  ];
}

// ---------- 値の解決 ----------
function sslTrVal(step, target, item){
  const rows = (typeof transferRows !== 'undefined') ? transferRows : [];
  const row = rows.find(r=>r.step===step && r.target===target && r.item===item);
  if(!row) return null;
  const s = String(row.copy===undefined ? row.value : row.copy).trim();
  if(s==='' || s==='—' || s==='null' || s==='NaN') return null;
  return s;
}
function sslNormName(s){
  if(typeof idfNameKey==='function') return idfNameKey(s);
  return String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
}
function sslRowCopy(row){
  if(!row) return null;
  const s = String(row.copy===undefined ? row.value : row.copy).trim();
  if(s==='' || s==='—' || s==='null' || s==='NaN') return null;
  return s;
}
function sslRoomLookupNames(assignName){
  const out=[];
  function add(n){
    n=String(n||'').trim();
    if(!n) return;
    if(out.indexOf(n)===-1) out.push(n);
  }
  add(assignName);
  const cards=(typeof document!=='undefined' && document.querySelectorAll) ? document.querySelectorAll('.room-card') : [];
  const want=sslNormName(assignName);
  for(let i=0;i<cards.length;i++){
    const card=cards[i];
    const el=card.querySelector && card.querySelector('.roomName');
    const display=el ? String(el.value||'').trim() : '';
    const ep=card.dataset && card.dataset.epZone ? String(card.dataset.epZone).trim() : '';
    if((display && sslNormName(display)===want) || (ep && sslNormName(ep)===want)){
      add(display);
      add(ep);
    }
  }
  return out;
}
function sslPickUniqueRowVal(rows){
  const vals=rows.map(sslRowCopy).filter(function(v){ return v!==null; });
  if(!vals.length) return null;
  if(vals.every(function(v){ return v===vals[0]; })) return vals[0];
  return null;
}
function sslTrValRoom(item, assignName){
  const prefix='発生エリア: ';
  const names=sslRoomLookupNames(assignName);
  for(let i=0;i<names.length;i++){
    const v=sslTrVal('2', prefix+names[i], item);
    if(v!==null) return v;
  }
  const rows=(typeof transferRows!=='undefined') ? transferRows : [];
  const keys=names.map(sslNormName).filter(Boolean);
  const idfHits=[];
  const seenIdf={};
  rows.forEach(function(r){
    if(r.step!=='2' || r.item!==item) return;
    const t=String(r.target||'');
    if(t.indexOf(prefix)!==0) return;
    if(keys.indexOf(sslNormName(t.slice(prefix.length)))<0) return;
    if(seenIdf[t]) return;
    seenIdf[t]=true;
    idfHits.push(r);
  });
  if(idfHits.length){
    const v=sslPickUniqueRowVal(idfHits);
    if(v!==null) return v;
  }
  const subHits=[];
  const seenSub={};
  rows.forEach(function(r){
    if(r.step!=='2' || r.item!==item) return;
    const t=String(r.target||'');
    if(t.indexOf(prefix)!==0) return;
    const nk=sslNormName(t.slice(prefix.length));
    if(!nk) return;
    const hit=keys.some(function(k){ return k && (nk.indexOf(k)>=0 || k.indexOf(nk)>=0); });
    if(!hit || seenSub[t]) return;
    seenSub[t]=true;
    subHits.push(r);
  });
  if(subHits.length===1) return sslRowCopy(subHits[0]);
  return null;
}
function sslFlowValue(){
  const v = sslTrVal('3','エアコン (吹出・1台あたり)','風量 [㎥/h]');
  if(v===null) return null;
  const n = parseFloat(v);
  if(!isFinite(n) || n<=0) return null;
  const unit = document.getElementById('sslFlowUnit').value;
  return unit==='cmm' ? String(Math.round(n/60*100)/100) : String(n);
}
function sslResolveParam(p, warns, catLabel, roomName){
  let v = null;
  if(p.fixed!==undefined){
    v = p.fixed;
  }else if(p.roomGain){
    const item = p.roomGain==='heat' ? '発熱量 [W]' : '発湿量 [g/h]';
    v = sslTrValRoom(item, roomName || '');
    if(v===null){
      v = '0';
      warns.push(catLabel+': 「'+p.label+'」が未計算のため 0 で出力します (Step 2 の室名と割当を確認してください)');
    }else if(p.roomGain==='heat' && Number(v)===0){
      warns.push(catLabel+': 発熱量が 0 W です。Step 2 の入力を確認してください');
    }
  }else if(p.tr){
    v = sslTrVal(p.tr[0], p.tr[1], p.tr[2]);
    if(v===null) warns.push(catLabel+': 「'+p.label+'」が未計算のため出力しません (該当の入力欄を確認してください)');
  }else if(p.input){
    const el = document.getElementById(p.input);
    v = el ? String(el.value).trim() : '';
    if(v==='') { warns.push(catLabel+': 「'+p.label+'」が空欄のため出力しません'); v = null; }
    else if(/[",\r\n]/.test(v)){ warns.push(catLabel+': 「'+p.label+'」にカンマや引用符は使えません'); v = null; }
  }else if(p.flow){
    v = sslFlowValue();
    if(v===null) warns.push(catLabel+': 「'+p.label+'」(エアコン風量) が未計算のため出力しません');
  }
  return v;
}

// ---------- objcatidlist.csv 読み込み ----------
// A列: RGB値 / B列以降: オブジェクトIDスペース区切り。
// RGBの書式ゆれ ("R G B" / "R,G,B" / 単一整数) に耐性を持たせる。
function sslSplitCsvLine(line){
  const cols=[]; let cur=''; let inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(inQ){
      if(c==='"'){ if(line[i+1]==='"'){cur+='"'; i++;} else inQ=false; }
      else cur+=c;
    }else{
      if(c==='"') inQ=true;
      else if(c===','){ cols.push(cur); cur=''; }
      else cur+=c;
    }
  }
  cols.push(cur);
  return cols;
}
function sslParseRgb(rgbStr){
  const s=String(rgbStr||'').trim();
  const hex=s.match(/^#([0-9a-fA-F]{6})$/);
  if(hex){
    const n=parseInt(hex[1],16);
    return {r:(n>>16)&255, g:(n>>8)&255, b:n&255};
  }
  const nums=(s.match(/\d+/g)||[]).map(Number);
  if(nums.length>=3 && nums.slice(0,3).every(function(v){ return v>=0 && v<=255; })){
    return {r:nums[0], g:nums[1], b:nums[2]};
  }
  if(nums.length===1){
    const n=nums[0];
    return {r:n&255, g:(n>>8)&255, b:(n>>16)&255};
  }
  return null;
}
function sslCssColor(rgbStr){
  const rgb=sslParseRgb(rgbStr);
  if(!rgb) return '#CCCCCC';
  return 'rgb('+rgb.r+','+rgb.g+','+rgb.b+')';
}
function sslHexToRgb(hex){
  return sslParseRgb('#'+String(hex||'').replace(/^#/,''));
}
function sslRgbChebyshev(a,b){
  return Math.max(Math.abs(a.r-b.r), Math.abs(a.g-b.g), Math.abs(a.b-b.b));
}
function sslColorCatalog(){
  const items=[];
  function add(key, rgb, src){
    if(!rgb) return;
    items.push({key:key, r:rgb.r, g:rgb.g, b:rgb.b, src:src});
  }
  if(typeof SSL_FIXED_COLORS!=='undefined'){
    SSL_FIXED_COLORS.forEach(function(e){ add(e.key, sslHexToRgb(e.hex), 'fixed'); });
  }
  if(typeof IDF_MESH_PALETTE!=='undefined'){
    Object.keys(IDF_MESH_PALETTE).forEach(function(k){
      const p=IDF_MESH_PALETTE[k];
      add(k, {r:p.r, g:p.g, b:p.b}, 'palette');
    });
  }
  sslWindowUGroups().forEach(function(g){
    add('window', g.color, 'window');
  });
  if(typeof epParse!=='undefined' && epParse && (epParse.gainVolumes||[]).length){
    const cards=(typeof document!=='undefined' && document.querySelectorAll) ? document.querySelectorAll('.room-card[data-ep-zone]') : [];
    epParse.gainVolumes.forEach(function(g){
      if(!g || !g.color) return;
      let name=g.zone||'';
      for(let i=0;i<cards.length;i++){
        const ep=cards[i].dataset && cards[i].dataset.epZone;
        const same=ep===g.zone || sslNormName(ep)===sslNormName(g.zone);
        if(same){
          const el=cards[i].querySelector && cards[i].querySelector('.roomName');
          if(el && String(el.value).trim()) name=String(el.value).trim();
        }
      }
      if(name) add('room:'+name, {r:g.color.r, g:g.color.g, b:g.color.b}, 'gain');
    });
  }
  return items;
}
function sslGuessCategory(rgbStr){
  const rgb=sslParseRgb(rgbStr);
  if(!rgb) return '';
  const tol=(typeof SSL_COLOR_TOLERANCE==='number')?SSL_COLOR_TOLERANCE:12;
  let best=null;
  sslColorCatalog().forEach(function(it){
    const d=sslRgbChebyshev(rgb, it);
    if(d>tol) return;
    const rank=(it.src==='fixed'?0:it.src==='gain'?0:it.src==='window'?1:2);
    if(!best || d<best.d || (d===best.d && rank<best.rank)){
      best={key:it.key, d:d, rank:rank};
    }
  });
  return best?best.key:'';
}
function sslPriorityForKey(key){
  if(!key || key==='exclude' || String(key).indexOf('room:')===0) return null;
  if(typeof SSL_PRIORITY==='object' && SSL_PRIORITY[key]!=null) return SSL_PRIORITY[key];
  return null;
}
function sslFillEmptyAssigns(assign){
  const next=assign||{};
  sslColors.forEach(function(c){
    if(next[c.rgb]) return;
    const g=sslGuessCategory(c.rgb);
    if(g) next[c.rgb]=g;
  });
  return next;
}
function parseSslCat(text, fileName){
  const map={}; const order=[];
  text.split(/\r\n|\r|\n/).forEach(line=>{
    if(!line.trim()) return;
    const cols=sslSplitCsvLine(line);
    const key=String(cols[0]).trim();
    if(key==='' || !sslParseRgb(key)) return;
    const ids=(cols.slice(1).join(' ').match(/\d+/g)||[]).map(Number);
    if(!ids.length) return;
    if(!map[key]){ map[key]={rgb:key, css:sslCssColor(key), ids:[]}; order.push(key); }
    ids.forEach(id=>{ if(map[key].ids.indexOf(id)===-1) map[key].ids.push(id); });
  });
  sslColors = order.map(k=>map[k]);
  sslFileName = fileName||'';
  const next={};
  let autoCount=0;
  sslColors.forEach(c=>{
    if(sslAssign[c.rgb]) next[c.rgb] = sslAssign[c.rgb];
    else {
      const g=sslGuessCategory(c.rgb);
      next[c.rgb] = g;
      if(g) autoCount++;
    }
  });
  sslAssign = next;
  const info=document.getElementById('sslFileInfo');
  if(info){
    info.textContent = sslColors.length
      ? sslFileName+' — '+sslColors.length+'色 / オブジェクト'+sslColors.reduce((a,c)=>a+c.ids.length,0)+'個を読み込み、'+autoCount+'色を自動割当しました'
      : '色とオブジェクトIDの行が見つかりませんでした。objcatidlist.csv (色モードで出力) か確認してください。';
  }
  renderSslAssign();
  if(typeof saveStateDebounced==='function') saveStateDebounced();
}
function onSslCatSelected(input){
  const file=input.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>parseSslCat(e.target.result, file.name);
  reader.readAsText(file);
  input.value='';
}

// ---------- 割当UI ----------
function sslEscapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function sslRoomNames(){
  const rows=(typeof transferRows !== 'undefined') ? transferRows : [];
  const names=[];
  rows.forEach(r=>{
    if(r.step==='2' && r.target.indexOf('発生エリア: ')===0){
      const n=r.target.slice('発生エリア: '.length);
      if(names.indexOf(n)===-1) names.push(n);
    }
  });
  return names;
}
function sslCategoryOptions(){
  const opts=[{key:'', label:'— 未割当 —'}];
  SSL_CATEGORIES.forEach(c=>opts.push({key:c.key, label:c.label}));
  sslRoomNames().forEach(n=>opts.push({key:'room:'+n, label:'発生エリア: '+n}));
  opts.push({key:'exclude', label:'対象外 (書き出さない)'});
  return opts;
}
function sslIsUnassigned(rgb){
  return !sslAssign[rgb];
}
function sslAssignCounts(){
  let open=0, done=0;
  sslColors.forEach(c=>{ if(sslIsUnassigned(c.rgb)) open++; else done++; });
  return {open, done, total:sslColors.length};
}
function sslAssignStatusHtml(){
  const n=sslAssignCounts();
  if(!n.total) return '';
  if(n.open){
    return '<p class="ssl-assign-status"><span class="ssl-remain">未割当 '+n.open+' 色</span> / 割当済 '+n.done+' 色。赤い行はまだ書き出されません。</p>';
  }
  return '<p class="ssl-assign-status"><span class="ssl-ok">全 '+n.total+' 色を割当済み</span>（対象外も含む）</p>';
}
let sslLastRoomsJson='';
function renderSslAssign(){
  const wrap=document.getElementById('sslAssignWrap');
  if(!wrap) return;
  sslLastRoomsJson=JSON.stringify(sslRoomNames());
  if(!sslColors.length){
    wrap.innerHTML='<p class="small" style="margin:6px 0 0;">objcatidlist.csv を読み込むと、色ごとの割当表がここに表示されます。</p>';
    updateSslPreview();
    return;
  }
  const opts=sslCategoryOptions();
  const order=sslColors.map((c,idx)=>({c,idx}))
    .sort((a,b)=> Number(sslIsUnassigned(b.c.rgb))-Number(sslIsUnassigned(a.c.rgb)));
  let html=sslAssignStatusHtml();
  html+='<table><tr><th style="width:70px;">色</th><th>RGB値</th><th style="width:110px;">オブジェクト数</th><th>FDオブジェクトID</th><th>割当カテゴリ</th></tr>';
  order.forEach(({c,idx})=>{
    const cur=sslAssign[c.rgb]||'';
    const open=sslIsUnassigned(c.rgb);
    const g=sslWindowGroupForRgb(c.rgb);
    const d=g?sslWindowDummyVal(c.rgb):null;
    const pri=sslPriorityForKey(cur);
    const hintParts=[];
    if(g) hintParts.push('U='+g.u+(d?(' → d='+d+'m'):''));
    if(pri!=null) hintParts.push('優先度 '+pri);
    const hint=hintParts.length?(' <span class="small">'+hintParts.join(' / ')+'</span>'):'';
    const tag=open?'<span class="ssl-unassigned-tag">未割当</span>':'';
    let sel='<select class="ssl-assign" data-idx="'+idx+'">';
    opts.forEach(o=>{
      sel+='<option value="'+sslEscapeHtml(o.key)+'"'+(o.key===cur?' selected':'')+'>'+sslEscapeHtml(o.label)+'</option>';
    });
    sel+='</select>'+tag+hint;
    html+='<tr'+(open?' class="ssl-unassigned"':'')+'>'+
      '<td><span style="display:inline-block; width:38px; height:18px; border:1px solid #C9C9C9; background:'+c.css+'; vertical-align:middle;"></span></td>'+
      '<td class="l">'+sslEscapeHtml(c.rgb)+'</td>'+
      '<td>'+c.ids.length+'</td>'+
      '<td class="l small">'+sslEscapeHtml(c.ids.join(', '))+'</td>'+
      '<td class="l">'+sel+'</td></tr>';
  });
  html+='</table>';
  wrap.innerHTML=html;
  updateSslPreview();
}

// ---------- objParam.csv 生成 ----------
function sslWindowUGroups(){
  if(typeof uniqueSortedWinU!=='function') return [];
  let us = [];
  if(typeof epParse!=='undefined' && epParse && epParse.windows && epParse.windows.length){
    us = uniqueSortedWinU(epParse.windows.map(function(w){ return w.u; }));
  }
  if(!us.length && typeof collectRoomWindowUs==='function') us = collectRoomWindowUs();
  return (typeof windowUColorGroupsFromUs==='function') ? windowUColorGroupsFromUs(us) : [];
}
function sslWindowGroupForRgb(rgbStr){
  const rgb = sslParseRgb(rgbStr);
  if(!rgb) return null;
  const groups = sslWindowUGroups();
  const tol=(typeof SSL_COLOR_TOLERANCE==='number')?SSL_COLOR_TOLERANCE:12;
  for(let i=0;i<groups.length;i++){
    if(sslRgbChebyshev(groups[i].color, rgb)<=tol) return groups[i];
  }
  return null;
}
function sslSplitWindowDummy(){
  const groups = sslWindowUGroups();
  if(groups.length<2) return false;
  const matched = sslColors.filter(function(c){ return !!sslWindowGroupForRgb(c.rgb); });
  return matched.length>=2;
}
function sslWindowDummyVal(rgbStr){
  const g = sslWindowGroupForRgb(rgbStr);
  if(!g || typeof winDummyThickness!=='function') return null;
  const hi = (typeof num==='function') ? num('hiWin') : 9;
  const ho = (typeof num==='function') ? num('hoWin') : 25;
  const lam = (typeof num==='function') ? num('lamWin') : 1;
  const d = winDummyThickness(g.u, hi, ho, lam);
  return d==null ? null : (Math.round(d*1e6)/1e6).toFixed(4);
}

function sslCategoryByKey(key){
  if(key.indexOf('room:')===0){
    const name=key.slice(5);
    return {key, label:'発生エリア: '+name, roomName:name, params:[
      {id:76, label:'発生種類', fixed:'全体'},
      {id:77, label:'発熱量', roomGain:'heat'},
      {id:78, label:'発湿量', roomGain:'moist'}
    ]};
  }
  return SSL_CATEGORIES.find(c=>c.key===key)||null;
}
var _sslEnsuring=false;
function sslEnsureCalcs(){
  if(_sslEnsuring) return;
  if(typeof runAll!=='function') return;
  _sslEnsuring=true;
  try{ runAll(); }
  finally{ _sslEnsuring=false; }
}
function buildObjParam(){
  const warns=[]; const lines=[];
  let objCount=0; let unassigned=0;
  const resolvedCache={};
  sslColors.forEach(c=>{
    const key=sslAssign[c.rgb]||'';
    if(key==='' ){ unassigned++; return; }
    if(key==='exclude') return;
    const cat=sslCategoryByKey(key);
    if(!cat){ warns.push('RGB '+c.rgb+': 割当カテゴリが見つかりません (部屋名の変更など)。割当し直してください'); return; }
    if(!resolvedCache[key]){
      const params=cat.params.slice();
      const pri=sslPriorityForKey(key);
      if(typeof SSL_PRIORITY_PARAM_ID==='number' && SSL_PRIORITY_PARAM_ID && pri!=null){
        params.push({id:SSL_PRIORITY_PARAM_ID, label:'優先度', fixed:String(pri)});
      }
      resolvedCache[key]=params.map(p=>({id:p.id, val:sslResolveParam(p, warns, cat.label, cat.roomName)}))
                               .filter(pv=>{
                                 if(cat.roomName && (pv.id===77 || pv.id===78)) return pv.val!=null && pv.val!=='';
                                 return pv.val!==null;
                               });
    }
    let pvs=resolvedCache[key];
    if(key==='window' && sslSplitWindowDummy()){
      const d=sslWindowDummyVal(c.rgb);
      pvs=pvs.map(function(pv){
        if(pv.id!==63 || d==null) return pv;
        return {id:pv.id, val:d};
      });
      if(d==null && warns.every(function(w){ return String(w).indexOf('U色分けに一致しない')<0; })){
        warns.push('窓色 '+c.rgb+' はU色分けに一致しないため、共通の疑似厚みを使います。このツールの3DSを取り込み直してください');
      }
    }
    if(!pvs.length) return;
    c.ids.forEach(objId=>{
      objCount++;
      pvs.forEach(pv=>lines.push(objId+','+pv.id+','+pv.val));
    });
  });
  if(unassigned>0) warns.push('未割当の色が '+unassigned+' 件あります (未割当の色は書き出されません)');
  // モデル全体設定 (m行)
  sslModelParams().forEach(p=>{
    const v=sslResolveParam(p, warns, 'モデル設定');
    if(v!==null) lines.push('m,'+p.id+','+v);
  });
  return {lines, warns, objCount};
}
function renderSslWarns(warns){
  const ul=document.getElementById('sslWarnList');
  if(!ul) return;
  if(!warns.length){ ul.style.display='none'; ul.innerHTML=''; return; }
  ul.style.display='';
  ul.innerHTML=warns.map(w=>'<li>'+sslEscapeHtml(w)+'</li>').join('');
}
function updateSslPreview(){
  const info=document.getElementById('sslExportInfo');
  if(!sslColors.length){ renderSslWarns([]); if(info) info.textContent=''; return; }
  const built=buildObjParam();
  renderSslWarns(built.warns);
  if(info) info.textContent='現在の設定で 設定行 '+built.lines.length+' 行 / 対象オブジェクト '+built.objCount+' 個';
}
function sslDownloadCsv(){
  const info=document.getElementById('sslExportInfo');
  if(!sslColors.length){ if(info) info.textContent='先に objcatidlist.csv を読み込んでください。'; return; }
  sslEnsureCalcs();
  const built=buildObjParam();
  renderSslWarns(built.warns);
  if(!built.lines.length){
    if(info) info.textContent='書き出せる設定行がありません。割当と計算値を確認してください。';
    return;
  }
  const now=new Date();
  const stamp=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  const all=[
    '; cfd_boundary_tool SSL export '+stamp+',,',
    '\u25CF\u30C7\u30FC\u30BF\u958B\u59CB\u884C,=,=',                       // ●データ開始行
    '\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8ID,\u30D1\u30E9\u30E1\u30FC\u30BFID,\u30D1\u30E9\u30E1\u30FC\u30BF'  // タイトル行
  ].concat(built.lines);
  const enc=sslEncodeSjis(all.join('\r\n')+'\r\n');
  if(enc.bad.length){
    renderSslWarns(built.warns.concat(['Shift-JIS変換できない文字が含まれるため書き出せません: '+enc.bad.join(' ')+' (材質名はASCIIか既定候補を使用してください)']));
    return;
  }
  const blob=new Blob([enc.bytes], {type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='objParam.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  if(info) info.textContent='objParam.csv を書き出しました (設定行 '+built.lines.length+' 行 / 対象オブジェクト '+built.objCount+' 個)。FDのプロジェクトフォルダに置いて「【SSL】自動化_objParamCSV読み込み.vbs」を実行してください。';
}

// ---------- 状態保存への統合 (09-state.js はラップして変更しない) ----------
if(typeof gatherState==='function'){
  const _sslGatherOrig=gatherState;
  gatherState=function(){
    const s=_sslGatherOrig();
    s.ssl={fileName:sslFileName, colors:sslColors, assign:sslAssign};
    return s;
  };
}
if(typeof applyState==='function'){
  const _sslApplyOrig=applyState;
  applyState=function(s){
    _sslApplyOrig(s);
    if(s && s.ssl){
      sslFileName=s.ssl.fileName||'';
      sslColors=Array.isArray(s.ssl.colors)?s.ssl.colors:[];
      sslAssign=sslFillEmptyAssigns(s.ssl.assign||{});
      const fi=document.getElementById('sslFileInfo');
      if(fi) fi.textContent=sslColors.length?(sslFileName?sslFileName+' — ':'')+sslColors.length+'色を復元しました':'';
      renderSslAssign();
    }
  };
}
// 再計算後: 部屋リストが変わったら割当表を再構築、そうでなければ警告/行数のみ更新
if(typeof runAll==='function'){
  const _sslRunAllPrev=runAll;
  runAll=function(){
    _sslRunAllPrev();
    if(_sslEnsuring) return;
    if(JSON.stringify(sslRoomNames())!==sslLastRoomsJson) renderSslAssign();
    else updateSslPreview();
  };
}

// ---------- イベント ----------
document.getElementById('sslCatInput').addEventListener('change', function(){ onSslCatSelected(this); });
document.getElementById('sslExportBtn').addEventListener('click', sslDownloadCsv);
document.getElementById('sslAssignWrap').addEventListener('change', function(e){
  const sel=e.target.closest('.ssl-assign');
  if(!sel) return;
  const c=sslColors[+sel.dataset.idx];
  if(!c) return;
  sslAssign[c.rgb]=sel.value;
  renderSslAssign();
  if(typeof saveStateDebounced==='function') saveStateDebounced();
});
['sslFlowUnit','sslMatWood','sslMatGlass'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('input', function(){
    updateSslPreview();
    if(typeof saveStateDebounced==='function') saveStateDebounced();
  });
});
renderSslAssign();

// ========================= SSL連携 (SimpleSimLink objParam.csv 書き出し) =========================
// FlowDesignerのカテゴライズVBS (【SSL】オブジェクトIDカテゴライズcsv出力.vbs) が出力する
// objcatidlist.csv (A列: RGB値 / B列: オブジェクトIDスペース区切り) を読み込み、
// 色ごとに属性カテゴリを割当てて、SimpleSimLink読み込み用の objParam.csv を書き出す。
// 値はモード非依存の transferRows (06-run-all.js) から取得するため、
// 手動モード・アーキトレンド連携・EnergyPlus連携のいずれでも同じ出力になる。

var sslColors = [];   // [{rgb:'元のRGB文字列', css:'rgb(r,g,b)', ids:[1,2,...]}]
var sslAssign = {};   // rgb文字列 → カテゴリキー ('wall_北'|'window'|'room:リビング'|'exclude'|'')
var sslFileName = '';
var sslCatDiagnostics = {errors:[], warnings:[]};
var sslReadSelectionId = 0;

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
function sslExtDoorParams(nm){
  return [
    {id:54, label:'種類', fixed:'外気温と熱通過率'},
    {id:57, label:'外気温(SAT)', tr:['1-4','外部扉 '+nm+' (発生パネル)','外気温 [℃] = SAT']},
    {id:58, label:'熱通過率', tr:['1-4','外部扉 '+nm+' (発生パネル)','熱通過率 [W/m²K]']}
  ];
}
const SSL_CATEGORIES = [
  {key:'wall_北', label:'外壁 北 (発生パネル)', params: sslWallParams('北')},
  {key:'wall_北東', label:'外壁 北東 (発生パネル)', params: sslWallParams('北東')},
  {key:'wall_東', label:'外壁 東 (発生パネル)', params: sslWallParams('東')},
  {key:'wall_南東', label:'外壁 南東 (発生パネル)', params: sslWallParams('南東')},
  {key:'wall_南', label:'外壁 南 (発生パネル)', params: sslWallParams('南')},
  {key:'wall_南西', label:'外壁 南西 (発生パネル)', params: sslWallParams('南西')},
  {key:'wall_西', label:'外壁 西 (発生パネル)', params: sslWallParams('西')},
  {key:'wall_北西', label:'外壁 北西 (発生パネル)', params: sslWallParams('北西')},
  {key:'extdoor_北', label:'外部扉 北 (発生パネル)', params: sslExtDoorParams('北')},
  {key:'extdoor_北東', label:'外部扉 北東 (発生パネル)', params: sslExtDoorParams('北東')},
  {key:'extdoor_東', label:'外部扉 東 (発生パネル)', params: sslExtDoorParams('東')},
  {key:'extdoor_南東', label:'外部扉 南東 (発生パネル)', params: sslExtDoorParams('南東')},
  {key:'extdoor_南', label:'外部扉 南 (発生パネル)', params: sslExtDoorParams('南')},
  {key:'extdoor_南西', label:'外部扉 南西 (発生パネル)', params: sslExtDoorParams('南西')},
  {key:'extdoor_西', label:'外部扉 西 (発生パネル)', params: sslExtDoorParams('西')},
  {key:'extdoor_北西', label:'外部扉 北西 (発生パネル)', params: sslExtDoorParams('北西')},
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
  {key:'floor_out', label:'2F持ち出し床 (発生パネル)', params:[
    {id:54, label:'種類', fixed:'外気温と熱通過率'},
    {id:57, label:'外気温', tr:['1-5','2F持ち出し床 (発生パネル)','外気温 [℃]']},
    {id:58, label:'熱通過率', tr:['1-5','2F持ち出し床 (発生パネル)','熱通過率 [W/m²K]']}
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
  {key:'dooropen', label:'ドア完全開口 (開口・圧損)', params:[
    {id:99, label:'開口率', fixed:'100'}
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
  ]},
  {key:'stair_solid', label:'階段 (形状モデル・障害物)', params:[
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
function sslRoomGainRows(item, assignName, partial){
  const prefix='発生エリア: ';
  const keys=sslRoomLookupNames(assignName).map(sslNormName).filter(Boolean);
  const rows=(typeof transferRows!=='undefined') ? transferRows : [];
  return rows.filter(function(r){
    if(r.step!=='2' || r.item!==item) return false;
    const t=String(r.target||'');
    if(t.indexOf(prefix)!==0) return false;
    const nk=sslNormName(t.slice(prefix.length));
    if(!nk) return false;
    return partial ? keys.some(k=>nk.indexOf(k)>=0 || k.indexOf(nk)>=0) : keys.indexOf(nk)>=0;
  });
}
function sslTrValRoom(item, assignName){
  const exact=sslRoomGainRows(item,assignName,false);
  if(exact.length) return exact.length===1 ? sslRowCopy(exact[0]) : null;
  const partial=sslRoomGainRows(item,assignName,true);
  return partial.length===1 ? sslRowCopy(partial[0]) : null;
}
function sslDuplicateRoomMessage(){
  return '同じ名前の部屋が複数あります。部屋名を「1F トイレ」「2F トイレ」のように区別して確定してください';
}
function sslFlowValue(){
  const v = sslTrVal('3','エアコン (吹出・1台あたり)','風量 [㎥/h]');
  if(v===null) return null;
  const n = Number(v);
  if(!isFinite(n) || n<=0) return null;
  const unit = document.getElementById('sslFlowUnit').value;
  return unit==='cmm' ? String(Number((n/60).toPrecision(12))) : String(n);
}
function sslResolveParam(p, warns, catLabel, roomName, errors){
  errors=errors||warns;
  let v = null;
  if(p.fixed!==undefined){
    v = p.fixed;
  }else if(p.roomGain){
    const item = p.roomGain==='heat' ? '発熱量 [W]' : '発湿量 [g/h]';
    v = sslTrValRoom(item, roomName || '');
    if(v===null){
      const exact=sslRoomGainRows(item,roomName||'',false);
      const ambiguous=exact.length>1 || !exact.length && sslRoomGainRows(item,roomName||'',true).length>1;
      errors.push(ambiguous ? sslDuplicateRoomMessage() : catLabel+': 「'+p.label+'」が未計算です。Step 2 の室名と割当を確認してください');
    }else if(p.roomGain==='heat' && Number(v)===0){
      warns.push(catLabel+': 発熱量が 0 W です。Step 2 の入力を確認してください');
    }
  }else if(p.tr){
    v = sslTrVal(p.tr[0], p.tr[1], p.tr[2]);
    if(v===null) errors.push(catLabel+': 「'+p.label+'」が未計算です。該当の入力欄を確認してください');
  }else if(p.input){
    const el = document.getElementById(p.input);
    v = el ? String(el.value).trim() : '';
    if(v==='') { errors.push(catLabel+': 「'+p.label+'」が空欄です'); v = null; }
    else if(/[",\r\n]/.test(v)){ errors.push(catLabel+': 「'+p.label+'」にカンマや引用符は使えません'); v = null; }
  }else if(p.flow){
    v = sslFlowValue();
    if(v===null) errors.push(catLabel+': 「'+p.label+'」(エアコン風量) が未計算です');
  }
  if(v!==null && !sslValidParamValue(p.id,v)){
    errors.push(catLabel+': 「'+p.label+'」の値が不正です');
    return null;
  }
  return v;
}
function sslValidParamValue(id,value){
  const s=String(value).trim();
  if(!s || /[",\r\n\0]/.test(s)) return false;
  const numeric=[3,8,24,26,27,33,36,37,44,55,57,58,59,60,63,77,78,99,5304,5305,5306,90001];
  if(numeric.indexOf(id)<0) return true;
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return false;
  const n=Number(s);
  if(!Number.isFinite(n)) return false;
  if([3,36,55,57].indexOf(id)>=0) return n>=-273.15;
  if([8,37,99,5304].indexOf(id)>=0) return n>=0 && n<=100;
  if([24,26,58,59,60,63,5305].indexOf(id)>=0) return n>0;
  if(id===90001) return Number.isInteger(n) && n>=0 && n<=2147483647;
  if(id===27) return true; // Net radiation can cool an interior surface.
  return n>=0;
}

// ---------- objcatidlist.csv 読み込み ----------
// A列: RGB値 / B列以降: オブジェクトIDスペース区切り。
// RGBの書式ゆれ ("R G B" / "R,G,B" / 単一整数) に耐性を持たせる。
function sslSplitCsvLine(line){
  const cols=[]; let cur=''; let inQ=false; let closed=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(inQ){
      if(c==='"'){ if(line[i+1]==='"'){cur+='"'; i++;} else {inQ=false; closed=true;} }
      else cur+=c;
    }else{
      if(c==='"'){ if(cur.trim()!=='' || closed) throw new Error('CSV_QUOTES'); inQ=true; cur=''; }
      else if(c===','){ cols.push(cur); cur=''; closed=false; }
      else if(closed){ if(!/\s/.test(c)) throw new Error('CSV_QUOTES'); }
      else cur+=c;
    }
  }
  if(inQ) throw new Error('CSV_QUOTES');
  cols.push(cur);
  return cols;
}
function sslParseRgb(rgbStr){
  const s=String(rgbStr==null?'':rgbStr).trim();
  const hex=s.match(/^#([0-9a-fA-F]{6})$/);
  if(hex){
    const n=parseInt(hex[1],16);
    return {r:(n>>16)&255, g:(n>>8)&255, b:n&255};
  }
  const triple=s.match(/^(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)$/);
  const nums=triple ? triple.slice(1).map(Number) : [];
  if(nums.length===3 && nums.every(function(v){ return v>=0 && v<=255; })){
    return {r:nums[0], g:nums[1], b:nums[2]};
  }
  if(/^\d+$/.test(s) && Number(s)<=16777215){
    const n=Number(s);
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
function sslThermalCategories(){
  if(typeof appMode!=='undefined' && appMode!=='architrend') return [];
  return typeof boundaryThermalCategories==='function' ? (boundaryThermalCategories()||[]) : [];
}
function sslGainRoomName(g){
  let name=g.zone||'';
  const cards=(typeof document!=='undefined' && document.querySelectorAll)
    ? document.querySelectorAll('.room-card') : [];
  for(let i=0;i<cards.length;i++){
    const ds=cards[i].dataset||{};
    const same=!!g.zone && (ds.epZone===g.zone || ds.atRoomKey===g.zone ||
      !!ds.epZone && typeof sslNormName==='function' && sslNormName(ds.epZone)===sslNormName(g.zone)) ||
      !!g.roomKey && ds.atRoomKey===g.roomKey;
    const el=cards[i].querySelector && cards[i].querySelector('.roomName');
    if(same || el && String(el.value).trim()===String(g.zone||'').trim()){
      if(el && String(el.value).trim()) name=String(el.value).trim();
    }
  }
  return name;
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
  if(typeof epShadePalette!=='undefined'){
    Object.keys(epShadePalette).forEach(function(k){
      const p=epShadePalette[k];
      add(k, {r:p.r, g:p.g, b:p.b}, 'palette');
    });
  }
  sslWindowUGroups().forEach(function(g){
    add('window', g.color, 'window');
  });
  sslThermalCategories().forEach(c=>add(c.key,c.color,'thermal'));
  let gainVols=[];
  try{
    gainVols=(typeof idfMeshEnsureGainVolumes==='function')
      ? idfMeshEnsureGainVolumes()
      : ((typeof epParse!=='undefined' && epParse && epParse.gainVolumes)||[]);
  }catch(e){
    // Parsing/assignment remains usable; sslGainColorErrors repeats the actual
    // output check and blocks export with a fixed error code.
  }
  if(gainVols && gainVols.length){
    gainVols.forEach(function(g){
      if(!g || !g.color) return;
      const name=sslGainRoomName(g);
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
    const rank=(it.src==='thermal'?-1:it.src==='fixed'?0:it.src==='gain'?0:it.src==='window'?1:2);
    if(!best || d<best.d || (d===best.d && rank<best.rank)){
      best={key:it.key, d:d, rank:rank,src:it.src,ambiguous:false};
    }else if(d===best.d && rank===best.rank && best.key!==it.key &&
      (rank===-1 || it.src==='gain' || best.src==='gain')){
      best.ambiguous=true;
    }
  });
  return best&&!best.ambiguous?best.key:'';
}
function sslPriorityForKey(key){
  if(!key || key==='exclude' || String(key).indexOf('room:')===0) return null;
  const thermal=sslThermalCategories().find(c=>c.key===key);
  if(thermal && thermal.priority!=null) return thermal.priority;
  if(typeof SSL_PRIORITY==='object' && SSL_PRIORITY[key]!=null) return SSL_PRIORITY[key];
  if(String(key).indexOf('wall_')===0) return 10;
  return null;
}
function sslShadeCategory(g){
  const tag=g.index<=1 ? g.orient : (g.orient+'#'+g.index);
  return {
    key:g.sslKey,
    label:'外壁 '+tag+' (発生パネル)',
    params:(typeof sslWallParams==='function') ? sslWallParams(tag) : []
  };
}
function sslFillEmptyAssigns(assign){
  const previous=assign||{},next={};
  sslColors.forEach(function(c){
    const oldKey=Object.keys(previous).find(k=>{const rgb=sslParseRgb(k);return rgb && [rgb.r,rgb.g,rgb.b].join(' ')===c.rgb;});
    if(oldKey && previous[oldKey]) next[c.rgb]=previous[oldKey];
    if(next[c.rgb]) return;
    const g=sslGuessCategory(c.rgb);
    if(g) next[c.rgb]=g;
  });
  return next;
}
function sslParseCategoryCsv(text){
  const map=Object.create(null), seen=new Set(), order=[], errors=[];
  String(text).replace(/^\uFEFF/,'').split(/\r\n|\r|\n/).forEach((line,index)=>{
    if(!line.trim() || /^\s*;/.test(line)) return;
    let cols;
    try{ cols=sslSplitCsvLine(line); }catch(e){ errors.push('行 '+(index+1)+': CSVの引用符が閉じていません'); return; }
    if(cols.length!==2){ errors.push('行 '+(index+1)+': 色とID一覧の2列が必要です。objParam.csvと取り違えていないか確認してください'); return; }
    const rgb=sslParseRgb(cols[0]);
    if(!rgb){ errors.push('行 '+(index+1)+': RGBは #RRGGBB、3つの0〜255、または0〜16777215で指定してください'); return; }
    const tokens=cols[1].trim().split(/\s+/);
    if(!cols[1].trim() || tokens.some(t=>!/^\d+$/.test(t) || Number(t)<1 || Number(t)>2147483647)){
      errors.push('行 '+(index+1)+': オブジェクトIDは正の整数を空白で区切ってください'); return;
    }
    const key=[rgb.r,rgb.g,rgb.b].join(' '), ids=tokens.map(Number);
    if(!map[key]){ map[key]={rgb:key, css:sslCssColor(key), ids:[]}; order.push(key); }
    ids.forEach(id=>{
      if(seen.has(id)) errors.push('行 '+(index+1)+': オブジェクトID '+id+' が重複しています');
      else {seen.add(id); map[key].ids.push(id);}
    });
  });
  if(!order.length && !errors.length) errors.push('色とオブジェクトIDの行がありません。FDで色モードのCSVを出し直してください');
  return {colors:errors.length?[]:order.map(k=>map[k]),errors,warnings:[]};
}
function parseSslCat(text, fileName){
  const parsed=sslParseCategoryCsv(text);
  sslCatDiagnostics={errors:parsed.errors,warnings:parsed.warnings};
  sslColors = parsed.colors;
  sslFileName = fileName||'';
  const next={};
  let autoCount=0;
  sslColors.forEach(c=>{
    const oldKey=Object.keys(sslAssign).find(k=>{const r=sslParseRgb(k);return r && [r.r,r.g,r.b].join(' ')===c.rgb;});
    if(oldKey && sslAssign[oldKey]) next[c.rgb] = sslAssign[oldKey];
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
      : 'CSVを読み込めませんでした。下の修正項目を確認してください。';
  }
  renderSslAssign();
  if(typeof saveStateDebounced==='function') saveStateDebounced();
  return parsed;
}
function onSslCatSelected(input){
  const file=input.files[0];
  if(!file) return;
  resetSslCategory();
  const readId=++sslReadSelectionId;
  const reader=new FileReader();
  reader.onload=e=>{if(readId===sslReadSelectionId)parseSslCat(e.target.result, file.name);};
  reader.onerror=()=>{if(readId!==sslReadSelectionId)return;resetSslCategory();sslCatDiagnostics.errors=['ファイルを読み込めませんでした。ファイルを選び直してください'];updateSslPreview();};
  reader.readAsText(file,'shift-jis');
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
  sslThermalCategories().forEach(c=>opts.push({key:c.key,label:c.label}));
  if(typeof epShadeGroups!=='undefined'){
    epShadeGroups.forEach(function(g){
      if(!g || g.index<=1) return;
      opts.push({key:g.sslKey, label:'外壁 '+g.orient+'#'+g.index+' (発生パネル)'});
    });
  }
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
    return '<p class="ssl-assign-status"><span class="ssl-remain">未割当 '+n.open+' 色</span> / 割当済 '+n.done+' 色。すべて割り当てるか、対象外を明示すると書き出せます。</p>';
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
  if(typeof appMode!=='undefined'&&appMode==='architrend'&&typeof architrendWindowUGroups==='function')return architrendWindowUGroups();
  if(typeof uniqueSortedWinU!=='function') return [];
  let us = [];
  if((typeof appMode==='undefined'||appMode==='energyplus') && typeof epParse!=='undefined' && epParse && epParse.windows && epParse.windows.length){
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
  if(typeof appMode!=='undefined'&&appMode==='architrend')return groups.length>0;
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
  const thermal=sslThermalCategories().find(c=>c.key===key);
  if(thermal) return thermal;
  if(key.indexOf('room:')===0){
    const name=key.slice(5);
    return {key, label:'発生エリア: '+name, roomName:name, params:[
      {id:76, label:'発生種類', fixed:'全体'},
      {id:77, label:'発熱量', roomGain:'heat'},
      {id:78, label:'発湿量', roomGain:'moist'}
    ]};
  }
  if(typeof epShadeGroups!=='undefined'){
    const hit=epShadeGroups.find(function(g){ return g && g.sslKey===key && g.index>1; });
    if(hit) return sslShadeCategory(hit);
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
function sslGainColorErrors(){
  const errors=[];
  const mode=typeof appMode==='undefined'?'':appMode;
  if(mode!=='architrend' && mode!=='energyplus') return errors;
  const source=mode==='architrend'
    ? (typeof atMesh!=='undefined' && atMesh)
    : (typeof epParse!=='undefined' && epParse);
  // The CSV-only/manual workflow has no exported gain solids to compare.
  if(!source) return errors;
  const expected=new Map(),roomNames=new Set();
  try{
    const volumes=typeof idfMeshEnsureGainVolumes==='function' ? idfMeshEnsureGainVolumes() : (source.gainVolumes||[]);
    if(!Array.isArray(volumes)) throw new Error('GAIN_OUTPUT_INVALID');
    volumes.forEach(function(vol){
      if(!vol) throw new Error('GAIN_OUTPUT_INVALID');
      // Match idfMeshAppendGainVolumes: only solids actually written to the
      // gain 3DS can require a returned color/ID row.
      if(typeof idfMeshGainSolid==='function'){
        const solid=idfMeshGainSolid(vol);
        if(!solid || !solid.verts || solid.verts.length<4 || !solid.tris || !solid.tris.length) return;
      }
      const rgb=vol.color||{r:255,g:176,b:168};
      if(!['r','g','b'].every(k=>Number.isInteger(rgb[k]) && rgb[k]>=0 && rgb[k]<=255)) throw new Error('GAIN_COLOR_INVALID');
      const color=[rgb.r,rgb.g,rgb.b].join(' '),name=sslGainRoomName(vol);
      if(!name) throw new Error('GAIN_ROOM_INVALID');
      const normalizedName=sslNormName(name);
      if(roomNames.has(normalizedName)) errors.push(sslDuplicateRoomMessage());
      roomNames.add(normalizedName);
      const key='room:'+name,old=expected.get(color);
      if(old && old.key!==key){
        errors.push('発熱体の色が複数の居室で重複しています。3DSと色CSVを作り直してください');
      }else expected.set(color,{key:key});
    });
  }catch(e){
    const code=['GAIN_COLOR_INDEX_INVALID','GAIN_COLOR_CAPACITY_EXCEEDED'].includes(e && e.code) ? e.code : 'GAIN_OUTPUT_INVALID';
    return ['['+code+'] 現在の発熱体の出力対象を確認できません。居室設定を確認し、3DSと色CSVを作り直してください'];
  }
  if(!expected.size) return errors;
  const allIds=new Set();
  sslColors.forEach(function(row){
    if(!Array.isArray(row.ids)){
      errors.push('発熱体を含む色CSVのID一覧が不正です。FDで色CSVを出し直してください');
      return;
    }
    row.ids.forEach(function(id){
      if(!Number.isInteger(id) || id<1 || id>2147483647 || allIds.has(id)){
        errors.push('発熱体を含む色CSVのIDが不正または重複しています。FDで色CSVを出し直してください');
      }
      allIds.add(id);
    });
    if(String(sslAssign[row.rgb]||'').indexOf('room:')===0 && !expected.has(row.rgb)){
      errors.push('現在の発熱体にない色が発生エリアへ割り当てられています。3DSを取り込み直し、FDで色CSVを出し直してください');
    }
  });
  expected.forEach(function(required,color){
    const row=sslColors.find(c=>c.rgb===color);
    if(!row){
      errors.push('現在の居室に必要な発熱体の色が色CSVにありません。3DSを取り込み直し、FDで色CSVを出し直してください');
      return;
    }
    if(sslAssign[color]!==required.key){
      errors.push('発熱体の色が対応する居室へ割り当てられていません。「対象外」にはせず、3DSと色CSVを確認してください');
    }
    if(!Array.isArray(row.ids) || !row.ids.length){
      errors.push('発熱体の色に有効なオブジェクトIDがありません。FDで色CSVを出し直してください');
    }
  });
  return [...new Set(errors)];
}
function buildObjParam(){
  const warns=[]; const errors=sslCatDiagnostics.errors.slice(); const lines=[];
  errors.push(...sslGainColorErrors());
  let objCount=0; let unassigned=0;
  const resolvedCache={}; const seenIds=new Set();
  sslColors.forEach(c=>{
    const key=sslAssign[c.rgb]||'';
    if(key==='' ){ unassigned++; return; }
    if(key==='exclude') return;
    const cat=sslCategoryByKey(key);
    if(!cat){ errors.push('RGB '+c.rgb+': 割当カテゴリが見つかりません。割当し直してください'); return; }
    if(!resolvedCache[key]){
      const params=cat.params.slice();
      const pri=sslPriorityForKey(key);
      if(typeof SSL_PRIORITY_PARAM_ID==='number' && SSL_PRIORITY_PARAM_ID && pri!=null){
        params.push({id:SSL_PRIORITY_PARAM_ID, label:'優先度', fixed:String(pri)});
      }
      resolvedCache[key]=params.filter(p=>!(key==='window'&&p.id===63&&sslSplitWindowDummy())).map(p=>({id:p.id, val:sslResolveParam(p, warns, cat.label, cat.roomName, errors)}))
                               .filter(pv=>{
                                 if(cat.roomName && (pv.id===77 || pv.id===78)) return pv.val!=null && pv.val!=='';
                                 return pv.val!==null;
                               });
    }
    let pvs=resolvedCache[key];
    if(key==='window' && sslSplitWindowDummy()){
      const d=sslWindowDummyVal(c.rgb);
      pvs=pvs.filter(pv=>pv.id!==63);
      if(d!=null)pvs=pvs.concat([{id:63,val:d}]);
      if(d==null && warns.every(function(w){ return String(w).indexOf('U色分けに一致しない')<0; })){
        errors.push('窓色 '+c.rgb+' がU色分けに一致しません。このツールの3DSを取り込み直し、色CSVを出し直してください');
      }
    }
    if(!pvs.length) return;
    c.ids.forEach(objId=>{
      if(!Number.isInteger(objId) || objId<1 || objId>2147483647 || seenIds.has(objId)){
        errors.push('対象オブジェクトIDが不正または重複しています。FDから色CSVを出し直してください'); return;
      }
      seenIds.add(objId);
      objCount++;
      pvs.forEach(pv=>lines.push(objId+','+pv.id+','+pv.val));
    });
  });
  if(unassigned>0) errors.push('未割当の色が '+unassigned+' 件あります。割当カテゴリか「対象外」を選んでください');
  if(!objCount) errors.push('反映対象のオブジェクトがありません');
  // モデル全体設定 (m行)
  sslModelParams().forEach(p=>{
    const v=sslResolveParam(p, warns, 'モデル設定',undefined,errors);
    if(v!==null) lines.push('m,'+p.id+','+v);
  });
  const unit=document.getElementById('sslFlowUnit');
  if(!unit || !['cmh','cmm'].includes(unit.value)) errors.push('CSVの流量単位を選んでください');
  return {lines, warns, errors, objCount};
}
function sslReadiness(){
  const built=buildObjParam(), errors=built.errors.slice(), warnings=built.warns.slice();
  if(!sslColors.length && !errors.length) errors.push('先にFDの色CSVを読み込んでください');
  if(typeof boundaryExportReadiness==='function'){
    const check=boundaryExportReadiness('conditions');
    if(check && check.ready===false) errors.push(check.message||'入力資料とモデルの修正項目を確認してください');
  }else if(typeof appMode!=='undefined' && appMode==='architrend' && typeof architrendImportReadiness==='function'){
    const check=architrendImportReadiness();
    if(check && check.ready===false){
      const messages=Array.isArray(check.blocking)?check.blocking:(Array.isArray(check.errors)?check.errors:[]);
      errors.push(...(messages.length?messages.map(e=>typeof e==='string'?e:e.message||e.code||'入力資料の確認が必要です'):['ARCHITRENDの入力資料に未解決の問題があります']));
    }
  }
  if(typeof boundaryExportReadiness!=='function' && typeof appMode!=='undefined' && appMode==='architrend' && typeof atMesh!=='undefined' && atMesh && atMesh.readiness && atMesh.readiness.ready===false){
    errors.push('3DSの形状確認が必要です。モデルの修正項目を確認してください');
  }
  if(sslEncodeSjis(built.lines.join('\r\n')).bad.length) errors.push('材質名にShift-JISで出力できない文字があります。ASCIIか既定候補を使用してください');
  return {ready:errors.length===0,errors,warnings,objectCount:built.objCount,lines:built.lines};
}
function resetSslCategory(){
  sslReadSelectionId++;
  sslColors=[];sslAssign={};sslFileName='';sslCatDiagnostics={errors:[],warnings:[]};
  const fi=document.getElementById('sslFileInfo');if(fi)fi.textContent='';
  renderSslAssign();
}
if(typeof window!=='undefined'){window.sslReadiness=sslReadiness;window.resetSslCategory=resetSslCategory;}
function renderSslWarns(warns){
  const ul=document.getElementById('sslWarnList');
  if(!ul) return;
  if(!warns.length){ ul.style.display='none'; ul.innerHTML=''; return; }
  ul.style.display='';
  ul.innerHTML=warns.map(w=>'<li>'+sslEscapeHtml(w)+'</li>').join('');
}
function updateSslPreview(){
  const info=document.getElementById('sslExportInfo');
  const check=sslReadiness(),button=document.getElementById('sslExportBtn');
  if(button)button.disabled=!check.ready;
  renderSslWarns(check.errors.concat(check.warnings));
  if(info) info.textContent=check.ready?'現在の設定で 設定行 '+check.lines.length+' 行 / 対象オブジェクト '+check.objectCount+' 個':(sslColors.length?'書き出し前に修正が必要です':'');
}
function sslDownloadCsv(){
  const info=document.getElementById('sslExportInfo');
  if(!sslColors.length){ if(info) info.textContent='先に objcatidlist.csv を読み込んでください。'; return; }
  sslEnsureCalcs();
  const built=sslReadiness();
  renderSslWarns(built.errors.concat(built.warnings));
  if(!built.ready){
    if(info) info.textContent='書き出しを停止しました。修正項目を確認してください。';
    return;
  }
  const now=new Date();
  const stamp=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  const all=[
    '; cfd_boundary_tool SSL export '+stamp+',,',
    '; cfd_boundary_tool contract=1 flow_unit='+document.getElementById('sslFlowUnit').value+',,',
    '\u25CF\u30C7\u30FC\u30BF\u958B\u59CB\u884C,=,=',                       // ●データ開始行
    '\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8ID,\u30D1\u30E9\u30E1\u30FC\u30BFID,\u30D1\u30E9\u30E1\u30FC\u30BF'  // タイトル行
  ].concat(built.lines);
  const enc=sslEncodeSjis(all.join('\r\n')+'\r\n');
  if(enc.bad.length){
    renderSslWarns(built.warnings.concat(['Shift-JIS変換できない文字が含まれるため書き出せません。材質名はASCIIか既定候補を使用してください']));
    return;
  }
  const blob=new Blob([enc.bytes], {type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='objParam.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  if(info) info.textContent='objParam.csv を書き出しました (設定行 '+built.lines.length+' 行 / 対象オブジェクト '+built.objectCount+' 個)。FDの .fdp と同じフォルダへ置き、名前を objParam.csv（(1)なし）にしてから、FDの読込スクリプトを実行してください。';
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
      const restored=Array.isArray(s.ssl.colors)?s.ssl.colors:[];
      const checked=sslParseCategoryCsv(restored.map(c=>String(c.rgb)+','+(Array.isArray(c.ids)?c.ids.join(' '):'')).join('\n'));
      sslColors=checked.colors;
      sslCatDiagnostics={errors:checked.errors,warnings:checked.warnings};
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

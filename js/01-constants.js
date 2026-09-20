// ========================= 定数データ =========================
// ドア隙間の開口率 (隙間モデル化ケース「④上辺・UC開口率不均一」のみ採用)
// モデル高さは上辺・アンダーカットとも0.1m(100mm)に統一 (今回の解析メッシュが100mm均一のため)
const doorGapTable = {
  '開戸_15': {topR:25.2, ucR:29.0},
  '引戸_15': {topR:29.5, ucR:27.7},
  '開戸_45': {topR:25.2, ucR:57.0},
  '引戸_45': {topR:29.5, ucR:56.5}
};
// (社)日本サッシ協会「建具とガラスの組み合わせ」による開口部の熱貫流率 [W/(m²K)] (2025/7改訂)
// vals = [付属部材無し, シャッター・雨戸付, 和障子付, 風除室あり]
const jsmaWinTable = {
  '樹脂製建具又は木製建具': [
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス入) / 中空層12mm以上', vals:[1.50,1.41,1.35,1.31]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス入) / 中空層10mm以上12mm未満', vals:[1.60,1.49,1.43,1.38]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス入) / 中空層8mm以上10mm未満', vals:[1.70,1.58,1.51,1.46]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス入) / 中空層8mm未満', vals:[1.90,1.75,1.66,1.60]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス無) / 中空層13mm以上', vals:[1.60,1.49,1.43,1.38]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス無) / 中空層10mm以上13mm未満', vals:[1.70,1.58,1.51,1.46]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス無) / 中空層7mm以上10mm未満', vals:[1.90,1.75,1.66,1.60]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス無) / 中空層7mm未満', vals:[2.15,1.96,1.86,1.77]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス入) / 中空層12mm以上', vals:[1.70,1.58,1.51,1.46]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス入) / 中空層8mm以上12mm未満', vals:[1.90,1.75,1.66,1.60]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス入) / 中空層8mm未満', vals:[2.15,1.96,1.86,1.77]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス無) / 中空層16mm以上', vals:[1.70,1.58,1.51,1.46]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス無) / 中空層10mm以上16mm未満', vals:[1.90,1.75,1.66,1.60]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス無) / 中空層7mm以上10mm未満', vals:[2.15,1.96,1.86,1.77]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス無) / 中空層7mm未満', vals:[2.33,2.11,1.99,1.89]},
    {label:'三層複層ガラス / 一般ガラス (ガス無) / 中空層14mm以上', vals:[2.15,1.96,1.86,1.77]},
    {label:'三層複層ガラス / 一般ガラス (ガス無) / 中空層8mm以上14mm未満', vals:[2.33,2.11,1.99,1.89]},
    {label:'三層複層ガラス / 一般ガラス (ガス無) / 中空層8mm未満', vals:[2.91,2.59,2.41,2.26]},
    {label:'複層ガラス / Low-Eガラス (ガス入) / 中空層10mm以上', vals:[2.15,1.96,1.86,1.77]},
    {label:'複層ガラス / Low-Eガラス (ガス入) / 中空層8mm以上10mm未満', vals:[2.33,2.11,1.99,1.89]},
    {label:'複層ガラス / Low-Eガラス (ガス入) / 中空層8mm未満', vals:[2.91,2.59,2.41,2.26]},
    {label:'複層ガラス / Low-Eガラス (ガス無) / 中空層14mm以上', vals:[2.15,1.96,1.86,1.77]},
    {label:'複層ガラス / Low-Eガラス (ガス無) / 中空層11mm以上14mm未満', vals:[2.33,2.11,1.99,1.89]},
    {label:'複層ガラス / Low-Eガラス (ガス無) / 中空層11mm未満', vals:[2.91,2.59,2.41,2.26]},
    {label:'複層ガラス / 一般ガラス (ガス無) / 中空層13mm以上', vals:[2.91,2.59,2.41,2.26]},
    {label:'複層ガラス / 一般ガラス (ガス無) / 中空層13mm未満', vals:[3.49,3.04,2.82,2.59]},
    {label:'単板ガラス', vals:[6.51,5.23,4.76,3.95]}
  ],
  '樹脂 (又は木) と金属の複合材料製建具': [
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス入) / 中空層14mm以上', vals:[1.60,1.49,1.43,1.38]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス入) / 中空層11mm以上14mm未満', vals:[1.70,1.58,1.51,1.46]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス入) / 中空層8mm以上11mm未満', vals:[1.90,1.75,1.66,1.60]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス入) / 中空層8mm未満', vals:[2.15,1.96,1.86,1.77]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス無) / 中空層15mm以上', vals:[1.70,1.58,1.51,1.46]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス無) / 中空層10mm以上15mm未満', vals:[1.90,1.75,1.66,1.60]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス無) / 中空層7mm以上10mm未満', vals:[2.15,1.96,1.86,1.77]},
    {label:'三層複層ガラス / Low-Eガラス2枚 (ガス無) / 中空層7mm未満', vals:[2.33,2.11,1.99,1.89]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス入) / 中空層12mm以上', vals:[1.90,1.75,1.66,1.60]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス入) / 中空層8mm以上12mm未満', vals:[2.15,1.96,1.86,1.77]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス入) / 中空層8mm未満', vals:[2.33,2.11,1.99,1.89]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス無) / 中空層16mm以上', vals:[1.90,1.75,1.66,1.60]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス無) / 中空層10mm以上16mm未満', vals:[2.15,1.96,1.86,1.77]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス無) / 中空層8mm以上10mm未満', vals:[2.33,2.11,1.99,1.89]},
    {label:'三層複層ガラス / Low-Eガラス1枚 (ガス無) / 中空層8mm未満', vals:[2.91,2.59,2.41,2.26]},
    {label:'三層複層ガラス / 一般ガラス (ガス無) / 厚さ問わず', vals:[2.91,2.59,2.41,2.26]},
    {label:'複層ガラス / Low-Eガラス (ガス入) / 中空層14mm以上', vals:[2.33,2.11,1.99,1.89]},
    {label:'複層ガラス / Low-Eガラス (ガス入) / 中空層14mm未満', vals:[2.91,2.59,2.41,2.26]},
    {label:'複層ガラス / Low-Eガラス (ガス無) / 中空層9mm以上', vals:[2.91,2.59,2.41,2.26]},
    {label:'複層ガラス / Low-Eガラス (ガス無) / 中空層9mm未満', vals:[3.49,3.04,2.82,2.59]},
    {label:'複層ガラス / 一般ガラス (ガス無) / 中空層11mm以上', vals:[3.49,3.04,2.82,2.59]},
    {label:'複層ガラス / 一般ガラス (ガス無) / 中空層11mm未満', vals:[4.07,3.49,3.21,2.90]},
    {label:'単板ガラス', vals:[6.51,5.23,4.76,3.95]}
  ],
  'その他・金属製建具・金属製熱遮断構造建具等': [
    {label:'複層ガラス / Low-Eガラス (ガス入) / 中空層10mm以上', vals:[2.91,2.59,2.41,2.26]},
    {label:'複層ガラス / Low-Eガラス (ガス入) / 中空層10mm未満', vals:[3.49,3.04,2.82,2.59]},
    {label:'複層ガラス / Low-Eガラス (ガス無) / 中空層14mm以上', vals:[2.91,2.59,2.41,2.26]},
    {label:'複層ガラス / Low-Eガラス (ガス無) / 中空層7mm以上14mm未満', vals:[3.49,3.04,2.82,2.59]},
    {label:'複層ガラス / Low-Eガラス (ガス無) / 中空層7mm未満', vals:[4.07,3.49,3.21,2.90]},
    {label:'複層ガラス / 一般ガラス (ガス無) / 中空層8mm以上', vals:[4.07,3.49,3.21,2.90]},
    {label:'複層ガラス / 一般ガラス (ガス無) / 中空層8mm未満', vals:[4.65,3.92,3.60,3.18]},
    {label:'単板ガラス', vals:[6.51,5.23,4.76,3.95]}
  ]
};
// 畳数→冷房能力の一般カタログ値 (定格/最大, kW)
const acCatalog = [
  {tatami:6,  rated:2.2, max:3.4},
  {tatami:8,  rated:2.5, max:3.5},
  {tatami:10, rated:2.8, max:4.0},
  {tatami:12, rated:3.6, max:4.3},
  {tatami:14, rated:4.0, max:5.0},
  {tatami:18, rated:5.6, max:6.0},
  {tatami:20, rated:6.3, max:7.1}
];
// Z-Tシリーズ フリーブロー風量 (㎥/h)
// 30°は実測値が1点(1000㎥/h)のみのため、ノッチに関わらず同じ値を表示する
const flowTable = {
  '水平': {'強':608, '弱':478, '微':350},
  '50°': {'強':1510, '弱':1010, '微':830},
  '30°': {'強':1000, '弱':1000, '微':1000}
};
// チャート配色は cooling_load_viewer_2.html の PALETTE に合わせる
const orientations = [
  {name:'北', az:180, color:'#4FC4E4'},
  {name:'北東', az:-135, color:'#54B857'},
  {name:'東', az:-90, color:'#F2A45C'},
  {name:'南東', az:-45, color:'#DD4FDD'},
  {name:'南', az:0, color:'#ED6A47'},
  {name:'南西', az:45, color:'#5D74C7'},
  {name:'西', az:90, color:'#3E5ED0'},
  {name:'北西', az:135, color:'#9AA0A6'}
];
if(window.Chart && Chart.defaults && Chart.defaults.font){
  Chart.defaults.font.family='"Helvetica Neue",Helvetica,Arial,sans-serif';
  Chart.defaults.color='#8C8C8C';
}
const etaTable = [
  {label:"3層 Low-E複層/真空複層(日射取得型)", vals:[0.54,0.34,0.41,0.12]},
  {label:"3層 Low-E複層/真空複層(日射遮蔽型)", vals:[0.33,0.22,0.26,0.08]},
  {label:"3層 Low-E三層複層/真空複層(日射取得型)", vals:[0.59,0.37,0.44,0.14]},
  {label:"3層 Low-E三層複層/真空複層(日射遮蔽型)", vals:[0.37,0.25,0.29,0.10]},
  {label:"3層 三層複層または真空複層ガラス", vals:[0.72,0.38,0.53,0.18]},
  {label:"2層 Low-E複層/真空ガラス(日射取得型)", vals:[0.64,0.38,0.47,0.15]},
  {label:"2層 Low-E複層/真空ガラス(日射遮蔽型)", vals:[0.40,0.26,0.31,0.11]},
  {label:"2層 二層複層・真空・単板2枚組合せ", vals:[0.79,0.38,0.57,0.17]},
  {label:"1層 単板ガラス", vals:[0.88,0.38,0.62,0.19]}
];
const attachTable = ["付属部材なし","和障子","内付けの日射遮蔽部材(和障子を除く)","外付けの日射遮蔽部材"];
const RHOCP = 1.2*1000/3600; // W per (m3/h * K)
const LATENT_KJ_PER_KG = 2450; // 水の蒸発潜熱。発湿 g/h → 潜熱 W は ÷3600
function moistGPerHToLatentW(gPerH){
  return (gPerH||0) * LATENT_KJ_PER_KG / 3600;
}
// 全モード共通の講義用初期値。換気回数は法令相当の 0.5 回/h。
// EnergyPlus モードの在室人数は IDF の People（最大人数）から入れる。
const TOOL_DEFAULTS = {
  uFloor1: 0.28,
  uFound: 0.46,
  peopleSensRate: 60,
  peopleMoistRate: 76,
  equipSensRate: 5,
  equipMoistRate: 0,
  ach: 0.5,
  lat: 35.68,
  lon: 139.77,
  calcDate: '2026-07-25',
  detailHour: 14,
  solarFc: 0.10,
  sslMatWood: '2杉(1)',
  sslMatGlass: '1ガラス板(Low-E複層)'
};
// 窓Uの種類ごとに 3DS / SSL で色を分ける。先頭は従来の窓色 (80,180,220)
const WINDOW_U_COLOR_PALETTE = [
  {r:80, g:180, b:220},
  {r:20, g:90, b:175},
  {r:0, g:165, b:145},
  {r:110, g:70, b:200},
  {r:40, g:190, b:90},
  {r:15, g:55, b:120},
  {r:0, g:130, b:190},
  {r:70, g:40, b:160}
];
// FDに置いたモジュール／埋メの確定色。IDF 3DSパレットと合わせて SSL が自動割当する。
const SSL_FIXED_COLORS = [
  {hex:'#808080', key:'ac_body'},
  {hex:'#003cff', key:'ac_supply'},
  {hex:'#1d6d35', key:'ac_return'},
  {hex:'#ff6018', key:'doorbody'},
  {hex:'#8c5a32', key:'doorbody'},
  {hex:'#62a446', key:'doorgap_top'},
  {hex:'#008080', key:'doorgap_uc'},
  {hex:'#3d3d3d', key:'fill_solid'},
  {hex:'#967648', key:'stair_solid'}
];
const SSL_COLOR_TOLERANCE = 12;
// 重なり時の優先度（大きい方が残る）。SSL公式IDは無いので 90001 を書き、読み込みVBSが obj set priority する。
const SSL_PRIORITY = {
  wall_北:10, wall_北東:10, wall_東:10, wall_南東:10,
  wall_南:10, wall_南西:10, wall_西:10, wall_北西:10,
  roof:10, floor1:10, floor_out:10, found:10, innerwall:10, attic:10, fill_solid:10, stair_solid:10,
  window:30, doorbody:30,
  doorgap_top:50, doorgap_uc:50, ac_body:50,
  ac_supply:90, ac_return:90
};
const SSL_PRIORITY_PARAM_ID = 90001;
const FILL_SOLID_COLOR = {r:61, g:61, b:61, mat:'FILL'};
const GAIN_VOLUME_SETBACK_M = 0.3;
function gainVolumeColor(i){
  const n = i||0;
  const g = 176 - (n % 8) * 16;
  const b = 168 - Math.floor(n / 8) * 18;
  return {r:255, g:Math.max(80, g), b:Math.max(80, b), mat:'GAIN'+String(n)};
}


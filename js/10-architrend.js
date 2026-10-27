// ========================= アーキトレンド連携 =========================
var appMode = null; // 'manual' | 'architrend' | 'energyplus'
let atUnassignedWindows = [];
let atAssignableRooms = [];
let atNorthExcludedCount = 0;
let atLastParse = null;
let atCsvParse = null;
let atPdfParse = null;
let atImportState = {status:'empty', codes:[]};
let atImportSequence = 0;
const AT_AZ = {南:0, 南東:-45, 東:-90, 北東:-135, 北:180, 北西:135, 西:90, 南西:45};
function isNorthFacingAz(value){
  const az=Number(value);
  return Number.isFinite(az) && Math.abs(Math.abs(az)-180)<0.5;
}
const AT_BLANK_IDS = [
  'calcDate','detailHour','lat','lon','tmax','tmin','tpeak','targetT',
  'uWall','uRoof','uWin','uDoor','uaVal','envArea','roomVol','ach','hxRate','acMax'
];
const AT_MANUAL_IDS = AT_BLANK_IDS.filter(id=>id!=='acMax'&&id!=='uDoor').concat(['acCount']);

if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'vendor/pdf.worker-3.11.174.js';
}

function selectMode(next){
  if(!next || next===appMode) return;
  if(appMode) saveStateNow();
  if(next==='architrend') startArchitrendMode(loadModeState('architrend'));
  else if(next==='energyplus') startEnergyPlusMode(loadModeState('energyplus'));
  else startManualMode(loadModeState('manual'));
}

function setModeUI(mode){
  appMode = mode;
  const modeLabel = mode==='architrend' ? 'モード: アーキトレンド' : (mode==='energyplus' ? 'モード: EnergyPlus' : 'モード: 手動入力');
  const modeInfo = document.getElementById('modeInfo');
  if(modeInfo) modeInfo.textContent = modeLabel;
  document.querySelectorAll('#modeTabs [data-mode]').forEach(btn=>{
    const on = btn.getAttribute('data-mode')===mode;
    btn.classList.toggle('is-current', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    btn.tabIndex = on ? 0 : -1;
  });
  document.getElementById('atPanel').classList.toggle('active', mode==='architrend');
  const epPanel = document.getElementById('epPanel');
  if(epPanel) epPanel.classList.toggle('active', mode==='energyplus');
  document.getElementById('legendManual').style.display = (mode==='architrend' || mode==='energyplus') ? 'none' : 'flex';
  document.getElementById('legendAt').style.display = mode==='architrend' ? 'flex' : 'none';
  const legendEp = document.getElementById('legendEp');
  if(legendEp) legendEp.style.display = mode==='energyplus' ? 'flex' : 'none';
  const epStep2Hint = document.getElementById('epStep2Hint');
  if(epStep2Hint) epStep2Hint.style.display = mode==='energyplus' ? 'block' : 'none';
  const epHottestNote = document.getElementById('epHottestNote');
  const fetchHottestInfo = document.getElementById('fetchHottestInfo');
  if(epHottestNote) epHottestNote.style.display = mode==='energyplus' ? 'inline' : 'none';
  if(fetchHottestInfo) fetchHottestInfo.style.display = mode==='energyplus' ? 'none' : 'inline';
  document.querySelectorAll('.tag-req').forEach(el=>{
    if(el.closest('#legendManual') || el.closest('#legendAt') || el.closest('#legendEp')) return;
    el.textContent = (mode==='architrend' || mode==='energyplus') ? '要手動' : '要設定';
  });
  if(mode!=='architrend'){
    if(typeof atClearRoomVolumeAuto==='function') atClearRoomVolumeAuto();
    atUnassignedWindows = [];
    atAssignableRooms = [];
    atNorthExcludedCount = 0;
    const box = document.getElementById('atUnassignedBox');
    const list = document.getElementById('atUnassignedList');
    if(box) box.style.display = 'none';
    if(list) list.innerHTML = '';
  }
  if(mode!=='energyplus' && typeof epHideRoomViewer==='function') epHideRoomViewer();
  if(mode==='energyplus' && typeof epSyncViewerMesh==='function') epSyncViewerMesh();
  else if(mode==='architrend' && typeof atRenderRoomViewer==='function' && typeof atMesh!=='undefined' && atMesh) atRenderRoomViewer();
  refreshArchitrendEnvelopeHints();
  if(typeof window.boundaryThermalRender==='function')window.boundaryThermalRender();
}

function blankForArchitrend(){
  if(typeof atClearRoomVolumeAuto==='function') atClearRoomVolumeAuto();
  AT_BLANK_IDS.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  document.getElementById('roomsWrap').innerHTML = '';
  roomCount = 0; winCounter = 0;
  atUnassignedWindows = [];
  atAssignableRooms = [];
  atNorthExcludedCount = 0;
  renderUnassignedWindows();
  applySharedToolDefaults();
}

function markAtFilled(id, on){
  const el = document.getElementById(id);
  if(!el) return;
  const wrap = el.closest('div');
  if(!wrap) return;
  wrap.classList.toggle('at-filled', !!on);
}

function tokenizeULine(s){
  const out = [];
  let i = 0;
  const str = String(s).replace(/－/g, '-');
  while(i < str.length){
    if(str[i] === '-'){ i++; continue; }
    const m = str.slice(i).match(/^(\d+\.\d{3})/);
    if(m){ out.push(parseFloat(m[1])); i += m[1].length; continue; }
    i++;
  }
  return out;
}

function normalizePdfText(s){
  return String(s||'').replace(/\s+/g,'').replace(/[（）]/g, m=>m==='（'?'(':')');
}

function csvText(value){
  return String(value==null?'':value).normalize('NFKC').replace(/[−‐‑‒–—―]/g,'-').trim();
}

function csvDelimiter(text){
  const counts={',':0,'\t':0,';':0};
  let quoted=false, lines=0;
  for(let i=0;i<text.length && lines<40;i++){
    const ch=text[i];
    if(ch==='"'){
      if(quoted && text[i+1]==='"'){i++;continue;}
      quoted=!quoted;
    }else if(!quoted){
      if(ch==='\n' || ch==='\r'){lines++;if(ch==='\r'&&text[i+1]==='\n')i++;}
      else if(ch in counts)counts[ch]++;
    }
  }
  return Object.keys(counts).reduce((best,key)=>counts[key]>counts[best]?key:best,',');
}

function parseCsvRows(text){
  const rows=[];
  let row=[], field='', quoted=false, malformed=false, closed=false, line=1, startLine=1;
  const src=String(text||'').replace(/^\uFEFF/,'');
  const delimiter=csvDelimiter(src), rowNumbers=[];
  for(let i=0;i<src.length;i++){
    const ch=src[i];
    if(quoted){
      if(ch==='"' && src[i+1]==='"'){ field+='"'; i++; }
      else if(ch==='"'){quoted=false;closed=true;}
      else {field+=ch;if(ch==='\n'||ch==='\r'&&src[i+1]!=='\n')line++;}
    }else if(ch==='"'){
      if(field.trim()!==''||closed)malformed=true;
      quoted=true;
    }else if(ch===delimiter){
      row.push(field); field='';closed=false;
    }else if(ch==='\n'||ch==='\r'){
      row.push(field); rows.push(row); rowNumbers.push(startLine);row=[];field='';closed=false;
      if(ch==='\r'&&src[i+1]==='\n')i++;
      line++;startLine=line;
    }else{
      if(closed&&ch.trim()!=='')malformed=true;
      field+=ch;
    }
  }
  if(field!=='' || row.length){row.push(field);rows.push(row);rowNumbers.push(startLine);}
  rows.rowNumbers=rowNumbers;rows.delimiter=delimiter;rows.malformed=quoted||malformed;
  return rows;
}

function csvNumber(value){
  const s=csvText(value);
  if(!s || s==='－' || s==='-') return null;
  if(!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s))return null;
  const n=Number(s.replace(/,/g,''));
  return Number.isFinite(n)?n:null;
}

function csvFloor(value){
  const s=csvText(value).toUpperCase().replace(/\s/g,'');
  if(/^(?:R|RF|屋上|屋根)$/.test(s))return 'R';
  const m=s.match(/^(?:地上)?(\d+)(?:F|階)?$/);
  return m?String(Number(m[1])):s;
}

function csvHeader(value){
  return csvText(value).toLowerCase().replace(/\s/g,'').replace(/\[[^\]]*\]|\([^)]*\)/g,'');
}

function architrendWindowKey(window){return csvFloor(window.floor)+'|'+csvText(window.id);}

function architrendImportReadiness(){
  const diagnostics=atLastParse&&atLastParse.result&&atLastParse.result.csvDiagnostics;
  let codes=[...new Set([...(atImportState.codes||[]),...(diagnostics?diagnostics.rows.filter(r=>r.severity==='error').map(r=>r.code):[])])];
  if(atLastParse&&atLastParse.result.validation&&atLastParse.result.validation.windows&&atLastParse.result.validation.windows.crossOk===false)codes.push('CSV_PDF_WINDOW_MISMATCH');
  const loading=atImportState.status==='loading', invalid=atImportState.status==='invalid';
  const requiredManual=diagnostics?diagnostics.requiredManual||[]:[];
  let thermal=null;
  if(atLastParse&&(requiredManual.length||typeof atMesh!=='undefined'&&atMesh)&&typeof window.boundaryThermalReadiness==='function'){
    try{thermal=window.boundaryThermalReadiness(requiredManual,atLastParse.result);}catch(err){thermal={ready:false,codes:['THERMAL_CHECK_FAILED']};}
  }
  const needsReview=(requiredManual.length>0||!!thermal)&&(!thermal||thermal.ready!==true);
  const structuralInvalid=invalid||codes.length>0;
  if(needsReview)codes=[...new Set([...codes,...requiredManual.map(r=>r.code),...(thermal&&Array.isArray(thermal.codes)?thermal.codes:[])])];
  const ready=!!atLastParse&&!loading&&!structuralInvalid&&!needsReview;
  return {ready,status:loading?'loading':structuralInvalid?'invalid':needsReview?'needs-review':ready?'ready':'empty',blocking:!ready,codes,counts:diagnostics?diagnostics.counts:{},requiredManual};
}

function architrendWindowReadiness(){
  if(typeof appMode!=='undefined'&&appMode!=='architrend')return {ready:true,codes:[]};
  const codes=[],mesh=typeof atMesh!=='undefined'?atMesh:null;
  const source=atLastParse&&atLastParse.result;
  const allWindows=mesh?(mesh.meshFaces||[]).filter(f=>f.sslKey==='window'):[];
  const windows=allWindows.map((face,index)=>({face,index})).filter(w=>!w.face.atReplacedByPart);
  if(atUnassignedWindows.length)codes.push('WINDOW_ASSIGNMENT_REQUIRED');
  if(!mesh&&(source&&source.windows||[]).length)codes.push('WINDOW_MODEL_REQUIRED');
  if(mesh&&(source&&source.windows||[]).length&&!allWindows.length)codes.push('WINDOW_SOURCE_MODEL_MISMATCH');
  const rows=typeof document.querySelectorAll==='function'?[...document.querySelectorAll('.room-card .win-row')]:[];
  const found=new Set(),globalU=csvNumber((document.getElementById('uWin')||{}).value);
  const read=(row,selector)=>csvNumber((row.querySelector(selector)||{}).value);
  for(const row of rows){
    const index=row.dataset&&row.dataset.atMeshWindowIndex;
    const face=row.dataset&&row.dataset.atFaceId;
    const candidates=windows.filter(w=>face?String(w.face.atFaceId)===String(face):index!==''&&index!=null&&String(w.index)===String(index));
    if(windows.length&&candidates.length!==1){codes.push('WINDOW_GEOMETRY_LINK_REQUIRED');continue;}
    if(candidates.length){
      const key=candidates[0].index;if(found.has(key))codes.push('WINDOW_DUPLICATE_LINK');found.add(key);
    }
    const eta=read(row,'.wEta'),area=read(row,'.wArea'),az=read(row,'.wAz'),u=read(row,'.wU');
    if(eta===null||eta<0||eta>1)codes.push('WINDOW_SOLAR_REQUIRED');
    if(!(area>0))codes.push('WINDOW_AREA_REQUIRED');
    if(az===null)codes.push('WINDOW_DIRECTION_REQUIRED');
    if(!(u>0)&&!(globalU>0))codes.push('WINDOW_U_REQUIRED');
  }
  if(windows.some(w=>!found.has(w.index)))codes.push('WINDOW_GEOMETRY_LINK_REQUIRED');
  if(typeof window.boundaryWindowOrientationState==='function'){
    try{
      const orientation=window.boundaryWindowOrientationState();
      // Current, applied source evidence only. Keep entered values, but retire
      // their use for conditions after a North change breaks strict matching.
      if(orientation?.ready===true&&orientation.codes?.includes('WINDOW_ORIENTATION_MISMATCH'))codes.push('WINDOW_ORIENTATION_MISMATCH');
    }catch(error){/* Unavailable diagnostics do not invent a new mismatch. */}
  }
  return {ready:codes.length===0,codes:[...new Set(codes)],count:windows.length,linked:found.size};
}

function architrendWindowUState(){
  const source=atLastParse&&atLastParse.result,mesh=typeof atMesh!=='undefined'?atMesh:null;
  const allWindows=mesh?(mesh.meshFaces||[]).filter(f=>f.sslKey==='window'):[];
  const windows=allWindows.map((face,index)=>({face,index})).filter(w=>!w.face.atReplacedByPart);
  const rows=typeof document.querySelectorAll==='function'?[...document.querySelectorAll('.room-card .win-row')]:[];
  const unique=list=>[...new Set(list.filter(n=>n>0&&Number.isFinite(n)).map(n=>Math.round(n*1000)/1000))].sort((a,b)=>a-b);
  const sourceUs=unique((source&&source.windows||[]).map(w=>csvNumber(w.u)));
  const globalU=csvNumber((document.getElementById('uWin')||{}).value);
  const localU=row=>csvNumber((row&&row.querySelector('.wU')||{}).value);
  const matches=window=>rows.filter(row=>{
    const ds=row.dataset||{};
    return ds.atFaceId?String(ds.atFaceId)===String(window.face.atFaceId):ds.atMeshWindowIndex!==''&&ds.atMeshWindowIndex!=null&&String(ds.atMeshWindowIndex)===String(window.index);
  });
  const linked=windows.map(window=>{
    const found=matches(window),local=found.length===1?localU(found[0]):null;
    const u=local>0?local:globalU>0?globalU:sourceUs.length===1?sourceUs[0]:null;
    return {...window,found,local,u};
  });
  const us=unique(linked.map(w=>w.u));
  const multiple=sourceUs.length>1||us.length>1||unique(rows.map(localU)).length>1;
  const codes=[];
  if(multiple){
    if(!mesh)codes.push('WINDOW_MULTI_U_MODEL_REQUIRED');
    if(mesh&&!allWindows.length&&(source&&source.windows||[]).length)codes.push('WINDOW_SOURCE_MODEL_MISMATCH');
    if(atUnassignedWindows.length)codes.push('WINDOW_MULTI_U_ASSIGNMENT_REQUIRED');
    if(linked.some(w=>w.found.length!==1||!(w.local>0)))codes.push('WINDOW_MULTI_U_ASSIGNMENT_REQUIRED');
    const rowLinks=new Map();linked.forEach(w=>w.found.forEach(row=>rowLinks.set(row,(rowLinks.get(row)||0)+1)));
    if(rows.some(row=>rowLinks.get(row)!==1))codes.push('WINDOW_MULTI_U_LINK_REQUIRED');
  }
  let groups=[];
  if(us.length&&typeof windowUColorGroupsFromUs==='function')groups=windowUColorGroupsFromUs(us);
  else if(us.length)codes.push('WINDOW_U_PALETTE_UNAVAILABLE');
  if(groups.length!==us.length)codes.push('WINDOW_U_PALETTE_UNAVAILABLE');
  if(new Set(groups.map(g=>[g.color.r,g.color.g,g.color.b].join(' '))).size!==groups.length)codes.push('WINDOW_U_COLOR_CAPACITY');
  return {ready:codes.length===0,codes:[...new Set(codes)],multiple,groups,linked};
}

function architrendWindowUReadiness(){
  const state=architrendWindowUState();
  return {ready:state.ready,codes:state.codes,multiple:state.multiple,count:state.linked.length,groupCount:state.groups.length};
}

function architrendWindowUGroups(){
  const state=architrendWindowUState();return state.ready?state.groups:[];
}

function architrendWindowPalette(face){
  if(!face||face.sslKey!=='window')return null;
  const state=architrendWindowUState();if(!state.ready)return null;
  const found=state.linked.filter(w=>String(w.face.atFaceId)===String(face.atFaceId));
  if(found.length!==1||!(found[0].u>0))return null;
  const u=Math.round(found[0].u*1000)/1000,group=state.groups.find(g=>g.u===u);
  return group?{...group.color,mat:group.mat,u:group.u,sslKey:'window'}:null;
}

function emptyArchitrendResult(){
  return {
    projectName:null, workName:null, projectLocation:null,
    ua:null, envArea:null, uRoof:null, uWall:null, uFloor:null, uFound:null, uWin:null, uDoor:null,
    trueNorthDeg:null, trueNorthNote:null,
    rooms:[], habitableRooms:[], excludedRooms:[], windows:[],
    notes:[], validation:{}, sources:{}, inputSources:{csv:false,pdf:false}
  };
}

function parseArchiTrendCsv(text){
  const parsedRows=parseCsvRows(text);
  const records=parsedRows.map((cells,i)=>({cells,row:parsedRows.rowNumbers[i]})).filter(r=>r.cells.some(c=>csvText(c)!==''));
  const warnings=[], diagnostics=[], requiredManual=[];
  const result=emptyArchitrendResult();
  result.inputSources.csv=true;
  const counts={inputRows:0,acceptedRows:0,rejectedRows:0,ignoredRows:0,mergedRows:0,inputWindows:0,acceptedWindows:0};
  const messages={HEADER_MISSING:'部位・面積の見出しを確認できません',CSV_QUOTE:'CSVの引用符が閉じられていません',NO_DATA:'CSVにデータ行がありません',PREAMBLE:'見出しより前の行を読み飛ばしました',UNKNOWN_COLUMN:'未対応の列があります。列番号を確認してください',UNKNOWN_PART:'未対応の部位行を保留しました',REPEATED_HEADER:'途中の見出し行を読み飛ばしました',NUMBER_INVALID:'数値欄を読み取れません',WINDOW_SOLAR:'窓の日射熱取得率は0〜1の値で指定してください',WINDOW_DIMENSIONS:'窓の幅・高さ・面積を確認してください',WINDOW_AREA:'窓の幅×高さと面積が一致しません',WINDOW_NAME:'窓名称が空欄のため行番号で識別します',WINDOW_FLOOR:'窓の階が不明のため自動対応を保留します',WINDOW_DIRECTION:'窓の方位が不明のため自動対応を保留します',WINDOW_DUPLICATE:'同じ階・IDの一致する窓行を統合しました',WINDOW_CONFLICT:'同じ階・IDの窓行に異なる値があります',ENVELOPE_TOTAL:'外皮面積合計を取得できませんでした',TOTAL_CONFLICT:'外皮面積合計が複数あり値が一致しません',MULTIPLE_SPECS:'同じ部位に複数仕様があります。単一のU値へまとめず保留しました',SPEC_MISSING:'仕様が不明のため部位U値の自動反映を保留しました',CEILING_BOUNDARY:'天井・小屋裏の行は屋根U値へ置換しません。境界と仕様を確認してください',ADJACENCY_MISSING:'隣接空間が不明のため部位U値の自動反映を保留しました',ENVELOPE_VALUE:'外皮の面積・熱損失を確認してください'};
  function add(code,row=0,severity='warning',column){
    diagnostics.push({code,row,severity,...(column==null?{}:{column:column+1})});
    if(severity!=='info')warnings.push((row?'CSV '+row+'行: ':'')+messages[code]);
  }
  function finish(){
    counts.acceptedWindows=result.windows.length;
    counts.invalidRows=new Set(diagnostics.filter(d=>d.severity==='error'&&d.row).map(d=>d.row)).size;
    result.csvDiagnostics={version:1,delimiter:parsedRows.delimiter==='\t'?'tab':parsedRows.delimiter,counts,rows:diagnostics,requiredManual,blocking:diagnostics.some(d=>d.severity==='error')};
    const areaSum=result.windows.reduce((s,w)=>s+(w.area||0),0),gainSum=result.windows.reduce((s,w)=>s+(w.gainCooling||0),0);
    result.validation.windows={count:result.windows.length,areaSum,expectedArea:areaSum,gainSum,expectedGain:gainSum,areaOk:result.windows.every(w=>!w.ambiguous&&w.width>0&&w.height>0&&w.area>0&&Math.abs(w.width*w.height-w.area)<=Math.max(.02,w.area*.005)),gainOk:result.windows.every(w=>w.gainCooling!==null),source:'CSV'};
    return {result,warnings:[...new Set(warnings)],status:result.csvDiagnostics.blocking?'invalid':'ready'};
  }
  if(parsedRows.malformed){add('CSV_QUOTE',0,'error');return finish();}
  const aliases={part:['部位','部位名'],floor:['階','階数'],name:['名称','部材名','名前'],adjacent:['隣接空間','隣接条件'],width:['幅','寸法幅'],height:['高','高さ','寸法高'],area:['面積'],perimeter:['基礎周長','周長'],spec:['仕様','仕様名'],attachment:['付属品'],glass:['ガラス仕様'],loss:['貫流熱損失','熱貫流損失'],gainCooling:['日射熱取得量冷房期','冷房期日射熱取得量'],gainHeating:['日射熱取得量暖房期','暖房期日射熱取得量'],orient:['方位','方向'],az:['方位角'],eta:['η0','η','日射熱取得率','窓日射熱取得率','日射熱取得率η0']};
  const headerIndex=records.findIndex(r=>r.cells.some(v=>aliases.part.includes(csvHeader(v)))&&r.cells.some(v=>aliases.area.includes(csvHeader(v))));
  if(headerIndex<0){add('HEADER_MISSING',0,'error');return finish();}
  records.slice(0,headerIndex).forEach(r=>add('PREAMBLE',r.row,'info'));
  const h1=records[headerIndex].cells, next=records[headerIndex+1];
  const subheader=next&&next.cells.some(v=>['幅','高','高さ'].includes(csvHeader(v)))&&!csvText(next.cells[h1.findIndex(v=>aliases.part.includes(csvHeader(v)))]);
  const h2=subheader?next.cells:[],idx={},units={};
  for(const [key,labels] of Object.entries(aliases)){
    idx[key]=h1.findIndex(v=>labels.includes(csvHeader(v)));
    if(idx[key]<0)idx[key]=h2.findIndex(v=>labels.includes(csvHeader(v)));
    units[key]=idx[key]>=0?csvText(h1[idx[key]])+' '+csvText(h2[idx[key]]):'';
  }
  const knownColumns=new Set(Object.values(idx).filter(i=>i>=0));
  h1.forEach((v,i)=>{if(csvText(v)&&!knownColumns.has(i)&&!['寸法','装飾'].includes(csvHeader(v)))add('UNKNOWN_COLUMN',records[headerIndex].row,'warning',i);});
  const dataRows=records.slice(headerIndex+1+(subheader?1:0));counts.inputRows=dataRows.length;
  if(!dataRows.length){add('NO_DATA',0,'error');return finish();}
  result.csvEnvelopeRows=[];
  result.csvBoundaryRows=[];
  const seen=new Map(),knownParts=new Set(['窓','屋根','外壁','床','基礎','天井','階間','ドア','外部ドア','熱橋','土間床','外皮面積合計','基礎周長合計','合計']);
  const get=(row,key)=>idx[key]>=0?csvText(row[idx[key]]):'';
  function number(row,key,line){
    const value=get(row,key),n=csvNumber(value);
    if(value&&value!=='-'&&n===null)add('NUMBER_INVALID',line,'error',idx[key]);
    if(n===null)return null;
    const u=units[key].replace(/\s/g,'');
    if(['width','height','perimeter'].includes(key))return n*(/\[mm\]|\(mm\)/.test(u)?.001:/\[cm\]|\(cm\)/.test(u)?.01:1);
    if(key==='area')return n*(/\[mm[²2]\]|\(mm[²2]\)/.test(u)?1e-6:/\[cm[²2]\]|\(cm[²2]\)/.test(u)?1e-4:1);
    return n;
  }
  for(const record of dataRows){
    const row=record.cells,line=record.row,part=get(row,'part');
    if(aliases.part.includes(csvHeader(part))||!part&&row.some(v=>['幅','高','高さ'].includes(csvHeader(v)))&&row.every(v=>!csvText(v)||['幅','高','高さ'].includes(csvHeader(v)))){counts.ignoredRows++;add('REPEATED_HEADER',line,'info');continue;}
    if(!knownParts.has(part)){counts.rejectedRows++;add('UNKNOWN_PART',line,'error');continue;}
    if(part==='窓'){
      counts.inputWindows++;
      const id=get(row,'name')||'CSV-W'+line,floor=csvFloor(get(row,'floor'));
      const idMatch=id.match(/^(?:[A-Za-z]+[-_ ]?)?(南東|南西|北東|北西|南|北|東|西)[-_ ]?\d+$/);
      const orient=get(row,'orient')||(idMatch?idMatch[1]:'');
      const az=idx.az>=0?number(row,'az',line):orient in AT_AZ?AT_AZ[orient]:null;
      const win={id,floor,orient,az,width:number(row,'width',line),height:number(row,'height',line),area:number(row,'area',line),gainCooling:number(row,'gainCooling',line),gainHeating:number(row,'gainHeating',line),heatLoss:number(row,'loss',line),spec:get(row,'spec'),glassSpec:get(row,'glass'),attachment:get(row,'attachment'),eta:idx.eta>=0?number(row,'eta',line):null,tilt:90,roofLike:floor==='R',sourceLabel:'CSV',sourceRows:[line],uSource:'CSV 貫流熱損失÷面積（丸めを含む概算）'};
      if(!get(row,'name'))add('WINDOW_NAME',line);
      if(!/^(?:[1-9]\d*|R)$/.test(floor))add('WINDOW_FLOOR',line);
      if(az===null)add('WINDOW_DIRECTION',line);
      const key=architrendWindowKey(win),prior=seen.get(key);
      if(prior){
        const fields=['width','height','area','gainCooling','gainHeating','heatLoss','spec','glassSpec','attachment','az','orient','eta'];
        const present=v=>v!==null&&v!==''&&v!==undefined;
        if(fields.some(k=>present(prior[k])&&present(win[k])&&prior[k]!==win[k])){
          prior.ambiguous=true;counts.rejectedRows++;add('WINDOW_CONFLICT',line,'error');continue;
        }
        fields.forEach(k=>{if(!present(prior[k]))prior[k]=win[k];});prior.sourceRows.push(line);counts.mergedRows++;add('WINDOW_DUPLICATE',line,'info');
      }else{seen.set(key,win);result.windows.push(win);counts.acceptedRows++;}
      continue;
    }
    counts.acceptedRows++;
    if(part==='外皮面積合計'){
      const area=number(row,'area',line);
      if(result.envArea!==null&&result.envArea!==area)add('TOTAL_CONFLICT',line,'error');
      else result.envArea=area;
      continue;
    }
    if(['合計','基礎周長合計'].includes(part)){add('REPEATED_HEADER',line,'info');continue;}
    const adjacent=get(row,'adjacent');
    const item={part,adjacent,width:['ドア','外部ドア'].includes(part)?number(row,'width',line):null,height:['ドア','外部ドア'].includes(part)?number(row,'height',line):null,az:idx.az>=0?number(row,'az',line):null,floor:csvFloor(get(row,'floor')),name:get(row,'name'),area:number(row,'area',line),perimeter:number(row,'perimeter',line),heatLoss:number(row,'loss',line),spec:get(row,'spec'),sourceRow:line};
    result.csvBoundaryRows.push(item);
    if(part==='天井'){add('CEILING_BOUNDARY',line);continue;}
    if(['屋根','外壁','床'].includes(part)&&!adjacent)add('ADJACENCY_MISSING',line);
    if(['屋根','外壁','床','基礎'].includes(part)&&(adjacent==='外気'||part==='基礎')){
      result.csvEnvelopeRows.push(item);
      if(part!=='基礎'&&(!(item.area>0)||!(item.heatLoss>0)))add('ENVELOPE_VALUE',line);
    }
  }
  for(const w of result.windows){
    if(w.eta!==null&&(w.eta<0||w.eta>1)){add('WINDOW_SOLAR',w.sourceRows[0],'error');w.eta=null;}
    if(w.eta!==null)w.etaSource='CSV 窓日射熱取得率';
    w.gain=w.gainCooling;w.u=w.area>0&&w.heatLoss>0?w.heatLoss/w.area:null;
    if(!(w.width>0&&w.height>0&&w.area>0))add('WINDOW_DIMENSIONS',w.sourceRows[0],'error');
    else if(Math.abs(w.width*w.height-w.area)>Math.max(.02,w.area*.005))add('WINDOW_AREA',w.sourceRows[0],'error');
  }
  result.sources.envArea=result.envArea!==null?'CSV':null;
  // Only outside-air rows have Q=U*A. Foundation Q/perimeter is a linear
  // transmittance and must never be copied into a surface U-factor.
  for(const [part,key] of [['屋根','uRoof'],['外壁','uWall'],['床','uFloor']]){
    const group=result.csvEnvelopeRows.filter(r=>r.part===part);
    const target=part==='外壁'?'wall':part==='屋根'?'roof':'floor';
    const groups=[...new Set(group.map(r=>r.spec))].sort().map((spec,i)=>{
      const rows=group.filter(r=>r.spec===spec);
      return {id:target+'-spec-'+(i+1),spec,area:rows.reduce((n,r)=>n+(r.area||0),0),heatLoss:rows.reduce((n,r)=>n+(r.heatLoss||0),0),sourceRows:rows.map(r=>r.sourceRow)};
    });
    const manual=code=>requiredManual.push({code,field:key==='uFloor'?'uFloor1':key,dataKey:key,target,groups});
    if(group.some(r=>!(r.area>0&&r.heatLoss>0))){manual('ENVELOPE_VALUE');continue;}
    if(group.length&&group.some(r=>!r.spec)){add('SPEC_MISSING',group[0].sourceRow);manual('SPEC_MISSING');continue;}
    if(new Set(group.map(r=>r.spec)).size>1){add('MULTIPLE_SPECS',group[0].sourceRow);manual('MULTIPLE_SPECS');continue;}
    if(group.length&&new Set(group.map(r=>r.spec)).size===1){
      result[key]=group.reduce((n,r)=>n+r.heatLoss,0)/group.reduce((n,r)=>n+r.area,0);
      result.sources[key]='CSV 貫流熱損失÷面積（丸めを含む概算）';
    }
  }
  const doors=result.csvBoundaryRows.filter(r=>['ドア','外部ドア'].includes(r.part)&&r.adjacent==='外気');
  if(doors.length&&doors.every(r=>r.spec&&r.area>0&&r.heatLoss>0)&&new Set(doors.map(r=>r.spec)).size===1){
    result.uDoor=doors.reduce((n,r)=>n+r.heatLoss,0)/doors.reduce((n,r)=>n+r.area,0);result.sources.uDoor='CSV ドア 貫流熱損失÷面積（丸めを含む概算）';
  }
  if(diagnostics.some(d=>d.code==='CEILING_BOUNDARY'))requiredManual.push({code:'CEILING_BOUNDARY',field:'uRoof',dataKey:'uRoof',target:'ceiling',groups:result.csvBoundaryRows.filter(r=>r.part==='天井')});

  result.notes.push('CSVから窓'+result.windows.length+'枚を取得しました');
  if(!result.envArea)add('ENVELOPE_TOTAL');
  return finish();
}

function mergeArchitrendSources(csvParsed,pdfParsed){
  if(!csvParsed && !pdfParsed) return null;
  const pdfResult=pdfParsed&&pdfParsed.result;
  const csvResult=csvParsed&&csvParsed.result;
  const result=pdfResult ? JSON.parse(JSON.stringify(pdfResult)) : emptyArchitrendResult();
  result.sources=result.sources||{};
  result.inputSources={csv:!!csvParsed,pdf:!!pdfParsed};
  if(csvResult?.inputSources?.xlsx)result.inputSources.xlsx=true;
  result.notes=[...(result.notes||[])];
  const warnings=[];
  if(pdfResult){
    ['projectName','workName','projectLocation','ua','envArea','uRoof','uWall','uFloor','uFound','uWin','uDoor'].forEach(key=>{
      if(result[key]!==null) result.sources[key]=pdfResult.sources?.[key]||'PDF p.1';
    });
    if(result.rooms.length) result.sources.rooms=result.roomSourceLabel||('PDF p.'+
      ((result.validation.rooms&&result.validation.rooms.page)||9));
  }

  if(csvParsed){
    result.notes.push(...(csvResult.notes||[]));
    for(const key of ['uRoof','uWall','uFloor','uDoor'])if(!(result[key]>0)&&csvResult[key]>0){
      result[key]=csvResult[key];result.sources[key]=csvResult.sources[key];
    }
    if(csvResult.envArea!==null){result.envArea=csvResult.envArea;result.sources.envArea='CSV';}
    result.csvEnvelopeRows=csvResult.csvEnvelopeRows||[];
    result.csvBoundaryRows=csvResult.csvBoundaryRows||[];
    result.csvDiagnostics=JSON.parse(JSON.stringify(csvResult.csvDiagnostics));
    result.csvDiagnostics.requiredManual.filter(p=>p.code==='MULTIPLE_SPECS').forEach(p=>{result[p.dataKey]=null;delete result.sources[p.dataKey];});
    const pdfWindows=(pdfResult&&pdfResult.windows)||[];
    result.windows=csvResult.windows.map(csvWindow=>{
      const exact=pdfWindows.filter(w=>architrendWindowKey(w)===architrendWindowKey(csvWindow));
      const fallback=pdfWindows.filter(w=>csvText(w.id)===csvText(csvWindow.id)&&(!csvFloor(w.floor)||!csvFloor(csvWindow.floor)));
      const uniqueCsv=csvResult.windows.filter(w=>csvText(w.id)===csvText(csvWindow.id)).length===1;
      const pdfWindow=exact.length===1?exact[0]:exact.length===0&&uniqueCsv&&fallback.length===1?fallback[0]:null;
      const printedU=pdfWindow?.uSourceKind==='pdf-specification'&&pdfWindow.u>0&&csvWindow.area>0&&pdfWindow.area>0&&Math.abs(csvWindow.area-pdfWindow.area)<=Math.max(.02,csvWindow.area*.005)&&
        ['width','height'].every(key=>!(csvWindow[key]>0&&pdfWindow[key]>0)||Math.abs(csvWindow[key]-pdfWindow[key])<=Math.max(.01,csvWindow[key]*.005));
      const etaConflict=csvWindow.eta!=null&&pdfWindow?.eta!=null&&Math.abs(csvWindow.eta-pdfWindow.eta)>.001;
      if(etaConflict)warnings.push('CSVとPDFの日射熱取得率が一致しない窓があります。資料を確認してください');
      return Object.assign({},csvWindow,{
        u:pdfWindow?.uConflict?null:printedU?pdfWindow.u:csvWindow.u,
        uSource:printedU?pdfWindow.uSource:csvWindow.uSource,
        uSourceKind:printedU?'pdf-specification':'csv-estimate',
        uSourcePage:printedU?pdfWindow.uSourcePage:null,
        specificationIndex:printedU?pdfWindow.specificationIndex:null,
        uConflict:pdfWindow?.uConflict===true,
        etaConflict,
        eta:etaConflict?null:csvWindow.eta??pdfWindow?.eta??null,
        etaSource:csvWindow.etaSource||pdfWindow?.etaSource||null,
        tilt:csvWindow.tilt==null?90:csvWindow.tilt,
        sourceLabel:csvWindow.eta!==null?'CSV':pdfWindow&&pdfWindow.eta!==null?'CSV + PDF '+(pdfWindow.sourceDocumentOrdinal?pdfWindow.sourceDocumentOrdinal+' ':'')+'p.'+(pdfWindow.sourcePage||1):'CSV'
      });
    });
    result.validation=result.validation||{};
    if(result.validation.windowSpecifications){const assigned=result.windows.filter(w=>w.uSourceKind==='pdf-specification'&&w.u>0).length;result.validation.windowSpecifications={...result.validation.windowSpecifications,count:result.windows.length,assigned,unresolved:result.windows.length-assigned};}
    if(result.windows.some(w=>w.uConflict)){result.uWin=null;delete result.sources.uWin;warnings.push('PDFの窓仕様のU値に矛盾があります。該当する窓だけ確認してください。');}
    result.validation.windows=JSON.parse(JSON.stringify(csvResult.validation&&csvResult.validation.windows||{count:0,areaSum:0,gainSum:0,areaOk:false,gainOk:false,source:'CSV'}));
    if(pdfResult&&pdfResult.windows.length){
      const matched=new Set();
      const idsOk=result.windows.length===pdfResult.windows.length&&result.windows.every(w=>{
        const candidates=pdfResult.windows.map((p,i)=>({p,i})).filter(({p,i})=>!matched.has(i)&&csvText(p.id)===csvText(w.id)&&(!csvFloor(p.floor)||!csvFloor(w.floor)||csvFloor(p.floor)===csvFloor(w.floor)));
        if(candidates.length!==1||Math.abs((candidates[0].p.area||0)-(w.area||0))>=.03)return false;
        matched.add(candidates[0].i);return true;
      });
      const csvArea=result.windows.reduce((sum,w)=>sum+(w.area||0),0);
      const pdfArea=pdfResult.windows.reduce((sum,w)=>sum+(w.area||0),0);
      result.validation.windows.crossOk=idsOk && Math.abs(csvArea-pdfArea)<0.03;
      result.validation.windows.crossText='CSV/PDF 窓ID・面積';
      if(!result.validation.windows.crossOk) warnings.push('CSVとPDFの窓IDまたは窓面積が一致しません');
      else result.notes.push('CSVとPDFの窓'+result.windows.length+'枚・面積が一致しました');
    }
  }

  // A PDF may list several specifications even without a CSV. Keep each one
  // available for explicit face assignment rather than selecting specification 1.
  const pdfSpecs=result.envelopeSpecifications||[];
  for(const [part,key,target] of [['外壁','uWall','wall'],['屋根','uRoof','roof'],['床','uFloor','floor']]){
    const specs=pdfSpecs.filter(s=>s.part===part);
    if(specs.length<2)continue;
    result[key]=null;delete result.sources[key];
    result.csvDiagnostics=result.csvDiagnostics||{counts:{},rows:[],requiredManual:[],blocking:false};
    const required=result.csvDiagnostics.requiredManual;
    if(!required.some(p=>p.target===target))required.push({code:'MULTIPLE_SPECS',field:key==='uFloor'?'uFloor1':key,dataKey:key,target,groups:specs.map(s=>({id:'pdf-'+target+'-spec-'+s.index,u:s.u}))});
  }
  if(result.uCeiling>0)result.sources.uCeiling='PDF 天井の熱貫流率';
  if(csvParsed) warnings.push(...csvParsed.warnings);
  if(pdfParsed){
    pdfParsed.warnings.forEach(w=>{
      if(/真北|物件名とフッター|建設地/.test(w)||/^PDF [1-9]\d*:/.test(w)) warnings.push(w);
    });
  }
  if(!csvParsed) warnings.push('CSV未指定です。窓情報はPDF解析結果を使用します');
  if(!pdfParsed) warnings.push('PDF未指定です。外皮U値はCSVの貫流熱損失からの概算です。居室・窓ηはCSVの取得状況を確認してください。');
  if(result.ua===null) warnings.push('UAは空欄です');
  if([result.uRoof,result.uWall,result.uFloor,result.uFound,result.uWin].some(v=>v===null)){
    warnings.push('共通U値が空欄の部位は、複数仕様・資料の記載対象・未取得を各欄の案内で確認してください');
  }
  if(!result.habitableRooms.length) warnings.push('居室情報がないため、部屋は手動で作成してください');
  const etaMissing=result.windows.filter(w=>w.eta===null).length;
  if(etaMissing) warnings.push('窓ηが未取得の窓が'+etaMissing+'枚あります');
  return {result,warnings:[...new Set(warnings)]};
}

function groupPdfItemsIntoLines(items){
  const lines = [];
  (items||[]).filter(it=>String(it.text||'').trim()).forEach(item=>{
    let line = lines.find(row=>Math.abs(row.y-item.y)<=2.5);
    if(!line){
      line = {y:item.y, items:[]};
      lines.push(line);
    }
    line.items.push(item);
  });
  lines.forEach(line=>{
    line.items.sort((a,b)=>a.x-b.x);
    line.text = line.items.map(it=>it.text).join(' ');
    line.compact = normalizePdfText(line.text);
  });
  return lines;
}

function pdfNumNear(line, targetRatio, pageWidth, toleranceRatio){
  if(!line || !pageWidth) return null;
  const tol = pageWidth*(toleranceRatio||0.018);
  let best=null, bestD=Infinity;
  line.items.forEach(it=>{
    const v = parseFloat(String(it.text).replace(/,/g,''));
    if(!isFinite(v)) return;
    const d = Math.abs(it.x-pageWidth*targetRatio);
    if(d<tol && d<bestD){ best=v; bestD=d; }
  });
  return best;
}

function nearestPdfLine(lines, targetLine, predicate, maxDistance){
  let best=null, bestD=Infinity;
  lines.forEach(line=>{
    if(!predicate(line)) return;
    const d=Math.abs(line.y-targetLine.y);
    if(d<bestD && d<maxDistance){ best=line; bestD=d; }
  });
  return best;
}

function isHabitableRoomName(name){
  const n=String(name||'').replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));
  return /^(LDK|L・D・K|居間|リビング|ダイニング|キッチン|洋室\d*|和室\d*|寝室|主寝室|子供|子ども|書斎)/i.test(n);
}
function isArchitrendLivingRoom(r){
  if(!r) return false;
  if(r.type==='A' || r.type==='B' || r.pdfType==='A' || r.pdfType==='B') return true;
  return isHabitableRoomName(r.name);
}

// Reconstruct only adjacent, public table vocabulary. Never join arbitrary
// text or numbers merely because PDF.js returned separate text items.
function architrendPdfTableItems(page){
  const items=(page.items||page.lines?.flatMap(line=>line.items)||[]).filter(i=>csvText(i.text)).map(i=>({...i,text:csvText(i.text)}));
  const labels=new Set(['仕様','面積','熱貫流率','温度差係数','貫流熱損失','熱貫流損失','階','幅','高','高さ','η','η0','ν','fC','日射熱取得量','室名','名称','区分','分類','計算式','算式','算定式','小計','面積合計','建具寸法区分']);
  const known=text=>{
    const compact=normalizePdfText(csvText(text)),head=compact.replace(/\[(?:m[²2]?|mm|cm|㎡|W\/K|W\/(?:m[²2]|㎡)K|-)\]$/i,'');
    if(labels.has(head))return {text:head,room:false};
    if(/^G(?:南東|南西|北東|北西|南|北|東|西)-[1-9]\d{0,3}$/.test(compact))return {text:compact,room:false};
    if(/^(?:屋根|天井|外壁|床|ドア|基礎|窓)\([0-9]{1,3}\)$/.test(compact))return {text:compact,room:false};
    if(typeof normalizeArchitrendPlanRoomName==='function'&&/^[\p{L}ー・./()\s]+(?:[0-9]{1,2})?$/u.test(compact)){
      const room=normalizeArchitrendPlanRoomName(compact);if(room)return {text:room,room:true};
    }
    return null;
  };
  const candidates=[];
  const nextTo=(a,b)=>{const font=Math.max(a.height||8,b.height||8,4),gap=b.x-a.x-(a.width||0);return Math.abs(a.y-b.y)<=Math.max(2,font*.35)&&gap>=-1&&gap<=Math.max(3,font*.7);};
  items.forEach((start,first)=>{
    const sequence=[first];let current=start;
    for(let n=0;n<8;n++){
      const next=items.map((item,i)=>({item,i})).filter(v=>!sequence.includes(v.i)&&nextTo(current,v.item)).sort((a,b)=>a.item.x-b.item.x)[0];
      if(!next)break;sequence.push(next.i);current=next.item;
      const value=known(sequence.map(i=>items[i].text).join(''));
      if(value){
        const suffix=items.find((item,i)=>!sequence.includes(i)&&nextTo(current,item)&&/[\p{L}]/u.test(item.text));
        // A generic room prefix must not rescue an equipment/unknown suffix.
        if(value.room&&suffix&&!known(sequence.map(i=>items[i].text).join('')+suffix.text))continue;
        candidates.push({ids:sequence.slice(),text:value.text});
      }
    }
  });
  const used=new Set(),out=[];
  candidates.sort((a,b)=>b.ids.length-a.ids.length).forEach(candidate=>{
    if(candidate.ids.some(i=>used.has(i)))return;const parts=candidate.ids.map(i=>items[i]),x=Math.min(...parts.map(i=>i.x)),right=Math.max(...parts.map(i=>i.x+(i.width||0)));
    candidate.ids.forEach(i=>used.add(i));out.push({...parts[0],text:candidate.text,x,width:right-x,height:Math.max(...parts.map(i=>i.height||0))});
  });
  items.forEach((item,i)=>{if(!used.has(i)){const value=known(item.text);out.push(value&&!value.room?{...item,text:value.text}:item);}});
  return out;
}
function architrendPdfCellNumber(item,items){
  const value=csvNumber(item.text);if(value===null)return null;
  const fragmented=items.some(other=>{
    if(other===item||!/^[-+0-9.,]+$/.test(csvText(other.text)))return false;
    const font=Math.max(item.height||8,other.height||8,4),gap=Math.max(0,other.x-item.x-(item.width||0),item.x-other.x-(other.width||0));
    return Math.abs(other.y-item.y)<=Math.max(2,font*.5)&&gap<=Math.max(2,font*.35);
  });
  return fragmented?null:value;
}
// Discover columns from their headings instead of assuming page-relative X positions.
function parseHeaderWindows(layoutPages){
  for(const page of layoutPages||[]){
    const originalLines=page.lines||groupPdfItemsIntoLines(page.items||[]);
    if(!originalLines.some(line=>normalizePdfText(csvText(line.text||line.compact)).includes('開口部[窓](冷房期)')))continue;
    const allItems=architrendPdfTableItems(page),allLines=groupPdfItemsIntoLines(allItems);
    const title=allLines.find(l=>normalizePdfText(csvText(l.text||l.compact)).includes('開口部[窓](冷房期)'));
    if(!title)continue;
    const ambiguousSection=()=>({windows:[],expectedArea:null,expectedGain:null,page:page.number,method:'headers',blocked:true,diagnostics:[{code:'PDF_WINDOW_SECTION_AMBIGUOUS',count:1}]});
    if(allLines.some(line=>Math.abs(line.y-title.y)<=2.5&&normalizePdfText(csvText(line.text||line.compact)).includes('開口部[窓](暖房期)')))return ambiguousSection();
    // Cooling and heating tables may repeat every ID on the same page. A
    // following section heading terminates this table, including merged cells.
    const sectionHeading=line=>/開口部\[(?:窓|ドア)\]|居室区画面積表|(?:標準)?外皮性能計算表/.test(normalizePdfText(csvText(line.text||line.compact)));
    const following=allLines.filter(line=>line.y<title.y-2.5&&sectionHeading(line)).sort((a,b)=>b.y-a.y)[0];
    const sectionBottom=following?following.y:-Infinity;
    const items=allItems.filter(item=>item.y<=title.y+2.5&&item.y>sectionBottom+2.5),lines=groupPdfItemsIntoLines(items);
    const ids=[];
    for(const line of lines){
      if(line.y>=title.y)continue;
      for(let i=0;i<line.items.length;i++){
        let text='';
        for(let j=i;j<Math.min(i+5,line.items.length);j++){
          text+=csvText(line.items[j].text).replace(/\s/g,'');
          const m=/^G(南東|南西|北東|北西|南|北|東|西)-(\d+)$/.exec(text);
          if(m){ids.push({id:text,orient:m[1],x:line.items[i].x,y:line.y,height:Math.max(...line.items.slice(i,j+1).map(item=>Math.abs(item.height||8)))});i=j;break;}
        }
      }
    }
    if(!ids.length){if(following)return ambiguousSection();continue;}
    ids.sort((a,b)=>b.y-a.y);
    const ys=[...new Set(ids.map(i=>i.y))].sort((a,b)=>b-a),gaps=ys.slice(1).map((y,i)=>ys[i]-y).filter(d=>d>2).sort((a,b)=>a-b);
    const pitch=gaps.length?gaps[Math.floor(gaps.length/2)]:12;
    const headers=items.filter(i=>i.y>ys[0]+2.5&&i.y<title.y+2.5);
    const aliases={floor:['階'],width:['幅'],height:['高','高さ'],area:['面積'],eta:['η','η0'],nu:['ν'],fc:['fC'],gain:['日射熱取得量']};
    const cols={};
    // Width, height and area form one local ordered block. Another table's
    // left-hand 面積 heading must not replace the opening-area column.
    for(const key of ['width','height','area','floor','eta','nu','fc','gain']){
      let candidates=headers.filter(i=>aliases[key].includes(normalizePdfText(i.text)));
      if(key==='height'&&cols.width)candidates=candidates.filter(i=>i.x+(i.width||0)/2>cols.width.x);
      if(key==='area'&&cols.height)candidates=candidates.filter(i=>i.x+(i.width||0)/2>cols.height.x);
      if(['eta','fc','gain'].includes(key)&&cols.area)candidates=candidates.filter(i=>i.x+(i.width||0)/2>cols.area.x);
      if(key==='floor')candidates=candidates.filter(i=>i.x<Math.min(...ids.map(id=>id.x)));
      if(key==='nu'&&cols.width)candidates=candidates.filter(i=>i.x<cols.width.x&&i.x>Math.min(...ids.map(id=>id.x)));
      candidates.sort((a,b)=>['height','area','eta','fc','gain'].includes(key)?a.x-b.x:key==='floor'?b.x-a.x:a.y-b.y||a.x-b.x);
      if(candidates.length)cols[key]={x:candidates[0].x+(candidates[0].width||0)/2,headerLeft:candidates[0].x,headerRight:candidates[0].x+(candidates[0].width||0)};
    }
    if(!cols.width||!cols.height||!cols.area)continue;
    const ordered=Object.entries(cols).sort((a,b)=>a[1].x-b[1].x);
    ordered.forEach(([key,col],i)=>{col.left=i?(ordered[i-1][1].x+col.x)/2:col.x-Math.abs(col.x-cols.width.x)/2;col.right=i+1<ordered.length?(ordered[i+1][1].x+col.x)/2:col.x+pitch*2;});
    // The identifier column sits between floor and width.
    if(cols.floor)cols.floor.right=(cols.floor.x+Math.min(...ids.map(i=>i.x)))/2;
    const inColumn=(item,col)=>col&&item.x+(item.width||0)/2>=col.left&&item.x+(item.width||0)/2<col.right;
    const numeric=i=>architrendPdfCellNumber(i,items);
    const read=(row,key)=>{
      const candidates=items.filter(i=>Math.abs(i.y-row.y)<=2.5&&inColumn(i,cols[key])&&numeric(i)!==null);
      return candidates.length===1?numeric(candidates[0]):null;
    };
    function bands(key,valid){
      if(!cols[key])return [];
      const cells=items.filter(i=>i.y<=ys[0]+pitch/2&&i.y>=ys.at(-1)-pitch/2&&inColumn(i,cols[key])&&valid(numeric(i))).sort((a,b)=>b.y-a.y);
      let top=ys[0]+pitch/2;const result=[];
      for(const cell of cells){const bottom=2*cell.y-top;if(bottom>=top-1)return [];result.push({top,bottom,value:numeric(cell)});top=bottom;}
      // Unread merged cells must not shift every following row into another group.
      if(!result.length||Math.abs(top-(ys.at(-1)-pitch/2))>pitch*.7)return [];
      return result;
    }
    const floors=bands('floor',v=>Number.isInteger(v)&&v>0),etas=bands('eta',v=>v!==null&&v>=0&&v<=1);
    const bandValue=(row,b)=>{const found=b.filter(v=>row.y<v.top+1&&row.y>v.bottom-1);return found.length===1?found[0].value:null;};
    const diagnostics=[],hasRulings=Object.hasOwn(page,'rulingLines'),ruled={floor:new Map(),eta:new Map()};
    if(hasRulings){
      const epsilon=.2,horizontal=[],vertical=[];
      const validRules=Array.isArray(page.rulingLines)&&page.rulingLines.length<=50000&&page.rulingLineStatus?.complete===true&&page.rulingLines.every(line=>line&&['x1','y1','x2','y2'].every(k=>Number.isFinite(line[k])));
      if(!validRules)diagnostics.push({code:'PDF_WINDOW_RULES_INCOMPLETE',count:ids.length});
      else{
        page.rulingLines.forEach(line=>{
          if(Math.abs(line.y1-line.y2)<=epsilon&&Math.abs(line.x1-line.x2)>1)horizontal.push({at:(line.y1+line.y2)/2,lo:Math.min(line.x1,line.x2),hi:Math.max(line.x1,line.x2)});
          else if(Math.abs(line.x1-line.x2)<=epsilon&&Math.abs(line.y1-line.y2)>1)vertical.push({at:(line.x1+line.x2)/2,lo:Math.min(line.y1,line.y2),hi:Math.max(line.y1,line.y2)});
        });
        const segmentIndex=segments=>{
          const groups=new Map();let at;
          segments.slice().sort((a,b)=>a.at-b.at).forEach(segment=>{if(at===undefined||segment.at-at>epsilon){at=segment.at;groups.set(at,[]);}groups.get(at).push({lo:segment.lo,hi:segment.hi});});
          for(const [coordinate,spans]of groups){const merged=[];spans.sort((a,b)=>a.lo-b.lo).forEach(span=>{const prior=merged.at(-1);if(prior&&span.lo<=prior.hi+epsilon)prior.hi=Math.max(prior.hi,span.hi);else merged.push({...span});});groups.set(coordinate,merged);}return groups;
        };
        const hIndex=segmentIndex(horizontal),vIndex=segmentIndex(vertical);
        const covers=(index,at,lo,hi)=>(index.get(at)||[]).some(span=>span.lo<=lo+epsilon&&span.hi>=hi-epsilon);
        // Duplicate text layers are one item. Adjacent numeric fragments remain
        // separate and invalid; never manufacture a decimal from raw pieces.
        const seenItems=new Set(),uniqueItems=items.filter(item=>{const key=JSON.stringify([item.text,item.x,item.y,item.width||0,item.height||0]);if(seenItems.has(key))return false;seenItems.add(key);return true;});
        // PDF.js height is the font height, not the painted glyph box. The
        // text origin is its baseline; only that strict interior Y anchors a
        // table row/value. Keep the complete numeric advance width in its cell.
        const baselineInside=(item,cell)=>item.x>=cell.left-epsilon&&item.x+(item.width||0)<=cell.right+epsilon&&item.y>cell.bottom+epsilon&&item.y<cell.top-epsilon;
        for(const key of ['floor','eta']){
          const col=cols[key];if(!col){diagnostics.push({code:'PDF_WINDOW_COLUMN_MISSING',column:key,count:ids.length});continue;}
          if(key==='floor'){const count=uniqueItems.filter(item=>/^[1-9][0-9]?(?:階|F)$/i.test(normalizePdfText(item.text))&&inColumn(item,col)).length;if(count)diagnostics.push({code:'PDF_WINDOW_FLOOR_TEXT_UNIT',column:key,count});}
          const slot=ordered.findIndex(([name])=>name===key),leftLimit=slot?ordered[slot-1][1].x:-Infinity,rightLimit=key==='floor'?Math.min(...ids.map(row=>row.x)):(slot+1<ordered.length?ordered[slot+1][1].x:Infinity);
          const topRow=ys[0]+Math.max(...ids.map(row=>row.height)),xs=[...vIndex.keys()].filter(x=>vIndex.get(x).some(span=>span.hi>=ys.at(-1)&&span.lo<=topRow));
          const lefts=xs.filter(x=>x>leftLimit+epsilon&&x<=col.headerLeft+epsilon),rights=xs.filter(x=>x>=col.headerRight-epsilon&&x<rightLimit-epsilon);
          if(lefts.length*rights.length>128){diagnostics.push({code:'PDF_WINDOW_CELL_LIMIT',column:key,count:ids.length});continue;}
          const cells=[];let work=0,limited=false;
          columnCells:for(const left of lefts)for(const right of rights){
            if(right-left<=epsilon)continue;
            const bounds=[...hIndex.keys()].filter(y=>y>=sectionBottom-epsilon&&y<=title.y+epsilon&&covers(hIndex,y,left,right)),internal=xs.filter(x=>x>left+epsilon&&x<right-epsilon);
            work+=bounds.length*(internal.length+uniqueItems.length+ids.length+1);
            if(work>1000000){limited=true;break columnCells;}
            for(let index=0;index+1<bounds.length;index++){
              const bottom=bounds[index],top=bounds[index+1];
              if(!covers(vIndex,left,bottom,top)||!covers(vIndex,right,bottom,top))continue;
              // A real internal divider cannot be swallowed by a larger box.
              if(internal.some(x=>covers(vIndex,x,bottom,top)))continue;
              const cell={left,right,bottom,top};
              const values=uniqueItems.filter(item=>/^[-+0-9.,]+$/.test(csvText(item.text))&&baselineInside(item,cell));
              const value=values.length===1?architrendPdfCellNumber(values[0],uniqueItems):null;
              const valid=key==='floor'?Number.isInteger(value)&&value>0&&value<100:value!==null&&value>=0&&value<=1;
              cells.push({...cell,value:valid?value:null,numericCount:values.length});
            }
          }
          if(limited){diagnostics.push({code:'PDF_WINDOW_CELL_LIMIT',column:key,count:ids.length});continue;}
          if(!cells.length)diagnostics.push({code:'PDF_WINDOW_CLOSED_CELLS_EMPTY',column:key,count:ids.length});
          let ambiguous=0;const classifications=new Map(),note=code=>classifications.set(code,(classifications.get(code)||0)+1);
          ids.forEach((row,index)=>{
            const matches=cells.filter(cell=>row.y>cell.bottom+epsilon&&row.y<cell.top-epsilon);
            if(matches.length===1&&matches[0].value!==null)ruled[key].set(index,matches[0].value);
            else{
              if(matches.length>1)ambiguous++;
              if(matches.length===0)note(cells.some(cell=>Math.abs(row.y-cell.bottom)<=epsilon||Math.abs(row.y-cell.top)<=epsilon)?'PDF_WINDOW_ROW_ON_BOUNDARY':'PDF_WINDOW_ROW_NO_CLOSED_CELL');
              const cell=matches.length===1?matches[0]:null;
              if(cell&&cell.value===null){
                if(cell.numericCount===0)note('PDF_WINDOW_NUMERIC_MISSING');
                else if(cell.numericCount>1)note('PDF_WINDOW_NUMERIC_CONFLICT');
                else note('PDF_WINDOW_NUMERIC_FRAGMENTED_OR_INVALID');
              }
            }
          });
          for(const [code,count]of classifications)diagnostics.push({code,column:key,count});
          if(ambiguous)diagnostics.push({code:'PDF_WINDOW_CELL_AMBIGUOUS',column:key,count:ambiguous});
          const unresolved=ids.length-ruled[key].size;if(unresolved)diagnostics.push({code:'PDF_WINDOW_CELL_UNRESOLVED',column:key,count:unresolved});
        }
      }
    }
    const windows=ids.map((row,index)=>{
      const floor=hasRulings?(ruled.floor.get(index)??null):bandValue(row,floors),eta=hasRulings?(ruled.eta.get(index)??null):bandValue(row,etas);
      return {id:row.id,orient:row.orient,floor:floor===null?'':String(floor),width:read(row,'width'),height:read(row,'height'),area:read(row,'area'),gain:read(row,'gain'),az:AT_AZ[row.orient],eta,tilt:90,roofLike:false,sourcePage:page.number,etaSource:eta!==null?'PDF p.'+page.number+' 窓日射熱取得率（η列）':null};
    });
    if(!windows.every(w=>w.width>0&&w.height>0&&w.area>0&&Math.abs(w.width*w.height-w.area)<=Math.max(.02,w.area*.005)))continue;
    const total=lines.find(l=>l.compact.includes('窓面積小計')&&l.compact.includes('窓日射熱取得量小計'));
    return {windows,expectedArea:total?read(total,'area'):null,expectedGain:total?read(total,'gain'):null,page:page.number,method:'headers',diagnostics};
  }
  return null;
}
// Read a merged specification cell only when its complete rectangle is present.
// These are area-reference tables, separate from the cooling/heating tables.
function architrendWindowSpecificationCells(page,items,column,scope){
  if(!Object.hasOwn(page,'rulingLines'))return null;
  if(!Array.isArray(page.rulingLines)||page.rulingLines.length>50000||page.rulingLineStatus?.complete!==true||page.rulingLines.some(l=>!l||!['x1','y1','x2','y2'].every(k=>Number.isFinite(l[k]))))return [];
  const epsilon=.25,horizontal=[],vertical=[];
  for(const l of page.rulingLines){
    if(Math.abs(l.y1-l.y2)<=epsilon&&Math.abs(l.x1-l.x2)>1)horizontal.push({at:(l.y1+l.y2)/2,lo:Math.min(l.x1,l.x2),hi:Math.max(l.x1,l.x2)});
    else if(Math.abs(l.x1-l.x2)<=epsilon&&Math.abs(l.y1-l.y2)>1)vertical.push({at:(l.x1+l.x2)/2,lo:Math.min(l.y1,l.y2),hi:Math.max(l.y1,l.y2)});
  }
  const index=segments=>{
    const map=new Map();let coordinate;
    for(const s of segments.sort((a,b)=>a.at-b.at)){if(coordinate===undefined||s.at-coordinate>epsilon){coordinate=s.at;map.set(coordinate,[]);}map.get(coordinate).push({lo:s.lo,hi:s.hi});}
    for(const [at,spans]of map){const merged=[];for(const s of spans.sort((a,b)=>a.lo-b.lo)){const p=merged.at(-1);if(p&&s.lo<=p.hi+epsilon)p.hi=Math.max(p.hi,s.hi);else merged.push({...s});}map.set(at,merged);}return map;
  };
  const hs=index(horizontal),vs=index(vertical),covers=(map,at,lo,hi)=>(map.get(at)||[]).some(s=>s.lo<=lo+epsilon&&s.hi>=hi-epsilon);
  const xs=[...vs.keys()].filter(x=>vs.get(x).some(s=>s.hi>=scope.bottom&&s.lo<=scope.top));
  const lefts=xs.filter(x=>x>column.leftLimit+epsilon&&x<=column.x+epsilon),rights=xs.filter(x=>x>=column.x+(column.width||0)-epsilon&&x<column.rightLimit-epsilon);
  if(lefts.length*rights.length>128)return [];
  const seen=new Set(),unique=items.filter(i=>{const key=JSON.stringify([csvText(i.text),i.x,i.y,i.width||0]);if(seen.has(key))return false;seen.add(key);return true;}),cells=[];
  let work=0;
  for(const left of lefts)for(const right of rights){
    if(right<=left)continue;
    const bounds=[...hs.keys()].filter(y=>y>=scope.bottom-epsilon&&y<=scope.top+epsilon&&covers(hs,y,left,right)).sort((a,b)=>a-b),internal=xs.filter(x=>x>left+epsilon&&x<right-epsilon);
    work+=bounds.length*(unique.length+internal.length+1);if(work>1000000)return [];
    for(let i=0;i+1<bounds.length;i++){
      const bottom=bounds[i],top=bounds[i+1];
      if(!covers(vs,left,bottom,top)||!covers(vs,right,bottom,top)||internal.some(x=>covers(vs,x,bottom,top)))continue;
      const values=unique.filter(item=>item.y>bottom+epsilon&&item.y<top-epsilon&&item.x+(item.width||0)/2>=left&&item.x+(item.width||0)/2<=right);
      const matches=values.map(item=>/^窓\(([1-9]\d{0,2})\)$/.exec(normalizePdfText(item.text)));
      const valid=values.length===1&&matches[0]&&values[0].x>=left-epsilon&&values[0].x+(values[0].width||0)<=right+epsilon;
      cells.push({bottom,top,index:valid?Number(matches[0][1]):null});
    }
  }
  return cells;
}
function parseWindowSpecificationReferences(layoutPages){
  const references=[],diagnostics=[],pages=new Set();let tables=0;
  for(const page of layoutPages||[]){
    const items=architrendPdfTableItems(page),heads=items.filter(i=>normalizePdfText(i.text)==='階');
    for(const head of heads){
      const font=Math.max(4,head.height||8),row=items.filter(i=>Math.abs(i.y-head.y)<=Math.max(2.5,font*.7));
      const area=row.filter(i=>normalizePdfText(i.text)==='面積'&&i.x>head.x).sort((a,b)=>a.x-b.x)[0];
      const specification=area&&row.filter(i=>normalizePdfText(i.text)==='仕様'&&i.x>area.x).sort((a,b)=>a.x-b.x)[0];
      if(!area||!specification||area.x-head.x>page.width*.4||!row.some(i=>['計算式','算式','算定式','小計','建具寸法区分'].includes(normalizePdfText(i.text))))continue;
      const nextHead=heads.filter(i=>i.x>specification.x&&Math.abs(i.y-head.y)<font*4).sort((a,b)=>a.x-b.x)[0],right=nextHead?nextHead.x-font:Math.min(page.width,specification.x+Math.max(100,page.width*.09));
      const ids=items.filter(i=>/^G(?:南東|南西|北東|北西|南|北|東|西)-[1-9]\d{0,3}$/.test(normalizePdfText(i.text))&&i.x>head.x+font*.5&&i.x<area.x-font&&i.y<head.y-font*.5);
      if(!ids.length)continue;tables++;pages.add(page.number);
      const scope={top:head.y+font*2,bottom:Math.max(0,Math.min(...ids.map(i=>i.y))-font*2)};
      const local=items.filter(i=>i.x>=head.x-font&&i.x+(i.width||0)<=right&&i.y>=scope.bottom&&i.y<=scope.top);
      const before=row.filter(i=>i.x<specification.x&&i.x>=area.x).sort((a,b)=>b.x-a.x)[0],after=row.filter(i=>i.x>specification.x).sort((a,b)=>a.x-b.x)[0];
      const cells=architrendWindowSpecificationCells(page,local,{...specification,leftLimit:before?before.x+(before.width||0)/2:area.x,rightLimit:after?after.x:right},scope);
      const formulaHead=row.filter(i=>['計算式','算式','算定式'].includes(normalizePdfText(i.text))&&i.x<area.x).sort((a,b)=>b.x-a.x)[0],sumHead=row.filter(i=>normalizePdfText(i.text)==='小計'&&i.x>area.x).sort((a,b)=>a.x-b.x)[0];
      const areaCenter=area.x+(area.width||0)/2,areaLeft=formulaHead?(formulaHead.x+(formulaHead.width||0)/2+areaCenter)/2:area.x-font,areaRight=sumHead?(sumHead.x+(sumHead.width||0)/2+areaCenter)/2:specification.x;
      for(const id of ids){
        const same=local.filter(i=>Math.abs(i.y-id.y)<=2.5),levels=same.filter(i=>i.x>=head.x-font&&i.x<id.x-font*.5&&/^(?:[1-9]\d?|R)(?:F|階)?$/.test(normalizePdfText(i.text)));
        const floor=levels.length===1?csvFloor(normalizePdfText(levels[0].text)):'';
        const values=same.filter(i=>{const x=i.x+(i.width||0)/2;return x>=areaLeft&&x<areaRight&&architrendPdfCellNumber(i,local)!==null;});
        const value=values.length===1?architrendPdfCellNumber(values[0],local):null;
        const expressions=same.filter(i=>i.x>id.x+(id.width||0)&&i.x<areaLeft).map(i=>/^(\d+(?:\.\d+)?)[×xX*](\d+(?:\.\d+)?)$/.exec(normalizePdfText(i.text))).filter(Boolean);
        const dimensions=expressions.length===1?[Number(expressions[0][1]),Number(expressions[0][2])]:null;
        let specIndex=null;
        if(cells!==null){const matched=cells.filter(cell=>id.y>cell.bottom+.25&&id.y<cell.top-.25);if(matched.length===1)specIndex=matched[0].index;}
        else{
          const explicit=same.filter(i=>i.x>(before?before.x+(before.width||0)/2:areaRight)&&i.x+(i.width||0)<=(after?after.x:right));
          const matches=explicit.map(i=>/^窓\(([1-9]\d{0,2})\)$/.exec(normalizePdfText(i.text))).filter(Boolean);
          if(explicit.length===1&&matches.length===1)specIndex=Number(matches[0][1]);
        }
        const areaValid=value>0&&(!dimensions||dimensions.every(v=>Number.isFinite(v)&&v>0)&&Math.abs(dimensions[0]*dimensions[1]-value)<=Math.max(.02,value*.005));
        const reference={id:normalizePdfText(id.text),floor,area:areaValid?value:null,dimensions,specificationIndex:specIndex,sourcePage:page.number};
        const prior=references.find(r=>r.id===reference.id&&r.floor===reference.floor);
        if(prior){if(JSON.stringify([prior.area,prior.dimensions,prior.specificationIndex])!==JSON.stringify([reference.area,reference.dimensions,reference.specificationIndex])){prior.conflict=true;prior.specificationIndex=null;}}
        else references.push(reference);
      }
    }
  }
  const unresolved=references.filter(r=>!r.floor||!(r.area>0)||!r.specificationIndex||r.conflict).length;
  if(unresolved)diagnostics.push({code:'PDF_WINDOW_SPEC_REFERENCE_UNRESOLVED',count:unresolved});
  return {windows:references,tables,pages:[...pages],diagnostics};
}
function applyPdfWindowSpecifications(result,layoutPages,warnings=[]){
  const reference=parseWindowSpecificationReferences(layoutPages);if(!reference.tables)return reference;
  const specs=result.envelopeSpecifications||[],codes=new Set(reference.diagnostics.map(d=>d.code));let assigned=0;
  for(const w of result.windows||[]){
    if(w.ambiguous||(result.windows||[]).filter(other=>csvText(other.id)===csvText(w.id)&&csvFloor(other.floor)===csvFloor(w.floor)).length!==1){codes.add('PDF_WINDOW_SPEC_IDENTITY_HELD');continue;}
    const sameId=reference.windows.filter(r=>r.id===csvText(w.id)),matches=sameId.filter(r=>csvFloor(r.floor)&&csvFloor(r.floor)===csvFloor(w.floor));
    if(!csvFloor(w.floor)&&sameId.length===1&&(result.windows||[]).filter(other=>csvText(other.id)===csvText(w.id)).length===1){matches.push(sameId[0]);}
    if(matches.length!==1)continue;const r=matches[0];
    if(r.conflict||!r.floor||!r.specificationIndex||!(w.area>0&&r.area>0)||Math.abs(w.area-r.area)>Math.max(.02,w.area*.005)){codes.add('PDF_WINDOW_SPEC_IDENTITY_HELD');continue;}
    if(r.dimensions&&w.width>0&&w.height>0){
      const close=(a,b)=>Math.abs(a-b)<=Math.max(.01,Math.abs(b)*.005),[a,b]=r.dimensions;
      if(!(close(a,w.width)&&close(b,w.height)||close(a,w.height)&&close(b,w.width))){codes.add('PDF_WINDOW_SPEC_DIMENSIONS_HELD');continue;}
    }
    const candidates=specs.filter(s=>s.part==='窓'&&s.index===r.specificationIndex),values=[...new Set(candidates.filter(s=>Number.isFinite(s.u)&&s.u>0&&s.u<=20).map(s=>s.u))];
    if(values.length!==1||candidates.some(s=>!Number.isFinite(s.u)||!(s.u>0&&s.u<=20))){codes.add('PDF_WINDOW_SPEC_U_UNRESOLVED');continue;}
    const u=values[0];
    if(w.uConflict||w.u>0&&Math.abs(w.u-u)>Math.max(.001,u*.005)){w.u=null;w.uConflict=true;codes.add('PDF_WINDOW_SPEC_U_CONFLICT');continue;}
    w.floor=csvFloor(w.floor)||r.floor;w.u=u;w.specificationIndex=r.specificationIndex;w.uSourceKind='pdf-specification';
    w.uSource='PDF p.'+r.sourcePage+' 窓ID・仕様番号 → p.'+(candidates[0].sourcePage||1)+' 窓('+r.specificationIndex+')のU値';
    w.uSourcePage=r.sourcePage;assigned++;
  }
  result.validation=result.validation||{};
  result.validation.windowSpecifications={count:(result.windows||[]).length,referenceCount:reference.windows.length,assigned,unresolved:(result.windows||[]).length-assigned,pages:reference.pages,codes:[...codes]};
  if(assigned){result.notes=result.notes||[];result.notes.push('窓'+assigned+'枚のU値を、PDF p.'+reference.pages.join('・')+'の窓ID・仕様番号と性能表を照合して取得しました。');}
  if(assigned&&(result.windows||[]).every(w=>w.u>0&&!w.uConflict))for(let i=warnings.length-1;i>=0;i--){if(/窓Uが複数あり一意でない/.test(warnings[i]))warnings.splice(i,1);}
  if((result.windows||[]).some(w=>w.uConflict))result.uWin=null;
  if(assigned<(result.windows||[]).length)warnings.push('窓ごとの仕様番号・面積・U値を一意に照合できない窓があります。取得できた窓の設定を保持し、空欄の窓だけ確認してください。');
  return reference;
}
function parsePositionedWindows(layoutPages){
  const headerResult=parseHeaderWindows(layoutPages);if(headerResult)return headerResult;
  const page=(layoutPages||[]).find(p=>p.lines.some(line=>line.compact.includes('開口部[窓](冷房期)')));
  if(!page) return null;
  const width=page.width;
  const windowIdPattern=/^G(南東|南西|北東|北西|南|北|東|西)-(\d+)$/;
  const windowIdFromLine=line=>line.items
    .filter(it=>it.x>width*0.105 && it.x<width*0.143)
    .map(it=>String(it.text).trim()).join('').replace(/\s+/g,'');
  const windowLines=page.lines.filter(line=>windowIdPattern.test(windowIdFromLine(line)));
  if(!windowLines.length) return null;

  const windows=[];
  windowLines.forEach(line=>{
    const idMatch=windowIdFromLine(line).match(windowIdPattern);
    if(!idMatch) return;
    const id='G'+idMatch[1]+'-'+idMatch[2];
    const orient=idMatch[1];
    const floorItem=line.items.find(it=>it.x>width*0.09 && it.x<width*0.105 && /^(R|1|2)$/.test(String(it.text).trim()));
    const floor=floorItem?String(floorItem.text).trim():'';
    windows.push({
      id, orient, floor,
      width:pdfNumNear(line,0.178,width,0.014),
      height:pdfNumNear(line,0.207,width,0.014),
      area:pdfNumNear(line,0.236,width,0.014),
      gain:pdfNumNear(line,0.532,width,0.018),
      az:(orient in AT_AZ)?AT_AZ[orient]:null,
      eta:null,
      tilt:90,
      roofLike:false,
      sourcePage:page.number,
      _line:line
    });
  });

  const orientations=[...new Set(windows.map(w=>w.orient))];
  const nuMap={}, etaCandidates=[];
  page.lines.forEach(line=>{
    const nu=pdfNumNear(line,0.146,width,0.012);
    if(nu!==null && nu>0.2 && nu<1.1){
      const near=nearestPdfLine(windowLines,line,()=>true,width*0.045);
      if(near){
        const w=windows.find(win=>win._line===near);
        if(w) nuMap[w.orient]=nu;
      }
    }
    const eta=pdfNumNear(line,0.471,width,0.016);
    if(eta!==null && eta>0.1 && eta<0.9 && !etaCandidates.includes(eta)) etaCandidates.push(eta);
  });

  let fC=null;
  const noneLine=page.lines.find(line=>line.items.some(it=>String(it.text).trim()==='なし'));
  if(noneLine) fC=pdfNumNear(noneLine,0.500,width,0.025);

  windows.forEach(w=>{
    const nu=nuMap[w.orient];
    if(!(nu>0) || !(w.area>0) || !(w.gain>=0) || !(fC>0)) return;
    const raw=w.gain/(nu*w.area*fC);
    if(!etaCandidates.length) return;
    let best=etaCandidates[0], bestD=Math.abs(raw-best);
    etaCandidates.forEach(candidate=>{
      const d=Math.abs(raw-candidate);
      if(d<bestD){ best=candidate; bestD=d; }
    });
    if(bestD<=0.06) w.eta=best;
  });

  const totalLine=page.lines.find(line=>line.compact.includes('窓面積小計') && line.compact.includes('窓日射熱取得量小計'));
  const expectedArea=totalLine?pdfNumNear(totalLine,0.232,width,0.025):null;
  const expectedGain=totalLine?pdfNumNear(totalLine,0.532,width,0.025):null;
  windows.forEach(w=>delete w._line);
  return {windows, expectedArea, expectedGain, page:page.number};
}

function parsePositionedRooms(layoutPages){
  const sourcePage=(layoutPages||[]).find(p=>p.lines.some(line=>line.compact.includes('居室区画面積表')));
  if(!sourcePage) return null;
  const prepared=architrendPdfTableItems(sourcePage),page={...sourcePage,items:prepared,lines:groupPdfItemsIntoLines(prepared)};
  const width=page.width;
  const roomNamePattern=/^(ＬＤＫ|LDK|玄関|ホール|階段|子供コーナー|子どもコーナー|脱衣室|洗面脱衣室|洗面脱衣|浴室|ＵＢ|UB|洗面室|トイレ|収納|物入れ?|パントリー|納戸|押入れ?|シューズクローク|SIC|ＳＩＣ|ローカ|廊下|洋室[０-９\d]*|和室[０-９\d]*|主寝室|寝室|ｳｫｰｸｲﾝｸﾛｰｾﾞｯﾄ|ウォークインクローゼット|ＷＩＣ|WIC|書庫|書斎)$/;
  const items=(page.items||[]).filter(function(it){ return String(it.text||'').trim(); });
  const nameItems=items.filter(function(it){
    const t=csvText(it.text);
    const known=typeof normalizeArchitrendPlanRoomName==='function'?normalizeArchitrendPlanRoomName(t):roomNamePattern.test(t);
    if(!known || it.x<=width*0.07 || it.x>=width*0.16) return false;
    return items.some(function(cell){
      const ct=csvText(cell.text);
      return /^[ABC]$/.test(ct) && Math.abs(cell.y-it.y)<2 && cell.x>width*0.205 && cell.x<width*0.25;
    });
  });
  if(!nameItems.length&&typeof parseArchitrendRoomTable==='function'){
    const dynamic=parseArchitrendRoomTable([page]);
    if(dynamic.rooms.length){
      const summary={};
      page.lines.forEach(line=>['A','B','C'].forEach(type=>{
        if(line.compact.includes(type+':')||line.compact.includes('S'+type+'=')){
          const nums=line.items.map(it=>csvNumber(it.text)).filter(n=>n!==null);
          if(nums.length)summary[type]=nums.at(-1);
        }
      }));
      return {rooms:dynamic.rooms,summary,page:page.number,method:'row-columns'};
    }
  }
  nameItems.sort((a,b)=>b.y-a.y);
  // PDF Y increases upwards. Floor labels sit at the center of merged table cells.
  const gaps=nameItems.slice(1).map((it,i)=>nameItems[i].y-it.y).filter(d=>d>1).sort((a,b)=>a-b);
  const pitch=gaps.length ? gaps[Math.floor(gaps.length/2)] : 7;
  const floorMarks=items.filter(it=>it.x>width*0.07 && it.x<width*0.09 && /^[1-9][0-9]*(?:階|F)?$/i.test(csvText(it.text)))
    .sort((a,b)=>b.y-a.y);
  let floorTop=nameItems.length ? nameItems[0].y+pitch/2 : 0;
  const floorBands=floorMarks.map(it=>{
    const bottom=2*it.y-floorTop;
    const band={floor:String(parseInt(it.text,10)),top:floorTop,bottom:bottom};
    floorTop=bottom;
    return band;
  });
  const rooms=[];
  nameItems.forEach(function(nameItem, ni){
    const ny=nameItem.y;
    const near=items.filter(function(it){ return Math.abs(it.y-ny)<2; });
    let area=null, type='';
    near.forEach(function(it){
      const t=csvText(it.text);
      if(/^[ABC]$/.test(t) && it.x>width*0.205 && it.x<width*0.25) type=t;
      const v=parseFloat(t.replace(/,/g,''));
      if(!(v>0)) return;
      if(it.x>width*0.185 && it.x<width*0.215) area=v;
    });
    if(!(area>0) || !type) return;
    const name=(typeof normalizeArchitrendPlanRoomName==='function'&&normalizeArchitrendPlanRoomName(nameItem.text))||String(nameItem.text).trim().replace('ＬＤＫ','LDK').replace('ＵＢ','UB')
      .replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0))
      .replace('ウォークインクローゼット','WIC').replace('ｳｫｰｸｲﾝｸﾛｰｾﾞｯﾄ','WIC').replace('ＷＩＣ','WIC');
    const rowTop=ni ? (nameItems[ni-1].y+ny)/2 : ny+pitch/2;
    const rowBottom=ni+1<nameItems.length ? (nameItems[ni+1].y+ny)/2 : ny-pitch/2;
    const formulaText=items.filter(function(it){ return it.y<rowTop && it.y>rowBottom && it.x>width*0.12 && it.x<width*0.185; })
      .map(function(it){ return String(it.text); }).join(' ');
    const formulas=[];
    const re=/([0-9]+(?:\.[0-9]+)?)\s*[×xX＊*]\s*([0-9]+(?:\.[0-9]+)?)/g;
    let fm;
    const normalized=formulaText.replace(/[×xX＊*]/g,'×');
    while((fm=re.exec(normalized))!==null){
      formulas.push({dx:parseFloat(fm[1]), dy:parseFloat(fm[2])});
    }
    let dx=null, dy=null, compound=formulas.length>1;
    if(formulas.length===1){
      dx=formulas[0].dx; dy=formulas[0].dy;
      if(Math.abs(dx*dy-area)>0.12) compound=true;
    }
    if(compound){ dx=null; dy=null; }
    rooms.push({
      name:name, area:area, type:type, sourcePage:page.number,
      dx:dx, dy:dy, floor:(floorBands.find(b=>ny<=b.top+0.5 && ny>=b.bottom-0.5)||{}).floor||'', compound:compound
    });
  });

  const summary={};
  page.lines.forEach(line=>{
    ['A','B','C'].forEach(type=>{
      if(line.compact.includes(type+':') || line.compact.includes('S'+type+'=')){
        const nums=line.items.map(it=>parseFloat(String(it.text).replace(/,/g,''))).filter(Number.isFinite);
        if(nums.length) summary[type]=nums[nums.length-1];
      }
    });
  });
  if(typeof parseArchitrendRoomTable==='function'){
    const dynamic=parseArchitrendRoomTable([page]);
    const agrees=(a,b)=>a.name===b.name&&Math.abs(a.area-b.area)<.005&&a.type===b.type&&(!a.floor||!b.floor||a.floor===b.floor);
    // A partial success in the historical fixed column must not suppress a
    // larger, independently proven row/column table. Conflicting rows stay out.
    if(dynamic.rooms.length>rooms.length&&rooms.every(room=>dynamic.rooms.some(other=>agrees(room,other))))return {rooms:dynamic.rooms,summary,page:page.number,method:'row-columns'};
  }
  return {rooms, summary, page:page.number};
}

function parsePositionedEnvelope(layoutPages){
  const page=(layoutPages||[]).find(p=>p.lines.some(line=>line.compact.includes('外皮性能計算表')));
  if(!page) return null;
  const width=page.width;
  const scalarAfterLabel=keyword=>{
    const matches=[];
    for(const line of page.lines){
      const label=line.items.find(it=>normalizePdfText(it.text).includes(keyword));
      if(!label)continue;
      if(keyword==='外皮平均熱貫流率'){
        const compact=normalizePdfText(label.text),tail=compact.slice(keyword.length),decoration=/^(?:\(UA\)|UA)?(?:[＝=](?:[②③④]\/①)?)?$/;
        if(!compact.startsWith(keyword))continue;
        const inline=tail.match(/^(?:\(UA\)|UA)?[＝=](?:[②③④]\/①)?([0-9]+\.[0-9]+)(?:\[(?:W\/\(?m[²2]?K\)?|W\/\(?㎡[・･]?K\)?)\])?$/);
        if(inline){matches.push(Number(inline[1]));continue;}
        if(tail&&!/^[()UA＝=①②③④/]+$/.test(tail))continue;
        let symbols=tail,right=label.x+(label.width||0);
        for(const item of line.items.filter(it=>it!==label&&it.x>=right-1).sort((a,b)=>a.x-b.x)){
          const text=normalizePdfText(item.text),font=Math.max(label.height||8,item.height||8,4);
          if(item.x-right>Math.max(font*18,page.width*.08))break;
          if(!text)continue;
          // A circled denominator is a formula token even though NFKC would
          // convert it to an ordinary number. Validate the complete equation.
          if(/^[()UA＝=①②③④/]+$/.test(text)){symbols+=text;right=item.x+(item.width||0);continue;}
          const value=csvNumber(item.text);
          if(value!==null&&decoration.test(symbols))matches.push(value);
          break;
        }
        continue;
      }
      const end=label.x+(label.width||0),inline=normalizePdfText(label.text).match(/[＝=](?:②\/①|③\/①)?([0-9]+\.[0-9]+)(?:\[|W|㎡|$)/);
      if(inline){matches.push(Number(inline[1]));continue;}
      // Read the first numeric cell after this label, stopping at another
      // table's label. Never take the last number on the page-wide baseline.
      const after=line.items.filter(it=>it.x>=end-1).sort((a,b)=>a.x-b.x);
      for(const item of after){
        const value=csvNumber(item.text);
        if(value!==null){matches.push(value);break;}
        // Some exporters place '(UA)', '=', and '②/①' in separate cells.
        // These are equation decorations, not another table's label.
        const symbol=normalizePdfText(item.text);
        if(!symbol||/^(?:\(?UA\)?|[＝=]|[①②③④]\/①)+$/.test(symbol))continue;
        break;
      }
    }
    const values=[...new Set(matches)];return values.length===1?values[0]:null;
  };
  // Locate the U column beside the heat-loss header. A page-relative X can
  // point at Q (W/K) when a report's table is moved or resized.
  const items=architrendPdfTableItems(page);
  const center=item=>item.x+(item.width||0)/2;
  const text=item=>normalizePdfText(item.text);
  const lossHeaders=items.filter(it=>/^(?:貫流熱損失|熱貫流損失)/.test(text(it)));
  const specifications=[];
  let recognized=false;
  for(const loss of lossHeaders){
    const height=Math.max(loss.height||8,4);
    const headers=items.filter(it=>Math.abs(it.y-loss.y)<=Math.max(height,it.height||8)*6&&/^(?:面積|仕様|熱貫流率|温度差係数|貫流熱損失|熱貫流損失)/.test(text(it)));
    const us=headers.filter(it=>/^熱貫流率/.test(text(it))&&center(it)<center(loss)&&center(loss)-center(it)<width*.35).sort((a,b)=>center(b)-center(a));
    if(!us.length||us.length>1&&Math.abs(center(us[0])-center(us[1]))<height)continue;
    const uHead=us[0],ux=center(uHead);
    const xs=headers.map(center).sort((a,b)=>a-b);
    const left=xs.filter(x=>x<ux-1).pop(),right=xs.find(x=>x>ux+1);
    if(left===undefined||right===undefined)continue;
    recognized=true;
    const lo=(left+ux)/2,hi=(right+ux)/2;
    const labels=items.filter(it=>it.y<Math.min(loss.y,uHead.y)-height&&center(it)<ux-height&&/^(屋根|天井|外壁|床|ドア|基礎|窓)\(\d+\)$/.test(text(it)));
    // Select the specification column closest to this U column. Other tables
    // on the same page have their own U columns and must not contribute rows.
    const specX=labels.length?Math.max(...labels.map(center)):null;
    for(const label of labels.filter(it=>Math.abs(center(it)-specX)<=height*2)){
      const match=text(label).match(/^(屋根|天井|外壁|床|ドア|基礎|窓)\((\d+)\)$/);
      const cells=items.filter(it=>Math.abs(it.y-label.y)<=Math.max(height,it.height||8)*.5&&center(it)>=lo&&center(it)<hi).map(it=>architrendPdfCellNumber(it,items)).filter(n=>n!==null&&n>0);
      const u=cells.length===1?cells[0]:null;
      const prior=specifications.find(s=>s.part===match[1]&&s.index===Number(match[2]));
      if(prior){if(prior.u!==u)prior.u=null;}
      else specifications.push({part:match[1],index:Number(match[2]),u,sourcePage:page.number});
    }
  }
  const getU=part=>{
    const rows=specifications.filter(s=>s.part===part),values=[...new Set(rows.map(s=>s.u))];
    return rows.length&&(rows.length===1||part==='窓')&&values.length===1&&values[0]>0?values[0]:null;
  };
  return {
    ua:scalarAfterLabel('外皮平均熱貫流率'),
    envArea:scalarAfterLabel('外皮面積'),
    uRoof:getU('屋根'),uCeiling:getU('天井'),uWall:getU('外壁'),uFloor:getU('床'),uFound:getU('基礎'),
    uDoor:getU('ドア'),uWin:getU('窓'),specifications,
    method:recognized?'headers':'unresolved',page:page.number
  };
}

function parseArchiTrendText(fullText, layoutPages){
  const warnings = [];
  const result = {
    projectName: null,
    workName: null,
    projectLocation: null,
    ua: null,
    envArea: null,
    uRoof: null,
    uWall: null,
    uFloor: null,
    uFound: null,
    uWin: null,
    uDoor: null,
    trueNorthDeg: null,
    trueNorthNote: null,
    rooms: [],
    habitableRooms: [],
    excludedRooms: [],
    windows: [],
    notes: [],
    validation: {}
  };

  const lineText=(layoutPages||[]).flatMap(p=>p.lines.map(line=>line.text)).join('\n');
  const projectPage=(layoutPages||[])[0];
  if(projectPage){
    const projectLine=projectPage.lines.find(line=>line.items.some(it=>String(it.text).trim()==='物件名'));
    const labelItem=projectLine&&projectLine.items.find(it=>String(it.text).trim()==='物件名');
    const valueItem=projectLine&&projectLine.items.find(it=>labelItem && it.x>labelItem.x && it.x<projectPage.width*0.45);
    if(valueItem) result.projectName=String(valueItem.text).trim();
  }
  const workNames=[...lineText.matchAll(/工事名\s+(.+?)$/gm)].map(m=>m[1].trim()).filter(Boolean);
  if(workNames.length) result.workName=workNames[0];
  if(!result.workName){
    const footerName=fullText.match(/テスト物件[^\n]+?(?:施工\)|工事)/);
    if(footerName) result.workName=footerName[0].trim();
  }
  const location = lineText.match(/(?:建設地|物件所在地|建築地)\s+(.+?)$/m);
  if(location) result.projectLocation=location[1].trim();

  const uaEq = fullText.match(/外皮平均熱貫流率\(UA\)＝[^0-9]*([0-9]+\.[0-9]+)/);
  if(uaEq) result.ua = parseFloat(uaEq[1]);
  else warnings.push('UAを一意に読めませんでした');

  const envA = fullText.match(/外皮面積合計\(A\)＝①\s*([0-9]+\.[0-9]+)/) ||
               fullText.match(/外皮面積\[㎡\]\s*([0-9]+\.[0-9]+)/);
  if(envA) result.envArea = parseFloat(envA[1]);
  else warnings.push('外皮面積を一意に読めませんでした');

  const uLine = fullText.match(/0\.2180\.405[0-9.\-－]+0\.259/);
  if(uLine){
    const vals = tokenizeULine(uLine[0]);
    // 屋根, 外壁×4, 土台, ドア, 窓×3, 床, 基礎
    if(vals.length >= 12){
      result.uRoof = vals[0];
      result.uWall = vals[1];
      result.uDoor = vals[6];
      result.uFloor = vals[10];
      result.uFound = vals[11];
      const winUs = vals.slice(7, 10);
      const uniq = [...new Set(winUs.map(v=>v.toFixed(3)))];
      if(uniq.length === 1) result.uWin = winUs[0];
      else warnings.push('窓Uが複数あり一意でないため空欄にします');
    }else{
      warnings.push('部位U値行のトークン数が不足しているため部位Uは空欄にします');
    }
  }else{
    // フォールバック: ページ2の窓Uのみ (すべて同一なら採用)
    const winUs = [...fullText.matchAll(/窓\([12]\)[^0-9]{0,80}?([0-9]+\.[0-9]{3})/g)].map(m=>parseFloat(m[1]));
    const uniq = [...new Set(winUs.map(v=>v.toFixed(3)))];
    if(uniq.length === 1) result.uWin = winUs[0];
    else warnings.push('部位U値行を特定できなかったため屋根/外壁/床/基礎Uは空欄です');
  }

  const found = fullText.match(/土間基礎線熱貫流率\s*\[[^\]]*\]\s*([0-9]+\.[0-9]+)/);
  if(found){
    const v = parseFloat(found[1]);
    if(v > 0 && v < 5) result.uFound = v;
  }

  const north = fullText.match(/真北[\s\S]{0,40}?([0-9]+\.[0-9]+)\s*度/);
  if(north){
    result.trueNorthDeg = parseFloat(north[1]);
    result.trueNorthNote = 'PDFに真北関連角度 '+result.trueNorthDeg+'° の記載あり。補正の解釈が一意でないため自動補正はしません';
    warnings.push(result.trueNorthNote);
  }

  // 窓 (冷房期・開口部[窓]表。小計〜q列は直後〜約2000文字に収まる)
  const coolIdx = fullText.indexOf('開口部[窓](冷房期)');
  const winSource = coolIdx >= 0 ? fullText.slice(coolIdx, coolIdx + 2500) : fullText;
  const winRe = /(?:R\s*)?G(南東|南西|北東|北西|南|北|東|西)-(\d+)\s+([0-9]+\.[0-9]+)\s+([0-9]+\.[0-9]+)\s+([0-9]+\.[0-9]+)/g;
  const seen = new Set();
  let wm;
  while((wm = winRe.exec(winSource)) !== null){
    const id = 'G'+wm[1]+'-'+wm[2];
    if(seen.has(id)) continue;
    seen.add(id);
    const prev = winSource.slice(Math.max(0, wm.index-2), wm.index);
    const roofLike = /R\s*$/.test(prev) || /^R\s/.test(wm[0]);
    result.windows.push({
      id,
      orient: wm[1],
      width: parseFloat(wm[3]),
      height: parseFloat(wm[4]),
      area: parseFloat(wm[5]),
      az: (wm[1] in AT_AZ) ? AT_AZ[wm[1]] : null,
      eta: null,
      tilt:90,
      roofLike
    });
  }

  // η: 日射熱取得量 q=ν·A·η·fC が窓と同じ件数で読めるときだけ逆算して入れる
  // (PDFテキストではη列が行にくっつかないが、q列は窓順の羅列として一意に取れる)
  if(result.windows.length){
    const gainBlock = winSource.match(/窓\s*日射熱取得量小計\s*([0-9]+\.[0-9]+)([\s\S]{0,1500})/);
    const afterSum = gainBlock ? (gainBlock[2] || '') : '';
    const sumQ = gainBlock ? parseFloat(gainBlock[1]) : null;
    // 方位係数ν (地域依存) — 小計直後の 0.xxx 行
    const nuNums = [...afterSum.matchAll(/(?:^|\n|\r|\s)(0\.\d{3})(?=\s|\n|\r|$)/g)].map(m=>parseFloat(m[1]));
    const oriOrder = [];
    result.windows.forEach(w=>{ if(!oriOrder.includes(w.orient)) oriOrder.push(w.orient); });
    const nuMap = {};
    // νは仕様η(0.290等)やfC(0.930)より前に来るので、先頭から方位数だけ使う
    if(nuNums.length >= oriOrder.length){
      oriOrder.forEach((o,i)=>{ nuMap[o] = nuNums[i]; });
    }
    // fC: 「なし」のあとに並ぶ係数のうち 0.9台
    let fC = null;
    const fcM = afterSum.match(/なし[\s\S]{0,80}?(0\.9\d{2})/);
    if(fcM) fC = parseFloat(fcM[1]);
    // q列: 0.07が窓件数分つながった行
    const jammed = (afterSum.match(/0\.\d{2}(?:0\.\d{2}){5,}/) || [])[0] || '';
    const qVals = [];
    if(jammed){
      let i=0;
      while(i < jammed.length){
        const m = jammed.slice(i).match(/^(0\.\d{2})/);
        if(m){ qVals.push(parseFloat(m[1])); i += m[1].length; continue; }
        i++;
      }
    }
    const qSumOk = (sumQ!=null && qVals.length===result.windows.length &&
      Math.abs(qVals.reduce((a,b)=>a+b,0) - sumQ) < 0.05);
    const nuOk = oriOrder.every(o=> nuMap[o]!=null);
    // 仕様のη候補 (日射遮蔽型/取得型など)。q逆算値を最も近い候補へ丸める
    const specEtas = [];
    const specBlock = afterSum.match(/日射遮蔽型[\s\S]{0,30}?(0\.\d{3})|日射取得型[\s\S]{0,30}?(0\.\d{3})/g) || [];
    specBlock.forEach(s=>{
      const m = s.match(/(0\.\d{3})/);
      if(m){
        const v = parseFloat(m[1]);
        if(v < 0.9 && !specEtas.includes(v)) specEtas.push(v);
      }
    });
    if(qSumOk && nuOk && fC!=null && fC>0){
      let etaFilled = 0;
      result.windows.forEach((w,i)=>{
        const nu = nuMap[w.orient];
        const den = nu * w.area * fC;
        if(den > 1e-9){
          let eta = qVals[i] / den;
          if(eta > 0 && eta < 1.5){
            if(specEtas.length){
              let best = specEtas[0], bestD = Math.abs(eta-best);
              specEtas.forEach(c=>{
                const d = Math.abs(eta-c);
                if(d < bestD){ best=c; bestD=d; }
              });
              if(bestD <= 0.05) eta = best;
            }
            w.eta = Math.round(eta*1000)/1000;
            etaFilled++;
          }
        }
      });
      if(etaFilled === result.windows.length){
        warnings.push('窓'+result.windows.length+'枚を自動取得 (面積・方位・η)。部屋への割当だけ手動です');
      }else{
        warnings.push('窓リストは取得済み。ηを一部しか復元できなかったため、空欄の窓は手動入力してください');
      }
    }else{
      warnings.push('窓'+result.windows.length+'枚を自動取得 (面積・方位)。ηはPDF対応が一意でないため空欄 — 手動入力してください');
    }
  }else{
    warnings.push('窓リストを読めませんでした');
  }

  // 居室 (出現順で抽出 → タイプ文字AAAAB... と突き合わせ)
  const typeMatch = fullText.match(/([ABC]{10,})/);
  const digitMap = {'１':'1','２':'2','３':'3','1':'1','2':'2','3':'3'};
  const roomPatterns = [
    {re: /ＬＤＫ\s*([0-9]+\.[0-9]+)|LDK\s*([0-9]+\.[0-9]+)/g, name:()=>'LDK', area:m=>parseFloat(m[1]||m[2])},
    {re: /洋室([１２３123])([0-9]+\.[0-9]+)/g, name:m=>'洋室'+digitMap[m[1]], area:m=>parseFloat(m[2])},
    {re: /子供コーナー\s*([0-9]+\.[0-9]+)/g, name:()=>'子供コーナー', area:m=>parseFloat(m[1])},
    {re: /玄関\s*([0-9]+\.[0-9]+)/g, name:()=>'玄関', area:m=>parseFloat(m[1])},
    {re: /ホール\s*([0-9]+\.[0-9]+)/g, name:()=>'ホール', area:m=>parseFloat(m[1])},
    {re: /階段\s*([0-9]+\.[0-9]+)/g, name:()=>'階段', area:m=>parseFloat(m[1])},
    {re: /脱衣室\s*([0-9]+\.[0-9]+)/g, name:()=>'脱衣室', area:m=>parseFloat(m[1])},
    {re: /ＵＢ\s*([0-9]+\.[0-9]+)|UB\s*([0-9]+\.[0-9]+)/g, name:()=>'UB', area:m=>parseFloat(m[1]||m[2])},
    {re: /洗面室\s*([0-9]+\.[0-9]+)/g, name:()=>'洗面室', area:m=>parseFloat(m[1])},
    {re: /トイレ\s*([0-9]+\.[0-9]+)/g, name:()=>'トイレ', area:m=>parseFloat(m[1])},
    {re: /収納\s*([0-9]+\.[0-9]+)/g, name:()=>'収納', area:m=>parseFloat(m[1])},
    {re: /ローカ\s*([0-9]+\.[0-9]+)/g, name:()=>'ローカ', area:m=>parseFloat(m[1])},
    {re: /ｳｫｰｸｲﾝｸﾛｰｾﾞｯﾄ\s*([0-9]+\.[0-9]+)/g, name:()=>'WIC', area:m=>parseFloat(m[1])},
    {re: /書庫\s*([0-9]+\.[0-9]+)/g, name:()=>'書庫', area:m=>parseFloat(m[1])}
  ];
  const roomHits = [];
  roomPatterns.forEach(p=>{
    const re = new RegExp(p.re.source, 'g');
    let m;
    while((m = re.exec(fullText)) !== null){
      roomHits.push({index:m.index, name:p.name(m), area:p.area(m)});
    }
  });
  roomHits.sort((a,b)=>a.index-b.index);
  // 同名同面積の別室 (収納が複数など) は残す。同一indexの二重マッチだけ除外
  const roomsDedup = [];
  const seenIdx = new Set();
  roomHits.forEach(r=>{
    if(seenIdx.has(r.index)) return;
    seenIdx.add(r.index);
    roomsDedup.push(r);
  });

  if(typeMatch && roomsDedup.length){
    const types = typeMatch[0];
    const n = Math.min(types.length, roomsDedup.length);
    for(let i=0;i<n;i++){
      result.rooms.push({name: roomsDedup[i].name, area: roomsDedup[i].area, type: types[i]});
    }
    if(types.length !== roomsDedup.length){
      warnings.push('居室タイプ文字数('+types.length+')と部屋数('+roomsDedup.length+')が一致しません。読めた範囲のみ採用');
    }
  }else if(roomsDedup.length){
    roomsDedup.forEach(r=> result.rooms.push({name:r.name, area:r.area, type:null}));
    warnings.push('居室タイプ(A/B/C)を読めなかったため、全部屋を窓割当候補にします');
  }else{
    warnings.push('居室リストを読めませんでした');
  }

  // 座標付き表解析を優先する。平文化で崩れやすい窓・居室表を行/列として読み直す
  const envelopeLayout=parsePositionedEnvelope(layoutPages);
  if(envelopeLayout){
    ['ua','envArea'].forEach(key=>{
      if(envelopeLayout[key]===null)return;
      if(result[key]!==null&&Math.abs(result[key]-envelopeLayout[key])>.005){
        result[key]=null;warnings.push((key==='ua'?'UA':'外皮面積')+'の文章と表の値が一致しません。値の自動反映を保留しました');
      }else result[key]=envelopeLayout[key];
    });
    // Also clear ambiguous or absent parts: never keep an earlier text guess.
    ['uRoof','uCeiling','uWall','uFloor','uFound','uWin','uDoor'].forEach(key=>result[key]=envelopeLayout[key]);
    result.envelopeSpecifications=envelopeLayout.specifications;
    result.envelopeMethod=envelopeLayout.method;
    for(let i=warnings.length-1;i>=0;i--){
      if((result.ua!==null && /^UAを/.test(warnings[i])) ||
         (result.envArea!==null && /^外皮面積を/.test(warnings[i])) ||
         (result.uRoof!==null && /部位U値/.test(warnings[i])) ||
         (result.uWin!==null && /窓U/.test(warnings[i]))) warnings.splice(i,1);
    }
  }
  const windowLayout=parsePositionedWindows(layoutPages);
  if(windowLayout?.blocked){
    result.windows=[];delete result.validation.windows;
    warnings.push('窓表の範囲を一意に判定できませんでした。冷房期と暖房期を混在させず、窓の自動取得を保留しました');
  }
  if(windowLayout && windowLayout.windows.length){
    result.windows=windowLayout.windows;
    const areaSum=result.windows.reduce((sum,w)=>sum+(w.area||0),0);
    const gainSum=result.windows.reduce((sum,w)=>sum+(w.gain||0),0);
    result.validation.windows={
      count:result.windows.length,
      areaSum, expectedArea:windowLayout.expectedArea,
      gainSum, expectedGain:windowLayout.expectedGain,
      areaOk:windowLayout.expectedArea!==null && Math.abs(areaSum-windowLayout.expectedArea)<0.03,
      gainOk:windowLayout.expectedGain!==null && Math.abs(gainSum-windowLayout.expectedGain)<0.03,
      page:windowLayout.page
    };
    for(let i=warnings.length-1;i>=0;i--){
      if(/窓リスト|窓\d+枚|窓のη/.test(warnings[i])) warnings.splice(i,1);
    }
    result.notes.push('窓'+result.windows.length+'枚を冷房期の表から抽出しました。階や日射の入りやすさ（η0）が空欄の窓は、資料を確認して補ってください。');
  }
  if(!windowLayout?.blocked)applyPdfWindowSpecifications(result,layoutPages,warnings);
  const roomLayout=parsePositionedRooms(layoutPages);
  if(roomLayout && roomLayout.rooms.length){
    result.rooms=roomLayout.rooms;
    result.habitableRooms=result.rooms.filter(isArchitrendLivingRoom);
    result.excludedRooms=result.rooms.filter(function(r){ return !isArchitrendLivingRoom(r); });
    const sums={A:0,B:0,C:0};
    result.rooms.forEach(r=>{ if(r.type in sums) sums[r.type]+=r.area; });
    result.validation.rooms={
      sums, expected:roomLayout.summary,
      ok:['A','B','C'].every(t=>roomLayout.summary[t]!=null && Math.abs(sums[t]-roomLayout.summary[t])<0.03),
      page:roomLayout.page
    };
    for(let i=warnings.length-1;i>=0;i--){
      if(/居室リスト|居室タイプ/.test(warnings[i])) warnings.splice(i,1);
    }
  }else{
    result.habitableRooms=result.rooms.filter(isArchitrendLivingRoom);
    result.excludedRooms=result.rooms.filter(function(r){ return !isArchitrendLivingRoom(r); });
  }
  if(typeof parseArchitrendPlanRooms==='function'){
    // Text-only guesses do not establish an area-table row. Use positioned cells.
    const plan=parseArchitrendPlanRooms(layoutPages||[],roomLayout&&roomLayout.rooms||[]);
    if(plan&&plan.rooms&&plan.rooms.length){
      result.rooms=plan.rooms;
      result.habitableRooms=result.rooms.filter(isArchitrendLivingRoom);
      result.excludedRooms=result.rooms.filter(r=>!isArchitrendLivingRoom(r));
      result.planRoomPages=plan.pages||[];
      result.planRoomDiagnostics=plan.diagnostics||[];
      result.unmatchedPlanTableRooms=plan.unmatchedTableRooms||[];
      result.roomSourceLabel='PDF 平面図 p.'+result.planRoomPages.join('・');
      result.notes.push('平面図の室名を優先しています。表の合算面積と3DSの区画面積は一致しない場合があります。');
      warnings.push(...(plan.warnings||[]));
    }
  }
  if(!result.projectLocation) warnings.unshift('建設地の記載がないため、住所または緯度・経度を入力してください');
  if(result.projectName && result.workName && normalizePdfText(result.projectName)!==normalizePdfText(result.workName)){
    warnings.unshift('物件名とフッターの工事名が一致しません。物件名を優先します');
  }

  return {result, warnings};
}

function architrendPdfAssessment(extracted, parsed){
  const result=parsed?.result||{},pages=extracted?.pages||[];
  const recognized=['ua','envArea','uRoof','uCeiling','uWall','uFloor','uFound','uWin','uDoor'].some(key=>Number.isFinite(result[key])&&result[key]>0)||
    (result.rooms||[]).length>0||(result.windows||[]).length>0||
    (result.envelopeSpecifications||[]).some(spec=>Number.isFinite(spec.u)&&spec.u>0);
  const lowTextPages=pages.filter(page=>(page.items||[]).reduce((n,item)=>n+String(item.text||'').replace(/\s/g,'').length,0)<50).map(page=>page.number);
  const chars=Number(extracted?.chars)||0;
  return {ready:recognized,code:recognized?'PDF_DATA_RECOGNIZED':chars<50?'PDF_TEXT_EMPTY':'PDF_NO_SUPPORTED_DATA',
    pageCount:pages.length,lowTextPages};
}

async function extractPdfText(file){
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: buf}).promise;
  let full = '';
  let chars = 0;
  const pages=[];
  for(let i=1;i<=pdf.numPages;i++){
    const page = await pdf.getPage(i);
    const viewport=page.getViewport({scale:1});
    const content = await page.getTextContent();
    const text = content.items.map(it=>it.str).join(' ');
    chars += text.replace(/\s/g,'').length;
    full += text + '\n';
    const positioned=content.items.map(it=>{
      // PDF text coordinates precede page rotation and CropBox translation.
      // Use the displayed page, keeping the upward Y axis used by the tables.
      const point=viewport.convertToViewportPoint(it.transform[4],it.transform[5]);
      return {text:it.str,x:point[0],y:viewport.height-point[1],
        width:it.width||0,height:it.height||0};
    });
    const layout={number:i,width:viewport.width,height:viewport.height,items:positioned,
      lines:groupPdfItemsIntoLines(positioned)};
    if(typeof atPdfRulingLines==='function'&&typeof page.getOperatorList==='function'){
      try{
        const ruled=atPdfRulingLines(await page.getOperatorList(),{ops:pdfjsLib.OPS,
          viewportTransform:viewport.transform,width:viewport.width,height:viewport.height});
        layout.rulingLines=ruled.lines;
        layout.rulingLineStatus={complete:ruled.complete};
      }catch(error){layout.rulingLines=[];layout.rulingLineStatus={complete:false};}
    }
    pages.push(layout);
  }
  return {full, chars, numPages: pdf.numPages, pages};
}

function escapeHtml(value){
  return String(value==null?'':value)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function renderArchitrendReview(parsed, applied){
  const previousReview=document.getElementById('atReview');
  const openDetails=previousReview?._reviewSource===parsed?[...previousReview.querySelectorAll('details')].map(d=>d.open):null;
  const {result,warnings}=parsed;
  const roomValidation=result.validation.rooms;
  const winValidation=result.validation.windows;
  const validations=[
    roomValidation ? {ok:roomValidation.ok,text:'室面積 A/B/C 合計'} : {ok:false,text:'室面積合計を未検証'},
    winValidation ? {ok:winValidation.areaOk,text:'窓面積・寸法'} : {ok:false,text:'窓面積を未検証'},
    winValidation ? {ok:winValidation.gainOk,text:'窓日射取得量'} : {ok:false,text:'窓日射取得量を未検証'}
  ];
  if(winValidation&&winValidation.crossText){
    validations.push({ok:winValidation.crossOk,text:winValidation.crossText});
  }
  const orientationCounts={};
  result.windows.forEach(w=>{ orientationCounts[w.orient]=(orientationCounts[w.orient]||0)+1; });
  const uaText=result.ua==null?'—':result.ua;
  const areaText=result.envArea==null?'—':result.envArea+'㎡';
  const windowArea=winValidation?winValidation.areaSum:result.windows.reduce((s,w)=>s+(w.area||0),0);
  const review=document.getElementById('atReview');
  review._reviewSource=parsed;
  document.getElementById('atSummary').innerHTML='';
  const sources=result.sources||{};
  const sourceOf=(key,fallback)=>String(sources[key]||fallback||'—').replace(/^CSV/,result.inputSources.xlsx?'Excel':'CSV');

  const buildingItems=[
    ['物件名',result.projectName||'不明',sourceOf('projectName',result.inputSources.pdf?'PDF p.1':'—')],
    ['フッター工事名',result.workName||'不明',sourceOf('workName',result.inputSources.pdf?'PDF 各頁':'—')],
    ['建設地',result.projectLocation||'記載なし (手動)','—'],
    ['UA',uaText,sourceOf('ua')],
    ['外皮面積',areaText,sourceOf('envArea')],
    ['屋根U',result.uRoof==null?'—':result.uRoof,sourceOf('uRoof')],
    ['外壁U',result.uWall==null?'—':result.uWall,sourceOf('uWall')],
    ['床U',result.uFloor==null?'—':result.uFloor,sourceOf('uFloor')],
    ['基礎U',result.uFound==null?'—':result.uFound,sourceOf('uFound')],
    ['窓U',result.uWin==null?(result.windows.length&&result.windows.every(w=>w.u>0)?'窓ごとに取得済み（'+new Set(result.windows.map(w=>Number(w.u).toFixed(3))).size+'種類）':'—'):result.uWin,sourceOf('uWin')],
    ['外部扉U',result.uDoor==null?'—':result.uDoor,sourceOf('uDoor')]
  ];
  const windowRows=result.windows.map(w=>
    '<tr><td>'+escapeHtml(w.id)+'</td><td>'+escapeHtml(w.floor||'—')+'</td>'+
    '<td>'+escapeHtml(w.orient||'—')+'</td><td>'+escapeHtml(w.width==null?'—':w.width)+'</td>'+
    '<td>'+escapeHtml(w.height==null?'—':w.height)+'</td><td>'+escapeHtml(w.area==null?'—':w.area)+'</td>'+
    '<td>'+escapeHtml(w.eta==null?'—':w.eta)+'</td><td>'+escapeHtml(w.u>0?Number(w.u).toFixed(3):'—')+'</td><td class="src">'+
    escapeHtml(w.sourceLabel||(w.sourcePage?'PDF p.'+w.sourcePage:'—'))+(w.uSource?'<br><small>U値：'+escapeHtml(w.uSource)+'</small>':'')+'</td></tr>'
  ).join('');
  const orientationText=Object.entries(orientationCounts).map(([k,v])=>k+v).join(' / ')||'なし';
  const csvCounts=result.csvDiagnostics&&result.csvDiagnostics.counts;
  const csvSummary=csvCounts?'<p class="small">CSV '+csvCounts.inputRows+'行：取得 '+csvCounts.acceptedRows+'行、統合 '+csvCounts.mergedRows+'行、見出し '+csvCounts.ignoredRows+'行、保留 '+csvCounts.rejectedRows+'行 / 窓 '+csvCounts.inputWindows+'行 → '+csvCounts.acceptedWindows+'枚</p>':'';
  let meshRoomsHtml='';
  if(typeof atMesh!=='undefined' && atMesh && (atMesh.rooms||[]).length){
    if(typeof atPlanRoomMatches!=='function'&&!result.planRoomPages?.length&&typeof atMergeRoomsByPdf==='function'){
      atMesh.rooms=atMergeRoomsByPdf(atMesh.rooms, result.rooms||[], atMesh.meshFaces);
    }
    if(typeof atMatchMeshRoomsToPdf==='function'){
      atMatchMeshRoomsToPdf(atMesh.rooms, result.rooms||[]);
    }
    if(typeof atPlanStairsForMesh==='function') atPlanStairsForMesh(atMesh);
    if(typeof atApplyRoomGainFlags==='function') atApplyRoomGainFlags(atMesh);
    const shown=(atMesh.rooms||[]).filter(function(r){ return r.keep || r.habitable; });
    meshRoomsHtml=
      '<details open><summary>3DS発熱室（居室＋窓のある室） <span class="count">'+shown.length+'室</span></summary>'+
        '<div class="at-review-body at-window-table"><table><tr><th>階</th><th>面積</th><th>寸法</th><th>部屋名</th></tr>'+
          shown.map(function(r){
            return '<tr><td>'+escapeHtml(String(r.floor))+'F</td><td>'+r.area.toFixed(2)+'</td><td>'+
              r.dx.toFixed(2)+'×'+r.dy.toFixed(2)+'</td><td>'+
              '<input type="text" data-at-rename-key="'+escapeHtml(r.key)+'" value="'+escapeHtml(r.name||'')+'" onchange="atRenameMeshRoom(\''+
              escapeHtml(r.key)+'\', this.value)"></td></tr>';
          }).join('')+
        '</table><div class="small" style="margin-top:6px;">居室(A/B)は人体・機器を足します。窓がある非居室(C)は直達日射だけ入れます。窓の無い非居室はカードにしません。</div></div></details>';
  }
  review.innerHTML=
    '<div class="at-review">'+
      '<div class="at-review-head">'+
        '<span class="at-chip"><span>入力</span><b>'+
          (result.inputSources.csv?(result.inputSources.xlsx?'Excel':'CSV'):'')+(result.inputSources.csv&&result.inputSources.pdf?' + ':'')+
          (result.inputSources.pdf?'PDF':'')+'</b></span>'+
        '<span class="at-chip"><span>物件</span><b>'+escapeHtml(result.projectName||'不明')+'</b></span>'+
        '<span class="at-chip"><span>UA</span><b>'+escapeHtml(uaText)+'</b></span>'+
        '<span class="at-chip"><span>外皮</span><b>'+escapeHtml(areaText)+'</b></span>'+
        '<span class="at-chip"><span>居室</span><b>'+result.habitableRooms.length+'室</b></span>'+
        '<span class="at-chip"><span>窓</span><b>'+result.windows.length+'枚 / '+windowArea.toFixed(2)+'㎡</b></span>'+
        '<span class="at-chip warn-chip"><span>要確認</span><b>'+warnings.length+'件</b></span>'+
      '</div>'+
      csvSummary+
      '<details '+(warnings.length?'open':'')+'><summary>要確認 <span class="count">'+warnings.length+'件</span></summary>'+
        '<div class="at-review-body">'+
          (warnings.length?'<ul class="at-warn-list">'+warnings.map(w=>'<li>'+escapeHtml(w)+'</li>').join('')+'</ul>':'<span class="small">問題はありません。</span>')+
          '<div style="margin-top:7px;">'+validations.map(v=>'<span class="'+(v.ok?'at-validation-ok':'at-validation-ng')+'" style="margin-right:12px;">'+(v.ok?'✓ ':'× ')+escapeHtml(v.text)+'</span>').join('')+'</div>'+
        '</div></details>'+
      '<details><summary>建物・外皮 <span class="count">'+buildingItems.length+'項目</span></summary>'+
        '<div class="at-review-body at-review-grid">'+buildingItems.map(item=>
          '<div class="at-review-item"><span>'+escapeHtml(item[0])+'</span><span><b>'+escapeHtml(item[1])+'</b> <small class="src">'+escapeHtml(item[2])+'</small></span></div>'
        ).join('')+'</div></details>'+
      '<details><summary>部屋 <span class="count">'+result.habitableRooms.length+'居室を作成 / '+result.excludedRooms.length+'非居室を窓割当候補</span></summary>'+
        '<div class="at-review-body"><div class="at-room-chips">'+
          result.habitableRooms.map(r=>'<span class="at-room-chip">'+escapeHtml(r.name)+' '+(r.area>0?Number(r.area).toFixed(2)+'㎡':'面積記載なし')+'</span>').join('')+
        '</div><div class="small" style="margin-top:8px;">窓割当時に作成する非居室候補: '+
          result.excludedRooms.map(r=>'<span class="at-room-chip excluded">'+escapeHtml(r.name)+'</span>').join(' ')+
        '</div><div class="small" style="margin-top:6px;">出典: '+escapeHtml(sourceOf('rooms','—'))+'</div></div></details>'+
      meshRoomsHtml+
      '<details><summary>窓 <span class="count">'+escapeHtml(orientationText)+' / 合計'+windowArea.toFixed(2)+'㎡</span></summary>'+
        '<div class="at-review-body at-window-table"><p class="small">窓の性能：U値 '+result.windows.filter(w=>w.u>0).length+'/'+result.windows.length+'枚・日射熱取得率（η0） '+result.windows.filter(w=>w.eta!=null).length+'/'+result.windows.length+'枚を取得。出典を確認してから反映してください。</p><table><tr><th>ID</th><th>階</th><th>方位</th><th>幅</th><th>高</th><th>面積</th><th>η0</th><th>U値 W/m²K</th><th>出典</th></tr>'+
          windowRows+'</table></div></details>'+
      '<details><summary>対象外として無視 <span class="count">会社・設計者情報</span></summary>'+
        '<div class="at-review-body small">TEL/FAX、設計者名、登録番号などの会社情報は解析条件として使用しません。</div></details>'+
      '<div class="at-review-actions at-import-confirm boundary-action-bar'+(applied?' is-applied':'')+'" data-boundary-action="import">'+
        (applied?'<div class="at-import-confirm-copy boundary-action-status" data-state="applied" role="status"><strong>反映済み：資料の断熱・部屋・窓の取得情報</strong><p>入力済みの日時・気温・使い方は維持します。対応待ち・未取得の項目は作業一覧で確認してください。</p></div>':
          '<div class="at-import-confirm-copy"><span class="at-import-confirm-label">大切なステップ</span><strong>内容を確認したら、入力へ反映しましょう</strong><p>読込結果を確認して、このボタンを押してください。反映後も各値は編集できます。</p></div>'+
          '<button type="button" id="atApplyImportBtn" class="at-apply-btn" onclick="confirmApplyArchitrend()"><span>確認して入力へ反映</span><svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24"><path d="M4 12h15M13 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>')+
      '</div>'+
    '</div>';
  if(openDetails)review.querySelectorAll('details').forEach((d,i)=>{if(i<openDetails.length)d.open=openDetails[i];});
  if(typeof atUpdateRoomVolume==='function') atUpdateRoomVolume();
  if(typeof atRenderRoomViewer==='function') atRenderRoomViewer();
}

function confirmApplyArchitrend(){
  if(!atLastParse) return;
  const keep=typeof gatherState==='function'?gatherState():null;
  applyArchitrendParse(atLastParse);
  // A source replacement was already invalidated at file selection. Preserve
  // independent conditions entered while reviewing this source, without reviving old files.
  for(const id of ['calcDate','detailHour','lat','lon','tmax','tmin','tpeak','targetT','ach','hxRate','acMax']){
    const value=keep?.inputs?.[id],el=document.getElementById(id);if(el&&value!==undefined&&value!=='')el.value=value;
  }
  for(const card of document.querySelectorAll('.room-card[data-at-room-key]')){
    const matches=(keep?.rooms||[]).filter(r=>r.atRoomKey&&r.atRoomKey===card.dataset.atRoomKey);if(matches.length!==1)continue;
    const saved=matches[0];for(const [key,value]of Object.entries(saved.fields||{})){const input=card.querySelector('.'+key);if(input)input.value=value;}
    for(const row of card.querySelectorAll('.win-row[data-at-face-id]')){
      const wins=(saved.windows||[]).filter(w=>w.atFaceId&&w.atFaceId===row.dataset.atFaceId);if(wins.length!==1)continue;
      for(const key of ['wName','wAz','wEta','wArea','wU','glassSel','attachSel']){const el=row.querySelector('.'+key),value=wins[0][key];if(el&&value!==undefined&&value!=='')el.value=value;}
    }
  }
  runAll();
}

function atRenameMeshRoom(key, name){
  name=String(name||'').trim();
  let meshRoom=null;
  if(typeof atMesh!=='undefined' && atMesh && atMesh.rooms){
    atMesh.rooms.forEach(function(r){
      if(r.key!==key) return;
      r.name=name;
      r.manualAssignment=true;
      r.reviewed=!!name;
      meshRoom=r;
    });
  }
  const card=document.querySelector('.room-card[data-at-room-key="'+key+'"]');
  if(card){
    const el=card.querySelector('.roomName');
    if(el) el.value=name;
    if(typeof atSyncRoomCardKind==='function') atSyncRoomCardKind(card, meshRoom||{habitable:isHabitableRoomName(name)});
  }
  if(typeof atMesh!=='undefined' && atMesh){
    if(typeof atPlanStairsForMesh==='function') atPlanStairsForMesh(atMesh);
    if(typeof atApplyRoomGainFlags==='function') atApplyRoomGainFlags(atMesh);
    if(typeof atBuildGainVolumes==='function') atMesh.gainVolumes=atBuildGainVolumes(atMesh);
  }
  if(typeof atRenderRoomViewer==='function') atRenderRoomViewer();
  if(typeof saveStateDebounced==='function') saveStateDebounced();
}
function atMatchMeshRoomsToPdf(meshRooms, pdfRooms){
  if(typeof atPlanRoomMatches==='function'&&typeof atApplyRoomMatchPlan==='function'){
    if(typeof atSetRoomCatalog==='function')atSetRoomCatalog(pdfRooms||[]);
    const base=atPlanRoomMatches(meshRooms||[],pdfRooms||[],{});
    const plan=typeof atSpatialPlanRoomMatches==='function'?atSpatialPlanRoomMatches(meshRooms||[],pdfRooms||[],base,{}):base;
    atApplyRoomMatchPlan(meshRooms||[],pdfRooms||[],plan);
    if(typeof atMesh!=='undefined'&&atMesh&&atMesh.rooms===meshRooms){
      atMesh.roomMatchPlan=plan;
      if(typeof atSetProjectedFloorSources==='function')atSetProjectedFloorSources(atMesh,pdfRooms||[]);
    }
    return meshRooms||[];
  }
  const used=new Set();
  if(typeof atSetRoomCatalog==='function') atSetRoomCatalog(pdfRooms);
  (meshRooms||[]).forEach(function(r){
    if(r.manualAssignment && Number.isInteger(r.pdfIndex) && r.pdfIndex>=0) used.add(r.pdfIndex);
  });
  function dimOk(r, p){
    if(!(p.dx>0 && p.dy>0 && r.dx>0 && r.dy>0) || p.compound) return true;
    const a=Math.abs(p.dx-r.dx)+Math.abs(p.dy-r.dy);
    const b=Math.abs(p.dx-r.dy)+Math.abs(p.dy-r.dx);
    return Math.min(a,b)<=0.08;
  }
  function tryMatch(r, areaTol){
    let best=null, bestScore=1e9;
    (pdfRooms||[]).forEach(function(p, i){
      if(used.has(i)) return;
      if(p.floor && r.floor && String(p.floor)!==String(r.floor) && p.floor!=='R') return;
      const dA=Math.abs((p.area||0)-(r.area||0));
      if(dA>areaTol) return;
      if(!dimOk(r, p)) return;
      const score=dA*8+(p.dx>0?0:0.2);
      if(score<bestScore){ bestScore=score; best={p:p, i:i}; }
    });
    return best;
  }
  (meshRooms||[]).forEach(function(r){
    if(r.manualAssignment) return;
    const best=tryMatch(r, 0.08) || tryMatch(r, 1.02);
    if(best){
      used.add(best.i);
      r.name=best.p.name;
      r.pdfArea=best.p.area;
      r.pdfType=best.p.type||'';
      r.keep=isArchitrendLivingRoom(best.p);
      r.habitable=isArchitrendLivingRoom(best.p);
      r.pdfIndex=best.i;
    }else{
      r.name='';
      r.pdfIndex=null;
      r.pdfArea=null;
      r.habitable=false;
      r.keep=false;
      r.pdfType='';
    }
  });
  if(typeof atMesh!=='undefined'&&atMesh&&atMesh.rooms===meshRooms&&typeof atSetProjectedFloorSources==='function')atSetProjectedFloorSources(atMesh,pdfRooms||[]);
  return meshRooms||[];
}
function atSyncRoomCardKind(card, r){
  if(!card) return;
  const hab=!!(r && r.habitable);
  card.dataset.nonHabitable=hab?'false':'true';
  card.classList.toggle('non-habitable', !hab);
  const header=card.querySelector('.room-header');
  let kind=card.querySelector('.room-kind');
  if(!hab){
    if(!kind && header){
      kind=document.createElement('span');
      kind.className='room-kind';
      header.insertBefore(kind, header.querySelector('button'));
    }
    if(kind) kind.textContent=r&&r.explicitGainTarget?'非居室・入力した発熱を保持':'非居室・窓日射用';
  }else if(kind){
    kind.remove();
  }
  const defaults=(typeof TOOL_DEFAULTS!=='undefined') ? TOOL_DEFAULTS : {};
  function setCls(cls, value){
    const el=card.querySelector('.'+cls);
    if(el) el.value=String(value);
  }
  if(!hab&&!(r&&r.explicitGainTarget)){
    setCls('occCount', 0);
    setCls('peopleSensRate', 0);
    setCls('peopleMoistRate', 0);
    setCls('equipSensRate', 0);
    setCls('equipMoistRate', 0);
  }else if(hab&&!(r&&r.manualMerged)){
    const ps=card.querySelector('.peopleSensRate');
    if(ps && !(parseFloat(ps.value)>0)) ps.value=String(defaults.peopleSensRate||60);
    const pm=card.querySelector('.peopleMoistRate');
    if(pm && !(parseFloat(pm.value)>0)) pm.value=String(defaults.peopleMoistRate||76);
    const es=card.querySelector('.equipSensRate');
    if(es && !(parseFloat(es.value)>0)) es.value=String(defaults.equipSensRate||5);
  }
}
function atAddRoomCardFromMesh(r){
  const isNonHabitable=!r.habitable;
  const fields={
    roomArea:String(Math.round((r.area||0)*100)/100),
    occCount:isNonHabitable?'0':''
  };
  if(isNonHabitable){
    fields.peopleSensRate='0';
    fields.peopleMoistRate='0';
    fields.equipSensRate='0';
    fields.equipMoistRate='0';
  }
  const roomId=addRoom({
    name:r.name||'部屋', atRoomKey:r.key, isNonHabitable:isNonHabitable, fields:fields, windows:[], skipRerun:true
  });
  const card=document.getElementById(roomId);
  if(card){
    const areaEl=card.querySelector('.roomArea');
    if(areaEl){
      const wrap=areaEl.closest('div');
      if(wrap) wrap.classList.add('at-filled');
    }
  }
  return roomId;
}
function atPdfWindowCandidates(meshWin, pdfWindows, used){
  used=used||new Set();
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const floor=csvFloor(meshWin.floor);
  let meshAz=finite(meshWin.az)?meshWin.az:null;
  if(meshAz===null&&finite(meshWin.face&&meshWin.face.modelToolAz))meshAz=meshWin.face.modelToolAz-(typeof atNorthDeg==='function'?atNorthDeg():0);
  if(meshAz===null&&meshWin.orient in AT_AZ)meshAz=AT_AZ[meshWin.orient];
  if(!floor||meshAz===null)return [];
  const distance=(a,b)=>Math.abs(((a-b+540)%360+360)%360-180);
  const points=meshWin.face&&meshWin.face.verts||[];
  const height=points.length?Math.max(...points.map(p=>p.z))-Math.min(...points.map(p=>p.z)):null;
  let width=null;
  if(points.length){width=0;for(const a of points)for(const b of points)width=Math.max(width,Math.hypot(a.x-b.x,a.y-b.y));}
  const candidates=[];
  (pdfWindows||[]).forEach(function(w,i){
    if(used.has(i)||w.ambiguous||!csvFloor(w.floor)||csvFloor(w.floor)!==floor)return;
    const az=finite(w.az)?w.az:w.orient in AT_AZ?AT_AZ[w.orient]:null;
    if(az===null||distance(meshAz,az)>22.5+.001)return;
    if(!(w.area>0&&meshWin.area>0)||Math.abs(w.area-meshWin.area)>.06)return;
    if(width!==null&&w.width>0&&Math.abs(width-w.width)>.06)return;
    if(height!==null&&w.height>0&&Math.abs(height-w.height)>.06)return;
    candidates.push({w,i});
  });
  return candidates;
}
function atPdfWindowForMesh(meshWin, pdfWindows, used){
  const candidates=atPdfWindowCandidates(meshWin,pdfWindows,used);
  return candidates.length===1?candidates[0]:null;
}
// Match complete connected groups, never consume a source row greedily.
// Equivalent conditions can be transferred without claiming a source ID match.
function atMatchWindowSet(meshWindows, sourceWindows){
  const edges=meshWindows.map(w=>atPdfWindowCandidates(w,sourceWindows).map(c=>c.i));
  const hits=meshWindows.map(()=>null),used=new Set(),visited=new Set(),reasons=meshWindows.map(()=> 'NO_SOURCE_CANDIDATE');
  function pairing(ms,blocked){
    const owners=new Map();
    function visit(m,seen){
      for(const s of edges[m]){
        if(blocked&&blocked[0]===m&&blocked[1]===s||seen.has(s))continue;
        seen.add(s);
        if(!owners.has(s)||visit(owners.get(s),seen)){owners.set(s,m);return true;}
      }return false;
    }
    for(const m of ms)if(!visit(m,new Set()))return null;
    return new Map([...owners].map(([s,m])=>[m,s]));
  }
  const signature=w=>JSON.stringify(['area','width','height','u','eta','tilt','roofLike','spec','glassSpec','attachment','gainCooling','gainHeating','heatLoss'].map(k=>w[k]??null));
  meshWindows.forEach((_,start)=>{
    if(visited.has(start)||!edges[start].length)return;
    const ms=[],ss=new Set(),queue=[start];visited.add(start);
    while(queue.length){const m=queue.pop();ms.push(m);for(const s of edges[m]){ss.add(s);edges.forEach((e,j)=>{if(!visited.has(j)&&e.includes(s)){visited.add(j);queue.push(j);}});}}
    if(ms.length!==ss.size){ms.forEach(m=>reasons[m]='SOURCE_MODEL_COUNT_MISMATCH');return;}
    // Large groups of identical units need only one feasibility pass.
    const equivalent=new Set([...ss].map(s=>signature(sourceWindows[s]))).size===1;
    if(ms.length>100&&!equivalent){ms.forEach(m=>reasons[m]='MULTIPLE_DIFFERENT_CONDITIONS');return;}
    const match=pairing(ms);if(!match){ms.forEach(m=>reasons[m]='NO_COMPLETE_MATCH');return;}
    for(const m of ms){
      const i=match.get(m),unique=ms.length===1||(!equivalent&&!pairing(ms,[m,i]));
      if(unique){hits[m]={i,w:sourceWindows[i],method:'unique'};used.add(i);reasons[m]='';}
      else if(equivalent){hits[m]={i,w:{...sourceWindows[i],id:''},method:'equivalent',sourceIndices:[...ss]};used.add(i);reasons[m]='';}
      else reasons[m]='MULTIPLE_DIFFERENT_CONDITIONS';
    }
  });
  return {hits,used,reasons};
}
function atClearSourceDoors(mesh){
  (mesh?.meshFaces||[]).forEach(f=>{
    if(!f.atSourceDoor)return;
    f.sslKey=f.atSourceDoor.originalKey;f.nameJa=f.atSourceDoor.originalName;
    delete f.atSourceDoor;
  });
}
function atReconcileSourceDoors(mesh,data){
  atClearSourceDoors(mesh);
  if(typeof atAssignWindowsToRooms!=='function')return {count:0};
  const wins=atAssignWindowsToRooms(mesh.meshFaces,mesh.rooms,mesh.stats),source=data?.windows||[];
  const doors=(data?.csvBoundaryRows||[]).filter(r=>['ドア','外部ドア'].includes(r.part)&&r.adjacent==='外気'&&csvFloor(r.floor)&&r.width>0&&r.height>0&&r.area>0&&Math.abs(r.width*r.height-r.area)<=Math.max(.01,r.area*.005));
  const candidates=doors.map(d=>wins.filter(w=>{
    if(atPdfWindowCandidates(w,source).length||csvFloor(w.floor)!==csvFloor(d.floor))return false;
    if(d.az!==null&&d.az!==undefined&&Math.abs(((w.az-d.az+540)%360)-180)>22.5)return false;
    const v=w.face.verts||[];if(v.length<3)return false;
    const h=Math.max(...v.map(p=>p.z))-Math.min(...v.map(p=>p.z));let width=0;
    for(const a of v)for(const b of v)width=Math.max(width,Math.hypot(a.x-b.x,a.y-b.y));
    return Math.abs(h-d.height)<=.015&&Math.abs(width-d.width)<=.015&&Math.abs(w.area-d.area)<=Math.max(.005,d.area*.003);
  }));
  let count=0;
  candidates.forEach((list,i)=>{
    if(list.length!==1)return;
    const w=list[0];if(candidates.some((other,j)=>j!==i&&other.includes(w)))return;
    const orient=typeof at3dsOrientFromToolAz==='function'?at3dsOrientFromToolAz(w.az):w.orient;
    if(w.face.atOriginalKey===undefined){w.face.atOriginalKey=w.face.sslKey;w.face.atOriginalName=w.face.nameJa;}
    w.face.atSourceDoor={originalKey:w.face.sslKey,originalName:w.face.nameJa,sourceRow:doors[i].sourceRow};
    w.face.sslKey='extdoor_'+orient;w.face.nameJa='ドア';count++;
  });
  return {count};
}
function applyArchitrendMeshRooms(result){
  if(typeof atMesh==='undefined' || !atMesh || !(atMesh.rooms||[]).length) return false;
  const sourceDoors=atReconcileSourceDoors(atMesh,result);
  if(typeof atPlanRoomMatches!=='function'&&!result?.planRoomPages?.length&&typeof atMergeRoomsByPdf==='function'){
    atMesh.rooms=atMergeRoomsByPdf(atMesh.rooms, (result && result.rooms)||[], atMesh.meshFaces);
  }
  atMatchMeshRoomsToPdf(atMesh.rooms, (result && result.rooms)||[]);
  if(typeof atPlanStairsForMesh==='function') atPlanStairsForMesh(atMesh);
  if(typeof atApplyRoomGainFlags==='function') atApplyRoomGainFlags(atMesh);
  const gainRooms=(atMesh.rooms||[]).filter(function(r){ return r.keep || r.habitable; });
  atAssignableRooms=gainRooms.map(function(r){
    return Object.assign({}, r, {habitable:!!r.habitable});
  });
  document.querySelectorAll('.room-card').forEach(function(el){ el.remove(); });
  if(typeof roomCount!=='undefined') roomCount=0;
  if(typeof winCounter!=='undefined') winCounter=0;
  const idByKey={};
  gainRooms.forEach(function(r){
    idByKey[r.key]=atAddRoomCardFromMesh(r);
  });
  const meshWins=(typeof atAssignWindowsToRooms==='function')
    ? atAssignWindowsToRooms(atMesh.meshFaces, atMesh.rooms, atMesh.stats)
    : [];
  const pdfWins=(result && result.windows)||[];
  const matching=atMatchWindowSet(meshWins,pdfWins),usedPdf=matching.used;
  atMesh.windowMatchSource=result;
  atMesh.windowMatchSummary={sourceDoors:sourceDoors.count,unique:matching.hits.filter(h=>h?.method==='unique').length,equivalent:matching.hits.filter(h=>h?.method==='equivalent').length,sourceRemaining:pdfWins.length-usedPdf.size,modelRemaining:matching.hits.filter(h=>!h).length,solarMissing:matching.hits.filter(h=>!h||h.w.eta==null).length};
  atNorthExcludedCount=0;
  atUnassignedWindows=[];
  meshWins.forEach(function(mw, meshWinIndex){
    const hit=matching.hits[meshWinIndex];
    const pdf=hit ? hit.w : null;
    if(hit) usedPdf.add(hit.i);
    const az=isFinite(mw.az) ? mw.az : (pdf && pdf.az!=null ? pdf.az : (typeof AT_AZ!=='undefined' ? AT_AZ[mw.orient] : 0));
    const roomKey=mw.roomKey && idByKey[mw.roomKey] ? mw.roomKey : '';
    const roomId=roomKey ? idByKey[roomKey] : '';
    const w={
      wName: pdf && pdf.id ? pdf.id : ('窓'+(mw.orient||'')+' '+(mw.floor||'')+'F-'+(meshWinIndex+1)),
      wAz: az==null ? '' : String(az),
      wEta: pdf && pdf.eta!=null ? String(pdf.eta) : '',
      wArea: pdf && pdf.area!=null ? String(pdf.area) : String(Math.round((mw.area||0)*100)/100),
      wU:pdf&&pdf.u>0?String(pdf.u):result.uWin>0?String(result.uWin):'',
      matchReason:matching.reasons[meshWinIndex],
      glassSel:'0', attachSel:'0',
      atMeshWindowIndex:String(meshWinIndex),
      atFaceId:String(mw.face.atFaceId),
      roofLike: mw.floor==='R'
    };
    if(roomId && w.wArea!==''){
      addWindow(roomId, Object.assign({skipRerun:true}, w));
    }else{
      atUnassignedWindows.push(w);
    }
  });
  pdfWins.forEach(function(w, i){
    if(usedPdf.has(i)) return;
    atUnassignedWindows.push({
      wName:w.id, wAz:w.az==null?'':String(w.az), wEta:w.eta==null?'':String(w.eta),
      wArea:w.area==null?'':String(w.area), glassSel:'0', attachSel:'0', roofLike:!!w.roofLike
      ,wU:w.u>0?String(w.u):result.uWin>0?String(result.uWin):'',matchReason:'SOURCE_UNRESOLVED',atSourceWindowIndex:String(i),
      candidateRoomKeys:[...new Set(meshWins.filter(mw=>atPdfWindowCandidates(mw,[w]).length).map(mw=>mw.roomKey).filter(Boolean))]
    });
  });
  renderUnassignedWindows();
  if(typeof atSyncMeshWindowsToRooms==='function') atSyncMeshWindowsToRooms();
  if(typeof atBuildGainVolumes==='function'){
    atMesh.gainVolumes=atBuildGainVolumes(atMesh);
  }
  if(typeof atUpdateRoomVolume==='function') atUpdateRoomVolume();
  if(typeof atRenderRoomViewer==='function') atRenderRoomViewer();
  return true;
}

function applyArchitrendParse(parsed){
  const {result, warnings} = parsed;
  blankForArchitrend();

  const filled = [];
  function setVal(id, v){
    if(v==null || Number.isNaN(v)) return;
    const el = document.getElementById(id);
    if(!el) return;
    el.value = (typeof v === 'number') ? String(v) : v;
    markAtFilled(id, true);
    filled.push(id);
  }

  setVal('uaVal', result.ua);
  setVal('envArea', result.envArea);
  setVal('uRoof', result.uRoof);
  setVal('uWall', result.uWall);
  setVal('uFloor1', result.uFloor);
  setVal('uFound', result.uFound);
  setVal('uWin', result.uWin);
  setVal('uDoor', result.uDoor);
  if(result.projectLocation) setVal('siteAddress',result.projectLocation);

  atAssignableRooms=(result.rooms||[]).map((r,i)=>Object.assign({},r,{
    key:'at-room-'+i, habitable:isHabitableRoomName(r.name)
  }));
  if(typeof applyArchitrendMeshRooms==='function' && typeof atMesh!=='undefined' && atMesh && (atMesh.rooms||[]).length){
    applyArchitrendMeshRooms(result);
  }else{
    const rooms = result.habitableRooms || result.rooms.filter(r=>isHabitableRoomName(r.name));
    const usedCandidateKeys=new Set();
    rooms.forEach(r=>{
      const candidate=atAssignableRooms.find(c=>!usedCandidateKeys.has(c.key) &&
        c.name===r.name && Math.abs((c.area||0)-(r.area||0))<0.01);
      if(candidate) usedCandidateKeys.add(candidate.key);
      addRoom({
        name: r.name,
        atRoomKey:candidate?candidate.key:'',
        isNonHabitable:!isHabitableRoomName(r.name),
        fields:{
          roomArea: r.area>0?String(r.area):'',
          occCount: isHabitableRoomName(r.name)?'':'0'
        },
        windows: []
      });
      const cards = document.querySelectorAll('.room-card');
      const card = cards[cards.length-1];
      if(card){
        const areaEl = card.querySelector('.roomArea');
        if(areaEl){
          const wrap = areaEl.closest('div');
          if(wrap) wrap.classList.add('at-filled');
        }
      }
    });
    atNorthExcludedCount=0;
    atUnassignedWindows = result.windows.map((w,i)=>({
      atSourceWindowIndex:String(i),
      wName: w.id,
      wAz: w.az==null ? '' : String(w.az),
      wEta: w.eta==null ? '' : String(w.eta),
      wArea: w.area==null ? '' : String(w.area),
      wU:result.uWin>0?String(result.uWin):w.u>0?String(w.u):'',
      glassSel: '0',
      attachSel: '0',
      roofLike: !!w.roofLike
    }));
    renderUnassignedWindows();
  }

  parsed.applied=true;
  renderArchitrendReview(parsed,true);
  applySharedToolDefaults();
  runAll();
  refreshNeedManual();
  window.dispatchEvent(new CustomEvent('architrend-input-applied'));
}

let atWindowActionNotice=null,atWindowActionSerial=0;
if(typeof window!=='undefined'&&window.addEventListener)for(const event of ['architrend-import-invalidated','architrend-model-invalidated'])window.addEventListener(event,()=>{atWindowActionNotice=null;});
function renderUnassignedWindows(){
  const box = document.getElementById('atUnassignedBox');
  const list = document.getElementById('atUnassignedList');
  const summary=document.getElementById('atWindowMatchSummary'),report=typeof atMesh!=='undefined'&&atMesh?.windowMatchSource===atLastParse?.result&&atMesh?.windowMatchSummary;
  if(summary){summary.hidden=!(report&&appMode==='architrend');summary.textContent=report?'窓の自動照合：番号の対応が確定 '+report.unique+'枚 ／ 同じ性能のまとまりで対応 '+report.equivalent+'枚 ／ 資料の未対応 '+report.sourceRemaining+'枚 ／ 3DS側の資料未対応 '+report.modelRemaining+'枚 ／ CSVの寸法でドアと確認 '+(report.sourceDoors||0)+'面。同じ性能で対応した窓は、部屋を3DS位置から決めています。資料の窓番号は未特定です。'+(report.solarMissing?' 日射の入りやすさ（η0）が未取得の窓は、部屋の窓欄で確認してください。':''):'';}
  const northInfo=document.getElementById('atNorthExcludedInfo');
  if(northInfo) northInfo.textContent=' 3DS読込時はビューワーの北方向から方位角を更新します。';
  if(typeof appMode!=='undefined' && appMode!=='architrend'){
    if(box) box.style.display = 'none';
    if(list) list.innerHTML = '';
    return;
  }
  if(!atUnassignedWindows.length&&!atWindowActionNotice){
    if(box) box.style.display = 'none';
    if(list) list.innerHTML = '';
    return;
  }
  box.style.display = 'block';
  const roomChoices=[];
  const existingKeys=new Set();
  document.querySelectorAll('.room-card').forEach(card=>{
    if(card.dataset.atRoomKey) existingKeys.add(card.dataset.atRoomKey);
    roomChoices.push({key:card.dataset.atRoomKey,value:card.id,html:'<option value="'+card.id+'">'+escapeHtml(card.querySelector('.roomName').value)+
      (card.dataset.nonHabitable==='true'?' (非居室)':'')+'</option>'});
  });
  atAssignableRooms.forEach((room,i)=>{
    if(existingKeys.has(room.key)) return;
    roomChoices.push({key:room.key,value:'candidate:'+i,html:'<option value="candidate:'+i+'">'+escapeHtml(room.name)+
      (room.habitable?'':' (非居室・選択時に自動作成)')+'</option>'});
  });
  const rows=atUnassignedWindows.map((w,i)=>{
    if(!w.actionKey){do{w.actionKey='window-'+(++atWindowActionSerial);}while(atUnassignedWindows.some(other=>other!==w&&other.actionKey===w.actionKey));}
    const candidates=new Set(w.candidateRoomKeys||[]),suggested=roomChoices.filter(c=>candidates.has(c.key)),other=roomChoices.filter(c=>!candidates.has(c.key));
    const roomOpts=['<option value="">部屋を選択...</option>',...(suggested.length?['<optgroup label="階・方位・寸法が合う窓のある部屋（要確認）">',...suggested.map(c=>c.html),'</optgroup><optgroup label="その他の部屋">',...other.map(c=>c.html),'</optgroup>']:other.map(c=>c.html))];
    const reason=w.matchReason==='SOURCE_UNRESOLVED'?'資料と3DSの対応が未確定です。枚数・階・方位・寸法と、仕様の違いを確認してください。':w.matchReason?'対応する資料を確定できません。階・方位・寸法、同じ窓の枚数と性能を確認してください。':'窓に接する部屋を確定できません。図の部屋割りを確認してください。';
    return '<div class="at-unassigned-row" data-boundary-action="'+escapeHtml(w.actionKey)+'" data-idx="'+i+'">'+'<p class="small" style="grid-column:1/-1">'+reason+'</p>'+
      '<div class="'+(w.wName?'at-filled':'need-manual')+'"><label>名前</label><input type="text" class="uName" value="'+escapeHtml(w.wName||'')+'"></div>'+
      '<div class="'+(w.wAz===''?'need-manual':'at-filled')+'"><label>方位角</label><input type="number" class="uAz" value="'+w.wAz+'" step="1"></div>'+
      '<div class="'+(w.wEta===''?'need-manual':'at-filled')+'"><label>η0</label><input type="number" class="uEta" value="'+w.wEta+'" step="0.01"></div>'+
      '<div class="'+(w.wArea===''?'need-manual':'at-filled')+'"><label>面積</label><input type="number" class="uArea" value="'+w.wArea+'" step="0.01"></div>'+
      '<div class="'+(Number(w.wU)>0?'at-filled':'need-manual')+'"><label>U W/m²K</label><input type="number" class="uU" value="'+escapeHtml(w.wU||'')+'" step="0.01" min="0"></div>'+
      '<div class="need-manual"><label>割当先部屋</label><select class="uRoom">'+roomOpts.join('')+'</select></div>'+
      '<div class="boundary-action-bar" style="grid-column:1/-1"><p class="boundary-action-status" data-window-action-status role="status" aria-live="polite">この窓を選んだ部屋へ割り当てます。</p><button type="button" data-assign-window="'+escapeHtml(w.actionKey)+'" onclick="assignUnassignedWindow('+i+')">この窓を部屋へ反映する</button></div>'+
    '</div>';
  });
  if(atWindowActionNotice)rows.splice(Math.min(atWindowActionNotice.index,rows.length),0,'<div class="at-unassigned-notice boundary-action-bar" data-boundary-action="'+escapeHtml(atWindowActionNotice.key)+'"><p class="boundary-action-status" data-state="applied" role="status" aria-live="polite">'+escapeHtml(atWindowActionNotice.text)+'</p></div>');
  list.innerHTML=rows.join('')+'<p class="small">同じ階・方位・寸法で、性能・仕様が一致し枚数もそろう窓はまとめて自動対応します。性能が異なる候補や枚数が合わない窓は、確認が必要です。</p>';
  list.querySelectorAll('.at-unassigned-row').forEach(row=>{const w=atUnassignedWindows[+row.dataset.idx],select=row.querySelector('.uRoom');select.value=(w.roomChoiceKey&&roomChoices.find(c=>c.key===w.roomChoiceKey)?.value)||w.roomChoice||'';});
}

function syncUnassignedFromDom(){
  document.querySelectorAll('#atUnassignedList .at-unassigned-row').forEach(row=>{
    const i = +row.dataset.idx;
    if(!atUnassignedWindows[i]) return;
    atUnassignedWindows[i].wName = row.querySelector('.uName').value;
    atUnassignedWindows[i].wAz = row.querySelector('.uAz').value;
    atUnassignedWindows[i].wEta = row.querySelector('.uEta').value;
    atUnassignedWindows[i].wArea = row.querySelector('.uArea').value;
    atUnassignedWindows[i].wU = row.querySelector('.uU').value;
    const value=row.querySelector('.uRoom').value;
    atUnassignedWindows[i].roomChoice=value;
    atUnassignedWindows[i].roomChoiceKey=value.startsWith('candidate:')?atAssignableRooms[+value.split(':')[1]]?.key||'':document.getElementById(value)?.dataset.atRoomKey||'';
  });
}

function assignUnassignedWindow(idx){
  syncUnassignedFromDom();
  const row = document.querySelector('#atUnassignedList .at-unassigned-row[data-idx="'+idx+'"]');
  if(!row) return;
  const roomChoice = row.querySelector('.uRoom').value;
  const fail=text=>window.boundaryActionMessage?.(row.querySelector('[data-window-action-status]'),text,'error');
  if(!roomChoice){ fail('未反映：割当先の部屋を選んでください。'); return; }
  const w = atUnassignedWindows[idx];
  if(!w) return;
  if(w.wAz==='' || w.wEta==='' || w.wArea===''){
    fail('未反映：方位角・η0・面積を入力してください。');
    return;
  }
  let roomId=roomChoice;
  if(roomChoice.startsWith('candidate:')){
    const candidate=atAssignableRooms[+roomChoice.split(':')[1]];
    if(!candidate){ fail('未反映：部屋の情報を取得できません。割当先を選び直してください。'); return; }
    const isNonHabitable=!candidate.habitable;
    const fields={
      roomArea:String(candidate.area||''),
      occCount:isNonHabitable?'0':''
    };
    if(isNonHabitable){
      fields.peopleSensRate='0';
      fields.peopleMoistRate='0';
      fields.equipSensRate='0';
      fields.equipMoistRate='0';
    }
    roomId=addRoom({
      name:candidate.name, atRoomKey:candidate.key, isNonHabitable, fields, windows:[]
    });
  }
  addWindow(roomId, {
    wName: w.wName,
    wAz: w.wAz,
    wEta: w.wEta,
    wArea: w.wArea,
    wU: w.wU||(document.getElementById('uWin') && document.getElementById('uWin').value) || '',
    glassSel: w.glassSel||'0',
    attachSel: w.attachSel||'0',
    atMeshWindowIndex:w.atMeshWindowIndex,
    atFaceId:w.atFaceId
  });
  atWindowActionNotice={index:idx,key:w.actionKey,text:'反映済み：'+(w.wName||'この窓')+' → '+document.getElementById(roomId).querySelector('.roomName').value+'。部屋の窓欄に追加しました。'};
  atUnassignedWindows.splice(idx, 1);
  renderUnassignedWindows();
  runAll();
  refreshNeedManual();
}

function architrendEnvelopeHints(data){
  if(!data)return {};
  const hints={},specs=data.envelopeSpecifications||[],required=data.csvDiagnostics?.requiredManual||[];
  for(const [part,id,target] of [['外壁','uWall','wall'],['屋根','uRoof','roof']]){
    const rows=specs.filter(s=>s.part===part),problem=required.find(p=>p.target===target&&p.code==='MULTIPLE_SPECS');
    if(rows.length>1||problem){
      const groups=problem?.groups||[];
      const values=rows.length>=groups.length?rows.map(s=>s.u):groups.map(g=>g.u>0?g.u:g.area>0?g.heatLoss/g.area:null);
      hints[id]={kind:'multiple',target,status:'仕様別に設定',text:part+'は'+values.length+'種類の仕様を取得しています（'+values.map((u,i)=>'仕様'+(i+1)+': '+(u>0?'U='+u.toFixed(3):'U値を確認')).join(' ／ ')+'）。共通の1値にはまとめません。下のボタンを開き、対象の面と使う仕様を確認してください。'};
    }
  }
  const ceilings=(data.csvBoundaryRows||[]).filter(r=>r.part==='天井'),roofRows=(data.csvBoundaryRows||[]).filter(r=>r.part==='屋根');
  const ceilingU=data.uCeiling>0?data.uCeiling:ceilings.length&&ceilings.every(r=>r.area>0&&r.heatLoss>0)&&new Set(ceilings.map(r=>r.spec)).size===1?ceilings.reduce((s,r)=>s+r.heatLoss,0)/ceilings.reduce((s,r)=>s+r.area,0):null;
  if(!hints.uRoof&&!(data.uRoof>0)&&!roofRows.length&&!specs.some(s=>s.part==='屋根')&&ceilingU>0){
    hints.uRoof={kind:'ceiling',target:'ceiling',status:'天井の性能を取得',text:'資料の天井U値は '+ceilingU.toFixed(3)+' W/m²K です。屋根U値の記載は確認できませんでした。「小屋裏に接する天井」で断熱材の位置を確認して設定してください。天井の値を屋根の欄へ移す必要はありません。'};
  }
  if(data.uDoor>0)hints.uDoor={kind:'source',text:'取得した外部扉のU値: '+data.uDoor.toFixed(3)+' W/m²K（'+(data.sources?.uDoor||'読込資料')+'）。熱損失 W/K とは別の値です。'};
  return hints;
}
function architrendCsvUaEstimate(data){
  const rows=data?.csvBoundaryRows||[],windows=data?.windows||[],diag=data?.csvDiagnostics;
  if(!(data?.envArea>0)||!rows.length||diag?.blocking||diag?.rows?.some(r=>['UNKNOWN_PART','ENVELOPE_VALUE','ADJACENCY_MISSING'].includes(r.code)))return null;
  const foundation=rows.some(r=>r.part==='基礎'&&r.heatLoss>=0&&r.heatLoss!==null);
  // A floor handled by foundation linear transmittance has no separate Q.
  // This is an explicit estimate, never a replacement for the reported UA.
  const losses=rows.filter(r=>!(r.part==='床'&&r.heatLoss===null&&foundation)).concat(windows);
  if(!losses.length||losses.some(r=>r.heatLoss===null||r.heatLoss===undefined||!Number.isFinite(r.heatLoss)||r.heatLoss<0))return null;
  const heatLoss=losses.reduce((s,r)=>s+r.heatLoss,0),ua=heatLoss/data.envArea;
  return ua>0&&ua<=5?{ua:Math.ceil(ua*100-1e-10)/100,unrounded:ua,heatLoss,area:data.envArea}:null;
}
function architrendUseCsvUaEstimate(){
  const estimate=architrendCsvUaEstimate(atLastParse?.result),input=document.getElementById('uaVal');if(!estimate||!input)return;
  input.value=String(estimate.ua);atLastParse.result.uaEstimateApplied=estimate;
  runAll();saveStateNow();
}
function refreshArchitrendUaRepair(){
  const box=document.getElementById('atUaRepair'),input=document.getElementById('uaVal');if(!box||!input)return;
  const data=typeof appMode!=='undefined'&&appMode==='architrend'?atLastParse?.result:null,estimate=architrendCsvUaEstimate(data);
  const bad=!input.value||Number(input.value)>5,used=data?.uaEstimateApplied&&Number(input.value)===data.uaEstimateApplied.ua;
  box.hidden=!estimate||!bad&&!used;if(box.hidden)return;
  box.querySelector('p').textContent=(used?'CSVからの概算を使用中です。':'UAの読取値を確認してください。全入力をやり直さず、この欄だけ補えます。')+' 熱損失合計 '+estimate.heatLoss.toFixed(2)+' W/K ÷ 外皮面積 '+estimate.area.toFixed(2)+' m² → UA概算 '+estimate.ua.toFixed(2)+' W/m²K（小数第2位に切り上げ）。資料のUA値が分かる場合は、その値を入力してください。';
  box.querySelector('button').hidden=!!used;
}
function refreshArchitrendEnvelopeHints(){
  refreshArchitrendUaRepair();
  const hints=typeof appMode!=='undefined'&&appMode==='architrend'?architrendEnvelopeHints(atLastParse?.result):{};
  for(const id of ['uWall','uRoof','uDoor']){
    const el=document.getElementById(id),note=document.getElementById(id+'Hint'),status=document.getElementById(id+'Status');
    if(!el||!note)continue;
    const hint=hints[id],wrap=el.closest('div');
    note.hidden=!hint;if(hint)note.querySelector('p').textContent=hint.text;
    let applied=note.querySelector('[data-envelope-applied]');
    if(!applied){applied=document.createElement('div');applied.dataset.envelopeApplied='';applied.className='at-envelope-applied';applied.setAttribute('role','status');note.prepend(applied);}
    applied.hidden=!hint||hint.kind==='source';
    const summary=hint?.target&&window.boundaryThermalSummary?.(hint.target);
    if(summary){
      applied.dataset.ready=String(summary.ready&&!summary.pendingDraft);
      applied.textContent=summary.missing?'未設定：モデルと対象の面を確認してください。':summary.pendingDraft?'変更を反映していません（現在の設定済み '+summary.assigned+' / '+summary.total+'面）':summary.ready?'設定済み：'+summary.assigned+' / '+summary.total+'面':'未設定の面があります：'+summary.assigned+' / '+summary.total+'面を設定済み';
      if(summary.ready)applied.textContent+='。現在の設定：'+summary.settings.map(s=>'U='+s.u.toFixed(3)+(s.temperature!==null&&s.temperature!==undefined?'・上側温度 '+s.temperature.toFixed(1)+'℃':'')+'（'+s.count+'面）').join(' ／ ');
    }else if(hint&&hint.kind!=='source')applied.textContent='未設定：設定内容を確認してください。';
    const button=note.querySelector('button');if(button&&hint){
      button.setAttribute('onclick',"architrendShowThermal('"+hint.target+"')");
      button.textContent=(summary?.ready?'現在の設定を確認・変更する':'ここで設定する');
    }
    if(status){status.hidden=!hint;status.textContent=hint?.status||'';}
    wrap?.classList.toggle('at-envelope-guided',!!hint&&hint.kind!=='source');
    el.readOnly=hint?.kind==='multiple';
    el.placeholder=hint?.kind==='multiple'?'仕様ごとに設定します':hint?.kind==='ceiling'?'天井の設定をご確認ください':'';
  }
  refreshArchitrendThermalDialogStatus();
  return hints;
}
let atThermalDialogReturn=null;
function refreshArchitrendThermalDialogStatus(){
  const dialog=document.getElementById('atThermalDialog');if(!dialog?.open)return;
  const summary=window.boundaryThermalSummary?.(dialog.dataset.target),status=document.getElementById('atThermalDialogStatus');if(!summary||!status)return;
  status.textContent=summary.missing?'対象の面を確認できません。3DSモデルの読込と部位分類を確認してください。':summary.pendingDraft?'変更した入力はまだ反映していません。下の「この設定を使う／反映する」ボタンを押してください。':summary.ready?'設定済み：'+summary.assigned+' / '+summary.total+'面。このまま閉じても設定は保存されます。':'設定済み '+summary.assigned+' / '+summary.total+'面。条件を選び、反映ボタンを押してください。';
  status.dataset.ready=String(summary.ready&&!summary.pendingDraft);
}
function architrendCloseThermal(){document.getElementById('atThermalDialog')?.close();}
function architrendShowThermal(target){
  const host=document.getElementById('atThermalReview'),dialog=document.getElementById('atThermalDialog');if(!host||!dialog||dialog.open)return;
  const button=document.activeElement,rect=host.getBoundingClientRect(),placeholder=document.createElement('div');
  placeholder.style.height=rect.height+'px';placeholder.style.margin=getComputedStyle(host).margin;host.before(placeholder);
  atThermalDialogReturn={placeholder,button,top:button?.getBoundingClientRect().top,scrollY:window.scrollY};
  dialog.dataset.target=target;document.getElementById('atThermalDialogTitle').textContent=target==='ceiling'?'天井・小屋裏の設定':target==='roof'?'屋根の設定':'外壁の設定';
  document.getElementById('atThermalDialogBody').append(host);host.hidden=false;dialog.showModal();
  refreshArchitrendThermalDialogStatus();
  if(!dialog.dataset.bound){
    dialog.dataset.bound='true';dialog.addEventListener('close',()=>{
      const back=atThermalDialogReturn;atThermalDialogReturn=null;if(!back)return;
      back.placeholder.replaceWith(host);back.button?.focus({preventScroll:true});
      if(back.button?.isConnected)window.scrollBy({top:back.button.getBoundingClientRect().top-back.top,behavior:'instant'});else window.scrollTo({top:back.scrollY,behavior:'instant'});
      saveStateNow();
    });
  }
}
function refreshNeedManual(){
  const envelopeHints=refreshArchitrendEnvelopeHints();
  if(appMode !== 'architrend'){
    document.getElementById('atRemainInfo').style.display = 'none';
    document.querySelectorAll('.need-manual').forEach(el=>{
      if(!el.closest('#atUnassignedBox') && !el.closest('#atUnassignedList')) el.classList.remove('need-manual');
    });
    return;
  }
  let remain = 0;
  AT_MANUAL_IDS.forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    const wrap = el.closest('div') || el.parentElement;
    const empty = el.value==='' || el.value==null;
    const guided=!!envelopeHints[id]&&envelopeHints[id].kind!=='source';
    wrap.classList.toggle('need-manual', empty&&!guided);
    if(!empty) wrap.classList.add('at-filled');
    else wrap.classList.remove('at-filled');
    // PDF由来でない共通条件などは埋まっても AT にしない
    if(['calcDate','detailHour','lat','lon','tmax','tmin','tpeak','targetT','roomVol','ach','hxRate','acMax','acCount'].includes(id) &&
       !(id==='roomVol' && el.dataset.at3dsAuto==='true')){
      wrap.classList.remove('at-filled');
    }
    if(empty&&!guided) remain++;
  });
  document.querySelectorAll('.room-card').forEach(card=>{
    ['occCount','roomArea'].forEach(cls=>{
      const el = card.querySelector('.'+cls);
      if(!el) return;
      const wrap = el.closest('div') || el.parentElement;
      const empty = el.value==='';
      // roomArea が AT で埋まっている場合は要手動にしない
      if(cls==='roomArea' && el.value!==''){
        wrap.classList.remove('need-manual');
        return;
      }
      wrap.classList.toggle('need-manual', empty);
      if(empty) remain++;
    });
    card.querySelectorAll('.win-row').forEach(w=>{
      ['wAz','wEta','wArea'].forEach(cls=>{
        const el = w.querySelector('.'+cls);
        if(!el) return;
        const wrap = el.closest('div') || el.parentElement;
        const empty = el.value==='';
        wrap.classList.toggle('need-manual', empty);
        if(empty) remain++;
      });
    });
  });
  remain += atUnassignedWindows.length;
  const data=atLastParse?.result,required=data?.csvDiagnostics?.requiredManual||[];
  const thermalPending=required.length>0&&typeof window.boundaryThermalReadiness==='function'&&!window.boundaryThermalReadiness(required,data).ready;
  const info = document.getElementById('atRemainInfo');
  info.style.display = 'inline';
  info.textContent = remain>0
    ? ('要手動 残 '+remain+' 件')
    : thermalPending?'断熱の設定・反映を確認':'連携入力完了';
  info.style.color = remain>0||thermalPending ? 'var(--heat)' : 'var(--ink2)';
}

function rebuildArchitrendPreview(){
  const merged=mergeArchitrendSources(atCsvParse,atPdfParse);
  if(!merged) return;
  atLastParse=merged;
  merged.applied=false;
  const diagnostics=merged.result.csvDiagnostics;
  atImportState={status:diagnostics&&diagnostics.blocking?'invalid':'ready',codes:diagnostics?diagnostics.rows.filter(r=>r.severity==='error').map(r=>r.code):[]};
  renderArchitrendReview(merged,false);
  window.dispatchEvent(new CustomEvent('architrend-data-ready'));
}

async function readCsvFile(file){
  if(/\.(?:xlsx|xls|xlsm)$/i.test(file.name||'')){
    if(typeof window.boundaryReadXlsxCsv!=='function'){
      const error=new Error('Excelの読込機能を利用できません。ページを再読み込みしてください。');error.code='XLSX_READER_UNAVAILABLE';throw error;
    }
    return window.boundaryReadXlsxCsv(file);
  }
  const buffer=await file.arrayBuffer();
  const bytes=new Uint8Array(buffer);
  if(bytes[0]===0xFF&&bytes[1]===0xFE)return new TextDecoder('utf-16le',{fatal:true}).decode(buffer);
  if(bytes[0]===0xFE&&bytes[1]===0xFF)return new TextDecoder('utf-16be',{fatal:true}).decode(buffer);
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}
  catch(err){return new TextDecoder('shift_jis',{fatal:true}).decode(buffer);}
}

function invalidateArchitrendImport(source,status='loading',codes=[]){
  const replacing=source==='csv'?!!atCsvParse:!!atPdfParse;
  if(source==='csv'||replacing)atCsvParse=null;
  if(source==='pdf'||replacing)atPdfParse=null;
  atLastParse=null;atUnassignedWindows=[];atAssignableRooms=[];
  if(appMode==='architrend'){
    const rooms=document.getElementById('roomsWrap');if(rooms)rooms.innerHTML='';
    if(typeof roomCount!=='undefined')roomCount=0;
    if(typeof winCounter!=='undefined')winCounter=0;
    AT_BLANK_IDS.concat(['uFloor1','siteAddress']).forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    if(typeof atMesh!=='undefined'&&atMesh){
      atClearSourceDoors(atMesh);
      (atMesh.rooms||[]).forEach(r=>{r.name='';r.pdfIndex=null;r.pdfArea=null;r.pdfType='';r.manualAssignment=false;r.habitable=false;r.keep=false;r.reviewed=false;r.mergedPdfIndices=[];r.mergedPdfRefs=[];r.explicitGainTarget=false;delete r.pdfMatch;delete r.pdfMatchCandidates;delete r.roomMatch;delete r.roomMatchGroup;delete r.matchSource;});
      atMesh.gainVolumes=null;
      atMesh.roomMatchPlan=null;
      if(typeof atSetProjectedFloorSources==='function')atSetProjectedFloorSources(atMesh,null);
    }
    if(typeof atRoomView!=='undefined'){atRoomView.pending=null;atRoomView.catalog=[];atRoomView.restored=false;atRoomView.undo=[];}
    if(typeof renderUnassignedWindows==='function')renderUnassignedWindows();
  }
  atImportState={status,codes};
  refreshArchitrendEnvelopeHints();
  const review=document.getElementById('atReview');if(review)review.innerHTML='';
  if(typeof window.dispatchEvent==='function'&&typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('architrend-import-invalidated',{detail:{source,status,codes}}));
  return ++atImportSequence;
}

function failArchitrendImport(source,codes,message){
  atImportState={status:'invalid',codes};
  atLastParse=null;
  refreshArchitrendEnvelopeHints();
  const summary=document.getElementById('atSummary');if(summary)summary.innerHTML='<div class="warn">'+escapeHtml(message)+'</div>';
  if(typeof window.dispatchEvent==='function'&&typeof CustomEvent==='function')window.dispatchEvent(new CustomEvent('architrend-import-invalidated',{detail:{source,status:'invalid',codes}}));
}

async function onAtCsvSelected(input){
  const file=input.files&&input.files[0];
  const sequence=invalidateArchitrendImport('csv',file?'loading':'empty');
  if(!file)return;
  const excel=/\.(?:xlsx|xls|xlsm)$/i.test(file.name||'');
  try{
    document.getElementById('atSummary').innerHTML='<p class="small">'+(excel?'Excel':'CSV')+'を読み込み中...</p>';
    const text=await readCsvFile(file);
    if(sequence!==atImportSequence)return;
    const parsed=parseArchiTrendCsv(text);
    if(parsed.status==='invalid'){
      failArchitrendImport('csv',parsed.result.csvDiagnostics.rows.filter(r=>r.severity==='error').map(r=>r.code),parsed.warnings.join(' / '));
      return;
    }
    if(excel){parsed.result.inputSources.xlsx=true;parsed.result.notes.push('Excel (.xlsx) の外皮表を読み込みました。CSVへ保存し直す必要はありません。');}
    atCsvParse=parsed;
    rebuildArchitrendPreview();
  }catch(err){
    if(sequence===atImportSequence){
      const known=excel&&/^XLSX_[A-Z_]+$/.test(err?.code||'');
      failArchitrendImport('csv',[known?err.code:excel?'XLSX_READ_FAILED':'CSV_READ_FAILED'],known?err.message:excel?'Excelを読み取れませんでした。外皮の表を含む .xlsx ファイルを選んでください。':'CSVを読み取れませんでした。文字コード・形式を確認してください。');
    }
  }
}

async function onAtPdfSelected(input){
  const files=Array.from(input.files||[]);
  const sequence=invalidateArchitrendImport('pdf',files.length?'loading':'empty');
  if(!files.length)return;
  if(!window.pdfjsLib){
    failArchitrendImport('pdf',['PDF_READER_UNAVAILABLE'],'PDF読込機能を利用できません。ローカル配布ファイルを確認してください。');
    return;
  }
  if(files.length>16){failArchitrendImport('pdf',['PDF_SET_LIMIT'],'一度に選べるPDFは16件までです。同じ物件の性能表・平面図を選び直してください。');return;}
  if(typeof window.boundaryCombineArchitrendPdfs!=='function'){failArchitrendImport('pdf',['PDF_SET_READER_UNAVAILABLE'],'PDFのまとめ読込機能を利用できません。ページを再読み込みしてください。');return;}
  try{
    const documents=[];
    document.getElementById('atReview').innerHTML='';
    for(let i=0;i<files.length;i++){
      document.getElementById('atSummary').innerHTML='<p class="small">PDF '+(i+1)+' / '+files.length+' を読み込み中...</p>';
      const extracted=await extractPdfText(files[i]);
      if(sequence!==atImportSequence)return;
      const parsed=parseArchiTrendText(extracted.full,extracted.pages),assessment=architrendPdfAssessment(extracted,parsed);
      if(assessment.lowTextPages.length)parsed.warnings.push(assessment.lowTextPages.join('・')+'ページは読み取れる文字が少ないため、画像内の図面・表を手動で確認してください。取得できた値だけを反映します。');
      documents.push({parsed,assessment});
    }
    if(sequence!==atImportSequence)return;
    const combined=window.boundaryCombineArchitrendPdfs(documents,{isLiving:isArchitrendLivingRoom});
    if(!combined.ready){
      const conflict=combined.codes.some(code=>/CONFLICT/.test(code));
      const reason=conflict?'選んだPDFの間で値や部屋・窓の対応が一致しませんでした。別の物件や別の計算条件の資料が混ざっていないか確認し、使う一式を選び直してください。':combined.codes.includes('PDF_TEXT_EMPTY')?'このPDFは、読み取れる文字が少ないため自動入力できません。':'選んだPDFから部屋・窓・断熱性能の対応データを取得できませんでした。';
      failArchitrendImport('pdf',combined.codes,reason+' 文字を選択できるPDF（外皮性能計算表）や、同じ物件の外皮CSVで補ってください。画像や輪郭文字の図面から読めない欄は手動で確認できます。');
      document.getElementById('atWarnList').innerHTML='';return;
    }
    atPdfParse=combined.parsed;
    rebuildArchitrendPreview();
  }catch(err){
    if(sequence===atImportSequence)failArchitrendImport('pdf',['PDF_READ_FAILED'],'PDF一式を読み取れませんでした。壊れたファイルが含まれていないか確認し、同じ物件のPDFを選び直してください。');
  }
}

function startManualMode(saved){
  setModeUI('manual');
  initSelectors();
  document.getElementById('roomsWrap').innerHTML='';
  roomCount=0; winCounter=0;
  if(saved && saved.rooms && saved.rooms.length){
    applyState(saved);
    document.querySelectorAll('.peopleMoistRate').forEach(el=>{
      if(el.value==='80') el.value='76';
    });
  }else{
    addRoom({name:'LDKetc', fields:{roomArea:32.1, occCount:6, extraSens:50}, windows:[{}]});
    addRoom({name:'個室', fields:{roomArea:10.8, occCount:1}});
    addRoom({name:'主寝室', fields:{roomArea:10.1, occCount:2}});
  }
  applySharedToolDefaults({fillEmpty:!(saved&&saved.rooms&&saved.rooms.length)});
  runAll();
  if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
}

function startArchitrendMode(saved){
  setModeUI('architrend');
  initSelectors();
  if(saved && saved.mode==='architrend'){
    applyState(saved);
    atUnassignedWindows = saved.atUnassigned || [];
    atAssignableRooms = saved.atRoomCandidates || [];
    atNorthExcludedCount = saved.atNorthExcludedCount || 0;
    renderUnassignedWindows();
    applySharedToolDefaults({fillEmpty:false});
    runAll();
    refreshNeedManual();
    if(typeof at3dsEcho==='function') at3dsEcho();
    if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
  }else{
    blankForArchitrend();
    applySharedToolDefaults();
    runAll();
    refreshNeedManual();
    if(typeof at3dsEcho==='function') at3dsEcho();
    if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
  }
}


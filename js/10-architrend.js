// ========================= アーキトレンド連携 =========================
var appMode = null; // 'manual' | 'architrend' | 'energyplus'
let atUnassignedWindows = [];
let atAssignableRooms = [];
let atNorthExcludedCount = 0;
let atLastParse = null;
let atCsvParse = null;
let atPdfParse = null;
const AT_AZ = {南:0, 南東:-45, 東:-90, 北東:-135, 北:180, 北西:135, 西:90, 南西:45};
function isNorthFacingAz(value){
  const az=Number(value);
  return Number.isFinite(az) && Math.abs(Math.abs(az)-180)<0.5;
}
const AT_BLANK_IDS = [
  'calcDate','detailHour','lat','lon','tmax','tmin','tpeak','targetT',
  'uWall','uRoof','uWin','uaVal','envArea','roomVol','ach','hxRate','acMax'
];
const AT_MANUAL_IDS = AT_BLANK_IDS.concat(['acCount']);

if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
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

function parseCsvRows(text){
  const rows=[];
  let row=[], field='', quoted=false;
  const src=String(text||'').replace(/^\uFEFF/,'');
  for(let i=0;i<src.length;i++){
    const ch=src[i];
    if(quoted){
      if(ch==='"' && src[i+1]==='"'){ field+='"'; i++; }
      else if(ch==='"') quoted=false;
      else field+=ch;
    }else if(ch==='"'){
      quoted=true;
    }else if(ch===','){
      row.push(field); field='';
    }else if(ch==='\n'){
      row.push(field.replace(/\r$/,'')); rows.push(row); row=[]; field='';
    }else{
      field+=ch;
    }
  }
  if(field!=='' || row.length){ row.push(field.replace(/\r$/,'')); rows.push(row); }
  return rows;
}

function csvNumber(value){
  const s=String(value==null?'':value).trim().replace(/,/g,'');
  if(!s || s==='－' || s==='-') return null;
  const n=Number(s);
  return Number.isFinite(n)?n:null;
}

function emptyArchitrendResult(){
  return {
    projectName:null, workName:null, projectLocation:null,
    ua:null, envArea:null, uRoof:null, uWall:null, uFloor:null, uFound:null, uWin:null,
    trueNorthDeg:null, trueNorthNote:null,
    rooms:[], habitableRooms:[], excludedRooms:[], windows:[],
    notes:[], validation:{}, sources:{}, inputSources:{csv:false,pdf:false}
  };
}

function parseArchiTrendCsv(text){
  const rows=parseCsvRows(text).filter(row=>row.some(cell=>String(cell).trim()!==''));
  const warnings=[];
  const result=emptyArchitrendResult();
  result.inputSources.csv=true;
  if(rows.length<3) return {result,warnings:['CSVにデータ行がありません']};

  const h1=rows[0].map(v=>String(v).trim());
  const h2=(rows[1]||[]).map(v=>String(v).trim());
  const indexOf=label=>h1.indexOf(label);
  const indexOfSub=label=>h2.indexOf(label);
  const idx={
    part:indexOf('部位'), floor:indexOf('階'), name:indexOf('名称'), adjacent:indexOf('隣接空間'),
    width:indexOfSub('幅'), height:indexOfSub('高'), area:indexOf('面積[㎡]'),
    perimeter:indexOf('基礎周長[ｍ]'), spec:indexOf('仕様'), attachment:indexOf('付属品'),
    glass:indexOf('ガラス仕様'), loss:indexOf('貫流熱損失[W/K]'),
    gainCooling:indexOf('日射熱取得量冷房期'), gainHeating:indexOf('日射熱取得量暖房期')
  };
  const required=['part','floor','name','width','height','area','spec','gainCooling'];
  const missing=required.filter(key=>idx[key]<0);
  if(missing.length){
    warnings.push('CSVの必須列を確認できません: '+missing.join(', '));
    return {result,warnings};
  }

  const dataRows=rows.slice(2);
  const windowRows=dataRows.filter(row=>String(row[idx.part]).trim()==='窓');
  const seen=new Set();
  windowRows.forEach(row=>{
    const id=String(row[idx.name]||'').trim();
    const idMatch=id.match(/^G(南東|南西|北東|北西|南|北|東|西)-(\d+)$/);
    if(!idMatch || seen.has(id)) return;
    seen.add(id);
    const floor=String(row[idx.floor]||'').trim();
    const orient=idMatch[1];
    result.windows.push({
      id, floor, orient,
      width:csvNumber(row[idx.width]), height:csvNumber(row[idx.height]), area:csvNumber(row[idx.area]),
      gain:csvNumber(row[idx.gainCooling]), gainCooling:csvNumber(row[idx.gainCooling]),
      gainHeating:csvNumber(row[idx.gainHeating]),
      spec:String(row[idx.spec]||'').trim(), glassSpec:String(row[idx.glass]||'').trim(),
      attachment:String(row[idx.attachment]||'').trim(),
      az:(orient in AT_AZ)?AT_AZ[orient]:null,
      eta:null, tilt:90, roofLike:false,
      sourceLabel:'CSV'
    });
  });

  const totalRow=dataRows.find(row=>String(row[idx.part]).trim()==='外皮面積合計');
  if(totalRow) result.envArea=csvNumber(totalRow[idx.area]);
  result.sources.envArea=result.envArea!==null?'CSV':null;
  result.csvEnvelopeRows=dataRows.filter(row=>{
    const part=String(row[idx.part]||'').trim();
    const adjacent=idx.adjacent>=0?String(row[idx.adjacent]||'').trim():'';
    return ['屋根','外壁','床','基礎'].includes(part) && (adjacent==='外気' || part==='基礎');
  }).map(row=>({
    part:String(row[idx.part]||'').trim(), name:String(row[idx.name]||'').trim(),
    area:csvNumber(row[idx.area]), perimeter:csvNumber(row[idx.perimeter]),
    heatLoss:csvNumber(row[idx.loss]), spec:String(row[idx.spec]||'').trim()
  }));

  const areaSum=result.windows.reduce((sum,w)=>sum+(w.area||0),0);
  const gainSum=result.windows.reduce((sum,w)=>sum+(w.gainCooling||0),0);
  const dimensionsOk=result.windows.length>0 && result.windows.every(w=>
    w.width>0 && w.height>0 && w.area>0 && Math.abs(w.width*w.height-w.area)<0.02);
  const gainsOk=result.windows.length>0 && result.windows.every(w=>w.gainCooling!==null);
  result.validation.windows={
    count:result.windows.length, areaSum, expectedArea:areaSum,
    gainSum, expectedGain:gainSum,
    areaOk:dimensionsOk, gainOk:gainsOk, source:'CSV'
  };
  result.notes.push('CSVから窓'+result.windows.length+'枚を取得しました');
  if(!result.windows.length) warnings.push('CSVから窓行を取得できませんでした');
  if(!dimensionsOk) warnings.push('幅×高さと面積が一致しない窓があります');
  if(!result.envArea) warnings.push('CSVから外皮面積合計を取得できませんでした');
  return {result,warnings};
}

function mergeArchitrendSources(csvParsed,pdfParsed){
  if(!csvParsed && !pdfParsed) return null;
  const pdfResult=pdfParsed&&pdfParsed.result;
  const csvResult=csvParsed&&csvParsed.result;
  const result=pdfResult ? JSON.parse(JSON.stringify(pdfResult)) : emptyArchitrendResult();
  result.sources=result.sources||{};
  result.inputSources={csv:!!csvParsed,pdf:!!pdfParsed};
  result.notes=[...(result.notes||[])];
  const warnings=[];
  if(pdfResult){
    ['projectName','workName','projectLocation','ua','envArea','uRoof','uWall','uFloor','uFound','uWin'].forEach(key=>{
      if(result[key]!==null) result.sources[key]='PDF p.1';
    });
    if(result.habitableRooms.length) result.sources.rooms='PDF p.'+
      ((result.validation.rooms&&result.validation.rooms.page)||9);
  }

  if(csvParsed){
    result.envArea=csvResult.envArea;
    result.sources.envArea=csvResult.envArea!==null?'CSV':null;
    result.csvEnvelopeRows=csvResult.csvEnvelopeRows||[];
    const pdfWindows=new Map((pdfResult&&pdfResult.windows||[]).map(w=>[w.id,w]));
    result.windows=csvResult.windows.map(csvWindow=>{
      const pdfWindow=pdfWindows.get(csvWindow.id);
      return Object.assign({},csvWindow,{
        eta:pdfWindow&&pdfWindow.eta!==null?pdfWindow.eta:null,
        tilt:90,
        sourceLabel:pdfWindow&&pdfWindow.eta!==null?'CSV + PDF p.'+(pdfWindow.sourcePage||1):'CSV'
      });
    });
    result.validation=result.validation||{};
    result.validation.windows=JSON.parse(JSON.stringify(csvResult.validation.windows));
    if(pdfResult&&pdfResult.windows.length){
      const csvIds=new Set(result.windows.map(w=>w.id));
      const pdfIds=new Set(pdfResult.windows.map(w=>w.id));
      const idsOk=csvIds.size===pdfIds.size && [...csvIds].every(id=>pdfIds.has(id));
      const csvArea=result.windows.reduce((sum,w)=>sum+(w.area||0),0);
      const pdfArea=pdfResult.windows.reduce((sum,w)=>sum+(w.area||0),0);
      result.validation.windows.crossOk=idsOk && Math.abs(csvArea-pdfArea)<0.03;
      result.validation.windows.crossText='CSV/PDF 窓ID・面積';
      if(!result.validation.windows.crossOk) warnings.push('CSVとPDFの窓IDまたは窓面積が一致しません');
      else result.notes.push('CSVとPDFの窓'+result.windows.length+'枚・面積が一致しました');
    }
  }

  if(csvParsed) warnings.push(...csvParsed.warnings);
  if(pdfParsed){
    pdfParsed.warnings.forEach(w=>{
      if(/真北|物件名とフッター|建設地/.test(w)) warnings.push(w);
    });
  }
  if(!csvParsed) warnings.push('CSV未指定です。窓情報はPDF解析結果を使用します');
  if(!pdfParsed) warnings.push('PDF未指定のため、UA・U値・居室・窓ηは取得できません');
  if(result.ua===null) warnings.push('UAは空欄です');
  if([result.uRoof,result.uWall,result.uFloor,result.uFound,result.uWin].some(v=>v===null)){
    warnings.push('PDFから確定できない部位U値は空欄です');
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

function parsePositionedWindows(layoutPages){
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
  const page=(layoutPages||[]).find(p=>p.lines.some(line=>line.compact.includes('居室区画面積表')));
  if(!page) return null;
  const width=page.width;
  const roomNamePattern=/^(ＬＤＫ|LDK|玄関|ホール|階段|子供コーナー|子どもコーナー|脱衣室|ＵＢ|UB|洗面室|トイレ|収納|ローカ|廊下|洋室[０-９\d]*|和室[０-９\d]*|主寝室|寝室|ｳｫｰｸｲﾝｸﾛｰｾﾞｯﾄ|ウォークインクローゼット|ＷＩＣ|WIC|書庫|書斎)$/;
  const items=(page.items||[]).filter(function(it){ return String(it.text||'').trim(); });
  const nameItems=items.filter(function(it){
    const t=String(it.text).trim();
    if(!roomNamePattern.test(t) || it.x<=width*0.07 || it.x>=width*0.16) return false;
    return items.some(function(cell){
      const ct=String(cell.text).trim();
      return /^[ABC]$/.test(ct) && Math.abs(cell.y-it.y)<2 && cell.x>width*0.205 && cell.x<width*0.25;
    });
  });
  nameItems.sort((a,b)=>b.y-a.y);
  // PDF Y increases upwards. Floor labels sit at the center of merged table cells.
  const gaps=nameItems.slice(1).map((it,i)=>nameItems[i].y-it.y).filter(d=>d>1).sort((a,b)=>a-b);
  const pitch=gaps.length ? gaps[Math.floor(gaps.length/2)] : 7;
  const floorMarks=items.filter(it=>it.x>width*0.07 && it.x<width*0.09 && /^[1-9][0-9]*(?:階)?$/.test(String(it.text).trim()))
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
      const t=String(it.text).trim();
      if(/^[ABC]$/.test(t) && it.x>width*0.205 && it.x<width*0.25) type=t;
      const v=parseFloat(t.replace(/,/g,''));
      if(!(v>0)) return;
      if(it.x>width*0.185 && it.x<width*0.215) area=v;
    });
    if(!(area>0) || !type) return;
    const name=String(nameItem.text).trim().replace('ＬＤＫ','LDK').replace('ＵＢ','UB')
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
  return {rooms, summary, page:page.number};
}

function parsePositionedEnvelope(layoutPages){
  const page=(layoutPages||[]).find(p=>p.lines.some(line=>line.compact.includes('外皮性能計算表')));
  if(!page) return null;
  const width=page.width;
  const leftNumberOnLine=keyword=>{
    const key=normalizePdfText(keyword);
    const line=page.lines.find(row=>row.compact.includes(key));
    if(!line) return null;
    const nums=line.items.filter(it=>it.x<width*0.42).map(it=>parseFloat(String(it.text).replace(/,/g,''))).filter(Number.isFinite);
    return nums.length?nums[nums.length-1]:null;
  };
  const getU=label=>{
    const key=normalizePdfText(label);
    const lines=page.lines.filter(line=>line.compact.includes(key));
    const vals=lines.map(line=>pdfNumNear(line,0.599,width,0.018)).filter(v=>v!==null);
    return vals.length?[...new Set(vals.map(v=>v.toFixed(3)))].length===1?vals[0]:null:null;
  };
  const winLines=page.lines.filter(line=>/窓\(\d+\)/.test(line.compact));
  const winUs=winLines.map(line=>pdfNumNear(line,0.599,width,0.018)).filter(v=>v!==null);
  const uniqueWin=[...new Set(winUs.map(v=>v.toFixed(3)))];
  return {
    ua:leftNumberOnLine('外皮平均熱貫流率(UA)'),
    envArea:leftNumberOnLine('外皮面積[㎡]'),
    uRoof:getU('屋根(1)'), uWall:getU('外壁(1)'), uFloor:getU('床(1)'), uFound:getU('基礎(1)'),
    uWin:uniqueWin.length===1?parseFloat(uniqueWin[0]):null,
    page:page.number
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
    ['ua','envArea','uRoof','uWall','uFloor','uFound','uWin'].forEach(key=>{
      if(envelopeLayout[key]!==null) result[key]=envelopeLayout[key];
    });
    for(let i=warnings.length-1;i>=0;i--){
      if((result.ua!==null && /^UAを/.test(warnings[i])) ||
         (result.envArea!==null && /^外皮面積を/.test(warnings[i])) ||
         (result.uRoof!==null && /部位U値/.test(warnings[i])) ||
         (result.uWin!==null && /窓U/.test(warnings[i]))) warnings.splice(i,1);
    }
  }
  const windowLayout=parsePositionedWindows(layoutPages);
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
    result.notes.push('窓'+result.windows.length+'枚を座標付き表から抽出しました。部屋への割当のみ手動です');
  }
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
  if(!result.projectLocation) warnings.unshift('建設地の記載がないため、住所または緯度・経度を入力してください');
  if(result.projectName && result.workName && normalizePdfText(result.projectName)!==normalizePdfText(result.workName)){
    warnings.unshift('物件名とフッターの工事名が一致しません。物件名を優先します');
  }

  return {result, warnings};
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
    const positioned=content.items.map(it=>({
      text:it.str, x:it.transform[4], y:it.transform[5],
      width:it.width||0, height:it.height||0
    }));
    pages.push({number:i,width:viewport.width,height:viewport.height,items:positioned,
      lines:groupPdfItemsIntoLines(positioned)});
  }
  return {full, chars, numPages: pdf.numPages, pages};
}

function escapeHtml(value){
  return String(value==null?'':value)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function renderArchitrendReview(parsed, applied){
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
  document.getElementById('atSummary').innerHTML='';
  const sources=result.sources||{};
  const sourceOf=(key,fallback)=>sources[key]||fallback||'—';

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
    ['窓U',result.uWin==null?'—':result.uWin,sourceOf('uWin')]
  ];
  const windowRows=result.windows.map(w=>
    '<tr><td>'+escapeHtml(w.id)+'</td><td>'+escapeHtml(w.floor||'—')+'</td>'+
    '<td>'+escapeHtml(w.orient||'—')+'</td><td>'+escapeHtml(w.width==null?'—':w.width)+'</td>'+
    '<td>'+escapeHtml(w.height==null?'—':w.height)+'</td><td>'+escapeHtml(w.area==null?'—':w.area)+'</td>'+
    '<td>'+escapeHtml(w.eta==null?'—':w.eta)+'</td><td class="src">'+
    escapeHtml(w.sourceLabel||(w.sourcePage?'PDF p.'+w.sourcePage:'—'))+'</td></tr>'
  ).join('');
  const orientationText=Object.entries(orientationCounts).map(([k,v])=>k+v).join(' / ')||'なし';
  const statusClass=applied?'at-validation-ok':'';
  let meshRoomsHtml='';
  if(typeof atMesh!=='undefined' && atMesh && (atMesh.rooms||[]).length){
    if(typeof atMergeRoomsByPdf==='function'){
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
          (result.inputSources.csv?'CSV':'')+(result.inputSources.csv&&result.inputSources.pdf?' + ':'')+
          (result.inputSources.pdf?'PDF':'')+'</b></span>'+
        '<span class="at-chip"><span>物件</span><b>'+escapeHtml(result.projectName||'不明')+'</b></span>'+
        '<span class="at-chip"><span>UA</span><b>'+escapeHtml(uaText)+'</b></span>'+
        '<span class="at-chip"><span>外皮</span><b>'+escapeHtml(areaText)+'</b></span>'+
        '<span class="at-chip"><span>居室</span><b>'+result.habitableRooms.length+'室</b></span>'+
        '<span class="at-chip"><span>窓</span><b>'+result.windows.length+'枚 / '+windowArea.toFixed(2)+'㎡</b></span>'+
        '<span class="at-chip warn-chip"><span>要確認</span><b>'+warnings.length+'件</b></span>'+
      '</div>'+
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
          result.habitableRooms.map(r=>'<span class="at-room-chip">'+escapeHtml(r.name)+' '+r.area.toFixed(2)+'㎡</span>').join('')+
        '</div><div class="small" style="margin-top:8px;">窓割当時に作成する非居室候補: '+
          result.excludedRooms.map(r=>'<span class="at-room-chip excluded">'+escapeHtml(r.name)+'</span>').join(' ')+
        '</div><div class="small" style="margin-top:6px;">出典: '+escapeHtml(sourceOf('rooms','—'))+'</div></div></details>'+
      meshRoomsHtml+
      '<details><summary>窓 <span class="count">'+escapeHtml(orientationText)+' / 合計'+windowArea.toFixed(2)+'㎡</span></summary>'+
        '<div class="at-review-body at-window-table"><table><tr><th>ID</th><th>階</th><th>方位</th><th>幅</th><th>高</th><th>面積</th><th>η</th><th>出典</th></tr>'+
          windowRows+'</table></div></details>'+
      '<details><summary>対象外として無視 <span class="count">会社・設計者情報</span></summary>'+
        '<div class="at-review-body small">TEL/FAX、設計者名、登録番号などの会社情報は解析条件として使用しません。</div></details>'+
      '<div class="at-review-actions">'+
        (applied?'<span class="'+statusClass+'">✓ 確認内容を入力へ反映済み</span>':
          '<button type="button" class="at-apply-btn" onclick="confirmApplyArchitrend()">確認して入力へ反映</button>'+
          '<span class="small">反映後も各値は編集できます。</span>')+
      '</div>'+
    '</div>';
  if(typeof atUpdateRoomVolume==='function') atUpdateRoomVolume();
  if(typeof atRenderRoomViewer==='function') atRenderRoomViewer();
}

function confirmApplyArchitrend(){
  if(!atLastParse) return;
  applyArchitrendParse(atLastParse);
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
    if(kind) kind.textContent='非居室・窓日射用';
  }else if(kind){
    kind.remove();
  }
  const defaults=(typeof TOOL_DEFAULTS!=='undefined') ? TOOL_DEFAULTS : {};
  function setCls(cls, value){
    const el=card.querySelector('.'+cls);
    if(el) el.value=String(value);
  }
  if(!hab){
    setCls('occCount', 0);
    setCls('peopleSensRate', 0);
    setCls('peopleMoistRate', 0);
    setCls('equipSensRate', 0);
    setCls('equipMoistRate', 0);
  }else{
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
function atPdfWindowForMesh(meshWin, pdfWindows, used){
  const mapped={南:'南西', 東:'南東', 北:'北東', 西:'北西'};
  const wantOrient=mapped[meshWin.orient]||meshWin.orient;
  let best=null, bestScore=1e9;
  (pdfWindows||[]).forEach(function(w, i){
    if(used.has(i)) return;
    if(meshWin.floor && w.floor && String(w.floor)!==String(meshWin.floor) && !(meshWin.floor==='R' && w.floor==='R')) return;
    const dA=Math.abs((w.area||0)-(meshWin.area||0));
    if(dA>0.06) return;
    let dO=0.2;
    if(w.orient && (w.orient===meshWin.orient || w.orient===wantOrient)) dO=0;
    const score=dA+dO;
    if(score<bestScore){ bestScore=score; best={w:w, i:i}; }
  });
  if(!best){
    (pdfWindows||[]).forEach(function(w, i){
      if(used.has(i)) return;
      const dA=Math.abs((w.area||0)-(meshWin.area||0));
      if(dA>0.06) return;
      if(dA<bestScore){ bestScore=dA; best={w:w, i:i}; }
    });
  }
  return best;
}
function applyArchitrendMeshRooms(result){
  if(typeof atMesh==='undefined' || !atMesh || !(atMesh.rooms||[]).length) return false;
  if(typeof atMergeRoomsByPdf==='function'){
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
  const usedPdf=new Set();
  atNorthExcludedCount=0;
  atUnassignedWindows=[];
  meshWins.forEach(function(mw, meshWinIndex){
    const hit=atPdfWindowForMesh(mw, pdfWins, usedPdf);
    const pdf=hit ? hit.w : null;
    if(hit) usedPdf.add(hit.i);
    const az=isFinite(mw.az) ? mw.az : (pdf && pdf.az!=null ? pdf.az : (typeof AT_AZ!=='undefined' ? AT_AZ[mw.orient] : 0));
    const roomKey=mw.roomKey && idByKey[mw.roomKey] ? mw.roomKey : '';
    const roomId=roomKey ? idByKey[roomKey] : '';
    const w={
      wName: pdf && pdf.id ? pdf.id : ('窓'+(mw.orient||'')+(mw.floor||'')),
      wAz: az==null ? '' : String(az),
      wEta: pdf && pdf.eta!=null ? String(pdf.eta) : '',
      wArea: pdf && pdf.area!=null ? String(pdf.area) : String(Math.round((mw.area||0)*100)/100),
      glassSel:'0', attachSel:'0',
      atMeshWindowIndex:String(meshWinIndex),
      atFaceId:String(mw.face.atFaceId),
      roofLike: mw.floor==='R'
    };
    if(roomId && w.wArea!==''){
      addWindow(roomId, Object.assign({skipRerun:true}, w, {
        wU:(document.getElementById('uWin') && document.getElementById('uWin').value)||''
      }));
    }else{
      atUnassignedWindows.push(w);
    }
  });
  pdfWins.forEach(function(w, i){
    if(usedPdf.has(i)) return;
    atUnassignedWindows.push({
      wName:w.id, wAz:w.az==null?'':String(w.az), wEta:w.eta==null?'':String(w.eta),
      wArea:w.area==null?'':String(w.area), glassSel:'0', attachSel:'0', roofLike:!!w.roofLike
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
          roomArea: String(r.area),
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
    atUnassignedWindows = result.windows.map(w=>({
      wName: w.id,
      wAz: w.az==null ? '' : String(w.az),
      wEta: w.eta==null ? '' : String(w.eta),
      wArea: w.area==null ? '' : String(w.area),
      glassSel: '0',
      attachSel: '0',
      roofLike: !!w.roofLike
    }));
    renderUnassignedWindows();
  }

  renderArchitrendReview(parsed,true);
  applySharedToolDefaults();
  runAll();
  refreshNeedManual();
}

function renderUnassignedWindows(){
  const box = document.getElementById('atUnassignedBox');
  const list = document.getElementById('atUnassignedList');
  const northInfo=document.getElementById('atNorthExcludedInfo');
  if(northInfo) northInfo.textContent=' 3DS読込時はビューワーの北方向から方位角を更新します。';
  if(typeof appMode!=='undefined' && appMode!=='architrend'){
    if(box) box.style.display = 'none';
    if(list) list.innerHTML = '';
    return;
  }
  if(!atUnassignedWindows.length){
    if(box) box.style.display = 'none';
    if(list) list.innerHTML = '';
    return;
  }
  box.style.display = 'block';
  const roomOpts = ['<option value="">部屋を選択...</option>'];
  const existingKeys=new Set();
  document.querySelectorAll('.room-card').forEach(card=>{
    if(card.dataset.atRoomKey) existingKeys.add(card.dataset.atRoomKey);
    roomOpts.push('<option value="'+card.id+'">'+escapeHtml(card.querySelector('.roomName').value)+
      (card.dataset.nonHabitable==='true'?' (非居室)':'')+'</option>');
  });
  atAssignableRooms.forEach((room,i)=>{
    if(existingKeys.has(room.key)) return;
    roomOpts.push('<option value="candidate:'+i+'">'+escapeHtml(room.name)+
      (room.habitable?'':' (非居室・選択時に自動作成)')+'</option>');
  });
  list.innerHTML = atUnassignedWindows.map((w,i)=>{
    return '<div class="at-unassigned-row" data-idx="'+i+'">'+
      '<div class="'+(w.wName?'at-filled':'need-manual')+'"><label>名前</label><input type="text" class="uName" value="'+(w.wName||'')+'"></div>'+
      '<div class="'+(w.wAz===''?'need-manual':'at-filled')+'"><label>方位角</label><input type="number" class="uAz" value="'+w.wAz+'" step="1"></div>'+
      '<div class="'+(w.wEta===''?'need-manual':'at-filled')+'"><label>η0</label><input type="number" class="uEta" value="'+w.wEta+'" step="0.01"></div>'+
      '<div class="'+(w.wArea===''?'need-manual':'at-filled')+'"><label>面積</label><input type="number" class="uArea" value="'+w.wArea+'" step="0.01"></div>'+
      '<div class="need-manual"><label>割当先部屋</label><select class="uRoom">'+roomOpts.join('')+'</select></div>'+
      '<button type="button" class="small-btn" onclick="assignUnassignedWindow('+i+')">割当</button>'+
    '</div>';
  }).join('');
}

function syncUnassignedFromDom(){
  document.querySelectorAll('#atUnassignedList .at-unassigned-row').forEach(row=>{
    const i = +row.dataset.idx;
    if(!atUnassignedWindows[i]) return;
    atUnassignedWindows[i].wName = row.querySelector('.uName').value;
    atUnassignedWindows[i].wAz = row.querySelector('.uAz').value;
    atUnassignedWindows[i].wEta = row.querySelector('.uEta').value;
    atUnassignedWindows[i].wArea = row.querySelector('.uArea').value;
  });
}

function assignUnassignedWindow(idx){
  syncUnassignedFromDom();
  const row = document.querySelector('#atUnassignedList .at-unassigned-row[data-idx="'+idx+'"]');
  if(!row) return;
  const roomChoice = row.querySelector('.uRoom').value;
  if(!roomChoice){ alert('割当先の部屋を選んでください'); return; }
  const w = atUnassignedWindows[idx];
  if(!w) return;
  if(w.wAz==='' || w.wEta==='' || w.wArea===''){
    alert('方位・η・面積が空欄のままです。割当前にすべて入力してください');
    return;
  }
  let roomId=roomChoice;
  if(roomChoice.startsWith('candidate:')){
    const candidate=atAssignableRooms[+roomChoice.split(':')[1]];
    if(!candidate){ alert('割当先の部屋情報を取得できません'); return; }
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
    wU: (document.getElementById('uWin') && document.getElementById('uWin').value) || '',
    glassSel: w.glassSel||'0',
    attachSel: w.attachSel||'0',
    atMeshWindowIndex:w.atMeshWindowIndex
  });
  atUnassignedWindows.splice(idx, 1);
  renderUnassignedWindows();
  runAll();
  refreshNeedManual();
}

function refreshNeedManual(){
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
    wrap.classList.toggle('need-manual', empty);
    if(!empty) wrap.classList.add('at-filled');
    else wrap.classList.remove('at-filled');
    // PDF由来でない共通条件などは埋まっても AT にしない
    if(['calcDate','detailHour','lat','lon','tmax','tmin','tpeak','targetT','roomVol','ach','hxRate','acMax','acCount'].includes(id) &&
       !(id==='roomVol' && el.dataset.at3dsAuto==='true')){
      wrap.classList.remove('at-filled');
    }
    if(empty) remain++;
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
  const info = document.getElementById('atRemainInfo');
  info.style.display = 'inline';
  info.textContent = remain>0
    ? ('要手動 残 '+remain+' 件')
    : '連携入力完了';
  info.style.color = remain>0 ? 'var(--heat)' : 'var(--ink2)';
}

function rebuildArchitrendPreview(){
  const merged=mergeArchitrendSources(atCsvParse,atPdfParse);
  if(!merged) return;
  atLastParse=merged;
  renderArchitrendReview(merged,false);
}

async function readCsvFile(file){
  const buffer=await file.arrayBuffer();
  let text=new TextDecoder('utf-8').decode(buffer);
  if(text.includes('\uFFFD')){
    try{ text=new TextDecoder('shift_jis').decode(buffer); }catch(err){}
  }
  return text;
}

async function onAtCsvSelected(input){
  const file=input.files&&input.files[0];
  if(!file) return;
  try{
    document.getElementById('atSummary').innerHTML='<p class="small">CSVを読み込み中...</p>';
    const text=await readCsvFile(file);
    const parsed=parseArchiTrendCsv(text);
    if(parsed.result.windows.length===0 && parsed.warnings.length){
      document.getElementById('atSummary').innerHTML='<div class="warn">'+
        escapeHtml(parsed.warnings.join(' / '))+'</div>';
      return;
    }
    atCsvParse=parsed;
    rebuildArchitrendPreview();
  }catch(err){
    alert('CSVの読み込みに失敗しました: '+err.message);
  }
}

async function onAtPdfSelected(input){
  const file = input.files && input.files[0];
  if(!file) return;
  if(!window.pdfjsLib){
    alert('PDF.js の読み込みに失敗しています。ネット接続を確認してください');
    return;
  }
  try{
    document.getElementById('atSummary').innerHTML = '<p class="small">読み込み中...</p>';
    document.getElementById('atReview').innerHTML = '';
    const {full, chars, pages} = await extractPdfText(file);
    if(chars < 50){
      document.getElementById('atSummary').innerHTML = '<div class="warn">テキストを抽出できませんでした (スキャンPDFの可能性)。手動モードを使うか、テキスト埋め込みPDFを指定してください。</div>';
      document.getElementById('atWarnList').innerHTML = '';
      return;
    }
    atPdfParse=parseArchiTrendText(full,pages);
    rebuildArchitrendPreview();
  }catch(err){
    alert('PDFの読み込みに失敗しました: '+err.message);
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
  applySharedToolDefaults();
  runAll();
  if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
}

function startArchitrendMode(saved){
  setModeUI('architrend');
  initSelectors();
  if(saved && saved.mode==='architrend' &&
     ((saved.rooms||[]).length || (saved.atUnassigned||[]).length || saved.atRoomReview)){
    applyState(saved);
    atUnassignedWindows = saved.atUnassigned || [];
    atAssignableRooms = saved.atRoomCandidates || [];
    atNorthExcludedCount = saved.atNorthExcludedCount || 0;
    renderUnassignedWindows();
    applySharedToolDefaults();
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


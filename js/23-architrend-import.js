/* Parsed ARCHITREND → the shared EP model. No geometry is inferred from U-values. */
window.applyArchitrendToBoundaryModel=function(model,data,context={}){
  if(!data||model.source!=='architrend')return null;
  const clone=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
  const defaults=context.defaults||window.boundaryPipelineDefaults;
  const prior=model.architrendImport||{},applied=prior.applied||{};
  const report={version:1,files:context.files||prior.files||{},applied,counts:{envelope:0,windowU:0,windowSolar:0,rooms:0,people:0,protected:0},notes:[],unmatchedWindows:[],unmatchedRooms:[]};
  const note=s=>{if(!report.notes.includes(s))report.notes.push(s);};
  if(data.validation?.windows?.crossOk===false){note('CSVとPDFの窓ID・面積が一致しないため、自動反映を停止しました。同じ建物の資料か確認してください。');model.architrendImport=report;return report;}
  const plain=c=>{if(!c)return null;const d=clone(c);for(const k of ['label','cfdMaterial','cfdThickness'])delete d[k];return d;};
  const source=key=>data.sources?.[key]||'PDF';
  function write(entity,key,value,origin,initial){
    if(value==null||value==='')return false;
    const id=entity.id+'.'+key,old=applied[id];
    if(!same(entity[key],value)&&!(old&&same(entity[key],old.value))&&!(!old&&(context.fresh||initial||entity[key]==null||entity[key]===''))){report.counts.protected++;return false;}
    entity[key]=clone(value);applied[id]={value:clone(value),source:origin};return true;
  }
  function keyFor(part){let key='AT_Source_'+part;while(model.constructions[key]&&model.constructions[key].architrendKind!==part)key+='_new';return key;}
  function material(part,items,spec,origin){
    const eligible=items.filter(s=>{
      const old=applied[s.id+'.construction'];
      const allowed=old?s.construction===old.value:context.fresh||same(plain(model.constructions[s.construction]),plain(defaults.constructions[part.startsWith('window_')?'window':part]));
      if(!allowed)report.counts.protected++;
      return allowed;
    });
    if(!eligible.length)return 0;
    const key=keyFor(part),old=model.constructions[key],record=applied['material:'+key];
    if(old&&(!record||!same(old,record.value))){report.counts.protected+=eligible.length;return 0;}
    const base=model.constructions[eligible[0].construction]||defaults.constructions.wall;
    const c=Object.assign({},spec,{architrendKind:part,architrendSource:origin,cfdMaterial:base.cfdMaterial||'2杉(1)',cfdThickness:base.cfdThickness||.03});
    model.constructions[key]=c;applied['material:'+key]={value:clone(c),source:origin};
    eligible.forEach(s=>write(s,'construction',key,origin,true));return eligible.length;
  }
  const firstFloor=Math.min(...model.surfaces.filter(s=>s.type==='Floor').flatMap(s=>s.vertices.map(p=>p[2])));
  for(const [part,key,label] of [['wall','uWall','外壁'],['roof','uRoof','屋根'],['floor','uFloor','外気側床'],['door','uDoor','ドア']]){
    const u=data[key];if(!positive(u)){if(part==='wall'||part==='roof')note(label+'のU値は未取得です。現在の仕様を保持します。');continue;}
    const resistance=1/u-.11-.04;
    if(!(resistance>0)){note(label+'のU値から正の材料熱抵抗を作れないため、反映しませんでした。');continue;}
    const surfaces=part==='door'?model.openings.filter(s=>s.type==='Door'):model.surfaces.filter(s=>s.boundary==='Outdoors'&&(part==='wall'?s.type==='Wall':part==='roof'?['Roof','Ceiling'].includes(s.type):s.type==='Floor'&&Math.min(...s.vertices.map(p=>p[2]))>firstFloor+1.2));
    report.counts.envelope+=material(part,surfaces,{kind:'nomass',resistance,architrendU:u,label:label+' U='+u.toFixed(3)+'（読取・熱抵抗換算）'},source(key));
  }
  if(report.counts.envelope)note('外皮のU値は R=1/U−0.11−0.04 で材料熱抵抗に換算しました。材料層・蓄熱は取得していません。EPの実際の表面熱伝達率は別に計算されます。');
  if(positive(data.uFound))note('基礎の線熱貫流率は床のU値へ置き換えません。最下階の床仕様・接地条件は確認してください。');
  if(positive(data.uFloor))note('外気側床のU値は上階の外気に接する床へ反映します。最下階床や室間床には流用しません。');
  for(const r of model.rooms){
    const mesh=(context.rooms||[]).find(x=>x.key===r.sourceId);
    if(!mesh){report.unmatchedRooms.push(r.id);continue;}
    let room=Number.isInteger(mesh.pdfIndex)?data.rooms?.[mesh.pdfIndex]:null;
    if(!room){const matches=(data.rooms||[]).filter(p=>p.name===mesh.name&&(!p.floor||String(p.floor)===String(mesh.floor))&&Math.abs(p.area-mesh.area)<.2);if(matches.length===1)room=matches[0];}
    if(room){
      const origin=(data.sources?.rooms||'PDF')+' / '+room.name;
      if(write(r,'name',room.name,origin,r.name===r.id||r.name===mesh.name))report.counts.rooms++;
      write(r,'conditioned',room.type==='A'||room.type==='B',origin+' 居室区分から空調対象の初期値',false);
      r.architrendRoom={name:room.name,area:room.area,floor:room.floor,type:room.type,source:origin};
      if(Math.abs((mesh.area||0)-(room.area||0))>Math.max(.2,(room.area||0)*.05))note(room.name+'のPDF面積と3DS面積に差があります。形状は3DSを保持しました。');
    }else report.unmatchedRooms.push(r.id);
    const values=context.roomValues?.[r.sourceId];
    if(values&&values.people!=null){if(write(r,'people',values.people,'前段の部屋設定',false))report.counts.people++;}
    if(values&&values.equipmentW!=null&&r.equipmentWm2==null)write(r,'equipmentW',values.equipmentW,'前段の部屋設定',false);
  }
  if(report.counts.rooms)note('居室区分A/Bを空調対象の初期値に使います。実際に空調しない室は「部屋の使い方」で変更してください。面積・形状は3DSを保持し、PDF面積は照合用に保存します。');
  if(report.unmatchedRooms.length)note('資料の部屋と対応していない区画が'+report.unmatchedRooms.length+'室あります。現在の部屋名・設定を保持しています。');
  if(!(data.rooms||[]).some(r=>r.people!=null||r.occupants!=null))note('人数・照明・換気・生活時間は資料から取得していません。人数は前段の入力があれば引き継ぎ、その他は現在の設定を保持します。');
  function windowU(w){return positive(w.u)&&w.uSource?.startsWith('PDF')?w.u:positive(data.uWin)?data.uWin:positive(w.u)?w.u:null;}
  function uOrigin(w){return positive(w.u)&&w.uSource?.startsWith('PDF')?w.uSource:positive(data.uWin)?source('uWin'):w.uSource||'CSV概算';}
  const floorByRoom=new Map(model.rooms.map(r=>[r.id,r.floor]));
  function candidates(opening){
    const parent=model.surfaces.find(s=>s.id===opening.surfaceId),floor=floorByRoom.get(parent?.roomId);
    const points=opening.vertices, zs=points.map(p=>p[2]);let width=0;
    for(const a of points)for(const b of points)width=Math.max(width,Math.hypot(a[0]-b[0],a[1]-b[1]));
    const height=Math.max(...zs)-Math.min(...zs);
    return (data.windows||[]).filter(w=>(!w.floor||w.floor==='R'||!floor||String(floor)===String(w.floor))&&positive(w.width)&&positive(w.height)&&Math.abs(w.width-width)<.06&&Math.abs(w.height-height)<.06);
  }
  for(const opening of model.openings.filter(s=>s.type==='Window')){
    const possible=candidates(opening),link=context.windowLinks?.[String(opening.sourceId)]||opening.architrendWindowId;
    const linked=link&&possible.find(w=>w.id===link);
    let win=linked||(possible.length===1?possible[0]:null);
    // Identical properties may be reused without pretending an ambiguous ID is known.
    if(!win&&possible.length&&possible.every(w=>windowU(w)===windowU(possible[0])&&w.eta===possible[0].eta))win=possible[0];
    if(!win){report.unmatchedWindows.push(opening.id);continue;}
    if(linked||possible.length===1)opening.architrendWindowId=win.id;
    const current=model.constructions[opening.construction]||defaults.constructions.window;
    const u=windowU(win),eta=win.eta;
    const solar=typeof eta==='number'&&Number.isFinite(eta)&&eta>0&&eta<=1;
    if(!u&&!solar){report.unmatchedWindows.push(opening.id);note('窓のU値・日射性能が未取得の箇所は現在の値を保持しています。');continue;}
    const origin=[u?uOrigin(win):'U値は現在値',solar?(win.sourceLabel||'PDF')+' 垂直窓ηをSHGC近似':'日射性能は現在値'].join(' / ');
    const spec={kind:'glazing',u:u||current.u,shgc:solar?eta:current.shgc,label:(opening.architrendWindowId||'同性能の窓')+'（ARCHITREND）',architrendU:u||undefined};
    // Visible transmittance is optional in SimpleGlazingSystem. Do not invent a
    // measured value from an unmeasured SHGC or the template's default 0.6.
    if(positive(win.visibleTransmittance))spec.visibleTransmittance=win.visibleTransmittance;
    if(material('window_'+opening.id,[opening],spec,origin)){
      if(u)report.counts.windowU++;
      if(solar)report.counts.windowSolar++;
      else note('日射性能ηが未取得の窓は、現在のSHGCを保持しています。かんたん設定で確認してください。');
    }
  }
  if(report.counts.windowSolar)note('窓の垂直日射熱取得率ηを、簡易窓モデルのSHGCとして近似入力します。冷房期の日射熱取得量や日よけ補正を重ねて入力しません。');
  if(report.unmatchedWindows.length)note('性能を一意に対応できない窓が'+report.unmatchedWindows.length+'面あります。窓の現在値は保持し、要確認として残しました。');
  if(report.counts.protected)note('手修正・独自仕様の'+report.counts.protected+'項目を保持しました。');
  model.architrendImport=report;return report;
};

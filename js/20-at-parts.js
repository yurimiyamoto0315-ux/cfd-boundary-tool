// FlowDesigner FDD geometry is read from the original library files. 3DS carries
// the same surfaces; SSL restores their CFD properties after import.
const AT_AC_DIRS=['水平','30°','50°'];
const AT_AC_FILES={'水平':'エアコン水平.fdd','30°':'エアコン30°.fdd','50°':'エアコン50°.fdd'};
const AT_AC_BUNDLE={'水平':'ac_h','30°':'ac_30','50°':'ac_50'};
const AT_PART_FILES={ac:'エアコン水平.fdd', door:'ドア.fdd', swing:'開戸.fdd', slide:'引戸.fdd'};
const AT_PART_LABELS={ac:'エアコン', door:'ドア', swing:'開戸', slide:'引戸'};
const AT_PART_CHILD_KEYS={
  ac:{'AC':'ac_body','吸い込み':'ac_return','吹き出し':'ac_supply',
    '本体':'ac_body','吸込口':'ac_return','吹出口':'ac_supply'},
  door:{'本体':'doorbody','アンダーカット':'doorgap_uc','上端':'doorgap_top'},
  swing:{'ドア':'doorbody','隙間上部':'doorgap_top','隙間下部':'doorgap_uc'},
  slide:{'ドア':'doorbody','隙間上部':'doorgap_top','隙間下部':'doorgap_uc'}
};
const atParts={items:[], overrides:{}, selected:'', selectedFace:'', mode:'select', doorKind:'door',
  templates:{}, acTemplates:{}, loadError:'', loadPromise:null, drag:null, seq:0, managedAc:false,
  pendingAc:null, pendingAcId:'', lastBlowDir:'水平'};

function atPartMatrix(text){
  const v=String(text||'').split(',').map(Number);
  return v.length===16 && v.every(Number.isFinite) ? v : [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
}
function atPartTransform(v,m){
  return {x:m[0]*v.x+m[1]*v.y+m[2]*v.z+m[3],
    y:m[4]*v.x+m[5]*v.y+m[6]*v.z+m[7],
    z:m[8]*v.x+m[9]*v.y+m[10]*v.z+m[11]};
}
function atPartParseFdd(xmlText,kind,fileName){
  const label=fileName||AT_PART_FILES[kind]||kind;
  const doc=new DOMParser().parseFromString(xmlText,'application/xml');
  if(doc.querySelector('parsererror')) throw new Error(label+' のXMLが不正です');
  const root=doc.documentElement;
  const group=Array.from(root.children).find(n=>n.children.length>20 && n.querySelector('vertex'));
  if(!group) throw new Error(label+' に形状がありません');
  const keyed=AT_PART_CHILD_KEYS[kind], meshes=[];
  Array.from(group.children).forEach(node=>{
    if(node.tagName!=='model') return;
    const partName=Array.from(node.children).find(n=>n.tagName==='name')?.textContent||'';
    const key=keyed[partName];
    if(!key) return;
    const matrices=Array.from(node.children).filter(n=>n.tagName==='matrix').map(n=>atPartMatrix(n.textContent));
    const verts=Array.from(node.children).filter(n=>n.tagName==='vertex').map(n=>{
      const xyz=n.textContent.split(',').map(Number);
      let v={x:xyz[0],y:xyz[1],z:xyz[2]};
      if(matrices[1]) v=atPartTransform(v,matrices[1]);
      if(matrices[0]) v=atPartTransform(v,matrices[0]);
      return v;
    });
    const tris=[];
    Array.from(node.children).filter(n=>n.tagName==='surface').forEach(n=>{
      const ids=n.textContent.split(',').map(Number);
      for(let i=1;i+1<ids.length;i++){
        if([ids[0],ids[i],ids[i+1]].every(j=>Number.isInteger(j)&&j>=0&&j<verts.length))
          tris.push([ids[0],ids[i],ids[i+1]]);
      }
    });
    if(verts.length && tris.length) meshes.push({key, name:partName, verts, tris});
  });
  const body=meshes.find(m=>m.key===(kind==='ac'?'ac_body':'doorbody'));
  if(!body) throw new Error(label+' に本体面がありません');
  const b=atPartBounds(body.verts);
  const anchor={x:(b.minx+b.maxx)/2,y:(b.miny+b.maxy)/2,z:b.minz};
  meshes.forEach(m=>m.verts=m.verts.map(v=>({x:v.x-anchor.x,y:v.y-anchor.y,z:v.z-anchor.z})));
  const widthAxis=(b.maxx-b.minx)>=(b.maxy-b.miny)?0:Math.PI/2;
  return {kind,meshes,anchor,width:Math.max(b.maxx-b.minx,b.maxy-b.miny),
    depth:Math.min(b.maxx-b.minx,b.maxy-b.miny),height:b.maxz-b.minz,widthAxis};
}
function atPartBounds(verts){
  const b={minx:Infinity,miny:Infinity,minz:Infinity,maxx:-Infinity,maxy:-Infinity,maxz:-Infinity};
  (verts||[]).forEach(v=>{b.minx=Math.min(b.minx,v.x);b.maxx=Math.max(b.maxx,v.x);
    b.miny=Math.min(b.miny,v.y);b.maxy=Math.max(b.maxy,v.y);
    b.minz=Math.min(b.minz,v.z);b.maxz=Math.max(b.maxz,v.z);});
  return b;
}
function atPartXmlSource(bundleKey,fileName){
  if(typeof AT_PART_FDD_XML==='object'&&AT_PART_FDD_XML&&AT_PART_FDD_XML[bundleKey])
    return Promise.resolve(AT_PART_FDD_XML[bundleKey]);
  return fetch('assets/fdd/'+encodeURIComponent(fileName)).then(response=>{
    if(!response.ok) throw new Error(fileName+' を読み込めません');
    return response.text();
  });
}
function atPartLoadTemplates(){
  if(atParts.loadPromise) return atParts.loadPromise;
  const jobs=[];
  Object.keys(AT_PART_FILES).forEach(kind=>{
    if(kind==='ac') return;
    jobs.push(atPartXmlSource(kind,AT_PART_FILES[kind]).then(xml=>{
      atParts.templates[kind]=atPartParseFdd(xml,kind,AT_PART_FILES[kind]);
    }));
  });
  AT_AC_DIRS.forEach(dir=>{
    const file=AT_AC_FILES[dir], key=AT_AC_BUNDLE[dir];
    jobs.push(atPartXmlSource(key,file).then(xml=>{
      atParts.acTemplates[dir]=atPartParseFdd(xml,'ac',file);
    }));
  });
  atParts.loadPromise=Promise.all(jobs).then(()=>{
    atParts.templates.ac=atParts.acTemplates['水平'];
    atParts.loadError='';
    if(typeof atRenderRoomViewer==='function'&&atMesh) atRenderRoomViewer();
  }).catch(err=>{atParts.loadError=err.message;atParts.loadPromise=null;
    if(typeof atRenderRoomViewer==='function'&&atMesh) atRenderRoomViewer();});
  return atParts.loadPromise;
}
function atPartAcDir(item){
  return item&&AT_AC_DIRS.includes(item.blowDir)?item.blowDir:'水平';
}
function atPartAcTemplate(item){
  return (item&&atParts.acTemplates[atPartAcDir(item)])||atParts.templates.ac;
}
function atPartAcLabel(item){
  return item&&item.kind==='ac'?'エアコン '+atPartAcDir(item):(AT_PART_LABELS[item&&item.kind]||'パーツ');
}
function atPartTemplatesReady(){
  return AT_AC_DIRS.every(d=>!!atParts.acTemplates[d])&&!!atParts.templates.door&&!atParts.loadError;
}
function atPartAcTableFlow(dir,vol){
  const row=(typeof flowTable==='object'&&flowTable[dir])||(typeof flowTable==='object'&&flowTable['水平'])||{};
  const v=row[vol];
  return Number.isFinite(v)?v:(Number.isFinite(row['強'])?row['強']:0);
}
function atPartAcUnits(){
  return atParts.items.filter(it=>it.kind==='ac');
}
function atPartAcFlowSummary(vol){
  const units=atPartAcUnits();
  const dirs=units.map(atPartAcDir);
  const flows=units.map(it=>atPartAcTableFlow(atPartAcDir(it),vol));
  const unique=[...new Set(dirs)];
  const total=flows.reduce((s,v)=>s+v,0);
  return {units,dirs,flows,unique,same:unique.length<=1,dir:unique[0]||'水平',
    total,per:units.length?total/units.length:0};
}
function atPartFloorZ(floor){
  const rs=((typeof atMesh!=='undefined'&&atMesh&&atMesh.rooms)||[]).filter(r=>String(r.floor)===String(floor));
  return rs.length?Math.min(...rs.map(r=>r.z)):null;
}
function atPartWorldMeshes(item){
  const tpl=item.kind==='ac'?atPartAcTemplate(item):atParts.templates[item.kind];
  if(!tpl) return [];
  const zFloor=atPartFloorZ(item.floor);
  if(zFloor==null) return [];
  const a=(Number(item.angle)||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const zBase=zFloor+(item.kind==='ac'?2:0);
  return tpl.meshes.map(m=>({key:m.key,name:m.name,kind:item.kind,id:item.id, floor:item.floor,
    verts:m.verts.map(v=>({x:item.x+v.x*c-v.y*s,y:item.y+v.x*s+v.y*c,z:zBase+v.z})),tris:m.tris}));
}
function atPartSupplyDirection(world){
  const body=world.find(m=>m.key==='ac_body'),supply=world.find(m=>m.key==='ac_supply');
  if(!body||!supply||!supply.verts.length) return null;
  const b=atPartBounds(body.verts);
  const center={x:(b.minx+b.maxx)/2,y:(b.miny+b.maxy)/2};
  const outlet={x:supply.verts.reduce((n,v)=>n+v.x,0)/supply.verts.length,
    y:supply.verts.reduce((n,v)=>n+v.y,0)/supply.verts.length};
  const dx=outlet.x-center.x,dy=outlet.y-center.y,length=Math.hypot(dx,dy);
  return length>1e-5?{x:dx/length,y:dy/length}:null;
}
function atPartMeshesMm(){
  if(typeof appMode==='undefined'||appMode!=='architrend'||!atMesh) return [];
  return atParts.items.flatMap(item=>atPartWorldMeshes(item).map(mesh=>({
    ...mesh, verts:mesh.verts.map(v=>({x:v.x*1000,y:v.y*1000,z:v.z*1000}))
  })));
}
function atPartReviewData(){
  return {items:JSON.parse(JSON.stringify(atParts.items)),overrides:{...atParts.overrides},
    managedAc:!!atParts.managedAc};
}
function atPartRestoreReview(data){
  const p=data||{};
  atParts.items=Array.isArray(p.items)?p.items.filter(it=>it&&!it.sourceFaceId&&
    Object.prototype.hasOwnProperty.call(AT_PART_FILES,it.kind)&&/^part-\d+$/.test(String(it.id))&&
    Number.isFinite(it.x)&&Number.isFinite(it.y)&&Number.isFinite(it.angle)&&
    Number.isInteger(Number(it.floor))&&Number(it.floor)>0):[];
  atParts.overrides=p.overrides&&typeof p.overrides==='object'?{...p.overrides}:{};
  atParts.managedAc=!!p.managedAc;
  atParts.items.forEach(it=>{if(it.kind==='ac') it.blowDir=atPartAcDir(it);});
  atParts.seq=atParts.items.reduce((max,it)=>Math.max(max,Number(String(it.id).replace(/\D/g,''))||0),0);
  atParts.selected='';atParts.selectedFace='';atParts.mode='select';
  atPartApplyOverrides();
  atPartSyncAcCount(false);
}
function atPartFaceOrient(face){
  const north=(typeof atRoomView!=='undefined'&&atRoomView)?Number(atRoomView.northDeg)||0:0;
  if(face&&Number.isFinite(face.modelToolAz)&&typeof at3dsOrientFromToolAz==='function'&&typeof at3dsWrap180==='function'){
    return at3dsOrientFromToolAz(at3dsWrap180(face.modelToolAz-north));
  }
  return '南';
}
function atPartApplyOverrides(){
  if(!atMesh) return;
  atMesh.meshFaces.forEach((f,i)=>{
    const id=String(f.atFaceId==null?i:f.atFaceId);
    if(f.atOriginalKey===undefined){f.atOriginalKey=f.sslKey;f.atOriginalName=f.nameJa;}
    if(f.atOriginalKey==='window'&&atParts.overrides[id]==='door'){
      f.sslKey='extdoor_'+atPartFaceOrient(f);
      f.nameJa='ドア';
      f.atReplacedByPart=false;
    }else{
      f.sslKey=f.atOriginalKey;f.nameJa=f.atOriginalName;f.atReplacedByPart=false;
    }
  });
  if(typeof atApplyNorthToMesh==='function') atApplyNorthToMesh();
}
function atPartSyncAcCount(recalculate){
  const el=document.getElementById('acCount');
  if(!el) return;
  if(!atParts.managedAc||typeof appMode==='undefined'||appMode!=='architrend'){
    el.readOnly=false;el.min='1';
    atPartSyncAcFlow();
    return;
  }
  el.readOnly=true;el.min='0';el.value=String(atPartAcUnits().length);
  atPartSyncAcFlow();
  if(recalculate&&typeof runAll==='function') runAll();
}
function atPartSyncAcFlow(){
  const dirEl=document.getElementById('dirSel');
  const flowEl=document.getElementById('flowPerUnit');
  const note=document.getElementById('dirSelNote');
  if(!dirEl||!flowEl) return;
  const managed=!!atParts.managedAc&&typeof appMode!=='undefined'&&appMode==='architrend';
  const units=atPartAcUnits();
  if(!managed||!units.length){
    dirEl.disabled=false;
    flowEl.readOnly=false;
    if(note) note.hidden=true;
    return;
  }
  const volEl=document.getElementById('volSel');
  const vol=volEl?volEl.value:'強';
  const sum=atPartAcFlowSummary(vol);
  dirEl.disabled=true;
  flowEl.readOnly=true;
  if(sum.same){
    dirEl.value=sum.dir;
    flowEl.value=String(sum.per);
  }else flowEl.value=String(Math.round(sum.per));
  if(note){
    note.hidden=false;
    const mix=sum.unique.map(d=>d+'×'+sum.dirs.filter(x=>x===d).length).join('、');
    note.textContent=sum.same
      ? '配置したエアコンの風向（'+sum.dir+'）を使います。変更は部屋の確認ビューワーの各台から。'
      : '台ごとに風向が違います（'+mix+'）。総風量は各台の実測風量の合計です。';
  }
}
function atPartChanged(recalculate){
  atPartApplyOverrides();
  atPartSyncAcCount(false);
  if(typeof atSyncMeshWindowsToRooms==='function') atSyncMeshWindowsToRooms();
  if(typeof atApplyRoomGainFlags==='function') atApplyRoomGainFlags(atMesh);
  if(typeof atBuildGainVolumes==='function') atMesh.gainVolumes=atBuildGainVolumes(atMesh);
  if(typeof at3dsEcho==='function') at3dsEcho();
  if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
  if(recalculate!==false&&typeof runAll==='function') runAll();
  if(typeof saveStateDebounced==='function') saveStateDebounced();
  if(typeof atRenderRoomViewer==='function') atRenderRoomViewer();
}

function atPartWallCandidates(floor){
  if(!atMesh) return [];
  const z=atPartFloorZ(floor);
  if(z==null) return [];
  return atMesh.meshFaces.flatMap(f=>{
    if(typeof atIsPartition!=='function'||!atIsPartition(f)) return [];
    const vs=f.verts||[];
    if(!vs.length||Math.max(...vs.map(v=>v.z))<z+0.8||Math.min(...vs.map(v=>v.z))>z+1.8) return [];
    const seg=atWallSeg(f);
    return seg?[{seg,face:f}]:[];
  });
}
function atPartSnapDoor(x,y,floor,kind){
  const tpl=atParts.templates[kind];
  if(!tpl) return null;
  let best=null;
  atPartWallCandidates(floor).forEach(({seg,face})=>{
    const half=tpl.width/2;
    let px,py,angle,len;
    if(seg.axis==='x'){
      len=seg.y1-seg.y0;if(len<tpl.width-0.01) return;
      px=seg.x;py=Math.max(seg.y0+half,Math.min(seg.y1-half,y));angle=90;
    }else{
      len=seg.x1-seg.x0;if(len<tpl.width-0.01) return;
      py=seg.y;px=Math.max(seg.x0+half,Math.min(seg.x1-half,x));angle=0;
    }
    const dist=Math.hypot(px-x,py-y);
    if(!best||dist<best.distance) best={x:px,y:py,angle:angle-tpl.widthAxis*180/Math.PI,
      distance:dist,wallFaceId:face.atFaceId};
  });
  return best&&best.distance<=0.75?best:null;
}
function atPartAdd(kind,floor,x,y,extra){
  const blowDir=kind==='ac'?atPartAcDir({blowDir:extra&&extra.blowDir||atParts.lastBlowDir}):'';
  if(kind==='ac' && !atPartAcTemplate({kind:'ac',blowDir})) return false;
  if(kind!=='ac' && !atParts.templates[kind]) return false;
  if(atPartFloorZ(floor)==null) return false;
  if(kind==='ac' && !atMesh.rooms.some(r=>String(r.floor)===String(floor)&&atPointInRing(x,y,r.ring))) return false;
  let position={x,y,angle:0};
  if(kind!=='ac'){
    const snapped=atPartSnapDoor(x,y,floor,kind);
    if(!snapped) return false;
    position=snapped;
  }
  if(typeof atSnapshotRoomEdit==='function') atSnapshotRoomEdit();
  const id='part-'+(++atParts.seq);
  const item={id,kind,floor:Number(floor),x:position.x,y:position.y,angle:position.angle,
    sourceFaceId:extra&&extra.sourceFaceId?String(extra.sourceFaceId):'',flip:false};
  if(kind==='ac'){item.blowDir=blowDir;atParts.lastBlowDir=blowDir;atParts.managedAc=true;}
  atParts.items.push(item);
  atParts.selected=id;
  atParts.mode='select';
  atPartChanged();
  return true;
}
function atPartSetBlowDir(id,dir){
  const it=atParts.items.find(p=>p.id===id);
  if(!it||it.kind!=='ac'||!AT_AC_DIRS.includes(dir)||it.blowDir===dir) return;
  atSnapshotRoomEdit();
  it.blowDir=dir;
  atParts.lastBlowDir=dir;
  atPartChanged();
}
function atPartRemove(id){
  const i=atParts.items.findIndex(it=>it.id===id);
  if(i<0) return;
  atSnapshotRoomEdit();
  atParts.items.splice(i,1);
  if(atParts.selected===id) atParts.selected='';
  atPartChanged();
}
function atPartConvertFace(faceId){
  if(!atMesh) return;
  const face=atMesh.meshFaces.find(f=>String(f.atFaceId)===String(faceId));
  const original=face&&(face.atOriginalKey||face.sslKey);
  if(!face||original!=='window') return;
  if(atParts.overrides[String(faceId)]==='door') return;
  atSnapshotRoomEdit();
  atParts.overrides[String(faceId)]='door';
  atParts.items=atParts.items.filter(it=>it.sourceFaceId!==String(faceId));
  atParts.selected='';
  atParts.selectedFace=String(faceId);
  atParts.mode='select';
  atPartChanged();
}
function atPartResetFace(faceId){
  if(!atParts.overrides[String(faceId)]) return;
  atSnapshotRoomEdit();
  delete atParts.overrides[String(faceId)];
  atParts.items=atParts.items.filter(it=>it.sourceFaceId!==String(faceId));
  atParts.selected='';
  atPartChanged();
}
function atPartSetKind(id,kind){
  const it=atParts.items.find(p=>p.id===id);
  if(!it||it.kind==='ac'||kind==='ac'||!atParts.templates[kind]) return;
  const snap=atPartSnapDoor(it.x,it.y,it.floor,kind);
  if(!snap) return;
  atSnapshotRoomEdit();
  it.kind=kind;it.x=snap.x;it.y=snap.y;it.angle=snap.angle+(it.flip?180:0);
  atPartChanged();
}
function atPartRotateAc(id,angle){
  const it=atParts.items.find(p=>p.id===id);
  if(!it||it.kind!=='ac'||!Number.isFinite(Number(angle))) return;
  atSnapshotRoomEdit();it.angle=((Number(angle)%360)+360)%360;atPartChanged();
}
function atPartFlipDoor(id){
  const it=atParts.items.find(p=>p.id===id);
  if(!it||it.kind==='ac') return;
  atSnapshotRoomEdit();it.flip=!it.flip;it.angle=(it.angle+180)%360;atPartChanged();
}
function atPartFaceFloor(face){
  const z=atFaceZ(face);
  const rs=(atMesh&&atMesh.rooms||[]).filter(r=>z>=r.z-0.1&&z<=r.zTop+0.1);
  return rs.length?rs.sort((a,b)=>b.z-a.z)[0].floor:null;
}
function atPartToolbarHtml(){
  const mode=atParts.mode, ready=atPartTemplatesReady();
  return `<div class="at-part-toolbar" role="group" aria-label="設備・ドアの配置">
    <b>設備・ドア</b>
    <button type="button" data-part-mode="select" aria-pressed="${mode==='select'}">選択</button>
    <button type="button" data-part-mode="ac" aria-pressed="${mode==='ac'}" ${ready?'':'disabled'}>＋ エアコン</button>
    <button type="button" data-part-mode="door" aria-pressed="${mode==='door'}" ${ready?'':'disabled'}>＋ ドア</button>
    <label>ドアの種類 <select id="atDoorPartKind"><option value="door" ${atParts.doorKind==='door'?'selected':''}>ドア</option><option value="swing" ${atParts.doorKind==='swing'?'selected':''}>開戸</option><option value="slide" ${atParts.doorKind==='slide'?'selected':''}>引戸</option></select></label>
    <span class="small">${atParts.loadError?escapeHtml(atParts.loadError):(ready?(mode==='ac'?'平面図の部屋をクリック。置いたあと風向（水平 / 30° / 50°）を選びます。底面はFL+2000 mmです。':mode==='door'?'平面図の壁をクリック。壁へ吸着します。':'平面図で配置・移動できます。'):'FDDパーツを読み込み中…')}</span>
  </div>`;
}
function atPartSideHtml(){
  const floor=atRoomView.floor;
  const items=atParts.items.filter(it=>floor==='all'||String(it.floor)===floor);
  const selected=atParts.items.find(it=>it.id===atParts.selected);
  const faces=(atMesh&&atMesh.meshFaces||[]).filter(f=>
    (f.atOriginalKey||f.sslKey)==='window'&&(floor==='all'||String(atPartFaceFloor(f))===floor));
  return `<section class="at-part-side"><h4>配置したエアコン・ドア</h4>
    ${items.length?items.map(it=>`<div class="at-part-row"><button type="button" class="at-part-item" data-part-select="${it.id}" aria-pressed="${it.id===atParts.selected}">${escapeHtml(atPartAcLabel(it))} · ${it.floor}F · (${it.x.toFixed(2)}, ${it.y.toFixed(2)}) m${it.kind==='ac'?' · 底面FL+2000 mm':''}</button><button type="button" class="at-part-quick-delete" data-part-remove="${it.id}" aria-label="${escapeHtml(atPartAcLabel(it))}を削除">削除</button></div>`).join(''):'<p class="small">まだ配置していません。</p>'}
    ${selected?`<div class="at-part-edit"><b>${escapeHtml(atPartAcLabel(selected))} · ${selected.floor}F</b>
      ${selected.kind==='ac'?`<label>風向 <select id="atPartBlowDir">${AT_AC_DIRS.map(d=>`<option value="${d}" ${atPartAcDir(selected)===d?'selected':''}>${d}</option>`).join('')}</select></label><label>平面回転角 <input id="atPartAngle" type="number" step="15" value="${Math.round(selected.angle)}">°</label><p class="small">赤い矢印が吹出方向 · ×の右の円をドラッグすると平面角度が回ります · 本体底面 FL+2000 mm</p>`:
      `<label>パーツ <select id="atSelectedDoorKind">${['door','swing','slide'].map(k=>`<option value="${k}" ${selected.kind===k?'selected':''}>${escapeHtml(AT_PART_LABELS[k])}</option>`).join('')}</select></label><button type="button" data-part-action="flip">向きを反転</button>`}
      <button type="button" data-part-action="remove">配置を削除</button></div>`:''}
    <h4>窓・ドアの認識</h4><p class="small">入口など窓と誤認識した面を選ぶと、同じ形のまま外部扉になります。隙間は作りません。</p>
    <div class="at-part-face-list">${faces.map(f=>{
      const id=String(f.atFaceId),isDoor=atParts.overrides[id]==='door';
      const b=atFaceBBox(f);
      return `<div class="at-part-face"><button type="button" data-face-select="${id}" aria-pressed="${atParts.selectedFace===id}">${isDoor?'ドア':'窓'} ${escapeHtml(f.idfName||('#'+id))} · (${((b.minx+b.maxx)/2).toFixed(2)}, ${((b.miny+b.maxy)/2).toFixed(2)}) m</button>
        <button type="button" data-face-action="${isDoor?'reset':'convert'}" data-face-id="${id}">${isDoor?'窓に戻す':'ドアにする'}</button></div>`;
    }).join('')}</div></section>`;
}
function atPartHandleButton(btn){
  if(btn.dataset.partMode){atParts.mode=btn.dataset.partMode;atRoomView.plan=atParts.mode!=='select'||atRoomView.plan;atRenderRoomViewer();return true;}
  if(btn.dataset.partRemove){atPartRemove(btn.dataset.partRemove);return true;}
  if(btn.dataset.partSelect){atParts.selected=btn.dataset.partSelect;atParts.mode='select';atRenderRoomViewer();return true;}
  if(btn.dataset.faceSelect){atParts.selectedFace=btn.dataset.faceSelect;atParts.mode='select';atRenderRoomViewer();return true;}
  if(btn.dataset.faceAction){if(btn.dataset.faceAction==='convert')atPartConvertFace(btn.dataset.faceId);
    else atPartResetFace(btn.dataset.faceId);return true;}
  if(btn.dataset.partAction){if(btn.dataset.partAction==='remove') atPartRemove(atParts.selected);
    else if(btn.dataset.partAction==='flip') atPartFlipDoor(atParts.selected);return true;}
  return false;
}

function atPartSceneHtml(rooms,project){
  if(!atMesh) return '';
  const floors=new Set(rooms.map(r=>String(r.floor)));
  let html='';
  (atMesh.meshFaces||[]).forEach(f=>{
    if((f.atOriginalKey||f.sslKey)!=='window'||!floors.has(String(atPartFaceFloor(f)))) return;
    const vs=f.verts||[];
    if(vs.length<2) return;
    let a=null,b=null,dist=-1;
    for(let i=0;i<vs.length;i++) for(let j=i+1;j<vs.length;j++){
      const d=Math.hypot(vs[i].x-vs[j].x,vs[i].y-vs[j].y);
      if(d>dist){dist=d;a=vs[i];b=vs[j];}
    }
    if(!(dist>0.1)) return;
    const z=(Math.min(...vs.map(v=>v.z))+Math.max(...vs.map(v=>v.z)))/2;
    const p=project({...a,z}),q=project({...b,z});
    const id=String(f.atFaceId),isDoor=atParts.overrides[id]==='door';
    const stroke=isDoor?'#ea7037':'#238fc0',selected=atParts.selectedFace===id;
    html+=`<g data-face-id="${id}" class="at-part-face-mark"><line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${selected?'#fff':stroke}" stroke-width="${selected?10:4}"/><line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${stroke}" stroke-width="4"/><line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="transparent" stroke-width="16"/><title>${isDoor?'ドア':'窓'} ${escapeHtml(f.idfName||id)}</title></g>`;
  });
  atParts.items.filter(it=>floors.has(String(it.floor))).forEach(it=>{
    const tpl=it.kind==='ac'?atPartAcTemplate(it):atParts.templates[it.kind];
    if(!tpl) return;
    const world=atPartWorldMeshes(it),body=world.find(m=>m.key===(it.kind==='ac'?'ac_body':'doorbody'));
    if(!body) return;
    const color=it.kind==='ac'?'#284f9c':'#ea7037';
    const label=atPartAcLabel(it);
    const p=project({x:it.x,y:it.y,z:atPartFloorZ(it.floor)+(it.kind==='ac'?2.15:1.1)});
    html+=`<g data-part-id="${it.id}" class="at-part-scene-item">`;
    if(it.kind==='ac'){
      body.tris.forEach(t=>{
        const pts=t.map(i=>project(body.verts[i]));
        html+=`<polygon points="${pts.map(q=>q.x.toFixed(1)+','+q.y.toFixed(1)).join(' ')}" fill="${color}" fill-opacity="0.82" stroke="#15336a" stroke-width="1"/>`;
      });
      const direction=atPartSupplyDirection(world);
      if(direction){
        const tip=project({x:it.x+direction.x*0.9,y:it.y+direction.y*0.9,z:atPartFloorZ(it.floor)+2.15});
        html+=`<g class="at-part-ac-flow" pointer-events="none"><line x1="${p.x}" y1="${p.y}" x2="${tip.x}" y2="${tip.y}" stroke="white" stroke-width="8"/><line data-part-arrow="${it.id}" x1="${p.x}" y1="${p.y}" x2="${tip.x}" y2="${tip.y}" stroke="#cf3427" stroke-width="4" marker-end="url(#atAcSupplyArrow)"/><text x="${tip.x+9}" y="${tip.y-7}" class="at-part-flow-label">吹出</text></g>`;
      }
    }else{
      const b=atPartBounds(body.verts);
      const a=it.angle*Math.PI/180, c=Math.cos(a),s=Math.sin(a);
      const d=tpl.width/2;
      const axis=tpl.widthAxis;
      const dx=Math.cos(axis)*d,dy=Math.sin(axis)*d;
      const u=project({x:it.x-dx*c+dy*s,y:it.y-dx*s-dy*c,z:atPartFloorZ(it.floor)+0.05});
      const v=project({x:it.x+dx*c-dy*s,y:it.y+dx*s+dy*c,z:atPartFloorZ(it.floor)+0.05});
      html+=`<line x1="${u.x}" y1="${u.y}" x2="${v.x}" y2="${v.y}" stroke="${color}" stroke-width="7" stroke-linecap="round"/>`;
      if(!atRoomView.plan) body.tris.forEach(t=>{
        const pts=t.map(i=>project(body.verts[i]));
        html+=`<polygon points="${pts.map(q=>q.x.toFixed(1)+','+q.y.toFixed(1)).join(' ')}" fill="${color}" fill-opacity="0.76" stroke="#8b3820" stroke-width="1"/>`;
      });
    }
    html+=`<circle cx="${p.x}" cy="${p.y}" r="${atParts.selected===it.id?9:6}" fill="${color}" stroke="white" stroke-width="2"/><text x="${p.x+10}" y="${p.y-10}" class="at-part-label">${escapeHtml(label)}</text>`;
    if(it.kind==='ac'){
      const dir=atPartAcDir(it), dx=p.x-28, dy=p.y+16;
      html+=`<g data-part-dir="${it.id}" class="at-part-dir" role="button" tabindex="0" aria-label="風向 ${escapeHtml(dir)} を変更"><rect x="${(dx-22).toFixed(1)}" y="${(dy-11).toFixed(1)}" width="44" height="22" rx="11"/><text x="${dx.toFixed(1)}" y="${(dy+4).toFixed(1)}">${escapeHtml(dir)}</text><title>風向 ${escapeHtml(dir)} · クリックで変更</title></g>`;
    }
    html+=`<g data-part-delete="${it.id}" class="at-part-delete" role="button" tabindex="0" aria-label="${escapeHtml(label)}を削除"><circle cx="${p.x+16}" cy="${p.y+16}" r="10"/><path d="M${p.x+12} ${p.y+12}l8 8m0-8l-8 8"/><title>${escapeHtml(label)}を削除</title></g>`;
    if(it.kind==='ac'){
      const gx=p.x+40, gy=p.y+16;
      html+=`<g data-part-rotate="${it.id}" class="at-part-rotate" role="button" tabindex="0" aria-label="${escapeHtml(label)}の平面角度を回す"><circle cx="${gx}" cy="${gy}" r="10"/><path d="M${gx-3.2} ${gy-4.2}a5.2 5.2 0 1 1-1.6 6.4"/><path d="M${gx-6.2} ${gy+1.2}l3.2 2.2 1.6-3.4"/><title>ドラッグで平面角度を回転</title></g>`;
    }
    html+=`<title>${escapeHtml(label)} ${it.floor}F</title></g>`;
  });
  return `<g class="at-part-overlay"><defs><marker id="atAcSupplyArrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#cf3427"/></marker></defs>${html}</g>`;
}
function atPartWrapDeg(deg){
  return ((Number(deg)%360)+360)%360;
}
function atPartPointerAngle(it, e, svg){
  const pt=atSceneSvgPoint(e, svg);
  const w=atSceneUnprojectXY(pt.x, pt.y, atPartFloorZ(it.floor));
  return Math.atan2(w.y-it.y, w.x-it.x)*180/Math.PI;
}
function atPartPointerDown(e,svg){
  const dir=e.target.closest('[data-part-dir]'),del=e.target.closest('[data-part-delete]'),rot=e.target.closest('[data-part-rotate]'),part=e.target.closest('[data-part-id]'),face=e.target.closest('[data-face-id]');
  if(!dir&&!del&&!rot&&!part&&!face&&(atParts.mode==='select'||!atRoomView.plan)) return false;
  const rotateId=rot?.dataset.partRotate||'';
  atParts.drag={dirId:dir?.dataset.partDir||'',deleteId:del?.dataset.partDelete||'',rotateId,
    partId:(!dir&&!del&&!rot&&part)?part.dataset.partId:'',faceId:face?.dataset.faceId||'',
    place:!dir&&!del&&!rot&&!part&&!face&&atParts.mode!=='select',x:e.clientX,y:e.clientY,moved:false,snapshot:false};
  if(rotateId){
    const it=atParts.items.find(p=>p.id===rotateId);
    if(it) atParts.drag.rotateBase=it.angle-atPartPointerAngle(it, e, svg);
  }
  svg.setPointerCapture(e.pointerId);
  return true;
}
function atPartPointerMove(e,svg){
  const d=atParts.drag;
  if(!d) return false;
  if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>4) d.moved=true;
  if(d.rotateId){
    const it=atParts.items.find(p=>p.id===d.rotateId);
    if(!it) return true;
    if(!d.snapshot){atSnapshotRoomEdit();d.snapshot=true;}
    it.angle=atPartWrapDeg(d.rotateBase+atPartPointerAngle(it, e, svg));
    atDrawRoomScene();
    return true;
  }
  if(d.deleteId || d.dirId) return true;
  if(d.partId&&d.moved&&atRoomView.plan){
    const it=atParts.items.find(p=>p.id===d.partId);
    if(!it) return true;
    if(!d.snapshot){atSnapshotRoomEdit();d.snapshot=true;}
    const pt=atSceneSvgPoint(e,svg),w=atSceneUnprojectXY(pt.x,pt.y,atPartFloorZ(it.floor));
    if(it.kind==='ac'){it.x=w.x;it.y=w.y;}
    else{
      const snap=atPartSnapDoor(w.x,w.y,it.floor,it.kind);
      if(snap){it.x=snap.x;it.y=snap.y;it.angle=snap.angle+(it.flip?180:0);}
    }
    atDrawRoomScene();
  }
  return true;
}
function atPartPointerUp(e,svg){
  const d=atParts.drag;
  if(!d) return false;
  atParts.drag=null;
  if(svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  if(d.rotateId){atParts.selected=d.rotateId;atParts.mode='select';if(d.snapshot)atPartChanged();else atRenderRoomViewer();return true;}
  if(d.dirId){if(!d.moved)atPartAskBlowDirEdit(d.dirId);return true;}
  if(d.deleteId){if(!d.moved)atPartRemove(d.deleteId);return true;}
  if(d.partId){atParts.selected=d.partId;atParts.mode='select';if(d.snapshot)atPartChanged();else atRenderRoomViewer();return true;}
  if(d.faceId){atParts.selectedFace=d.faceId;atParts.mode='select';atRenderRoomViewer();return true;}
  if(d.place){
    const floor=atRoomView.floor;
    if(floor==='all') return true;
    const pt=atSceneSvgPoint(e,svg),w=atSceneUnprojectXY(pt.x,pt.y,atPartFloorZ(floor));
    const kind=atParts.mode==='ac'?'ac':atParts.doorKind;
    if(kind==='ac'){
      if(!atMesh.rooms.some(r=>String(r.floor)===String(floor)&&atPointInRing(w.x,w.y,r.ring))){
        const status=document.getElementById('atRoomReviewStatus');
        if(status) status.textContent='この階の床の上を選んでください。';
        return true;
      }
      atPartAskBlowDir(floor,w.x,w.y);
      return true;
    }
    const placed=atPartAdd(kind,floor,w.x,w.y);
    if(!placed){
      const status=document.getElementById('atRoomReviewStatus');
      if(status) status.textContent='壁の近くを選んでください。パーツ幅が収まる壁に吸着します。';
    }
    return true;
  }
  return true;
}

function atPartAskBlowDir(floor,x,y){
  atParts.pendingAc={floor,x,y};
  atParts.pendingAcId='';
  atPartShowBlowDirDialog();
}
function atPartAskBlowDirEdit(id){
  const it=atParts.items.find(p=>p.id===id);
  if(!it||it.kind!=='ac') return;
  atParts.pendingAc=null;
  atParts.pendingAcId=id;
  atParts.selected=id;
  atPartShowBlowDirDialog();
}
function atPartBlowDirHint(dir){
  if(dir==='水平') return 'ノッチ強 608 ㎥/h';
  if(dir==='30°') return 'ノッチ共通 1000 ㎥/h';
  if(dir==='50°') return 'ノッチ3・強 1510 ㎥/h';
  return '';
}
function atPartShowBlowDirDialog(){
  let overlay=document.getElementById('atAcDirDialog');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='atAcDirDialog';
    overlay.className='at-ac-dir-overlay';
    overlay.hidden=true;
    overlay.innerHTML=`<div class="at-ac-dir-panel" role="dialog" aria-modal="true" aria-labelledby="atAcDirTitle">
      <h3 id="atAcDirTitle">エアコンの風向</h3>
      <p class="small">吹き出し方向で処理熱量の風量が決まります。平面図のエアコン横の風向表示からも変えられます。</p>
      <div class="at-ac-dir-choices">${AT_AC_DIRS.map(d=>`<button type="button" data-ac-dir="${d}"><b>${d}</b><span>${atPartBlowDirHint(d)}</span></button>`).join('')}</div>
      <button type="button" class="at-ac-dir-cancel" data-ac-dir-cancel>キャンセル</button>
    </div>`;
    overlay.addEventListener('click',e=>{
      if(e.target===overlay || e.target.closest('[data-ac-dir-cancel]')){atPartCancelPendingAc();return;}
      const dir=e.target.closest('[data-ac-dir]')?.dataset.acDir;
      if(dir) atPartConfirmPendingAc(dir);
    });
    document.body.appendChild(overlay);
  }
  overlay.hidden=false;
  const edit=atParts.items.find(p=>p.id===atParts.pendingAcId);
  const pick=edit?atPartAcDir(edit):(atParts.lastBlowDir||'水平');
  const buttons=[...overlay.querySelectorAll('[data-ac-dir]')];
  buttons.forEach(b=>b.setAttribute('aria-pressed', b.dataset.acDir===pick?'true':'false'));
  const btn=buttons.find(b=>b.dataset.acDir===pick)||buttons[0];
  if(btn) btn.focus();
}
function atPartHideBlowDirDialog(){
  const overlay=document.getElementById('atAcDirDialog');
  if(overlay) overlay.hidden=true;
}
function atPartConfirmPendingAc(dir){
  const pending=atParts.pendingAc, editId=atParts.pendingAcId;
  atParts.pendingAc=null;
  atParts.pendingAcId='';
  atPartHideBlowDirDialog();
  if(!AT_AC_DIRS.includes(dir)) return;
  atParts.lastBlowDir=dir;
  if(editId){atPartSetBlowDir(editId,dir);return;}
  if(pending) atPartAdd('ac',pending.floor,pending.x,pending.y,{blowDir:dir});
}
function atPartCancelPendingAc(){
  const overlay=document.getElementById('atAcDirDialog');
  const open=!!(overlay&&!overlay.hidden)||!!atParts.pendingAc||!!atParts.pendingAcId;
  atParts.pendingAc=null;
  atParts.pendingAcId='';
  atPartHideBlowDirDialog();
  return open;
}

atPartLoadTemplates();

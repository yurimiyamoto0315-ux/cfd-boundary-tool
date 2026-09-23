// ========================= IDF → 色分け 3DS 書き出し =========================
// EnergyPlus の meshFaces (12-energyplus.js) から厚みなしポリゴンの 3DS を作る。
// 窓は親壁と同一平面にぴったり重ねる（色で識別）。出力単位は m。
// 家・埋メ・発熱は同じオフセットで出し、合体概形 AABB の最小XYZ（左下）を原点にする。

const IDF_MESH_PALETTE = {
  wall_北: {r:40, g:80, b:180, mat:'WALL_N'},
  wall_北東: {r:35, g:125, b:185, mat:'WALL_NE'},
  wall_東: {r:40, g:160, b:80, mat:'WALL_E'},
  wall_南東: {r:145, g:175, b:50, mat:'WALL_SE'},
  wall_南: {r:200, g:60, b:50, mat:'WALL_S'},
  wall_南西: {r:205, g:105, b:45, mat:'WALL_SW'},
  wall_西: {r:180, g:140, b:40, mat:'WALL_W'},
  wall_北西: {r:115, g:90, b:175, mat:'WALL_NW'},
  roof: {r:120, g:50, b:50, mat:'ROOF'},
  floor1: {r:90, g:90, b:90, mat:'FLOOR1'},
  floor_out: {r:95, g:70, b:55, mat:'FLOOROUT'},
  found: {r:70, g:50, b:40, mat:'FOUND'},
  attic: {r:160, g:150, b:175, mat:'ATTIC'},
  innerwall: {r:180, g:180, b:180, mat:'INNER'},
  window: {r:80, g:180, b:220, mat:'WINDOW'},
  doorbody: {r:255, g:96, b:24, mat:'DOOR'},
  extdoor_北: {r:80, g:20, b:10, mat:'EDOOR_N'},
  extdoor_北東: {r:120, g:30, b:10, mat:'EDOOR_NE'},
  extdoor_東: {r:160, g:45, b:15, mat:'EDOOR_E'},
  extdoor_南東: {r:200, g:70, b:20, mat:'EDOOR_SE'},
  extdoor_南: {r:240, g:100, b:30, mat:'EDOOR_S'},
  extdoor_南西: {r:180, g:55, b:10, mat:'EDOOR_SW'},
  extdoor_西: {r:140, g:35, b:5, mat:'EDOOR_W'},
  extdoor_北西: {r:100, g:25, b:5, mat:'EDOOR_NW'},
  doorgap_top: {r:98, g:164, b:70, mat:'DOOR_TOP'},
  doorgap_uc: {r:0, g:128, b:128, mat:'DOOR_UC'},
  ac_body: {r:128, g:128, b:128, mat:'AC_BODY'},
  ac_supply: {r:0, g:60, b:255, mat:'AC_SUPPLY'},
  ac_return: {r:29, g:109, b:53, mat:'AC_RETURN'},
  fill_solid: (typeof FILL_SOLID_COLOR!=='undefined') ? FILL_SOLID_COLOR : {r:61, g:61, b:61, mat:'FILL'},
  stair_solid: {r:150, g:118, b:72, mat:'STAIR'}
};

const IDF_MESH_SJIS = {
"\u5916":[0x8A,0x4F],
"\u58C1":[0x95,0xC7],
"\u5317":[0x96,0x6B],
"\u6771":[0x93,0x8C],
"\u5357":[0x93,0xEC],
"\u897F":[0x90,0xBC],
"\u7A93":[0x91,0x8B],
"\u5185":[0x93,0xE0],
"\u5C4B":[0x89,0xAE],
"\u6839":[0x8D,0xAA],
"\u5E8A":[0x8F,0xB0],
"\u57FA":[0x8A,0xEE],
"\u790E":[0x91,0x62],
"\u5C0F":[0x8F,0xAC],
"\u88CF":[0x97,0xA2],
"\u30C9":[0x83,0x68],
"\u30A2":[0x83,0x41],
"\u5929":[0x93,0x56],
"\u4E95":[0x88,0xE4],
"\u767A":[0x94,0xAD],
"\u71B1":[0x94,0x4D],
"\u968E":[0x8A,0x4B],
"\u6BB5":[0x92,0x69]
};

function idfMeshSjisBytes(text){
  const bytes = [];
  const bad = [];
  for(const ch of String(text)){
    const code = ch.codePointAt(0);
    if(code<128) bytes.push(code);
    else if(IDF_MESH_SJIS[ch]) IDF_MESH_SJIS[ch].forEach(b=>bytes.push(b));
    else if(bad.indexOf(ch)===-1) bad.push(ch);
  }
  return {bytes, bad};
}

function idfMeshU16(n){ return [n&255, (n>>>8)&255]; }
function idfMeshU32(n){ return [n&255, (n>>>8)&255, (n>>>16)&255, (n>>>24)&255]; }
function idfMeshF32(n){
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, n, true);
  return [dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)];
}
function idfMeshConcat(parts){
  const out = [];
  parts.forEach(p=>{
    if(p==null) return;
    if(typeof p==='number') out.push(p&255);
    else for(let i=0;i<p.length;i++) out.push(p[i]&255);
  });
  return out;
}
function idfMeshChunk(id, payload){
  const body = idfMeshConcat([payload]);
  return idfMeshConcat([idfMeshU16(id), idfMeshU32(6+body.length), body]);
}
function idfMeshAsciiZ(s){
  const bytes = [];
  const t = String(s||'');
  for(let i=0;i<t.length;i++) bytes.push(t.charCodeAt(i)&127);
  bytes.push(0);
  return bytes;
}
function idfMeshNameZ(str){
  const enc = idfMeshSjisBytes(str);
  if(enc.bad.length || enc.bytes.length>10){
    return {bytes: idfMeshAsciiZ(str.replace(/[^\x20-\x7E]/g,'').slice(0,10)||'OBJ'), ok:false};
  }
  return {bytes: enc.bytes.concat([0]), ok:true};
}

function idfMeshToMm(face){
  return (face.verts||[]).map(v=>({x:v.x*1000, y:v.y*1000, z:v.z*1000}));
}

function idfMeshTriangulate(n){
  const faces = [];
  for(let i=1;i<=n-2;i++) faces.push([0, i, i+1]);
  return faces;
}

function idfMeshColor24(col){
  return idfMeshChunk(0x0011, [col.r&255, col.g&255, col.b&255]);
}
function idfMeshMatEntry(name, col){
  const inner = idfMeshConcat([
    idfMeshChunk(0xA000, idfMeshAsciiZ(name)),
    idfMeshChunk(0xA010, idfMeshColor24(col)),
    idfMeshChunk(0xA020, idfMeshColor24(col)),
    idfMeshChunk(0xA030, idfMeshColor24({r:0,g:0,b:0}))
  ]);
  return idfMeshChunk(0xAFFF, inner);
}
function idfMeshNamedMesh(objNameBytes, verts, tris, matName){
  let pts = idfMeshU16(verts.length);
  verts.forEach(v=>{
    pts = idfMeshConcat([pts, idfMeshF32(v.x), idfMeshF32(v.y), idfMeshF32(v.z)]);
  });
  const pointChunk = idfMeshChunk(0x4110, pts);
  let faceBody = idfMeshU16(tris.length);
  tris.forEach(t=>{
    faceBody = idfMeshConcat([faceBody, idfMeshU16(t[0]), idfMeshU16(t[1]), idfMeshU16(t[2]), idfMeshU16(7)]);
  });
  let grp = idfMeshAsciiZ(matName);
  grp = idfMeshConcat([grp, idfMeshU16(tris.length)]);
  tris.forEach((_,i)=>{ grp = idfMeshConcat([grp, idfMeshU16(i)]); });
  faceBody = idfMeshConcat([faceBody, idfMeshChunk(0x4130, grp)]);
  const faceChunk = idfMeshChunk(0x4120, faceBody);
  const triObj = idfMeshChunk(0x4100, idfMeshConcat([pointChunk, faceChunk]));
  return idfMeshChunk(0x4000, idfMeshConcat([objNameBytes, triObj]));
}
function idfMeshNamedTri(objNameBytes, verts, matName){
  return idfMeshNamedMesh(objNameBytes, verts, idfMeshTriangulate(verts.length), matName);
}
function idfMeshDot(a,b){ return a.x*b.x+a.y*b.y+a.z*b.z; }
function idfMeshLen(v){ return Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z); }
function idfMeshNorm(v){
  const L=idfMeshLen(v);
  if(!(L>1e-12)) return null;
  return {x:v.x/L, y:v.y/L, z:v.z/L};
}
function idfMeshFacePlane(verts){
  if(!verts || verts.length<3) return null;
  let nx=0, ny=0, nz=0;
  for(let i=0;i<verts.length;i++){
    const a=verts[i], b=verts[(i+1)%verts.length];
    nx+=(a.y-b.y)*(a.z+b.z);
    ny+=(a.z-b.z)*(a.x+b.x);
    nz+=(a.x-b.x)*(a.y+b.y);
  }
  const n=idfMeshNorm({x:nx,y:ny,z:nz});
  if(!n) return null;
  if(n.z<0){ n.x=-n.x; n.y=-n.y; n.z=-n.z; }
  return {n:n, d:idfMeshDot(n, verts[0])};
}
function idfMeshPlaneZ(plane, x, y){
  if(Math.abs(plane.n.z)<1e-6) return null;
  return (plane.d-plane.n.x*x-plane.n.y*y)/plane.n.z;
}
function idfMeshSamePlane(a, b, angTol, distTol){
  if(!a || !b) return false;
  if(Math.abs(idfMeshDot(a.n, b.n))<Math.cos(angTol)) return false;
  return Math.abs(a.d-b.d)<=distTol;
}
function idfMeshConvexHull2(pts){
  const uniq=[];
  pts.forEach(p=>{
    if(!uniq.some(q=>Math.abs(q.x-p.x)<1 && Math.abs(q.y-p.y)<1)) uniq.push({x:p.x,y:p.y});
  });
  if(uniq.length<3) return uniq;
  uniq.sort(function(a,b){ return a.x===b.x ? a.y-b.y : a.x-b.x; });
  function cross(o,a,b){ return (a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x); }
  const lower=[];
  uniq.forEach(p=>{
    while(lower.length>=2 && cross(lower[lower.length-2], lower[lower.length-1], p)<=0) lower.pop();
    lower.push(p);
  });
  const upper=[];
  for(let i=uniq.length-1;i>=0;i--){
    const p=uniq[i];
    while(upper.length>=2 && cross(upper[upper.length-2], upper[upper.length-1], p)<=0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}
function idfMeshEarClip2(ring){
  const n=(ring||[]).length;
  if(n<3) return [];
  if(n===3) return [[0,1,2]];
  const idx=[];
  for(let i=0;i<n;i++) idx.push(i);
  function area2(i,j,k){
    const a=ring[i], b=ring[j], c=ring[k];
    return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  }
  function inTri(i,j,k,p){
    const a=area2(i,j,p), b=area2(j,k,p), c=area2(k,i,p);
    return (a>=-1e-6 && b>=-1e-6 && c>=-1e-6) || (a<=1e-6 && b<=1e-6 && c<=1e-6);
  }
  const tris=[];
  let guard=0;
  while(idx.length>3 && guard++<n*n){
    let cut=-1;
    for(let t=0;t<idx.length;t++){
      const i0=idx[(t-1+idx.length)%idx.length], i1=idx[t], i2=idx[(t+1)%idx.length];
      if(area2(i0,i1,i2)<=1e-8) continue;
      let busy=false;
      for(let u=0;u<idx.length;u++){
        const p=idx[u];
        if(p===i0||p===i1||p===i2) continue;
        if(inTri(i0,i1,i2,p)){ busy=true; break; }
      }
      if(!busy){ cut=t; tris.push([i0,i1,i2]); break; }
    }
    if(cut<0) break;
    idx.splice(cut,1);
  }
  if(idx.length===3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}
function idfMeshPrismMesh(bot, top){
  const n=bot.length;
  if(n<3) return null;
  const verts=bot.concat(top);
  const tris=[];
  const ears=idfMeshEarClip2(bot);
  (ears.length ? ears : idfMeshTriangulate(n)).forEach(function(t){
    tris.push([t[0], t[2], t[1]]);
    tris.push([n+t[0], n+t[1], n+t[2]]);
  });
  for(let i=0;i<n;i++){
    const j=(i+1)%n;
    if(Math.abs(bot[i].z-top[i].z)<2 && Math.abs(bot[j].z-top[j].z)<2) continue;
    tris.push([i, j, n+j]);
    tris.push([i, n+j, n+i]);
  }
  return {verts:verts, tris:tris};
}
function idfMeshSignedVolMm3(verts, tris){
  let acc=0;
  (tris||[]).forEach(function(t){
    const a=verts[t[0]], b=verts[t[1]], c=verts[t[2]];
    if(!a||!b||!c) return;
    acc += a.x*(b.y*c.z-b.z*c.y) + a.y*(b.z*c.x-b.x*c.z) + a.z*(b.x*c.y-b.y*c.x);
  });
  return acc/6;
}
function idfMeshOpenEdgeCount(tris){
  const e={};
  (tris||[]).forEach(function(t){
    [[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]].forEach(function(p){
      const a=Math.min(p[0],p[1]), b=Math.max(p[0],p[1]);
      const k=a+','+b;
      e[k]=(e[k]||0)+1;
    });
  });
  let open=0;
  Object.keys(e).forEach(function(k){ if(e[k]!==2) open++; });
  return open;
}
function idfMeshWeldSolidFromFacesMm(facesMm){
  const verts=[];
  const indexOf={};
  function add(v){
    const k=Math.round(v.x*10)+','+Math.round(v.y*10)+','+Math.round(v.z*10);
    if(indexOf[k]!=null) return indexOf[k];
    const i=verts.length;
    indexOf[k]=i;
    verts.push({x:v.x, y:v.y, z:v.z});
    return i;
  }
  const tris=[];
  (facesMm||[]).forEach(function(face){
    const idx=(face.verts||[]).map(add);
    if(idx.length<3) return;
    for(let i=1;i<=idx.length-2;i++) tris.push([idx[0], idx[i], idx[i+1]]);
  });
  if(verts.length<4 || !tris.length) return null;
  let vol=idfMeshSignedVolMm3(verts, tris);
  if(vol<0){
    tris.forEach(function(t){ const tmp=t[1]; t[1]=t[2]; t[2]=tmp; });
    vol=-vol;
  }
  const open=idfMeshOpenEdgeCount(tris);
  return {verts:verts, tris:tris, vol:vol, open:open, closed:open===0 && vol>1};
}
function idfMeshAabbPrismFromFacesMm(facesMm){
  let minx=Infinity, miny=Infinity, minz=Infinity, maxx=-Infinity, maxy=-Infinity, maxz=-Infinity;
  (facesMm||[]).forEach(function(f){
    (f.verts||[]).forEach(function(v){
      minx=Math.min(minx,v.x); miny=Math.min(miny,v.y); minz=Math.min(minz,v.z);
      maxx=Math.max(maxx,v.x); maxy=Math.max(maxy,v.y); maxz=Math.max(maxz,v.z);
    });
  });
  if(!(maxx-minx>10) || !(maxy-miny>10) || !(maxz-minz>10)) return null;
  const bot=[{x:minx,y:miny,z:minz},{x:maxx,y:miny,z:minz},{x:maxx,y:maxy,z:minz},{x:minx,y:maxy,z:minz}];
  const top=bot.map(function(v){ return {x:v.x, y:v.y, z:maxz}; });
  return idfMeshPrismMesh(bot, top);
}
function idfMeshMergePrismsMm(prisms){
  const verts=[], tris=[];
  (prisms||[]).forEach(function(p){
    const bot=(p.bot||[]).map(function(v){ return {x:v.x*1000, y:v.y*1000, z:v.z*1000}; });
    const top=(p.top||[]).map(function(v){ return {x:v.x*1000, y:v.y*1000, z:v.z*1000}; });
    const mesh=idfMeshPrismMesh(bot, top);
    if(!mesh) return;
    const off=verts.length;
    mesh.verts.forEach(function(v){ verts.push(v); });
    mesh.tris.forEach(function(t){ tris.push([t[0]+off, t[1]+off, t[2]+off]); });
  });
  if(verts.length<4 || !tris.length) return null;
  const volMm3=Math.abs(idfMeshSignedVolMm3(verts, tris));
  return {verts:verts, tris:tris, vol:volMm3, open:idfMeshOpenEdgeCount(tris), closed:true};
}
function idfMeshGainSolid(vol){
  if(vol && vol.prisms && vol.prisms.length){
    const merged=idfMeshMergePrismsMm(vol.prisms);
    if(merged && merged.vol>1e6) return merged;
  }
  const facesMm=(vol.faces||[]).map(function(face){
    return {verts:(face.verts||[]).map(function(v){ return {x:v.x*1000, y:v.y*1000, z:v.z*1000}; })};
  }).filter(function(f){ return f.verts.length>=3; });
  const welded=idfMeshWeldSolidFromFacesMm(facesMm);
  if(welded && welded.closed && welded.vol>1e6) return welded;
  return welded;
}
function cfdMeshSource(){
  if(typeof appMode!=='undefined' && appMode==='energyplus' &&
     typeof epParse!=='undefined' && epParse && (epParse.meshFaces||[]).length){
    return {faces:epParse.meshFaces, stamp:(typeof epIdfName==='string' && epIdfName) ? epIdfName : 'cfd_from_idf', kind:'ep'};
  }
  if(typeof appMode!=='undefined' && appMode==='architrend' &&
     typeof atMesh!=='undefined' && atMesh && (atMesh.meshFaces||[]).length){
    return {faces:atMesh.meshFaces, stamp:atMesh.fileName||'cfd_from_at', kind:'at'};
  }
  return null;
}
function idfMeshRoofFacesMm(){
  const src=cfdMeshSource();
  return ((src && src.faces) || [])
    .filter(function(f){ return f && f.sslKey==='roof'; })
    .map(idfMeshToMm)
    .filter(function(v){ return v.length>=3; });
}
function idfMeshCantileverFacesMm(){
  const src=cfdMeshSource();
  return ((src && src.faces) || [])
    .filter(function(f){ return f && (f.sslKey==='floor_out' || f.cantilever || f.nameJa==='2F床'); })
    .map(idfMeshToMm)
    .filter(function(v){ return v.length>=3; });
}
function idfMeshIsFloor1(f){
  return !!(f && f.sslKey==='floor1' && !f.cantilever && f.nameJa!=='2F床');
}
function idfMeshFloor1FacesMm(){
  const src=cfdMeshSource();
  return ((src && src.faces) || [])
    .filter(idfMeshIsFloor1)
    .map(idfMeshToMm)
    .filter(function(v){ return v.length>=3; });
}
function idfMeshFoundFacesMm(){
  const src=cfdMeshSource();
  return ((src && src.faces) || [])
    .filter(function(f){ return f && f.sslKey==='found'; })
    .map(idfMeshToMm)
    .filter(function(v){ return v.length>=3; });
}
function idfMeshFloor1ZMm(){
  const src=cfdMeshSource();
  let z=Infinity;
  ((src && src.faces) || []).forEach(function(f){
    if(!idfMeshIsFloor1(f)) return;
    (f.verts||[]).forEach(function(v){ if(v.z*1000<z) z=v.z*1000; });
  });
  return z;
}
function idfMeshFoundZMm(){
  const src=cfdMeshSource();
  let z=Infinity;
  ((src && src.faces) || []).forEach(function(f){
    if(!f || f.sslKey!=='found') return;
    (f.verts||[]).forEach(function(v){ if(v.z*1000<z) z=v.z*1000; });
  });
  return z;
}
function idfMeshPushPrism(prisms, bot, top){
  const mesh=idfMeshPrismMesh(bot, top);
  if(mesh) prisms.push(mesh);
}
function idfMeshRoofPlanesMm(){
  return idfMeshRoofFacesMm().map(idfMeshFacePlane).filter(Boolean);
}
function idfMeshIsRoofDuplicateAttic(face, roofPlanes){
  if(!face || face.sslKey!=='attic') return false;
  const plane=idfMeshFacePlane(idfMeshToMm(face));
  if(!plane) return false;
  const planes=roofPlanes || idfMeshRoofPlanesMm();
  return planes.some(function(r){ return idfMeshSamePlane(plane, r, 5*Math.PI/180, 80); });
}
function idfMeshBuildFillPrisms(){
  const roofs=idfMeshRoofFacesMm();
  const cants=idfMeshCantileverFacesMm();
  if(!roofs.length && !cants.length) return null;
  let zTop=-Infinity;
  const planes=[];
  roofs.forEach(function(verts){
    verts.forEach(function(v){ if(v.z>zTop) zTop=v.z; });
    const plane=idfMeshFacePlane(verts);
    if(!plane || Math.abs(plane.n.z)<0.05) return;
    let group=planes.find(function(g){ return idfMeshSamePlane(g.plane, plane, 3*Math.PI/180, 30); });
    if(!group){
      group={plane:plane, pts:[]};
      planes.push(group);
    }
    verts.forEach(function(v){ group.pts.push(v); });
  });
  const prisms=[];
  if(zTop>0){
    planes.forEach(function(g){
      const hull=idfMeshConvexHull2(g.pts);
      if(hull.length<3) return;
      const bot=hull.map(function(p){
        const z=idfMeshPlaneZ(g.plane, p.x, p.y);
        return {x:p.x, y:p.y, z:(z==null?g.pts[0].z:z)};
      });
      const maxDrop=bot.reduce(function(m,v){ return Math.max(m, zTop-v.z); }, 0);
      if(maxDrop<30) return;
      const top=bot.map(function(v){ return {x:v.x, y:v.y, z:zTop}; });
      idfMeshPushPrism(prisms, bot, top);
    });
  }
  let zFloor1=idfMeshFloor1ZMm();
  if(!(zFloor1<1e12)) zFloor1=null;
  let zFound=idfMeshFoundZMm();
  if(!(zFound<1e12)) zFound=null;
  // 2F持ち出しは発生パネルなので、下面の外気を埋メても無効にならない。
  // 基礎底まで通す。1FLで止めると持ち出し下に外気帯が残る。
  const zFillBase=zFound!=null ? zFound : zFloor1;
  const cantGroups=[];
  cants.forEach(function(verts){
    const z=verts.reduce(function(s,v){ return s+v.z; },0)/verts.length;
    let g=cantGroups.find(function(x){ return Math.abs(x.z-z)<40; });
    if(!g){ g={z:z, pts:[]}; cantGroups.push(g); }
    verts.forEach(function(v){ g.pts.push(v); });
  });
  if(zFillBase!=null){
    cantGroups.forEach(function(g){
      const hull=idfMeshConvexHull2(g.pts);
      if(hull.length<3) return;
      if(!(g.z-zFillBase>30)) return;
      const bot=hull.map(function(p){ return {x:p.x, y:p.y, z:zFillBase}; });
      const top=hull.map(function(p){ return {x:p.x, y:p.y, z:g.z}; });
      idfMeshPushPrism(prisms, bot, top);
    });
  }
  if(!prisms.length) return null;
  return {
    zTop:(zTop>0?zTop:(zFloor1!=null?zFloor1:0)),
    zFound:zFound,
    zFloor1:zFloor1,
    prisms:prisms
  };
}
function idfMeshPack3ds(usedMats, objects){
  let mdata=[];
  Object.keys(usedMats).forEach(mat=>{
    mdata=idfMeshConcat([mdata, idfMeshMatEntry(mat, usedMats[mat])]);
  });
  objects.forEach(o=>{ mdata=idfMeshConcat([mdata, o]); });
  const version=idfMeshChunk(0x0002, idfMeshU32(3));
  return new Uint8Array(idfMeshChunk(0x4D4D, idfMeshConcat([version, idfMeshChunk(0x3D3D, mdata)])));
}
function idfMeshAcBodySolidsMm(){
  const out=[];
  if(typeof atPartMeshesMm!=='function') return out;
  atPartMeshesMm().forEach(function(mesh){
    if(!mesh || mesh.key!=='ac_body' || !(mesh.verts||[]).length) return;
    const faces=(mesh.tris||[]).map(function(t){
      return {verts:[mesh.verts[t[0]], mesh.verts[t[1]], mesh.verts[t[2]]].filter(Boolean)};
    });
    const solid=idfMeshAabbPrismFromFacesMm([{verts:mesh.verts}]) || idfMeshWeldSolidFromFacesMm(faces);
    if(solid && solid.verts && solid.verts.length>=8 && solid.tris && solid.tris.length){
      out.push({solid:solid, src:mesh});
    }
  });
  return out;
}
function buildIdfFillExport(){
  if(!idfMeshReady()) return null;
  const built=idfMeshBuildFillPrisms();
  const acSolids=idfMeshAcBodySolidsMm();
  if((!built || !built.prisms.length) && !acSolids.length) return null;
  const pal=IDF_MESH_PALETTE.fill_solid;
  const acPal=IDF_MESH_PALETTE.ac_body;
  const objects=[];
  const rows=[];
  const origin=idfMeshOriginShiftMm();
  (built && built.prisms || []).forEach(function(mesh, idx){
    const name='FILL'+String(idx+1).padStart(2,'0');
    const named=idfMeshNameZ(name);
    objects.push(idfMeshNamedMesh(named.bytes, idfMeshShiftVerts(mesh.verts, origin), mesh.tris, pal.mat));
    rows.push({
      tds:name,
      nameJa:'埋メ',
      idfName:'',
      zone:'',
      sslKey:'fill_solid',
      u:'',
      rgb:pal.r+' '+pal.g+' '+pal.b
    });
  });
  acSolids.forEach(function(item){
    const mesh=item.src;
    const code='AC';
    const name=code+String(Number(String(mesh.id).replace(/\D/g,''))||0).padStart(3,'0')+'B';
    const named=idfMeshNameZ(name);
    objects.push(idfMeshNamedMesh(named.bytes, idfMeshShiftVerts(item.solid.verts, origin), item.solid.tris, acPal.mat));
    rows.push({
      tds:name,
      nameJa:mesh.name||'エアコン本体',
      idfName:mesh.id,
      zone:(mesh.floor||'')+'F',
      sslKey:'ac_body',
      u:'',
      rgb:acPal.r+' '+acPal.g+' '+acPal.b
    });
  });
  const mats={};
  mats[pal.mat]=pal;
  if(acSolids.length) mats[acPal.mat]=acPal;
  return {
    bytes:idfMeshPack3ds(mats, objects),
    rows:rows,
    zTop:built && built.zTop || 0,
    zBottom:built && (built.zFound!=null ? built.zFound : built.zFloor1),
    zFloor1:built && built.zFloor1,
    prismCount:(built && built.prisms && built.prisms.length)||0,
    acCount:acSolids.length,
    origin:origin
  };
}

function idfMeshReady(){
  return !!cfdMeshSource();
}

function idfMeshPaletteForFace(face){
  if(face && (face.kind==='window' || face.sslKey==='window')){
    const src = (typeof cfdMeshSource==='function') ? cfdMeshSource() : null;
    if(src && src.kind==='at'){
      const base = IDF_MESH_PALETTE.window;
      return {r:base.r, g:base.g, b:base.b, mat:base.mat};
    }
    const us = (typeof uniqueSortedWinU==='function')
      ? uniqueSortedWinU(((typeof epParse!=='undefined' && epParse && epParse.windows)||[]).map(function(w){ return w.u; }))
      : [];
    const groups = (typeof windowUColorGroupsFromUs==='function') ? windowUColorGroupsFromUs(us) : [];
    const u = (face.u>0 && typeof roundWinU==='function') ? roundWinU(face.u) : null;
    let gi = (u!=null) ? us.indexOf(u) : 0;
    if(gi<0) gi = 0;
    const grp = groups[gi];
    if(grp) return {r:grp.color.r, g:grp.color.g, b:grp.color.b, mat:grp.mat, u:grp.u};
    const base = IDF_MESH_PALETTE.window;
    return {r:base.r, g:base.g, b:base.b, mat:base.mat, u:u};
  }
  return IDF_MESH_PALETTE[face.sslKey] || IDF_MESH_PALETTE.innerwall;
}

function idfMeshEnsureGainVolumes(){
  if(typeof appMode!=='undefined' && appMode==='energyplus'){
    if(typeof epParse==='undefined' || !epParse) return [];
    if(!epParse.gainVolumes && typeof buildEpGainVolumes==='function') buildEpGainVolumes(epParse);
    return epParse.gainVolumes||[];
  }
  if(typeof appMode!=='undefined' && appMode==='architrend' && typeof atMesh!=='undefined' && atMesh){
    if(!atMesh.gainVolumes && typeof atBuildGainVolumes==='function'){
      atMesh.gainVolumes=atBuildGainVolumes(atMesh);
    }
    return atMesh.gainVolumes||[];
  }
  return [];
}
function idfMeshRoomNameForZone(zone){
  if(typeof document==='undefined' || !document.querySelectorAll) return zone||'';
  const cards=document.querySelectorAll('.room-card[data-ep-zone], .room-card[data-at-room-key]');
  for(let i=0;i<cards.length;i++){
    if(cards[i].dataset.epZone===zone || cards[i].dataset.atRoomKey===zone){
      const el=cards[i].querySelector('.roomName');
      if(el && String(el.value).trim()) return String(el.value).trim();
    }
  }
  const byName=document.querySelectorAll('.room-card .roomName');
  for(let i=0;i<byName.length;i++){
    if(String(byName[i].value).trim()===String(zone||'').trim()) return String(byName[i].value).trim();
  }
  return zone||'';
}
function idfMeshExpandAabb(aabb, verts){
  (verts||[]).forEach(function(v){
    if(!v) return;
    aabb.minx=Math.min(aabb.minx, v.x);
    aabb.miny=Math.min(aabb.miny, v.y);
    aabb.minz=Math.min(aabb.minz, v.z);
    aabb.maxx=Math.max(aabb.maxx, v.x);
    aabb.maxy=Math.max(aabb.maxy, v.y);
    aabb.maxz=Math.max(aabb.maxz, v.z);
  });
}
function idfMeshCombinedAabbMm(){
  const aabb={minx:Infinity, miny:Infinity, minz:Infinity, maxx:-Infinity, maxy:-Infinity, maxz:-Infinity};
  const src=cfdMeshSource();
  ((src && src.faces)||[]).forEach(function(f){ idfMeshExpandAabb(aabb, idfMeshToMm(f)); });
  const fill=idfMeshBuildFillPrisms();
  if(fill && fill.prisms){
    fill.prisms.forEach(function(p){ idfMeshExpandAabb(aabb, p.verts); });
  }
  (idfMeshEnsureGainVolumes()||[]).forEach(function(vol){
    const solid=idfMeshGainSolid(vol);
    if(solid) idfMeshExpandAabb(aabb, solid.verts);
  });
  idfMeshStairMeshes().forEach(function(mesh){ idfMeshExpandAabb(aabb, mesh.verts); });
  if(typeof atPartMeshesMm==='function') atPartMeshesMm().forEach(function(mesh){ idfMeshExpandAabb(aabb, mesh.verts); });
  if(!(aabb.maxx>=aabb.minx) || !(aabb.maxy>=aabb.miny) || !(aabb.maxz>=aabb.minz)) return null;
  return aabb;
}
function idfMeshOriginShiftMm(){
  const aabb=idfMeshCombinedAabbMm();
  if(!aabb) return {dx:0, dy:0, dz:0, aabb:null};
  return {dx:-aabb.minx, dy:-aabb.miny, dz:-aabb.minz, aabb:aabb};
}
function idfMeshShiftVerts(verts, shift){
  const dx=(shift && shift.dx)||0, dy=(shift && shift.dy)||0, dz=(shift && shift.dz)||0;
  const s=0.001;
  return (verts||[]).map(function(v){
    return {x:(v.x+dx)*s, y:(v.y+dy)*s, z:(v.z+dz)*s};
  });
}
function idfMeshOriginNote(shift){
  if(!shift || !shift.aabb) return '';
  const sx=((shift.aabb.maxx-shift.aabb.minx)/1000).toFixed(3);
  const sy=((shift.aabb.maxy-shift.aabb.miny)/1000).toFixed(3);
  const sz=((shift.aabb.maxz-shift.aabb.minz)/1000).toFixed(3);
  return '合体概形の左下（最小XYZ）を原点に揃えています。外形 '+sx+' × '+sy+' × '+sz+' m。';
}
const IDF_MESH_STEP_M = 0.1;
const IDF_MESH_PAD_M = 0.1;
function idfMeshSnapCeil(v, step){
  if(!(step>0) || !isFinite(v)) return v;
  return Math.ceil(v/step - 1e-9)*step;
}
function idfMeshDomainAdvice(){
  const shift=idfMeshOriginShiftMm();
  if(!shift || !shift.aabb) return null;
  const sx=(shift.aabb.maxx-shift.aabb.minx)/1000;
  const sy=(shift.aabb.maxy-shift.aabb.miny)/1000;
  const sz=(shift.aabb.maxz-shift.aabb.minz)/1000;
  if(!(sx>0) || !(sy>0) || !(sz>0)) return null;
  const pad=IDF_MESH_PAD_M, step=IDF_MESH_STEP_M;
  const min={x:-pad, y:-pad, z:-pad};
  const max={
    x:idfMeshSnapCeil(sx+pad, step),
    y:idfMeshSnapCeil(sy+pad, step),
    z:idfMeshSnapCeil(sz+pad, step)
  };
  const nx=Math.round((max.x-min.x)/step);
  const ny=Math.round((max.y-min.y)/step);
  const nz=Math.round((max.z-min.z)/step);
  return {sx:sx, sy:sy, sz:sz, pad:pad, step:step, min:min, max:max, nx:nx, ny:ny, nz:nz, total:nx*ny*nz};
}
function idfMeshDomainFmt(v, unit){
  if(unit==='mm') return String(Math.round(v*1000));
  const n=Number(v);
  if(!isFinite(n)) return '—';
  return (Math.round(n*1000)/1000).toFixed(3);
}
function idfMeshDomainCellsLabel(n){
  if(!(n>0)) return '—';
  if(n>=1000000) return '約 '+(n/1000000).toFixed(1)+' 百万';
  if(n>=10000) return '約 '+Math.round(n/10000)+' 万';
  return String(n);
}
function idfMeshDomainCopyText(d, unit){
  const u=unit==='mm' ? 'mm' : 'm';
  const f=function(v){ return idfMeshDomainFmt(v, u); };
  return [
    '解析領域（単位 '+u+'）',
    'X 最小 '+f(d.min.x)+'  最大 '+f(d.max.x),
    'Y 最小 '+f(d.min.y)+'  最大 '+f(d.max.y),
    'Z 最小 '+f(d.min.z)+'  最大 '+f(d.max.z),
    '格子間隔 '+f(d.step)
  ].join('\n');
}
function idfMeshDomainUnit(){
  const host=document.getElementById('idfMeshDomain');
  return (host && host.dataset.unit==='mm') ? 'mm' : 'm';
}
function renderIdfMeshDomain(){
  const host=document.getElementById('idfMeshDomain');
  if(!host) return;
  const unit=idfMeshDomainUnit();
  const src=typeof cfdMeshSource==='function' ? cfdMeshSource() : null;
  const d=src ? idfMeshDomainAdvice() : null;
  if(!d){
    host.innerHTML='<p class="small" style="margin:0;">3DS または IDF を読むと、FlowDesigner に入れる解析領域の最小・最大がここに出ます。格子は 100 mm 均一、外形の外側へ 1 格子（100 mm）の余裕です。</p>';
    return;
  }
  const f=function(v){ return idfMeshDomainFmt(v, unit); };
  const uLabel=unit==='mm' ? 'mm' : 'm';
  const axes=[{k:'x', name:'X'},{k:'y', name:'Y'},{k:'z', name:'Z'}];
  let html='<p class="fd-domain-lead">3DS 取込後、この数値を <b>解析領域</b> に入れてください。モデルの左下は原点 (0,0,0) です。</p>';
  html+='<div class="fd-domain-unit" role="group" aria-label="単位">';
  html+='<button type="button" data-domain-unit="m" aria-pressed="'+(unit==='m')+'">単位 m</button>';
  html+='<button type="button" data-domain-unit="mm" aria-pressed="'+(unit==='mm')+'">単位 mm</button>';
  html+='</div>';
  html+='<div class="fd-domain-axes">';
  html+='<span></span><span class="fd-domain-col">最小</span><span class="fd-domain-col">最大</span>';
  axes.forEach(function(ax){
    html+='<span class="fd-domain-lab">'+ax.name+'</span>';
    html+='<div class="fd-domain-cell"><span>最小 '+ax.name+' ['+uLabel+']</span><b class="num">'+f(d.min[ax.k])+'</b></div>';
    html+='<div class="fd-domain-cell"><span>最大 '+ax.name+' ['+uLabel+']</span><b class="num">'+f(d.max[ax.k])+'</b></div>';
  });
  html+='</div>';
  html+='<div class="fd-domain-meta">';
  html+='<div class="fd-domain-cell"><span>格子間隔</span><b class="num">'+f(d.step)+' '+uLabel+'</b></div>';
  html+='<div class="fd-domain-cell"><span>格子数</span><b class="num">'+d.nx+' × '+d.ny+' × '+d.nz+'</b></div>';
  html+='<div class="fd-domain-cell"><span>合計</span><b class="num">'+idfMeshDomainCellsLabel(d.total)+'</b></div>';
  html+='</div>';
  html+='<p class="fd-domain-note">合体概形 '+d.sx.toFixed(3)+' × '+d.sy.toFixed(3)+' × '+d.sz.toFixed(3)+' m。外側へ '+idfMeshDomainFmt(d.pad, unit)+' '+uLabel+'（1格子）広げ、格子に合わせて切り上げています。ドア隙間のモデル高さと同じ 100 mm 前提です。</p>';
  html+='<div class="fd-domain-copy"><button type="button" data-domain-copy>この数値をコピー</button></div>';
  host.innerHTML=html;
}

function idfMeshStairMeshes(){
  const out=[];
  if(typeof atMesh==='undefined' || !atMesh) return out;
  function panelMesh(vertsM){
    const verts=(vertsM||[]).map(function(v){ return {x:v.x*1000, y:v.y*1000, z:v.z*1000}; });
    if(verts.length<3) return null;
    return {verts:verts, tris:idfMeshTriangulate(verts.length)};
  }
  (atMesh.rooms||[]).forEach(function(r){
    const panels=(r.stair && r.stair.panels)||[];
    if(panels.length){
      panels.forEach(function(p){
        const mesh=panelMesh(p.verts);
        if(mesh) out.push(mesh);
      });
      return;
    }
    ((r.stair && r.stair.treads)||[]).forEach(function(t){
      const z=t.zTop!=null ? t.zTop : (t.z!=null ? t.z : r.z);
      const mesh=panelMesh((t.ring||[]).map(function(p){ return {x:p.x, y:p.y, z:z}; }));
      if(mesh) out.push(mesh);
    });
    ((r.stair && r.stair.risers)||[]).forEach(function(p){
      const mesh=panelMesh(p.verts);
      if(mesh) out.push(mesh);
    });
  });
  return out;
}
function idfMeshAppendStairs(usedMats, objects, rows, seq, shift){
  const pal=IDF_MESH_PALETTE.innerwall;
  const origin=shift||idfMeshOriginShiftMm();
  const meshes=idfMeshStairMeshes();
  if(!meshes.length) return;
  usedMats[pal.mat]=pal;
  const nameJa='階段';
  meshes.forEach(function(mesh){
    seq[nameJa]=(seq[nameJa]||0)+1;
    const shortName=nameJa+String(seq[nameJa]).padStart(2,'0');
    const named=idfMeshNameZ(shortName);
    objects.push(idfMeshNamedMesh(named.bytes, idfMeshShiftVerts(mesh.verts, origin), mesh.tris, pal.mat));
    rows.push({
      tds:shortName,
      nameJa:nameJa,
      idfName:'',
      zone:'',
      sslKey:'innerwall',
      u:'',
      rgb:pal.r+' '+pal.g+' '+pal.b
    });
  });
}
function idfMeshAppendGainVolumes(usedMats, objects, rows, seq, shift){
  const vols=idfMeshEnsureGainVolumes();
  const origin=shift||idfMeshOriginShiftMm();
  vols.forEach(function(vol){
    const pal=vol.color||{r:255,g:176,b:168,mat:'GAIN'};
    usedMats[pal.mat]=pal;
    const solid=idfMeshGainSolid(vol);
    if(!solid || !solid.verts || solid.verts.length<4 || !solid.tris || !solid.tris.length) return;
    const nameJa='発熱';
    seq[nameJa]=(seq[nameJa]||0)+1;
    const shortName=nameJa+String(seq[nameJa]).padStart(2,'0');
    const named=idfMeshNameZ(shortName);
    objects.push(idfMeshNamedMesh(named.bytes, idfMeshShiftVerts(solid.verts, origin), solid.tris, pal.mat));
    const roomName=idfMeshRoomNameForZone(vol.zone);
    rows.push({
      tds:shortName,
      nameJa:nameJa,
      idfName:vol.zone||'',
      zone:vol.zone||'',
      sslKey:'room:'+roomName,
      u:'',
      rgb:pal.r+' '+pal.g+' '+pal.b
    });
  });
}

function buildIdfMeshExport(){
  const src = cfdMeshSource();
  if(!src) return null;
  const origin = idfMeshOriginShiftMm();
  const faces = src.faces;
  const seq = {};
  const rows = [];
  const usedMats = {};
  const objects = [];
  const roofPlanes = idfMeshRoofPlanesMm();
  let skippedAttic = 0;
  faces.forEach(face=>{
    if(face.atReplacedByPart) return;
    if(idfMeshIsRoofDuplicateAttic(face, roofPlanes)){
      skippedAttic++;
      return;
    }
    const pal = idfMeshPaletteForFace(face);
    usedMats[pal.mat] = pal;
    seq[face.nameJa] = (seq[face.nameJa]||0) + 1;
    const shortName = face.nameJa + String(seq[face.nameJa]).padStart(2,'0');
    const named = idfMeshNameZ(shortName);
    const verts = idfMeshShiftVerts(idfMeshToMm(face), origin);
    if(verts.length<3) return;
    if(face.tris && face.tris.length){
      objects.push(idfMeshNamedMesh(named.bytes, verts, face.tris, pal.mat));
    }else{
      objects.push(idfMeshNamedTri(named.bytes, verts, pal.mat));
    }
    rows.push({
      tds: shortName,
      nameJa: face.nameJa,
      idfName: face.idfName||'',
      zone: face.zone||'',
      sslKey: face.sslKey,
      u: pal.u!=null ? pal.u : (face.u>0 ? face.u : ''),
      rgb: pal.r+' '+pal.g+' '+pal.b
    });
  });
  idfMeshAppendStairs(usedMats, objects, rows, seq, origin);
  if(src.kind==='at' && typeof atPartMeshesMm==='function'){
    atPartMeshesMm().forEach(function(mesh){
      const pal=IDF_MESH_PALETTE[mesh.key];
      if(!pal||!mesh.verts.length||!mesh.tris.length||mesh.key==='ac_body') return;
      usedMats[pal.mat]=pal;
      const code=mesh.kind==='ac'?'AC':'DR';
      const suffix={ac_body:'B',ac_supply:'S',ac_return:'R',doorbody:'B',doorgap_top:'T',doorgap_uc:'U'}[mesh.key];
      const name=code+String(Number(String(mesh.id).replace(/\D/g,''))||0).padStart(3,'0')+suffix;
      const named=idfMeshNameZ(name);
      objects.push(idfMeshNamedMesh(named.bytes,idfMeshShiftVerts(mesh.verts,origin),mesh.tris,pal.mat));
      rows.push({tds:name,nameJa:mesh.name,idfName:mesh.id,zone:mesh.floor+'F',sslKey:mesh.key,
        u:'',rgb:pal.r+' '+pal.g+' '+pal.b});
    });
  }
  if(!objects.length) return null;
  return {bytes: idfMeshPack3ds(usedMats, objects), rows, stamp:src.stamp, kind:src.kind, origin:origin, skippedAttic:skippedAttic};
}
function buildIdfGainExport(){
  if(typeof appMode==='undefined' || (appMode!=='energyplus' && appMode!=='architrend')) return null;
  const origin=idfMeshOriginShiftMm();
  const usedMats={}, objects=[], rows=[], seq={};
  idfMeshAppendGainVolumes(usedMats, objects, rows, seq, origin);
  if(!objects.length) return null;
  return {bytes: idfMeshPack3ds(usedMats, objects), rows:rows, origin:origin};
}

function idfMeshCsvText(rows){
  const esc = s=>{
    const t = String(s==null?'':s);
    return /[",\r\n]/.test(t) ? '"'+t.replace(/"/g,'""')+'"' : t;
  };
  const lines = ['3DS名,日本語部材,IDF面名,ゾーン,SSLカテゴリ,U,RGB'];
  rows.forEach(r=>lines.push([r.tds, r.nameJa, r.idfName, r.zone, r.sslKey, r.u, r.rgb].map(esc).join(',')));
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}

function idfMeshDownloadBlob(blob, filename){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportIdfMesh(){
  const info = document.getElementById('idfMeshExportInfo');
  const built = buildIdfMeshExport();
  if(!built){
    if(info) info.textContent = 'EnergyPlusモードでIDF、またはArchitrendモードで3DSを読むと書き出せます。';
    return;
  }
  const stamp = String(built.stamp||'cfd').replace(/\.[^.]+$/,'') || 'cfd';
  const fill = buildIdfFillExport();
  const gain = buildIdfGainExport();
  idfMeshDownloadBlob(new Blob([built.bytes], {type:'application/octet-stream'}), stamp+'_cfd.3ds');
  setTimeout(function(){
    idfMeshDownloadBlob(new Blob([idfMeshCsvText(built.rows)], {type:'text/csv;charset=utf-8'}), stamp+'_cfd_names.csv');
  }, 250);
  if(fill){
    setTimeout(function(){
      idfMeshDownloadBlob(new Blob([fill.bytes], {type:'application/octet-stream'}), stamp+'_cfd_fill.3ds');
    }, 500);
  }
  if(gain){
    setTimeout(function(){
      idfMeshDownloadBlob(new Blob([gain.bytes], {type:'application/octet-stream'}), stamp+'_cfd_gain.3ds');
    }, 750);
  }
  let msg = '家パネル・配置パーツ '+built.rows.length+' 面の 3DS と名前CSVを書き出しました。';
  if(built.skippedAttic){
    msg += ' 屋根と同一面の小屋裏 '+built.skippedAttic+' 面は出していません。';
  }
  if(gain){
    msg += ' 内部発熱は別ファイル *_cfd_gain.3ds（'+gain.rows.length+' 室・薄い赤・0.3mセットバック）。';
  }
  if(fill){
    const bits=[];
    if(fill.prismCount){
      const zM = (fill.zTop/1000).toFixed(3);
      bits.push('外形埋メ '+fill.prismCount+' 個（屋根は棟高さ '+zM+' m まで、2F持ち出し下は基礎底まで。床下は埋めません）');
    }
    if(fill.acCount) bits.push('エアコン本体ソリッド '+fill.acCount+' 台');
    msg += ' *_cfd_fill.3ds に '+bits.join('、')+' を出します。3DS の単位は m。FDでは家パネルと埋メを別々に取り込み、埋メとエアコン本体は障害物ソリッドです。';
  }else{
    msg += ' 埋メ立体は作れませんでした。';
  }
  const originNote = idfMeshOriginNote(built.origin || (fill && fill.origin) || (gain && gain.origin));
  if(originNote) msg += ' '+originNote;
  const domain=idfMeshDomainAdvice();
  if(domain){
    msg += ' 解析領域（m） X '+domain.min.x.toFixed(3)+'〜'+domain.max.x.toFixed(3)
      +' / Y '+domain.min.y.toFixed(3)+'〜'+domain.max.y.toFixed(3)
      +' / Z '+domain.min.z.toFixed(3)+'〜'+domain.max.z.toFixed(3)
      +'、格子 0.1 m。';
  }
  if(info) info.textContent = msg;
}

function refreshIdfMeshUi(){
  const btn = document.getElementById('idfMeshExportBtn');
  const info = document.getElementById('idfMeshExportInfo');
  const sum = document.getElementById('idfMeshSummary');
  const banner = document.getElementById('idfMeshBanner');
  const guide = document.getElementById('idfMeshGuide');
  const src = cfdMeshSource();
  const ready = !!src;
  if(btn) btn.disabled = !ready;
  if(typeof appMode!=='undefined' && appMode==='architrend'){
    if(banner) banner.textContent = 'Architrend の 3DS があれば、方位色分けした CFD モデル種をここから出せます。内壁・天井つきの3DSにも対応します。厚みは付けません。';
    if(guide) guide.textContent = 'Architrend の 3DS から色分け 3DS を作ります。単位は m です。3Dビューワーで置いたドアとエアコンの吹出・吸込は家モデルへ、エアコン本体は埋メファイルへ障害物ソリッドとして出します。内部発熱は *_cfd_gain.3ds に分けて出します。';
  }else if(typeof appMode!=='undefined' && appMode==='energyplus'){
    if(banner) banner.textContent = 'IDF があれば、色分け済みの CFD モデル種をここから出せます。内部発熱は *_cfd_gain.3ds に分けて出します。厚みは付けません。';
    if(guide) guide.textContent = 'EnergyPlus の IDF 頂点から、厚みなしの色分け 3DS を作ります。居室に加えて床下（基礎外周）と小屋裏（屋根・妻壁）も出します。内部発熱の発生エリア（薄い赤）は *_cfd_gain.3ds として別ファイルです。SSL で部屋ごとの発熱・発湿を自動割当します。居室に接する面は居室側だけ残し、二重にはしません。FlowDesigner に取り込んだあと、次の SSL 一括反映で境界条件を流し込みます。';
  }else{
    if(banner) banner.textContent = 'EnergyPlus の IDF、または Architrend の 3DS を読むと、色分け済みの CFD モデル種を出せます。厚みは付けません。';
    if(guide) guide.textContent = 'EnergyPlus モードでは IDF 頂点から、Architrend モードでは 3DS から、厚みなしの色分け 3DS を作ります。FlowDesigner に取り込んだあと、次の SSL 一括反映で境界条件を流し込みます。';
  }
  if(!sum) return;
  renderIdfMeshDomain();
  if(typeof appMode==='undefined' || (appMode!=='energyplus' && appMode!=='architrend')){
    sum.innerHTML = '<p class="small" style="margin:0;">EnergyPlusモードで IDF、またはArchitrendモードで 3DS を読むと、色分けした 3DS を書き出せます。手動モードでは使いません。</p>';
    if(info) info.textContent = '';
    return;
  }
  if(!ready){
    if(appMode==='architrend'){
      sum.innerHTML = '<p class="small" style="margin:0;">まだ 3DS が読み込まれていません。ページ上部のアーキトレンド欄で 3DS を指定してください。内壁つきにも対応します。メッシュはブラウザに保存しないので、開き直したら選び直します。</p>';
    }else{
      sum.innerHTML = '<p class="small" style="margin:0;">まだ IDF が読み込まれていません。ページ上部の EnergyPlus IDF を指定してください。</p>';
    }
    return;
  }
  const counts = {};
  src.faces.forEach(f=>{ counts[f.nameJa] = (counts[f.nameJa]||0)+1; });
  let html = '<table><tr><th>部材</th><th>面数</th></tr>';
  Object.keys(counts).forEach(k=>{
    html += '<tr><td class="l">'+k+'</td><td>'+counts[k]+'</td></tr>';
  });
  html += '<tr style="font-weight:600; background:#F4F4F4;"><td class="l">合計</td><td>'+src.faces.length+'</td></tr></table>';
  if(src.kind==='ep'){
    const us = (typeof uniqueSortedWinU==='function') ? uniqueSortedWinU((epParse.windows||[]).map(function(w){ return w.u; })) : [];
    if(us.length>1 && typeof windowUColorGroupsFromUs==='function'){
      html += '<p class="small" style="margin:8px 0 4px;">窓Uが '+us.length+' 種類あるので、3DSでは色を分けます。</p><table><tr><th>U</th><th>色</th></tr>';
      windowUColorGroupsFromUs(us).forEach(function(g){
        const rgb='rgb('+g.color.r+','+g.color.g+','+g.color.b+')';
        html += '<tr><td>'+g.u+'</td><td class="l"><span style="display:inline-block;width:28px;height:12px;border:1px solid #C9C9C9;background:'+rgb+';vertical-align:middle;margin-right:6px;"></span>'+
          g.color.r+' '+g.color.g+' '+g.color.b+'</td></tr>';
      });
      html += '</table>';
    }
    const rel = epParse.relative ? 'Relative（Zone原点でワールド化済み）' : 'World';
    html += '<p class="small" style="margin:8px 0 0;">座標系: '+rel+' / 単位: mm / 厚みなし / 窓は壁と同一平面に重ねる / 書き出し時に合体概形の左下を原点へ</p>';
    const gains = idfMeshEnsureGainVolumes();
    if(gains.length){
      html += '<p class="small" style="margin:8px 0 4px;">内部発熱の発生エリアは *_cfd_gain.3ds に分けて出します（部屋の中に 0.3m 浮かせたソリッド）。薄い赤系で部屋ごとに色を少し変えます。</p><table><tr><th>ゾーン</th><th>色</th></tr>';
      gains.forEach(function(g){
        const c=g.color||{r:255,g:176,b:168};
        const rgb='rgb('+c.r+','+c.g+','+c.b+')';
        html += '<tr><td class="l">'+g.zone+'</td><td class="l"><span style="display:inline-block;width:28px;height:12px;border:1px solid #C9C9C9;background:'+rgb+';vertical-align:middle;margin-right:6px;"></span>'+
          c.r+' '+c.g+' '+c.b+'</td></tr>';
      });
      html += '</table>';
    }
  }else{
    const st = (typeof atMesh!=='undefined' && atMesh && atMesh.stats) ? atMesh.stats : null;
    html += '<p class="small" style="margin:8px 0 0;">単位: m / 厚みなし / 両面は外向きのみ'
      +(st && st.usedMaterials ? ' / マテリアルで部材判定' : ' / 幾何で部材判定')
      +(st && st.droppedEave ? ' / 庇 '+st.droppedEave+' 面を除外' : '')
      +'。メッシュはブラウザに保存しません。書き出し時に合体概形の左下を原点へ。</p>';
    const atRooms=(typeof atMesh!=='undefined' && atMesh && atMesh.rooms)||[];
    if(atRooms.length){
      html += '<p class="small" style="margin:8px 0 4px;">3DSから部屋 '+atRooms.length+' 室を認識しました。内部発熱は *_cfd_gain.3ds に分けて出します。</p>';
    }
  }
  const fill = buildIdfFillExport();
  if(fill){
    const zM = (fill.zTop/1000).toFixed(3);
    html += '<p class="small" style="margin:8px 0 0;">埋メ: 屋根は同じ勾配ごとに棟高さ '+zM+' m まで、2F持ち出し下は基礎底まで、三角柱 '+fill.prismCount+' 個'+(fill.acCount?'、エアコン本体ソリッド '+fill.acCount+' 台':'')+'。床下（基礎の内側）は基礎・1F床が無効になるので埋めません。埋メ色 #3d3d3d、エアコン本体 #808080。SSL は障害物です。</p>';
  }
  const preview = buildIdfMeshExport();
  if(preview && preview.skippedAttic){
    html += '<p class="small" style="margin:8px 0 0;">屋根と同一面の小屋裏 '+preview.skippedAttic+' 面は 3DS に出さず、屋根の発生パネルだけ残します。</p>';
  }
  const originNote = idfMeshOriginNote((fill && fill.origin) || idfMeshOriginShiftMm());
  if(originNote){
    html += '<p class="small" style="margin:8px 0 0;">'+originNote+' 家・埋メ・発熱は同じずれです。</p>';
  }
  sum.innerHTML = html;
}

(function initIdfMeshUi(){
  const btn = document.getElementById('idfMeshExportBtn');
  if(btn) btn.addEventListener('click', exportIdfMesh);
  const host=document.getElementById('idfMeshDomain');
  if(host){
    host.addEventListener('click', function(e){
      const unitBtn=e.target.closest('[data-domain-unit]');
      if(unitBtn){
        host.dataset.unit=unitBtn.dataset.domainUnit;
        renderIdfMeshDomain();
        return;
      }
      if(e.target.closest('[data-domain-copy]')){
        const d=idfMeshDomainAdvice();
        if(!d) return;
        const text=idfMeshDomainCopyText(d, idfMeshDomainUnit());
        const done=function(){
          const b=host.querySelector('[data-domain-copy]');
          if(b){ b.textContent='コピーしました'; setTimeout(function(){ b.textContent='この数値をコピー'; }, 1600); }
        };
        if(navigator.clipboard && navigator.clipboard.writeText){
          navigator.clipboard.writeText(text).then(done).catch(function(){
            window.prompt('コピーして FlowDesigner へ', text);
          });
        }else{
          window.prompt('コピーして FlowDesigner へ', text);
        }
      }
    });
  }
  refreshIdfMeshUi();
})();

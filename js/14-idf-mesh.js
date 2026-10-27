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
  dooropen: {r:255, g:0, b:170, mat:'DOOR_OPEN'},
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
"\u88CF":[0x97,0xA0],
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
  const ears=idfMeshEarClip3(verts);
  const tris=ears.length ? ears : idfMeshTriangulate(verts.length);
  return idfMeshNamedMesh(objNameBytes, verts, tris, matName);
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
function idfMeshNewell(verts){
  let nx=0, ny=0, nz=0;
  for(let i=0;i<(verts||[]).length;i++){
    const a=verts[i], b=verts[(i+1)%verts.length];
    nx+=(a.y-b.y)*(a.z+b.z);
    ny+=(a.z-b.z)*(a.x+b.x);
    nz+=(a.x-b.x)*(a.y+b.y);
  }
  return {x:nx, y:ny, z:nz};
}
function idfMeshCross(a, b, c){
  const ux=b.x-a.x, uy=b.y-a.y, uz=b.z-a.z;
  const vx=c.x-a.x, vy=c.y-a.y, vz=c.z-a.z;
  return {x:uy*vz-uz*vy, y:uz*vx-ux*vz, z:ux*vy-uy*vx};
}
function idfMeshEarClip3(verts){
  if(!verts || verts.length<3) return [];
  const nrm=idfMeshNewell(verts);
  const nl=Math.hypot(nrm.x, nrm.y, nrm.z);
  if(!(nl>0)) return [];
  const nn={x:nrm.x/nl, y:nrm.y/nl, z:nrm.z/nl};
  const ax=Math.abs(nn.x)<0.9 ? {x:1, y:0, z:0} : {x:0, y:1, z:0};
  let ux=nn.y*ax.z-nn.z*ax.y, uy=nn.z*ax.x-nn.x*ax.z, uz=nn.x*ax.y-nn.y*ax.x;
  const ul=Math.hypot(ux, uy, uz)||1;
  ux/=ul; uy/=ul; uz/=ul;
  const vx=nn.y*uz-nn.z*uy, vy=nn.z*ux-nn.x*uz, vz=nn.x*uy-nn.y*ux;
  const o=verts[0];
  const ring=verts.map(function(p){
    return {
      x:(p.x-o.x)*ux+(p.y-o.y)*uy+(p.z-o.z)*uz,
      y:(p.x-o.x)*vx+(p.y-o.y)*vy+(p.z-o.z)*vz
    };
  });
  let area=0;
  for(let i=0;i<ring.length;i++){
    const p=ring[i], q=ring[(i+1)%ring.length];
    area+=p.x*q.y-q.x*p.y;
  }
  const order=ring.map(function(_, i){ return i; });
  if(area<0){ ring.reverse(); order.reverse(); }
  const raw=idfMeshEarClip2(ring);
  let scale=0;
  verts.forEach(function(p){ scale=Math.max(scale, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)); });
  const minArea=scale>50 ? 1 : 1e-6;
  const tris=[];
  raw.forEach(function(t){
    let a=order[t[0]], b=order[t[1]], c=order[t[2]];
    if(area<0){ const tmp=b; b=c; c=tmp; }
    let cr=idfMeshCross(verts[a], verts[b], verts[c]);
    let mag=Math.hypot(cr.x, cr.y, cr.z);
    if(!(mag/2>minArea)) return;
    if(cr.x*nrm.x+cr.y*nrm.y+cr.z*nrm.z<0){ const tmp=b; b=c; c=tmp; }
    tris.push([a, b, c]);
  });
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
    const ears=idfMeshEarClip3(face.verts);
    const local=ears.length ? ears : idfMeshTriangulate(idx.length);
    local.forEach(function(t){
      if(idx[t[0]]==null || idx[t[1]]==null || idx[t[2]]==null) return;
      tris.push([idx[t[0]], idx[t[1]], idx[t[2]]]);
    });
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
    return {faces:typeof atResolvedRoomFloorFaces==='function'?atResolvedRoomFloorFaces(atMesh):atMesh.meshFaces, stamp:atMesh.fileName||'cfd_from_at', kind:'at'};
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

var epShadeGroups = [];
var epShadePalette = {};
const EP_SHADE_MAT = {北:'N',北東:'NE',東:'E',南東:'SE',南:'S',南西:'SW',西:'W',北西:'NW'};
function epShadeCheb(a, b){
  return Math.max(Math.abs(a.r-b.r), Math.abs(a.g-b.g), Math.abs(a.b-b.b));
}
function epShadeReservedColors(){
  const cols=[];
  Object.keys(IDF_MESH_PALETTE).forEach(function(k){
    const p=IDF_MESH_PALETTE[k];
    if(p) cols.push({r:p.r, g:p.g, b:p.b});
  });
  if(typeof WINDOW_U_COLOR_PALETTE!=='undefined'){
    WINDOW_U_COLOR_PALETTE.forEach(function(c){ cols.push({r:c.r, g:c.g, b:c.b}); });
  }
  if(typeof SSL_FIXED_COLORS!=='undefined'){
    SSL_FIXED_COLORS.forEach(function(e){
      const n=parseInt(String(e.hex||'').replace('#',''), 16);
      if(!isFinite(n)) return;
      cols.push({r:(n>>16)&255, g:(n>>8)&255, b:n&255});
    });
  }
  if(typeof gainVolumeColor==='function'){
    for(let i=0;i<128;i++)cols.push(gainVolumeColor(i));
  }
  Object.keys(epShadePalette).forEach(function(k){
    const p=epShadePalette[k];
    if(p) cols.push({r:p.r, g:p.g, b:p.b});
  });
  return cols;
}
function epShadeVariantColor(base, index, reserved){
  const minDist=28;
  function ok(c){
    if(c.r>235 && c.g>60 && c.b>60) return false;
    for(let i=0;i<reserved.length;i++){
      if(epShadeCheb(c, reserved[i])<minDist) return false;
    }
    return true;
  }
  for(let k=0;k<80;k++){
    const ang=((index*53+k*37)%360)*Math.PI/180;
    const rad=70+(k%5)*16;
    const c={
      r:Math.max(0, Math.min(255, Math.round(base.r+rad*Math.cos(ang)))),
      g:Math.max(0, Math.min(255, Math.round(base.g+rad*Math.sin(ang)))),
      b:Math.max(0, Math.min(255, Math.round(base.b+((index*41+k*23)%160)-80)))
    };
    if(ok(c)) return c;
  }
  for(let n=0;n<200;n++){
    const c={r:(n*47+index*13)%220, g:(n*29+80)%200, b:(n*61+40)%210};
    if(ok(c)) return c;
  }
  throw Object.assign(new Error('SHADE_COLOR_CAPACITY_EXCEEDED'),{code:'SHADE_COLOR_CAPACITY_EXCEEDED'});
}
function assignEpShadeColors(groups){
  epShadeGroups=groups||[];
  epShadePalette={};
  const reserved=epShadeReservedColors();
  epShadeGroups.forEach(function(g){
    if(!g) return;
    const base=IDF_MESH_PALETTE['wall_'+g.orient]||IDF_MESH_PALETTE.innerwall;
    if(g.index<=1){
      g.color={r:base.r, g:base.g, b:base.b, mat:base.mat};
      return;
    }
    const col=epShadeVariantColor(base, g.index, reserved);
    const pal={r:col.r, g:col.g, b:col.b, mat:'WALL_'+(EP_SHADE_MAT[g.orient]||'X')+g.index};
    epShadePalette[g.sslKey]=pal;
    g.color=pal;
    reserved.push(pal);
  });
}
let epShadePieces = {};
let epShadeParentT = {};
const EP_SHADE_STEP = 0.1;

function epShadeClearSplit(){
  epShadePieces = {};
  epShadeParentT = {};
}
function epSunVector(alt, az){
  const c = Math.cos(alt);
  return {x:-Math.sin(az)*c, y:-Math.cos(az)*c, z:Math.sin(alt)};
}
function epVsub(a,b){ return {x:a.x-b.x, y:a.y-b.y, z:a.z-b.z}; }
function epVdot(a,b){ return a.x*b.x+a.y*b.y+a.z*b.z; }
function epVcross(a,b){ return {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x}; }
function epVnorm(a){
  const m=Math.hypot(a.x,a.y,a.z);
  if(!(m>0)) return {x:0,y:0,z:0};
  return {x:a.x/m, y:a.y/m, z:a.z/m};
}
function epPolyConvex(verts){
  const g=newell(verts);
  if(!(g.mag>0)) return false;
  const n={x:g.nx/g.mag, y:g.ny/g.mag, z:g.nz/g.mag};
  let sign=0;
  for(let i=0;i<verts.length;i++){
    const a=verts[i], b=verts[(i+1)%verts.length], c=verts[(i+2)%verts.length];
    const s=epVdot(epVcross(epVsub(b,a), epVsub(c,b)), n);
    if(Math.abs(s)<1e-8) continue;
    const sg=s>0?1:-1;
    if(!sign) sign=sg;
    else if(sg!==sign) return false;
  }
  return true;
}
function epRayTri(o, d, a, b, c){
  const EPS=1e-8;
  const ab=epVsub(b,a), ac=epVsub(c,a);
  const pvec=epVcross(d, ac);
  const det=epVdot(ab, pvec);
  if(Math.abs(det)<EPS) return null;
  const inv=1/det;
  const tvec=epVsub(o, a);
  const u=epVdot(tvec, pvec)*inv;
  if(u<0 || u>1) return null;
  const qvec=epVcross(tvec, ab);
  const v=epVdot(d, qvec)*inv;
  if(v<0 || u+v>1) return null;
  const t=epVdot(ac, qvec)*inv;
  if(t<1e-4) return null;
  return t;
}
function epShadeCasterTris(exceptKey){
  const tris=[];
  function addPoly(verts, key){
    if(!verts || verts.length<3 || (key && key===exceptKey)) return;
    if(!epPolyConvex(verts)) return;
    for(let i=1;i<verts.length-1;i++) tris.push([verts[0], verts[i], verts[i+1]]);
  }
  const parse=(typeof epParse!=='undefined') ? epParse : null;
  if(!parse) return tris;
  (parse.shading||[]).forEach(function(s){ addPoly(s.verts, ''); });
  const faces=parse.meshBase || parse.meshFaces || [];
  faces.forEach(function(f){
    if(!f || f.shadePiece) return;
    const k=String(f.baseSslKey||f.sslKey||'');
    if(k.indexOf('wall_')!==0 && k!=='roof' && k!=='floor_out') return;
    addPoly(f.verts, typeof idfNameKey==='function' ? idfNameKey(f.idfName) : '');
  });
  return tris;
}
function epWallFrame(verts){
  const g=newell(verts);
  if(!(g.mag>0)) return null;
  const n=epVnorm({x:g.nx, y:g.ny, z:g.nz});
  let u=epVcross({x:0,y:0,z:1}, n);
  if(Math.hypot(u.x,u.y,u.z)<0.2) u=epVcross({x:1,y:0,z:0}, n);
  u=epVnorm(u);
  const v=epVnorm(epVcross(n, u));
  return {n:n, u:u, v:v, p0:verts[0]};
}
function epToUV(p, f){
  const d=epVsub(p, f.p0);
  return {u:epVdot(d, f.u), v:epVdot(d, f.v)};
}
function epFromUV(u, v, f){
  return {
    x:f.p0.x+f.u.x*u+f.v.x*v,
    y:f.p0.y+f.u.y*u+f.v.y*v,
    z:f.p0.z+f.u.z*u+f.v.z*v
  };
}
function epPointInPolyUV(x, y, poly){
  let inside=false;
  for(let i=0, j=poly.length-1; i<poly.length; j=i++){
    const xi=poly[i].u, yi=poly[i].v, xj=poly[j].u, yj=poly[j].v;
    const hit=((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi);
    if(hit) inside=!inside;
  }
  return inside;
}
function epAreaUV(poly){
  let a=0;
  for(let i=0;i<(poly||[]).length;i++){
    const p=poly[i], q=poly[(i+1)%poly.length];
    a+=p.u*q.v-q.u*p.v;
  }
  return a/2;
}
function epEnsureCCW(poly){
  const src=(poly||[]).map(function(p){ return {u:p.u, v:p.v}; });
  if(epAreaUV(src)<0) src.reverse();
  return src;
}
function epCrossUV(a, b, p){
  return (b.u-a.u)*(p.v-a.v)-(b.v-a.v)*(p.u-a.u);
}
function epCleanUV(poly){
  const out=[];
  (poly||[]).forEach(function(p){
    const q=out[out.length-1];
    if(q && Math.hypot(q.u-p.u, q.v-p.v)<1e-7) return;
    out.push({u:p.u, v:p.v});
  });
  if(out.length>2 && Math.hypot(out[0].u-out[out.length-1].u, out[0].v-out[out.length-1].v)<1e-7) out.pop();
  return out;
}
function epInsideLeft(p, a, b){
  return epCrossUV(a, b, p)>=-1e-8;
}
function epSegHitUV(s, e, a, b){
  const den=(e.u-s.u)*(b.v-a.v)-(e.v-s.v)*(b.u-a.u);
  if(Math.abs(den)<1e-12) return null;
  const t=((a.u-s.u)*(b.v-a.v)-(a.v-s.v)*(b.u-a.u))/den;
  const u=((a.u-s.u)*(e.v-s.v)-(a.v-s.v)*(e.u-s.u))/den;
  if(t<-1e-6 || t>1+1e-6 || u<-1e-6 || u>1+1e-6) return null;
  return {u:s.u+(e.u-s.u)*t, v:s.v+(e.v-s.v)*t, t:t};
}
function epSH(subject, clip){
  let out=epCleanUV(subject);
  const win=epEnsureCCW(clip);
  for(let i=0;i<win.length && out.length;i++){
    const a=win[i], b=win[(i+1)%win.length];
    const inp=out;
    out=[];
    for(let j=0;j<inp.length;j++){
      const s=inp[j], e=inp[(j+1)%inp.length];
      const sin=epInsideLeft(s, a, b), ein=epInsideLeft(e, a, b);
      if(ein){
        if(!sin){
          const h=epSegHitUV(s, e, a, b);
          if(h) out.push({u:h.u, v:h.v});
        }
        out.push({u:e.u, v:e.v});
      }else if(sin){
        const h=epSegHitUV(s, e, a, b);
        if(h) out.push({u:h.u, v:h.v});
      }
    }
    out=epCleanUV(out);
  }
  return out;
}
function epStrictInConvex(p, poly){
  for(let i=0;i<poly.length;i++){
    if(epCrossUV(poly[i], poly[(i+1)%poly.length], p)<=1e-8) return false;
  }
  return true;
}
function epOnOrInConvex(p, poly){
  for(let i=0;i<poly.length;i++){
    if(epCrossUV(poly[i], poly[(i+1)%poly.length], p)<-1e-6) return false;
  }
  return true;
}
function epRelConvex(p, poly){
  let m=Infinity;
  for(let i=0;i<poly.length;i++){
    const c=epCrossUV(poly[i], poly[(i+1)%poly.length], p);
    if(c<m) m=c;
  }
  return m;
}
function epOnSegUV(p, a, b){
  const du=b.u-a.u, dv=b.v-a.v;
  const len=du*du+dv*dv;
  if(len<1e-16) return Math.hypot(p.u-a.u, p.v-a.v)<1e-6;
  const t=((p.u-a.u)*du+(p.v-a.v)*dv)/len;
  if(t<-1e-5 || t>1+1e-5) return false;
  return Math.hypot(p.u-(a.u+du*t), p.v-(a.v+dv*t))<1e-5;
}
function epDiffConvex(subject, cutter){
  subject=epCleanUV(epEnsureCCW(subject));
  cutter=epCleanUV(epEnsureCCW(cutter));
  if(subject.length<3 || cutter.length<3) return subject.length>=3 ? [subject] : [];
  const inter=epCleanUV(epSH(subject, cutter));
  const ai=Math.abs(epAreaUV(inter)), as=Math.abs(epAreaUV(subject));
  if(!(ai>1e-8)) return [subject];
  if(ai>as-1e-6) return [];
  function outside(p){ return epRelConvex(p, cutter)<-1e-7; }
  function edgeIndex(p){
    let best=-1, bestD=1e-5;
    for(let e=0;e<subject.length;e++){
      const a=subject[e], b=subject[(e+1)%subject.length];
      if(!epOnSegUV(p, a, b)) continue;
      const d=Math.hypot(p.u-a.u, p.v-a.v);
      if(d>bestD){ best=e; bestD=d; }
    }
    return best;
  }
  let start=-1;
  for(let i=0;i<subject.length;i++) if(outside(subject[i])){ start=i; break; }
  if(start<0) return null;
  const poly=[];
  let i=start, guard=0;
  while(guard++<subject.length+4){
    const j=(i+1)%subject.length;
    const s=subject[i], e=subject[j];
    poly.push(s);
    if(outside(s) && !outside(e)){
      let hit=null, ek=-1, best=2;
      for(let k=0;k<cutter.length;k++){
        const h=epSegHitUV(s, e, cutter[k], cutter[(k+1)%cutter.length]);
        if(h && h.t>1e-5 && h.t<1-1e-5 && h.t<best){ hit=h; ek=k; best=h.t; }
      }
      if(!hit) return null;
      poly.push({u:hit.u, v:hit.v});
      let from={u:hit.u, v:hit.v};
      let k=ek;
      let rejoined=false;
      for(let step=0; step<cutter.length+1; step++){
        const v1=cutter[k];
        const ea=edgeIndex(v1);
        if(ea>=0 && Math.hypot(v1.u-from.u, v1.v-from.v)>1e-5){
          poly.push({u:v1.u, v:v1.v});
          const next=(ea+1)%subject.length;
          if(next===start){ rejoined=true; i=start; break; }
          i=next;
          rejoined=true;
          break;
        }
        let exit=null, ex=-1, bt=2;
        for(let e2=0;e2<subject.length;e2++){
          const h2=epSegHitUV(from, v1, subject[e2], subject[(e2+1)%subject.length]);
          if(h2 && h2.t>1e-4 && h2.t<1-1e-4 && h2.t<bt){ exit=h2; ex=e2; bt=h2.t; }
        }
        if(exit){
          poly.push({u:exit.u, v:exit.v});
          const next=(ex+1)%subject.length;
          if(next===start){ rejoined=true; i=start; break; }
          i=next;
          rejoined=true;
          break;
        }
        if(!epOnOrInConvex(v1, subject)) return null;
        poly.push(v1);
        from=v1;
        k=(k-1+cutter.length)%cutter.length;
      }
      if(!rejoined) return null;
      if(i===start) break;
      continue;
    }
    if(j===start) break;
    i=j;
  }
  const cleaned=epCleanUV(poly);
  const got=Math.abs(epAreaUV(cleaned));
  if(cleaned.length<3 || !(got>1e-8)) return null;
  if(Math.abs(got-(as-ai))>Math.max(1e-3, as*0.12)) return null;
  return [epEnsureCCW(cleaned)];
}
function epTriangulateUV(poly){
  const ccw=epEnsureCCW(poly);
  if(ccw.length<3) return [];
  if(ccw.length===3) return [ccw];
  const ring=ccw.map(function(p){ return {x:p.u, y:p.v}; });
  const ears=idfMeshEarClip2(ring);
  if(!ears.length) return [ccw];
  return ears.map(function(t){ return [ccw[t[0]], ccw[t[1]], ccw[t[2]]]; });
}
function epClipFront(raw, eps){
  const out=[];
  for(let i=0;i<raw.length;i++){
    const s=raw[i], e=raw[(i+1)%raw.length];
    const sin=s.t>=eps-1e-8, ein=e.t>=eps-1e-8;
    function at(t){
      const u=(t-s.t)/((e.t-s.t)||1e-12);
      return {V:{x:s.V.x+(e.V.x-s.V.x)*u, y:s.V.y+(e.V.y-s.V.y)*u, z:s.V.z+(e.V.z-s.V.z)*u}, t:t};
    }
    if(sin && ein) out.push(e);
    else if(sin && !ein) out.push(at(eps));
    else if(!sin && ein){ out.push(at(eps)); out.push(e); }
  }
  return out;
}
function epProjectCaster(tri, frame, sun){
  const denom=epVdot(sun, frame.n);
  if(!(denom>1e-6)) return null;
  const raw=tri.map(function(V){
    return {V:V, t:epVdot(epVsub(V, frame.p0), frame.n)/denom};
  });
  if(!raw.some(function(r){ return r.t>0.01; })) return null;
  if(raw.some(function(r){ return r.t>80; })) return null;
  const clipped=epClipFront(raw, 0);
  if(clipped.length<3) return null;
  const uv=clipped.map(function(r){
    const t=Math.max(0, r.t);
    return epToUV({x:r.V.x-sun.x*t, y:r.V.y-sun.y*t, z:r.V.z-sun.z*t}, frame);
  });
  const ccw=epEnsureCCW(uv);
  if(!(Math.abs(epAreaUV(ccw))>1e-4)) return null;
  return ccw;
}
function epPartitionWall(wallUV, shadows){
  const wallCCW=epEnsureCCW(wallUV);
  const ring=wallCCW.map(function(p){ return {x:p.u, y:p.v}; });
  let ears=idfMeshEarClip2(ring);
  if(!ears.length){
    if(wallUV.length===3) ears=[[0,1,2]];
    else return null;
  }
  const wallArea=Math.abs(epAreaUV(epEnsureCCW(wallUV)));
  const sun=[], shade=[];
  let failed=false;
  ears.forEach(function(t){
    if(failed) return;
    let parts=[epEnsureCCW([wallCCW[t[0]], wallCCW[t[1]], wallCCW[t[2]]])];
    (shadows||[]).forEach(function(shadow){
      if(failed) return;
      const next=[];
      parts.forEach(function(poly){
        epTriangulateUV(poly).forEach(function(tri){
          if(failed) return;
          const clip=epEnsureCCW(tri);
          const inter=epCleanUV(epSH(shadow, clip));
          if(inter.length>=3 && Math.abs(epAreaUV(inter))>1e-8){
            shade.push(inter);
            const diff=epDiffConvex(clip, inter);
            if(!diff){ failed=true; return; }
            diff.forEach(function(d){
              if(d.length>=3 && Math.abs(epAreaUV(d))>1e-8) next.push(epEnsureCCW(d));
            });
          }else next.push(clip);
        });
      });
      parts=next;
    });
    parts.forEach(function(p){ if(p.length>=3) sun.push(p); });
  });
  if(failed) return null;
  let got=0;
  sun.concat(shade).forEach(function(p){ got+=Math.abs(epAreaUV(p)); });
  if(!(wallArea>0) || Math.abs(got-wallArea)>Math.max(1e-3, wallArea*0.08)) return null;
  return {sun:sun, shade:shade};
}
function epWallShadePolys(wallVerts, frame, sunDir, casterTris){
  const wallUV=wallVerts.map(function(p){ return epToUV(p, frame); });
  const shadows=[];
  (casterTris||[]).forEach(function(tri){
    const uv=epProjectCaster(tri, frame, sunDir);
    if(uv) shadows.push(uv);
  });
  if(!shadows.length || shadows.length>240) return null;
  const parts=epPartitionWall(wallUV, shadows);
  if(!parts || !parts.sun.length || !parts.shade.length) return null;
  function to3(polys){
    return polys.map(function(poly){
      let q=poly.map(function(p){ return epFromUV(p.u, p.v, frame); });
      const g=newell(q);
      if(!(g.area>1e-6)) return null;
      if(epVdot({x:g.nx, y:g.ny, z:g.nz}, frame.n)<0) q.reverse();
      return q;
    }).filter(Boolean);
  }
  const sun=to3(parts.sun), shade=to3(parts.shade);
  if(!sun.length || !shade.length) return null;
  return {sun:sun, shade:shade};
}
function epWallShadePieces(verts, holes, tris, sunDir, step){
  const frame=epWallFrame(verts);
  if(!frame) return null;
  if(epVdot(frame.n, sunDir)<=0.02) return null;
  const uv=verts.map(function(p){ return epToUV(p, frame); });
  let umin=Infinity, umax=-Infinity, vmin=Infinity, vmax=-Infinity;
  uv.forEach(function(p){
    if(p.u<umin) umin=p.u; if(p.u>umax) umax=p.u;
    if(p.v<vmin) vmin=p.v; if(p.v>vmax) vmax=p.v;
  });
  const nu=Math.max(1, Math.round((umax-umin)/((step>0)?step:EP_SHADE_STEP)));
  const nv=Math.max(1, Math.round((vmax-vmin)/((step>0)?step:EP_SHADE_STEP)));
  if(nu*nv>8000) return null;
  const du=(umax-umin)/nu, dv=(vmax-vmin)/nv;
  const holeUV=(holes||[]).map(function(h){ return h.map(function(p){ return epToUV(p, frame); }); });
  const mask=[];
  let nSun=0, nShade=0;
  for(let j=0;j<nv;j++){
    mask[j]=[];
    for(let i=0;i<nu;i++){
      const cu=umin+(i+0.5)*du, cv=vmin+(j+0.5)*dv;
      if(!epPointInPolyUV(cu, cv, uv)){ mask[j][i]=-1; continue; }
      let hole=false;
      for(let h=0;h<holeUV.length;h++){
        if(epPointInPolyUV(cu, cv, holeUV[h])){ hole=true; break; }
      }
      const p=epFromUV(cu, cv, frame);
      const o={x:p.x+frame.n.x*0.005, y:p.y+frame.n.y*0.005, z:p.z+frame.n.z*0.005};
      let shaded=false;
      for(let t=0;t<tris.length;t++){
        if(epRayTri(o, sunDir, tris[t][0], tris[t][1], tris[t][2])!=null){ shaded=true; break; }
      }
      mask[j][i]=shaded?0:1;
      if(hole) continue;
      if(shaded) nShade++; else nSun++;
    }
  }
  const n=nSun+nShade;
  if(!(n>0)) return null;
  const f=nSun/n;
  if(f<=0.02 || f>=0.98) return null;
  function quadsFor(kind){
    const used=[];
    for(let j=0;j<nv;j++){ used[j]=[]; for(let i=0;i<nu;i++) used[j][i]=false; }
    const quads=[];
    for(let j=0;j<nv;j++){
      for(let i=0;i<nu;i++){
        if(used[j][i] || mask[j][i]!==kind) continue;
        let w=1;
        while(i+w<nu && mask[j][i+w]===kind && !used[j][i+w]) w++;
        let h=1;
        while(j+h<nv){
          let ok=true;
          for(let k=0;k<w;k++) if(mask[j+h][i+k]!==kind || used[j+h][i+k]) ok=false;
          if(!ok) break;
          h++;
        }
        for(let yy=0;yy<h;yy++) for(let xx=0;xx<w;xx++) used[j+yy][i+xx]=true;
        const u0=umin+i*du, u1=umin+(i+w)*du, v0=vmin+j*dv, v1=vmin+(j+h)*dv;
        let q=[epFromUV(u0,v0,frame), epFromUV(u1,v0,frame), epFromUV(u1,v1,frame), epFromUV(u0,v1,frame)];
        const gn=newell(q);
        if(epVdot({x:gn.nx,y:gn.ny,z:gn.nz}, frame.n)<0) q.reverse();
        quads.push(q);
      }
    }
    return quads;
  }
  function clippedParts(kind){
    const wallCCW=epEnsureCCW(uv);
    const ring=wallCCW.map(function(p){ return {x:p.u, y:p.v}; });
    let ears=idfMeshEarClip2(ring);
    if(!ears.length){
      if(wallCCW.length===3) ears=[[0,1,2]];
      else return null;
    }
    const used=[];
    for(let j=0;j<nv;j++){ used[j]=[]; for(let i=0;i<nu;i++) used[j][i]=false; }
    const polys=[];
    for(let j=0;j<nv;j++){
      for(let i=0;i<nu;i++){
        if(used[j][i] || mask[j][i]!==kind) continue;
        let w=1;
        while(i+w<nu && mask[j][i+w]===kind && !used[j][i+w]) w++;
        let h=1;
        while(j+h<nv){
          let ok=true;
          for(let k=0;k<w;k++) if(mask[j+h][i+k]!==kind || used[j+h][i+k]) ok=false;
          if(!ok) break;
          h++;
        }
        for(let yy=0;yy<h;yy++) for(let xx=0;xx<w;xx++) used[j+yy][i+xx]=true;
        const cell=epEnsureCCW([
          {u:umin+i*du, v:vmin+j*dv},
          {u:umin+(i+w)*du, v:vmin+j*dv},
          {u:umin+(i+w)*du, v:vmin+(j+h)*dv},
          {u:umin+i*du, v:vmin+(j+h)*dv}
        ]);
        ears.forEach(function(t){
          const tri=epEnsureCCW([wallCCW[t[0]], wallCCW[t[1]], wallCCW[t[2]]]);
          const hit=epCleanUV(epSH(cell, tri));
          if(hit.length>=3 && Math.abs(epAreaUV(hit))>1e-8) polys.push(hit);
        });
      }
    }
    return polys.map(function(poly){
      let q=poly.map(function(p){ return epFromUV(p.u, p.v, frame); });
      const g=newell(q);
      if(!(g.area>1e-8)) return null;
      if(epVdot({x:g.nx, y:g.ny, z:g.nz}, frame.n)<0) q.reverse();
      return q;
    }).filter(Boolean);
  }
  const sunClip=clippedParts(1), shadeClip=clippedParts(0);
  if(sunClip && shadeClip && sunClip.length && shadeClip.length) return {f:f, sun:sunClip, shade:shadeClip};
  return {f:f, sun:quadsFor(1), shade:quadsFor(0)};
}
function epShadeLocalTemps(rec, f, opts){
  const alpha=(opts.alpha>0)?opts.alpha:0.7;
  const ho=(opts.ho>0)?opts.ho:23;
  const idn=(opts.idn>0)?opts.idn:0;
  const isky=(opts.isky>0)?opts.isky:0;
  const rho=(opts.rho>=0)?opts.rho:0.2;
  const face=(typeof epParse!=='undefined' && epParse) ? (epParse.meshBase||epParse.meshFaces||[]).filter(function(fc){
    return fc && !fc.shadePiece && typeof idfNameKey==='function' && idfNameKey(fc.idfName)===idfNameKey(rec.name);
  })[0] : null;
  if(!face) return null;
  const frame=epWallFrame(face.verts);
  if(!frame) return null;
  const sun=epSunVector(opts.sunAlt, opts.sunAz);
  const cosInc=Math.max(0, epVdot(frame.n, sun));
  const ib=idn*cosInc;
  const skyF=(1+frame.n.z)/2, gndF=(1-frame.n.z)/2;
  const sinAlt=Math.sin(opts.sunAlt);
  const idiff=isky*skyF + (idn*sinAlt+isky)*rho*gndF;
  if(!(ib>1) || !(idiff>1) || !isFinite(rec.isol)) return null;
  const k=ib/idiff;
  const id=rec.isol/(1+f*k);
  const iSun=id*(1+k), iShade=id;
  const eta=(rec.eta>0)?rec.eta:1;
  const uRatio=(rec.uCfd>0 && rec.uIso>0)?rec.uIso/rec.uCfd:1;
  const scale=uRatio*eta*alpha/ho;
  return {
    tSun:rec.tSurf+scale*(iSun-rec.isol),
    tShade:rec.tSurf+scale*(iShade-rec.isol),
    satSun:rec.satRaw+(alpha/ho)*(iSun-rec.isol),
    satShade:rec.satRaw+(alpha/ho)*(iShade-rec.isol),
    iSun:iSun, iShade:iShade
  };
}
function epRefineShadeRecs(recs, opts, indoor){
  epShadeClearSplit();
  if(!recs || !opts || !(opts.sunAlt>0) || typeof epParse==='undefined' || !epParse) return recs||[];
  if(!epParse.meshBase) epParse.meshBase=(epParse.meshFaces||[]).filter(function(f){ return f && !f.shadePiece; });
  const sun=epSunVector(opts.sunAlt, opts.sunAz);
  const out=[];
  (recs||[]).forEach(function(s){
    if(!s || s.isRoof){ out.push(s); return; }
    const key=idfNameKey(s.name);
    const face=(epParse.meshBase||[]).filter(function(f){ return f && idfNameKey(f.idfName)===key; })[0];
    if(!face || String(face.sslKey||'').indexOf('wall_')!==0){ out.push(s); return; }
    const holes=[];
    (epParse.meshBase||[]).forEach(function(f){
      if(!f || (f.kind!=='window' && f.kind!=='door')) return;
      if(idfNameKey(f.parent)!==key) return;
      holes.push(f.verts);
    });
    const tris=epShadeCasterTris(key);
    const pieces=epWallShadePieces(face.verts, holes, tris, sun, EP_SHADE_STEP);
    if(!pieces || !pieces.sun.length || !pieces.shade.length){ out.push(s); return; }
    const temps=epShadeLocalTemps(s, pieces.f, opts);
    const step=(typeof EP_SHADE_DT==='number' && EP_SHADE_DT>0)?EP_SHADE_DT:0.1;
    if(!temps || !(Math.abs(temps.tSun-temps.tShade)>step)){ out.push(s); return; }
    epShadeParentT[key]=s.tSurf;
    function pushPart(part, tSurf, satRaw, isol, area, quads){
      const name=s.name+'//'+part;
      const uRatio=(s.uCfd>0 && s.uIso>0)?s.uCfd/s.uIso:1;
      const rec=Object.assign({}, s, {
        name:name, area:area, tSurf:tSurf, satRaw:satRaw, isol:isol,
        etd:isFinite(indoor)?(tSurf-indoor)*uRatio:s.etd
      });
      epShadePieces[key]=epShadePieces[key]||{};
      epShadePieces[key][part]={name:name, quads:quads};
      out.push(rec);
    }
    pushPart('sun', temps.tSun, temps.satSun, temps.iSun, s.area*pieces.f, pieces.sun);
    pushPart('shade', temps.tShade, temps.satShade, temps.iShade, s.area*(1-pieces.f), pieces.shade);
  });
  return out;
}
function applyEpShadeToMesh(groups){
  if(typeof epParse==='undefined' || !epParse || !epParse.meshFaces) return;
  if(!groups || !groups.length) epShadeClearSplit();
  if(!epParse.meshBase) epParse.meshBase=epParse.meshFaces.filter(function(f){ return f && !f.shadePiece; });
  const byName={};
  (groups||[]).forEach(function(g){
    (g.names||[]).forEach(function(n){
      if(typeof idfNameKey==='function') byName[idfNameKey(n)]=g.sslKey;
    });
  });
  const next=[];
  epParse.meshBase.forEach(function(f){
    if(!f) return;
    const spec=f.idfName && epShadePieces[idfNameKey(f.idfName)];
    if(spec && (spec.sun || spec.shade)){
      ['sun','shade'].forEach(function(part){
        const p=spec[part];
        if(!p) return;
        const ssl=byName[idfNameKey(p.name)] || f.sslKey;
        (p.quads||[]).forEach(function(verts, qi){
          next.push({
            sslKey:ssl, baseSslKey:f.baseSslKey||f.sslKey, nameJa:f.nameJa, idfName:p.name,
            zone:f.zone, kind:f.kind, verts:verts, shadePiece:true,
            modelToolAz:f.modelToolAz, parent:f.parent, u:f.u,
            atFaceId:(f.atFaceId||('ep-'+p.name))+'-'+part+'-'+qi,
            tris:idfMeshEarClip3(verts)
          });
        });
      });
      return;
    }
    const copy={
      sslKey:f.sslKey, baseSslKey:f.baseSslKey||f.sslKey, nameJa:f.nameJa, idfName:f.idfName,
      zone:f.zone, kind:f.kind, verts:f.verts, parent:f.parent, u:f.u,
      atFaceId:f.atFaceId, modelToolAz:f.modelToolAz, tris:f.tris
    };
    if(String(copy.baseSslKey||'').indexOf('wall_')===0){
      const hit=copy.idfName && byName[idfNameKey(copy.idfName)];
      copy.sslKey=hit||copy.baseSslKey;
    }
    next.push(copy);
  });
  epParse.meshFaces=next;
  if(typeof epSyncViewerMesh==='function') epSyncViewerMesh();
}
function epShadeForSurface(name){
  if(typeof idfNameKey!=='function') return null;
  const key=idfNameKey(name);
  for(let i=0;i<epShadeGroups.length;i++){
    const g=epShadeGroups[i];
    const names=g && g.names || [];
    for(let j=0;j<names.length;j++){
      if(idfNameKey(names[j])===key) return g;
    }
  }
  return null;
}

function idfMeshPaletteForFace(face){
  if(typeof boundaryThermalPalette==='function'){
    const specific=boundaryThermalPalette(face);if(specific)return specific;
  }
  if(face && face.sslKey && epShadePalette[face.sslKey]) return epShadePalette[face.sslKey];
  if(face && (face.kind==='window' || face.sslKey==='window')){
    const src = (typeof cfdMeshSource==='function') ? cfdMeshSource() : null;
    if(src && src.kind==='at'){
      if(typeof architrendWindowPalette==='function'){
        const specific=architrendWindowPalette(face);if(specific)return specific;
      }
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
function idfMeshDomainAdvice(){
  const shift=idfMeshOriginShiftMm();
  if(!shift || !shift.aabb) return null;
  const sx=(shift.aabb.maxx-shift.aabb.minx)/1000;
  const sy=(shift.aabb.maxy-shift.aabb.miny)/1000;
  const sz=(shift.aabb.maxz-shift.aabb.minz)/1000;
  if(!(sx>0) || !(sy>0) || !(sz>0)) return null;
  const step=IDF_MESH_STEP_M;
  const min={x:0, y:0, z:0};
  const max={x:sx, y:sy, z:sz};
  const nx=Math.ceil(sx/step - 1e-12);
  const ny=Math.ceil(sy/step - 1e-12);
  const nz=Math.ceil(sz/step - 1e-12);
  return {sx:sx, sy:sy, sz:sz, pad:0, step:step, min:min, max:max, nx:nx, ny:ny, nz:nz, total:nx*ny*nz};
}
function idfMeshDomainFmt(v, unit){
  const n=Number(v);
  if(!isFinite(n)) return '—';
  const shown=unit==='mm' ? n*1000 : n;
  return shown.toFixed(5);
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
    host.innerHTML='<p class="small" style="margin:0;">3DS または IDF を読むと、FlowDesigner に入れる解析領域の最大値がここに出ます。最小（オフセット）は 0 です。</p>';
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
  html+='<p class="fd-domain-note">合体概形 '+idfMeshDomainFmt(d.sx,'m')+' × '+idfMeshDomainFmt(d.sy,'m')+' × '+idfMeshDomainFmt(d.sz,'m')+' m。原点はモデルの左下なので、最小（オフセット）は 0 のまま、最大だけこの値にしてください。</p>';
  html+='<div class="fd-domain-copy"><button type="button" data-domain-copy>この数値をコピー</button></div>';
  host.innerHTML=html;
}

function idfMeshStairRoomSource(){
  if(typeof appMode!=='undefined' && appMode==='energyplus' && typeof epViewMesh!=='undefined' && epViewMesh && (epViewMesh.rooms||[]).some(function(r){ return r && r.stair; })) return epViewMesh;
  if(typeof atMesh!=='undefined' && atMesh) return atMesh;
  return null;
}
function idfMeshStairMeshes(){
  const out=[];
  const src=idfMeshStairRoomSource();
  if(!src) return out;
  function panelMesh(vertsM){
    const verts=(vertsM||[]).map(function(v){ return {x:v.x*1000, y:v.y*1000, z:v.z*1000}; });
    if(verts.length<3) return null;
    const ears=typeof idfMeshEarClip3==='function' ? idfMeshEarClip3(verts) : [];
    return {verts:verts, tris:ears.length ? ears : idfMeshTriangulate(verts.length)};
  }
  (src.rooms||[]).forEach(function(r){
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
      sslKey: pal.sslKey||face.sslKey,
      u: pal.u!=null ? pal.u : (face.u>0 ? face.u : ''),
      rgb: pal.r+' '+pal.g+' '+pal.b
    });
  });
  idfMeshAppendStairs(usedMats, objects, rows, seq, origin);
  if((src.kind==='at' || src.kind==='ep') && typeof atPartMeshesMm==='function'){
    atPartMeshesMm().forEach(function(mesh){
      const pal=IDF_MESH_PALETTE[mesh.key];
      if(!pal||!mesh.verts.length||!mesh.tris.length||mesh.kind==='ac') return;
      usedMats[pal.mat]=pal;
      const code=mesh.kind==='ac'?'AC':'DR';
      const suffix={ac_body:'B',ac_supply:'S',ac_return:'R',doorbody:'B',doorgap_top:'T',doorgap_uc:'U',dooropen:'O'}[mesh.key];
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
  if(typeof boundaryExportReadiness==='function'){
    const readiness=boundaryExportReadiness('model');
    if(!readiness.ready){if(info)info.textContent=readiness.message;return;}
  }
  const built = buildIdfMeshExport();
  if(!built){
    if(info) info.textContent = 'EnergyPlusモードでIDF、またはArchitrendモードで3DSを読むと書き出せます。';
    return;
  }
  const stamp = String(built.stamp||'cfd').replace(/\.[^.]+$/,'') || 'cfd';
  const fill = buildIdfFillExport();
  const gain = buildIdfGainExport();
  if(built.kind==='at'&&typeof boundaryThermalMarkExported==='function')boundaryThermalMarkExported();
  const exportEpoch=typeof window!=='undefined'?window.boundaryExportEpoch:undefined;
  const sourceFaces=cfdMeshSource().faces;
  const exportStillCurrent=function(){
    const current=cfdMeshSource();
    return !!current&&current.faces===sourceFaces&&
      (typeof window==='undefined'||window.boundaryExportEpoch===exportEpoch)&&
      (typeof boundaryExportReadiness!=='function'||boundaryExportReadiness('model').ready);
  };
  idfMeshDownloadBlob(new Blob([built.bytes], {type:'application/octet-stream'}), stamp+'_cfd.3ds');
  setTimeout(function(){
    if(!exportStillCurrent())return;
    idfMeshDownloadBlob(new Blob([idfMeshCsvText(built.rows)], {type:'text/csv;charset=utf-8'}), stamp+'_cfd_names.csv');
  }, 250);
  if(fill){
    setTimeout(function(){
      if(!exportStillCurrent())return;
      idfMeshDownloadBlob(new Blob([fill.bytes], {type:'application/octet-stream'}), stamp+'_cfd_fill.3ds');
    }, 500);
  }
  if(gain){
    setTimeout(function(){
      if(!exportStillCurrent())return;
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
    msg += ' 解析領域（m） X 0〜'+domain.max.x.toFixed(5)
      +' / Y 0〜'+domain.max.y.toFixed(5)
      +' / Z 0〜'+domain.max.z.toFixed(5)
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
  if(btn) btn.disabled = !ready || (typeof boundaryExportReadiness==='function' && !boundaryExportReadiness('model').ready);
  if(typeof appMode!=='undefined' && appMode==='architrend'){
    if(banner) banner.textContent = 'Architrend の 3DS があれば、方位色分けした CFD モデル種をここから出せます。内壁・天井つきの3DSにも対応します。厚みは付けません。';
    if(guide) guide.textContent = 'Architrend の 3DS から色分け 3DS を作ります。単位は m です。3Dビューワーで置いたドアは家モデルへ出します。完全開口は床からその階の天井まで、開口率100%の面です。内部発熱は *_cfd_gain.3ds に分けて出します。';
  }else if(typeof appMode!=='undefined' && appMode==='energyplus'){
    if(banner) banner.textContent = 'IDF があれば、色分け済みの CFD モデル種をここから出せます。内部発熱は *_cfd_gain.3ds に分けて出します。厚みは付けません。';
    if(guide) guide.textContent = 'EnergyPlus の IDF 頂点から、厚みなしの色分け 3DS を作ります。同じ方位の外壁でも、SQL の面日射から求めた外気温の差が 0.1℃を超える部分は別色にします。庇がある壁は、解析時刻の日影で日なたと日陰に分けます。居室に加えて床下（基礎外周）と小屋裏（屋根・妻壁）も出します。内部発熱の発生エリア（薄い赤）は *_cfd_gain.3ds として別ファイルです。SSL で部屋ごとの発熱・発湿を自動割当します。居室に接する面は居室側だけ残し、二重にはしません。FlowDesigner に取り込んだあと、次の SSL 一括反映で境界条件を流し込みます。';
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
    const splits=(typeof epShadeGroups!=='undefined' ? epShadeGroups : []).filter(function(g){ return g && g.index>1; });
    if(splits.length){
      html += '<p class="small" style="margin:8px 0 4px;">同じ方位でも CFD 外気温の差が 0.1℃を超える外壁は、別色で出します。庇の日なたと日陰も別色です。SSL はその色にその外気温を入れます。</p><table><tr><th>外壁</th><th>外気温 ℃</th><th>面数</th><th>色</th></tr>';
      epShadeGroups.slice().sort(function(a,b){
        return String(a.orient).localeCompare(String(b.orient),'ja') || a.index-b.index;
      }).forEach(function(g){
        if(!g.color) return;
        const label=g.index<=1 ? g.orient : (g.orient+'#'+g.index);
        const rgb='rgb('+g.color.r+','+g.color.g+','+g.color.b+')';
        html += '<tr><td class="l">'+label+'</td><td>'+(isFinite(g.tCfd)?g.tCfd.toFixed(2):'—')+'</td><td>'+(g.n||'')+'</td><td class="l"><span style="display:inline-block;width:28px;height:12px;border:1px solid #C9C9C9;background:'+rgb+';vertical-align:middle;margin-right:6px;"></span>'+
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
    html += '<p class="small" style="margin:8px 0 0;">'+originNote+' 家・埋メ・発熱・エアコンFDDは同じ原点です。</p>';
  }
  sum.innerHTML = html;
}

(function initIdfMeshUi(){
  const btn = document.getElementById('idfMeshExportBtn');
  if(btn) btn.addEventListener('click', exportIdfMesh);
  const acBtn = document.getElementById('atAcFddExportBtn');
  if(acBtn) acBtn.addEventListener('click', function(){ exportAtAcFdd(); });
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

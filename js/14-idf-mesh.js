// ========================= IDF → 色分け 3DS 書き出し =========================
// EnergyPlus の meshFaces (12-energyplus.js) から厚みなしポリゴンの 3DS を作る。
// 窓は親壁と同一平面にぴったり重ねる（色で識別）。単位は mm。

const IDF_MESH_PALETTE = {
  wall_北: {r:40, g:80, b:180, mat:'WALL_N'},
  wall_東: {r:40, g:160, b:80, mat:'WALL_E'},
  wall_南: {r:200, g:60, b:50, mat:'WALL_S'},
  wall_西: {r:180, g:140, b:40, mat:'WALL_W'},
  roof: {r:120, g:50, b:50, mat:'ROOF'},
  floor1: {r:90, g:90, b:90, mat:'FLOOR1'},
  found: {r:70, g:50, b:40, mat:'FOUND'},
  attic: {r:160, g:150, b:175, mat:'ATTIC'},
  innerwall: {r:180, g:180, b:180, mat:'INNER'},
  window: {r:80, g:180, b:220, mat:'WINDOW'},
  doorbody: {r:255, g:96, b:24, mat:'DOOR'},
  fill_solid: (typeof FILL_SOLID_COLOR!=='undefined') ? FILL_SOLID_COLOR : {r:61, g:61, b:61, mat:'FILL'}
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
"\u71B1":[0x94,0x4D]
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
    .filter(function(f){ return f && (f.cantilever || f.nameJa==='2F床'); })
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
function idfMeshBuildFillPrisms(){
  const roofs=idfMeshRoofFacesMm();
  const cants=idfMeshCantileverFacesMm();
  const floors1=idfMeshFloor1FacesMm();
  const founds=idfMeshFoundFacesMm();
  if(!roofs.length && !cants.length && !floors1.length && !founds.length) return null;
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
  if(!(zFloor1<1e12)){
    let zmax=-Infinity;
    founds.forEach(function(verts){
      verts.forEach(function(v){ if(v.z>zmax) zmax=v.z; });
    });
    zFloor1 = (zmax>-1e12) ? zmax : 0;
  }
  const cantGroups=[];
  cants.forEach(function(verts){
    const z=verts.reduce(function(s,v){ return s+v.z; },0)/verts.length;
    let g=cantGroups.find(function(x){ return Math.abs(x.z-z)<40; });
    if(!g){ g={z:z, pts:[]}; cantGroups.push(g); }
    verts.forEach(function(v){ g.pts.push(v); });
  });
  cantGroups.forEach(function(g){
    const hull=idfMeshConvexHull2(g.pts);
    if(hull.length<3) return;
    if(!(g.z-zFloor1>30)) return;
    const bot=hull.map(function(p){ return {x:p.x, y:p.y, z:zFloor1}; });
    const top=hull.map(function(p){ return {x:p.x, y:p.y, z:g.z}; });
    idfMeshPushPrism(prisms, bot, top);
  });
  let zFound=idfMeshFoundZMm();
  if(!(zFound<1e12)) zFound=null;
  const foundPts=[];
  (floors1.length ? floors1 : founds).forEach(function(verts){
    verts.forEach(function(v){ foundPts.push(v); });
  });
  if(foundPts.length && zFound!=null && zFloor1-zFound>30){
    const hull=idfMeshConvexHull2(foundPts);
    if(hull.length>=3){
      const bot=hull.map(function(p){ return {x:p.x, y:p.y, z:zFound}; });
      const top=hull.map(function(p){ return {x:p.x, y:p.y, z:zFloor1}; });
      idfMeshPushPrism(prisms, bot, top);
    }
  }
  if(!prisms.length) return null;
  return {zTop:(zTop>0?zTop:zFloor1), zFound:zFound, zFloor1:zFloor1, prisms:prisms};
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
function buildIdfFillExport(){
  if(!idfMeshReady()) return null;
  const built=idfMeshBuildFillPrisms();
  if(!built || !built.prisms.length) return null;
  const pal=IDF_MESH_PALETTE.fill_solid;
  const objects=[];
  const rows=[];
  built.prisms.forEach(function(mesh, idx){
    const name='FILL'+String(idx+1).padStart(2,'0');
    const named=idfMeshNameZ(name);
    objects.push(idfMeshNamedMesh(named.bytes, mesh.verts, mesh.tris, pal.mat));
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
  const mats={};
  mats[pal.mat]=pal;
  return {
    bytes:idfMeshPack3ds(mats, objects),
    rows:rows,
    zTop:built.zTop,
    prismCount:built.prisms.length
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
  if(typeof appMode==='undefined' || appMode!=='energyplus') return [];
  if(typeof epParse==='undefined' || !epParse) return [];
  if(!epParse.gainVolumes && typeof buildEpGainVolumes==='function') buildEpGainVolumes(epParse);
  return epParse.gainVolumes||[];
}
function idfMeshRoomNameForZone(zone){
  if(typeof document==='undefined' || !document.querySelectorAll) return zone||'';
  const cards=document.querySelectorAll('.room-card[data-ep-zone]');
  for(let i=0;i<cards.length;i++){
    if(cards[i].dataset.epZone===zone){
      const el=cards[i].querySelector('.roomName');
      if(el && String(el.value).trim()) return String(el.value).trim();
    }
  }
  return zone||'';
}
function idfMeshAppendGainVolumes(usedMats, objects, rows, seq){
  const vols=idfMeshEnsureGainVolumes();
  vols.forEach(function(vol){
    const pal=vol.color||{r:255,g:176,b:168,mat:'GAIN'};
    usedMats[pal.mat]=pal;
    const solid=idfMeshGainSolid(vol);
    if(!solid || !solid.verts || solid.verts.length<4 || !solid.tris || !solid.tris.length) return;
    const nameJa='発熱';
    seq[nameJa]=(seq[nameJa]||0)+1;
    const shortName=nameJa+String(seq[nameJa]).padStart(2,'0');
    const named=idfMeshNameZ(shortName);
    objects.push(idfMeshNamedMesh(named.bytes, solid.verts, solid.tris, pal.mat));
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
  const faces = src.faces;
  const seq = {};
  const rows = [];
  const usedMats = {};
  const objects = [];
  faces.forEach(face=>{
    const pal = idfMeshPaletteForFace(face);
    usedMats[pal.mat] = pal;
    seq[face.nameJa] = (seq[face.nameJa]||0) + 1;
    const shortName = face.nameJa + String(seq[face.nameJa]).padStart(2,'0');
    const named = idfMeshNameZ(shortName);
    const verts = idfMeshToMm(face);
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
  if(!objects.length) return null;
  return {bytes: idfMeshPack3ds(usedMats, objects), rows, stamp:src.stamp, kind:src.kind};
}
function buildIdfGainExport(){
  if(typeof appMode==='undefined' || appMode!=='energyplus') return null;
  const usedMats={}, objects=[], rows=[], seq={};
  idfMeshAppendGainVolumes(usedMats, objects, rows, seq);
  if(!objects.length) return null;
  return {bytes: idfMeshPack3ds(usedMats, objects), rows:rows};
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
  let msg = '家パネル '+built.rows.length+' 面の 3DS と名前CSVを書き出しました。';
  if(gain){
    msg += ' 内部発熱は別ファイル *_cfd_gain.3ds（'+gain.rows.length+' 室・薄い赤・0.3mセットバック）。';
  }
  if(fill){
    const zM = (fill.zTop/1000).toFixed(3);
    msg += ' 外形埋メ '+fill.rows.length+' 個の *_cfd_fill.3ds も落ちます（屋根は棟高さ '+zM+' m まで、2F持ち出しはその下、基礎下は1F床まで）。FDでは家パネル・埋メ・発熱を別々に取り込み、埋メは障害物ソリッドです。';
  }else{
    msg += ' 埋メ立体は作れませんでした。';
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
    if(banner) banner.textContent = 'Architrend のテクスチャ無し 3DS があれば、方位色分けした CFD モデル種をここから出せます。内壁は元データに無く、庇は除きます。厚みは付けません。';
    if(guide) guide.textContent = 'Architrend の外皮 3DS から、厚みなしの色分け 3DS を作ります。内壁は元ファイルに無いので出しません。庇は外形の外として落とし、2Fの持ち出し床は残します。屋根の上は棟まで、持ち出しの下は1F床高さまで、基礎下は1F床まで埋めます。FlowDesigner に取り込んだあと、次の SSL 一括反映で境界条件を流し込みます。';
  }else if(typeof appMode!=='undefined' && appMode==='energyplus'){
    if(banner) banner.textContent = 'IDF があれば、色分け済みの CFD モデル種をここから出せます。内部発熱は *_cfd_gain.3ds に分けて出します。厚みは付けません。';
    if(guide) guide.textContent = 'EnergyPlus の IDF 頂点から、厚みなしの色分け 3DS を作ります。居室に加えて床下（基礎外周）と小屋裏（屋根・妻壁）も出します。内部発熱の発生エリア（薄い赤）は *_cfd_gain.3ds として別ファイルです。SSL で部屋ごとの発熱・発湿を自動割当します。居室に接する面は居室側だけ残し、二重にはしません。FlowDesigner に取り込んだあと、次の SSL 一括反映で境界条件を流し込みます。';
  }else{
    if(banner) banner.textContent = 'EnergyPlus の IDF、または Architrend の 3DS を読むと、色分け済みの CFD モデル種を出せます。厚みは付けません。';
    if(guide) guide.textContent = 'EnergyPlus モードでは IDF 頂点から、Architrend モードではテクスチャ無し 3DS から、厚みなしの色分け 3DS を作ります。FlowDesigner に取り込んだあと、次の SSL 一括反映で境界条件を流し込みます。';
  }
  if(!sum) return;
  if(typeof appMode==='undefined' || (appMode!=='energyplus' && appMode!=='architrend')){
    sum.innerHTML = '<p class="small" style="margin:0;">EnergyPlusモードで IDF、またはArchitrendモードで 3DS を読むと、色分けした 3DS を書き出せます。手動モードでは使いません。</p>';
    if(info) info.textContent = '';
    return;
  }
  if(!ready){
    if(appMode==='architrend'){
      sum.innerHTML = '<p class="small" style="margin:0;">まだ 3DS が読み込まれていません。ページ上部のアーキトレンド欄で、テクスチャ無し 3DS を指定してください。メッシュはブラウザに保存しないので、開き直したら選び直します。</p>';
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
    html += '<p class="small" style="margin:8px 0 0;">座標系: '+rel+' / 単位: mm / 厚みなし / 窓は壁と同一平面に重ねる</p>';
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
    html += '<p class="small" style="margin:8px 0 0;">単位: mm / 厚みなし / 内壁なし / 両面は外向きのみ / 庇 '+((st && st.droppedEave)||0)+' 面を除外。メッシュはブラウザに保存しません。</p>';
  }
  const fill = buildIdfFillExport();
  if(fill){
    const zM = (fill.zTop/1000).toFixed(3);
    html += '<p class="small" style="margin:8px 0 0;">埋メ: 屋根は同じ勾配ごとに棟高さ '+zM+' m まで、2F持ち出し床はその下を1F床高さまで、基礎下は1F床まで、三角柱 '+fill.rows.length+' 個で埋めます。色 #3d3d3d / SSL は外形埋メ（障害物）。</p>';
  }
  sum.innerHTML = html;
}

(function initIdfMeshUi(){
  const btn = document.getElementById('idfMeshExportBtn');
  if(btn) btn.addEventListener('click', exportIdfMesh);
  refreshIdfMeshUi();
})();

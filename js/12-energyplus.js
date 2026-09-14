// EnergyPlus 連携 (IDF必須 / SQL任意)
// 居室の壁貫流・UA/外皮・部屋/窓/最大在室人数は IDF。SQL は冷房ピーク時刻のみ。
var epParse = null;
var epIdfName = '';
var epSqlName = '';
var epSqlPeak = null;
var epSqlWx = null;
var epwName = '';
var epwData = null;
var _epSqlJsPromise = null;
const EP_HI = 9;
const EP_BLANK_IDS = [
  'tmax','tmin','tpeak','targetT',
  'uWall','uRoof','uaVal','envArea','roomVol','hxRate','acMax'
];
const EP_BC_OUTDOOR = new Set(['outdoors']);
const EP_BC_SKIP_U = new Set(['foundation']);
const EP_BC_LIST = new Set([
  'outdoors','surface','zone','ground','foundation','adiabatic',
  'othersidecoefficients','othersideconditionsmodel',
  'groundfcfactormethod','groundslabpreprocessoraverage',
  'groundslabpreprocessorcore','groundslabpreprocessorperimeter',
  'groundbasementpreprocessoraveragewall','groundbasementpreprocessoraveragefloor',
  'groundbasementpreprocessorupperwall','groundbasementpreprocessorlowerwall'
]);

function isEpBufferZone(name){
  return /foundation|attic|床下|小屋裏|天井裏|under\s*floor|crawl|plenum|garret/i.test(String(name||''));
}
function epIsFoundZone(name){
  return /foundation|床下|under\s*floor|crawl/i.test(String(name||''));
}
function epIsAtticZone(name){
  return /attic|小屋裏|天井裏|garret/i.test(String(name||''));
}

function stripIdfComment(line){
  const i = String(line).indexOf('!');
  return (i<0 ? line : line.slice(0,i));
}

function parseIdfObjects(text){
  const objects = [];
  let fields = [];
  const lines = String(text||'').split(/\r?\n/);
  for(let li=0; li<lines.length; li++){
    let s = stripIdfComment(lines[li]).trim();
    if(!s) continue;
    const ended = /;$/.test(s);
    if(ended) s = s.replace(/;$/, '');
    const contComma = /,$/.test(s);
    const parts = s.split(',');
    if(contComma && parts.length && parts[parts.length-1]==='') parts.pop();
    for(let i=0;i<parts.length;i++) fields.push(parts[i].trim());
    if(ended){
      if(fields.length && fields[0]) objects.push(fields);
      fields = [];
    }
  }
  return objects;
}

function classOf(fields){
  return String(fields[0]||'').replace(/\s+/g,'').toUpperCase();
}
function idfNameKey(name){
  return String(name||'').replace(/\s+/g,' ').trim().toLowerCase();
}
function idfGet(map, name){
  if(!name || !map) return undefined;
  if(Object.prototype.hasOwnProperty.call(map, name)) return map[name];
  const key = idfNameKey(name);
  const hit = Object.keys(map).find(k=>idfNameKey(k)===key);
  return hit!=null ? map[hit] : undefined;
}

function numField(v){
  const n = parseFloat(String(v==null?'':v).replace(/,/g,''));
  return Number.isFinite(n) ? n : null;
}

function readVerts(fields, start, n){
  const nums = [];
  for(let i=start; i<fields.length; i++){
    if(fields[i]==='' || fields[i]==null) continue;
    const n0 = numField(fields[i]);
    if(n0===null) continue;
    nums.push(n0);
  }
  const verts = [];
  for(let i=0; i<n; i++){
    const x=nums[i*3], y=nums[i*3+1], z=nums[i*3+2];
    if(x==null || y==null || z==null) return [];
    verts.push({x,y,z});
  }
  return verts;
}

function newell(verts){
  let nx=0, ny=0, nz=0;
  const n = verts.length;
  if(n<3) return {nx:0,ny:0,nz:0,mag:0,area:0};
  for(let i=0;i<n;i++){
    const a=verts[i], b=verts[(i+1)%n];
    nx += (a.y-b.y)*(a.z+b.z);
    ny += (a.z-b.z)*(a.x+b.x);
    nz += (a.x-b.x)*(a.y+b.y);
  }
  const mag = Math.sqrt(nx*nx+ny*ny+nz*nz);
  return {nx, ny, nz, mag, area: mag/2};
}

function wrap180(deg){
  let a = deg;
  while(a>180) a -= 360;
  while(a<=-180) a += 360;
  return a;
}

function azFromNorth(normal, northAxis){
  const h = Math.hypot(normal.nx, normal.ny);
  if(h<1e-9) return 0;
  let az = Math.atan2(normal.nx, normal.ny)*180/Math.PI;
  if(az<0) az += 360;
  az = (az + (northAxis||0) + 360) % 360;
  return az;
}

function tiltDeg(normal){
  if(normal.mag<1e-12) return 90;
  const c = Math.max(-1, Math.min(1, normal.nz/normal.mag));
  return Math.acos(c)*180/Math.PI;
}

function toolAzFromNorth(azFromN){
  return wrap180(azFromN - 180);
}

function nearestOrientation(toolAz){
  const list = (typeof orientations!=='undefined') ? orientations : [];
  let best = list[0] ? list[0].name : '南';
  let bestD = 1e9;
  list.forEach(o=>{
    const d = Math.abs(wrap180(toolAz - o.az));
    if(d<bestD){ bestD=d; best=o.name; }
  });
  return best;
}

function epCoordIsRelative(coordSys){
  return /relative/i.test(String(coordSys||''));
}

function epRotateClockwiseXY(x, y, deg){
  const r = (deg||0)*Math.PI/180;
  const c = Math.cos(r), s = Math.sin(r);
  return {x: x*c + y*s, y: -x*s + y*c};
}

function epVertsToWorld(verts, zone, northAxis, relative){
  if(!verts || !verts.length) return [];
  if(!relative) return verts.map(v=>({x:v.x, y:v.y, z:v.z}));
  const z = zone || {relNorth:0, ox:0, oy:0, oz:0};
  const rot = (z.relNorth||0) + (northAxis||0);
  return verts.map(v=>{
    const p = epRotateClockwiseXY(v.x, v.y, rot);
    return {x:p.x+(z.ox||0), y:p.y+(z.oy||0), z:v.z+(z.oz||0)};
  });
}

function classifyIdfMeshSurface(s, orient, zone){
  const type = String(s.type||'').toLowerCase();
  const bc = String(s.bc||'').toLowerCase();
  const outdoor = bc==='outdoors';
  const ground = bc==='ground' || bc==='foundation' || bc.indexOf('ground')===0;
  const zname = (zone && zone.name) || s.zone || '';
  if(epIsFoundZone(zname)){
    if(type==='wall' || type==='floor') return {sslKey:'found', nameJa:'基礎'};
    return {sslKey:'innerwall', nameJa:'内床'};
  }
  if(epIsAtticZone(zname)){
    if(type==='roof' || (type==='ceiling' && outdoor)) return {sslKey:'roof', nameJa:'屋根'};
    if(type==='wall' && outdoor) return {sslKey:'wall_'+orient, nameJa:'外壁'+orient};
    if(type==='wall') return {sslKey:'attic', nameJa:'小屋裏'};
    if(type==='floor') return {sslKey:'innerwall', nameJa:'天井'};
    if(type==='ceiling') return {sslKey:'roof', nameJa:'屋根'};
    return {sslKey:'attic', nameJa:'小屋裏'};
  }
  if(type==='wall' && outdoor) return {sslKey:'wall_'+orient, nameJa:'外壁'+orient};
  if((type==='roof' || type==='ceiling') && outdoor) return {sslKey:'roof', nameJa:'屋根'};
  if(type==='floor' && (ground || outdoor)) return {sslKey:'floor1', nameJa:'1F床'};
  if(type==='wall' && ground) return {sslKey:'found', nameJa:'基礎'};
  if(type==='ceiling') return {sslKey:'innerwall', nameJa:'天井'};
  if(type==='floor') return {sslKey:'innerwall', nameJa:'内床'};
  return {sslKey:'innerwall', nameJa:'内壁'};
}

function meshSkipBufferFaceAdjoiningHab(s, zone, surfByName, habNames, habNameKeys){
  if(!zone || !zone.buffer) return false;
  if(String(s.bc||'').toLowerCase()!=='surface') return false;
  const other = idfGet(surfByName, s.bcObj);
  const oz = other && other.zone;
  if(!oz) return false;
  return habNames.has(oz) || habNameKeys.has(idfNameKey(oz));
}

function epGainSetbackM(){
  return (typeof GAIN_VOLUME_SETBACK_M==='number' && GAIN_VOLUME_SETBACK_M>0) ? GAIN_VOLUME_SETBACK_M : 0.3;
}
function epDot3(a,b){ return a.x*b.x+a.y*b.y+a.z*b.z; }
function epCross3(a,b){ return {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x}; }
function epPlaneOfVerts(verts){
  const g = newell(verts);
  if(!(g.mag>1e-12)) return null;
  const n = {x:g.nx/g.mag, y:g.ny/g.mag, z:g.nz/g.mag};
  return {n:n, d:n.x*verts[0].x + n.y*verts[0].y + n.z*verts[0].z};
}
function epPlaneKey(p){
  return [Math.round(p.n.x*200), Math.round(p.n.y*200), Math.round(p.n.z*200), Math.round(p.d*200)].join(',');
}
function epDet3(a,b,c,d,e,f,g,h,i){
  return a*(e*i-f*h) - b*(d*i-f*g) + c*(d*h-e*g);
}
function epSolveThreePlanes(p1,p2,p3, setback){
  const a=p1.n, b=p2.n, c=p3.n;
  const det = epDet3(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z);
  if(!(Math.abs(det)>1e-8)) return null;
  const r1=p1.d-setback, r2=p2.d-setback, r3=p3.d-setback;
  return {
    x: epDet3(r1,a.y,a.z, r2,b.y,b.z, r3,c.y,c.z)/det,
    y: epDet3(a.x,r1,a.z, b.x,r2,b.z, c.x,r3,c.z)/det,
    z: epDet3(a.x,a.y,r1, b.x,b.y,r2, c.x,c.y,r3)/det
  };
}
function epPickThreePlanes(planes){
  let best=null, bestAbs=0;
  for(let i=0;i<planes.length;i++){
    for(let j=i+1;j<planes.length;j++){
      for(let k=j+1;k<planes.length;k++){
        const cr = epCross3(planes[j].n, planes[k].n);
        const det = epDot3(planes[i].n, cr);
        const a = Math.abs(det);
        if(a>bestAbs){ bestAbs=a; best=[planes[i], planes[j], planes[k]]; }
      }
    }
  }
  return (best && bestAbs>1e-6) ? best : null;
}
function epInsetVertex(planes, setback, orig){
  const picked = epPickThreePlanes(planes);
  if(picked){
    const p = epSolveThreePlanes(picked[0], picked[1], picked[2], setback);
    if(p && isFinite(p.x+p.y+p.z)) return p;
  }
  let sx=0, sy=0, sz=0;
  planes.forEach(function(pl){ sx+=pl.n.x; sy+=pl.n.y; sz+=pl.n.z; });
  const L=Math.sqrt(sx*sx+sy*sy+sz*sz);
  if(!(L>1e-9) || !orig) return null;
  return {x:orig.x - (sx/L)*setback, y:orig.y - (sy/L)*setback, z:orig.z - (sz/L)*setback};
}
function epSignedVolume(faces){
  let acc=0;
  faces.forEach(function(f){
    const vs=f.verts||[];
    for(let i=1;i<vs.length-1;i++){
      const a=vs[0], b=vs[i], c=vs[i+1];
      acc += a.x*(b.y*c.z-b.z*c.y) + a.y*(b.z*c.x-b.x*c.z) + a.z*(b.x*c.y-b.y*c.x);
    }
  });
  return acc/6;
}
function epAabbInsetFaces(faces, setback){
  let minx=Infinity, miny=Infinity, minz=Infinity, maxx=-Infinity, maxy=-Infinity, maxz=-Infinity;
  faces.forEach(function(f){
    (f.verts||[]).forEach(function(v){
      minx=Math.min(minx,v.x); miny=Math.min(miny,v.y); minz=Math.min(minz,v.z);
      maxx=Math.max(maxx,v.x); maxy=Math.max(maxy,v.y); maxz=Math.max(maxz,v.z);
    });
  });
  const dx=maxx-minx-2*setback, dy=maxy-miny-2*setback, dz=maxz-minz-2*setback;
  if(!(dx>0.05) || !(dy>0.05) || !(dz>0.05)) return null;
  minx+=setback; miny+=setback; minz+=setback;
  maxx-=setback; maxy-=setback; maxz-=setback;
  const box=[
    [{x:minx,y:miny,z:minz},{x:maxx,y:miny,z:minz},{x:maxx,y:maxy,z:minz},{x:minx,y:maxy,z:minz}],
    [{x:minx,y:miny,z:maxz},{x:minx,y:maxy,z:maxz},{x:maxx,y:maxy,z:maxz},{x:maxx,y:miny,z:maxz}],
    [{x:minx,y:miny,z:minz},{x:minx,y:miny,z:maxz},{x:maxx,y:miny,z:maxz},{x:maxx,y:miny,z:minz}],
    [{x:minx,y:maxy,z:minz},{x:maxx,y:maxy,z:minz},{x:maxx,y:maxy,z:maxz},{x:minx,y:maxy,z:maxz}],
    [{x:minx,y:miny,z:minz},{x:minx,y:maxy,z:minz},{x:minx,y:maxy,z:maxz},{x:minx,y:miny,z:maxz}],
    [{x:maxx,y:miny,z:minz},{x:maxx,y:miny,z:maxz},{x:maxx,y:maxy,z:maxz},{x:maxx,y:maxy,z:minz}]
  ];
  return box.map(function(verts){ return {verts:verts}; });
}
function epInsetPolyhedron(faces, setback){
  if(!faces || faces.length<4 || !(setback>0)) return null;
  const work=faces.map(function(f){
    return {verts:(f.verts||[]).map(function(v){ return {x:v.x,y:v.y,z:v.z}; })};
  });
  if(epSignedVolume(work)<0){
    work.forEach(function(f){ f.verts.reverse(); });
  }
  const vmap={};
  work.forEach(function(f){
    const plane=epPlaneOfVerts(f.verts);
    if(!plane) return;
    f._plane=plane;
    (f.verts||[]).forEach(function(v){
      const k=[Math.round(v.x*1000), Math.round(v.y*1000), Math.round(v.z*1000)].join(',');
      if(!vmap[k]) vmap[k]={orig:v, planes:{}};
      vmap[k].planes[epPlaneKey(plane)]=plane;
    });
  });
  const moved={};
  Object.keys(vmap).forEach(function(k){
    const rec=vmap[k];
    const planes=Object.keys(rec.planes).map(function(pk){ return rec.planes[pk]; });
    const p=epInsetVertex(planes, setback, rec.orig);
    if(p) moved[k]=p;
  });
  const inset=[];
  work.forEach(function(f){
    const verts=[];
    (f.verts||[]).forEach(function(v){
      const k=[Math.round(v.x*1000), Math.round(v.y*1000), Math.round(v.z*1000)].join(',');
      if(moved[k]) verts.push(moved[k]);
    });
    if(verts.length>=3) inset.push({verts:verts});
  });
  if(inset.length<4) return null;
  const v0=epSignedVolume(work), v1=epSignedVolume(inset);
  if(!(Math.abs(v1)>0.02)) return null;
  if(Math.abs(v0)>0.02 && Math.abs(v1)>Math.abs(v0)*0.98) return null;
  return inset;
}
function epFaceNz(verts){
  const g=newell(verts||[]);
  if(!(g.mag>1e-12)) return 0;
  return g.nz/g.mag;
}
function epPointInPoly2(x, y, verts){
  let inside=false;
  const n=(verts||[]).length;
  for(let i=0,j=n-1;i<n;j=i++){
    const xi=verts[i].x, yi=verts[i].y, xj=verts[j].x, yj=verts[j].y;
    const denom=yj-yi;
    if(((yi>y)!==(yj>y)) && (x<(xj-xi)*(y-yi)/(denom||1e-20)+xi)) inside=!inside;
  }
  return inside;
}
function epPlaneZAt(plane, x, y){
  if(!plane || Math.abs(plane.n.z)<1e-6) return null;
  return (plane.d-plane.n.x*x-plane.n.y*y)/plane.n.z;
}
function epPrismFacesFromRings(bot, top){
  const n=(bot||[]).length;
  if(n<3 || !top || top.length!==n) return [];
  const faces=[{verts:bot.slice().reverse()},{verts:top.slice()}];
  for(let i=0;i<n;i++){
    const j=(i+1)%n;
    faces.push({verts:[bot[i], bot[j], top[j], top[i]]});
  }
  return faces;
}
function epGainCapPrep(verts){
  let plane=epPlaneOfVerts(verts);
  if(!plane) return null;
  if(plane.n.z<0){
    plane={n:{x:-plane.n.x,y:-plane.n.y,z:-plane.n.z}, d:-plane.d};
  }
  if(plane.n.z<0.25) return null;
  let minx=Infinity, miny=Infinity, maxx=-Infinity, maxy=-Infinity;
  const xy=verts.map(function(v){
    minx=Math.min(minx,v.x); miny=Math.min(miny,v.y);
    maxx=Math.max(maxx,v.x); maxy=Math.max(maxy,v.y);
    return {x:v.x, y:v.y};
  });
  return {xy:xy, plane:plane, minx:minx, miny:miny, maxx:maxx, maxy:maxy};
}
function epUniqCoords(vals, tol){
  const a=(vals||[]).filter(function(v){ return isFinite(v); }).sort(function(p,q){ return p-q; });
  const out=[];
  a.forEach(function(v){
    if(!out.length || Math.abs(out[out.length-1]-v)>tol) out.push(v);
    else out[out.length-1]=(out[out.length-1]+v)/2;
  });
  return out;
}
function epGainCapKey(c){
  const p=c.plane;
  return [Math.round(p.n.x*80), Math.round(p.n.y*80), Math.round(p.n.z*80), Math.round(p.d*25)].join(',');
}
function epPointInFloorUnion(x, y, floors){
  for(let i=0;i<floors.length;i++){
    if(epPointInPoly2(x, y, floors[i])) return true;
  }
  return false;
}
function epOccCoversRect(ux, uy, occ, nx, ny, x0, x1, y0, y1){
  if(x0<ux[0]-1e-7 || x1>ux[nx]+1e-7 || y0<uy[0]-1e-7 || y1>uy[ny]+1e-7) return false;
  for(let iy=0; iy<ny; iy++){
    if(uy[iy+1]<=y0+1e-9 || uy[iy]>=y1-1e-9) continue;
    for(let ix=0; ix<nx; ix++){
      if(ux[ix+1]<=x0+1e-9 || ux[ix]>=x1-1e-9) continue;
      if(!occ[ix+iy*nx]) return false;
    }
  }
  return true;
}
function epSegKey(a, b){
  return [Math.round(a.x*1000), Math.round(a.y*1000), Math.round(b.x*1000), Math.round(b.y*1000)].join(',');
}
function epPtKey(p){
  return Math.round(p.x*1000)+','+Math.round(p.y*1000);
}
function epCancelOppSegs(segs){
  const m={};
  (segs||[]).forEach(function(s){
    const k=epSegKey(s[0], s[1]), kr=epSegKey(s[1], s[0]);
    if(m[kr]){ delete m[kr]; return; }
    m[k]=s;
  });
  return Object.keys(m).map(function(k){ return m[k]; });
}
function epChainRings(segs){
  const byStart={};
  segs.forEach(function(s, i){
    const k=epPtKey(s[0]);
    if(!byStart[k]) byStart[k]=[];
    byStart[k].push(i);
  });
  const used=new Uint8Array(segs.length);
  const rings=[];
  function cross(a,b,c){ return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x); }
  for(let si=0; si<segs.length; si++){
    if(used[si]) continue;
    const ring=[];
    let cur=si, guard=0;
    while(cur!=null && !used[cur] && guard++<segs.length+2){
      used[cur]=1;
      const s=segs[cur];
      ring.push({x:s[0].x, y:s[0].y});
      const end=s[1], ek=epPtKey(end);
      const opts=(byStart[ek]||[]).filter(function(i){ return !used[i]; });
      if(!opts.length){
        if(epPtKey(end)===epPtKey(segs[si][0])) break;
        cur=null;
        break;
      }
      let pick=opts[0];
      if(opts.length>1 && ring.length){
        const prev=ring[ring.length-1];
        let best=-Infinity;
        opts.forEach(function(i){
          const cr=cross(prev, end, segs[i][1]);
          if(cr>best){ best=cr; pick=i; }
        });
      }
      cur=pick;
    }
    if(ring.length>=3) rings.push(ring);
  }
  return rings;
}
function epSimplifyRing(ring){
  if(!ring || ring.length<3) return ring||[];
  const pts=ring.slice();
  const out=[];
  for(let i=0;i<pts.length;i++){
    const a=out.length ? out[out.length-1] : null;
    const b=pts[i];
    if(a && Math.abs(a.x-b.x)<1e-6 && Math.abs(a.y-b.y)<1e-6) continue;
    out.push({x:b.x, y:b.y});
  }
  if(out.length>=2 && epPtKey(out[0])===epPtKey(out[out.length-1])) out.pop();
  let changed=true;
  while(changed && out.length>3){
    changed=false;
    for(let i=0;i<out.length;i++){
      const a=out[(i-1+out.length)%out.length], b=out[i], c=out[(i+1)%out.length];
      const col=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
      const on=Math.abs(a.x-c.x)<1e-6 || Math.abs(a.y-c.y)<1e-6;
      if(on && col<1e-6){
        out.splice(i,1);
        changed=true;
        break;
      }
    }
  }
  return out;
}
function epRingArea(ring){
  let a=0;
  for(let i=0;i<ring.length;i++){
    const p=ring[i], q=ring[(i+1)%ring.length];
    a+=p.x*q.y-q.x*p.y;
  }
  return a/2;
}
function epGridOutlines(ux, uy, nx, ny, keep){
  const segs=[];
  for(let iy=0; iy<ny; iy++){
    for(let ix=0; ix<nx; ix++){
      if(!keep(ix, iy)) continue;
      const x0=ux[ix], x1=ux[ix+1], y0=uy[iy], y1=uy[iy+1];
      const L=ix>0 && keep(ix-1, iy), R=ix+1<nx && keep(ix+1, iy);
      const B=iy>0 && keep(ix, iy-1), T=iy+1<ny && keep(ix, iy+1);
      if(!L) segs.push([{x:x0,y:y0},{x:x0,y:y1}]);
      if(!R) segs.push([{x:x1,y:y1},{x:x1,y:y0}]);
      if(!B) segs.push([{x:x1,y:y0},{x:x0,y:y0}]);
      if(!T) segs.push([{x:x0,y:y1},{x:x1,y:y1}]);
    }
  }
  const rings=epChainRings(epCancelOppSegs(segs)).map(epSimplifyRing).filter(function(r){ return r.length>=3; });
  rings.forEach(function(r){
    if(epRingArea(r)<0) r.reverse();
  });
  return rings.filter(function(r){ return Math.abs(epRingArea(r))>0.15; });
}
function epGainPrismsForZone(zoneFaces, setback){
  const floors=[], caps=[];
  let wallZmax=-Infinity;
  (zoneFaces||[]).forEach(function(f){
    const vs=f.verts||[];
    if(vs.length<3) return;
    const nz=epFaceNz(vs);
    if(nz<-0.55) floors.push(vs);
    else if(nz>0.35){
      const cap=epGainCapPrep(vs);
      if(cap) caps.push(cap);
    }else{
      vs.forEach(function(v){ if(v.z>wallZmax) wallZmax=v.z; });
    }
  });
  if(!floors.length) return [];
  let minx=Infinity, miny=Infinity, maxx=-Infinity, maxy=-Infinity;
  const xs=[], ys=[];
  function pushX(v){ if(v>=minx-1e-6 && v<=maxx+1e-6) xs.push(v); }
  function pushY(v){ if(v>=miny-1e-6 && v<=maxy+1e-6) ys.push(v); }
  floors.forEach(function(vs){
    vs.forEach(function(v){
      minx=Math.min(minx,v.x); miny=Math.min(miny,v.y);
      maxx=Math.max(maxx,v.x); maxy=Math.max(maxy,v.y);
    });
  });
  floors.forEach(function(vs){
    vs.forEach(function(v){
      xs.push(v.x); ys.push(v.y);
      pushX(v.x+setback); pushX(v.x-setback);
      pushY(v.y+setback); pushY(v.y-setback);
    });
  });
  caps.forEach(function(c){
    pushX(c.minx); pushX(c.maxx); pushY(c.miny); pushY(c.maxy);
    (c.xy||[]).forEach(function(p){ pushX(p.x); pushY(p.y); });
  });
  const ux=epUniqCoords(xs, 0.004);
  const uy=epUniqCoords(ys, 0.004);
  const nx=ux.length-1, ny=uy.length-1;
  if(nx<1 || ny<1) return [];
  const occ=new Uint8Array(nx*ny);
  const zFloor=new Float64Array(nx*ny);
  zFloor.fill(NaN);
  function idx(ix,iy){ return ix+iy*nx; }
  for(let iy=0; iy<ny; iy++){
    for(let ix=0; ix<nx; ix++){
      const x0=ux[ix], x1=ux[ix+1], y0=uy[iy], y1=uy[iy+1];
      if(x1-x0<0.02 || y1-y0<0.02) continue;
      const cx=(x0+x1)/2, cy=(y0+y1)/2;
      if(!epPointInFloorUnion(cx, cy, floors)) continue;
      const i=idx(ix,iy);
      occ[i]=1;
      floors.forEach(function(vs){
        if(!epPointInPoly2(cx, cy, vs)) return;
        let z=0;
        vs.forEach(function(v){ z+=v.z; });
        z/=vs.length;
        if(!(zFloor[i]<1e12) || z<zFloor[i]) zFloor[i]=z;
      });
    }
  }
  const inner=new Uint8Array(nx*ny);
  for(let iy=0; iy<ny; iy++){
    for(let ix=0; ix<nx; ix++){
      if(!occ[idx(ix,iy)]) continue;
      const x0=ux[ix], x1=ux[ix+1], y0=uy[iy], y1=uy[iy+1];
      if(epOccCoversRect(ux, uy, occ, nx, ny, x0-setback, x1+setback, y0-setback, y1+setback)){
        inner[idx(ix,iy)]=1;
      }
    }
  }
  const groups=[];
  const groupOf={};
  caps.forEach(function(c){
    const k=epGainCapKey(c);
    if(groupOf[k]==null){
      groupOf[k]=groups.length;
      groups.push({plane:c.plane, drop:setback/Math.max(c.plane.n.z, 0.25)});
    }
  });
  const zBotA=new Float64Array(nx*ny);
  const zTopA=new Float64Array(nx*ny);
  const capOf=new Int16Array(nx*ny);
  zBotA.fill(NaN); zTopA.fill(NaN); capOf.fill(-1);
  for(let iy=0; iy<ny; iy++){
    for(let ix=0; ix<nx; ix++){
      const i=idx(ix,iy);
      if(!inner[i]) continue;
      const cx=(ux[ix]+ux[ix+1])/2, cy=(uy[iy]+uy[iy+1])/2;
      const zb=zFloor[i]+setback;
      let zTop=Infinity, gWin=-1;
      for(let ci=0; ci<caps.length; ci++){
        const c=caps[ci];
        if(cx<c.minx-1e-4||cx>c.maxx+1e-4||cy<c.miny-1e-4||cy>c.maxy+1e-4) continue;
        if(!epPointInPoly2(cx, cy, c.xy)) continue;
        const z=epPlaneZAt(c.plane, cx, cy);
        if(z==null) continue;
        const zt=z-setback/Math.max(c.plane.n.z, 0.25);
        if(zt<zTop){
          zTop=zt;
          gWin=groupOf[epGainCapKey(c)];
        }
      }
      if(!(zTop<1e12) && wallZmax>-1e12){
        zTop=wallZmax-setback;
        gWin=30000;
      }
      if(!(zTop>zb+0.05) || gWin<0){
        inner[i]=0;
        continue;
      }
      zBotA[i]=zb;
      zTopA[i]=zTop;
      capOf[i]=gWin;
    }
  }
  const usedGids={};
  const prisms=[];
  for(let iy=0; iy<ny; iy++){
    for(let ix=0; ix<nx; ix++){
      const i0=idx(ix,iy);
      if(!inner[i0]) continue;
      const gid=capOf[i0], zb=zBotA[i0], zT=zTopA[i0];
      const key=gid+':'+Math.round(zb*100);
      if(usedGids[key]) continue;
      usedGids[key]=1;
      const rings=epGridOutlines(ux, uy, nx, ny, function(cx, cy){
        const i=idx(cx, cy);
        return !!(inner[i] && capOf[i]===gid && Math.abs(zBotA[i]-zb)<0.03);
      });
      const g=(gid>=0 && gid<groups.length) ? groups[gid] : null;
      rings.forEach(function(ring){
        const bot=ring.map(function(p){ return {x:p.x, y:p.y, z:zb}; });
        const top=ring.map(function(p){
          let z=zT;
          if(g){
            const pz=epPlaneZAt(g.plane, p.x, p.y);
            if(pz!=null) z=pz-g.drop;
          }
          return {x:p.x, y:p.y, z:z};
        });
        if(Math.min.apply(null, top.map(function(v){ return v.z; }))<=zb+0.05) return;
        prisms.push({bot:bot, top:top});
      });
    }
  }
  return prisms;
}
function buildEpGainVolumes(parse){
  const setback=epGainSetbackM();
  const vols=[];
  const warns=parse.warnings||[];
  (parse.habitable||[]).forEach(function(z, zi){
    const faces=(parse.meshFaces||[]).filter(function(f){
      return f && f.kind==='opaque' && f.verts && f.verts.length>=3 &&
        (f.zone===z.name || (typeof idfNameKey==='function' && idfNameKey(f.zone)===idfNameKey(z.name)));
    }).map(function(f){ return {verts:f.verts.map(function(v){ return {x:v.x,y:v.y,z:v.z}; })}; });
    if(faces.length<4){
      warns.push('居室 '+z.name+' の発生ボリュームを作れません (外皮面が足りません)');
      return;
    }
    let usedSetback=setback;
    let prisms=epGainPrismsForZone(faces, usedSetback);
    if(!prisms.length && setback>0.12){
      usedSetback=0.1;
      prisms=epGainPrismsForZone(faces, usedSetback);
    }
    if(!prisms.length){
      warns.push('居室 '+z.name+' はセットバックできる床がありません');
      return;
    }
    const facesOut=[];
    prisms.forEach(function(p){
      epPrismFacesFromRings(p.bot, p.top).forEach(function(face){ facesOut.push(face); });
    });
    const col=(typeof gainVolumeColor==='function') ? gainVolumeColor(zi) : {r:255,g:176,b:168, mat:'GAIN'+zi};
    vols.push({
      zone:z.name, color:col, faces:facesOut, prisms:prisms,
      setback:usedSetback, how:'footprint'
    });
  });
  parse.gainVolumes=vols;
  return vols;
}

function parseBuildingSurface(fields){
  const name = fields[1];
  const type = fields[2];
  const construction = fields[3];
  const zone = fields[4];
  let i = 5;
  if(!EP_BC_LIST.has(String(fields[5]||'').toLowerCase())) i = 6;
  const bc = String(fields[i]||'');
  const bcObj = fields[i+1]||'';
  const n = parseInt(fields[i+5], 10);
  const verts = Number.isFinite(n) ? readVerts(fields, i+6, n) : [];
  return {name, type, construction, zone, bc, bcObj, n, verts};
}

function parseFenestration(fields){
  const name = fields[1];
  const type = fields[2];
  const construction = fields[3];
  const parent = fields[4];
  const multiplier = numField(fields[8]) || 1;
  const n = parseInt(fields[9], 10);
  const verts = Number.isFinite(n) ? readVerts(fields, 10, n) : [];
  return {name, type, construction, parent, multiplier, n, verts};
}

function layerResistance(layerName, materials, nomass){
  const rNo = idfGet(nomass, layerName);
  if(rNo!=null) return rNo;
  const m = idfGet(materials, layerName);
  if(!m) return null;
  if(!(m.k>0) || !(m.d>=0)) return null;
  return m.d / m.k;
}

function constructionIsoLayers(layers, materials, nomass){
  const out=[];
  (layers||[]).forEach(function(layerName){
    const rNo=idfGet(nomass, layerName);
    if(rNo!=null){
      out.push({d:rNo, lam:1, rho:0, cp:0});
      return;
    }
    const m=idfGet(materials, layerName);
    if(!m) return;
    out.push({d:m.d||0, lam:m.k||0, rho:m.rho||0, cp:m.cp||0});
  });
  return out;
}

function constructionSolidR(layers, materials, nomass){
  let r = 0;
  for(let i=0;i<layers.length;i++){
    const lr = layerResistance(layers[i], materials, nomass);
    if(lr===null) return null;
    r += lr;
  }
  return r;
}

function opaqueUFromR(rSolid, hi, ho){
  if(!(rSolid>=0) || !(hi>0) || !(ho>0)) return null;
  const r = 1/hi + rSolid + 1/ho;
  return r>0 ? 1/r : null;
}

function epGasConductivity(type){
  const t = String(type||'air').toLowerCase();
  if(t==='argon') return 0.0164;
  if(t==='krypton') return 0.0094;
  if(t==='xenon') return 0.0055;
  return 0.0241;
}

function epGasGapR(thickness, gasType, e1, e2){
  if(!(thickness>0)) return null;
  const hCond = epGasConductivity(gasType) / thickness;
  const hc = Math.max(hCond, 1.5);
  const Tm = 283.15;
  const ef = (e1>0 && e1<=1) ? e1 : 0.84;
  const eb = (e2>0 && e2<=1) ? e2 : 0.84;
  const hr = 4 * 5.670374419e-8 * Tm*Tm*Tm / (1/ef + 1/eb - 1);
  const h = hc + hr;
  return h>0 ? 1/h : null;
}

function estimateWindowShgc(layers, winGlass){
  let t = 1, n = 0;
  (layers||[]).forEach(name=>{
    const g = idfGet(winGlass, name);
    if(g && g.solarT>0){ t *= g.solarT; n++; }
  });
  if(!n) return null;
  return Math.round(Math.max(0.05, Math.min(0.85, t*0.87))*1000)/1000;
}

function windowUFromLayers(layers, winGlass, winGas, hi, ho, winSkip){
  if(!layers || !layers.length) return null;
  const hIn = (hi>0) ? hi : EP_HI;
  const hOut = (ho>0) ? ho : 23;
  let r = 1/hIn + 1/hOut;
  let prevGlass = null;
  let sawGlass = false;
  for(let i=0; i<layers.length; i++){
    const name = layers[i];
    if(idfGet(winSkip, name)) continue;
    const g = idfGet(winGlass, name);
    const gas = idfGet(winGas, name);
    if(g){
      if(!(g.d>0) || !(g.k>0)) return null;
      r += g.d / g.k;
      prevGlass = g;
      sawGlass = true;
    }else if(gas){
      const nextName = layers[i+1];
      const next = nextName ? idfGet(winGlass, nextName) : null;
      const rg = epGasGapR(gas.d, gas.type, prevGlass ? prevGlass.eBack : 0.84, next ? next.eFront : 0.84);
      if(rg==null) return null;
      r += rg;
    }else{
      return null;
    }
  }
  if(!sawGlass || !(r>0)) return null;
  return 1/r;
}

function parseEnergyPlusIdf(text){
  const warnings = [];
  const objects = parseIdfObjects(text);
  const materials = {};
  const nomass = {};
  const glazing = {};
  const winGlass = {};
  const winGas = {};
  const winSkip = {};
  const constructions = {};
  const zones = [];
  const surfaces = [];
  const fenestrations = [];
  const zoneLists = {};
  const peopleObjs = [];
  let northAxis = 0;
  let coordSys = 'WorldCoordinateSystem';

  objects.forEach(fields=>{
    const cls = classOf(fields);
    if(cls==='BUILDING'){
      const n = numField(fields[2]);
      if(n!==null) northAxis = n;
    }else if(cls==='GLOBALGEOMETRYRULES'){
      if(fields[3]) coordSys = fields[3];
    }else if(cls==='MATERIAL'){
      const name = fields[1];
      materials[name] = {
        d:numField(fields[3]), k:numField(fields[4]),
        rho:numField(fields[5]), cp:numField(fields[6]),
        alpha:numField(fields[8])
      };
    }else if(cls==='MATERIAL:NOMASS'){
      nomass[fields[1]] = numField(fields[3]);
    }else if(cls==='WINDOWMATERIAL:SIMPLEGLAZINGSYSTEM'){
      glazing[fields[1]] = {u:numField(fields[2]), shgc:numField(fields[3]), vt:numField(fields[4])};
    }else if(cls==='WINDOWMATERIAL:GLAZING'){
      winGlass[fields[1]] = {
        d: numField(fields[4]),
        solarT: numField(fields[5]),
        eFront: numField(fields[12]),
        eBack: numField(fields[13]),
        k: numField(fields[14]) || 0.9
      };
    }else if(cls==='WINDOWMATERIAL:GAS' || cls==='WINDOWMATERIAL:GASMIXTURE'){
      winGas[fields[1]] = {type: fields[2] || 'Air', d: numField(fields[3])};
    }else if(cls==='WINDOWMATERIAL:SHADE' || cls==='WINDOWMATERIAL:BLIND' || cls==='WINDOWMATERIAL:SCREEN' || cls==='WINDOWMATERIAL:SHADE:EQUIVALENTLAYER'){
      winSkip[fields[1]] = true;
    }else if(cls==='CONSTRUCTION'){
      constructions[fields[1]] = fields.slice(2).filter(Boolean);
    }else if(cls==='ZONE'){
      zones.push({
        name: fields[1],
        relNorth: numField(fields[2])||0,
        ox: numField(fields[3])||0,
        oy: numField(fields[4])||0,
        oz: numField(fields[5])||0,
        volume: numField(fields[9]),
        floorArea: numField(fields[10]),
        buffer: isEpBufferZone(fields[1]),
        peopleMax: 0,
        peopleFromIdf: false
      });
    }else if(cls==='ZONELIST'){
      if(fields[1]) zoneLists[fields[1]] = fields.slice(2).filter(Boolean);
    }else if(cls==='PEOPLE'){
      peopleObjs.push({
        name: fields[1],
        target: fields[2],
        method: fields[4],
        numberOfPeople: numField(fields[5]),
        peoplePerArea: numField(fields[6]),
        areaPerPerson: numField(fields[7])
      });
    }else if(cls==='BUILDINGSURFACE:DETAILED'){
      surfaces.push(parseBuildingSurface(fields));
    }else if(cls==='FENESTRATIONSURFACE:DETAILED'){
      fenestrations.push(parseFenestration(fields));
    }
  });

  if(!zones.length) warnings.push('ZONE が見つかりません');
  if(!surfaces.length) warnings.push('BuildingSurface:Detailed が見つかりません');

  const zoneNorth = {};
  zones.forEach(z=>{ zoneNorth[z.name] = (z.relNorth||0) + northAxis; });

  const consMeta = {};
  Object.keys(constructions).forEach(name=>{
    const layers = constructions[name];
    const sg = (layers||[]).map(l=>idfGet(glazing, l)).find(g=>g && g.u!=null);
    if(sg){
      consMeta[name] = {kind:'window', u:sg.u, shgc:sg.shgc, rSolid:null};
      return;
    }
    const uLayered = windowUFromLayers(layers, winGlass, winGas, EP_HI, 23, winSkip);
    if(uLayered>0){
      consMeta[name] = {kind:'window', u:uLayered, shgc:estimateWindowShgc(layers, winGlass), rSolid:null};
      return;
    }
    const rSolid = constructionSolidR(layers, materials, nomass);
    consMeta[name] = {kind:'opaque', u:null, rSolid, shgc:null, isoLayers:constructionIsoLayers(layers, materials, nomass)};
    if(rSolid===null) warnings.push('構成 '+name+' の層物性が取れず U を計算できません');
  });
  const consLayers = {};
  Object.keys(consMeta).forEach(function(name){
    if(consMeta[name].kind==='opaque') consLayers[name]=consMeta[name].isoLayers||[];
  });

  const surfByName = {};
  surfaces.forEach(s=>{
    if(!s.name) return;
    surfByName[s.name]=s;
    surfByName[idfNameKey(s.name)]=s;
  });

  const winAreaByParent = {};
  const windows = [];
  const openings = [];
  fenestrations.forEach(f=>{
    const geom = newell(f.verts);
    const area = geom.area * (f.multiplier||1);
    winAreaByParent[f.parent] = (winAreaByParent[f.parent]||0) + area;
    const ftype = String(f.type||'').toLowerCase();
    const parent = idfGet(surfByName, f.parent);
    const zone = parent ? parent.zone : null;
    const meta = idfGet(consMeta, f.construction) || {};
    if(!parent) warnings.push('開口 '+f.name+' の親壁 '+f.parent+' が見つかりません');
    if(area>0 && (ftype==='window' || ftype==='door' || ftype==='glassdoor' || ftype==='skylight')){
      openings.push({
        name: f.name, zone, area, type: ftype,
        u: meta.u!=null ? meta.u : null,
        rSolid: meta.rSolid!=null ? meta.rSolid : null,
        kind: meta.kind || (ftype==='window' || ftype==='skylight' || ftype==='glassdoor' ? 'window' : 'opaque'),
        construction: f.construction
      });
    }
    if(ftype!=='window' && ftype!=='skylight' && ftype!=='glassdoor') return;
    const azN = azFromNorth(geom, (zone && zoneNorth[zone]) || northAxis);
    const toolAz = toolAzFromNorth(azN);
    windows.push({
      name: f.name,
      zone,
      parent: f.parent,
      area,
      toolAz,
      orient: nearestOrientation(toolAz),
      shgc: meta.shgc!=null ? meta.shgc : null,
      u: meta.u!=null ? meta.u : null,
      construction: f.construction
    });
  });

  const opaque = [];
  surfaces.forEach(s=>{
    const geom = newell(s.verts);
    if(!(geom.area>0)) return;
    const azN = azFromNorth(geom, zoneNorth[s.zone]||northAxis);
    const toolAz = toolAzFromNorth(azN);
    const orient = nearestOrientation(toolAz);
    const tilt = tiltDeg(geom);
    const type = String(s.type||'');
    const bc = String(s.bc||'').toLowerCase();
    const gross = geom.area;
    const winA = winAreaByParent[s.name]||0;
    const net = Math.max(0, gross - winA);
    const meta = idfGet(consMeta, s.construction) || {kind:'opaque', rSolid:null, u:null};
    opaque.push({
      name: s.name, zone: s.zone, type, bc: s.bc, bcObj: s.bcObj, construction: s.construction,
      gross, winA, net, orient, toolAz, tilt, azFromNorth: azN,
      rSolid: meta.rSolid, kind: meta.kind
    });
  });

  zones.forEach(z=>{
    if(z.floorArea>0) return;
    const fa = opaque.filter(s=>s.zone===z.name && String(s.type||'').toLowerCase()==='floor')
      .reduce((sum,s)=>sum+s.gross, 0);
    if(fa>0) z.floorArea = fa;
  });

  const zoneByNameEarly = {};
  zones.forEach(z=>{ zoneByNameEarly[z.name]=z; });
  peopleObjs.forEach(p=>{
    const names = zoneLists[p.target] || [p.target];
    let matched = false;
    names.forEach(zn=>{
      const z = zoneByNameEarly[zn];
      if(!z) return;
      matched = true;
      const n = epPeopleCount(p, z.floorArea);
      if(n==null){
        warnings.push('People '+p.name+' の人数を計算できません (床面積または原単位を確認)');
        return;
      }
      z.peopleMax += n;
      z.peopleFromIdf = true;
    });
    if(!matched && p.target){
      warnings.push('People '+p.name+' の対象 '+p.target+' が Zone / ZoneList にありません');
    }
  });

  const habitable = zones.filter(z=>!z.buffer);
  const excluded = zones.filter(z=>z.buffer);
  if(!habitable.length) warnings.push('居室ゾーンがありません (床下・小屋裏判定ですべて除外)');

  const habNames = new Set(habitable.map(z=>z.name));
  const habNameKeys = new Set(habitable.map(z=>idfNameKey(z.name)));
  const habWindows = windows.filter(w=>w.zone && (habNames.has(w.zone) || habNameKeys.has(idfNameKey(w.zone))));
  const habOpenings = openings.filter(o=>o.zone && (habNames.has(o.zone) || habNameKeys.has(idfNameKey(o.zone))));

  const zoneByName = {};
  zones.forEach(z=>{ zoneByName[z.name]=z; });
  const relative = epCoordIsRelative(coordSys);
  const meshFaces = [];
  surfaces.forEach(s=>{
    const zone = zoneByName[s.zone] || idfGet(zoneByName, s.zone);
    if(!zone) return;
    const inHab = habNames.has(s.zone) || habNameKeys.has(idfNameKey(s.zone));
    if(!inHab && !zone.buffer) return;
    if(meshSkipBufferFaceAdjoiningHab(s, zone, surfByName, habNames, habNameKeys)) return;
    const world = epVertsToWorld(s.verts, zone, northAxis, relative);
    if(world.length<3) return;
    const geom = newell(world);
    if(!(geom.area>0)) return;
    const azN = azFromNorth(geom, zoneNorth[s.zone]||northAxis);
    const cls = classifyIdfMeshSurface(s, nearestOrientation(toolAzFromNorth(azN)), zone);
    meshFaces.push({
      sslKey: cls.sslKey, nameJa: cls.nameJa, idfName: s.name, zone: s.zone,
      kind: 'opaque', verts: world
    });
  });
  fenestrations.forEach(f=>{
    const ftype = String(f.type||'').toLowerCase();
    const isWin = ftype==='window' || ftype==='skylight';
    const isDoor = ftype==='door' || ftype==='glassdoor';
    if(!isWin && !isDoor) return;
    const parent = idfGet(surfByName, f.parent);
    const zoneName = parent ? parent.zone : null;
    if(!zoneName || !(habNames.has(zoneName) || habNameKeys.has(idfNameKey(zoneName)))) return;
    const world = epVertsToWorld(f.verts, zoneByName[zoneName] || idfGet(zoneByName, zoneName), northAxis, relative);
    if(world.length<3) return;
    const meta = idfGet(consMeta, f.construction) || {};
    meshFaces.push({
      sslKey: isDoor ? 'doorbody' : 'window',
      nameJa: isDoor ? 'ドア' : '窓',
      idfName: f.name, zone: zoneName,
      kind: isDoor ? 'door' : 'window', verts: world,
      u: (meta.u>0) ? meta.u : null
    });
  });

  const parsed = {
    northAxis, coordSys, relative, zones, habitable, excluded, opaque, windows: habWindows,
    openings: habOpenings, meshFaces, warnings, consLayers,
    zoneCount: zones.length, habitableCount: habitable.length,
    fenestrationCount: fenestrations.length, windowCount: habWindows.length,
    meshFaceCount: meshFaces.length
  };
  buildEpGainVolumes(parsed);
  return parsed;
}

function epPeopleMethod(method){
  return String(method==null || method==='' ? 'People' : method).replace(/\s+/g,'').toLowerCase();
}

function epPeopleCount(p, floorArea){
  const method = epPeopleMethod(p && p.method);
  if(method==='people/area' || method==='peopleperarea'){
    if(!(p.peoplePerArea>0) || !(floorArea>0)) return null;
    return p.peoplePerArea * floorArea;
  }
  if(method==='area/person' || method==='areaperson'){
    if(!(p.areaPerPerson>0) || !(floorArea>0)) return null;
    return floorArea / p.areaPerPerson;
  }
  if(p.numberOfPeople==null) return null;
  return p.numberOfPeople;
}

function epOccInputValue(n){
  const r = Math.round(n*100)/100;
  if(!isFinite(r)) return '';
  if(Math.abs(r-Math.round(r))<1e-9) return String(Math.round(r));
  return String(r);
}

function epIsGroundBc(bc){
  const b = String(bc||'').toLowerCase();
  return b==='ground' || b==='foundation' || b.indexOf('ground')===0;
}

function epDefaultU(id, fallback){
  const v = (typeof numOrNull==='function') ? numOrNull(id) : null;
  if(v>0) return v;
  return fallback;
}

function epOpeningU(row, hi, ho){
  if(row.u>0) return row.u;
  if(row.kind==='window') return null;
  return opaqueUFromR(row.rSolid, hi, ho);
}

function epHiHo(){
  const ho = (typeof num==='function') ? (num('ho')||23) : 23;
  return {hi:EP_HI, ho};
}

function epUFor(row, hi, ho){
  if(row.kind==='window' && row.u!=null) return row.u;
  return opaqueUFromR(row.rSolid, hi, ho);
}

function epOpaqueRows(parse, hi, ho){
  if(!parse) return [];
  const hab = new Set((parse.habitable||[]).map(z=>z.name));
  return (parse.opaque||[]).filter(s=>{
    if(!hab.has(s.zone)) return false;
    const bc = String(s.bc||'').toLowerCase();
    if(EP_BC_SKIP_U.has(bc)) return false;
    if(!EP_BC_OUTDOOR.has(bc)) return false;
    const t = String(s.type||'').toLowerCase();
    return t==='wall' || t==='roof' || t==='ceiling' || t==='floor';
  }).map(s=>{
    const u = epUFor(s, hi, ho);
    const part = String(s.type||'').toLowerCase()==='wall' ? '外壁'
      : (String(s.type||'').toLowerCase()==='floor' ? '外気床' : '屋根');
    return Object.assign({}, s, {u, part});
  });
}

function epWeightedU(rows, part){
  let ua=0, a=0;
  rows.forEach(r=>{
    if(r.part!==part || !(r.u>0) || !(r.net>0)) return;
    ua += r.u*r.net; a += r.net;
  });
  return a>0 ? ua/a : null;
}

function epOtherZoneName(s, byName){
  const bc = String(s.bc||'').toLowerCase();
  if(bc==='zone') return s.bcObj || null;
  if(bc==='surface'){
    const other = byName[s.bcObj];
    return other ? other.zone : null;
  }
  return null;
}

function epEnvelopeParts(parse, hi, ho){
  if(!parse) return [];
  const hab = new Set((parse.habitable||[]).map(z=>z.name));
  const floorU = epDefaultU('uFloor1', (typeof TOOL_DEFAULTS!=='undefined' ? TOOL_DEFAULTS.uFloor1 : 0.28));
  const foundU = epDefaultU('uFound', (typeof TOOL_DEFAULTS!=='undefined' ? TOOL_DEFAULTS.uFound : 0.46));
  const winFallback = epWeightedWindowU(parse) || epDefaultU('uWin', null);
  const byName = {};
  (parse.opaque||[]).forEach(s=>{ if(s.name) byName[s.name]=s; });
  const parts = [];
  (parse.opaque||[]).forEach(s=>{
    if(!hab.has(s.zone)) return;
    const bc = String(s.bc||'').toLowerCase();
    const t = String(s.type||'').toLowerCase();
    const outdoor = bc==='outdoors';
    const ground = epIsGroundBc(bc);
    const otherZ = epOtherZoneName(s, byName);
    let kind=null, area=null, u=null;
    if(t==='wall' && outdoor){
      kind='外壁'; area=s.net; u=epUFor(s, hi, ho);
    }else if((t==='roof' || t==='ceiling') && outdoor){
      kind='屋根'; area=s.net; u=epUFor(s, hi, ho);
    }else if(t==='floor' && outdoor){
      kind='外気床'; area=s.net; u=epUFor(s, hi, ho);
    }else if(t==='floor' && (ground || (otherZ && isEpBufferZone(otherZ) && /foundation|床下|under\s*floor|crawl/i.test(otherZ)))){
      kind='1F床'; area=s.gross; u=floorU;
    }else if(t==='wall' && ground){
      kind='基礎'; area=s.gross; u=foundU;
    }else return;
    if(!(area>0)) return;
    parts.push({kind, area, u, name:s.name, zone:s.zone});
  });
  (parse.opaque||[]).forEach(s=>{
    if(hab.has(s.zone) || !isEpBufferZone(s.zone) || !/foundation|床下|under\s*floor|crawl/i.test(s.zone)) return;
    const t = String(s.type||'').toLowerCase();
    const bc = String(s.bc||'').toLowerCase();
    if(t!=='wall') return;
    if(!(bc==='outdoors' || epIsGroundBc(bc))) return;
    if(!(s.gross>0)) return;
    parts.push({kind:'基礎', area:s.gross, u:foundU, name:s.name, zone:s.zone});
  });
  const openings = (parse.openings && parse.openings.length) ? parse.openings : (parse.windows||[]);
  openings.forEach(w=>{
    if(w.zone && !hab.has(w.zone)) return;
    if(!(w.area>0)) return;
    let u = epOpeningU(w, hi, ho);
    if(!(u>0)) u = winFallback;
    const kind = (w.type==='door') ? 'ドア' : '窓';
    parts.push({kind, area:w.area, u, name:w.name, zone:w.zone});
  });
  return parts;
}

function applyEpUaAndEnvelope(){
  if(!epParse) return;
  const {hi, ho} = epHiHo();
  const parts = epEnvelopeParts(epParse, hi, ho);
  let uaSum=0, aSum=0, aAll=0, missingU=0;
  parts.forEach(p=>{
    if(p.area>0) aAll += p.area;
    if(p.u>0 && p.area>0){ uaSum += p.u*p.area; aSum += p.area; }
    else missingU++;
  });
  epParse.envArea = aAll>0 ? aAll : null;
  epParse.uaVal = aSum>0 ? uaSum/aSum : null;
  setEpVal('envArea', epParse.envArea);
  setEpVal('uaVal', epParse.uaVal);
  if(missingU && epParse.warnings && epParse.warnings.every(w=>String(w).indexOf('外皮の一部')<0)){
    epParse.warnings.push('外皮の一部でUが取れないため、UAはUが取れた面積のみの加重平均です');
  }
}

function setEpVal(id, value){
  const el = document.getElementById(id);
  if(!el) return;
  if(value===null || value===undefined || !isFinite(value)){
    el.value = '';
    const wrap = el.closest('div');
    if(wrap) wrap.classList.remove('ep-filled');
    return;
  }
  const n = Math.round(value*1000)/1000;
  el.value = String(n);
  const wrap = el.closest('div');
  if(wrap) wrap.classList.add('ep-filled');
}

function clearEpFilled(){
  document.querySelectorAll('.ep-filled').forEach(el=>el.classList.remove('ep-filled'));
}

function blankForEnergyPlus(){
  EP_BLANK_IDS.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  document.getElementById('roomsWrap').innerHTML = '';
  roomCount = 0; winCounter = 0;
  epParse = null;
  epIdfName = '';
  epSqlName = '';
  epSqlPeak = null;
  epSqlWx = null;
  epwName = '';
  epwData = null;
  clearEpFilled();
  const sqlInput = document.getElementById('epSqlInput');
  if(sqlInput) sqlInput.value = '';
  const idfInput = document.getElementById('epIdfInput');
  if(idfInput) idfInput.value = '';
  const epwInput = document.getElementById('epEpwInput');
  if(epwInput) epwInput.value = '';
  applySharedToolDefaults();
  if(typeof syncUWinFromTable==='function' && !hasInput('uWin')) syncUWinFromTable();
}

function renderEpPanel(){
  const summary = document.getElementById('epSummary');
  const review = document.getElementById('epReview');
  const warnEl = document.getElementById('epWarnList');
  if(!summary) return;
  if(!epParse && !epSqlName && !epSqlPeak){
    summary.innerHTML = '<p class="small" style="margin:0;">IDF を指定すると、床下・小屋裏を除いた居室ゾーンの外壁・窓・床の外皮面積と UA、最大在室人数を入れます。SQL を追加すると冷房ピーク時刻を入れます。</p>';
    review.innerHTML = '';
    warnEl.style.display = 'none';
    warnEl.innerHTML = '';
    setEpFileEcho();
    return;
  }
  const hab = (epParse && epParse.habitable) || [];
  const exc = (epParse && epParse.excluded) || [];
  summary.innerHTML =
    '<div class="at-review-head">'+
      '<span class="at-chip"><span>IDF</span><b>'+escapeEp(epIdfName||'—')+'</b></span>'+
      (epParse ? '<span class="at-chip"><span>居室ゾーン</span><b>'+hab.length+'</b></span>' : '')+
      (epParse ? '<span class="at-chip'+(epParse.windowCount?'' : ' warn-chip')+'"><span>居室の窓</span><b>'+(epParse.windowCount||0)+'</b></span>' : '')+
      (epParse && epParse.uaVal!=null ? '<span class="at-chip"><span>UA</span><b>'+(Math.round(epParse.uaVal*1000)/1000)+'</b></span>' : '')+
      (epParse && epParse.uWin!=null ? '<span class="at-chip"><span>窓U</span><b>'+(Math.round(epParse.uWin*1000)/1000)+'</b></span>' : '')+
      (exc.length ? '<span class="at-chip"><span>除外 (床下・小屋裏)</span><b>'+exc.length+'</b></span>' : '')+
      '<span class="at-chip"><span>SQL</span><b>'+escapeEp(epSqlName||'未指定')+'</b></span>'+
      (epSqlPeak ? '<span class="at-chip"><span>冷房ピーク</span><b>'+escapeEp(epSqlPeak.label)+'</b></span>' : '')+
      (epSqlWx && epSqlWx.nIncident ? '<span class="at-chip"><span>入射日射</span><b>'+epSqlWx.nIncident+'面</b></span>' : '')+
      (epSqlWx && epSqlWx.nTransmitted ? '<span class="at-chip"><span>透過日射</span><b>'+epSqlWx.nTransmitted+'窓</b></span>' : '')+
      (epwName ? '<span class="at-chip"><span>EPW</span><b>'+escapeEp(epwName)+'</b></span>' : '')+
    '</div>';
  review.innerHTML = epParse
    ? ('<div class="at-review">'+
        '<details open><summary>居室ゾーン <span class="count">'+hab.length+'</span></summary>'+
          '<div class="at-review-body at-room-chips">'+
            hab.map(z=>'<span class="at-room-chip">'+escapeEp(z.name)+
              (z.floorArea?(' '+z.floorArea.toFixed(1)+'㎡'):'')+
              (' '+epOccInputValue(z.peopleMax||0)+'人')+'</span>').join('')+
          '</div></details>'+
        (exc.length
          ? '<details><summary>除外ゾーン (床下・小屋裏) <span class="count">'+exc.length+'</span></summary>'+
            '<div class="at-review-body at-room-chips">'+
              exc.map(z=>'<span class="at-room-chip excluded">'+escapeEp(z.name)+'</span>').join('')+
            '</div></details>'
          : '')+
      '</div>')
    : '';
  const extra = [];
  if(epParse && !(epParse.windowCount>0) && epParse.warnings && epParse.warnings.every(w=>String(w).indexOf('居室の窓がありません')<0)){
    extra.push('このIDFに居室の窓がありません。直達日射は0になります。*_clean.idf ではなく、FenestrationSurface がある本体 IDF を選んでください。');
  }
  if(epParse && epParse.uaVal!=null){
    extra.push('UA・外皮面積は居室の外壁・屋根・窓と、1F床・基礎（床下ゾーンがあればその外周）の面積加重です。線熱貫流率(ψ)は含みません。1F床U・基礎Uは入力欄の初期値を使います。');
  }
  if(epSqlPeak){
    extra.push('冷房ピーク '+epSqlPeak.label+' を日付と解析時刻に入れました。EnergyPlus の Hour は時刻帯の終わりです。在室人数は IDF の People（スケジュール前の最大）です。人体・機器の原単位は初期値です。');
    if(epSqlPeak.tmax==null && !(epSqlWx && epSqlWx.oat) && !(epwData && epwData.n)) extra.push('SQLに外気温の時系列が無いため、最高/最低気温は手入力するか EPW を入れてください。');
  }
  if(epParse && !epParse.consLayers){
    extra.push('IDFを選び直すと壁構成から ISO13786 の遅れ・減衰が使えます。');
  }
  if(epSqlName && !epSqlWx){
    extra.push('SQLの時系列はこのブラウザには保存しません。SAT/ETD と透過日射を使うときは SQL を選び直してください。');
  }
  if(epSqlWx && !epSqlWx.nIncident){
    extra.push('SQLに面の入射日射 (Surface Outside Face Incident Solar Radiation Rate per Area, Hourly) がありません。IDF の Output:Variable に入れて再計算すると、Grasshopper と同じ SAT/ETD が使えます。今は晴天モデルのSATです。');
  }
  if(epSqlWx && !epSqlWx.nTransmitted){
    extra.push('SQLに窓の透過日射 (Surface Window Transmitted Solar Radiation Rate, Hourly) がありません。今は I_DN×η0×面積 に r_G を掛けます。');
  }
  const warns = ((epParse && epParse.warnings)||[]).concat(extra);
  if(warns.length){
    warnEl.style.display = 'block';
    warnEl.innerHTML = warns.map(w=>'<li>'+escapeEp(w)+'</li>').join('');
  }else{
    warnEl.style.display = 'none';
    warnEl.innerHTML = '';
  }
  setEpFileEcho();
}

function escapeEp(s){
  return String(s==null?'':s).replace(/[&<>"']/g, ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

function applyEpWallUFromParse(){
  if(!epParse) return;
  const {hi, ho} = epHiHo();
  const rows = epOpaqueRows(epParse, hi, ho);
  setEpVal('uWall', epWeightedU(rows, '外壁'));
  setEpVal('uRoof', epWeightedU(rows, '屋根'));
}

function uniqueEpWindowU(parse){
  const us = [];
  (parse&&parse.windows||[]).forEach(w=>{
    if(!(w.u>0)) return;
    const n = Math.round(w.u*1000)/1000;
    if(us.indexOf(n)<0) us.push(n);
  });
  return us;
}

function epWeightedWindowU(parse){
  let ua=0, a=0;
  (parse&&parse.windows||[]).forEach(w=>{
    if(!(w.u>0) || !(w.area>0)) return;
    ua += w.u * w.area;
    a += w.area;
  });
  if(a>0) return ua/a;
  const us = uniqueEpWindowU(parse);
  if(!us.length) return null;
  return us.reduce((s,v)=>s+v,0)/us.length;
}

function epWindowUFromRooms(){
  if(typeof collectRoomWindowUs!=='function') return null;
  const us = collectRoomWindowUs();
  if(!us.length) return null;
  return us.reduce((s,v)=>s+v,0)/us.length;
}

function applyEpUWinAndVolume(){
  if(!epParse) return;
  let u = epWeightedWindowU(epParse);
  if(!(u>0)) u = epWindowUFromRooms();
  const us = uniqueEpWindowU(epParse);
  epParse.uWin = (u>0) ? u : null;
  if(u>0){
    setEpVal('uWin', u);
    const info = document.getElementById('winTableInfo');
    if(info) info.textContent = 'IDFから自動入力: U='+(Math.round(u*1000)/1000)+' W/(m²K)'+(us.length>1?'（面積加重）':'');
  }else if(typeof syncUWinFromTable==='function'){
    syncUWinFromTable();
  }
  if(u>0 && us.length>1 && epParse.warnings && epParse.warnings.every(w=>String(w).indexOf('窓Uが複数')<0)){
    epParse.warnings.push('窓Uが複数あるため、共通欄は面積加重平均 U='+(Math.round(u*1000)/1000)+' です。各窓のUは部屋カードに入れ、3DSはUごとに色分けします');
  }
  if(!(u>0) && ((epParse.windows||[]).length || epParse.windowCount) && epParse.warnings && epParse.warnings.every(w=>String(w).indexOf('窓UをIDF')<0)){
    epParse.warnings.push('窓UをIDFから計算できませんでした。上の建具表の値を仮置きしています。IDFを読み込み直すか、SimpleGlazing / ガラス+ガス層を確認してください');
  }
  const vol = (epParse.habitable||[]).reduce((s,z)=>s+(z.volume||0), 0);
  if(vol>0) setEpVal('roomVol', vol);
  else setEpVal('roomVol', null);
}

function clearEpRoomCards(){
  document.querySelectorAll('.room-card[data-ep-zone]').forEach(el=>el.remove());
}

function epWinsForZone(zname){
  const key = idfNameKey(zname);
  return (epParse && epParse.windows || []).filter(w=>w.zone===zname || idfNameKey(w.zone)===key);
}
function epEtaForWindow(w){
  if(w && w.shgc!=null && isFinite(w.shgc) && w.shgc>0) return String(w.shgc);
  return '0.54';
}
function epWindowRowFromParse(w){
  return {
    wName: w.name,
    wAz: String(Math.round(w.toolAz*10)/10),
    wArea: String(Math.round(w.area*1000)/1000),
    glassSel: '0',
    attachSel: '0',
    wEta: epEtaForWindow(w),
    wU: (w.u>0) ? String(Math.round(w.u*1000)/1000) : ''
  };
}
function applyEpWinRow(row, w){
  if(!row || !w) return;
  const setIf = function(cls, val, overwrite){
    const el = row.querySelector('.'+cls);
    if(!el || val==null || val==='') return;
    if(overwrite || el.value==='' || (cls==='wArea' && !(parseFloat(el.value)>0))){
      el.value = val;
    }
  };
  setIf('wName', w.name, false);
  if(isFinite(w.toolAz)) setIf('wAz', String(Math.round(w.toolAz*10)/10), row.querySelector('.wAz') && row.querySelector('.wAz').value==='');
  setIf('wArea', String(Math.round((w.area||0)*1000)/1000), false);
  setIf('wEta', epEtaForWindow(w), false);
  if(w.u>0) setIf('wU', String(Math.round(w.u*1000)/1000), false);
}

function applyEpRoomsFromParse(){
  if(!epParse || typeof addRoom!=='function') return;
  clearEpRoomCards();
  (epParse.habitable||[]).forEach(z=>{
    const wins = epWinsForZone(z.name);
    addRoom({
      name: z.name,
      epZone: z.name,
      skipRerun: true,
      fields:{
        roomArea: z.floorArea!=null ? String(Math.round(z.floorArea*1000)/1000) : '',
        occCount: epOccInputValue(z.peopleMax||0)
      },
      windows: wins.map(epWindowRowFromParse)
    });
    const cards = document.querySelectorAll('.room-card[data-ep-zone]');
    const card = cards[cards.length-1];
    if(card){
      const areaEl = card.querySelector('.roomArea');
      if(areaEl){
        const wrap = areaEl.closest('div');
        if(wrap) wrap.classList.add('ep-filled');
      }
      const occEl = card.querySelector('input.occCount');
      if(occEl){
        const wrap = occEl.closest('div');
        if(wrap) wrap.classList.add('ep-filled');
      }
      card.querySelectorAll('.win-row').forEach(function(row){
        ['wEta','wU'].forEach(function(cls){
          const el = row.querySelector('.'+cls);
          if(!el || el.value==='') return;
          const wrap = el.closest('div');
          if(wrap) wrap.classList.add('ep-filled');
        });
      });
    }
  });
  applySharedToolDefaults();
  applyEpUWinAndVolume();
}

function applyEpOccupancyToRooms(){
  if(!epParse) return;
  document.querySelectorAll('.room-card[data-ep-zone]').forEach(card=>{
    const z = (epParse.habitable||[]).find(x=>x.name===card.dataset.epZone);
    const occEl = card.querySelector('input.occCount');
    if(!occEl) return;
    occEl.value = epOccInputValue((z && z.peopleMax) || 0);
    const wrap = occEl.closest('div');
    if(wrap) wrap.classList.add('ep-filled');
  });
  applyEpWindowsToRooms();
  applyEpWindowUToRooms();
  applyEpUWinAndVolume();
}

function applyEpWindowsToRooms(){
  if(!epParse || typeof addWindow!=='function') return;
  document.querySelectorAll('.room-card').forEach(card=>{
    const nameEl = card.querySelector('.roomName');
    const zname = card.dataset.epZone || (nameEl ? nameEl.value : '');
    if(!zname) return;
    if(!card.dataset.epZone){
      const z = (epParse.habitable||[]).find(x=>x.name===zname || idfNameKey(x.name)===idfNameKey(zname));
      if(z) card.dataset.epZone = z.name;
    }
    const wins = epWinsForZone(card.dataset.epZone || zname);
    if(!wins.length) return;
    const list = card.querySelector('.winList');
    if(!list) return;
    const existing = list.querySelectorAll('.win-row');
    const namesMatch = existing.length === wins.length && wins.every(function(w,i){
      const el = existing[i].querySelector('.wName');
      return el && el.value === w.name;
    });
    if(namesMatch){
      wins.forEach((w,i)=>applyEpWinRow(existing[i], w));
      return;
    }
    existing.forEach(el=>el.remove());
    wins.forEach(w=>addWindow(card.id, Object.assign({skipRerun:true}, epWindowRowFromParse(w))));
  });
}

function applyEpWindowUToRooms(){
  if(!epParse) return;
  document.querySelectorAll('.room-card[data-ep-zone]').forEach(card=>{
    const zname = card.dataset.epZone;
    card.querySelectorAll('.win-row').forEach(function(row){
      const nameEl = row.querySelector('.wName');
      if(!nameEl) return;
      const w = (epParse.windows||[]).find(x=>x.name===nameEl.value && (x.zone===zname || idfNameKey(x.zone)===idfNameKey(zname))) ||
        (epParse.windows||[]).find(x=>x.name===nameEl.value);
      if(!w){
        const etaEl = row.querySelector('.wEta');
        if(etaEl && etaEl.value==='') etaEl.value = '0.54';
        return;
      }
      const uEl = row.querySelector('.wU');
      if(uEl && w.u>0){
        uEl.value = String(Math.round(w.u*1000)/1000);
        const wrap = uEl.closest('div');
        if(wrap) wrap.classList.add('ep-filled');
      }
      const etaEl = row.querySelector('.wEta');
      if(etaEl && etaEl.value===''){
        etaEl.value = epEtaForWindow(w);
        const wrap = etaEl.closest('div');
        if(wrap) wrap.classList.add('ep-filled');
      }
      const azEl = row.querySelector('.wAz');
      if(azEl && azEl.value==='' && isFinite(w.toolAz)) azEl.value = String(Math.round(w.toolAz*10)/10);
      const areaEl = row.querySelector('.wArea');
      if(areaEl && (areaEl.value==='' || +areaEl.value===0) && w.area>0){
        areaEl.value = String(Math.round(w.area*1000)/1000);
      }
    });
  });
}

function renderEpWallHeat(satByOri, roofSat, taNow){
  const wrap = document.getElementById('epWallTableWrap');
  const box = document.getElementById('epWallBox');
  if(!wrap || !box) return;
  if(appMode!=='energyplus'){
    box.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }
  box.style.display = '';
  if(!epParse){
    wrap.innerHTML = '<p class="small">IDF を読み込むと、居室の方位別壁面積・U・貫流 W が出ます。緯度経度と室温が入ると SAT 差分まで計算します。</p>';
    return;
  }
  const {hi, ho} = epHiHo();
  const rows = epOpaqueRows(epParse, hi, ho);
  const targetT = (typeof numOrNull==='function') ? numOrNull('targetT') : null;
  const satReady = satByOri && Object.keys(satByOri).some(k=>isFinite(satByOri[k]));
  const taReady = isFinite(taNow);
  const canQ = targetT!==null && (satReady || taReady);

  const grouped = {};
  rows.forEach(r=>{
    const key = r.zone+'|'+r.part+'|'+(r.part==='外壁'?r.orient:'—');
    if(!grouped[key]) grouped[key] = {zone:r.zone, part:r.part, orient:r.part==='外壁'?r.orient:'—', area:0, ua:0};
    grouped[key].area += r.net;
    if(r.u>0) grouped[key].ua += r.u*r.net;
  });
  const list = Object.values(grouped).map(g=>{
    const u = g.area>0 && g.ua>0 ? g.ua/g.area : null;
    let tBound = NaN;
    if(g.part==='外壁') tBound = satByOri && satByOri[g.orient];
    else if(g.part==='屋根') tBound = roofSat;
    else tBound = taNow;
    let q = null;
    if(canQ && u>0 && isFinite(tBound)) q = u * g.area * (tBound - targetT);
    return {zone:g.zone, part:g.part, orient:g.orient, area:g.area, u, tBound, q};
  }).sort((a,b)=>{
    const z = String(a.zone).localeCompare(String(b.zone),'ja');
    if(z) return z;
    if(a.part!==b.part) return a.part.localeCompare(b.part,'ja');
    return String(a.orient).localeCompare(String(b.orient),'ja');
  });

  if(!list.length){
    wrap.innerHTML = '<div class="warn">居室ゾーンに外気に面する壁・屋根がありません。IDFの Zone 名と Outside Boundary Condition を確認してください。</div>';
    return;
  }

  let qWall=0, qRoof=0, aWall=0, aRoof=0, hasQ=false;
  let html = '<table><tr><th>室</th><th>部位</th><th>方位</th><th>面積 m²</th><th>U W/m²K</th><th>境界温度 ℃</th><th>貫流 W</th></tr>';
  list.forEach(r=>{
    if(r.part==='外壁') aWall += r.area;
    if(r.part==='屋根') aRoof += r.area;
    if(r.q!=null){ hasQ=true; if(r.part==='外壁') qWall+=r.q; if(r.part==='屋根') qRoof+=r.q; }
    html += '<tr><td class="l">'+escapeEp(r.zone)+'</td><td>'+escapeEp(r.part)+'</td><td>'+escapeEp(r.orient)+'</td>'+
      '<td>'+r.area.toFixed(2)+'</td><td>'+(r.u==null?'—':r.u.toFixed(3))+'</td>'+
      '<td>'+(isFinite(r.tBound)?r.tBound.toFixed(2):'—')+'</td>'+
      '<td>'+(r.q==null?'—':r.q.toFixed(0))+'</td></tr>';
  });
  html += '<tr style="font-weight:600; background:#F4F4F4;"><td colspan="3">居室 外壁合計</td><td>'+aWall.toFixed(2)+'</td><td></td><td></td><td>'+(hasQ?qWall.toFixed(0):'—')+'</td></tr>';
  html += '<tr style="font-weight:600; background:#F4F4F4;"><td colspan="3">居室 屋根合計</td><td>'+aRoof.toFixed(2)+'</td><td></td><td></td><td>'+(hasQ?qRoof.toFixed(0):'—')+'</td></tr>';
  html += '</table>';
  html += '<p class="small" style="margin:8px 0 0;">q = U × 開口控除後面積 × (境界温度 − 目標室温)。外壁の境界温度は方位別 SAT、屋根は屋根 SAT、外気床は外気温です。床下・小屋裏ゾーンは含めていません。この W は Step 2 の発生エリアには足しません (CFD の壁パネルと二重になるため)。</p>';
  if(!canQ){
    html += '<div class="warn" style="margin-top:8px;">緯度経度・外気温・目標室温が入ると貫流 W が計算されます。面積と U は IDF だけで出ています。</div>';
  }
  wrap.innerHTML = html;
}

function ensureEpSqlJs(){
  if(window.epSqlJsModule) return Promise.resolve(window.epSqlJsModule);
  if(_epSqlJsPromise) return _epSqlJsPromise;
  _epSqlJsPromise = new Promise(function(resolve, reject){
    function start(){
      if(typeof initSqlJs!=='function'){
        reject(new Error('sql.js の初期化関数がありません'));
        return;
      }
      initSqlJs({locateFile:function(f){ return 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/'+f; }})
        .then(function(SQL){ window.epSqlJsModule=SQL; resolve(SQL); })
        .catch(reject);
    }
    if(typeof initSqlJs==='function'){ start(); return; }
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/sql-wasm.min.js';
    s.onload=start;
    s.onerror=function(){ reject(new Error('sql.js を読み込めませんでした。ネット接続を確認してください')); };
    document.head.appendChild(s);
  });
  return _epSqlJsPromise;
}

function epSqlExec(db, sql){
  try{ return db.exec(sql); }
  catch(err){ return []; }
}

function extractEpSqlWx(db, tmap){
  const times=[];
  Object.keys(tmap).forEach(function(k){
    const t=tmap[k];
    times.push({ti:+k, y:+t.y||0, mo:+t.mo, d:+t.d, h:+t.h});
  });
  times.sort(function(a,b){ return (a.y-b.y)||(a.mo-b.mo)||(a.d-b.d)||(a.h-b.h)||(a.ti-b.ti); });
  const uniq=[];
  const ymdhToIdx={};
  times.forEach(function(t){
    const k=t.y+'-'+t.mo+'-'+t.d+'-'+t.h;
    if(ymdhToIdx[k]==null){
      ymdhToIdx[k]=uniq.length;
      uniq.push(t);
    }
  });
  const n=uniq.length;
  if(!n) return null;
  const tiToIdx={};
  times.forEach(function(t){
    const idx=ymdhToIdx[t.y+'-'+t.mo+'-'+t.d+'-'+t.h];
    if(idx!=null) tiToIdx[t.ti]=idx;
  });
  const dict=epSqlExec(db,
    "SELECT ReportDataDictionaryIndex, KeyValue, Name FROM ReportDataDictionary "+
    "WHERE ReportingFrequency='Hourly' AND ("+
      "Name LIKE '%Outdoor Air Drybulb Temperature%' OR "+
      "Name LIKE '%Incident Solar Radiation Rate per Area%' OR "+
      "Name LIKE '%Window Transmitted Solar Radiation Rate%'"+
    ")");
  if(!dict.length || !dict[0].values.length){
    return {n:n, mo:uniq.map(function(t){return t.mo;}), d:uniq.map(function(t){return t.d;}), h:uniq.map(function(t){return t.h;}),
      oat:null, incident:{}, transmittedW:{}, transmittedWm2:{}, nIncident:0, nTransmitted:0};
  }
  const want={};
  if(typeof epParse!=='undefined' && epParse){
    (epParse.opaque||[]).forEach(function(s){ if(s.name) want[idfNameKey(s.name)]=true; });
    (epParse.windows||[]).forEach(function(s){ if(s.name) want[idfNameKey(s.name)]=true; });
  }
  const oatRids=[];
  const incidentRids=[];
  const txWRids=[];
  const txARids=[];
  const ridKey={};
  dict[0].values.forEach(function(row){
    const rid=row[0], kv=String(row[1]||''), name=String(row[2]||'');
    const key=idfNameKey(kv);
    ridKey[rid]={key:key, name:name, kv:kv};
    if(/Outdoor Air Drybulb Temperature/i.test(name)){
      oatRids.push(rid);
      return;
    }
    if(/Incident Solar Radiation Rate per Area/i.test(name) && !/Window/i.test(name)){
      if(!Object.keys(want).length || want[key]) incidentRids.push(rid);
      return;
    }
    if(/Window Transmitted Solar Radiation Rate/i.test(name)){
      if(Object.keys(want).length && !want[key] && !/environment/i.test(kv)) return;
      if(/per Area/i.test(name)) txARids.push(rid);
      else txWRids.push(rid);
    }
  });
  function fillMany(rids){
    const map={};
    if(!rids.length) return map;
    const chunk=80;
    for(let i=0;i<rids.length;i+=chunk){
      const part=rids.slice(i, i+chunk);
      const rd=epSqlExec(db, "SELECT ReportDataDictionaryIndex, TimeIndex, Value FROM ReportData WHERE ReportDataDictionaryIndex IN ("+part.join(',')+")");
      if(!rd.length) continue;
      rd[0].values.forEach(function(row){
        const meta=ridKey[row[0]];
        if(!meta) return;
        const idx=tiToIdx[row[1]];
        if(idx==null) return;
        if(!map[meta.key]){
          const arr=new Float64Array(n);
          arr.fill(NaN);
          map[meta.key]=arr;
        }
        // ReportData: [0]=DictionaryIndex [1]=TimeIndex [2]=Value
        map[meta.key][idx]=+row[2];
      });
    }
    return map;
  }
  let oat=null;
  if(oatRids.length){
    const oatMap=fillMany(oatRids);
    const envKey=Object.keys(oatMap).find(function(k){ return /environment/i.test(k); }) || Object.keys(oatMap)[0];
    if(envKey) oat=oatMap[envKey];
  }
  const incident=fillMany(incidentRids);
  const transmittedW=fillMany(txWRids);
  const transmittedWm2=fillMany(txARids);
  return {
    n:n,
    mo:uniq.map(function(t){ return t.mo; }),
    d:uniq.map(function(t){ return t.d; }),
    h:uniq.map(function(t){ return t.h; }),
    oat:oat,
    incident:incident,
    transmittedW:transmittedW,
    transmittedWm2:transmittedWm2,
    nIncident:Object.keys(incident).length,
    nTransmitted:Object.keys(transmittedW).length+Object.keys(transmittedWm2).length
  };
}

function parseEpSqlPeak(SQL, buf){
  const db = new SQL.Database(new Uint8Array(buf));
  try{
    const dict = epSqlExec(db,
      "SELECT ReportDataDictionaryIndex, KeyValue, Name FROM ReportDataDictionary "+
      "WHERE ReportingFrequency='Hourly' AND Name LIKE '%Ideal Loads Zone%Cooling Rate%'");
    if(!dict.length || !dict[0].values.length){
      throw new Error('Hourly の Zone Ideal Loads … Cooling Rate が見つかりません');
    }
    function collectCoolingRids(skipBuffer){
      const total=[], sens=[];
      dict[0].values.forEach(function(row){
        const rid=row[0], kv=String(row[1]||''), name=String(row[2]||'');
        if(skipBuffer && isEpBufferZone(kv)) return;
        if(/Total Cooling Rate/i.test(name)) total.push(rid);
        else if(/Sensible Cooling Rate/i.test(name)) sens.push(rid);
      });
      return {
        rids: total.length ? total : sens,
        source: total.length
          ? 'Zone Ideal Loads Zone Total Cooling Rate'
          : 'Zone Ideal Loads Zone Sensible Cooling Rate'
      };
    }
    let picked = collectCoolingRids(true);
    if(!picked.rids.length) picked = collectCoolingRids(false);
    const rids = picked.rids;
    const source = picked.source;
    if(!rids.length) throw new Error('床下・小屋裏以外の冷房負荷列がありません');

    let trows = epSqlExec(db, "SELECT TimeIndex, Year, Month, Day, Hour, WarmupFlag FROM Time");
    if(!trows.length) trows = epSqlExec(db, "SELECT TimeIndex, Year, Month, Day, Hour FROM Time");
    if(!trows.length || !trows[0].values.length) throw new Error('Time テーブルが読めません');
    const tmap={};
    trows[0].values.forEach(function(row){
      const ti=row[0], y=row[1], mo=row[2], d=row[3], h=row[4];
      const warm=row.length>5 ? row[5] : 0;
      if(warm===1 || warm==='1' || String(warm).toLowerCase()==='true') return;
      tmap[ti]={y:y, mo:mo, d:d, h:h};
    });

    const inList=rids.join(',');
    const rd=epSqlExec(db, "SELECT TimeIndex, Value FROM ReportData WHERE ReportDataDictionaryIndex IN ("+inList+")");
    if(!rd.length) throw new Error('ReportData に冷房負荷がありません');
    const acc={};
    rd[0].values.forEach(function(row){
      const ti=row[0], val=+row[1]||0;
      if(!tmap[ti]) return;
      acc[ti]=(acc[ti]||0)+val;
    });
    let bestTi=null, bestQ=-1;
    Object.keys(acc).forEach(function(k){
      if(acc[k]>bestQ){ bestQ=acc[k]; bestTi=+k; }
    });
    if(bestTi==null || !tmap[bestTi]) throw new Error('冷房ピーク時刻を特定できませんでした');
    const t=tmap[bestTi];
    const year=(t.y && +t.y>0) ? +t.y : 2026;
    const hour=+t.h;
    const peak={
      year:year, month:+t.mo, day:+t.d, hour:hour,
      qW:bestQ, source:source,
      tmax:null, tmin:null, tpeak:null
    };

    const oatDict=epSqlExec(db,
      "SELECT ReportDataDictionaryIndex, KeyValue FROM ReportDataDictionary "+
      "WHERE ReportingFrequency='Hourly' AND Name LIKE '%Outdoor Air Drybulb Temperature%'");
    if(oatDict.length && oatDict[0].values.length){
      const oatRow=oatDict[0].values.find(function(v){ return /environment/i.test(String(v[1]||'')); }) || oatDict[0].values[0];
      const oatRid=oatRow[0];
      const oatRd=epSqlExec(db, "SELECT TimeIndex, Value FROM ReportData WHERE ReportDataDictionaryIndex="+oatRid);
      let tmax=-1e9, tmin=1e9, tpeak=null;
      if(oatRd.length){
        oatRd[0].values.forEach(function(row){
          const meta=tmap[row[0]]; if(!meta) return;
          if(+meta.mo!==peak.month || +meta.d!==peak.day) return;
          if(meta.y && +meta.y>0 && +meta.y!==peak.year) return;
          const tv=+row[1];
          if(!isFinite(tv)) return;
          if(tv>tmax){ tmax=tv; tpeak=+meta.h; }
          if(tv<tmin) tmin=tv;
        });
      }
      if(tmax>-1e8 && tmin<1e8){
        peak.tmax=tmax; peak.tmin=tmin; peak.tpeak=tpeak;
      }
    }

    peak.dateStr=year+'-'+String(peak.month).padStart(2,'0')+'-'+String(peak.day).padStart(2,'0');
    peak.label=peak.month+'/'+peak.day+' '+hour+'時 ('+Math.round(peak.qW)+' W)';
    let wx=null;
    try{ wx=extractEpSqlWx(db, tmap); }catch(err){ wx=null; }
    return {peak:peak, wx:wx};
  }finally{
    db.close();
  }
}

function applyEpSqlPeak(peak){
  if(!peak) return;
  const dateEl=document.getElementById('calcDate');
  if(dateEl && peak.dateStr){
    dateEl.value=peak.dateStr;
    const wrap=dateEl.closest('div');
    if(wrap) wrap.classList.add('ep-filled');
  }
  setEpVal('detailHour', peak.hour);
  if(peak.tmax!=null) setEpVal('tmax', Math.round(peak.tmax*10)/10);
  if(peak.tmin!=null) setEpVal('tmin', Math.round(peak.tmin*10)/10);
  if(peak.tpeak!=null) setEpVal('tpeak', peak.tpeak);
}

function setEpFileEcho(){
  const idfEcho = document.getElementById('epIdfFileEcho');
  if(idfEcho) idfEcho.textContent = epIdfName ? ('読み込み済み: '+epIdfName) : '';
  const sqlEcho = document.getElementById('epSqlFileEcho');
  if(sqlEcho) sqlEcho.textContent = epSqlName ? ('読み込み済み: '+epSqlName) : '';
  const epwEcho = document.getElementById('epEpwFileEcho');
  if(epwEcho) epwEcho.textContent = epwName ? ('読み込み済み: '+epwName) : '';
}
function setEpSqlStatus(msg){
  const el=document.getElementById('epSqlStatus');
  if(el) el.textContent=msg||'';
}

function onEpIdfSelected(input){
  const file = input.files && input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = function(){
    try{
      epParse = parseEnergyPlusIdf(String(reader.result||''));
      epIdfName = file.name;
      if(epParse.habitableCount===0 && epParse.zoneCount>0){
        epParse.warnings.push('全部のゾーンが床下・小屋裏判定になりました。Zone 名を確認してください');
      }
      if(!(epParse.windowCount>0)){
        const hint = /clean/i.test(file.name)
          ? ' *_clean.idf は窓 (FenestrationSurface) が削られていることが多いです。窓付きの本体 IDF（例: 260818_iworks1.idf）を選んでください。'
          : ' FenestrationSurface:Detailed がある IDF を選んでください。';
        epParse.warnings.push('このIDFに居室の窓がありません。直達日射は0になります。'+hint);
      }
      applyEpWallUFromParse();
      applyEpRoomsFromParse();
      applyEpUWinAndVolume();
      applyEpUaAndEnvelope();
      renderEpPanel();
      if(typeof refreshNeedManual==='function') refreshNeedManual();
      if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
      if(typeof runAll==='function') runAll();
    }catch(err){
      alert('IDF の読み込みに失敗しました: '+(err && err.message ? err.message : err));
    }
  };
  reader.readAsText(file, 'utf-8');
}

function onEpSqlSelected(input){
  const file = input.files && input.files[0];
  if(!file){
    epSqlName = '';
    epSqlPeak = null;
    epSqlWx = null;
    setEpSqlStatus('');
    renderEpPanel();
    return;
  }
  epSqlName = file.name;
  epSqlPeak = null;
  epSqlWx = null;
  setEpSqlStatus('SQLを読み込み、冷房ピークと日射時系列を探しています…');
  renderEpPanel();
  const reader = new FileReader();
  reader.onload = function(){
    ensureEpSqlJs().then(function(SQL){
      const parsed = parseEpSqlPeak(SQL, reader.result);
      epSqlPeak = parsed && parsed.peak ? parsed.peak : parsed;
      epSqlWx = parsed && parsed.wx ? parsed.wx : null;
      applyEpSqlPeak(epSqlPeak);
      setEpSqlStatus(epSqlWx
        ? ('入射日射 '+(epSqlWx.nIncident||0)+' 面 / 透過日射 '+(epSqlWx.nTransmitted||0)+' 窓'+(epSqlWx.oat?' / 外気温あり':''))
        : '');
      renderEpPanel();
      if(typeof runAll==='function') runAll();
    }).catch(function(err){
      epSqlPeak = null;
      epSqlWx = null;
      setEpSqlStatus('');
      renderEpPanel();
      const warnEl=document.getElementById('epWarnList');
      const msg='SQLの読み込みに失敗しました: '+(err && err.message ? err.message : err);
      if(warnEl){
        warnEl.style.display='block';
        warnEl.innerHTML += '<li>'+escapeEp(msg)+'</li>';
      }else{
        alert(msg);
      }
    });
  };
  reader.onerror=function(){
    setEpSqlStatus('');
    alert('SQLファイルを読めませんでした');
  };
  reader.readAsArrayBuffer(file);
}

function onEpEpwSelected(input){
  const file = input.files && input.files[0];
  if(!file){
    epwName = '';
    epwData = null;
    setEpFileEcho();
    if(typeof runAll==='function') runAll();
    return;
  }
  const reader = new FileReader();
  reader.onload = function(){
    try{
      epwData = parseEpwDrybulb(String(reader.result||''));
      epwName = file.name;
      if(!(epwData.n>0)) throw new Error('EPWの乾球温度が読めませんでした');
      if(epwData.lat!=null && epwData.lon!=null && typeof setEpVal==='function'){
        const latEl=document.getElementById('lat');
        const lonEl=document.getElementById('lon');
        if(latEl && !(parseFloat(latEl.value)>0)) setEpVal('lat', epwData.lat);
        if(lonEl && !(parseFloat(lonEl.value)>0)) setEpVal('lon', epwData.lon);
      }
      setEpFileEcho();
      renderEpPanel();
      if(typeof runAll==='function') runAll();
    }catch(err){
      epwName = '';
      epwData = null;
      alert('EPW の読み込みに失敗しました: '+(err && err.message ? err.message : err));
    }
  };
  reader.readAsText(file);
}

function startEnergyPlusMode(saved){
  setModeUI('energyplus');
  initSelectors();
  if(saved && saved.mode==='energyplus' && (saved.epParse || saved.epSqlPeak || saved.epSqlName)){
    epParse = saved.epParse || null;
    applyState(saved);
    epIdfName = saved.epIdfName || '';
    epSqlName = saved.epSqlName || '';
    epSqlPeak = saved.epSqlPeak || null;
    epSqlWx = null;
    if(epParse){
      if(!epParse.gainVolumes) buildEpGainVolumes(epParse);
      applyEpWallUFromParse();
      applyEpUaAndEnvelope();
      if(!(saved.rooms||[]).some(r=>r.epZone)){
        applyEpRoomsFromParse();
      }else{
        applyEpOccupancyToRooms();
      }
      applyEpUWinAndVolume();
    }
    if(epSqlPeak) applyEpSqlPeak(epSqlPeak);
    applySharedToolDefaults();
    renderEpPanel();
    if(typeof refreshNeedManual==='function') refreshNeedManual();
    if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
    runAll();
  }else{
    blankForEnergyPlus();
    renderEpPanel();
    if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
    runAll();
  }
}

if(typeof module!=='undefined' && module.exports){
  module.exports = {
    parseEnergyPlusIdf, isEpBufferZone, epOpaqueRows, opaqueUFromR, uniqueEpWindowU,
    epWeightedWindowU, windowUFromLayers, epPeopleCount, epEnvelopeParts, parseEpSqlPeak, EP_HI,
    buildEpGainVolumes, epInsetPolyhedron, epAabbInsetFaces
  };
}

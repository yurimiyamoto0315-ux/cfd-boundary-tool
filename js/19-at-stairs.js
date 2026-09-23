// Stair treads and risers are zero-thickness panels on a user-edited centerline.
const AT_STAIR_RISE = 0.20;
const AT_STAIR_GOING_MIN = 0.15;
const AT_STAIR_THICK = 0.04;
const AT_STAIR_WIDTH_MAX = 0.80;
const AT_STAIR_LANDING = 0.80;

function atIsStairRoom(r){
  const n=String((r && r.name)||'').replace(/\s+/g,'');
  return n==='階段' || n.indexOf('階段')===0;
}
function atStairCentroid(ring){
  const b=typeof atRingBBox==='function' ? atRingBBox(ring) : null;
  if(b && typeof atPointInRing==='function' && atPointInRing((b.minx+b.maxx)/2, (b.miny+b.maxy)/2, ring)){
    return {x:(b.minx+b.maxx)/2, y:(b.miny+b.maxy)/2};
  }
  let x=0, y=0, n=(ring||[]).length||1;
  (ring||[]).forEach(function(p){ x+=p.x; y+=p.y; });
  const c={x:x/n, y:y/n};
  if(typeof atPointInRing==='function' && !atPointInRing(c.x, c.y, ring||[])){
    if(typeof atRoomLabelPoint==='function'){
      const p=atRoomLabelPoint({ring:ring});
      if(p) return {x:p.x, y:p.y};
    }
  }
  return c;
}
function atStairNextFloorZ(r, rooms, mesh){
  let z=null;
  (rooms||[]).forEach(function(q){
    if(!q || q===r || q.floor!==r.floor+1) return;
    if(z==null || q.z<z) z=q.z;
  });
  if(z!=null) return z;
  ((mesh && mesh.meshFaces)||[]).forEach(function(f){
    if(typeof atIsFloorFace==='function' && !atIsFloorFace(f)) return;
    const fz=typeof atFaceZ==='function' ? atFaceZ(f) : 0;
    if(fz>r.z+1.2 && fz<r.z+4.8 && (z==null || fz<z)) z=fz;
  });
  return z!=null ? z : r.zTop;
}
function atStairHasUpperFloor(r, mesh){
  const c=atStairCentroid(r.ring||[]);
  return ((mesh && mesh.meshFaces)||[]).some(function(f){
    if(typeof atIsFloorFace==='function' && !atIsFloorFace(f)) return false;
    const z=typeof atFaceZ==='function' ? atFaceZ(f) : 0;
    if(z<r.z+1.2 || z>r.z+4.8) return false;
    return typeof atPointInFaceXY==='function' && atPointInFaceXY(c.x, c.y, f);
  });
}
function atStairNorm(v){
  const n=Math.hypot(v.x, v.y)||1;
  return {x:v.x/n, y:v.y/n};
}
function atStairPerp(v){
  return {x:-v.y, y:v.x};
}
function atStairAdd(a,b){ return {x:a.x+b.x, y:a.y+b.y}; }
function atStairSub(a,b){ return {x:a.x-b.x, y:a.y-b.y}; }
function atStairScale(v,s){ return {x:v.x*s, y:v.y*s}; }
function atStairCopyPath(path){
  return (path||[]).map(function(p){ return {x:p.x, y:p.y}; });
}
function atStairEnsureCcw(ring){
  let a=0;
  const r=ring||[];
  for(let i=0;i<r.length;i++){
    const p=r[i], q=r[(i+1)%r.length];
    a+=p.x*q.y-q.x*p.y;
  }
  return a<0 ? r.slice().reverse() : r;
}
function atStairSegIntersect(a,b,c,d){
  const rx=b.x-a.x, ry=b.y-a.y, sx=d.x-c.x, sy=d.y-c.y;
  const den=rx*sy-ry*sx;
  if(Math.abs(den)<1e-12) return null;
  const t=((c.x-a.x)*sy-(c.y-a.y)*sx)/den;
  const u=((c.x-a.x)*ry-(c.y-a.y)*rx)/den;
  if(u<-1e-9 || u>1+1e-9) return null;
  return {x:a.x+t*rx, y:a.y+t*ry, t:t};
}
function atStairClipLineToRing(origin, dir, ring){
  const a={x:origin.x-dir.x*80, y:origin.y-dir.y*80};
  const b={x:origin.x+dir.x*80, y:origin.y+dir.y*80};
  const hits=[];
  for(let i=0;i<(ring||[]).length;i++){
    const hit=atStairSegIntersect(a, b, ring[i], ring[(i+1)%ring.length]);
    if(hit) hits.push(hit);
  }
  hits.sort(function(p,q){ return p.t-q.t; });
  const uniq=[];
  hits.forEach(function(h){
    if(!uniq.length || Math.hypot(h.x-uniq[uniq.length-1].x, h.y-uniq[uniq.length-1].y)>0.02) uniq.push(h);
  });
  if(uniq.length<2) return null;
  return [uniq[0], uniq[uniq.length-1]];
}
function atStairClosestOnRing(p, ring){
  if(!(ring||[]).length) return p;
  let best=ring[0], bestD=1e9;
  for(let i=0;i<ring.length;i++){
    const a=ring[i], b=ring[(i+1)%ring.length];
    const vx=b.x-a.x, vy=b.y-a.y;
    const len2=vx*vx+vy*vy||1e-12;
    let t=((p.x-a.x)*vx+(p.y-a.y)*vy)/len2;
    t=Math.max(0, Math.min(1, t));
    const q={x:a.x+t*vx, y:a.y+t*vy};
    const d=Math.hypot(p.x-q.x, p.y-q.y);
    if(d<bestD){ bestD=d; best=q; }
  }
  return best;
}
function atStairEditBounds(r, mesh){
  let minx=Infinity, maxx=-Infinity, miny=Infinity, maxy=-Infinity;
  function addRing(ring){
    (ring||[]).forEach(function(p){
      minx=Math.min(minx,p.x); maxx=Math.max(maxx,p.x);
      miny=Math.min(miny,p.y); maxy=Math.max(maxy,p.y);
    });
  }
  addRing(r && r.ring);
  ((mesh && mesh.rooms)||[]).forEach(function(q){
    if(!q || !r) return;
    if(q.floor===r.floor || q.floor===r.floor+1) addRing(q.ring);
  });
  if(!(maxx>=minx)) return {minx:-50, maxx:50, miny:-50, maxy:50};
  const pad=1.2;
  return {minx:minx-pad, maxx:maxx+pad, miny:miny-pad, maxy:maxy+pad};
}
function atStairClampToBounds(p, b){
  if(!p) return p;
  if(!b) return {x:p.x, y:p.y};
  return {
    x:Math.max(b.minx, Math.min(b.maxx, p.x)),
    y:Math.max(b.miny, Math.min(b.maxy, p.y))
  };
}
function atStairClampPoint(p, r, mesh){
  const m=mesh || (typeof atMesh!=='undefined' ? atMesh : null);
  return atStairClampToBounds(p, atStairEditBounds(r, m));
}
function atStairEdgeSeg(a, b){
  if(!a || !b) return null;
  const dx=Math.abs(b.x-a.x), dy=Math.abs(b.y-a.y);
  if(dx<0.08 && dy>=0.2) return {axis:'x', x:(a.x+b.x)/2, y0:Math.min(a.y,b.y), y1:Math.max(a.y,b.y)};
  if(dy<0.08 && dx>=0.2) return {axis:'y', y:(a.y+b.y)/2, x0:Math.min(a.x,b.x), x1:Math.max(a.x,b.x)};
  return null;
}
function atStairWallSegs(mesh, r, zMid){
  const segs=[];
  const z=zMid!=null ? zMid : (r && r.z);
  ((mesh && mesh.meshFaces)||[]).forEach(function(f){
    if(typeof atIsPartition==='function' && !atIsPartition(f)) return;
    const vs=f.verts||[];
    if(!vs.length) return;
    let z0=Infinity, z1=-Infinity;
    vs.forEach(function(v){ z0=Math.min(z0,v.z); z1=Math.max(z1,v.z); });
    if(z!=null && (z1<z-0.2 || z0>z+3.2)) return;
    const s=typeof atWallSeg==='function' ? atWallSeg(f) : atStairEdgeSeg(vs[0], vs[1]);
    if(s) segs.push(s);
  });
  ((mesh && mesh.rooms)||[r]).forEach(function(q){
    if(!q || !r) return;
    if(q.floor!==r.floor && q.floor!==r.floor+1) return;
    const ring=q.ring||[];
    for(let i=0;i<ring.length;i++){
      const s=atStairEdgeSeg(ring[i], ring[(i+1)%ring.length]);
      if(s) segs.push(s);
    }
  });
  return segs;
}
function atStairRayDist(o, dir, segs, cap){
  cap=cap==null ? 1.4 : cap;
  const ax=Math.abs(dir.x)>=Math.abs(dir.y) ? 'x' : 'y';
  const sign=ax==='x' ? (dir.x>=0?1:-1) : (dir.y>=0?1:-1);
  let best=null;
  (segs||[]).forEach(function(s){
    if(ax==='x' && s.axis==='x'){
      const d=(s.x-o.x)*sign;
      if(d>0.03 && d<=cap && (best==null || d<best) && o.y>=s.y0-0.04 && o.y<=s.y1+0.04) best=d;
    }
    if(ax==='y' && s.axis==='y'){
      const d=(s.y-o.y)*sign;
      if(d>0.03 && d<=cap && (best==null || d<best) && o.x>=s.x0-0.04 && o.x<=s.x1+0.04) best=d;
    }
  });
  return best;
}
function atStairSpanAt(origin, tan, segs){
  const n=atStairPerp(atStairNorm(tan));
  const inset=0.01;
  const fallback=AT_STAIR_WIDTH_MAX/2;
  function side(dir){
    const d=atStairRayDist(origin, dir, segs);
    if(d==null) return fallback;
    return Math.max(0.12, d-inset);
  }
  const a=side(n), b=side({x:-n.x, y:-n.y});
  return {
    n:n,
    a:a,
    b:b,
    width:a+b,
    left:atStairAdd(origin, atStairScale(n, a)),
    right:atStairAdd(origin, atStairScale(n, -b))
  };
}
function atStairQuad(verts){
  if(!verts || verts.length<4) return verts||[];
  return verts.slice(0,4);
}
function atStairClampToRing(p, ring, inset){
  inset=inset==null ? 0.04 : inset;
  if(typeof atPointInRing!=='function' || atPointInRing(p.x, p.y, ring||[])){
    return {x:p.x, y:p.y};
  }
  const q=atStairClosestOnRing(p, ring||[]);
  const c=atStairCentroid(ring||[]);
  const v=atStairSub(c, q);
  const n=atStairNorm({x:v.x||0.01, y:v.y||0});
  const inside={x:q.x+n.x*inset, y:q.y+n.y*inset};
  if(typeof atPointInRing==='function' && !atPointInRing(inside.x, inside.y, ring||[])) return q;
  return inside;
}
function atStairAxisDir(dir){
  const d=dir||{x:1, y:0};
  if(Math.abs(d.x)>=Math.abs(d.y)) return {x:d.x>=0?1:-1, y:0};
  return {x:0, y:d.y>=0?1:-1};
}
function atStairSegAxis(a, b){
  return Math.abs((b.x-a.x))>=Math.abs((b.y-a.y)) ? 'h' : 'v';
}
function atStairSnapToAxis(prev, p){
  if(!prev || !p) return p;
  if(Math.abs(p.x-prev.x)>=Math.abs(p.y-prev.y)) return {x:p.x, y:prev.y};
  return {x:prev.x, y:p.y};
}
function atStairMakeOrtho(path){
  const src=atStairCopyPath(path);
  if(src.length<2) return src;
  const out=[src[0]];
  for(let i=1;i<src.length;i++) out.push(atStairSnapToAxis(out[i-1], src[i]));
  return out;
}
function atStairSeedPath(r){
  const ring=r.ring||[];
  if(ring.length<3) return [];
  let bestLen=0, dir={x:1, y:0};
  for(let i=0;i<ring.length;i++){
    const a=ring[i], b=ring[(i+1)%ring.length];
    const d={x:b.x-a.x, y:b.y-a.y};
    const len=Math.hypot(d.x, d.y);
    if(len>bestLen){ bestLen=len; dir=d; }
  }
  dir=atStairAxisDir(dir);
  const c=atStairCentroid(ring);
  const hits=atStairClipLineToRing(c, dir, ring);
  let a, b;
  if(hits){
    a=hits[0]; b=hits[1];
  }else{
    const bb=atRingBBox(ring);
    if(bb.dx>=bb.dy){
      a={x:bb.minx, y:c.y}; b={x:bb.maxx, y:c.y};
    }else{
      a={x:c.x, y:bb.miny}; b={x:c.x, y:bb.maxy};
    }
  }
  const t=atStairAxisDir(atStairSub(b, a));
  const inset=0.10;
  a={x:a.x+t.x*inset, y:a.y+t.y*inset};
  b={x:b.x-t.x*inset, y:b.y-t.y*inset};
  return atStairMakeOrtho([atStairClampToRing(a, ring), atStairClampToRing(b, ring)]);
}
function atStairPathLen(path){
  let s=0;
  for(let i=1;i<(path||[]).length;i++) s+=Math.hypot(path[i].x-path[i-1].x, path[i].y-path[i-1].y);
  return s;
}
function atStairCum(path){
  const c=[0];
  for(let i=1;i<(path||[]).length;i++) c.push(c[i-1]+Math.hypot(path[i].x-path[i-1].x, path[i].y-path[i-1].y));
  return c;
}
function atStairPointAt(path, s){
  if(!(path||[]).length) return {x:0, y:0};
  if(path.length===1) return {x:path[0].x, y:path[0].y};
  const total=atStairPathLen(path);
  let u=Math.max(0, Math.min(total, s));
  for(let i=1;i<path.length;i++){
    const d=Math.hypot(path[i].x-path[i-1].x, path[i].y-path[i-1].y);
    if(u<=d || i===path.length-1){
      const t=d<1e-9 ? 0 : Math.max(0, Math.min(1, u/d));
      return {x:path[i-1].x+(path[i].x-path[i-1].x)*t, y:path[i-1].y+(path[i].y-path[i-1].y)*t};
    }
    u-=d;
  }
  return {x:path[path.length-1].x, y:path[path.length-1].y};
}
function atStairTangentAt(path, s){
  if(!(path||[]).length || path.length<2) return {x:1, y:0};
  const total=atStairPathLen(path);
  let u=Math.max(0, Math.min(total, s));
  for(let i=1;i<path.length;i++){
    const d=Math.hypot(path[i].x-path[i-1].x, path[i].y-path[i-1].y);
    if(u<=d+1e-9 || i===path.length-1){
      if(d<1e-9) continue;
      return atStairNorm({x:path[i].x-path[i-1].x, y:path[i].y-path[i-1].y});
    }
    u-=d;
  }
  const n=path.length;
  return atStairNorm({x:path[n-1].x-path[n-2].x, y:path[n-1].y-path[n-2].y});
}
function atStairLandingRect(c, tin, tout, halfW){
  const a=atStairNorm(tin), b=atStairNorm(tout);
  return atStairEnsureCcw([
    atStairAdd(c, atStairAdd(atStairScale(a, -halfW), atStairScale(b, -halfW))),
    atStairAdd(c, atStairAdd(atStairScale(a, halfW), atStairScale(b, -halfW))),
    atStairAdd(c, atStairAdd(atStairScale(a, halfW), atStairScale(b, halfW))),
    atStairAdd(c, atStairAdd(atStairScale(a, -halfW), atStairScale(b, halfW)))
  ]);
}
function atStairIsRightAngle(a, b){
  return Math.abs(a.x*b.x + a.y*b.y) < 0.25;
}
function atStairRect(center, tan, halfLen, halfW){
  const t=atStairNorm(tan);
  const n=atStairPerp(t);
  return atStairEnsureCcw([
    atStairAdd(center, atStairAdd(atStairScale(t, halfLen), atStairScale(n, halfW))),
    atStairAdd(center, atStairAdd(atStairScale(t, halfLen), atStairScale(n, -halfW))),
    atStairAdd(center, atStairAdd(atStairScale(t, -halfLen), atStairScale(n, -halfW))),
    atStairAdd(center, atStairAdd(atStairScale(t, -halfLen), atStairScale(n, halfW)))
  ]);
}
function atStairRingInside(ring, host){
  return (ring||[]).every(function(p){
    return typeof atPointInRing!=='function' || atPointInRing(p.x, p.y, host||[]);
  });
}
function atStairFitWidth(makeRing, host, halfW){
  let w=halfW;
  for(let k=0;k<12;k++){
    const ring=makeRing(w);
    if(atStairRingInside(ring, host)) return ring;
    w*=0.82;
    if(w<0.12) return ring;
  }
  return makeRing(halfW);
}
function atStairWidth(r){
  const b=typeof atRingBBox==='function' ? atRingBBox(r.ring||[]) : {dx:0.8, dy:0.8};
  return Math.max(0.35, Math.min(AT_STAIR_WIDTH_MAX, Math.min(b.dx, b.dy)*0.92));
}
function atStairAddSpanWalls(xs, ys, sp){
  if(!sp) return;
  if(Math.abs(sp.n.x)>0.5){
    xs.push(sp.left.x, sp.right.x);
  }else{
    ys.push(sp.left.y, sp.right.y);
  }
}
function atStairLandingAabb(path, cum, i, segs){
  const tin=atStairNorm({x:path[i].x-path[i-1].x, y:path[i].y-path[i-1].y});
  const tout=atStairNorm({x:path[i+1].x-path[i].x, y:path[i+1].y-path[i].y});
  if(!atStairIsRightAngle(tin, tout)) return null;
  const prev=cum[i]-cum[i-1], next=cum[i+1]-cum[i];
  const inset=Math.min(0.14, prev*0.4, next*0.4);
  if(!(inset>0.02)) return null;
  const spanIn=atStairSpanAt(atStairPointAt(path, cum[i]-inset), tin, segs);
  const spanOut=atStairSpanAt(atStairPointAt(path, cum[i]+inset), tout, segs);
  const c=path[i];
  const xs=[c.x], ys=[c.y];
  atStairAddSpanWalls(xs, ys, spanIn);
  atStairAddSpanWalls(xs, ys, spanOut);
  const minx=Math.min.apply(null, xs), maxx=Math.max.apply(null, xs);
  const miny=Math.min.apply(null, ys), maxy=Math.max.apply(null, ys);
  if(!(maxx-minx>0.16) || !(maxy-miny>0.16)) return null;
  let s0=cum[i], s1=cum[i];
  if(Math.abs(tin.x)>0.5) s0=cum[i]-Math.abs(c.x-(tin.x>0?minx:maxx));
  else s0=cum[i]-Math.abs(c.y-(tin.y>0?miny:maxy));
  if(Math.abs(tout.x)>0.5) s1=cum[i]+Math.abs((tout.x>0?maxx:minx)-c.x);
  else s1=cum[i]+Math.abs((tout.y>0?maxy:miny)-c.y);
  s0=Math.max(cum[i-1]+0.04, Math.min(cum[i]-0.08, s0));
  s1=Math.min(cum[i+1]-0.04, Math.max(cum[i]+0.08, s1));
  if(!(s1-s0>0.12)) return null;
  return {
    s0:s0, s1:s1, s:cum[i], i:i, tin:tin, tout:tout,
    minx:minx, maxx:maxx, miny:miny, maxy:maxy
  };
}
function atStairMergeLandings(zones){
  const src=(zones||[]).slice().sort(function(a,b){ return a.s-b.s; });
  const out=[];
  src.forEach(function(z){
    const last=out[out.length-1];
    const overlap=last && z.s0<=last.s1+0.06;
    const boxHit=last && z.minx<=last.maxx+0.04 && z.maxx>=last.minx-0.04
      && z.miny<=last.maxy+0.04 && z.maxy>=last.miny-0.04;
    if(last && (overlap || boxHit)){
      last.s0=Math.min(last.s0, z.s0);
      last.s1=Math.max(last.s1, z.s1);
      last.s=(last.s0+last.s1)/2;
      last.minx=Math.min(last.minx, z.minx);
      last.maxx=Math.max(last.maxx, z.maxx);
      last.miny=Math.min(last.miny, z.miny);
      last.maxy=Math.max(last.maxy, z.maxy);
      last.tout=z.tout||last.tout;
    }else out.push({
      s0:z.s0, s1:z.s1, s:z.s, i:z.i, tin:z.tin, tout:z.tout,
      minx:z.minx, maxx:z.maxx, miny:z.miny, maxy:z.maxy
    });
  });
  return out;
}
function atStairGrowLandingToRing(z, ring, alongIn){
  if(!z || !(ring||[]).length) return;
  const xs=ring.map(function(p){ return p.x; });
  const ys=ring.map(function(p){ return p.y; });
  const minx=Math.min.apply(null, xs), maxx=Math.max.apply(null, xs);
  const miny=Math.min.apply(null, ys), maxy=Math.max.apply(null, ys);
  const t=alongIn ? z.tin : z.tout;
  if(!t){
    z.minx=Math.min(z.minx, minx); z.maxx=Math.max(z.maxx, maxx);
    z.miny=Math.min(z.miny, miny); z.maxy=Math.max(z.maxy, maxy);
    return;
  }
  if(alongIn){
    if(Math.abs(t.x)>0.5){
      if(t.x>0) z.minx=Math.min(z.minx, maxx);
      else z.maxx=Math.max(z.maxx, minx);
    }else{
      if(t.y>0) z.miny=Math.min(z.miny, maxy);
      else z.maxy=Math.max(z.maxy, miny);
    }
  }else{
    if(Math.abs(t.x)>0.5){
      if(t.x>0) z.maxx=Math.max(z.maxx, minx);
      else z.minx=Math.min(z.minx, maxx);
    }else{
      if(t.y>0) z.maxy=Math.max(z.maxy, miny);
      else z.miny=Math.min(z.miny, maxy);
    }
  }
}
function atStairLandingRing(z){
  return atStairEnsureCcw([
    {x:z.minx, y:z.miny}, {x:z.maxx, y:z.miny},
    {x:z.maxx, y:z.maxy}, {x:z.minx, y:z.maxy}
  ]);
}
function atStairFromPath(r, mesh){
  const path=atStairMakeOrtho(atStairCopyPath(r.stairPath).map(function(p){
    return atStairClampPoint(p, r, mesh);
  }));
  r.stairPath=atStairCopyPath(path);
  if(path.length<2) return null;
  const fromZ=r.z;
  const toZ=atStairNextFloorZ(r, (mesh && mesh.rooms)||[], mesh);
  const rise=toZ-fromZ;
  if(!(rise>0.45)) return null;
  const pathLen=atStairPathLen(path);
  if(!(pathLen>0.2)) return null;
  const nRisers=Math.max(2, Math.ceil(rise/AT_STAIR_RISE));
  const riser=rise/nRisers;
  const going=pathLen/nRisers;
  let note='';
  if(going<AT_STAIR_GOING_MIN){
    note='中心線が短すぎます。線を延ばすか折れを足してください。';
  }
  if(typeof atStairHasUpperFloor==='function' && atStairHasUpperFloor(r, mesh)){
    note=(note?note+' ':'')+'上階に床があります。階段下へ線を延ばし、2F床まで隙間なく接続してください。';
  }
  const segs=atStairWallSegs(mesh, r, fromZ+rise*0.4);
  const cum=atStairCum(path);
  const rawLand=[];
  for(let i=1;i<path.length-1;i++){
    const z=atStairLandingAabb(path, cum, i, segs);
    if(z) rawLand.push(z);
  }
  const landZones=atStairMergeLandings(rawLand);
  function xyRing(spanA, spanB){
    return atStairEnsureCcw([
      {x:spanA.left.x, y:spanA.left.y},
      {x:spanA.right.x, y:spanA.right.y},
      {x:spanB.right.x, y:spanB.right.y},
      {x:spanB.left.x, y:spanB.left.y}
    ]);
  }
  const flights=[];
  let cursor=0;
  landZones.forEach(function(z){
    if(z.s0-cursor>0.06) flights.push({s0:cursor, s1:z.s0, landAfter:z});
    cursor=z.s1;
  });
  if(pathLen-cursor>0.06) flights.push({s0:cursor, s1:pathLen, landAfter:null});
  const flightLen=flights.reduce(function(s,f){ return s+(f.s1-f.s0); },0)||pathLen;
  let left=nRisers;
  flights.forEach(function(f, i){
    const n=i===flights.length-1 ? left : Math.max(1, Math.round(nRisers*(f.s1-f.s0)/flightLen));
    f.n=Math.max(i===flights.length-1?left:1, Math.min(left, n));
    left-=f.n;
  });
  if(left>0 && flights.length) flights[flights.length-1].n+=left;
  const treads=[];
  const risers=[];
  const panels=[];
  let done=0;
  flights.forEach(function(f, fi){
    const n=Math.max(1, f.n||1);
    const goingF=(f.s1-f.s0)/n;
    for(let i=0;i<n;i++){
      const s0=f.s0+i*goingF, s1=f.s0+(i+1)*goingF, mid=(s0+s1)/2;
      const z0=fromZ+done*riser;
      const z1=(fi===flights.length-1 && i===n-1) ? toZ : fromZ+(done+1)*riser;
      const p0=atStairPointAt(path, s0), p1=atStairPointAt(path, s1);
      const tan=atStairTangentAt(path, mid);
      const sp0=atStairSpanAt(p0, tan, segs);
      const sp1=atStairSpanAt(p1, tan, segs);
      const rv=[
        {x:sp0.left.x, y:sp0.left.y, z:z0},
        {x:sp0.right.x, y:sp0.right.y, z:z0},
        {x:sp0.right.x, y:sp0.right.y, z:z1},
        {x:sp0.left.x, y:sp0.left.y, z:z1}
      ];
      risers.push({verts:rv, s:s0, z0:z0, z1:z1, tangent:tan, kind:'riser'});
      panels.push({kind:'riser', verts:rv});
      const ring=xyRing(sp0, sp1);
      treads.push({ring:ring, z:z1, zTop:z1, s:mid, tangent:tan, kind:'tread', s0:s0, s1:s1});
      panels.push({kind:'tread', verts:ring.map(function(p){ return {x:p.x, y:p.y, z:z1}; })});
      done++;
    }
    if(f.landAfter){
      const last=treads[treads.length-1];
      if(last) atStairGrowLandingToRing(f.landAfter, last.ring, true);
    }
  });
  landZones.forEach(function(z){
    const after=treads.find(function(t){ return t.kind==='tread' && t.s>=z.s1-1e-6; });
    if(after) atStairGrowLandingToRing(z, after.ring, false);
    const incoming=treads.filter(function(t){ return t.kind==='tread' && t.s1!=null && t.s1<=z.s0+1e-4; });
    const zTop=incoming.length ? incoming[incoming.length-1].zTop : fromZ;
    const ring=atStairLandingRing(z);
    treads.push({ring:ring, z:zTop, zTop:zTop, s:z.s, tangent:atStairNorm(atStairAdd(z.tin||{x:1,y:0}, z.tout||{x:0,y:1})), kind:'landing'});
    panels.push({kind:'landing', verts:ring.map(function(p){ return {x:p.x, y:p.y, z:zTop}; })});
  });
  treads.sort(function(a,b){ return a.s-b.s; });
  return {
    fromZ:fromZ, toZ:toZ, path:path, treads:treads, risers:risers, panels:panels,
    runLine:path, note:note, nRisers:nRisers, riser:riser, going:going, landings:landZones
  };
}
function atPlanStairsForMesh(mesh){
  if(!mesh) return;
  (mesh.rooms||[]).forEach(function(r){
    if(!atIsStairRoom(r)){ r.stair=null; return; }
    if(!r.stairPathEdited || !r.stairPath || r.stairPath.length<2){
      r.stairPath=atStairSeedPath(r);
    }
    r.stair=atStairFromPath(r, mesh);
  });
}
function atStairRebuildRoom(r, mesh){
  if(!r) return;
  const m=mesh || (typeof atMesh!=='undefined' ? atMesh : null);
  if(!atIsStairRoom(r)){ r.stair=null; return; }
  if(!r.stairPath || r.stairPath.length<2) r.stairPath=atStairSeedPath(r);
  r.stair=atStairFromPath(r, m);
}
function atStairFlipPath(r){
  if(!r || !r.stairPath || r.stairPath.length<2) return;
  r.stairPath=atStairCopyPath(r.stairPath).reverse();
  r.stairPathEdited=true;
  atStairRebuildRoom(r);
}
function atStairAddCorner(r){
  if(!r || !r.stairPath || r.stairPath.length<2) return;
  let best=0, at=0;
  for(let i=1;i<r.stairPath.length;i++){
    const d=Math.hypot(r.stairPath[i].x-r.stairPath[i-1].x, r.stairPath[i].y-r.stairPath[i-1].y);
    if(d>best){ best=d; at=i; }
  }
  if(!at) return;
  const a=r.stairPath[at-1], b=r.stairPath[at];
  const mid=atStairClampPoint(atStairSnapToAxis(a, {x:(a.x+b.x)/2, y:(a.y+b.y)/2}), r);
  r.stairPath.splice(at, 0, mid);
  r.stairPath=atStairMakeOrtho(r.stairPath);
  r.stairPathEdited=true;
  atStairRebuildRoom(r);
}
function atStairInsertAt(r, p){
  if(!r || !r.stairPath || r.stairPath.length<2 || !p) return;
  const path=r.stairPath;
  let bestI=1, bestQ=path[0], bestD=1e9;
  for(let i=1;i<path.length;i++){
    const a=path[i-1], b=path[i];
    const vx=b.x-a.x, vy=b.y-a.y;
    const len2=vx*vx+vy*vy||1e-12;
    let t=((p.x-a.x)*vx+(p.y-a.y)*vy)/len2;
    t=Math.max(0, Math.min(1, t));
    const q={x:a.x+t*vx, y:a.y+t*vy};
    const d=Math.hypot(p.x-q.x, p.y-q.y);
    if(d<bestD){ bestD=d; bestQ=q; bestI=i; }
  }
  const near=path.some(function(v){ return Math.hypot(v.x-bestQ.x, v.y-bestQ.y)<0.08; });
  if(near) return;
  r.stairPath.splice(bestI, 0, atStairClampPoint(bestQ, r));
  r.stairPath=atStairMakeOrtho(r.stairPath);
  r.stairPathEdited=true;
  atStairRebuildRoom(r);
}
function atStairResetPath(r){
  if(!r) return;
  r.stairPath=atStairSeedPath(r);
  r.stairPathEdited=false;
  atStairRebuildRoom(r);
}
function atStairMoveVertex(r, index, p){
  if(!r || !r.stairPath || !r.stairPath[index] || !p) return;
  const path=r.stairPath;
  const n=path.length;
  const axes=[];
  for(let i=1;i<n;i++) axes.push(atStairSegAxis(path[i-1], path[i]));
  p=atStairClampPoint(p, r);
  if(index===0 && n>=2){
    path[0]=atStairSnapToAxis(path[1], p);
  }else if(index===n-1 && n>=2){
    path[n-1]=atStairSnapToAxis(path[n-2], p);
  }else{
    path[index]=p;
    for(let i=index;i>0;i--){
      if(axes[i-1]==='h') path[i-1].y=path[i].y;
      else path[i-1].x=path[i].x;
    }
    for(let i=index;i<n-1;i++){
      if(axes[i]==='h') path[i+1].y=path[i].y;
      else path[i+1].x=path[i].x;
    }
  }
  for(let i=0;i<path.length;i++) path[i]=atStairClampPoint(path[i], r);
  r.stairPath=atStairMakeOrtho(path);
  r.stairPathEdited=true;
  atStairRebuildRoom(r);
}

if(typeof module!=='undefined' && module.exports){
  module.exports={
    atIsStairRoom:atIsStairRoom,
    atStairHasUpperFloor:atStairHasUpperFloor,
    atStairSeedPath:atStairSeedPath,
    atStairFromPath:atStairFromPath,
    atPlanStairsForMesh:atPlanStairsForMesh,
    atStairFlipPath:atStairFlipPath,
    atStairAddCorner:atStairAddCorner,
    atStairInsertAt:atStairInsertAt,
    atStairResetPath:atStairResetPath,
    atStairMoveVertex:atStairMoveVertex,
    atStairMakeOrtho:atStairMakeOrtho
  };
}

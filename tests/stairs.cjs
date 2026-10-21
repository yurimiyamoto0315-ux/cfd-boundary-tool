// Geometry-only checks for stair centerlines. Does not load the full tool.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

function atRingBBox(ring){
  let minx=Infinity, maxx=-Infinity, miny=Infinity, maxy=-Infinity;
  (ring||[]).forEach(function(v){
    minx=Math.min(minx,v.x); maxx=Math.max(maxx,v.x);
    miny=Math.min(miny,v.y); maxy=Math.max(maxy,v.y);
  });
  return {minx:minx, maxx:maxx, miny:miny, maxy:maxy, dx:maxx-minx, dy:maxy-miny};
}
function atPointInRing(x, y, ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i].x, yi=ring[i].y, xj=ring[j].x, yj=ring[j].y;
    if(((yi>y)!==(yj>y)) && (x<(xj-xi)*(y-yi)/((yj-yi)||1e-20)+xi)) inside=!inside;
  }
  return inside;
}
function atFaceZ(f){
  const vs=f.verts||[];
  if(!vs.length) return 0;
  return vs.reduce(function(s,v){ return s+v.z; },0)/vs.length;
}
function atIsFloorFace(f){
  return !!(f && (f.sslKey==='floor1' || f.sslKey==='floor_out' || f.nameJa==='内床' || f.nameJa==='2F床'));
}
function atPointInFaceXY(x, y, f){
  const vs=f.verts||[];
  let minx=Infinity, maxx=-Infinity, miny=Infinity, maxy=-Infinity;
  vs.forEach(function(v){
    minx=Math.min(minx,v.x); maxx=Math.max(maxx,v.x);
    miny=Math.min(miny,v.y); maxy=Math.max(maxy,v.y);
  });
  return x>=minx-1e-4 && x<=maxx+1e-4 && y>=miny-1e-4 && y<=maxy+1e-4;
}

const ctx={atRingBBox, atPointInRing, atFaceZ, atIsFloorFace, atPointInFaceXY, module:{exports:{}}, console};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/19-at-stairs.js'),'utf8'), ctx);

function rect(x0,y0,x1,y1){ return [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]; }
function Lring(){
  return [{x:0,y:0},{x:2.4,y:0},{x:2.4,y:2.4},{x:1.4,y:2.4},{x:1.4,y:1.0},{x:0,y:1.0}];
}
const upper={name:'洋室', floor:2, z:2.84, ring:rect(8,8,12,12)};
const straight={name:'階段', floor:1, z:0, zTop:2.84, ring:rect(0,0,1.1,3.4),
  stairPath:[{x:0.55,y:0.25},{x:0.55,y:3.15}], stairPathEdited:true};
const L={name:'階段', floor:1, z:0, zTop:2.84, ring:Lring(),
  stairPath:[{x:0.5,y:0.5},{x:1.85,y:0.5},{x:1.85,y:1.9}], stairPathEdited:true};
const covered={name:'階段', floor:1, z:0, zTop:2.84, ring:rect(0,0,2,1.2),
  stairPath:[{x:0.3,y:0.6},{x:1.7,y:0.6}], stairPathEdited:true};
const coverFace={sslKey:'floor1', nameJa:'内床', verts:[{x:0,y:0,z:2.9},{x:2,y:0,z:2.9},{x:2,y:1.2,z:2.9},{x:0,y:1.2,z:2.9}]};
const U={name:'階段', floor:1, z:0, zTop:2.84, ring:rect(0,0,2.2,3.4),
  stairPath:[{x:0.45,y:0.3},{x:0.45,y:2.85},{x:1.75,y:2.85},{x:1.75,y:0.3}], stairPathEdited:true};

function aabbGap(a, b){
  const A=atRingBBox(a), B=atRingBBox(b);
  const gx=A.maxx<B.minx ? B.minx-A.maxx : (B.maxx<A.minx ? A.minx-B.maxx : 0);
  const gy=A.maxy<B.miny ? B.miny-A.maxy : (B.maxy<A.miny ? A.miny-B.maxy : 0);
  return Math.hypot(gx, gy);
}
function assertLandingFlush(stair){
  const landing=stair.treads.find(t=>t.kind==='landing');
  assert.ok(landing, 'missing landing');
  const treads=stair.treads.filter(t=>t.kind==='tread').sort((a,b)=>a.s-b.s);
  const before=treads.filter(t=>t.s<landing.s).pop();
  const after=treads.find(t=>t.s>landing.s);
  assert.ok(before && after, 'missing treads around landing');
  assert.ok(aabbGap(before.ring, landing.ring)<0.03, 'incoming gap '+aabbGap(before.ring, landing.ring));
  assert.ok(aabbGap(after.ring, landing.ring)<0.03, 'outgoing gap '+aabbGap(after.ring, landing.ring));
}

ctx.atPlanStairsForMesh({rooms:[straight, upper], meshFaces:[]});
ctx.atPlanStairsForMesh({rooms:[L, upper], meshFaces:[]});
ctx.atPlanStairsForMesh({rooms:[covered], meshFaces:[coverFace]});

const zs=straight.stair.treads.map(t=>t.zTop);
assert.ok(zs.length>=8);
assert.ok(zs.every((z,i)=>i===0||z>=zs[i-1]-1e-9));
assert.ok(straight.stair.going>=0.15);
assert.ok(Math.abs(zs[zs.length-1]-straight.stair.toZ)<1e-6);
assert.ok((straight.stair.risers||[]).length>=8);
assert.ok((straight.stair.panels||[]).some(p=>p.kind==='riser'));
assert.ok((straight.stair.panels||[]).some(p=>p.kind==='tread'));
straight.stair.panels.filter(p=>p.kind==='tread' || p.kind==='landing').forEach(function(p){
  const pz=(p.verts||[]).map(v=>v.z);
  assert.ok(Math.max.apply(null,pz)-Math.min.apply(null,pz)<1e-8);
});
const treadW=atRingBBox(straight.stair.treads[0].ring);
assert.ok(treadW.dx>0.95 && treadW.dx<1.12);

const cornerS=1.85-0.5;
const before=L.stair.treads.find(t=>t.kind!=='landing' && t.s<cornerS-0.05);
const after=L.stair.treads.find(t=>t.kind!=='landing' && t.s>cornerS+0.05);
assert.ok(before && after);
assert.ok(Math.abs(before.tangent.x)>0.7 && Math.abs(before.tangent.y)<0.4);
assert.ok(Math.abs(after.tangent.y)>0.7 && Math.abs(after.tangent.x)<0.4);
assert.ok(L.stair.treads.every(t=>(t.ring||[]).every(p=>atPointInRing(p.x,p.y,L.ring))));
const landing=L.stair.treads.find(t=>t.kind==='landing');
assert.ok(landing && landing.ring.length===4);
const xs=[...new Set(landing.ring.map(p=>p.x.toFixed(4)))];
const ys=[...new Set(landing.ring.map(p=>p.y.toFixed(4)))];
assert.equal(xs.length, 2);
assert.equal(ys.length, 2);
assertLandingFlush(L.stair);

ctx.atPlanStairsForMesh({rooms:[U, upper], meshFaces:[]});
assert.ok(U.stair.treads.some(t=>t.kind==='landing'));
assertLandingFlush(U.stair);
assert.ok(U.stair.treads.filter(t=>t.kind==='landing').length<=2);

const moved={name:'階段', floor:1, z:0, zTop:2.84, ring:rect(0,0,3,3),
  stairPath:[{x:0.4,y:0.4},{x:1.4,y:0.4},{x:2.4,y:0.4}], stairPathEdited:true};
ctx.atStairMoveVertex(moved, 2, {x:1.4, y:2.2});
assert.equal(moved.stairPath.length, 3);
assert.ok(Math.abs(moved.stairPath[1].x-moved.stairPath[2].x)<1e-6);
assert.ok(Math.abs(moved.stairPath[0].y-moved.stairPath[1].y)<1e-6);
assert.ok(moved.stairPath[2].y>1);

const split={name:'階段', floor:1, z:0, zTop:2.84, ring:rect(0,0,3,3),
  stairPath:[{x:0.4,y:1},{x:2.6,y:1}], stairPathEdited:true};
ctx.atStairInsertAt(split, {x:1.5, y:1.02});
assert.equal(split.stairPath.length, 3);
assert.ok(Math.abs(split.stairPath[1].y-1)<0.05);

assert.equal(ctx.atStairHasUpperFloor(covered, {meshFaces:[coverFace]}), true);
assert.ok(covered.stair);
assert.ok(Math.abs(covered.stair.treads[covered.stair.treads.length-1].zTop-covered.stair.toZ)<1e-6);

const free={name:'階段', floor:1, z:0, zTop:2.84, ring:rect(0,0,1.1,2.0),
  stairPath:[{x:0.55,y:0.2},{x:0.55,y:3.1}], stairPathEdited:true};
const store={name:'階段下', floor:1, z:0, zTop:2.84, ring:rect(0,2.0,1.1,3.4)};
ctx.atPlanStairsForMesh({rooms:[free, store, upper], meshFaces:[]});
assert.ok(Math.abs(free.stairPath[1].y-3.1)<0.05);
assert.ok(free.stair.treads.some(t=>(t.ring||[]).some(p=>p.y>2.0)));

console.log('PASS: stair centerline geometry (straight, L, covered still plans, free path, wall-span panels, ortho drag)');

// Synthetic geometry regression; an optional IDF path exercises the reported model.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ctx={console};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/12-energyplus.js'),'utf8'),ctx);
let checks=0;
const near=(a,b,label,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${label}: ${a} != ${b}`);
function transform(faces,deg=0,dx=0,dy=0,dz=0){
  const r=deg*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  return faces.map(f=>({...f,verts:f.verts.map(v=>({x:v.x*c+v.y*s+dx,y:-v.x*s+v.y*c+dy,z:v.z+dz}))}));
}
function prism(ring,height=2.4){
  const b=ring.map(([x,y])=>({x,y,z:0}));
  const t=b.map(v=>({...v,z:typeof height==='function'?height(v.x,v.y):height}));
  return [{verts:b.slice().reverse()},{verts:t},...b.map((v,i)=>({verts:[v,b[(i+1)%b.length],t[(i+1)%b.length],t[i]]}))];
}
const box=(w,d=2,h=2.4)=>prism([[0,0],[w,0],[w,d],[0,d]],h);
function measures(prisms){
  let area=0,volume=0;
  for(const p of prisms){
    let a=0,v=0;
    const b=p.bot,o=b[0];
    for(let i=1;i<b.length-1;i++){
      const cross=(b[i].x-o.x)*(b[i+1].y-o.y)-(b[i].y-o.y)*(b[i+1].x-o.x);
      a+=cross/2;
      v+=cross*((p.top[0].z-o.z)+(p.top[i].z-b[i].z)+(p.top[i+1].z-b[i+1].z))/6;
    }
    area+=Math.abs(a);volume+=Math.abs(v);
  }
  return {area,volume};
}
for(const width of [.8,.85,1,1.2,1.5,2,3]){
  for(const deg of [0,10,22.5,45]){
    for(const setback of [.3,.1]){
      const input=transform(box(width),deg),copy=JSON.stringify(input);
      const gains=ctx.epGainPrismsForZone(input,setback);
      const label=`box ${width} m, ${deg} degrees, setback ${setback}`;
      assert.equal(gains.length,1,label);
      const m=measures(gains),expectedArea=(width-2*setback)*(2-2*setback);
      near(m.area,expectedArea,label+' area');
      near(m.volume,expectedArea*(2.4-2*setback),label+' volume');
      const r=deg*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
      for(const p of gains)for(const point of p.bot.concat(p.top)){
        const x=point.x*c-point.y*s,y=point.x*s+point.y*c;
        assert.ok(x>=setback-1e-7&&x<=width-setback+1e-7,label+' wall x clearance');
        assert.ok(y>=setback-1e-7&&y<=2-setback+1e-7,label+' wall y clearance');
        assert.ok(point.z>=setback-1e-7&&point.z<=2.4-setback+1e-7,label+' vertical clearance');
      }
      assert.equal(JSON.stringify(input),copy,'input vertices remain unchanged');
      checks++;
    }
  }
}
// A rigid world placement must preserve count, area and volume, including concave rooms.
const lShape=prism([[0,0],[4,0],[4,1.5],[1.5,1.5],[1.5,4],[0,4]]);
const triangulated=box(.8),floor=triangulated[0].verts;
triangulated.splice(0,1,{verts:[floor[0],floor[1],floor[2]]},{verts:[floor[0],floor[2],floor[3]]});
const splitRoof=prism([[0,0],[2,0],[4,0],[4,3],[2,3],[0,3]],x=>3+.25*Math.min(x,4-x));
splitRoof.splice(1,1,
  {verts:[[0,0,3],[2,0,3.5],[2,3,3.5],[0,3,3]].map(([x,y,z])=>({x,y,z}))},
  {verts:[[2,0,3.5],[4,0,3],[4,3,3],[2,3,3.5]].map(([x,y,z])=>({x,y,z}))});
for(const fixture of [box(.8),triangulated,triangulated.slice().reverse(),lShape,splitRoof])for(const setback of [.3,.1]){
  const base=ctx.epGainPrismsForZone(fixture,setback),expected=measures(base);
  assert.ok(base.length>0,'reference geometry has a gain volume');
  for(const deg of [-157,12.345,90,179.75,337.5]){
    const moved=transform(fixture,deg,123.456,-78.9,5.3);
    // Change the cyclic starting vertex without changing surface orientation.
    moved.forEach(f=>f.verts.push(f.verts.shift()));
    const gains=ctx.epGainPrismsForZone(moved,setback),actual=measures(gains);
    assert.equal(gains.length,base.length,'rigid placement preserves prism count');
    near(actual.area,expected.area,'rigid placement preserves area');
    near(actual.volume,expected.volume,'rigid placement preserves volume');
    checks++;
  }
}
for(const fixture of [box(.5),box(2,2,.5)]){
  for(const deg of [0,22.5,45]){
    assert.equal(ctx.epGainPrismsForZone(transform(fixture,deg),.3).length,0,'an actual collapsed inset stays empty');
    checks++;
  }
}
assert.equal(ctx.epGainPrismsForZone([], .3).length,0,'missing floors stay empty');checks++;

function syntheticIdf(faces,coord='Relative',north=0,zoneNorth=0,origin=[0,0,0]){
  const objects=[['Building','SYNTHETIC',north],['GlobalGeometryRules','UpperLeftCorner','CounterClockWise',coord],
    ['Material:NoMass','M','Rough',1],['Construction','C','M'],
    ['Zone','SYNTHETIC_ROOM',zoneNorth,...origin,1,1,2.4,3.84,1.6]];
  faces.forEach((face,i)=>objects.push(['BuildingSurface:Detailed','FACE_'+i,i===0?'Floor':i===1?'Ceiling':'Wall','C','SYNTHETIC_ROOM',i===0?'Ground':'Outdoors','','NoSun','NoWind',0,face.verts.length,...face.verts.flatMap(v=>[v.x,v.y,v.z])]));
  return objects.map(fields=>fields.join(',')+';').join('\n');
}
const north=337.5,zoneNorth=12.5,origin=[14,-21,3];
const relative=ctx.parseEnergyPlusIdf(syntheticIdf(box(.8),'Relative',north,zoneNorth,origin));
const world=ctx.parseEnergyPlusIdf(syntheticIdf(transform(box(.8),north+zoneNorth,...origin),'World',north,zoneNorth,origin));
for(const parsed of [relative,world]){
  assert.equal(parsed.habitable.length,1);
  assert.equal(parsed.gainVolumes.length,1,'both relative and already-world IDFs retain a narrow room');
  assert.equal(parsed.gainVolumes[0].setback,.3,'no reduced-setback fallback is needed');
  near(measures(parsed.gainVolumes[0].prisms).area,.28,'IDF narrow-room inset area');
  assert.ok(!parsed.warnings.some(w=>/セットバックできる床|発生ボリュームを作れません/.test(w)));
  checks++;
}
near(measures(relative.gainVolumes[0].prisms).volume,measures(world.gainVolumes[0].prisms).volume,'relative and world geometry agree');

if(process.argv[2]){
  const parsed=ctx.parseEnergyPlusIdf(fs.readFileSync(process.argv[2],'utf8'));
  const actual=new Set(parsed.gainVolumes.map(v=>v.zone));
  assert.equal(parsed.habitable.length,15,'reported model has fifteen habitable zones');
  assert.equal(actual.size,15,'all fifteen rooms retain gain volumes');
  for(const zone of parsed.habitable)assert.ok(actual.has(zone.name),'gain volume for '+zone.name);
  assert.ok(parsed.gainVolumes.every(v=>v.setback===.3),'reported model retains the default setback');
  assert.ok(!parsed.warnings.some(w=>/セットバックできる床|発生ボリュームを作れません/.test(w)));
  checks++;
}
console.log(JSON.stringify({code:'PASS_EP_GAIN_ROTATION',counts:{checks,reportedCases:56}}));

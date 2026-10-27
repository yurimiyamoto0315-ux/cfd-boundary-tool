/* Pure slab openings in metre coordinates. No geometry or thickness is guessed. */
(function(root){
  'use strict';
  const EPS=1e-8,PLANE_EPS=1e-6,MAX_ROOMS=64,MAX_VERTICES=4096,MAX_PIECES=100000;
  const finite=Number.isFinite;
  function clone(value,seen){
    if(!value||typeof value!=='object')return value;
    seen=seen||new WeakMap();if(seen.has(value))return seen.get(value);
    const out=Array.isArray(value)?[]:{};seen.set(value,out);
    Object.keys(value).forEach(key=>{out[key]=clone(value[key],seen);});return out;
  }
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  function signedArea(ring){
    if(ring.length<3)return 0;let sum=0;const a=ring[0];
    for(let i=1;i<ring.length-1;i++)sum+=cross(a,ring[i],ring[i+1]);return sum/2;
  }
  function cleanPolygon(points){
    const out=[];
    for(const p of points)if(!out.length||distance(p,out[out.length-1])>EPS)out.push({x:p.x,y:p.y});
    if(out.length>1&&distance(out[0],out[out.length-1])<=EPS)out.pop();
    let changed=true;
    while(changed&&out.length>3){changed=false;for(let i=0;i<out.length;i++){
      const a=out[(i+out.length-1)%out.length],b=out[i],c=out[(i+1)%out.length];
      if(Math.abs(cross(a,b,c))<=EPS*Math.max(distance(a,c),EPS)&&
        (b.x-a.x)*(b.x-c.x)+(b.y-a.y)*(b.y-c.y)<=EPS*EPS){out.splice(i,1);changed=true;break;}
    }}
    return out.length>=3&&Math.abs(signedArea(out))>EPS*EPS?out:[];
  }
  function pointSegment(p,a,b){
    const dx=b.x-a.x,dy=b.y-a.y,ll=dx*dx+dy*dy;
    const t=ll?((p.x-a.x)*dx+(p.y-a.y)*dy)/ll:0;
    return {t,distance:Math.hypot(p.x-a.x-Math.max(0,Math.min(1,t))*dx,p.y-a.y-Math.max(0,Math.min(1,t))*dy)};
  }
  function location(p,ring){
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[j],b=ring[i];if(pointSegment(p,a,b).distance<=EPS)return 0;
      if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }return inside?1:-1;
  }
  function segmentCuts(a,b,c,d){
    const dx=b.x-a.x,dy=b.y-a.y,ex=d.x-c.x,ey=d.y-c.y;
    const ll=dx*dx+dy*dy,len=Math.sqrt(ll),other=Math.hypot(ex,ey),den=dx*ey-dy*ex;
    if(len<=EPS||other<=EPS)return [];
    if(Math.abs(den)>Number.EPSILON*len*other*32){
      const cx=c.x-a.x,cy=c.y-a.y,t=(cx*ey-cy*ex)/den,u=(cx*dy-cy*dx)/den;
      return t>=-EPS/len&&t<=1+EPS/len&&u>=-EPS/other&&u<=1+EPS/other?[Math.max(0,Math.min(1,t))]:[];
    }
    if(Math.abs(cross(a,b,c))/len>EPS||Math.abs(cross(a,b,d))/len>EPS)return [];
    return [((c.x-a.x)*dx+(c.y-a.y)*dy)/ll,((d.x-a.x)*dx+(d.y-a.y)*dy)/ll].filter(t=>t>=-EPS/len&&t<=1+EPS/len).map(t=>Math.max(0,Math.min(1,t)));
  }
  function normalizeRing(points){
    if(!Array.isArray(points)||points.length<3||points.some(p=>!p||!finite(p.x)||!finite(p.y)))return null;
    const ring=cleanPolygon(points);if(ring.length<3)return null;
    for(let i=0;i<ring.length;i++)for(let j=i+1;j<ring.length;j++){
      if(j===i+1||i===0&&j===ring.length-1)continue;
      if(segmentCuts(ring[i],ring[(i+1)%ring.length],ring[j],ring[(j+1)%ring.length]).length)return null;
    }
    if(signedArea(ring)<0)ring.reverse();return ring;
  }
  function triangulate(ring){
    const ids=ring.map((_,i)=>i),out=[];let guard=ring.length*ring.length;
    while(ids.length>3&&guard-->0){let found=false;
      for(let i=0;i<ids.length;i++){
        const a=ids[(i+ids.length-1)%ids.length],b=ids[i],c=ids[(i+1)%ids.length];
        if(cross(ring[a],ring[b],ring[c])<=EPS*EPS)continue;
        if(ids.some(k=>k!==a&&k!==b&&k!==c&&cross(ring[a],ring[b],ring[k])>=-EPS*EPS&&cross(ring[b],ring[c],ring[k])>=-EPS*EPS&&cross(ring[c],ring[a],ring[k])>=-EPS*EPS))continue;
        out.push([ring[a],ring[b],ring[c]]);ids.splice(i,1);found=true;break;
      }if(!found)return [];
    }
    if(ids.length===3)out.push(ids.map(i=>ring[i]));return out;
  }
  function halfPlane(points,a,b,inside){
    const out=[],len=distance(a,b);if(!len)return [];
    for(let i=0;i<points.length;i++){
      const p=points[i],q=points[(i+1)%points.length],u=cross(a,b,p)/len,v=cross(a,b,q)/len;
      const ip=inside?u>=-EPS:u<=EPS,iq=inside?v>=-EPS:v<=EPS;
      if(ip)out.push(p);
      if(ip!==iq){const t=u/(u-v);out.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});}
    }return cleanPolygon(out);
  }
  function subtractTriangle(poly,triangle){
    let remaining=poly;const out=[];
    for(let i=0;i<3&&remaining.length;i++){
      const a=triangle[i],b=triangle[(i+1)%3],outside=halfPlane(remaining,a,b,false);
      if(outside.length)out.push(outside);remaining=halfPlane(remaining,a,b,true);
    }return out;
  }
  function bbox(points){return {x0:Math.min(...points.map(p=>p.x)),x1:Math.max(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),y1:Math.max(...points.map(p=>p.y))};}
  function overlap(a,b){return a.x0<b.x1+EPS&&a.x1>b.x0-EPS&&a.y0<b.y1+EPS&&a.y1>b.y0-EPS;}
  function subtractAll(polys,masks,budget){
    let result=polys;
    for(const mask of masks){
      const mb=bbox(mask),next=[];
      for(const poly of result){
        if(!overlap(bbox(poly),mb)){next.push(poly);continue;}
        if(++budget.steps>MAX_PIECES)throw Error('AT_OPENING_COMPLEXITY_LIMIT');
        next.push(...subtractTriangle(poly,mask));
      }result=next;if(!result.length)break;
    }return result;
  }
  function horizontal(face){
    const vs=face&&face.verts;if(!Array.isArray(vs)||vs.length<3||vs.some(v=>!v||![v.x,v.y,v.z].every(finite)))return null;
    const z=vs[0].z;if(vs.some(v=>Math.abs(v.z-z)>PLANE_EPS))return null;
    let tris;
    if(Array.isArray(face.tris)&&face.tris.length){
      if(face.tris.some(t=>!Array.isArray(t)||t.length!==3||t.some(i=>!Number.isInteger(i)||i<0||i>=vs.length)))return null;
      tris=face.tris.map(t=>t.map(i=>({x:vs[i].x,y:vs[i].y}))).filter(t=>Math.abs(signedArea(t))>EPS*EPS);
    }else{const ring=normalizeRing(vs);tris=ring?triangulate(ring):[];if(signedArea(vs)<0)tris=tris.map(t=>t.slice().reverse());}
    if(!tris.length)return null;
    return {face,z,tris,bounds:bbox(vs)};
  }
  function isFloor(face){return face.sslKey==='floor1'||face.sslKey==='floor_out'||face.sslKey==='innerwall'&&(face.nameJa==='内床'||face.nameJa==='2F床'||face.nameJa==='床');}
  function isCeiling(face){return face.sslKey==='innerwall'&&face.nameJa==='天井';}
  function ccw(triangle){return signedArea(triangle)<0?triangle.slice().reverse():triangle;}
  function containsTriangle(point,triangle){
    const t=ccw(triangle);return t.every((a,i)=>cross(a,t[(i+1)%3],point)>=-EPS*Math.max(distance(a,t[(i+1)%3]),EPS));
  }
  function containsFace(point,face){return point.x>=face.bounds.x0-EPS&&point.x<=face.bounds.x1+EPS&&point.y>=face.bounds.y0-EPS&&point.y<=face.bounds.y1+EPS&&face.tris.some(t=>containsTriangle(point,t));}
  function packedFace(original,polys,z,negative,extra){
    const verts=[],tris=[],vertices=new Map();
    const origin=polys.length&&polys[0].length?polys[0][0]:{x:0,y:0};
    const id=p=>{const key=Math.round((p.x-origin.x)/EPS)+','+Math.round((p.y-origin.y)/EPS);if(vertices.has(key))return vertices.get(key);const i=verts.length;verts.push({x:p.x,y:p.y,z});vertices.set(key,i);return i;};
    for(const poly of polys){const ps=signedArea(poly)<0?poly.slice().reverse():poly;
      for(let i=1;i<ps.length-1;i++){const t=[ps[0],ps[i],ps[i+1]];if(Math.abs(signedArea(t))<=EPS*EPS)continue;const indices=t.map(id);if(negative)indices.reverse();tris.push(indices);}
    }
    if(!tris.length)return null;
    const face=Object.assign(clone(original),extra||{},{verts,tris});
    if(Array.isArray(face.vertsMm))face.vertsMm=verts.map(p=>({x:p.x*1000,y:p.y*1000,z:p.z*1000}));
    if(finite(original.area)){
      const before=horizontal(original),oldArea=before?before.tris.reduce((s,t)=>s+Math.abs(signedArea(t)),0):0;
      face.area=oldArea?original.area*polys.reduce((s,p)=>s+Math.abs(signedArea(p)),0)/oldArea:original.area;
    }
    return face;
  }
  function cutFace(source,masks,budget,roomKeys){
    const result=[];let changed=false;
    for(const t of source.tris){
      const pieces=subtractAll([ccw(t)],masks,budget),before=Math.abs(signedArea(t)),after=pieces.reduce((s,p)=>s+Math.abs(signedArea(p)),0);
      if(before-after>Math.max(EPS*EPS,before*1e-10))changed=true;
      result.push(...pieces.map(poly=>({poly,negative:signedArea(t)<0})));
    }
    if(!changed)return clone(source.face);
    const positive=result.filter(p=>!p.negative).map(p=>p.poly),negative=result.filter(p=>p.negative).map(p=>p.poly);
    // Mixed winding is retained triangle by triangle in one original face.
    const face=packedFace(source.face,positive,source.z,false,{interstoryOpeningCut:true,interstoryOpeningRoomKeys:roomKeys.slice()});
    const reverse=packedFace(source.face,negative,source.z,true,{interstoryOpeningCut:true,interstoryOpeningRoomKeys:roomKeys.slice()});
    if(!face)return reverse;if(!reverse)return face;
    const shift=face.verts.length;face.verts.push(...reverse.verts);face.tris.push(...reverse.tris.map(t=>t.map(i=>i+shift)));
    if(Array.isArray(face.vertsMm))face.vertsMm=face.verts.map(p=>({x:p.x*1000,y:p.y*1000,z:p.z*1000}));
    if(finite(source.face.area))face.area=source.face.area*result.reduce((s,p)=>s+Math.abs(signedArea(p.poly)),0)/source.tris.reduce((s,t)=>s+Math.abs(signedArea(t)),0);
    return face;
  }
  function uniqueParameters(values,length){
    const sorted=values.sort((a,b)=>a-b),out=[];
    for(const t of sorted)if(!out.length||(t-out[out.length-1])*length>EPS)out.push(t);return out;
  }
  function unionBoundary(openings){
    const source=[];openings.forEach(o=>o.ring.forEach((a,i)=>source.push({a,b:o.ring[(i+1)%o.ring.length],owner:o})));
    const atoms=[],same=new Map(),origin=openings[0].ring[0];
    for(const edge of source){
      const len=distance(edge.a,edge.b),ts=[0,1];
      source.forEach(other=>{ts.push(...segmentCuts(edge.a,edge.b,other.a,other.b));});
      const cuts=uniqueParameters(ts,len);
      for(let i=0;i<cuts.length-1;i++){
        const t0=cuts[i],t1=cuts[i+1];if((t1-t0)*len<=EPS)continue;
        const p=t=>({x:edge.a.x+(edge.b.x-edge.a.x)*t,y:edge.a.y+(edge.b.y-edge.a.y)*t}),a=p(t0),b=p(t1),mid=p((t0+t1)/2);
        let hidden=false;
        for(const other of openings){
          if(other===edge.owner)continue;const where=location(mid,other.ring);
          if(where>0){hidden=true;break;}
          if(where===0&&other.ring.some((c,j)=>{
            const d=other.ring[(j+1)%other.ring.length];return pointSegment(mid,c,d).distance<=EPS&&(b.x-a.x)*(d.x-c.x)+(b.y-a.y)*(d.y-c.y)<0;
          })){hidden=true;break;}
        }
        if(hidden)continue;
        const pointKey=q=>Math.round((q.x-origin.x)/EPS)+','+Math.round((q.y-origin.y)/EPS),key=pointKey(a)+'|'+pointKey(b);
        if(same.has(key)){const found=same.get(key);if(!found.owners.includes(edge.owner))found.owners.push(edge.owner);}
        else{const atom={a,b,owners:[edge.owner]};same.set(key,atom);atoms.push(atom);}
      }
    }return atoms;
  }
  function splitBoundary(boundary,faces){
    const result=[];
    for(const edge of boundary){const len=distance(edge.a,edge.b),ts=[0,1];
      faces.forEach(face=>{if(!overlap(bbox([edge.a,edge.b]),face.bounds))return;
        face.tris.forEach(t=>t.forEach((a,i)=>ts.push(...segmentCuts(edge.a,edge.b,a,t[(i+1)%3]))));});
      const cuts=uniqueParameters(ts,len),point=t=>({x:edge.a.x+(edge.b.x-edge.a.x)*t,y:edge.a.y+(edge.b.y-edge.a.y)*t});
      for(let i=0;i<cuts.length-1;i++)if((cuts[i+1]-cuts[i])*len>EPS)result.push({a:point(cuts[i]),b:point(cuts[i+1]),owners:edge.owners});
    }return result;
  }
  function numericFloor(value){
    const match=/^(?:地上)?(\d+)(?:F|階)?$/i.exec(String(value??'').normalize('NFKC').trim());return match?Number(match[1]):null;
  }
  function atPlanInterstoryOpenings(faces,rooms,options){
    const source=Array.isArray(faces)?faces:[],allRooms=Array.isArray(rooms)?rooms:[];
    const diagnostics=[],openings=[],linings=[],budget={steps:0};let sequence=0;
    const usedIds=new Set(source.flatMap(f=>[f.atFaceId,f.idfName]).filter(x=>x!==undefined).map(String));
    const newId=kind=>{let id;do{id='interstory-'+kind+'-'+(++sequence);}while(usedIds.has(id));usedIds.add(id);return id;};
    const counts={openings:0,cutFloors:0,cutCeilings:0,linings:0,syntheticCeilings:0};
    const diagnostic=(code,keys)=>{const roomKeys=[...new Set(keys.map(String))];if(!diagnostics.some(d=>d.code===code&&d.roomKeys.join('|')===roomKeys.join('|')))diagnostics.push({code,roomKeys});};
    const failure=()=>({ready:false,faces:clone(source),linings:[],openings:openings.map(o=>({roomKey:o.roomKey,floor:o.floor,floorZ:o.floorZ,gapMm:o.gapMm,gapSource:o.gapSource})),diagnostics,
      counts:{openings:counts.openings,cutFloors:0,cutCeilings:0,linings:0,syntheticCeilings:0}});
    if(!Array.isArray(faces)||!Array.isArray(rooms)){diagnostic('AT_OPENING_INPUT_INVALID',[]);return failure();}
    const selected=allRooms.filter(r=>r&&r.floorVoid===true);counts.openings=selected.length;
    if(!selected.length)return {ready:true,faces:clone(source),linings:[],openings:[],diagnostics:[],counts};
    if(selected.length>MAX_ROOMS||selected.reduce((n,r)=>n+(Array.isArray(r.ring)?r.ring.length:0),0)>MAX_VERTICES){diagnostic('AT_OPENING_COMPLEXITY_LIMIT',selected.map(r=>r.key));return failure();}
    const groups=[];
    for(const room of selected){
      const key=String(room.key??''),ring=normalizeRing(room.ring),floor=numericFloor(room.floor);
      if(!key||!ring||Array.isArray(room.holes)&&room.holes.length){diagnostic('AT_OPENING_RING_INVALID',[key]);continue;}
      if(!finite(room.z)||!floor||floor<2){diagnostic('AT_OPENING_LEVEL_INVALID',[key]);continue;}
      const supplied=room.openingGapMm!==undefined;
      if(supplied&&(typeof room.openingGapMm!=='number'||!finite(room.openingGapMm)||room.openingGapMm<0||room.openingGapMm>2000)){diagnostic('AT_OPENING_GAP_INVALID',[key]);continue;}
      const triangles=triangulate(ring);if(!triangles.length){diagnostic('AT_OPENING_RING_INVALID',[key]);continue;}
      const opening={roomKey:key,floor,floorZ:room.z,ring,triangles,gapMm:supplied?room.openingGapMm:null,gapSource:'unknown'};
      openings.push(opening);let group=groups.find(g=>Math.abs(g.z-room.z)<=PLANE_EPS);
      if(group&&group.floor!==floor){diagnostic('AT_OPENING_LEVEL_CONFLICT',[key,...group.openings.map(o=>o.roomKey)]);continue;}
      if(!group){group={z:room.z,floor,openings:[]};groups.push(group);}group.openings.push(opening);
    }
    if(diagnostics.length)return failure();
    const horizontalFaces=[];source.forEach((face,index)=>{if(isFloor(face)||isCeiling(face)){const parsed=horizontal(face);if(parsed)horizontalFaces.push({...parsed,index});}});
    const replacements=new Map(),newFaces=[];
    try{for(const group of groups){
      const keys=group.openings.map(o=>o.roomKey),floorFaces=horizontalFaces.filter(f=>isFloor(f.face)&&Math.abs(f.z-group.z)<=PLANE_EPS);
      if(!floorFaces.length){diagnostic('AT_OPENING_FLOOR_NOT_FOUND',keys);continue;}
      const masks=group.openings.flatMap(o=>o.triangles),nearby=[];
      for(const opening of group.openings){
        let removed=0;
        for(const floor of floorFaces)for(const tri of floor.tris){const remains=subtractAll([ccw(tri)],opening.triangles,budget);removed+=Math.abs(signedArea(tri))-remains.reduce((s,p)=>s+Math.abs(signedArea(p)),0);}
        if(removed<=EPS*EPS)diagnostic('AT_OPENING_FLOOR_NOT_FOUND',[opening.roomKey]);
      }
      if(diagnostics.length)continue;
      for(const r of allRooms){const f=r&&numericFloor(r.floor);if(f&&f<group.floor&&finite(r.z)&&r.z<group.z-PLANE_EPS)nearby.push({floor:f,z:r.z});}
      let lowerZ=null;
      if(nearby.length){const previous=Math.max(...nearby.map(r=>r.floor));lowerZ=Math.max(...nearby.filter(r=>r.floor===previous).map(r=>r.z));}
      else{const levels=horizontalFaces.filter(f=>isFloor(f.face)&&f.z<group.z-1.2).map(f=>f.z);if(levels.length)lowerZ=Math.max(...levels);}
      if(lowerZ===null){diagnostic('AT_OPENING_LOWER_STORY_UNKNOWN',keys);continue;}
      const ceilings=horizontalFaces.filter(f=>isCeiling(f.face)&&f.z>lowerZ+PLANE_EPS&&f.z<=group.z+PLANE_EPS);
      const sourceLevels=[];ceilings.forEach(c=>{if(!sourceLevels.some(z=>Math.abs(z-c.z)<=PLANE_EPS))sourceLevels.push(c.z);});
      if(sourceLevels.length>1){
        // A source step wall may cross the selected opening. Horizontal cuts
        // alone cannot remove that dam, so retain all original geometry.
        diagnostic('AT_OPENING_CEILING_AMBIGUOUS',keys);continue;
      }
      const boundary=splitBoundary(unionBoundary(group.openings),floorFaces.concat(ceilings)),segments=[];
      for(const edge of boundary){
        const len=distance(edge.a,edge.b),mid={x:(edge.a.x+edge.b.x)/2,y:(edge.a.y+edge.b.y)/2};
        // CCW opening: retained slab lies on its right. A missing slab here
        // is an exterior edge, not an internal opening fascia.
        const shift=Math.min(len/16,Math.max(EPS*32,len*1e-7));
        const outside={x:mid.x+(edge.b.y-edge.a.y)/len*shift,y:mid.y-(edge.b.x-edge.a.x)/len*shift};
        if(!floorFaces.some(f=>containsFace(outside,f)))continue;
        const actual=ceilings.filter(f=>containsFace(outside,f)),levels=[];
        actual.forEach(f=>{if(!levels.some(z=>Math.abs(z-f.z)<=PLANE_EPS))levels.push(f.z);});
        if(levels.length>1){diagnostic('AT_OPENING_CEILING_AMBIGUOUS',edge.owners.map(o=>o.roomKey));continue;}
        segments.push({...edge,bottom:levels.length?levels[0]:null});
      }
      const missing=segments.filter(s=>s.bottom===null),explicit=[];
      for(const edge of missing){const gaps=edge.owners.map(o=>o.gapMm);
        if(gaps.some(g=>g===null)){diagnostic('AT_OPENING_GAP_REQUIRED',edge.owners.filter(o=>o.gapMm===null).map(o=>o.roomKey));continue;}
        gaps.forEach(g=>{if(!explicit.some(x=>Math.abs(x-g)<=PLANE_EPS*1000))explicit.push(g);});
      }
      if(explicit.length>1){diagnostic('AT_OPENING_GAP_CONFLICT',keys);continue;}
      if(diagnostics.length)continue;
      const gap=explicit.length?explicit[0]:null,bottom=gap===null?null:group.z-gap/1000;
      if(bottom!==null&&bottom<lowerZ-PLANE_EPS){diagnostic('AT_OPENING_HEIGHT_INVALID',keys);continue;}
      if(bottom!==null&&ceilings.some(c=>Math.abs(c.z-bottom)>PLANE_EPS&&floorFaces.some(f=>overlap(f.bounds,c.bounds)))){
        // A partial source ceiling at another level needs its existing step
        // walls to be proved; do not invent a horizontal closure across it.
        diagnostic('AT_OPENING_CEILING_PARTIAL_CONFLICT',keys);continue;
      }
      for(const edge of missing)edge.bottom=bottom;
      group.openings.forEach(o=>{
        const own=segments.filter(s=>s.owners.includes(o)),zs=[...new Set(own.map(s=>s.bottom).filter(finite))];
        o.gapSource=missing.some(s=>s.owners.includes(o))?'user':'source-ceiling';
        o.ceilingZ=zs.length===1?zs[0]:null;o.gapsMm=zs.map(z=>Math.max(0,(group.z-z)*1000));
        if(o.gapSource==='source-ceiling')o.gapMm=zs.length===1?Math.max(0,(group.z-zs[0])*1000):null;
      });
      for(const floor of floorFaces){const cut=cutFace(floor,masks,budget,keys);replacements.set(floor.index,cut);if(!cut||cut.interstoryOpeningCut)counts.cutFloors++;}
      for(const ceiling of ceilings){const cut=cutFace(ceiling,masks,budget,keys);replacements.set(ceiling.index,cut);if(!cut||cut.interstoryOpeningCut)counts.cutCeilings++;}
      if(bottom!==null&&gap>0){
        const already=ceilings.flatMap(c=>c.tris.map(ccw)),built=[];
        for(const floor of floorFaces){
          const pieces=subtractAll(floor.tris.map(ccw),already.concat(built),budget);
          built.push(...pieces.flatMap(p=>{const r=signedArea(p)<0?p.slice().reverse():p;return triangulate(r);}));
          const remain=subtractAll(pieces,masks,budget);if(!remain.length)continue;
          const id=newId('cap'),face=packedFace({sslKey:'innerwall',nameJa:'天井',atFaceId:id,idfName:id,
            interstorySyntheticCeiling:true,interstoryOpeningRoomKeys:keys.slice(),sourceFloorFaceId:floor.face.atFaceId||null},remain,bottom,true);
          if(face){newFaces.push(face);counts.syntheticCeilings++;}
        }
      }
      for(const edge of segments){
        if(!finite(edge.bottom)){diagnostic('AT_OPENING_GAP_REQUIRED',edge.owners.map(o=>o.roomKey));continue;}
        if(edge.bottom>group.z+PLANE_EPS){diagnostic('AT_OPENING_HEIGHT_INVALID',edge.owners.map(o=>o.roomKey));continue;}
        if(group.z-edge.bottom<=PLANE_EPS)continue;
        const id=newId('lining'),face={sslKey:'innerwall',nameJa:'内壁',atFaceId:id,idfName:id,
          interstoryOpeningLining:true,interstoryOpeningRoomKeys:edge.owners.map(o=>o.roomKey),
          verts:[{...edge.a,z:edge.bottom},{...edge.a,z:group.z},{...edge.b,z:group.z},{...edge.b,z:edge.bottom}],tris:[[0,1,2],[0,2,3]]};
        linings.push(face);
      }
    }}catch(error){diagnostic(error&&error.message==='AT_OPENING_COMPLEXITY_LIMIT'?error.message:'AT_OPENING_GEOMETRY_INVALID',openings.map(o=>o.roomKey));}
    if(diagnostics.length)return failure();
    const result=source.map((f,i)=>replacements.has(i)?replacements.get(i):clone(f)).filter(Boolean).concat(newFaces,linings);
    counts.linings=linings.length;
    // Internal triangulations are deliberately omitted from public summaries.
    const summary=openings.map(o=>({roomKey:o.roomKey,floor:o.floor,floorZ:o.floorZ,ceilingZ:o.ceilingZ,gapMm:o.gapMm,gapsMm:o.gapsMm,gapSource:o.gapSource}));
    return {ready:true,faces:result,linings,openings:summary,diagnostics,counts};
  }
  root.atPlanInterstoryOpenings=atPlanInterstoryOpenings;
  if(typeof module!=='undefined'&&module.exports)module.exports={atPlanInterstoryOpenings};
})(typeof globalThis!=='undefined'?globalThis:this);

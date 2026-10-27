/* Exact union of adjacent existing room polygons; never bridges a room gap. */
(function(root){
  'use strict';
  const finite=Number.isFinite,DEFAULT_EPSILON=1e-7,MAX_EPSILON=1e-6,MAX_ROOMS=32,MAX_VERTICES=4096;
  function clone(value){
    if(Array.isArray(value))return value.map(clone);
    if(value&&typeof value==='object'){const out={};Object.keys(value).forEach(key=>{out[key]=clone(value[key]);});return out;}
    return value;
  }
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  function signedArea(ring){
    const origin=ring[0];let twice=0;
    for(let i=1;i<ring.length-1;i++)twice+=cross(origin,ring[i],ring[i+1]);
    return twice/2;
  }
  function pointSegment(p,a,b){
    const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
    const t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
    return {distance:Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy),t};
  }
  function relation(a,b,c,d,epsilon){
    const dx=b.x-a.x,dy=b.y-a.y,ex=d.x-c.x,ey=d.y-c.y,len=Math.hypot(dx,dy),other=Math.hypot(ex,ey);
    if(len<=epsilon||other<=epsilon)return {kind:'POINT'};
    const ca=cross(a,b,c)/len,da=cross(a,b,d)/len;
    if(Math.abs(ca)<=epsilon&&Math.abs(da)<=epsilon){
      const ux=dx/len,uy=dy/len,t0=(c.x-a.x)*ux+(c.y-a.y)*uy,t1=(d.x-a.x)*ux+(d.y-a.y)*uy;
      const overlap=Math.min(len,Math.max(t0,t1))-Math.max(0,Math.min(t0,t1));
      if(overlap>epsilon)return {kind:'OVERLAP',sameDirection:dx*ex+dy*ey>0,length:overlap};
      return overlap>=-epsilon?{kind:'POINT'}:{kind:'NONE'};
    }
    const den=dx*ey-dy*ex;
    if(Math.abs(den)<=Number.EPSILON*len*other*16)return {kind:'NONE'};
    const cx=c.x-a.x,cy=c.y-a.y,t=(cx*ey-cy*ex)/den,u=(cx*dy-cy*dx)/den;
    const te=epsilon/len,ue=epsilon/other;
    if(t<-te||t>1+te||u<-ue||u>1+ue)return {kind:'NONE'};
    return {kind:t>te&&t<1-te&&u>ue&&u<1-ue?'CROSS':'POINT'};
  }
  function pointLocation(p,ring,epsilon){
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[j],b=ring[i];
      if(pointSegment(p,a,b).distance<=epsilon)return 0;
      if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }
    return inside?1:-1;
  }
  function normalizeRing(source,epsilon){
    if(!Array.isArray(source)||source.length<3||source.some(p=>!p||!finite(p.x)||!finite(p.y)))return null;
    const ring=[];
    for(const p of source)if(!ring.length||distance(p,ring[ring.length-1])>epsilon)ring.push({x:p.x,y:p.y});
    if(ring.length>1&&distance(ring[0],ring[ring.length-1])<=epsilon)ring.pop();
    if(ring.length<3)return null;
    for(let i=0;i<ring.length;i++)for(let j=i+1;j<ring.length;j++){
      if(distance(ring[i],ring[j])<=epsilon)return null;
      const adjacent=j===i+1||i===0&&j===ring.length-1;
      const hit=relation(ring[i],ring[(i+1)%ring.length],ring[j],ring[(j+1)%ring.length],epsilon);
      if(adjacent?hit.kind==='OVERLAP':hit.kind!=='NONE')return null;
    }
    const area=signedArea(ring);
    if(!finite(area)||Math.abs(area)<=epsilon*epsilon)return null;
    if(area<0)ring.reverse();
    return ring;
  }
  function floor(value){
    const text=String(value??'').normalize('NFKC').toUpperCase().replace(/\s/g,'');
    const m=/^(?:地上)?(\d+)(?:F|階)?$/.exec(text);
    if(m)return String(Number(m[1]));
    if(/^(?:R|RF|屋上|屋根)$/.test(text))return 'R';
    return /^B\d+$/.test(text)?text:null;
  }
  function atPlanRoomMerge(rooms,selectedKeys,options){
    const opts=options||{},epsilon=opts.epsilon===undefined?DEFAULT_EPSILON:opts.epsilon;
    const fail=(code,detail)=>Object.assign({ready:false,code,room:null,sourceKeys:[]},detail||{});
    if(!finite(epsilon)||epsilon<=0||epsilon>MAX_EPSILON)return fail('ROOM_MERGE_EPSILON_INVALID');
    if(!Array.isArray(rooms)||!Array.isArray(selectedKeys)||selectedKeys.length<2||selectedKeys.some(k=>k==null))return fail('ROOM_MERGE_SELECTION_INVALID');
    const keys=selectedKeys.map(String);
    if(new Set(keys).size!==keys.length)return fail('ROOM_MERGE_SELECTION_INVALID');
    if(keys.length>MAX_ROOMS)return fail('ROOM_MERGE_TOO_COMPLEX');
    const byKey=new Map();
    for(const room of rooms){
      if(!room||room.key==null)return fail('ROOM_MERGE_SELECTION_INVALID');
      const key=String(room.key);
      if(byKey.has(key))return fail('ROOM_MERGE_DUPLICATE_KEY');
      byKey.set(key,room);
    }
    if(keys.some(key=>!byKey.has(key)))return fail('ROOM_MERGE_SELECTION_INVALID');
    const primaryKey=opts.primaryKey==null?keys[0]:String(opts.primaryKey);
    if(!keys.includes(primaryKey))return fail('ROOM_MERGE_PRIMARY_INVALID');
    const selected=keys.map(key=>byKey.get(key)),primary=byKey.get(primaryKey);
    const levels=selected.map(r=>floor(r.floor));
    if(levels.some(f=>!f))return fail('ROOM_MERGE_FLOOR_UNKNOWN');
    if(new Set(levels).size!==1)return fail('ROOM_MERGE_FLOOR_MISMATCH');
    if(selected.some(r=>!finite(r.z)||!finite(r.zTop)||r.zTop<=r.z))return fail('ROOM_MERGE_HEIGHT_INVALID');
    if(selected.some(r=>Math.abs(r.z-primary.z)>epsilon||Math.abs(r.zTop-primary.zTop)>epsilon))return fail('ROOM_MERGE_HEIGHT_MISMATCH');
    if(selected.some(r=>Array.isArray(r.holes)&&r.holes.length))return fail('ROOM_MERGE_HOLE');
    const vertexCount=selected.reduce((n,r)=>n+(Array.isArray(r.ring)?r.ring.length:0),0);
    if(vertexCount>MAX_VERTICES)return fail('ROOM_MERGE_TOO_COMPLEX');
    const rings=selected.map(r=>normalizeRing(r.ring,epsilon));
    if(rings.some(r=>!r))return fail('ROOM_MERGE_RING_INVALID');
    const pointContacts=[];
    for(let i=0;i<rings.length-1;i++)for(let j=i+1;j<rings.length;j++){
      const a=rings[i],b=rings[j];
      for(let x=0;x<a.length;x++)for(let y=0;y<b.length;y++){
        const hit=relation(a[x],a[(x+1)%a.length],b[y],b[(y+1)%b.length],epsilon);
        if(hit.kind==='CROSS'||hit.kind==='OVERLAP'&&hit.sameDirection)return fail('ROOM_MERGE_OVERLAP');
        if(hit.kind==='POINT')pointContacts.push([i,j]);
      }
      for(const pair of [[a,b],[b,a]])for(let x=0;x<pair[0].length;x++){
        const p=pair[0][x],q=pair[0][(x+1)%pair[0].length],mid={x:(p.x+q.x)/2,y:(p.y+q.y)/2};
        if(pointLocation(p,pair[1],epsilon)===1||pointLocation(mid,pair[1],epsilon)===1)return fail('ROOM_MERGE_OVERLAP');
      }
    }
    // Only existing vertices may split an edge. Snap differences are bounded
    // by a micrometre at most, never by room size or an absolute world origin.
    const points=[],ids=[];
    for(const ring of rings){
      const list=[];
      for(const p of ring){let index=points.findIndex(q=>distance(p,q)<=epsilon);if(index<0){index=points.length;points.push(p);}list.push(index);}
      ids.push(list);
    }
    const edges=new Map(),graph=rings.map(()=>new Set());
    for(let owner=0;owner<ids.length;owner++)for(let i=0;i<ids[owner].length;i++){
      const from=ids[owner][i],to=ids[owner][(i+1)%ids[owner].length],a=points[from],b=points[to];
      if(from===to)return fail('ROOM_MERGE_RING_INVALID');
      const splits=points.map((p,id)=>({id,hit:pointSegment(p,a,b)})).filter(s=>s.hit.distance<=epsilon).sort((u,v)=>u.hit.t-v.hit.t||u.id-v.id);
      for(let s=0;s<splits.length-1;s++){
        const start=splits[s].id,end=splits[s+1].id;if(start===end||distance(points[start],points[end])<=epsilon)continue;
        const key=Math.min(start,end)+'|'+Math.max(start,end);
        if(!edges.has(key))edges.set(key,[]);edges.get(key).push({from:start,to:end,owner});
      }
    }
    const boundary=[];
    for(const list of edges.values()){
      if(list.length===1){boundary.push(list[0]);continue;}
      if(list.length!==2||list[0].owner===list[1].owner||list[0].from!==list[1].to||list[0].to!==list[1].from)return fail('ROOM_MERGE_OVERLAP');
      graph[list[0].owner].add(list[1].owner);graph[list[1].owner].add(list[0].owner);
    }
    const components=new Array(rings.length).fill(-1);let componentCount=0;
    for(let start=0;start<rings.length;start++){
      if(components[start]>=0)continue;
      const pending=[start];components[start]=componentCount;
      while(pending.length)for(const neighbour of graph[pending.pop()])if(components[neighbour]<0){components[neighbour]=componentCount;pending.push(neighbour);}
      componentCount++;
    }
    if(componentCount>1)return fail(pointContacts.some(([i,j])=>components[i]!==components[j])?'ROOM_MERGE_POINT_CONTACT':'ROOM_MERGE_NOT_ADJACENT');
    const outgoing=new Map(),incoming=new Map();
    for(const edge of boundary){
      if(outgoing.has(edge.from)||incoming.has(edge.to))return fail('ROOM_MERGE_BOUNDARY_INVALID');
      outgoing.set(edge.from,edge.to);incoming.set(edge.to,edge.from);
    }
    if(!boundary.length||outgoing.size!==incoming.size||[...outgoing.keys()].some(key=>!incoming.has(key)))return fail('ROOM_MERGE_BOUNDARY_INVALID');
    const used=new Set(),loops=[];
    for(const start of outgoing.keys()){
      if(used.has(start))continue;
      const loop=[];let current=start;
      do{
        if(used.has(current)||!outgoing.has(current))return fail('ROOM_MERGE_BOUNDARY_INVALID');
        used.add(current);loop.push(points[current]);current=outgoing.get(current);
      }while(current!==start&&loop.length<=boundary.length);
      if(current!==start||loop.length<3)return fail('ROOM_MERGE_BOUNDARY_INVALID');
      loops.push(loop);
    }
    if(loops.length!==1)return fail('ROOM_MERGE_HOLE');
    let ring=loops[0].map(p=>({x:p.x,y:p.y})),changed=true;
    while(changed&&ring.length>3){
      changed=false;
      for(let i=0;i<ring.length;i++){
        const prev=ring[(i+ring.length-1)%ring.length],next=ring[(i+1)%ring.length];
        if(pointSegment(ring[i],prev,next).distance<=epsilon){ring.splice(i,1);changed=true;break;}
      }
    }
    const validated=normalizeRing(ring,epsilon);
    if(!validated||signedArea(ring)<=0)return fail('ROOM_MERGE_BOUNDARY_INVALID');
    ring=validated;
    const sourceArea=rings.reduce((sum,r)=>sum+signedArea(r),0),mergedArea=signedArea(ring);
    const perimeter=rings.reduce((sum,r)=>sum+r.reduce((n,p,i)=>n+distance(p,r[(i+1)%r.length]),0),0);
    if(Math.abs(mergedArea-sourceArea)>Math.max(epsilon*perimeter*8,Number.EPSILON*sourceArea*128))return fail('ROOM_MERGE_AREA_MISMATCH');
    const sourceSnapshots=clone(selected),merged=clone(primary),mergedFrom=[];
    for(let i=0;i<selected.length;i++){
      const leaves=Array.isArray(selected[i].mergedFrom)&&selected[i].mergedFrom.length?selected[i].mergedFrom:[keys[i]];
      leaves.forEach(key=>{key=String(key);if(!mergedFrom.includes(key))mergedFrom.push(key);});
    }
    const xs=ring.map(p=>p.x),ys=ring.map(p=>p.y);
    Object.assign(merged,{ring,area:mergedArea,dx:Math.max(...xs)-Math.min(...xs),dy:Math.max(...ys)-Math.min(...ys),
      manualAssignment:true,manualMerged:true,reviewed:false,mergedFrom,sourceKeys:keys.slice(),mergeSources:clone(sourceSnapshots)});
    if(opts.name!==undefined)merged.name=String(opts.name??'');
    const result=rooms.filter(r=>!keys.includes(String(r.key))||String(r.key)===primaryKey).map(r=>String(r.key)===primaryKey?merged:clone(r));
    return {ready:true,code:'ROOM_MERGE_READY',room:merged,rooms:result,sourceKeys:keys.slice(),removedKeys:keys.filter(k=>k!==primaryKey),
      sourceSnapshots,sourceArea,mergedArea,areaDifference:mergedArea-sourceArea,epsilon};
  }
  const api={atPlanRoomMerge};Object.keys(api).forEach(key=>{root[key]=api[key];});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);

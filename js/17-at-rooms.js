// ========================= Architrend 3DS → 部屋ポリゴン =========================
function atFaceZ(f){
  const vs=f.verts||[];
  if(!vs.length) return 0;
  let z=0;
  vs.forEach(function(v){ z+=v.z; });
  return z/vs.length;
}
function atFaceBBox(f){
  const vs=f.verts||[];
  let minx=Infinity, maxx=-Infinity, miny=Infinity, maxy=-Infinity;
  vs.forEach(function(v){
    minx=Math.min(minx,v.x); maxx=Math.max(maxx,v.x);
    miny=Math.min(miny,v.y); maxy=Math.max(maxy,v.y);
  });
  return {minx:minx, maxx:maxx, miny:miny, maxy:maxy, dx:maxx-minx, dy:maxy-miny};
}
function atRingBBox(ring){
  let minx=Infinity, maxx=-Infinity, miny=Infinity, maxy=-Infinity;
  (ring||[]).forEach(function(v){
    minx=Math.min(minx,v.x); maxx=Math.max(maxx,v.x);
    miny=Math.min(miny,v.y); maxy=Math.max(maxy,v.y);
  });
  return {minx:minx, maxx:maxx, miny:miny, maxy:maxy, dx:maxx-minx, dy:maxy-miny};
}
function atPointInFaceXY(x, y, f){
  const vs=f.verts||[];
  let inside=false;
  if(f.tris && f.tris.length && vs.length){
    inside=f.tris.some(function(t){
      const a=vs[t[0]], b=vs[t[1]], c=vs[t[2]];
      if(!a||!b||!c) return false;
      if(typeof at3dsPointInTriXY==='function') return at3dsPointInTriXY(x, y, a, b, c);
      const cross=(p,q)=>(p.x-x)*(q.y-y)-(p.y-y)*(q.x-x),u=cross(a,b),v=cross(b,c),w=cross(c,a);
      return !((u<0||v<0||w<0)&&(u>0||v>0||w>0));
    });
  }else{
    const b=atFaceBBox(f);
    inside=x>=b.minx-1e-4 && x<=b.maxx+1e-4 && y>=b.miny-1e-4 && y<=b.maxy+1e-4;
  }
  return inside&&!(f.floorExcludeFaces||[]).some(face=>face!==f&&atPointInFaceXY(x,y,face));
}
function atWallSeg(f){
  // Story sections carry their actual horizontal silhouette. Their source
  // vertices deliberately retain the wall's real height for floor evidence.
  if(f && f._atStorySegment){
    const s=f._atStorySegment;
    if(s.axis==='x') return {x:s.x,y0:s.y0,y1:s.y1,axis:'x'};
    if(s.axis==='y') return {y:s.y,x0:s.x0,x1:s.x1,axis:'y'};
    return null;
  }
  const b=atFaceBBox(f);
  const dx=b.dx, dy=b.dy;
  if(dx<0.08 && dy>=0.3) return {x: (b.minx+b.maxx)/2, y0:b.miny, y1:b.maxy, axis:'x'};
  if(dy<0.08 && dx>=0.3) return {y: (b.miny+b.maxy)/2, x0:b.minx, x1:b.maxx, axis:'y'};
  return null;
}
function atSegMidInside(seg, f, inset){
  inset=inset||0.05;
  let x, y;
  if(seg.axis==='x'){ x=seg.x; y=(seg.y0+seg.y1)/2; }
  else { y=seg.y; x=(seg.x0+seg.x1)/2; }
  const b=atFaceBBox(f);
  if(x<=b.minx+inset || x>=b.maxx-inset || y<=b.miny+inset || y>=b.maxy-inset) return false;
  return atPointInFaceXY(x, y, f);
}
function atUniq(vals, tol){
  if(typeof epUniqCoords==='function') return epUniqCoords(vals, tol);
  const a=(vals||[]).filter(isFinite).sort(function(p,q){ return p-q; });
  const out=[];
  a.forEach(function(v){
    if(!out.length || Math.abs(out[out.length-1]-v)>tol) out.push(v);
    else out[out.length-1]=(out[out.length-1]+v)/2;
  });
  return out;
}
// これより近い上下の水平面は階高ではない。下側は床の裏側（天井）なので階にしない。
const AT_MIN_STORY_M = 1.2;
function atIsFloorFace(f){
  if(!f) return false;
  if(f.sslKey==='floor1' || f.sslKey==='floor_out') return true;
  return f.sslKey==='innerwall' && (f.nameJa==='内床' || f.nameJa==='2F床');
}
function atIsPartition(f){
  if(!f) return false;
  if(typeof at3dsIsWallKey==='function' && at3dsIsWallKey(f.sslKey)) return true;
  return f.sslKey==='innerwall' && f.nameJa==='内壁';
}
function atStoryTop(zBot, faces){
  let best=Infinity;
  (faces||[]).forEach(function(f){
    if(!(f.nameJa==='内床' || f.nameJa==='2F床' || f.nameJa==='天井' || f.sslKey==='attic')) return;
    const z=atFaceZ(f);
    if(z>zBot+AT_MIN_STORY_M && z<best) best=z;
  });
  return isFinite(best) ? best : zBot+2.84;
}
function atBBoxOverlapArea(a, b){
  const ox=Math.min(a.maxx,b.maxx)-Math.max(a.minx,b.minx);
  const oy=Math.min(a.maxy,b.maxy)-Math.max(a.miny,b.miny);
  if(!(ox>0) || !(oy>0)) return 0;
  return ox*oy;
}
function atPlateIsSlabUnderside(plate, plates){
  const z=atFaceZ(plate);
  const b=atFaceBBox(plate);
  const area=Math.max((b.maxx-b.minx)*(b.maxy-b.miny), 0.01);
  return (plates||[]).some(function(up){
    if(up===plate) return false;
    const zu=atFaceZ(up);
    if(!(zu>z+0.05 && zu<z+AT_MIN_STORY_M)) return false;
    const ub=atFaceBBox(up);
    const ov=atBBoxOverlapArea(b, ub);
    const upArea=Math.max((ub.maxx-ub.minx)*(ub.maxy-ub.miny), 0.01);
    return ov>Math.min(area, upArea)*0.35;
  });
}
function atReleaseSlabUnderside(f){
  if(!f) return;
  if(f.nameJa==='内床' || f.nameJa==='2F床') f.nameJa='天井';
  if(f.sslKey==='floor_out' || f.sslKey==='floor1') f.sslKey='innerwall';
  f.cantilever=false;
}
function atRectRing(b){
  return [
    {x:b.minx, y:b.miny}, {x:b.maxx, y:b.miny},
    {x:b.maxx, y:b.maxy}, {x:b.minx, y:b.maxy}
  ];
}
function atRingAreaM2(ring){
  if(typeof epRingArea==='function') return Math.abs(epRingArea(ring));
  let a=0;
  for(let i=0;i<(ring||[]).length;i++){
    const p=ring[i], q=ring[(i+1)%ring.length];
    a+=p.x*q.y-q.x*p.y;
  }
  return Math.abs(a)/2;
}
function atSplitPlate(plate, splitters){
  const b=atFaceBBox(plate);
  const vertices=plate.verts||[],epsilon=1e-7;
  const exclusions=(plate.floorExcludeFaces||[]).filter(face=>face!==plate&&Array.isArray(face.verts)&&face.verts.length>=3);
  const exclusionTriangles=exclusions.flatMap(face=>{
    const tris=face.tris?.length?face.tris:Array.from({length:face.verts.length-2},(_,i)=>[0,i+1,i+2]);
    return tris.filter(t=>t.every(i=>face.verts[i])).map(t=>t.map(i=>face.verts[i]));
  });
  function simplify(ring){
    let out=ring.map(p=>({x:p.x,y:p.y})),changed=true;
    while(changed&&out.length>3){
      changed=false;
      for(let i=0;i<out.length;i++){
        const a=out[(i+out.length-1)%out.length],p=out[i],c=out[(i+1)%out.length];
        const length=Math.hypot(c.x-a.x,c.y-a.y);
        if(length>epsilon&&Math.abs((p.x-a.x)*(c.y-a.y)-(p.y-a.y)*(c.x-a.x))/length<epsilon&&
          (p.x-a.x)*(p.x-c.x)+(p.y-a.y)*(p.y-c.y)<=epsilon*epsilon){out.splice(i,1);changed=true;break;}
      }
    }
    return out;
  }
  function insideRing(x,y,ring){
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[j],c=ring[i];
      if((a.y>y)!==(c.y>y)&&x<(c.x-a.x)*(y-a.y)/(c.y-a.y)+a.x)inside=!inside;
    }
    return inside;
  }
  const triangles=Array.isArray(plate.tris)?plate.tris.filter(t=>Array.isArray(t)&&t.length===3&&t.every(i=>Number.isInteger(i)&&vertices[i])):[];
  function sourceOutlines(){
    if(!triangles.length)return vertices.length>=3?[simplify(vertices)]:[];
    const edges=new Map();
    triangles.forEach(t=>t.forEach((from,i)=>{
      const to=t[(i+1)%3],key=Math.min(from,to)+'|'+Math.max(from,to);
      if(!edges.has(key))edges.set(key,[]);edges.get(key).push([from,to]);
    }));
    const adjacency=new Map();
    for(const list of edges.values()){
      if(list.length===2)continue;if(list.length!==1)return [];
      const [from,to]=list[0];
      if(!adjacency.has(from))adjacency.set(from,[]);if(!adjacency.has(to))adjacency.set(to,[]);
      adjacency.get(from).push(to);adjacency.get(to).push(from);
    }
    if([...adjacency.values()].some(list=>list.length!==2))return [];
    const used=new Set(),rings=[];
    for(const start of adjacency.keys()){
      if(used.has(start))continue;
      let previous=-1,current=start;const ring=[];
      do{
        if(used.has(current))return [];used.add(current);ring.push(vertices[current]);
        const next=adjacency.get(current).find(v=>v!==previous);previous=current;current=next;
      }while(current!==start&&ring.length<=adjacency.size);
      if(current!==start||ring.length<3)return [];rings.push(simplify(ring));
    }
    return rings;
  }
  const originals=sourceOutlines().filter(r=>r.length>=3&&atRingAreaM2(r)>0.15);
  function insidePlate(x,y){
    if(triangles.length)return triangles.some(t=>{
      const p=vertices[t[0]],q=vertices[t[1]],r=vertices[t[2]];
      const cross=(a,c)=>(a.x-x)*(c.y-y)-(a.y-y)*(c.x-x),a=cross(p,q),c=cross(q,r),d=cross(r,p);
      return !((a<-epsilon||c<-epsilon||d<-epsilon)&&(a>epsilon||c>epsilon||d>epsilon));
    });
    return originals.some(r=>insideRing(x,y,r))&&!exclusions.some(face=>atPointInFaceXY(x,y,face));
  }
  const xs=[b.minx, b.maxx], ys=[b.miny, b.maxy];
  (plate.verts||[]).forEach(function(v){ xs.push(v.x); ys.push(v.y); });
  exclusions.forEach(face=>face.verts.forEach(v=>{xs.push(v.x);ys.push(v.y);}));
  const xWalls=[], yWalls=[];
  (splitters||[]).forEach(function(w){
    const s=atWallSeg(w);
    if(!s) return;
    if(s.axis==='x'){ xs.push(s.x);ys.push(s.y0,s.y1);xWalls.push(s); }
    else { ys.push(s.y);xs.push(s.x0,s.x1);yWalls.push(s); }
  });
  if(!xWalls.length&&!yWalls.length&&originals.length===1&&!exclusions.length)return originals;
  const ux=atUniq(xs, 0.02), uy=atUniq(ys, 0.02);
  const nx=ux.length-1, ny=uy.length-1;
  if(nx<1 || ny<1) return exclusions.length?[]:originals;
  const occ=new Uint8Array(nx*ny);
  const cellPieces=new Map(),partialCells=new Set();
  let occupied=0;
  function idx(ix,iy){ return ix+iy*nx; }
  function clipTriangle(t,x0,x1,y0,y1){
    let polygon=t.map(i=>({x:vertices[i].x,y:vertices[i].y}));
    for(const [axis,value,sign] of [['x',x0,1],['x',x1,-1],['y',y0,1],['y',y1,-1]]){
      const out=[];
      for(let i=0;i<polygon.length;i++){
        const a=polygon[i],c=polygon[(i+1)%polygon.length],da=(a[axis]-value)*sign,dc=(c[axis]-value)*sign;
        if(da>=-epsilon)out.push(a);
        if((da>=-epsilon)!==(dc>=-epsilon)){
          const ratio=da/(da-dc);out.push({x:a.x+(c.x-a.x)*ratio,y:a.y+(c.y-a.y)*ratio});
        }
      }
      polygon=out.filter((p,i)=>i===0||Math.hypot(p.x-out[i-1].x,p.y-out[i-1].y)>epsilon);
      if(polygon.length>1&&Math.hypot(polygon[0].x-polygon[polygon.length-1].x,polygon[0].y-polygon[polygon.length-1].y)<=epsilon)polygon.pop();
      if(polygon.length<3)return [];
    }
    return simplify(polygon);
  }
  function subtractKnownFloor(pieces){
    function halfPlane(polygon,a,c,sign){
      const out=[],length=Math.hypot(c.x-a.x,c.y-a.y);
      if(length<=epsilon)return polygon;
      const signed=p=>((c.x-a.x)*(p.y-a.y)-(c.y-a.y)*(p.x-a.x))/length*sign;
      for(let i=0;i<polygon.length;i++){
        const p=polygon[i],q=polygon[(i+1)%polygon.length],dp=signed(p),dq=signed(q);
        if(dp>=-epsilon)out.push(p);
        if((dp>=-epsilon)!==(dq>=-epsilon)){const ratio=dp/(dp-dq);out.push({x:p.x+(q.x-p.x)*ratio,y:p.y+(q.y-p.y)*ratio});}
      }
      const cleaned=out.filter((p,i)=>!i||Math.hypot(p.x-out[i-1].x,p.y-out[i-1].y)>epsilon);
      if(cleaned.length>1&&Math.hypot(cleaned[0].x-cleaned[cleaned.length-1].x,cleaned[0].y-cleaned[cleaned.length-1].y)<=epsilon)cleaned.pop();
      return cleaned.length>=3?simplify(cleaned):[];
    }
    for(const triangle of exclusionTriangles){
      const [a,c,d]=triangle,orientation=Math.sign((c.x-a.x)*(d.y-a.y)-(c.y-a.y)*(d.x-a.x));
      if(!orientation)continue;
      const next=[],box=atRingBBox(triangle);
      for(const piece of pieces){
        const pb=atRingBBox(piece);
        if(pb.maxx<=box.minx+epsilon||pb.minx>=box.maxx-epsilon||pb.maxy<=box.miny+epsilon||pb.miny>=box.maxy-epsilon){next.push(piece);continue;}
        let remaining=piece;
        for(let edge=0;edge<3&&remaining.length>=3;edge++){
          const p=triangle[edge],q=triangle[(edge+1)%3],outside=halfPlane(remaining,p,q,-orientation);
          if(outside.length>=3&&atRingAreaM2(outside)>epsilon*epsilon)next.push(outside);
          remaining=halfPlane(remaining,p,q,orientation);
        }
      }
      pieces=next;
    }
    return pieces;
  }
  for(let iy=0; iy<ny; iy++){
    for(let ix=0; ix<nx; ix++){
      const cx=(ux[ix]+ux[ix+1])/2, cy=(uy[iy]+uy[iy+1])/2;
      if(triangles.length){
        const raw=triangles.map(t=>clipTriangle(t,ux[ix],ux[ix+1],uy[iy],uy[iy+1])).filter(r=>r.length>=3&&atRingAreaM2(r)>epsilon*epsilon);
        const pieces=subtractKnownFloor(raw);
        if(pieces.length){
          const id=idx(ix,iy),area=pieces.reduce((n,r)=>n+atRingAreaM2(r),0);
          occ[id]=1;occupied++;cellPieces.set(id,pieces);
          if(Math.abs(area-(ux[ix+1]-ux[ix])*(uy[iy+1]-uy[iy]))>epsilon)partialCells.add(id);
        }
      }else if(insidePlate(cx,cy)){occ[idx(ix,iy)]=1;occupied++;}
    }
  }
  function blockedX(x, y0, y1){
    return xWalls.some(function(s){
      return Math.abs(s.x-x)<0.03 && s.y0<y1-1e-4 && s.y1>y0+1e-4;
    });
  }
  function blockedY(y, x0, x1){
    return yWalls.some(function(s){
      return Math.abs(s.y-y)<0.03 && s.x0<x1-1e-4 && s.x1>x0+1e-4;
    });
  }
  const seen=new Uint8Array(nx*ny);
  const rings=[];
  function clippedOutlines(cells){
    const pieces=cells.flatMap(([x,y])=>cellPieces.get(idx(x,y))||[]),points=[],buckets=new Map();
    const signed=ring=>ring.reduce((n,p,i)=>{const q=ring[(i+1)%ring.length];return n+(p.x-ring[0].x)*(q.y-ring[0].y)-(q.x-ring[0].x)*(p.y-ring[0].y);},0)/2;
    function pointId(p){
      const gx=Math.floor((p.x-b.minx)/epsilon),gy=Math.floor((p.y-b.miny)/epsilon);
      for(let x=gx-1;x<=gx+1;x++)for(let y=gy-1;y<=gy+1;y++)for(const id of buckets.get(x+','+y)||[])
        if(Math.hypot(points[id].x-p.x,points[id].y-p.y)<=epsilon)return id;
      const id=points.length,key=gx+','+gy;points.push(p);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(id);return id;
    }
    const polys=pieces.map(r=>{const p=simplify(r);if(signed(p)<0)p.reverse();return p.map(pointId);}),segments=[];
    const unique=new Set();
    for(const poly of polys){
      const signature=poly.slice().sort((a,c)=>a-c).join(',');if(unique.has(signature))continue;unique.add(signature);
      poly.forEach((from,i)=>segments.push([from,poly[(i+1)%poly.length]]));
    }
    const edges=new Map();
    for(const [from,to] of segments){
      const a=points[from],c=points[to],dx=c.x-a.x,dy=c.y-a.y,length2=dx*dx+dy*dy;
      if(length2<=epsilon*epsilon)continue;
      const split=[];
      points.forEach((p,id)=>{
        if(p.x<Math.min(a.x,c.x)-epsilon||p.x>Math.max(a.x,c.x)+epsilon||p.y<Math.min(a.y,c.y)-epsilon||p.y>Math.max(a.y,c.y)+epsilon)return;
        const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/length2;
        if(t>=-epsilon&&t<=1+epsilon&&Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=epsilon)split.push({id,t});
      });
      split.sort((p,q)=>p.t-q.t);
      for(let i=0;i<split.length-1;i++){
        const p=split[i].id,q=split[i+1].id;if(p===q)continue;
        const key=Math.min(p,q)+'|'+Math.max(p,q);if(!edges.has(key))edges.set(key,[]);edges.get(key).push([p,q]);
      }
    }
    const next=new Map(),incoming=new Set();let simple=true;
    for(const list of edges.values()){
      if(list.length===2&&list[0][0]===list[1][1]&&list[0][1]===list[1][0])continue;
      if(list.length!==1||next.has(list[0][0])||incoming.has(list[0][1])){simple=false;break;}
      next.set(list[0][0],list[0][1]);incoming.add(list[0][1]);
    }
    const used=new Set(),outlines=[];
    if(simple)for(const start of next.keys()){
      if(used.has(start))continue;
      let current=start;const ring=[];
      do{
        if(used.has(current)||!next.has(current)){simple=false;break;}
        used.add(current);ring.push(points[current]);current=next.get(current);
      }while(current!==start&&ring.length<=next.size);
      if(!simple||current!==start){simple=false;break;}outlines.push(simplify(ring));
    }
    if(simple&&outlines.length&&outlines.every(r=>signed(r)>0))return outlines;
    plate.roomLayoutDiagnostics=['AT_ROOM_FOOTPRINT_DECOMPOSED'];
    return pieces;
  }
  function cellOutlines(cells,keep){
    if(cells.some(([x,y])=>partialCells.has(idx(x,y))))return clippedOutlines(cells);
    const edges=[],outgoing=new Map(),incoming=new Map();
    const point=(x,y)=>x+','+y;
    const add=(x0,y0,x1,y1)=>{
      const from=point(x0,y0),to=point(x1,y1);edges.push({from,to,x:x0,y:y0});
      if(outgoing.has(from)||incoming.has(to))return false;
      outgoing.set(from,{to,x:x0,y:y0});incoming.set(to,from);return true;
    };
    let simple=true;
    for(const [x,y] of cells){
      if(y===0||!keep[idx(x,y-1)])simple=add(x,y,x+1,y)&&simple;
      if(x===nx-1||!keep[idx(x+1,y)])simple=add(x+1,y,x+1,y+1)&&simple;
      if(y===ny-1||!keep[idx(x,y+1)])simple=add(x+1,y+1,x,y+1)&&simple;
      if(x===0||!keep[idx(x-1,y)])simple=add(x,y+1,x,y)&&simple;
    }
    const loops=[],used=new Set();
    if(simple)for(const edge of edges){
      if(used.has(edge.from))continue;
      const ring=[];let current=edge.from;
      do{
        if(used.has(current)||!outgoing.has(current)){simple=false;break;}
        const p=outgoing.get(current);used.add(current);ring.push({x:ux[p.x],y:uy[p.y]});current=p.to;
      }while(current!==edge.from&&ring.length<=edges.length);
      if(!simple||current!==edge.from){simple=false;break;}loops.push(simplify(ring));
    }
    if(simple&&loops.length===1)return loops;
    // A hole or point pinch cannot be represented by one simple room ring.
    // Keep exact occupied strips instead of filling their bounding rectangle.
    plate.roomLayoutDiagnostics=['AT_ROOM_FOOTPRINT_DECOMPOSED'];
    const strips=[],active=new Map();
    for(let y=0;y<ny;y++){
      const next=new Map();
      for(let x=0;x<nx;){
        if(!keep[idx(x,y)]){x++;continue;}
        const start=x;while(x<nx&&keep[idx(x,y)])x++;
        const key=start+'|'+x,previous=active.get(key);
        if(previous){previous.maxy=uy[y+1];next.set(key,previous);}
        else {const rectangle={minx:ux[start],maxx:ux[x],miny:uy[y],maxy:uy[y+1]};strips.push(rectangle);next.set(key,rectangle);}
      }
      active.clear();next.forEach((value,key)=>active.set(key,value));
    }
    return strips.map(atRectRing);
  }
  for(let iy=0; iy<ny; iy++){
    for(let ix=0; ix<nx; ix++){
      const start=idx(ix,iy);
      if(!occ[start] || seen[start]) continue;
      const q=[[ix,iy]];
      seen[start]=1;
      const cells=[];
      while(q.length){
        const cur=q.pop();
        const cx=cur[0], cy=cur[1];
        cells.push(cur);
        const nbs=[[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]];
        nbs.forEach(function(nb){
          const jx=nb[0], jy=nb[1];
          if(jx<0||jy<0||jx>=nx||jy>=ny) return;
          const j=idx(jx,jy);
          if(!occ[j] || seen[j]) return;
          if(jy===cy){
            const xLine=jx>cx ? ux[jx] : ux[cx];
            if(blockedX(xLine, uy[cy], uy[cy+1])) return;
          }else{
            const yLine=jy>cy ? uy[jy] : uy[cy];
            if(blockedY(yLine, ux[cx], ux[cx+1])) return;
          }
          seen[j]=1;
          q.push([jx,jy]);
        });
      }
      if(cells.length<1) continue;
      const keep=new Uint8Array(nx*ny);
      cells.forEach(function(c){ keep[idx(c[0],c[1])]=1; });
      const cleaned=cells.length===occupied&&originals.length===1&&!exclusions.length?originals:cellOutlines(cells,keep);
      cleaned.filter(r=>r&&r.length>=3&&atRingAreaM2(r)>0.15).forEach(r=>rings.push(r));
    }
  }
  return rings.length ? rings : exclusions.length?[]:originals;
}
function atRoomFloorPlates(meshFaces){
  const faces=meshFaces||[];
  const floorCandidates=faces.filter(function(f){
    if(atIsFloorFace(f)) return true;
    // The legacy material classifier labels floors above 2F as ceilings.
    // A horizontal face with a full-height story above is also a floor candidate.
    if(f.sslKey!=='innerwall' || f.nameJa!=='天井') return false;
    const z=atFaceZ(f), b=atFaceBBox(f);
    if((f.verts||[]).some(v=>Math.abs(v.z-z)>0.05)) return false;
    return atStoryWalls(faces,z).some(w=>{
      const bb=atFaceBBox(w), zs=(w.verts||[]).map(v=>v.z);
      return Math.min(...zs)>=z-0.15 && Math.max(...zs)>z+1.8 &&
        bb.maxx>=b.minx-0.1 && bb.minx<=b.maxx+0.1 && bb.maxy>=b.miny-0.1 && bb.miny<=b.maxy+0.1;
    });
  });
  const floors=floorCandidates.filter(function(f){
    if(!atPlateIsSlabUnderside(f, floorCandidates)) return true;
    atReleaseSlabUnderside(f);
    return false;
  });
  return floors;
}
// Interstory space belongs to the room below. The next actual floor is the
// common EP boundary; the ceiling underside must not create another zone.
function atRoomStoryTop(z, faces, floors){
  const ceiling=atStoryTop(z,faces);
  const upper=(floors||[]).filter(f=>atFaceZ(f)>z+AT_MIN_STORY_M);
  const next=upper.length?Math.min(...upper.map(atFaceZ)):Infinity;
  return next>=ceiling-0.05 && next-ceiling<AT_MIN_STORY_M ? next : ceiling;
}
function atNormalizeRoomStories(rooms, faces){
  if(!faces || !faces.length) return rooms||[];
  const floors=atRoomFloorPlates(faces);
  if(!floors.length) return rooms||[];
  const levels=atUniq(floors.map(atFaceZ),0.05);
  return (rooms||[]).filter(r=>levels.some(z=>Math.abs(z-r.z)<0.025)).map(r=>{
    const i=levels.findIndex(z=>Math.abs(z-r.z)<0.025);
    r.floor=i+1;
    const top=atRoomStoryTop(r.z,faces,floors);
    // Extend existing room assignments, retaining their keys and load settings.
    if(top>r.zTop && top-r.zTop<AT_MIN_STORY_M)r.zTop=top;
    return r;
  });
}
function atBuildRoomsFromFaces(meshFaces, stats){
  const faces=meshFaces||[], floors=atRoomFloorPlates(faces);
  if(!floors.length) return [];
  const bands={};
  floors.forEach(function(f){
    const z=Math.round(atFaceZ(f)/0.05)*0.05;
    if(!bands[z]) bands[z]=[];
    bands[z].push(f);
  });
  const zs=Object.keys(bands).map(Number).sort(function(a,b){ return a-b; });
  const rooms=[];
  zs.forEach(function(z, si){
    const plates=bands[z];
    const walls=atStoryWalls(faces, z);
    plates.forEach(function(plate, pi){
      const splitters=walls.filter(function(w){
        const s=atWallSeg(w);
        return s && atSegMidInside(s, plate, 0.08);
      });
      const rings=atSplitPlate(plate,splitters);
      rings.forEach(function(ring){
        const bb=atRingBBox(ring);
        const area=atRingAreaM2(ring);
        if(!(area>0.2)) return;
        rooms.push({
          key:'at-mesh-'+si+'-'+rooms.length,
          floor: si+1,
          z: atFaceZ(plate),
          zTop:atRoomStoryTop(atFaceZ(plate),faces,floors),
          area:area,
          dx:bb.dx,
          dy:bb.dy,
          ring:ring,
          name:'',
          habitable:false,
          plate:plate.nameJa||'',
          inferredFloor:!!plate.generatedFloor,
          floorProjectionSource:plate.floorProjectionSource||'',
          floorFaceIds:plate.atFaceId?[plate.atFaceId]:[],
          floorReviewed:!plate.generatedFloor
        });
      });
    });
  });
  atRekeyRooms(rooms);
  return atMergeCantileverRooms(rooms, faces);
}
function atRoomHeight(r){
  return r && isFinite(r.zTop) && isFinite(r.z) ? Math.max(0, r.zTop-r.z) : 0;
}
function atRoomVolume(r){
  return r && isFinite(r.area) ? r.area*atRoomHeight(r) : 0;
}
function atMeshLivingVolume(mesh){
  return ((mesh&&mesh.rooms)||[]).filter(function(r){ return r.habitable&&!r.floorVoid; })
    .reduce(function(sum,r){ return sum+atRoomVolume(r); },0);
}
function atMeshWindowKeys(mesh){
  const keys={};
  const src=(mesh && mesh.meshFaces) ? mesh
    : ((typeof reviewMesh==='function' && reviewMesh() && reviewMesh().meshFaces) ? reviewMesh() : mesh);
  if(!src || typeof atAssignWindowsToRooms!=='function') return keys;
  (atAssignWindowsToRooms(src.meshFaces, (mesh && mesh.rooms) || src.rooms, src.stats)||[]).forEach(function(w){
    if(w.roomKey) keys[w.roomKey]=true;
  });
  return keys;
}
function atRoomNeedsGain(r, winKeys){
  if(!r||r.floorVoid) return false;
  return !!(r.habitable || r.keep || r.explicitGainTarget || (winKeys && winKeys[r.key]));
}
function atApplyRoomGainFlags(mesh){
  if(!mesh || !mesh.rooms) return {};
  const winKeys=atMeshWindowKeys(mesh);
  mesh.rooms.forEach(function(r){
    r.keep=!r.floorVoid&&!!(r.habitable || r.explicitGainTarget || winKeys[r.key]);
  });
  return winKeys;
}
function atStoryWalls(faces, z){
  if(!Number.isFinite(z)) return [];
  const out=[], probe=z+0.8, eps=1e-7;
  (faces||[]).forEach(function(w){
    if(!atIsPartition(w)) return;
    const vs=w.verts||[];
    const validVertex=v=>v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    let tris=(w.tris||[]).filter(t=>t && t.length===3 && t.every(i=>Number.isInteger(i) && validVertex(vs[i])));
    // Older polygon faces have no triangle indices. Their ordered contour is
    // the source, rather than the enclosing rectangle of all wall vertices.
    if(!(w.tris&&w.tris.length) && vs.length>=3 && vs.every(validVertex)){
      tris=[];
      for(let i=1;i<vs.length-1;i++) tris.push([0,i,i+1]);
    }
    if(!tris.length) return;

    // Coplanar 3DS groups can contain disconnected walls on different floors.
    // Keep each edge-connected component's real vertical extent, including
    // when a horizontal face named ceiling is tested as a possible floor.
    const parents=tris.map((t,i)=>i), edges=new Map();
    function root(i){
      while(parents[i]!==i){ parents[i]=parents[parents[i]]; i=parents[i]; }
      return i;
    }
    function pointKey(v){return [v.x,v.y,v.z].map(n=>Math.round(n/eps)).join(',');}
    tris.forEach(function(t,i){
      for(let j=0;j<3;j++){
        const a=pointKey(vs[t[j]]),b=pointKey(vs[t[(j+1)%3]]);
        if(a===b) continue;
        const key=a<b?a+'|'+b:b+'|'+a;
        if(edges.has(key)) parents[root(i)]=root(edges.get(key));
        else edges.set(key,i);
      }
    });
    const components=new Map();
    tris.forEach(function(t,i){
      const r=root(i);
      if(!components.has(r)) components.set(r,[]);
      components.get(r).push(t);
    });
    components.forEach(function(ts){
      const ids=Array.from(new Set(ts.flat())),sourceVerts=ids.map(i=>vs[i]);
      const zs=sourceVerts.map(v=>v.z);
      if(!(Math.min(...zs)<z+0.4 && Math.max(...zs)>probe)) return;
      const box=atFaceBBox({verts:sourceVerts});
      const axis=box.dx<0.08 && box.dy>=0.3?'x':box.dy<0.08 && box.dx>=0.3?'y':null;
      if(!axis) return;
      const intervals=[], points=[];
      ts.forEach(function(t){
        const ps=[];
        function add(p){
          if(!ps.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<eps)) ps.push(p);
        }
        for(let j=0;j<3;j++){
          const a=vs[t[j]],b=vs[t[(j+1)%3]],da=a.z-probe,db=b.z-probe;
          if(Math.abs(da)<eps) add({x:a.x,y:a.y});
          if((da<-eps && db>eps)||(da>eps && db<-eps)){
            const ratio=(probe-a.z)/(b.z-a.z);
            add({x:a.x+(b.x-a.x)*ratio,y:a.y+(b.y-a.y)*ratio});
          }
        }
        if(ps.length<2) return;
        // A horizontal cap is not evidence for a vertical room partition.
        if(t.every(i=>Math.abs(vs[i].z-probe)<eps)) return;
        const coords=ps.map(p=>axis==='x'?p.y:p.x),a=Math.min(...coords),b=Math.max(...coords);
        if(b-a>eps){ intervals.push([a,b]); points.push(...ps); }
      });
      if(!intervals.length) return;
      intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
      const spans=[];
      intervals.forEach(function(s){
        const last=spans[spans.length-1];
        if(last && s[0]<=last[1]+eps) last[1]=Math.max(last[1],s[1]);
        else spans.push(s.slice());
      });
      const remap=new Map(ids.map((id,i)=>[id,i]));
      spans.forEach(function(s){
        if(s[1]-s[0]<0.3) return;
        const local=points.filter(p=>(axis==='x'?p.y:p.x)>=s[0]-eps && (axis==='x'?p.y:p.x)<=s[1]+eps);
        const offsets=local.map(p=>axis==='x'?p.x:p.y);
        const v=(Math.min(...offsets)+Math.max(...offsets))/2;
        const segment=axis==='x'?{x:v,y0:s[0],y1:s[1],axis:'x'}:{y:v,x0:s[0],x1:s[1],axis:'y'};
        out.push(Object.assign({},w,{verts:sourceVerts,tris:ts.map(t=>t.map(i=>remap.get(i))),_atStorySegment:segment}));
      });
    });
  });
  return out;
}
function atRekeyRooms(rooms){
  (rooms||[]).forEach(function(r, i){
    r.key='at-mesh-'+r.floor+'-'+i;
  });
  return rooms;
}
function atRoomsShareOpenEdge(a, b, walls, minFrac){
  const A=atRingBBox(a.ring), B=atRingBBox(b.ring);
  const tol=0.06;
  const xOv=Math.min(A.maxx,B.maxx)-Math.max(A.minx,B.minx);
  const yOv=Math.min(A.maxy,B.maxy)-Math.max(A.miny,B.miny);
  let shared=null, coverRef=0;
  if(xOv>0.2 && Math.abs(A.maxy-B.miny)<tol){ shared={axis:'y', v:A.maxy, a0:Math.max(A.minx,B.minx), a1:Math.min(A.maxx,B.maxx)}; coverRef=Math.max(A.dx,B.dx); }
  else if(xOv>0.2 && Math.abs(B.maxy-A.miny)<tol){ shared={axis:'y', v:B.maxy, a0:Math.max(A.minx,B.minx), a1:Math.min(A.maxx,B.maxx)}; coverRef=Math.max(A.dx,B.dx); }
  else if(yOv>0.2 && Math.abs(A.maxx-B.minx)<tol){ shared={axis:'x', v:A.maxx, a0:Math.max(A.miny,B.miny), a1:Math.min(A.maxy,B.maxy)}; coverRef=Math.max(A.dy,B.dy); }
  else if(yOv>0.2 && Math.abs(B.maxx-A.minx)<tol){ shared={axis:'x', v:B.maxx, a0:Math.max(A.miny,B.miny), a1:Math.min(A.maxy,B.maxy)}; coverRef=Math.max(A.dy,B.dy); }
  if(!shared) return false;
  const span=shared.a1-shared.a0;
  if(!(span>0.2)) return false;
  if(minFrac>0 && coverRef>0 && span<minFrac*coverRef) return false;
  const blocked=(walls||[]).some(function(w){
    const s=atWallSeg(w);
    if(!s || s.axis!==shared.axis) return false;
    if(shared.axis==='x'){
      if(Math.abs(s.x-shared.v)>0.05) return false;
      return (Math.min(s.y1, shared.a1)-Math.max(s.y0, shared.a0)) > 0.45*span;
    }
    if(Math.abs(s.y-shared.v)>0.05) return false;
    return (Math.min(s.x1, shared.a1)-Math.max(s.x0, shared.a0)) > 0.45*span;
  });
  return !blocked;
}
function atUnionRoomRings(a, b){
  const A=atRingBBox(a.ring), B=atRingBBox(b.ring);
  const U={
    minx:Math.min(A.minx,B.minx), maxx:Math.max(A.maxx,B.maxx),
    miny:Math.min(A.miny,B.miny), maxy:Math.max(A.maxy,B.maxy)
  };
  U.dx=U.maxx-U.minx; U.dy=U.maxy-U.miny;
  if(Math.abs(U.dx*U.dy-(a.area+b.area))<0.12) return atRectRing(U);
  const xs=[A.minx,A.maxx,B.minx,B.maxx], ys=[A.miny,A.maxy,B.miny,B.maxy];
  (a.ring||[]).forEach(function(p){ xs.push(p.x); ys.push(p.y); });
  (b.ring||[]).forEach(function(p){ xs.push(p.x); ys.push(p.y); });
  const ux=atUniq(xs, 0.02), uy=atUniq(ys, 0.02);
  const nx=ux.length-1, ny=uy.length-1;
  if(typeof epGridOutlines==='function' && nx>0 && ny>0){
    const rings=epGridOutlines(ux, uy, nx, ny, function(ix, iy){
      const cx=(ux[ix]+ux[ix+1])/2, cy=(uy[iy]+uy[iy+1])/2;
      return atPointInRing(cx, cy, a.ring) || atPointInRing(cx, cy, b.ring);
    })||[];
    if(rings.length){
      rings.sort(function(p,q){ return atRingAreaM2(q)-atRingAreaM2(p); });
      return rings[0];
    }
  }
  return atRectRing(U);
}
function atJoinedRoom(a, b){
  const ring=atUnionRoomRings(a, b);
  const bb=atRingBBox(ring);
  return {
    key:a.key,
    floor:a.floor,
    z:a.z,
    zTop:Math.max(a.zTop, b.zTop),
    area:atRingAreaM2(ring),
    dx:bb.dx,
    dy:bb.dy,
    ring:ring,
    name:'',
    habitable:false,
    plate:(a.plate==='2F床' || b.plate==='2F床') ? '2F床' : (a.plate||b.plate||'')
  };
}
function atMergeCantileverRooms(rooms, faces){
  const list=(rooms||[]).slice();
  let changed=true, guard=0;
  while(changed && guard++<20){
    changed=false;
    outer: for(let i=0;i<list.length;i++){
      const walls=atStoryWalls(faces, list[i].z);
      for(let j=i+1;j<list.length;j++){
        if(list[i].floor!==list[j].floor) continue;
        if(list[i].inferredFloor||list[j].inferredFloor)continue;
        const pi=list[i].plate, pj=list[j].plate;
        if(!((pi==='2F床' && pj==='内床') || (pi==='内床' && pj==='2F床'))) continue;
        if(!atRoomsShareOpenEdge(list[i], list[j], walls, 0.85)) continue;
        list[i]=atJoinedRoom(list[i], list[j]);
        list.splice(j,1);
        changed=true;
        break outer;
      }
    }
  }
  return atRekeyRooms(list);
}
function atPdfAreaHit(pdfRooms, area, floor){
  return (pdfRooms||[]).some(function(p){
    if(!(p.area>0)) return false;
    if(p.floor && floor && String(p.floor)!==String(floor) && p.floor!=='R') return false;
    return Math.abs(p.area-area)<0.08;
  });
}
function atMergeRoomsByPdf(rooms, pdfRooms, faces){
  const list=(rooms||[]).slice();
  // Once reviewed, geometry and stable room keys belong to the designer.
  if(list.some(function(r){ return r.manualAssignment; })) return list;
  if(!list.length || !(pdfRooms||[]).length) return atRekeyRooms(list);
  let changed=true, guard=0;
  while(changed && guard++<40){
    changed=false;
    outer: for(let i=0;i<list.length;i++){
      const walls=atStoryWalls(faces, list[i].z);
      for(let j=i+1;j<list.length;j++){
        if(list[i].floor!==list[j].floor) continue;
        if(list[i].inferredFloor||list[j].inferredFloor)continue;
        const aHit=atPdfAreaHit(pdfRooms, list[i].area, list[i].floor);
        const bHit=atPdfAreaHit(pdfRooms, list[j].area, list[j].floor);
        if(aHit && bHit) continue;
        const sum=list[i].area+list[j].area;
        if(!atPdfAreaHit(pdfRooms, sum, list[i].floor)) continue;
        if(!atRoomsShareOpenEdge(list[i], list[j], walls, 0.45)) continue;
        list[i]=atJoinedRoom(list[i], list[j]);
        list.splice(j,1);
        changed=true;
        break outer;
      }
    }
  }
  return atRekeyRooms(list);
}
function atInsetRing(ring, setback){
  const src=(ring||[]).map(function(p){ return {x:p.x,y:p.y}; });
  if(src.length<3 || !(setback>0)) return src;
  let signed=0;
  for(let i=0;i<src.length;i++){
    const p=src[i], q=src[(i+1)%src.length];
    signed+=p.x*q.y-q.x*p.y;
  }
  const ccw=signed>=0;
  const lines=[];
  for(let i=0;i<src.length;i++){
    const p=src[i], q=src[(i+1)%src.length];
    const dx=q.x-p.x, dy=q.y-p.y, len=Math.hypot(dx,dy);
    if(len<1e-6) return [];
    const nx=(ccw?-dy:dy)/len, ny=(ccw?dx:-dx)/len;
    lines.push({p:{x:p.x+nx*setback,y:p.y+ny*setback},d:{x:dx,y:dy}});
  }
  function cross(a,b){ return a.x*b.y-a.y*b.x; }
  const out=[];
  for(let i=0;i<src.length;i++){
    const a=lines[(i-1+lines.length)%lines.length], b=lines[i];
    const den=cross(a.d,b.d);
    let v;
    if(Math.abs(den)<1e-9){
      v={x:(a.p.x+b.p.x)/2,y:(a.p.y+b.p.y)/2};
    }else{
      const t=cross({x:b.p.x-a.p.x,y:b.p.y-a.p.y},b.d)/den;
      v={x:a.p.x+a.d.x*t,y:a.p.y+a.d.y*t};
    }
    if(Math.hypot(v.x-src[i].x,v.y-src[i].y)>setback*5) return [];
    out.push(v);
  }
  const clean=[];
  out.forEach(function(p){
    if(!clean.length || Math.hypot(p.x-clean[clean.length-1].x,p.y-clean[clean.length-1].y)>1e-5) clean.push(p);
  });
  if(clean.length>2 && Math.hypot(clean[0].x-clean[clean.length-1].x,clean[0].y-clean[clean.length-1].y)<1e-5) clean.pop();
  if(clean.length<3 || !(atRingAreaM2(clean)<atRingAreaM2(src)-1e-4)) return [];
  // An inward offset must remain in the source footprint.  This also rejects
  // self-crossing results when a corridor is narrower than twice the setback.
  const valid=clean.every(function(p){ return atPointInRing(p.x,p.y,src); });
  return valid ? clean : [];
}
function atBuildGainVolumes(mesh){
  const rooms=(mesh && mesh.rooms)||[];
  const winKeys=atMeshWindowKeys(mesh);
  const capacity=typeof GAIN_VOLUME_COLOR_CAPACITY==='number'?GAIN_VOLUME_COLOR_CAPACITY:128;
  const capacityExceeded=rooms.some((r,i)=>i>=capacity&&atRoomNeedsGain(r,winKeys));
  if(mesh)mesh.gainColorError=capacityExceeded?'GAIN_COLOR_CAPACITY_EXCEEDED':'';
  if(capacityExceeded)return [];
  const setback=(typeof GAIN_VOLUME_SETBACK_M==='number') ? GAIN_VOLUME_SETBACK_M : 0.3;
  const vols=[];
  rooms.forEach(function(r, i){
    if(!atRoomNeedsGain(r, winKeys)) return;
    let used=setback;
    let inner=atInsetRing(r.ring, used);
    if(atRingAreaM2(inner)<0.2 && used>0.12){
      used=0.1;
      inner=atInsetRing(r.ring, used);
    }
    if(atRingAreaM2(inner)<0.15) inner=r.ring;
    const zb=r.z+used;
    const zt=r.zTop-used;
    if(!(zt>zb+0.4)) return;
    const bot=inner.map(function(p){ return {x:p.x, y:p.y, z:zb}; });
    const top=inner.map(function(p){ return {x:p.x, y:p.y, z:zt}; });
    const faces=[];
    if(typeof epPrismFacesFromRings==='function'){
      epPrismFacesFromRings(bot, top).forEach(function(face){ faces.push(face); });
    }else{
      faces.push({verts:bot.slice().reverse()}, {verts:top.slice()});
    }
    const col=(typeof gainVolumeColor==='function') ? gainVolumeColor(i) : {r:255,g:176,b:168, mat:'GAIN'+i};
    const name=r.name||('部屋'+(i+1));
    vols.push({
      zone:name, color:col, faces:faces, prisms:[{bot:bot, top:top}],
      setback:used, how:'footprint', roomKey:r.key
    });
  });
  return vols;
}
function atNorthDeg(){
  if(typeof reviewView==='function'){
    const v=reviewView();
    if(v && isFinite(v.northDeg)) return v.northDeg;
  }
  return 0;
}
function atAzFromFace(f){
  if(f && isFinite(f.modelToolAz)) return at3dsWrap180(f.modelToolAz-atNorthDeg());
  const vs=f.verts||[];
  if(vs.length<3) return 0;
  let nx=0, ny=0, nz=0;
  for(let i=0;i<vs.length;i++){
    const a=vs[i], b=vs[(i+1)%vs.length];
    nx+=(a.y-b.y)*(a.z+b.z);
    ny+=(a.z-b.z)*(a.x+b.x);
    nz+=(a.x-b.x)*(a.y+b.y);
  }
  const n={x:nx, y:ny, z:nz};
  return typeof at3dsToolAzFromNormal==='function' ? at3dsToolAzFromNormal(n,atNorthDeg()) : 0;
}
function atOrientFromFace(f){
  const az=atAzFromFace(f);
  if(typeof at3dsOrientFromToolAz==='function') return at3dsOrientFromToolAz(az);
  return '南';
}
function atWindowFloor(f, floorZ){
  const z=atFaceZ(f);
  const base=(floorZ!=null ? floorZ/1000 : 0.55);
  if(z<base+2.6) return '1';
  if(z<base+5.2) return '2';
  return 'R';
}
function atPointInRing(x, y, ring){
  if(typeof epPointInPoly2==='function') return epPointInPoly2(x, y, ring);
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i].x, yi=ring[i].y, xj=ring[j].x, yj=ring[j].y;
    if(((yi>y)!==(yj>y)) && (x<(xj-xi)*(y-yi)/((yj-yi)||1e-20)+xi)) inside=!inside;
  }
  return inside;
}
function atDistPointToRing(x, y, ring){
  let best=Infinity;
  const pts=ring||[];
  for(let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length];
    const vx=b.x-a.x, vy=b.y-a.y;
    const len2=vx*vx+vy*vy||1e-12;
    let t=((x-a.x)*vx+(y-a.y)*vy)/len2;
    t=Math.max(0, Math.min(1, t));
    best=Math.min(best, Math.hypot(x-(a.x+t*vx), y-(a.y+t*vy)));
  }
  return best;
}
function atRoomIsStair(r){
  return typeof atIsStairRoom==='function' && atIsStairRoom(r);
}
function atAssignWindowsToRooms(meshFaces, rooms, stats){
  const wins=(meshFaces||[]).filter(function(f){ return f.sslKey==='window'; });
  const floorZ=stats && stats.floorZ;
  return wins.map(function(f){
    const b=atFaceBBox(f);
    const cx=(b.minx+b.maxx)/2, cy=(b.miny+b.maxy)/2;
    const orient=atOrientFromFace(f);
    const az=atAzFromFace(f);
    const vs=f.verts||[];
    let nx=0, ny=0;
    for(let i=0;i<vs.length;i++){
      const p=vs[i], q=vs[(i+1)%vs.length];
      nx+=(p.y-q.y)*(p.z+q.z);
      ny+=(p.z-q.z)*(p.x+q.x);
    }
    const nlen=Math.hypot(nx, ny)||1;
    nx/=nlen; ny/=nlen;
    const area=f.area ? f.area/1e6 : (function(){
      const zs=vs.map(function(v){ return v.z; });
      return b.dx*Math.abs(Math.max.apply(null, zs)-Math.min.apply(null, zs));
    })();
    const windowZ=atFaceZ(f);
    const story=(rooms||[]).filter(r=>windowZ>=r.z-0.1 && windowZ<=r.zTop+0.1).sort((a,b)=>b.z-a.z)[0];
    const floor=story ? String(story.floor) : atWindowFloor(f, floorZ);
    const probes=[
      [cx, cy],
      [cx-nx*0.15, cy-ny*0.15],
      [cx+nx*0.15, cy+ny*0.15]
    ];
    const same=(rooms||[]).filter(function(r){
      return String(r.floor)===floor || (floor==='R' && r.floor>=2);
    });
    const hits=same.filter(function(r){
      return probes.some(function(p){ return atPointInRing(p[0], p[1], r.ring); });
    });
    // Extending a stair into the next room overlaps that room. The window stays
    // on the non-stair room, including when it still sits on that room's wall.
    const plain=hits.filter(function(r){ return !atRoomIsStair(r); });
    let room=plain.length ? plain[plain.length-1] : null;
    if(!room && hits.length){
      let edge=null, edgeD=0.25;
      same.forEach(function(r){
        if(atRoomIsStair(r)) return;
        const d=atDistPointToRing(cx, cy, r.ring);
        if(d<edgeD){ edgeD=d; edge=r; }
      });
      room=edge || hits[hits.length-1];
    }
    if(!room){
      const nearby=same.map(function(r){ return {room:r,distance:atDistPointToRing(cx,cy,r.ring)}; })
        .filter(function(candidate){ return candidate.distance<0.65; });
      const plainNear=nearby.filter(function(candidate){ return !atRoomIsStair(candidate.room); });
      // The missing corner of a concave room is not part of that room.
      // Preserve non-stair priority, but never break a distance tie by order.
      const candidates=plainNear.length ? plainNear : nearby;
      const nearestDistance=Math.min.apply(null,candidates.map(function(candidate){ return candidate.distance; }));
      const nearest=candidates.filter(function(candidate){ return Math.abs(candidate.distance-nearestDistance)<=1e-7; });
      room=nearest.length===1 ? nearest[0].room : null;
    }
    return {
      face:f, area:area, floor:floor, orient:orient, az:az, cx:cx, cy:cy,
      roomKey:room ? room.key : '', roomName:room ? room.name : ''
    };
  });
}
if(typeof module!=='undefined' && module.exports){
  module.exports={
    atBuildRoomsFromFaces:atBuildRoomsFromFaces,
    atBuildGainVolumes:atBuildGainVolumes,
    atRoomVolume:atRoomVolume,
    atMeshLivingVolume:atMeshLivingVolume,
    atMeshWindowKeys:atMeshWindowKeys,
    atRoomNeedsGain:atRoomNeedsGain,
    atApplyRoomGainFlags:atApplyRoomGainFlags,
    atAssignWindowsToRooms:atAssignWindowsToRooms,
    atMergeRoomsByPdf:atMergeRoomsByPdf
  };
}

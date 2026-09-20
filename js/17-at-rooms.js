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
  if(f.tris && f.tris.length && vs.length){
    return f.tris.some(function(t){
      const a=vs[t[0]], b=vs[t[1]], c=vs[t[2]];
      if(!a||!b||!c) return false;
      if(typeof at3dsPointInTriXY==='function') return at3dsPointInTriXY(x, y, a, b, c);
      return false;
    });
  }
  const b=atFaceBBox(f);
  return x>=b.minx-1e-4 && x<=b.maxx+1e-4 && y>=b.miny-1e-4 && y<=b.maxy+1e-4;
}
function atWallSeg(f){
  const b=atFaceBBox(f);
  const nx=Math.abs(f.verts && f.verts.length>=3 ? (function(){
    const a=f.verts[0], c=f.verts[Math.min(2,f.verts.length-1)];
    return Math.hypot(c.x-a.x, c.y-a.y);
  })() : 0);
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
    if(z>zBot+1.2 && z<best) best=z;
  });
  return isFinite(best) ? best : zBot+2.84;
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
  const xs=[b.minx, b.maxx], ys=[b.miny, b.maxy];
  (plate.verts||[]).forEach(function(v){ xs.push(v.x); ys.push(v.y); });
  const xWalls=[], yWalls=[];
  splitters.forEach(function(w){
    const s=atWallSeg(w);
    if(!s) return;
    if(s.axis==='x'){ xs.push(s.x); xWalls.push(s); }
    else { ys.push(s.y); yWalls.push(s); }
  });
  const ux=atUniq(xs, 0.02), uy=atUniq(ys, 0.02);
  const nx=ux.length-1, ny=uy.length-1;
  if(nx<1 || ny<1) return [atRectRing(b)];
  const occ=new Uint8Array(nx*ny);
  function idx(ix,iy){ return ix+iy*nx; }
  for(let iy=0; iy<ny; iy++){
    for(let ix=0; ix<nx; ix++){
      const cx=(ux[ix]+ux[ix+1])/2, cy=(uy[iy]+uy[iy+1])/2;
      if(atPointInFaceXY(cx, cy, plate)) occ[idx(ix,iy)]=1;
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
      let cleaned=[];
      if(typeof epGridOutlines==='function'){
        cleaned=epGridOutlines(ux, uy, nx, ny, function(i,j){ return keep[idx(i,j)]; })||[];
      }
      cleaned=(cleaned||[]).map(function(r){
        return typeof epSimplifyRing==='function' ? epSimplifyRing(r) : r;
      }).filter(function(r){ return r && r.length>=3 && atRingAreaM2(r)>0.15; });
      if(!cleaned.length){
        let minx=Infinity, maxx=-Infinity, miny=Infinity, maxy=-Infinity;
        cells.forEach(function(c){
          minx=Math.min(minx, ux[c[0]]); maxx=Math.max(maxx, ux[c[0]+1]);
          miny=Math.min(miny, uy[c[1]]); maxy=Math.max(maxy, uy[c[1]+1]);
        });
        if(isFinite(minx) && (maxx-minx)*(maxy-miny)>0.15){
          cleaned=[atRectRing({minx:minx, maxx:maxx, miny:miny, maxy:maxy})];
        }
      }
      if(cleaned.length){
        cleaned.sort(function(a,b){ return atRingAreaM2(b)-atRingAreaM2(a); });
        rings.push(cleaned[0]);
      }
    }
  }
  return rings.length ? rings : [atRectRing(b)];
}
function atBuildRoomsFromFaces(meshFaces, stats){
  const faces=meshFaces||[];
  const floors=faces.filter(function(f){
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
    const zTop=atStoryTop(z, faces);
    const walls=atStoryWalls(faces, z);
    plates.forEach(function(plate, pi){
      const splitters=walls.filter(function(w){
        const s=atWallSeg(w);
        return s && atSegMidInside(s, plate, 0.08);
      });
      const rings=splitters.length ? atSplitPlate(plate, splitters) : [atRectRing(atFaceBBox(plate))];
      rings.forEach(function(ring){
        const bb=atRingBBox(ring);
        const area=atRingAreaM2(ring);
        if(!(area>0.2)) return;
        rooms.push({
          key:'at-mesh-'+si+'-'+rooms.length,
          floor: si+1,
          z: atFaceZ(plate),
          zTop:zTop,
          area:area,
          dx:bb.dx,
          dy:bb.dy,
          ring:ring,
          name:'',
          habitable:false,
          plate:plate.nameJa||''
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
  return ((mesh&&mesh.rooms)||[]).filter(function(r){ return r.habitable; })
    .reduce(function(sum,r){ return sum+atRoomVolume(r); },0);
}
function atMeshWindowKeys(mesh){
  const keys={};
  const src=(mesh && mesh.meshFaces) ? mesh
    : ((typeof atMesh!=='undefined' && atMesh && atMesh.meshFaces) ? atMesh : mesh);
  if(!src || typeof atAssignWindowsToRooms!=='function') return keys;
  (atAssignWindowsToRooms(src.meshFaces, (mesh && mesh.rooms) || src.rooms, src.stats)||[]).forEach(function(w){
    if(w.roomKey) keys[w.roomKey]=true;
  });
  return keys;
}
function atRoomNeedsGain(r, winKeys){
  if(!r) return false;
  return !!(r.habitable || r.keep || (winKeys && winKeys[r.key]));
}
function atApplyRoomGainFlags(mesh){
  if(!mesh || !mesh.rooms) return {};
  const winKeys=atMeshWindowKeys(mesh);
  mesh.rooms.forEach(function(r){
    r.keep=!!(r.habitable || winKeys[r.key]);
  });
  return winKeys;
}
function atStoryWalls(faces, z){
  return (faces||[]).filter(function(w){
    if(!atIsPartition(w)) return false;
    const zs2=[];
    (w.verts||[]).forEach(function(v){ zs2.push(v.z); });
    if(!zs2.length) return false;
    const zmin=Math.min.apply(null, zs2), zmax=Math.max.apply(null, zs2);
    return zmin<z+0.4 && zmax>z+0.8;
  });
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
  return (typeof atRoomView!=='undefined' && isFinite(atRoomView.northDeg)) ? atRoomView.northDeg : 0;
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
    let room=null, bestD=0.65;
    (rooms||[]).forEach(function(r){
      if(String(r.floor)!==floor && !(floor==='R' && r.floor>=2)) return;
      const hit=probes.some(function(p){ return atPointInRing(p[0], p[1], r.ring); });
      if(hit){ room=r; bestD=0; return; }
      if(bestD===0) return;
      const bb=atRingBBox(r.ring);
      const dx=Math.max(0, bb.minx-cx, cx-bb.maxx);
      const dy=Math.max(0, bb.miny-cy, cy-bb.maxy);
      const d=Math.hypot(dx, dy);
      if(d<bestD){ bestD=d; room=r; }
    });
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

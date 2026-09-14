// ========================= Architrend 3DS → 色分けメッシュ =========================
// テクスチャ無し 3DS は外皮のみ（内壁なし）。仕上げ色は家ごとに違うので使わず、
// 幾何で外壁方位・基礎・1F床・屋根・窓に分け、庇を落とし、屋根は外形で切る。
// 両面ポリゴンは建物重心から外向きだけ残す。単位は mm（小さければ m とみなして換算）。

var atMesh = null;

const AT3DS_NAMEJA = {
  wall_北: '外壁北', wall_東: '外壁東', wall_南: '外壁南', wall_西: '外壁西',
  roof: '屋根', floor1: '1F床', found: '基礎', window: '窓'
};
const AT3DS_CARD = [
  {name:'北', az:180}, {name:'東', az:-90}, {name:'南', az:0}, {name:'西', az:90}
];

function at3dsWrap180(deg){
  if(typeof wrap180==='function') return wrap180(deg);
  let a = deg;
  while(a>180) a -= 360;
  while(a<=-180) a += 360;
  return a;
}
function at3dsOrientName(n){
  const azN = Math.atan2(n.x, n.y)*180/Math.PI;
  const toolAz = at3dsWrap180((azN<0?azN+360:azN) - 180);
  let best = '南', bestD = 1e9;
  AT3DS_CARD.forEach(function(o){
    const d = Math.abs(at3dsWrap180(toolAz - o.az));
    if(d<bestD){ bestD=d; best=o.name; }
  });
  return best;
}
function at3dsReadZ(bytes, start, end){
  let i = start;
  while(i<end && bytes[i]!==0) i++;
  let name = '';
  try{ name = new TextDecoder('shift_jis').decode(bytes.subarray(start, i)); }
  catch(err){
    try{ name = new TextDecoder('latin1').decode(bytes.subarray(start, i)); }
    catch(err2){ name = 'OBJ'; }
  }
  return {name:name, next:Math.min(i+1, end)};
}
function at3dsWalk(dv, start, end, fn){
  let pos = start;
  while(pos+6<=end){
    const id = dv.getUint16(pos, true);
    const size = dv.getUint32(pos+2, true);
    if(!(size>=6) || pos+size>end) break;
    fn(id, pos+6, pos+size);
    pos += size;
  }
}
function at3dsApplyMatrix(v, m){
  return {
    x: m[0]*v.x + m[3]*v.y + m[6]*v.z + m[9],
    y: m[1]*v.x + m[4]*v.y + m[7]*v.z + m[10],
    z: m[2]*v.x + m[5]*v.y + m[8]*v.z + m[11]
  };
}
function at3dsParseBuffer(buffer){
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  if(bytes.length<6 || dv.getUint16(0, true)!==0x4D4D){
    throw new Error('3DSではありません（MAINチャンクがありません）');
  }
  const mainEnd = Math.min(dv.getUint32(2, true), bytes.length);
  const objects = [];
  at3dsWalk(dv, 6, mainEnd, function(id, body, end){
    if(id!==0x3D3D) return;
    at3dsWalk(dv, body, end, function(oid, obody, oend){
      if(oid!==0x4000) return;
      const named = at3dsReadZ(bytes, obody, oend);
      const verts = [];
      const faces = [];
      let matrix = null;
      at3dsWalk(dv, named.next, oend, function(tid, tbody, tend){
        if(tid!==0x4100) return;
        at3dsWalk(dv, tbody, tend, function(uid, ubody, uend){
          if(uid===0x4110){
            const n = dv.getUint16(ubody, true);
            for(let i=0;i<n;i++){
              const o = ubody+2+i*12;
              if(o+12>uend) break;
              verts.push({x:dv.getFloat32(o,true), y:dv.getFloat32(o+4,true), z:dv.getFloat32(o+8,true)});
            }
          }else if(uid===0x4120){
            const n = dv.getUint16(ubody, true);
            for(let i=0;i<n;i++){
              const o = ubody+2+i*8;
              if(o+6>uend) break;
              faces.push([dv.getUint16(o,true), dv.getUint16(o+2,true), dv.getUint16(o+4,true)]);
            }
          }else if(uid===0x4160 && uend-ubody>=48){
            matrix = [];
            for(let i=0;i<12;i++) matrix.push(dv.getFloat32(ubody+i*4, true));
          }
        });
      });
      if(matrix){
        for(let i=0;i<verts.length;i++) verts[i] = at3dsApplyMatrix(verts[i], matrix);
      }
      if(verts.length && faces.length){
        objects.push({name:named.name||('OBJ'+objects.length), verts:verts, faces:faces});
      }
    });
  });
  return objects;
}
function at3dsScaleToMm(objects){
  let maxAbs = 0;
  objects.forEach(function(o){
    o.verts.forEach(function(v){
      maxAbs = Math.max(maxAbs, Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    });
  });
  if(maxAbs>200) return 'mm';
  objects.forEach(function(o){
    o.verts.forEach(function(v){ v.x*=1000; v.y*=1000; v.z*=1000; });
  });
  return 'm→mm';
}
function at3dsTri(vs, f){
  const a=vs[f[0]], b=vs[f[1]], c=vs[f[2]];
  if(!a||!b||!c) return null;
  const ux=b.x-a.x, uy=b.y-a.y, uz=b.z-a.z;
  const vx=c.x-a.x, vy=c.y-a.y, vz=c.z-a.z;
  const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
  const L=Math.sqrt(nx*nx+ny*ny+nz*nz);
  if(!(L>1e-6)) return null;
  return {
    n:{x:nx/L, y:ny/L, z:nz/L},
    area:0.5*L,
    c:{x:(a.x+b.x+c.x)/3, y:(a.y+b.y+c.y)/3, z:(a.z+b.z+c.z)/3},
    verts:[a,b,c],
    zmin:Math.min(a.z,b.z,c.z), zmax:Math.max(a.z,b.z,c.z),
    xmin:Math.min(a.x,b.x,c.x), xmax:Math.max(a.x,b.x,c.x),
    ymin:Math.min(a.y,b.y,c.y), ymax:Math.max(a.y,b.y,c.y)
  };
}
function at3dsPlaneKey(n, c, ang, binmm){
  const d = n.x*c.x + n.y*c.y + n.z*c.z;
  return [Math.round(n.x/ang), Math.round(n.y/ang), Math.round(n.z/ang), Math.round(d/binmm)].join(',');
}
function at3dsMergeObject(obj){
  const groups = {};
  (obj.faces||[]).forEach(function(f){
    const t = at3dsTri(obj.verts, f);
    if(!t || t.area<1e4) return;
    const k = at3dsPlaneKey(t.n, t.c, 0.03, 40);
    if(!groups[k]) groups[k]=[];
    groups[k].push(t);
  });
  const out = [];
  Object.keys(groups).forEach(function(k){
    const g = groups[k];
    const area = g.reduce(function(s,t){ return s+t.area; }, 0);
    if(area<5e4) return;
    let cx=0, cy=0, cz=0;
    let zmin=1e18, zmax=-1e18, xmin=1e18, xmax=-1e18, ymin=1e18, ymax=-1e18;
    const pts = [];
    g.forEach(function(t){
      cx+=t.c.x*t.area; cy+=t.c.y*t.area; cz+=t.c.z*t.area;
      zmin=Math.min(zmin,t.zmin); zmax=Math.max(zmax,t.zmax);
      xmin=Math.min(xmin,t.xmin); xmax=Math.max(xmax,t.xmax);
      ymin=Math.min(ymin,t.ymin); ymax=Math.max(ymax,t.ymax);
      pts.push(t.verts[0], t.verts[1], t.verts[2]);
    });
    out.push({
      n:g[0].n, area:area,
      c:{x:cx/area, y:cy/area, z:cz/area},
      pts:pts, tris:g, obj:obj.name,
      zmin:zmin, zmax:zmax, xmin:xmin, xmax:xmax, ymin:ymin, ymax:ymax,
      h:zmax-zmin, wxy:Math.max(xmax-xmin, ymax-ymin)
    });
  });
  return out;
}
function at3dsOrient2(ax,ay,bx,by,cx,cy){
  return (bx-ax)*(cy-ay) - (by-ay)*(cx-ax);
}
function at3dsPointInTriXY(px, py, a, b, c){
  const o1=at3dsOrient2(px,py,a.x,a.y,b.x,b.y);
  const o2=at3dsOrient2(px,py,b.x,b.y,c.x,c.y);
  const o3=at3dsOrient2(px,py,c.x,c.y,a.x,a.y);
  return !(((o1<0)||(o2<0)||(o3<0)) && ((o1>0)||(o2>0)||(o3>0)));
}
function at3dsPointInFaceXY(x, y, face){
  return (face.tris||[]).some(function(t){
    return at3dsPointInTriXY(x, y, t.verts[0], t.verts[1], t.verts[2]);
  });
}
function at3dsBuildGrid(envFaces){
  const xs=[], ys=[];
  envFaces.forEach(function(f){
    (f.pts||[]).forEach(function(p){ xs.push(p.x); ys.push(p.y); });
  });
  if(!xs.length) return null;
  const cell=150, pad=600;
  const minx=Math.min.apply(null,xs)-pad, maxx=Math.max.apply(null,xs)+pad;
  const miny=Math.min.apply(null,ys)-pad, maxy=Math.max.apply(null,ys)+pad;
  const nx=Math.max(6, Math.ceil((maxx-minx)/cell)+1);
  const ny=Math.max(6, Math.ceil((maxy-miny)/cell)+1);
  const wall=Array.from({length:nx}, function(){ return Array(ny).fill(0); });
  function ij(x,y){ return [Math.floor((x-minx)/cell), Math.floor((y-miny)/cell)]; }
  function markSeg(x0,y0,x1,y1){
    const steps=Math.max(2, Math.floor(Math.hypot(x1-x0,y1-y0)/(cell*0.35)));
    for(let s=0;s<=steps;s++){
      const x=x0+(x1-x0)*s/steps, y=y0+(y1-y0)*s/steps;
      const ijv=ij(x,y);
      for(let di=-1;di<=1;di++){
        for(let dj=-1;dj<=1;dj++){
          const ii=ijv[0]+di, jj=ijv[1]+dj;
          if(ii>=0 && ii<nx && jj>=0 && jj<ny) wall[ii][jj]=1;
        }
      }
    }
  }
  envFaces.forEach(function(f){
    (f.tris||[]).forEach(function(t){
      const a=t.verts[0], b=t.verts[1], c=t.verts[2];
      markSeg(a.x,a.y,b.x,b.y); markSeg(b.x,b.y,c.x,c.y); markSeg(c.x,c.y,a.x,a.y);
    });
  });
  const vis=Array.from({length:nx}, function(){ return Array(ny).fill(false); });
  const q=[];
  function tryPush(i,j){
    if(i<0||j<0||i>=nx||j>=ny||vis[i][j]||wall[i][j]) return;
    vis[i][j]=true; q.push([i,j]);
  }
  for(let i=0;i<nx;i++){ tryPush(i,0); tryPush(i,ny-1); }
  for(let j=0;j<ny;j++){ tryPush(0,j); tryPush(nx-1,j); }
  while(q.length){
    const cur=q.pop();
    tryPush(cur[0]+1,cur[1]); tryPush(cur[0]-1,cur[1]);
    tryPush(cur[0],cur[1]+1); tryPush(cur[0],cur[1]-1);
  }
  const interior=Array.from({length:nx}, function(){ return Array(ny).fill(false); });
  for(let i=0;i<nx;i++){
    for(let j=0;j<ny;j++){
      interior[i][j] = wall[i][j]===1 || !vis[i][j];
    }
  }
  function inside(x,y){
    const ijv=ij(x,y);
    if(ijv[0]<0||ijv[1]<0||ijv[0]>=nx||ijv[1]>=ny) return false;
    return interior[ijv[0]][ijv[1]];
  }
  function clipFrac(pts){
    if(!pts || !pts.length) return 0;
    let ok=0;
    pts.forEach(function(p){ if(inside(p.x,p.y)) ok++; });
    return ok/pts.length;
  }
  return {minx:minx, miny:miny, cell:cell, nx:nx, ny:ny, interior:interior, inside:inside, clipFrac:clipFrac};
}
function at3dsHull2(pts){
  if(typeof idfMeshConvexHull2==='function') return idfMeshConvexHull2(pts);
  const uniq=[];
  pts.forEach(function(p){
    if(!uniq.some(function(q){ return Math.abs(q.x-p.x)<1 && Math.abs(q.y-p.y)<1; })) uniq.push({x:p.x,y:p.y});
  });
  if(uniq.length<3) return uniq;
  uniq.sort(function(a,b){ return a.x===b.x ? a.y-b.y : a.x-b.x; });
  function cross(o,a,b){ return (a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x); }
  const lower=[];
  uniq.forEach(function(p){
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
function at3dsPlaneOf(face){
  if(typeof idfMeshFacePlane==='function') return idfMeshFacePlane(face.pts);
  const verts=face.pts||[];
  if(verts.length<3) return null;
  let nx=0, ny=0, nz=0;
  for(let i=0;i<verts.length;i++){
    const a=verts[i], b=verts[(i+1)%verts.length];
    nx+=(a.y-b.y)*(a.z+b.z);
    ny+=(a.z-b.z)*(a.x+b.x);
    nz+=(a.x-b.x)*(a.y+b.y);
  }
  const L=Math.sqrt(nx*nx+ny*ny+nz*nz);
  if(!(L>1e-12)) return null;
  const n={x:nx/L,y:ny/L,z:nz/L};
  if(n.z<0){ n.x=-n.x; n.y=-n.y; n.z=-n.z; }
  return {n:n, d:n.x*verts[0].x+n.y*verts[0].y+n.z*verts[0].z};
}
function at3dsClipFaceXY(face, keepXY, cell){
  cell = cell || 150;
  const pad = cell;
  const minx=face.xmin-pad, maxx=face.xmax+pad, miny=face.ymin-pad, maxy=face.ymax+pad;
  const nx=Math.max(2, Math.ceil((maxx-minx)/cell)+1);
  const ny=Math.max(2, Math.ceil((maxy-miny)/cell)+1);
  const pts=[];
  for(let i=0;i<nx;i++){
    for(let j=0;j<ny;j++){
      const x=minx+(i+0.5)*cell;
      const y=miny+(j+0.5)*cell;
      if(!at3dsPointInFaceXY(x,y,face)) continue;
      if(keepXY && !keepXY(x,y)) continue;
      const x0=minx+i*cell, y0=miny+j*cell;
      pts.push({x:x0,y:y0},{x:x0+cell,y:y0},{x:x0,y:y0+cell},{x:x0+cell,y:y0+cell});
    }
  }
  const hull=at3dsHull2(pts);
  if(hull.length<3) return null;
  const plane=at3dsPlaneOf(face);
  if(!plane || Math.abs(plane.n.z)<1e-6) return null;
  return hull.map(function(p){
    const z=(plane.d-plane.n.x*p.x-plane.n.y*p.y)/plane.n.z;
    return {x:p.x, y:p.y, z:z};
  });
}
function at3dsClipRoof(face, grid){
  if(!grid) return null;
  return at3dsClipFaceXY(face, function(x,y){ return grid.inside(x,y); }, grid.cell);
}
function at3dsWeld(tris, tol){
  const verts=[];
  function idx(p){
    for(let i=0;i<verts.length;i++){
      if(Math.abs(verts[i].x-p.x)<tol && Math.abs(verts[i].y-p.y)<tol && Math.abs(verts[i].z-p.z)<tol) return i;
    }
    verts.push({x:p.x, y:p.y, z:p.z});
    return verts.length-1;
  }
  const out=[];
  tris.forEach(function(t){
    const a=idx(t.verts[0]), b=idx(t.verts[1]), c=idx(t.verts[2]);
    if(a!==b && b!==c && c!==a) out.push([a,b,c]);
  });
  return {verts:verts, tris:out};
}
function at3dsToMeters(verts){
  return (verts||[]).map(function(v){ return {x:v.x/1000, y:v.y/1000, z:v.z/1000}; });
}
function at3dsClassify(objects){
  const merged=[];
  objects.forEach(function(o){ at3dsMergeObject(o).forEach(function(f){ merged.push(f); }); });
  if(!merged.length) throw new Error('分類できる面がありません');
  let hx=0, hy=0, hz=0;
  merged.forEach(function(f){ hx+=f.c.x; hy+=f.c.y; hz+=f.c.z; });
  hx/=merged.length; hy/=merged.length; hz/=merged.length;
  const outward=[];
  let droppedInward=0;
  merged.forEach(function(f){
    const ox=f.c.x-hx, oy=f.c.y-hy, oz=f.c.z-hz;
    if(f.n.x*ox + f.n.y*oy + f.n.z*oz < 0){ droppedInward++; return; }
    outward.push(f);
  });
  const env=outward.filter(function(f){ return Math.abs(f.n.z)<0.4 && f.h>180; });
  const grid=at3dsBuildGrid(env);
  const zarea={};
  outward.forEach(function(f){
    if(Math.abs(f.n.z)<=0.98) return;
    if(grid && grid.clipFrac(f.pts)<0.5) return;
    const z=Math.round(f.c.z/50)*50;
    zarea[z]=(zarea[z]||0)+f.area;
  });
  let floorZ=null;
  Object.keys(zarea).map(Number).sort(function(a,b){ return a-b; }).forEach(function(z){
    if(floorZ==null && zarea[z]>2e6) floorZ=z;
  });
  const walls1f=outward.filter(function(f){
    if(Math.abs(f.n.z)>=0.4 || f.h<=180) return false;
    if(floorZ==null) return f.zmin<1500;
    return f.zmin<=floorZ+400 && f.zmax<=floorZ+3100;
  });
  const grid1f=at3dsBuildGrid(walls1f);
  const vfaces=outward.filter(function(f){ return Math.abs(f.n.z)<0.15; });
  const clusters={};
  vfaces.forEach(function(f){
    const k=at3dsPlaneKey(f.n, f.c, 0.05, 80);
    if(!clusters[k]) clusters[k]=[];
    clusters[k].push(f);
  });
  Object.keys(clusters).forEach(function(k){
    const g=clusters[k];
    const pmax=g.reduce(function(m,f){ return Math.max(m,f.area); }, 0);
    g.forEach(function(f){ f._planeMax=pmax; });
  });
  const faces=[];
  const counts={};
  let droppedEave=0, droppedMid=0;
  outward.forEach(function(f){
    const nz=Math.abs(f.n.z);
    const frac=grid ? grid.clipFrac(f.pts) : 1;
    const frac1=grid1f ? grid1f.clipFrac(f.pts) : 0;
    let sslKey=null;
    let nameJa=null;
    let cantilever=false;
    let clipOutside1f=false;
    if(nz>=0.15){
      if(nz>0.98){
        if(floorZ!=null && f.c.z<=floorZ+150) sslKey='floor1';
        else if(f.n.z>0 && frac>=0.5 && frac1<0.85){
          sslKey='floor1';
          nameJa='2F床';
          cantilever=true;
          clipOutside1f=true;
        }else if(frac<0.5){
          droppedEave++; return;
        }else{
          droppedMid++; return;
        }
      }else{
        if(frac<0.35){ droppedEave++; return; }
        sslKey='roof';
      }
    }else{
      if(frac<0.2 && f.h<900){ droppedEave++; return; }
      if(f.h<550 && (floorZ==null || f.zmax<=floorZ+100)) sslKey='found';
      else{
        const pmax=f._planeMax||f.area;
        const overlay=f.area<pmax*0.55 && f.area<8e6;
        const opening=f.h<2500 && f.area<6.5e6 && (overlay || f.area<5e6);
        sslKey = (overlay || opening) ? 'window' : ('wall_'+at3dsOrientName(f.n));
      }
    }
    let vertsMm, tris=null;
    if(sslKey==='roof'){
      const clipped=at3dsClipRoof(f, grid);
      if(clipped && clipped.length>=3) vertsMm=clipped;
      else vertsMm=at3dsWeld(f.tris, 1).verts;
    }else if(clipOutside1f){
      const clipped=at3dsClipFaceXY(f, function(x,y){ return !grid1f || !grid1f.inside(x,y); });
      if(clipped && clipped.length>=3) vertsMm=clipped;
      else vertsMm=at3dsWeld(f.tris, 1).verts;
    }else{
      const welded=at3dsWeld(f.tris, 1);
      vertsMm=welded.verts;
      tris=welded.tris;
    }
    if(!vertsMm || vertsMm.length<3) return;
    counts[nameJa||sslKey]=(counts[nameJa||sslKey]||0)+1;
    faces.push({
      sslKey:sslKey,
      nameJa:nameJa||AT3DS_NAMEJA[sslKey]||sslKey,
      idfName:f.obj||'',
      zone:'',
      cantilever:cantilever,
      verts:at3dsToMeters(vertsMm),
      tris:tris
    });
  });
  return {
    meshFaces:faces,
    stats:{
      objects:objects.length,
      merged:merged.length,
      outward:outward.length,
      droppedInward:droppedInward,
      droppedEave:droppedEave,
      droppedMid:droppedMid,
      floorZ:floorZ,
      counts:counts
    }
  };
}
function buildAtMeshFromBuffer(buffer, fileName){
  const objects=at3dsParseBuffer(buffer);
  if(!objects.length) throw new Error('メッシュオブジェクトがありません');
  const unit=at3dsScaleToMm(objects);
  const classified=at3dsClassify(objects);
  return {
    fileName:fileName||'architrend.3ds',
    unit:unit,
    meshFaces:classified.meshFaces,
    stats:classified.stats
  };
}
function at3dsEcho(){
  const el=document.getElementById('at3dsFileEcho');
  if(!el) return;
  if(!atMesh){ el.textContent=''; return; }
  const n=(atMesh.meshFaces||[]).length;
  const eave=atMesh.stats ? atMesh.stats.droppedEave : 0;
  el.textContent='読み込み済み: '+(atMesh.fileName||'')+' / '+n+' 面（庇 '+eave+' 面を除外）';
}
async function onAt3dsSelected(input){
  const file=input && input.files && input.files[0];
  if(!file) return;
  const echo=document.getElementById('at3dsFileEcho');
  if(echo) echo.textContent='3DSを読み込み中...';
  try{
    const buf=await file.arrayBuffer();
    atMesh=buildAtMeshFromBuffer(buf, file.name);
    at3dsEcho();
    if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
  }catch(err){
    atMesh=null;
    if(echo) echo.textContent='';
    alert('3DSの読み込みに失敗しました: '+(err && err.message ? err.message : err));
    if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
  }
}
if(typeof module!=='undefined' && module.exports){
  module.exports={buildAtMeshFromBuffer:buildAtMeshFromBuffer, at3dsParseBuffer:at3dsParseBuffer};
}

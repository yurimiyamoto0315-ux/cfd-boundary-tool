// ========================= Architrend 3DS → 色分けメッシュ =========================
// マテリアル（透明度・向き）で窓・屋根・壁・床を確定し、内壁・天井つきにも対応する。
// マテリアルが無いファイルは従来の幾何判定にフォールバックする。
// 軒の出は壁の外形座標へ寄せて切る。床のZは壁の継ぎ目へ寄せて 36mm 段差を閉じる。
// 階間床が元データに無いときだけ 1F 外形を 2F へ複製する。
// 両面ポリゴンは建物重心から外向きだけ残す。単位は mm（小さければ m とみなして換算）。

var atMesh = null;

const AT3DS_NAMEJA = {
  wall_北: '外壁北', wall_北東: '外壁北東', wall_東: '外壁東', wall_南東: '外壁南東',
  wall_南: '外壁南', wall_南西: '外壁南西', wall_西: '外壁西', wall_北西: '外壁北西',
  roof: '屋根', floor1: '1F床', floor_out: '2F床', found: '基礎', window: '窓',
  innerwall: '内壁', attic: '小屋裏'
};
const AT3DS_CARD = [
  {name:'北', az:180}, {name:'北東', az:-135}, {name:'東', az:-90}, {name:'南東', az:-45},
  {name:'南', az:0}, {name:'南西', az:45}, {name:'西', az:90}, {name:'北西', az:135}
];

function at3dsWrap180(deg){
  if(typeof wrap180==='function') return wrap180(deg);
  let a = deg;
  while(a>180) a -= 360;
  while(a<=-180) a += 360;
  return a;
}
function at3dsToolAzFromNormal(n, northDeg){
  const azN = Math.atan2(n.x, n.y)*180/Math.PI;
  return at3dsWrap180((azN<0?azN+360:azN) - 180 - (Number(northDeg)||0));
}
function at3dsOrientFromToolAz(toolAz){
  let best = '南', bestD = 1e9;
  AT3DS_CARD.forEach(function(o){
    const d = Math.abs(at3dsWrap180(toolAz - o.az));
    if(d<bestD){ bestD=d; best=o.name; }
  });
  return best;
}
function at3dsOrientName(n, northDeg){
  return at3dsOrientFromToolAz(at3dsToolAzFromNormal(n, northDeg));
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
function at3dsParsePercent(dv, body, end){
  let v=null;
  at3dsWalk(dv, body, end, function(id, b, e){
    if(id===0x0030 && e-b>=2) v=dv.getUint16(b, true);
    else if(id===0x0031 && e-b>=4) v=dv.getFloat32(b, true)*100;
  });
  return v;
}
function at3dsParseRgb(dv, bytes, body, end){
  let rgb=null;
  at3dsWalk(dv, body, end, function(id, b, e){
    if(id===0x0011 && e-b>=3) rgb=[bytes[b], bytes[b+1], bytes[b+2]];
    else if(id===0x0010 && e-b>=12){
      rgb=[Math.round(dv.getFloat32(b,true)*255), Math.round(dv.getFloat32(b+4,true)*255), Math.round(dv.getFloat32(b+8,true)*255)];
    }
  });
  return rgb;
}
function at3dsParseMaterial(dv, bytes, body, end){
  let name='', rgb=null, transp=0;
  at3dsWalk(dv, body, end, function(id, b, e){
    if(id===0xA000) name=at3dsReadZ(bytes, b, e).name;
    else if(id===0xA020) rgb=at3dsParseRgb(dv, bytes, b, e);
    else if(id===0xA050){
      const p=at3dsParsePercent(dv, b, e);
      if(p!=null) transp=p;
    }
  });
  return {name:name||'MAT', rgb:rgb, transp:transp||0};
}
function at3dsParseBuffer(buffer){
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  if(bytes.length<6 || dv.getUint16(0, true)!==0x4D4D){
    throw new Error('3DSではありません（MAINチャンクがありません）');
  }
  const mainEnd = Math.min(dv.getUint32(2, true), bytes.length);
  const objects = [];
  const materials = {};
  at3dsWalk(dv, 6, mainEnd, function(id, body, end){
    if(id!==0x3D3D) return;
    at3dsWalk(dv, body, end, function(oid, obody, oend){
      if(oid===0xAFFF){
        const mat=at3dsParseMaterial(dv, bytes, obody, oend);
        if(mat.name) materials[mat.name]=mat;
        return;
      }
      if(oid!==0x4000) return;
      const named = at3dsReadZ(bytes, obody, oend);
      const verts = [];
      const faces = [];
      const faceMat = [];
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
              faceMat.push('');
            }
            const after=ubody+2+n*8;
            if(after<uend){
              at3dsWalk(dv, after, uend, function(sid, sb, se){
                if(sid!==0x4130) return;
                const mn=at3dsReadZ(bytes, sb, se);
                if(mn.next+2>se) return;
                const cnt=dv.getUint16(mn.next, true);
                for(let i=0;i<cnt;i++){
                  const p=mn.next+2+i*2;
                  if(p+2>se) break;
                  const fi=dv.getUint16(p, true);
                  if(fi>=0 && fi<faceMat.length) faceMat[fi]=mn.name;
                }
              });
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
        objects.push({name:named.name||('OBJ'+objects.length), verts:verts, faces:faces, faceMat:faceMat});
      }
    });
  });
  objects.materials = materials;
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
  (obj.faces||[]).forEach(function(f, fi){
    const t = at3dsTri(obj.verts, f);
    if(!t || t.area<1e4) return;
    t.mat = (obj.faceMat && obj.faceMat[fi]) || '';
    const k = at3dsPlaneKey(t.n, t.c, 0.03, 40)+'|'+t.mat;
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
      n:g[0].n, area:area, mat:g[0].mat||'',
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
function at3dsIsWallKey(sslKey){
  return String(sslKey||'').indexOf('wall_')===0;
}
function at3dsIsVertWall(f){
  return at3dsIsWallKey(f.sslKey) || (f.sslKey==='innerwall' && f.nameJa==='内壁');
}
function at3dsIsHorizKey(sslKey){
  return sslKey==='floor1' || sslKey==='floor_out' || sslKey==='roof' || sslKey==='found' || sslKey==='innerwall' || sslKey==='attic';
}
function at3dsDist3(a, b){
  return Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
}
function at3dsMedian(xs){
  if(!xs || !xs.length) return null;
  const a=xs.slice().sort(function(p,q){ return p-q; });
  return a[Math.floor(a.length/2)];
}
function at3dsHasMaterials(objects){
  const mats=objects && objects.materials;
  if(mats && Object.keys(mats).length) return true;
  return !!(objects||[]).some(function(o){
    return (o.faceMat||[]).some(function(n){ return n; });
  });
}
function at3dsMatKind(faces, meta){
  const area=faces.reduce(function(s,f){ return s+f.area; }, 0) || 1;
  let vert=0, horiz=0, slope=0;
  let zmin=1e18, zmax=-1e18, nFace=faces.length||1, maxFace=0;
  faces.forEach(function(f){
    const nz=Math.abs(f.n.z);
    if(nz<0.15) vert+=f.area;
    else if(nz>0.98) horiz+=f.area;
    else slope+=f.area;
    zmin=Math.min(zmin,f.zmin); zmax=Math.max(zmax,f.zmax);
    maxFace=Math.max(maxFace, f.area);
  });
  const transp=(meta && meta.transp) || 0;
  const mean=area/nFace;
  if(transp>=50 && vert>=area*0.45 && maxFace<8e6) return 'window';
  if(transp>=50 && slope>=area*0.4) return 'roof';
  if(vert>=area*0.5){
    if((zmax-zmin)<550) return 'found';
    return 'wall';
  }
  if(horiz>=area*0.5) return 'horiz';
  if(slope>=area*0.4) return transp>=50 ? 'roof' : 'attic';
  return 'wall';
}
function at3dsOnEnvelope(f, grid, step){
  if(!grid) return true;
  step = step || 250;
  const len=Math.hypot(f.n.x, f.n.y);
  if(!(len>1e-6)) return false;
  const ox=f.n.x/len*step, oy=f.n.y/len*step;
  const a=grid.inside(f.c.x+ox, f.c.y+oy);
  const b=grid.inside(f.c.x-ox, f.c.y-oy);
  return a!==b;
}
function at3dsPushFace(faces, counts, f, sslKey, nameJa, extra){
  const welded=at3dsWeld(f.tris, 1);
  if(!welded.verts || welded.verts.length<3) return;
  const ja=nameJa||AT3DS_NAMEJA[sslKey]||sslKey;
  counts[ja]=(counts[ja]||0)+1;
  const row={
    sslKey:sslKey,
    nameJa:ja,
    idfName:f.obj||'',
    zone:'',
    cantilever:!!(extra && extra.cantilever),
    mat:f.mat||'',
    area:f.area||0,
    modelToolAz:Math.abs(f.n && f.n.z)<0.3 ? at3dsToolAzFromNormal(f.n, 0) : null,
    vertsMm:welded.verts,
    tris:welded.tris
  };
  if(extra){ Object.keys(extra).forEach(function(k){ if(k!=='cantilever') row[k]=extra[k]; }); }
  faces.push(row);
}
function at3dsTrimRoofToWalls(faces, pad){
  pad = pad || 400;
  const walls=faces.filter(function(f){ return at3dsIsWallKey(f.sslKey); });
  if(!walls.length) return;
  let minx=Infinity, maxx=-Infinity, miny=Infinity, maxy=-Infinity;
  walls.forEach(function(f){
    (f.vertsMm||[]).forEach(function(v){
      minx=Math.min(minx,v.x); maxx=Math.max(maxx,v.x);
      miny=Math.min(miny,v.y); maxy=Math.max(maxy,v.y);
    });
  });
  if(!(maxx>minx) || !(maxy>miny)) return;
  faces.forEach(function(f){
    if(f.sslKey!=='roof' || !(f.vertsMm||[]).length) return;
    const plane=at3dsPlaneOf({pts:f.vertsMm});
    f.vertsMm.forEach(function(v){
      if(v.x<minx && minx-v.x<pad) v.x=minx;
      if(v.x>maxx && v.x-maxx<pad) v.x=maxx;
      if(v.y<miny && miny-v.y<pad) v.y=miny;
      if(v.y>maxy && v.y-maxy<pad) v.y=maxy;
      if(plane && Math.abs(plane.n.z)>1e-6){
        v.z=(plane.d-plane.n.x*v.x-plane.n.y*v.y)/plane.n.z;
      }
    });
  });
}
function at3dsSnapHorizZToWalls(faces, tol){
  tol = (tol>0) ? tol : 60;
  const zs=[];
  faces.forEach(function(f){
    if(!at3dsIsVertWall(f) && f.sslKey!=='found') return;
    (f.vertsMm||[]).forEach(function(v){ zs.push(v.z); });
  });
  if(!zs.length) return;
  zs.sort(function(a,b){ return a-b; });
  const uniq=[];
  zs.forEach(function(z){
    if(!uniq.length || Math.abs(uniq[uniq.length-1]-z)>2) uniq.push(z);
    else uniq[uniq.length-1]=(uniq[uniq.length-1]+z)/2;
  });
  faces.forEach(function(f){
    if(f.sslKey!=='floor1' && f.sslKey!=='floor_out' && !(f.sslKey==='innerwall' && (f.nameJa==='内床' || f.nameJa==='天井'))) return;
    const vs=f.vertsMm||[];
    if(!vs.length) return;
    const med=at3dsMedian(vs.map(function(v){ return v.z; }));
    let best=null, bestD=tol;
    uniq.forEach(function(z){
      const d=Math.abs(z-med);
      if(d<bestD){ bestD=d; best=z; }
    });
    if(best==null) return;
    vs.forEach(function(v){ v.z=best; });
  });
}
function at3dsSnapFacesMm(faces, nearTol, wallTol){
  nearTol = (nearTol>0) ? nearTol : 20;
  wallTol = (wallTol>0) ? wallTol : 60;
  const pts=[];
  (faces||[]).forEach(function(f, fi){
    (f.vertsMm||[]).forEach(function(v, vi){
      pts.push({v:v, fi:fi, vi:vi, wall:at3dsIsWallKey(f.sslKey), horiz:at3dsIsHorizKey(f.sslKey)});
    });
  });
  const walls=pts.filter(function(p){ return p.wall; });
  pts.forEach(function(p){
    if(p.wall || !walls.length) return;
    let best=null, bestD=wallTol;
    walls.forEach(function(w){
      const d=at3dsDist3(p.v, w.v);
      if(d<bestD){ bestD=d; best=w; }
    });
    if(best){
      p.v.x=best.v.x; p.v.y=best.v.y;
      if(!p.horiz) p.v.z=best.v.z;
    }
  });
  const parent=[];
  function find(i){ return parent[i]===i ? i : (parent[i]=find(parent[i])); }
  function uni(a,b){ a=find(a); b=find(b); if(a!==b) parent[a]=b; }
  for(let i=0;i<pts.length;i++) parent[i]=i;
  for(let i=0;i<pts.length;i++){
    for(let j=i+1;j<pts.length;j++){
      if(at3dsDist3(pts[i].v, pts[j].v)<nearTol) uni(i,j);
    }
  }
  const groups={};
  pts.forEach(function(p, i){
    const r=find(i);
    if(!groups[r]) groups[r]=[];
    groups[r].push(p);
  });
  Object.keys(groups).forEach(function(k){
    const g=groups[k];
    if(g.length<2) return;
    const wall=g.find(function(p){ return p.wall; });
    let x, y, z;
    if(wall){ x=wall.v.x; y=wall.v.y; z=wall.v.z; }
    else{
      x=0; y=0; z=0;
      g.forEach(function(p){ x+=p.v.x; y+=p.v.y; z+=p.v.z; });
      x/=g.length; y/=g.length; z/=g.length;
    }
    g.forEach(function(p){
      p.v.x=x; p.v.y=y;
      if(!p.horiz) p.v.z=z;
    });
  });
  return faces;
}
function at3dsAddInterior2F(faces){
  const floors1=(faces||[]).filter(function(f){
    return f.sslKey==='floor1' && !f.cantilever && f.nameJa!=='2F床';
  });
  const cants=(faces||[]).filter(function(f){
    return f.sslKey==='floor_out' || f.cantilever || f.nameJa==='2F床';
  });
  if(!floors1.length) return 0;
  const zs1=[];
  floors1.forEach(function(f){ (f.vertsMm||[]).forEach(function(v){ zs1.push(v.z); }); });
  const z1=at3dsMedian(zs1);
  if(z1==null) return 0;
  let z2=null;
  if(cants.length){
    const zs2=[];
    cants.forEach(function(f){ (f.vertsMm||[]).forEach(function(v){ zs2.push(v.z); }); });
    z2=at3dsMedian(zs2);
  }
  if(!(z2>z1+1500)){
    let zRoof=-Infinity;
    faces.forEach(function(f){
      if(f.sslKey!=='roof') return;
      (f.vertsMm||[]).forEach(function(v){ if(v.z>zRoof) zRoof=v.z; });
    });
    if(zRoof-z1>4000) z2=z1+2840;
  }
  if(!(z2>z1+1500)) return 0;
  let n=0;
  floors1.forEach(function(f){
    const vertsMm=(f.vertsMm||[]).map(function(v){ return {x:v.x, y:v.y, z:z2}; });
    if(vertsMm.length<3) return;
    faces.push({
      sslKey:'innerwall',
      nameJa:'内床',
      idfName:f.idfName||'',
      zone:'',
      cantilever:false,
      vertsMm:vertsMm,
      tris:f.tris ? f.tris.slice() : null
    });
    n++;
  });
  return n;
}
function at3dsHasUpperFloors(faces){
  return (faces||[]).some(function(f){ return f.nameJa==='内床'; });
}
function at3dsClassifyGeom(outward, grid, grid1f, floorZ, faces, counts){
  let droppedEave=0, droppedMid=0;
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
  outward.forEach(function(f){
    const nz=Math.abs(f.n.z);
    const frac=grid ? grid.clipFrac(f.pts) : 1;
    const frac1=grid1f ? grid1f.clipFrac(f.pts) : 0;
    let sslKey=null;
    let nameJa=null;
    let cantilever=false;
    if(nz>=0.15){
      if(nz>0.98){
        if(floorZ!=null && f.c.z<=floorZ+150) sslKey='floor1';
        else if(f.n.z>0 && frac>=0.5 && frac1<0.85){
          sslKey='floor_out';
          nameJa='2F床';
          cantilever=true;
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
    at3dsPushFace(faces, counts, f, sslKey, nameJa, {cantilever:cantilever});
  });
  return {droppedEave:droppedEave, droppedMid:droppedMid};
}
function at3dsClassifyMats(outward, objects, grid, grid1f, grid2, floorZ, faces, counts){
  const mats=objects.materials||{};
  const byMat={};
  outward.forEach(function(f){
    const k=f.mat||'';
    if(!byMat[k]) byMat[k]=[];
    byMat[k].push(f);
  });
  const kindOf={};
  Object.keys(byMat).forEach(function(k){
    kindOf[k]=at3dsMatKind(byMat[k], mats[k]);
  });
  let droppedEave=0, droppedMid=0;
  outward.forEach(function(f){
    const kind=kindOf[f.mat||'']||'wall';
    const nz=Math.abs(f.n.z);
    const frac=grid ? grid.clipFrac(f.pts) : 1;
    const frac1=grid1f ? grid1f.clipFrac(f.pts) : 1;
    const storyGrid=(floorZ!=null && f.zmin<=floorZ+400 && f.zmax<=floorZ+3100) ? grid1f : (grid2||grid);
    if(kind==='window'){
      at3dsPushFace(faces, counts, f, 'window', '窓');
      return;
    }
    if(kind==='found'){
      at3dsPushFace(faces, counts, f, 'found', '基礎');
      return;
    }
    if(kind==='roof' || (kind==='attic' && nz>0.15 && nz<=0.98 && (mats[f.mat||'']||{}).transp>=50)){
      at3dsPushFace(faces, counts, f, 'roof', '屋根');
      return;
    }
    if(kind==='wall' || (nz<0.15 && kind!=='horiz' && kind!=='attic')){
      if(storyGrid && at3dsOnEnvelope(f, storyGrid, 250)){
        at3dsPushFace(faces, counts, f, 'wall_'+at3dsOrientName(f.n));
      }else{
        at3dsPushFace(faces, counts, f, 'innerwall', '内壁');
      }
      return;
    }
    if(kind==='horiz' && nz<=0.98){
      at3dsPushFace(faces, counts, f, 'attic', '小屋裏');
      return;
    }
    if(nz>0.98 || kind==='horiz'){
      if(floorZ!=null && f.c.z<=floorZ+150){
        at3dsPushFace(faces, counts, f, 'floor1', '1F床');
        return;
      }
      if(floorZ!=null && f.c.z>floorZ+1500 && f.c.z<floorZ+4200 && frac1<0.85){
        at3dsPushFace(faces, counts, f, 'floor_out', '2F床', {cantilever:true});
        return;
      }
      if(floorZ!=null && f.c.z>floorZ+1500 && f.c.z<floorZ+4200){
        at3dsPushFace(faces, counts, f, 'innerwall', '内床');
        return;
      }
      at3dsPushFace(faces, counts, f, 'innerwall', '天井');
      return;
    }
    if(kind==='attic' || (nz>=0.15 && nz<=0.98)){
      if(frac<0.35){ droppedEave++; return; }
      at3dsPushFace(faces, counts, f, 'attic', '小屋裏');
      return;
    }
    droppedMid++;
  });
  return {droppedEave:droppedEave, droppedMid:droppedMid};
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
  const useMat=at3dsHasMaterials(objects);
  const env=outward.filter(function(f){
    if(Math.abs(f.n.z)>=0.4 || f.h<=180) return false;
    if(useMat){
      const meta=(objects.materials||{})[f.mat||''];
      if(meta && meta.transp>=50) return false;
    }
    return true;
  });
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
    if(useMat){
      const meta=(objects.materials||{})[f.mat||''];
      if(meta && meta.transp>=50) return false;
    }
    if(floorZ==null) return f.zmin<1500;
    return f.zmin<=floorZ+400 && f.zmax<=floorZ+3100;
  });
  const grid1f=at3dsBuildGrid(walls1f);
  const walls2=outward.filter(function(f){
    if(Math.abs(f.n.z)>=0.4 || f.h<=180) return false;
    if(useMat){
      const meta=(objects.materials||{})[f.mat||''];
      if(meta && meta.transp>=50) return false;
    }
    if(floorZ==null) return false;
    return f.zmin>=floorZ+1500;
  });
  const grid2=at3dsBuildGrid(walls2) || grid;
  const faces=[];
  const counts={};
  const r=useMat
    ? at3dsClassifyMats(outward, objects, grid, grid1f, grid2, floorZ, faces, counts)
    : at3dsClassifyGeom(outward, grid, grid1f, floorZ, faces, counts);
  at3dsTrimRoofToWalls(faces, 400);
  at3dsSnapFacesMm(faces, 20, 60);
  at3dsSnapHorizZToWalls(faces, 60);
  let added2f=0;
  if(!at3dsHasUpperFloors(faces)){
    added2f=at3dsAddInterior2F(faces);
    if(added2f) counts['内床']=(counts['内床']||0)+added2f;
  }
  faces.forEach(function(face){
    face.verts=at3dsToMeters(face.vertsMm);
    delete face.vertsMm;
  });
  return {
    meshFaces:faces,
    stats:{
      objects:objects.length,
      merged:merged.length,
      outward:outward.length,
      droppedInward:droppedInward,
      droppedEave:r.droppedEave,
      droppedMid:r.droppedMid,
      addedInterior2F:added2f,
      usedMaterials:useMat,
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
  let rooms=[];
  if(typeof atBuildRoomsFromFaces==='function'){
    rooms=atBuildRoomsFromFaces(classified.meshFaces, classified.stats)||[];
  }
  return {
    fileName:fileName||'architrend.3ds',
    unit:unit,
    meshFaces:classified.meshFaces,
    stats:classified.stats,
    rooms:rooms,
    gainVolumes:null
  };
}
function at3dsEcho(){
  const el=document.getElementById('at3dsFileEcho');
  if(!el) return;
  if(!atMesh){ el.textContent=''; return; }
  const n=(atMesh.meshFaces||[]).length;
  const eave=atMesh.stats ? atMesh.stats.droppedEave : 0;
  const inner2=atMesh.stats ? (atMesh.stats.addedInterior2F||0) : 0;
  const nRoom=(atMesh.rooms||[]).length;
  const nWin=((atMesh.stats&&atMesh.stats.counts&&atMesh.stats.counts['窓'])||0);
  el.textContent='読み込み済み: '+(atMesh.fileName||'')+' / '+n+' 面'
    +(nWin?('・窓 '+nWin+' 枚'):'')
    +(nRoom?('・部屋 '+nRoom+' 室'):'')
    +(eave?('（庇 '+eave+' 面を除外）'):'')
    +(inner2?('、室内2F床 '+inner2+' 面を補完'):'');
}
async function onAt3dsSelected(input){
  const file=input && input.files && input.files[0];
  if(!file) return;
  const echo=document.getElementById('at3dsFileEcho');
  if(echo) echo.textContent='3DSを読み込み中...';
  try{
    const buf=await file.arrayBuffer();
    if(typeof atRoomReviewState==='function' && atMesh && atMesh.reviewHash){
      atRoomView.pending=atRoomReviewState();
    }
    atMesh=buildAtMeshFromBuffer(buf, file.name);
    if(typeof atRoomModelLoaded==='function') await atRoomModelLoaded(buf);
    at3dsEcho();
    if(typeof atLastParse!=='undefined' && atLastParse && atLastParse.result){
      if(typeof atRoomView!=='undefined' && atRoomView.restored){
        renderArchitrendReview(atLastParse, true);
      }else if(typeof applyArchitrendMeshRooms==='function' && document.querySelector('.room-card')){
        applyArchitrendMeshRooms(atLastParse.result);
        if(typeof runAll==='function') runAll();
        if(typeof refreshNeedManual==='function') refreshNeedManual();
      }else if(typeof renderArchitrendReview==='function'){
        renderArchitrendReview(atLastParse, false);
      }
    }
    if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
    if(typeof atRenderRoomViewer==='function') atRenderRoomViewer();
  }catch(err){
    atMesh=null;
    if(typeof atRenderRoomViewer==='function') atRenderRoomViewer();
    if(echo) echo.textContent='';
    alert('3DSの読み込みに失敗しました: '+(err && err.message ? err.message : err));
    if(typeof refreshIdfMeshUi==='function') refreshIdfMeshUi();
  }
}
if(typeof module!=='undefined' && module.exports){
  module.exports={buildAtMeshFromBuffer:buildAtMeshFromBuffer, at3dsParseBuffer:at3dsParseBuffer};
}

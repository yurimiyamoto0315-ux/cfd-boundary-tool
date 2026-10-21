// EnergyPlus room review uses the Architrend viewer with IDF zones as rooms.
var epViewMesh = null;
var epRoomReviewed = {};

function epOrientWithViewerNorth(s){
  if(typeof appMode==='undefined' || appMode!=='energyplus' || !s) return (s && s.orient) || '南';
  const north=typeof atNorthDeg==='function' ? atNorthDeg() : 0;
  if(!north || !isFinite(s.toolAz) || typeof nearestOrientation!=='function' || typeof wrap180!=='function') return s.orient || '南';
  return nearestOrientation(wrap180(s.toolAz - north));
}
function epHideRoomViewer(){
  const host=typeof document!=='undefined' && document.getElementById ? document.getElementById('epRoomViewer') : null;
  if(host){ host.innerHTML=''; host.hidden=true; }
}
function epRoomCenter(ring){
  const b=typeof atRingBBox==='function' ? atRingBBox(ring) : {minx:0, maxx:0, miny:0, maxy:0};
  const cx=(b.minx+b.maxx)/2, cy=(b.miny+b.maxy)/2;
  if(typeof atPointInRing==='function' && atPointInRing(cx, cy, ring)) return {x:cx, y:cy};
  return (ring && ring[0]) || {x:cx, y:cy};
}
function epDecorateFaces(faces){
  (faces||[]).forEach(function(f, i){
    if(!f) return;
    if(f.atFaceId==null || f.atFaceId==='') f.atFaceId='ep-'+i;
    if(!f.baseSslKey) f.baseSslKey=f.sslKey;
    if((!f.tris || !f.tris.length) && typeof idfMeshEarClip3==='function') f.tris=idfMeshEarClip3(f.verts||[]);
  });
}
function epZoneByName(name){
  return ((epParse && epParse.zones)||[]).filter(function(z){ return z.name===name; })[0] || null;
}
function epBindZones(rooms, faces){
  const bound=(rooms||[]).map(function(r){
    const c=epRoomCenter(r.ring);
    let face=null;
    (faces||[]).forEach(function(f){
      if(typeof atIsFloorFace!=='function' || !atIsFloorFace(f)) return;
      if(typeof atFaceZ==='function' && Math.abs(atFaceZ(f)-r.z)>0.3) return;
      if(typeof atPointInFaceXY==='function' && atPointInFaceXY(c.x, c.y, f)) face=f;
    });
    const z=face ? epZoneByName(face.zone) : null;
    if(z && z.buffer) return null;
    if(!face) return null;
    if(!z && ((typeof epIsFoundZone==='function' && epIsFoundZone(face.zone)) || (typeof epIsAtticZone==='function' && epIsAtticZone(face.zone)))) return null;
    const copy=Object.assign({}, r);
    copy.epZone=(z && z.name) || face.zone || '';
    if(!copy.epZone) return null;
    copy.name=copy.epZone;
    copy.habitable=true;
    copy.reviewed=false;
    copy.epVolume=z && z.volume>0 ? z.volume : null;
    return copy;
  }).filter(Boolean);
  return epPreferWalkableFloors(bound);
}
function epPreferWalkableFloors(rooms){
  const kept=(rooms||[]).filter(function(r){ return r.plate!=='天井'; });
  const byZone={};
  kept.forEach(function(r){
    if(!byZone[r.epZone]) byZone[r.epZone]=[];
    byZone[r.epZone].push(r);
  });
  const out=[];
  Object.keys(byZone).forEach(function(zone){
    const list=byZone[zone];
    const zmin=Math.min.apply(null, list.map(function(r){ return r.z; }));
    list.forEach(function(r){
      if(r.z>zmin+1.2) return;
      const c=epRoomCenter(r.ring);
      const dup=out.some(function(o){
        if(o.epZone!==r.epZone || Math.abs(o.z-r.z)>=0.05 || Math.abs(o.area-r.area)>=0.05) return false;
        const p=epRoomCenter(o.ring);
        return Math.hypot(p.x-c.x, p.y-c.y)<0.4;
      });
      if(!dup) out.push(r);
    });
  });
  if(typeof atRekeyRooms==='function') atRekeyRooms(out);
  return out;
}
function epClosestPrev(r, prev){
  const same=(prev||[]).filter(function(p){ return p.epZone===r.epZone && p.floor===r.floor; });
  if(same.length<2) return same[0]||null;
  const c=epRoomCenter(r.ring);
  let best=same[0], bestD=Infinity;
  same.forEach(function(p){
    const q=epRoomCenter(p.ring);
    const d=Math.hypot(q.x-c.x, q.y-c.y);
    if(d<bestD){ bestD=d; best=p; }
  });
  return best;
}
function epCopyStair(r, old){
  if(!r || !old) return;
  if(old.stairOff) r.stairOff=true;
  if(old.stairManual) r.stairManual=true;
  if(old.stairPathEdited && old.stairPath && old.stairPath.length>=2){
    r.stairPath=old.stairPath.map(function(p){ return {x:p.x, y:p.y}; });
    r.stairPathEdited=true;
  }
}
function epApplyRoomEdits(rooms, prev){
  const cards={};
  if(typeof document!=='undefined' && document.querySelectorAll){
    document.querySelectorAll('.room-card[data-ep-zone]').forEach(function(card){
      const nameEl=card.querySelector && card.querySelector('.roomName');
      cards[card.dataset.epZone]={
        name:nameEl && nameEl.value ? nameEl.value : card.dataset.epZone,
        habitable:card.dataset.nonHabitable!=='true'
      };
    });
  }
  (rooms||[]).forEach(function(r){
    const card=cards[r.epZone];
    const old=epClosestPrev(r, prev);
    if(card){
      r.name=card.name || r.epZone;
      r.habitable=!!card.habitable;
    }else if(old){
      r.name=old.name || r.epZone;
      r.habitable=!!old.habitable;
    }
    epCopyStair(r, old);
    r.reviewed=!!epRoomReviewed[r.epZone];
  });
  return rooms;
}
function epWriteRoomToCard(r){
  if(!r || !r.epZone || typeof document==='undefined' || !document.querySelectorAll) return;
  let found=false;
  document.querySelectorAll('.room-card[data-ep-zone]').forEach(function(el){
    if(el.dataset.epZone!==r.epZone) return;
    found=true;
    const nameEl=el.querySelector('.roomName');
    if(nameEl) nameEl.value=r.name || r.epZone;
    if(typeof atSyncRoomCardKind==='function') atSyncRoomCardKind(el, r);
  });
  if(!found) return;
  if(r.reviewed) epRoomReviewed[r.epZone]=true;
}
function epSyncWindowAzimuths(){
  if(typeof appMode==='undefined' || appMode!=='energyplus' || typeof epParse==='undefined' || !epParse || !document.querySelectorAll) return;
  const north=typeof atNorthDeg==='function' ? atNorthDeg() : 0;
  document.querySelectorAll('.room-card[data-ep-zone] .win-row').forEach(function(row){
    const nameEl=row.querySelector('.wName');
    const azEl=row.querySelector('.wAz');
    if(!nameEl || !azEl) return;
    const w=(epParse.windows||[]).filter(function(item){ return item.name===nameEl.value; })[0];
    if(!w || !isFinite(w.toolAz)) return;
    const az=typeof wrap180==='function' ? wrap180(w.toolAz-north) : (w.toolAz-north);
    azEl.value=String(Math.round(az*10)/10);
  });
}
function epSyncViewerMesh(){
  if(typeof appMode==='undefined' || appMode!=='energyplus') return;
  if(typeof document==='undefined' || !document.getElementById) return;
  if(typeof epParse==='undefined' || !epParse || !(epParse.meshFaces||[]).length){
    epHideRoomViewer();
    return;
  }
  epDecorateFaces(epParse.meshFaces);
  const prev=epViewMesh && epViewMesh.rooms || [];
  const prevSel=(prev||[]).filter(function(r){
    return typeof epRoomView!=='undefined' && r.key===epRoomView.selected;
  })[0];
  if(!epViewMesh) epViewMesh={};
  epViewMesh.meshFaces=epParse.meshFaces;
  epViewMesh.fileName=(typeof epIdfName==='string' && epIdfName) || 'idf';
  epViewMesh.reviewHash=epViewMesh.reviewHash || ('ep-'+epViewMesh.fileName);
  epViewMesh.stats=epViewMesh.stats || {counts:{}};
  let rooms=typeof atBuildRoomsFromFaces==='function' ? atBuildRoomsFromFaces(epViewMesh.meshFaces, epViewMesh.stats) : [];
  rooms=epBindZones(rooms, epViewMesh.meshFaces);
  epApplyRoomEdits(rooms, prev);
  epViewMesh.rooms=rooms;
  if(typeof atApplyRoomGainFlags==='function') atApplyRoomGainFlags(epViewMesh);
  if(typeof atPartApplyOverrides==='function') atPartApplyOverrides();
  if(typeof atPlanStairsForMesh==='function') atPlanStairsForMesh(epViewMesh);
  if(prevSel && typeof epRoomView!=='undefined'){
    const again=epClosestPrev(prevSel, rooms);
    if(again) epRoomView.selected=again.key;
  }
  const host=document.getElementById('epRoomViewer');
  if(host) host.hidden=false;
  if(typeof atRenderRoomViewer==='function') atRenderRoomViewer();
}

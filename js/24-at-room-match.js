// PDF room labels are assignments to existing regions; matching never merges geometry.
(function(root){
  'use strict';
  const defaults={pitchM:0.91,maxAreaDeltaCells:2,minBestGapCells:0.25,boundaryToleranceM:0.06,minSharedBoundaryM:0.18,maxAccessories:2};
  function text(value){return String(value==null?'':value).normalize('NFKC').trim();}
  // A manual union can retain several PDF labels. All identities stay reserved,
  // while callers can still distinguish its primary label from the aliases.
  function atRoomPdfIndices(room){
    const values=room?[room.pdfIndex,...(Array.isArray(room.mergedPdfIndices)?room.mergedPdfIndices:[])]:[];
    return [...new Set(values.filter(i=>Number.isSafeInteger(i)&&i>=0))];
  }
  function floor(value){
    const s=text(value).toUpperCase().replace(/\s/g,'');
    if(/^(?:R|RF|屋上|屋根)$/.test(s))return 'R';
    const m=/^(?:地上)?(\d+)(?:F|階)?$/.exec(s);
    if(m)return String(Number(m[1]));
    return /^B\d+$/.test(s)?s:null;
  }
  function accessoryName(name){return /物入|パントリー|PANTRY|収納|食品庫|納戸|押入|クローゼット|CLOSET|\b[WS]IC\b/i.test(text(name));}
  function ldkName(name){return /LDK|リビング.*(?:ダイニング|キッチン)/i.test(text(name).replace(/[\s・･]/g,''));}
  function ring(room){return Array.isArray(room&&room.ring)&&room.ring.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y))?room.ring:[];}
  function hasPdfArea(room){return room&&room.sourceAreaMissing!==true&&room.area>0&&Number.isFinite(room.area);}
  function signedArea(points){return points.reduce((n,p,i)=>{const q=points[(i+1)%points.length];return n+p.x*q.y-q.x*p.y;},0)/2;}
  function cross(a,b,c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
  function properCross(a,b,c,d){return cross(a,b,c)*cross(a,b,d)<-1e-10&&cross(c,d,a)*cross(c,d,b)<-1e-10;}
  function strictlyInside(p,points){
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[j],b=points[i],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
      if(len>0&&Math.abs(cross(a,b,p))/len<1e-6&&(p.x-a.x)*(p.x-b.x)+(p.y-a.y)*(p.y-b.y)<=0)return false;
      if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }
    return inside;
  }
  function atRoomSharedBoundary(a,b,options){
    const opts=Object.assign({},defaults,options),A=ring(a),B=ring(b);
    if(A.length<3||B.length<3)return 0;
    const fa=floor(a.floor),fb=floor(b.floor);
    if(fa&&fb&&fa!==fb)return 0;
    if(Number.isFinite(a.z)&&Number.isFinite(b.z)&&Math.abs(a.z-b.z)>0.15)return 0;
    if(A.some(p=>strictlyInside(p,B))||B.some(p=>strictlyInside(p,A)))return 0;
    for(let i=0;i<A.length;i++)for(let j=0;j<B.length;j++)if(properCross(A[i],A[(i+1)%A.length],B[j],B[(j+1)%B.length]))return 0;
    const signA=Math.sign(signedArea(A)),signB=Math.sign(signedArea(B));
    if(!signA||!signB)return 0;
    let total=0;
    for(let i=0;i<A.length;i++){
      const p=A[i],q=A[(i+1)%A.length],len=Math.hypot(q.x-p.x,q.y-p.y);
      if(len<1e-6)continue;
      const ux=(q.x-p.x)/len,uy=(q.y-p.y)/len,intervals=[];
      for(let j=0;j<B.length;j++){
        const r=B[j],s=B[(j+1)%B.length],other=Math.hypot(s.x-r.x,s.y-r.y);
        if(other<1e-6)continue;
        const direction=(ux*(s.x-r.x)+uy*(s.y-r.y))/other;
        if(Math.abs(direction)<0.999||signA*signB*direction>=0)continue;
        if(Math.max(Math.abs(ux*(r.y-p.y)-uy*(r.x-p.x)),Math.abs(ux*(s.y-p.y)-uy*(s.x-p.x)))>opts.boundaryToleranceM)continue;
        const t0=(r.x-p.x)*ux+(r.y-p.y)*uy,t1=(s.x-p.x)*ux+(s.y-p.y)*uy;
        const lo=Math.max(0,Math.min(t0,t1)),hi=Math.min(len,Math.max(t0,t1));
        if(hi>lo)intervals.push([lo,hi]);
      }
      intervals.sort((p,q)=>p[0]-q[0]);let end=-Infinity;
      for(const interval of intervals){total+=Math.max(0,interval[1]-Math.max(interval[0],end));end=Math.max(end,interval[1]);}
    }
    return total>=opts.minSharedBoundaryM?total:0;
  }
  function atPlanRoomMatches(meshRooms,pdfRooms,options){
    const opts=Object.assign({},defaults,options),gridArea=opts.pitchM*opts.pitchM;
    if(!(gridArea>0&&Number.isFinite(gridArea)))throw new Error('ROOM_MATCH_PITCH_INVALID');
    const meshes=(meshRooms||[]).map((room,index)=>({room,index,key:room.key==null?'room-'+index:String(room.key),floor:floor(room.floor)}));
    if(new Set(meshes.map(m=>m.key)).size!==meshes.length)throw new Error('ROOM_MATCH_DUPLICATE_KEY');
    const pdfs=pdfRooms||[],locked=meshes.filter(m=>m.room.manualAssignment),reserved=new Set(locked.flatMap(m=>atRoomPdfIndices(m.room)).filter(i=>i<pdfs.length));
    const candidates=[],unresolved=[],blocked=new Set(),seen=new Set();
    const nameFor=m=>text(m.room.name)||text(opts.accessoryNamesByKey&&opts.accessoryNamesByKey[m.key]);
    const zLevels=[];
    meshes.map(m=>m.room.z).filter(Number.isFinite).sort((a,b)=>a-b).forEach(z=>{if(!zLevels.some(level=>Math.abs(level-z)<0.15))zLevels.push(z);});
    function scope(m){
      if(m.floor)return 'F:'+m.floor;
      if(!Number.isFinite(m.room.z))return null;
      const known=new Set(meshes.filter(other=>other.floor&&Number.isFinite(other.room.z)&&Math.abs(other.room.z-m.room.z)<0.15).map(other=>other.floor));
      return known.size===1?'F:'+Array.from(known)[0]:'Z:'+zLevels.findIndex(z=>Math.abs(z-m.room.z)<0.15);
    }
    function candidate(pdfIndex,main,others){
      const p=pdfs[pdfIndex],members=[main,...others],pf=floor(p.floor);
      if(!hasPdfArea(p)||members.some(m=>!(m.room.area>0&&Number.isFinite(m.room.area))))return;
      const known=[...new Set(members.map(m=>m.floor).filter(Boolean))];
      if(known.length>1||pf&&known.some(f=>f!==pf))return;
      const measured=members.reduce((sum,m)=>sum+m.room.area,0),delta=measured-p.area,difference=Math.abs(delta),deltaCells=difference/gridArea;
      if(deltaCells>opts.maxAreaDeltaCells+1e-8)return;
      const identity=pdfIndex+'|'+members.map(m=>m.key).sort().join('|');if(seen.has(identity))return;seen.add(identity);
      const floorPenalty=pf&&members.every(m=>m.floor===pf)?0:1;
      const accessories=others.map(m=>({roomKey:m.key,name:nameFor(m),sharedBoundaryM:atRoomSharedBoundary(main.room,m.room,opts),manual:!!m.room.manualAssignment}));
      const review=accessories.some(a=>!accessoryName(a.name));
      candidates.push({id:'room-match-'+candidates.length,pdfIndex,roomKey:main.key,roomKeys:members.map(m=>m.key),accessories,
        name:text(p.name),pdfArea:p.area,meshArea:measured,areaDelta:delta,areaDifference:difference,areaDeltaCells:deltaCells,
        meshGridCells:Math.round(measured/gridArea),pdfGridCells:Math.round(p.area/gridArea),floor:pf||known[0]||null,
        score:floorPenalty*1000+deltaCells,requiresReview:review,
        reasonCodes:[floorPenalty?'FLOOR_UNSPECIFIED':'FLOOR_EXACT',difference<0.04?'AREA_EXACT':'AREA_910_GRID_NEAR',...(others.length?['LDK_ACCESSORY_SUM','SHARED_BOUNDARY_CONFIRMED']:[]),...(review?['REVIEW_ACCESSORY_NAME']:[])],
        scopes:[...new Set(members.map(scope).filter(Boolean))]});
    }
    pdfs.forEach((p,pdfIndex)=>{
      if(reserved.has(pdfIndex))return;
      if(!hasPdfArea(p)){unresolved.push({pdfIndex,code:'ROOM_AREA_MISSING'});return;}
      for(const main of meshes){
        if(main.room.manualAssignment)continue;
        candidate(pdfIndex,main,[]);
        if(!ldkName(p.name)||!(opts.maxAccessories>0))continue;
        const neighbors=meshes.filter(other=>other!==main&&!other.room.manualAssignment&&other.room.area<main.room.area&&
          (accessoryName(nameFor(other))||!nameFor(other)&&other.room.area<=Math.min(main.room.area/2,gridArea*8))&&
          atRoomSharedBoundary(main.room,other.room,opts)>0);
        for(let i=0;i<neighbors.length;i++){
          candidate(pdfIndex,main,[neighbors[i]]);
          if(opts.maxAccessories>1)for(let j=i+1;j<neighbors.length;j++)candidate(pdfIndex,main,[neighbors[i],neighbors[j]]);
        }
      }
    });
    // Missing floor hints must not decide between otherwise plausible storeys.
    pdfs.forEach((p,i)=>{
      if(floor(p.floor))return;
      const list=candidates.filter(c=>c.pdfIndex===i),scopes=new Set(list.flatMap(c=>c.scopes));
      if(scopes.size>1)list.forEach(c=>blocked.add(c.id));
    });
    meshes.filter(m=>!m.floor).forEach(m=>{
      const list=candidates.filter(c=>c.roomKeys.includes(m.key)),known=new Set(list.map(c=>floor(pdfs[c.pdfIndex].floor)).filter(Boolean));
      if(known.size>1)list.forEach(c=>blocked.add(c.id));
    });
    const available=candidates.filter(c=>!blocked.has(c.id));
    // A hypothetical unnamed cupboard does not prevent assigning the same
    // principal region by its own nearby area. It must not count toward the
    // assignment, and competing principal/PDF identities still require review.
    const ranked=available.filter(c=>!(c.requiresReview&&
      available.some(other=>!other.requiresReview&&other.pdfIndex===c.pdfIndex&&other.roomKey===c.roomKey)&&
      available.filter(other=>other.pdfIndex===c.pdfIndex).every(other=>other.roomKey===c.roomKey)&&
      available.filter(other=>other.roomKey===c.roomKey).every(other=>other.pdfIndex===c.pdfIndex)));
    function uniqueBest(list){
      const sorted=list.slice().sort((a,b)=>a.score-b.score);
      if(!sorted.length)return null;
      if(sorted.length>1&&(sorted[1].score-sorted[0].score<=1e-9||sorted[1].score-sorted[0].score<opts.minBestGapCells-1e-9))return null;
      return sorted[0];
    }
    const assignments=ranked.filter(c=>!c.requiresReview&&uniqueBest(ranked.filter(other=>other.pdfIndex===c.pdfIndex))===c&&
      c.roomKeys.every(key=>uniqueBest(ranked.filter(other=>other.roomKeys.includes(key)))===c));
    for(let i=0;i<pdfs.length;i++){
      if(reserved.has(i)||assignments.some(a=>a.pdfIndex===i)||unresolved.some(u=>u.pdfIndex===i))continue;
      const list=candidates.filter(c=>c.pdfIndex===i);
      const best=uniqueBest(ranked.filter(c=>c.pdfIndex===i));
      const code=list.some(c=>blocked.has(c.id))?'FLOOR_AMBIGUOUS':!list.length?'NO_AREA_CANDIDATE':best&&best.requiresReview?'REVIEW_ACCESSORY_NAME':
        !best?'AREA_MATCH_AMBIGUOUS':'ROOM_MATCH_CONFLICT';
      unresolved.push({pdfIndex:i,code,candidateIds:list.map(c=>c.id)});
    }
    candidates.forEach(c=>{if(blocked.has(c.id))c.reasonCodes.push('FLOOR_AMBIGUOUS');});
    return {version:1,pitchM:opts.pitchM,gridArea,maxAreaDeltaCells:opts.maxAreaDeltaCells,assignments,
      candidates:candidates.sort((a,b)=>a.score-b.score),unresolved,
      locked:locked.map(m=>({roomKey:m.key,pdfIndex:Number.isInteger(m.room.pdfIndex)?m.room.pdfIndex:null})),
      unassignedRoomKeys:meshes.filter(m=>!m.room.manualAssignment&&!assignments.some(a=>a.roomKeys.includes(m.key))).map(m=>m.key)};
  }
  function atApplyRoomMatchPlan(meshRooms,pdfRooms,plan,options){
    const opts=options||{},rooms=meshRooms||[],pdfs=pdfRooms||[];
    const living=opts.isLivingRoom||(typeof root.isArchitrendLivingRoom==='function'?root.isArchitrendLivingRoom:p=>
      ['A','B'].includes(p.type)||['A','B'].includes(p.pdfType)||/^(?:LDK|L・D・K|リビング|ダイニング|キッチン|居間|洋室|和室|寝室|主寝室|子供|子ども|書斎)/i.test(text(p.name)));
    const byKey=new Map(rooms.map((r,i)=>[r.key==null?'room-'+i:String(r.key),r]));
    function summary(candidate){
      const codes=candidate.reasonCodes||[];
      const spatial=codes.some(code=>/^SPATIAL_|^PLAN_POSITION_|^ROOM_ADJACENCY_/.test(code));
      return {pdfIndex:candidate.pdfIndex,name:candidate.name,score:candidate.score,areaDifference:candidate.areaDifference,
        gridCells:candidate.areaDeltaCells,roomKeys:candidate.roomKeys.slice(),combinedArea:candidate.meshArea,
        accessoryNames:candidate.accessories.map(a=>a.name),requiresReview:candidate.requiresReview,
        reason:spatial?'図面上の位置と3DS区画の配置・隣接関係を照合':candidate.accessories.length?'隣接する付属区画を含む面積で比較':codes.includes('FLOOR_EXACT')?'階を確認し、910mmグリッドで近い面積を比較':'910mmグリッドで近い面積を比較',
        reasonCodes:codes.slice()};
    }
    for(const [index,room] of rooms.entries()){
      if(room.manualAssignment)continue;
      const key=room.key==null?'room-'+index:String(room.key);
      room.pdfMatchCandidates=(plan.candidates||[]).filter(c=>c.roomKeys.includes(key)).map(summary);
      room.pdfMatch=null;
      delete room.roomMatchGroup;
      if((room.matchSource==='auto-grid'||room.matchSource==='auto-spatial'||Number.isInteger(room.pdfIndex))&&!(plan.assignments||[]).some(a=>a.roomKeys.includes(key))){
        room.name='';room.pdfIndex=null;room.pdfArea=null;room.pdfType='';room.keep=false;room.habitable=false;
        room.reviewed=false;
        delete room.roomMatchGroup;delete room.roomMatch;delete room.matchSource;
      }
    }
    for(const assignment of plan.assignments||[]){
      const room=byKey.get(assignment.roomKey),p=pdfs[assignment.pdfIndex];
      if(!room||room.manualAssignment||!p||assignment.roomKeys.some(key=>!byKey.has(key)))continue;
      room.name=p.name;room.pdfIndex=assignment.pdfIndex;room.pdfArea=p.area;room.pdfType=p.type||'';
      room.reviewed=false;
      room.habitable=!!living(p);room.keep=room.habitable;room.matchSource=(assignment.reasonCodes||[]).some(code=>/^SPATIAL_/.test(code))?'auto-spatial':'auto-grid';
      room.roomMatch={score:assignment.score,areaDifference:assignment.areaDifference,areaDeltaCells:assignment.areaDeltaCells,reasonCodes:assignment.reasonCodes.slice()};
      room.pdfMatch=summary(assignment);
      if(assignment.accessories.length){
        const group={pdfIndex:assignment.pdfIndex,mainRoomKey:assignment.roomKey,roomKeys:assignment.roomKeys.slice(),combinedArea:assignment.meshArea};
        room.roomMatchGroup=group;
        for(const accessory of assignment.accessories){const side=byKey.get(accessory.roomKey);if(!side||side.manualAssignment)continue;if(!text(side.name))side.name=accessory.name;side.roomMatchGroup=Object.assign({},group,{accessory:true});}
      }else delete room.roomMatchGroup;
    }
    return rooms;
  }
  const api={atPlanRoomMatches,atApplyRoomMatchPlan,atRoomSharedBoundary,atRoomPdfIndices};
  Object.keys(api).forEach(key=>{root[key]=api[key];});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);

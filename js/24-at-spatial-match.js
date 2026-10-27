/* Pure plan-label / existing-region matching. No geometry is merged or edited. */
(function(root){
  'use strict';
  const defaults={pitchM:.91,maxAreaDeltaCells:2,minSupport:4,minUnanchoredSupport:5,
    minIndependentSupport:2,minCoverageRatio:.6,minTriangleRatio:.025,boundaryMarginRatio:.06,maxBoundaryMarginM:.15,
    minPairSpanRatio:.35,maxAreaDifferenceRatio:.25,maxHypotheses:32768,maxRoomsPerScope:40};
  const finite=Number.isFinite;
  function canonicalFloor(value){
    const s=String(value??'').normalize('NFKC').toUpperCase().replace(/\s/g,'');
    const m=/^(?:地上)?(\d+)(?:F|階)?$/.exec(s);
    if(m)return String(Number(m[1]));
    if(/^(?:R|RF|屋上|屋根)$/.test(s))return 'R';
    return /^B\d+$/.test(s)?s:null;
  }
  function pointSegment(p,a,b){
    const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
    const t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  }
  function polygon(room){
    const ring=room&&room.ring;
    if(!Array.isArray(ring)||ring.length<3||ring.some(p=>!p||!finite(p.x)||!finite(p.y)))return null;
    let twice=0,cx=0,cy=0;
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],v=a.x*b.y-b.x*a.y;
      twice+=v;cx+=(a.x+b.x)*v;cy+=(a.y+b.y)*v;
    }
    if(Math.abs(twice)<1e-8)return null;
    const minX=Math.min(...ring.map(p=>p.x)),maxX=Math.max(...ring.map(p=>p.x));
    const minY=Math.min(...ring.map(p=>p.y)),maxY=Math.max(...ring.map(p=>p.y));
    return {ring,center:{x:cx/(3*twice),y:cy/(3*twice)},area:Math.abs(twice/2),minX,maxX,minY,maxY,
      width:maxX-minX,height:maxY-minY};
  }
  function containment(point,poly){
    if(point.x<poly.minX||point.x>poly.maxX||point.y<poly.minY||point.y>poly.maxY)return {inside:false,distance:0};
    let inside=false,distance=Infinity;
    for(let i=0,j=poly.ring.length-1;i<poly.ring.length;j=i++){
      const a=poly.ring[j],b=poly.ring[i];
      distance=Math.min(distance,pointSegment(point,a,b));
      if((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }
    return {inside:inside||distance<1e-8,distance};
  }
  function labelPoint(room){
    const p=room&&room.plan;
    if(!p||![p.x,p.y,p.width,p.height].every(finite)||p.width<0||p.height<0)return null;
    return {x:p.x+p.width/2,y:p.y+p.height/2};
  }
  function hasArea(p){return p&&p.sourceAreaMissing!==true&&finite(p.area)&&p.area>0;}
  function confirmedArea(p){return hasArea(p)&&p.sourceAreaConfirmed!==false&&p.sourceAreaAggregate!==true&&p.sourceAreaCombined!==true;}
  function pdfIndices(room){
    if(typeof root.atRoomPdfIndices==='function')return root.atRoomPdfIndices(room);
    // Keep standalone spatial use safe when the area matcher was not loaded.
    const values=room?[room.pdfIndex,...(Array.isArray(room.mergedPdfIndices)?room.mergedPdfIndices:[])]:[];
    return [...new Set(values.filter(i=>Number.isSafeInteger(i)&&i>=0))];
  }
  function span(points){
    return Math.hypot(Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),
      Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)));
  }
  function transformPair(p,q,m,n,reflection){
    const px=q.x-p.x,py=(q.y-p.y)*reflection,mx=n.x-m.x,my=n.y-m.y,den=px*px+py*py;
    if(den<1e-10)return null;
    const a=(px*mx+py*my)/den,b=(px*my-py*mx)/den;
    if(!finite(a)||!finite(b)||a*a+b*b<1e-16)return null;
    return {a,b,reflection,tx:m.x-a*p.x+b*p.y*reflection,ty:m.y-b*p.x-a*p.y*reflection};
  }
  function mapped(t,p){return {x:t.a*p.x-t.b*p.y*t.reflection+t.tx,y:t.b*p.x+t.a*p.y*t.reflection+t.ty};}
  function spreadEnough(points,ratio){
    const extent=span(points);if(!(extent>0))return false;
    for(let i=0;i<points.length-2;i++)for(let j=i+1;j<points.length-1;j++)for(let k=j+1;k<points.length;k++){
      const a=points[i],b=points[j],c=points[k];
      if(Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))>=extent*extent*ratio)return true;
    }
    return false;
  }
  // This is corroboration only: proximity of two labels never proves a shared wall.
  function adjacent(a,b){
    for(let i=0;i<a.ring.length;i++)for(let j=0;j<b.ring.length;j++){
      const p=a.ring[i],q=a.ring[(i+1)%a.ring.length],r=b.ring[j],s=b.ring[(j+1)%b.ring.length];
      const dx=q.x-p.x,dy=q.y-p.y,len=Math.hypot(dx,dy),other=Math.hypot(s.x-r.x,s.y-r.y);
      if(len<1e-8||other<1e-8)continue;
      const ux=dx/len,uy=dy/len;
      if(Math.abs((ux*(s.x-r.x)+uy*(s.y-r.y))/other)<.999)continue;
      if(Math.max(Math.abs(ux*(r.y-p.y)-uy*(r.x-p.x)),Math.abs(ux*(s.y-p.y)-uy*(s.x-p.x)))>.04)continue;
      const l=(r.x-p.x)*ux+(r.y-p.y)*uy,h=(s.x-p.x)*ux+(s.y-p.y)*uy;
      if(Math.min(len,Math.max(l,h))-Math.max(0,Math.min(l,h))>.18)return true;
    }
    return false;
  }
  function atSpatialPlanRoomMatches(meshRooms,pdfRooms,basePlan,options){
    const opts=Object.assign({},defaults,options),base=basePlan||{},pdfs=pdfRooms||[],gridArea=opts.pitchM*opts.pitchM;
    if(!(finite(gridArea)&&gridArea>0))throw new Error('SPATIAL_PITCH_INVALID');
    if(!Number.isInteger(opts.maxHypotheses)||opts.maxHypotheses<1||opts.maxHypotheses>100000)throw new Error('SPATIAL_LIMIT_INVALID');
    const diagnostics=[],reservedKeys=new Set(),reservedPdf=new Set(),directManual=new Map();
    const meshes=(meshRooms||[]).map((room,index)=>({room,index,key:String(room.key??'room-'+index),floor:canonicalFloor(room.floor),poly:polygon(room)}));
    if(new Set(meshes.map(m=>m.key)).size!==meshes.length)throw new Error('SPATIAL_DUPLICATE_ROOM_KEY');
    const byKey=new Map(meshes.map(m=>[m.key,m]));
    const reserveIndex=i=>{if(Number.isSafeInteger(i)&&i>=0&&i<pdfs.length)reservedPdf.add(i);};
    const manualClaims=new Map();
    for(const m of meshes.filter(m=>m.room.manualAssignment)){
      reservedKeys.add(m.key);
      const indices=pdfIndices(m.room).filter(i=>i<pdfs.length);
      indices.forEach(i=>{reserveIndex(i);if(!manualClaims.has(i))manualClaims.set(i,new Set());manualClaims.get(i).add(m.key);});
      // Several original labels inside one union do not identify its centroid.
      // They reserve identities, but cannot establish a spatial transform.
      if(indices.length===1&&indices[0]===m.room.pdfIndex)directManual.set(m.room.pdfIndex,m.key);
      const group=m.room.roomMatchGroup||{};
      (group.roomKeys||[]).forEach(key=>reservedKeys.add(String(key)));
      if(group.mainRoomKey!=null)reservedKeys.add(String(group.mainRoomKey));
      reserveIndex(group.pdfIndex);
      (group.pdfIndices||group.pdfIndexes||[]).forEach(reserveIndex);
    }
    for(const [index,keys] of manualClaims)if(keys.size>1)directManual.delete(index);
    const pdfKeyCounts=new Map();
    pdfs.forEach(p=>{if(p.key!=null)pdfKeyCounts.set(String(p.key),(pdfKeyCounts.get(String(p.key))||0)+1);});
    const duplicatePdf=new Set(pdfs.map((p,i)=>p.key!=null&&pdfKeyCounts.get(String(p.key))>1?i:-1).filter(i=>i>=0));
    if(duplicatePdf.size)diagnostics.push({code:'SPATIAL_DUPLICATE_PDF_KEY',count:duplicatePdf.size});
    const safeBase=(base.assignments||[]).filter(a=>!reservedPdf.has(a.pdfIndex)&&!duplicatePdf.has(a.pdfIndex)&&
      !(a.roomKeys||[a.roomKey]).some(key=>reservedKeys.has(String(key))));
    const baseByPdf=new Map(safeBase.map(a=>[a.pdfIndex,a]));
    const assigned=new Map(safeBase.map(a=>[a.pdfIndex,a])),candidates=(base.candidates||[]).filter(a=>
      !reservedPdf.has(a.pdfIndex)&&!duplicatePdf.has(a.pdfIndex)&&!(a.roomKeys||[a.roomKey]).some(key=>reservedKeys.has(String(key)))),unresolved=new Map();
    (base.unresolved||[]).forEach(u=>unresolved.set(u.pdfIndex,u));
    const groups=new Map();
    duplicatePdf.forEach(index=>unresolved.set(index,{pdfIndex:index,code:'SPATIAL_DUPLICATE_PDF_KEY'}));
    pdfs.forEach((room,index)=>{
      if(duplicatePdf.has(index)||room.sourceKind!=='plan'||reservedPdf.has(index)&&!directManual.has(index))return;
      const f=canonicalFloor(room.floor),point=labelPoint(room),page=room.sourcePage;
      if(!f){if(!assigned.has(index))unresolved.set(index,{pdfIndex:index,code:'SPATIAL_FLOOR_UNKNOWN'});return;}
      if(!point||!Number.isInteger(page)||page<1){if(!assigned.has(index))unresolved.set(index,{pdfIndex:index,code:'SPATIAL_POSITION_MISSING'});return;}
      const key=page+'|'+f;
      if(!groups.has(key))groups.set(key,{sourcePage:page,floor:f,pdfs:[]});
      groups.get(key).pdfs.push({room,index,key:String(room.key??'pdf-'+index),point,manualKey:directManual.get(index)});
    });
    let hypothesisCount=0,supportedHypothesisCount=0;
    for(const scope of groups.values()){
      const ps=scope.pdfs.sort((a,b)=>a.key.localeCompare(b.key)||a.index-b.index);
      const ms=meshes.filter(m=>m.floor===scope.floor&&m.poly&&(!reservedKeys.has(m.key)||ps.some(p=>p.manualKey===m.key))).sort((a,b)=>a.key.localeCompare(b.key));
      const diag={sourcePage:scope.sourcePage,floor:scope.floor,pdfCount:ps.length,roomCount:ms.length,hypothesisCount:0,supportedHypothesisCount:0};
      function insufficient(code){
        diagnostics.push(Object.assign({code},diag));
        ps.filter(p=>!p.manualKey&&!assigned.has(p.index)).forEach(p=>unresolved.set(p.index,{pdfIndex:p.index,code}));
      }
      if(ps.length<opts.minSupport||ms.length<opts.minSupport){insufficient('SPATIAL_SUPPORT_INSUFFICIENT');continue;}
      if(ps.length>opts.maxRoomsPerScope||ms.length>opts.maxRoomsPerScope){insufficient('SPATIAL_CAP_REACHED');continue;}
      const pSpan=span(ps.map(p=>p.point));
      if(!spreadEnough(ps.map(p=>p.point),opts.minTriangleRatio)||!spreadEnough(ms.map(m=>m.poly.center),opts.minTriangleRatio)){
        insufficient('SPATIAL_SUPPORT_INSUFFICIENT');continue;
      }
      const measuredArea=m=>finite(m.room.area)&&m.room.area>0?m.room.area:m.poly.area;
      const largeAreaDifference=(p,m)=>confirmedArea(p.room)&&Math.abs(measuredArea(m)-p.room.area)>
        Math.max(gridArea*opts.maxAreaDeltaCells,p.room.area*opts.maxAreaDifferenceRatio)+1e-8;
      const areaNear=(p,m)=>confirmedArea(p.room)&&Math.abs(measuredArea(m)-p.room.area)<=gridArea*opts.maxAreaDeltaCells+1e-8;
      const nearLabels=new Map(ps.map(p=>[p.index,new Set(ps.filter(q=>q!==p).sort((u,v)=>
        Math.hypot(u.point.x-p.point.x,u.point.y-p.point.y)-Math.hypot(v.point.x-p.point.x,v.point.y-p.point.y)).slice(0,2).map(q=>q.index))]));
      const adjacentKeys=new Set();
      for(let i=0;i<ms.length-1;i++)for(let j=i+1;j<ms.length;j++)if(adjacent(ms[i].poly,ms[j].poly)){
        adjacentKeys.add(JSON.stringify([ms[i].key,ms[j].key]));adjacentKeys.add(JSON.stringify([ms[j].key,ms[i].key]));
      }
      const pairList=[];
      for(let i=0;i<ps.length-1;i++)for(let j=i+1;j<ps.length;j++){
        const d=Math.hypot(ps[i].point.x-ps[j].point.x,ps[i].point.y-ps[j].point.y);
        if(d>=pSpan*opts.minPairSpanRatio)pairList.push({i,j,d,anchor:Number(hasArea(ps[i].room))+Number(hasArea(ps[j].room))+Number(!!ps[i].manualKey)*2+Number(!!ps[j].manualKey)*2});
      }
      pairList.sort((a,b)=>b.anchor-a.anchor||b.d-a.d||a.i-b.i||a.j-b.j);
      const supported=new Map();let capped=false;
      function evaluate(t,seed){
        const matches=new Map(),margins=new Map(),claims=new Map();
        for(const p of ps){
          const point=mapped(t,p.point),hits=[];
          for(const m of ms){
            if(p.manualKey&&p.manualKey!==m.key||!p.manualKey&&reservedKeys.has(m.key))continue;
            const hit=containment(point,m.poly);
            if(hit.inside)hits.push({m,hit});
          }
          // Even a boundary/overlapping second polygon prevents certainty.
          if(hits.length!==1)continue;
          const {m,hit}=hits[0],margin=Math.min(opts.maxBoundaryMarginM,Math.min(m.poly.width,m.poly.height)*opts.boundaryMarginRatio);
          if(hit.distance<=Math.max(1e-7,margin))continue;
          matches.set(p.index,m.key);margins.set(p.index,hit.distance);
          if(!claims.has(m.key))claims.set(m.key,[]);claims.get(m.key).push(p.index);
        }
        for(const list of claims.values())if(list.length>1)list.forEach(index=>matches.delete(index));
        if(ps.some(p=>p.manualKey&&matches.get(p.index)!==p.manualKey))return;
        // A point can be contained by a wrong large region. A confirmed,
        // substantially different area must not corroborate that transform.
        // Missing/aggregate areas and explicit manual anchors do not veto it.
        const supportedPs=ps.filter(p=>matches.has(p.index)&&(p.manualKey||!largeAreaDifference(p,byKey.get(matches.get(p.index)))));
        const areaSupport=supportedPs.filter(p=>areaNear(p,byKey.get(matches.get(p.index)))).length;
        const needed=Math.max(Math.ceil(ps.length*opts.minCoverageRatio),areaSupport||ps.some(p=>p.manualKey)?opts.minSupport:Math.max(opts.minSupport,opts.minUnanchoredSupport));
        if(supportedPs.length<needed||supportedPs.filter(p=>!seed.includes(p.index)).length<opts.minIndependentSupport)return;
        if(!spreadEnough(supportedPs.map(p=>p.point),opts.minTriangleRatio)||
          !spreadEnough(supportedPs.map(p=>byKey.get(matches.get(p.index)).poly.center),opts.minTriangleRatio))return;
        // Large-scale relative order must agree; nearby label offsets are exempt.
        let orderSupport=0,adjacencySupport=0;
        for(let i=0;i<supportedPs.length-1;i++)for(let j=i+1;j<supportedPs.length;j++){
          const p=supportedPs[i],q=supportedPs[j],a=byKey.get(matches.get(p.index)),b=byKey.get(matches.get(q.index));
          const x=mapped(t,p.point),y=mapped(t,q.point),dx=y.x-x.x,dy=y.y-x.y,cx=b.poly.center.x-a.poly.center.x,cy=b.poly.center.y-a.poly.center.y;
          if(Math.hypot(cx,cy)>Math.max(a.poly.width,a.poly.height,b.poly.width,b.poly.height)*1.2){
            if(dx*cx+dy*cy<=0)return;
            orderSupport++;
          }
          if(adjacentKeys.has(JSON.stringify([a.key,b.key]))&&nearLabels.get(p.index).has(q.index))adjacencySupport++;
        }
        if(!orderSupport)return;
        const signature=JSON.stringify(ps.map(p=>matches.get(p.index)||null));
        if(!supported.has(signature))supported.set(signature,{matches,margins,count:supportedPs.length,areaSupport,orderSupport,adjacencySupport,seedPairs:1});
        else supported.get(signature).seedPairs++;
      }
      outer:for(const pair of pairList){
        const p=ps[pair.i],q=ps[pair.j];
        for(const a of ms){
          if(p.manualKey&&p.manualKey!==a.key||!p.manualKey&&reservedKeys.has(a.key))continue;
          for(const b of ms){
            if(a===b||q.manualKey&&q.manualKey!==b.key||!q.manualKey&&reservedKeys.has(b.key))continue;
            if(Math.hypot(a.poly.center.x-b.poly.center.x,a.poly.center.y-b.poly.center.y)<1e-7)continue;
            for(const reflection of [1,-1]){
              if(diag.hypothesisCount>=opts.maxHypotheses){capped=true;break outer;}
              diag.hypothesisCount++;
              const t=transformPair(p.point,q.point,a.poly.center,b.poly.center,reflection);
              if(t)evaluate(t,[p.index,q.index]);
            }
          }
        }
      }
      hypothesisCount+=diag.hypothesisCount;
      if(capped){insufficient('SPATIAL_CAP_REACHED');continue;}
      if(!supported.size){insufficient('SPATIAL_SUPPORT_INSUFFICIENT');continue;}
      const bestCount=Math.max(...Array.from(supported.values(),h=>h.count));
      const complete=Array.from(supported.values()).filter(h=>h.count===bestCount);
      const bestAreaSupport=Math.max(...complete.map(h=>h.areaSupport));
      // One area-only match cannot fix a transform. Two separate near-area
      // rooms corroborating the same complete spatial fit can distinguish it.
      // An aggregate/missing area remains eligible via the other room evidence.
      const plausible=bestAreaSupport>=2?complete.filter(h=>h.areaSupport===bestAreaSupport):complete;
      diag.supportedHypothesisCount=plausible.length;supportedHypothesisCount+=plausible.length;
      const supportBins=new Map();
      for(const h of supported.values()){
        const key=h.count+'|'+h.areaSupport;
        if(!supportBins.has(key))supportBins.set(key,{supportCount:h.count,areaSupportCount:h.areaSupport,count:0});
        supportBins.get(key).count++;
      }
      diagnostics.push(Object.assign({code:'SPATIAL_SUPPORTED',supportCount:bestCount,areaSupportCount:bestAreaSupport,completeHypothesisCount:complete.length,
        supportBins:Array.from(supportBins.values())},diag));
      for(const p of ps){
        if(p.manualKey)continue;
        assigned.delete(p.index);
        const keys=new Set(plausible.map(h=>h.matches.get(p.index)||null));
        const prior=baseByPdf.get(p.index),one=keys.size===1&&![...keys].includes(null),key=one?[...keys][0]:null;
        const contradiction=prior&&plausible.every(h=>h.matches.has(p.index)&&h.matches.get(p.index)!==String(prior.roomKey));
        let areaReview=false;
        for(const candidateKey of [...keys].filter(Boolean)){
          const m=byKey.get(candidateKey),difference=hasArea(p.room)?Math.abs((finite(m.room.area)&&m.room.area>0?m.room.area:m.poly.area)-p.room.area):null;
          const area=finite(m.room.area)&&m.room.area>0?m.room.area:m.poly.area;
          const reviewArea=difference!==null&&difference>Math.max(gridArea*opts.maxAreaDeltaCells,p.room.area*opts.maxAreaDifferenceRatio)+1e-8;
          if(one&&reviewArea)areaReview=true;
          const codes=['FLOOR_EXACT','SPATIAL_CONTAINMENT','SPATIAL_INDEPENDENT_SUPPORT','SPATIAL_RELATIVE_ORDER',
            ...(bestAreaSupport>=2?['SPATIAL_AREA_CORROBORATION']:[]),
            ...(plausible.some(h=>h.adjacencySupport)?['SPATIAL_ADJACENCY_SUPPORT']:[]),
            ...(difference===null?['AREA_MISSING']:difference<=gridArea*opts.maxAreaDeltaCells?['AREA_910_GRID_NEAR']:['AREA_SCHEDULE_DIFFERENCE']),
            ...(!one?['SPATIAL_TRANSFORM_AMBIGUOUS']:[]),...(contradiction?['SPATIAL_BASE_CONTRADICTION']:[]),...(reviewArea?['SPATIAL_AREA_REVIEW_REQUIRED']:[])];
          const entry={id:'spatial-'+p.index+'-'+m.key,pdfIndex:p.index,roomKey:m.key,roomKeys:[m.key],accessories:[],name:p.room.name,
            pdfArea:hasArea(p.room)?p.room.area:null,meshArea:area,areaDelta:difference===null?null:area-p.room.area,areaDifference:difference,
            areaDeltaCells:difference===null?null:difference/gridArea,meshGridCells:Math.round(area/gridArea),pdfGridCells:difference===null?null:Math.round(p.room.area/gridArea),
            floor:scope.floor,score:1/(bestCount+1),requiresReview:!one||!!contradiction||reviewArea,reasonCodes:codes,scopes:['F:'+scope.floor],
            spatial:{supportCount:bestCount,hypothesisCount:plausible.length,areaSupportCount:Math.min(...plausible.map(h=>h.areaSupport)),
              independentSupportCount:Math.max(0,bestCount-2),sourcePage:scope.sourcePage}};
          candidates.push(entry);
          if(one&&!contradiction&&!reviewArea&&candidateKey===key){assigned.set(p.index,entry);unresolved.delete(p.index);}
        }
        if(!assigned.has(p.index))unresolved.set(p.index,{pdfIndex:p.index,code:contradiction?'SPATIAL_BASE_CONTRADICTION':
          areaReview?'SPATIAL_AREA_REVIEW_REQUIRED':keys.size>1?'SPATIAL_TRANSFORM_AMBIGUOUS':'SPATIAL_SUPPORT_INSUFFICIENT'});
      }
    }
    // Different pages can describe the same floor: never let page order decide.
    const claims=new Map();
    for(const a of assigned.values())for(const key of a.roomKeys||[a.roomKey]){
      if(!claims.has(key))claims.set(key,[]);claims.get(key).push(a.pdfIndex);
    }
    for(const indices of claims.values())if(new Set(indices).size>1)for(const index of indices){
      assigned.delete(index);unresolved.set(index,{pdfIndex:index,code:'SPATIAL_ROOM_AMBIGUOUS'});
    }
    for(const index of reservedPdf){assigned.delete(index);unresolved.delete(index);}
    for(const index of assigned.keys())unresolved.delete(index);
    const assignments=Array.from(assigned.values()).sort((a,b)=>a.pdfIndex-b.pdfIndex);
    return Object.assign({},base,{version:1,pitchM:opts.pitchM,gridArea,assignments,candidates,
      unresolved:Array.from(unresolved.values()).sort((a,b)=>a.pdfIndex-b.pdfIndex),diagnostics,
      locked:meshes.filter(m=>m.room.manualAssignment).map(m=>({roomKey:m.key,pdfIndex:Number.isInteger(m.room.pdfIndex)?m.room.pdfIndex:null})),
      unassignedRoomKeys:meshes.filter(m=>!reservedKeys.has(m.key)&&!assignments.some(a=>(a.roomKeys||[a.roomKey]).includes(m.key))).map(m=>m.key),
      hypothesisCount,supportedHypothesisCount});
  }
  const api={atSpatialPlanRoomMatches};
  Object.keys(api).forEach(key=>{root[key]=api[key];});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);

// Pure inference from complete window sets. No file, DOM, state or network access.
(function(root){
  'use strict';
  const AZ={南:0,南東:-45,東:-90,北東:-135,北:180,北西:135,西:90,南西:45};
  const finite=n=>typeof n==='number'&&Number.isFinite(n),wrap=n=>((n+180)%360+360)%360-180;
  const az=w=>finite(w.az)?w.az:finite(AZ[w.orient])?AZ[w.orient]:null;
  const floor=value=>String(value??'').normalize('NFKC').trim().replace(/(?:階|F)$/i,'');
  function dimensions(window){
    const points=window.face?.verts||[];let width=window.width,height=window.height;
    if(points.length){height=Math.max(...points.map(p=>p.z))-Math.min(...points.map(p=>p.z));width=0;for(const a of points)for(const b of points)width=Math.max(width,Math.hypot(a.x-b.x,a.y-b.y));}
    return finite(width)&&width>0&&finite(height)&&height>0&&finite(window.area)&&window.area>0?[width,height,window.area]:null;
  }
  function plan(model,source,options={}){
    const counts={model:Array.isArray(model)?model.length:0,source:Array.isArray(source)?source.length:0,supportPairs:0,candidates:0,accepted:0,orientationGroups:0,dimensionGroups:0,matched:0};
    const result={ready:false,autoEligible:false,status:'held',proposedNorth:null,candidates:[],counts,codes:[]};
    const hold=code=>{result.codes.push(code);return result;};
    if(!Array.isArray(model)||!Array.isArray(source)||!finite(options.currentNorth)||typeof options.candidates!=='function'||typeof options.match!=='function')return hold('NORTH_MATCH_UNAVAILABLE');
    if(!model.length||model.length!==source.length)return hold('NORTH_SOURCE_MODEL_COUNT_MISMATCH');
    const modelAz=model.map(w=>az(w)??(finite(w.face?.modelToolAz)?wrap(w.face.modelToolAz-options.currentNorth):null)),sourceAz=source.map(az),normalizeFloor=options.floor||floor;
    if(modelAz.some(n=>n===null)||sourceAz.some(n=>n===null))return hold('NORTH_DIRECTION_UNKNOWN');
    if(model.some(w=>!normalizeFloor(w.floor))||source.some(w=>!normalizeFloor(w.floor)))return hold('NORTH_FLOOR_UNKNOWN');
    const modelDims=model.map(dimensions),sourceDims=source.map(dimensions);
    if(modelDims.some(d=>!d)||sourceDims.some(d=>!d))return hold('NORTH_DIMENSIONS_REQUIRED');
    const edges=model.map((window,i)=>options.candidates({...window,az:modelAz[i]},source.map(w=>({...w,az:modelAz[i]}))).map(candidate=>candidate.i));
    counts.supportPairs=edges.reduce((n,row)=>n+row.length,0);
    if(edges.some(row=>!row.length))return hold('NORTH_GEOMETRY_MISMATCH');
    const angles=[];
    edges.forEach((row,i)=>row.forEach(j=>{const angle=wrap(options.currentNorth+modelAz[i]-sourceAz[j]);if(!angles.some(prior=>Math.abs(wrap(prior-angle))<1e-5))angles.push(angle);}));
    counts.candidates=angles.length;
    // Cap work rather than selecting one angle by size or closeness to zero.
    if(angles.length>256)return hold('NORTH_CANDIDATE_LIMIT');
    const accepted=[];
    for(const north of angles){
      const rotated=model.map((window,i)=>({...window,az:wrap(modelAz[i]+options.currentNorth-north)})),matching=options.match(rotated,source);
      if(matching.hits.length!==model.length||matching.hits.some(hit=>!hit)||matching.used.size!==source.length)continue;
      accepted.push({north,matched:matching.hits.length,unique:matching.hits.filter(h=>h.method==='unique').length,equivalent:matching.hits.filter(h=>h.method==='equivalent').length});
    }
    counts.accepted=accepted.length;result.candidates=accepted;
    counts.orientationGroups=new Set(sourceAz.map(n=>Math.round(wrap(n)*10000)/10000)).size;
    const dimensionGroups=[];for(const dims of sourceDims)if(!dimensionGroups.some(prior=>Math.abs(prior[0]-dims[0])<=.06&&Math.abs(prior[1]-dims[1])<=.06&&Math.abs(prior[2]-dims[2])<=.06))dimensionGroups.push(dims);
    counts.dimensionGroups=dimensionGroups.length;
    if(!accepted.length)return hold('NORTH_NO_COMPLETE_STRICT_MATCH');
    if(accepted.length!==1){result.status='ambiguous';return hold('NORTH_ROTATION_AMBIGUOUS');}
    counts.matched=accepted[0].matched;result.proposedNorth=accepted[0].north;
    if(model.length<2||counts.orientationGroups<2&&counts.dimensionGroups<2)return hold('NORTH_INDEPENDENT_EVIDENCE_REQUIRED');
    if((options.contradictions||[]).length){result.codes.push(...new Set(options.contradictions.filter(code=>/^NORTH_[A-Z0-9_]+$/.test(code))));return hold('NORTH_MODEL_ROOM_REVIEW_REQUIRED');}
    result.ready=true;
    if(options.preserveNorth){result.status='preserved';result.codes.push('NORTH_EXISTING_SETTING_PRESERVED');return result;}
    if(Math.abs(wrap(options.currentNorth-result.proposedNorth))<1e-5){result.status='aligned';return result;}
    result.status='proposal';result.autoEligible=true;return result;
  }
  root.boundaryPlanNorthMatch=plan;
  if(typeof module!=='undefined'&&module.exports)module.exports={boundaryPlanNorthMatch:plan};
})(typeof window==='undefined'?globalThis:window);

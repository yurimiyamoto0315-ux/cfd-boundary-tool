// Assign floors only after the person explicitly chooses the plan layout.
(function(root){
  'use strict';
  const layouts={
    'left1-right2':{axis:'x',low:'1',high:'2',lowLabel:'左',highLabel:'右'},
    'left2-right1':{axis:'x',low:'2',high:'1',lowLabel:'左',highLabel:'右'},
    // PDF y coordinates increase upward.
    'top1-bottom2':{axis:'y',low:'2',high:'1',lowLabel:'下',highLabel:'上'},
    'top2-bottom1':{axis:'y',low:'1',high:'2',lowLabel:'下',highLabel:'上'}
  };
  function copy(value){
    if(Array.isArray(value))return value.map(copy);
    if(value&&typeof value==='object'){const result={};for(const key of Object.keys(value))result[key]=copy(value[key]);return result;}
    return value;
  }
  function knownFloor(value){
    const text=String(value==null?'':value).normalize('NFKC').replace(/\s/g,'').toUpperCase();
    if(!text||/^(?:不明|UNKNOWN|\?)$/.test(text))return null;
    const number=/^(?:地上)?(\d+)(?:F|階)?$/.exec(text);
    if(number)return String(Number(number[1]));
    if(/^(?:R|RF|屋上|屋根)$/.test(text))return 'R';
    const basement=/^(?:B(\d+)(?:F|階)?|地下(\d+)階)$/.exec(text);
    return basement?'B'+String(Number(basement[1]||basement[2])):text;
  }
  function median(values){const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]||0;}
  function splitPage(entries,layout){
    const axis=layout.axis,size=axis==='x'?'width':'height';
    const rows=entries.map(entry=>({entry,center:entry.room.plan[axis]+entry.room.plan[size]/2,half:entry.room.plan[size]/2})).sort((a,b)=>a.center-b.center);
    if(rows.length<4)return {code:'PLAN_FLOOR_LAYOUT_GROUP_UNCERTAIN'};
    const gaps=rows.slice(1).map((row,i)=>({index:i,value:row.center-rows[i].center,
      white:row.center-row.half-(rows[i].center+rows[i].half)})).sort((a,b)=>b.value-a.value);
    const best=gaps[0],runner=gaps[1],minimumWhite=Math.max(12,median(rows.map(r=>r.half*2))*1.5);
    // Uniform spacing, overlapping labels, and nearly equal gaps do not prove
    // that a page contains two floor-plan groups.
    if(!best||best.white<minimumWhite)return {code:'PLAN_FLOOR_LAYOUT_SINGLE_CLUSTER'};
    if(runner&&best.value<=runner.value*1.8+1e-6)return {code:'PLAN_FLOOR_LAYOUT_GAP_AMBIGUOUS'};
    const low=rows.slice(0,best.index+1),high=rows.slice(best.index+1);
    if(low.length<2||high.length<2)return {code:'PLAN_FLOOR_LAYOUT_GROUP_UNCERTAIN'};
    return {low:low.map(r=>r.entry),high:high.map(r=>r.entry)};
  }
  function atPlanFloorLayout(rooms,mode){
    const original=Array.isArray(rooms)?rooms:[],cloned=copy(original),groups=[],issues=[];
    function stop(code,sourcePage,count){issues.push({code,...(sourcePage==null?{}:{sourcePage}),...(count==null?{}:{count})});}
    function result(){return {ready:issues.length===0,rooms:cloned,codes:[...new Set(issues.map(issue=>issue.code))],groups,issues};}
    if(!mode){stop('PLAN_FLOOR_LAYOUT_REQUIRED');return result();}
    const layout=layouts[mode];
    if(!layout){stop('PLAN_FLOOR_LAYOUT_INVALID_MODE');return result();}
    const plans=original.map((room,index)=>({room,index})).filter(entry=>entry.room&&entry.room.sourceKind==='plan');
    if(!plans.length){stop('PLAN_FLOOR_LAYOUT_NO_PLAN_ROOMS');return result();}
    const pages=new Map();
    for(const entry of plans){
      const p=entry.room.plan,page=entry.room.sourcePage;
      if(!Number.isInteger(page)||page<1||!p||!['x','y','width','height'].every(key=>Number.isFinite(p[key]))||p.width<0||p.height<0){
        stop('PLAN_FLOOR_LAYOUT_INVALID_ROOM',Number.isInteger(page)?page:undefined);continue;
      }
      if(!pages.has(page))pages.set(page,[]);pages.get(page).push(entry);
    }
    const assignments=[];
    for(const [page,entries] of Array.from(pages).sort((a,b)=>a[0]-b[0])){
      const split=splitPage(entries,layout);
      if(split.code){stop(split.code,page,entries.length);continue;}
      for(const side of ['low','high']){
        const floor=layout[side],label=layout[side+'Label'],members=split[side];
        const conflicts=members.filter(entry=>knownFloor(entry.room.floor)&&knownFloor(entry.room.floor)!==floor);
        if(conflicts.length)stop('PLAN_FLOOR_LAYOUT_SOURCE_CONFLICT',page,conflicts.length);
        groups.push({sourcePage:page,position:label,floor,label:label+'：'+floor+'階',count:members.length,
          roomKeys:members.map(entry=>entry.room.key==null?'room-'+entry.index:String(entry.room.key))});
        members.forEach(entry=>assignments.push({index:entry.index,floor}));
      }
    }
    // Commit to the clones only if every involved page and existing floor agrees.
    if(!issues.length)for(const assignment of assignments){
      const room=cloned[assignment.index];room.floor=assignment.floor;room.userConfirmed=true;room.floorSource='user-layout';delete room.floorEvidenceIncomplete;
    }
    return result();
  }
  root.atPlanFloorLayout=atPlanFloorLayout;
  if(typeof module!=='undefined'&&module.exports)module.exports={atPlanFloorLayout};
})(typeof globalThis!=='undefined'?globalThis:this);

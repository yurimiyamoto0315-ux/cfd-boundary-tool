/* Local steady, single-node attic estimate. Coordinates must be metres.
 * Sol-air boundary + roof/ceiling conductance + outdoor ventilation.
 * No storage, detailed longwave exchange, gable transmission or air stratification.
 */
(function(root){
  'use strict';
  const num=v=>v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v))?Number(v):null;
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0))/2;
  function clip(subject,triangle){
    let out=subject.map(p=>({...p}));const sign=Math.sign(cross(...triangle));if(!sign)return [];
    for(let i=0;i<3;i++){
      const input=out;out=[];const a=triangle[i],b=triangle[(i+1)%3];
      for(let j=0;j<input.length;j++){
        const p=input[j],q=input[(j+1)%input.length],dp=sign*cross(a,b,p),dq=sign*cross(a,b,q);
        if(dp>=-1e-9)out.push(p);
        if((dp>=-1e-9)!==(dq>=-1e-9)){const t=dp/(dp-dq);out.push({x:p.x+t*(q.x-p.x),y:p.y+t*(q.y-p.y),z:(p.z||0)+t*((q.z||0)-(p.z||0))});}
      }
    }
    return out;
  }
  function ringTriangles(ring){
    const p=(ring||[]).map(v=>({...v}));if(p.length>2&&Math.hypot(p[0].x-p.at(-1).x,p[0].y-p.at(-1).y)<1e-8)p.pop();
    if(p.length<3)return [];
    const signed=p.reduce((s,a,i)=>s+a.x*p[(i+1)%p.length].y-p[(i+1)%p.length].x*a.y,0);if(signed<0)p.reverse();
    const out=[];let guard=p.length*p.length;
    while(p.length>3&&guard--){let found=false;for(let i=0;i<p.length;i++){
      const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length];if(cross(a,b,c)<=1e-10)continue;
      if(p.some(v=>v!==a&&v!==b&&v!==c&&cross(a,b,v)>=-1e-9&&cross(b,c,v)>=-1e-9&&cross(c,a,v)>=-1e-9))continue;
      out.push([a,b,c]);p.splice(i,1);found=true;break;
    }if(!found)return [];}
    if(p.length===3)out.push(p);return out;
  }
  function triangles(face){
    const v=face.verts||[];
    const indices=face.tris;
    return indices?.length?indices.map(t=>t.map(i=>v[i])).filter(t=>t.length===3&&t.every(p=>p&&[p.x,p.y,p.z].every(Number.isFinite))):ringTriangles(v);
  }
  function uniqueTriangles(faces){
    const seen=new Set(),out=[];
    faces.forEach(face=>triangles(face).forEach(t=>{const key=t.map(v=>[v.x,v.y,v.z].map(x=>Math.round(x*1e6)).join(',')).sort().join(';');if(!seen.has(key)){seen.add(key);out.push(t);}}));return out;
  }
  function classify(mesh){
    const faces=(mesh?.meshFaces||[]).filter(f=>f.nameJa==='天井'),top=[],inside=[],uncertain=[];
    faces.forEach(f=>{
      const ts=uniqueTriangles([f]),zs=ts.flat().map(p=>p.z),a=ts.reduce((s,t)=>s+area(t),0);
      if(!a||!zs.length||Math.max(...zs)-Math.min(...zs)>.03){uncertain.push(f);return;}
      const z=zs[0],upperRooms=(mesh.rooms||[]).filter(r=>num(r.z)!==null&&num(r.z)>z+.05&&r.ring?.length>=3);
      const nearest=upperRooms.length?Math.min(...upperRooms.map(r=>r.z)):null;
      const upper=nearest!==null?upperRooms.filter(r=>Math.abs(r.z-nearest)<.05).flatMap(r=>ringTriangles(r.ring)):
        uniqueTriangles(faces.filter(other=>{const v=other.verts||[],heights=v.map(p=>p.z);return other!==f&&v.length>=3&&Math.max(...heights)-Math.min(...heights)<=.03&&v.every(p=>p.z>z+.05);}));
      const cover=ts.reduce((s,t)=>s+upper.reduce((n,u)=>n+area(clip(t,u)),0),0),tol=Math.max(.005,a*.002);
      if(cover<=tol)top.push(f);else if(Math.abs(cover-a)<=tol)inside.push(f);else uncertain.push(f);
    });return {top,inside,uncertain};
  }
  function geometry(mesh){
    const classified=classify(mesh),ceilings=uniqueTriangles(classified.top),roofs=uniqueTriangles((mesh?.meshFaces||[]).filter(f=>f.sslKey==='roof'));
    const ceilingArea=ceilings.reduce((s,t)=>s+area(t),0);let roofArea=0,covered=0,volume=0;const patches=[];
    roofs.forEach(t=>{
      const projected=area(t);if(projected<1e-8)return;
      const a=t[0],b=t[1],c=t[2],ab={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},ac={x:c.x-a.x,y:c.y-a.y,z:c.z-a.z};
      const surface=Math.hypot(ab.y*ac.z-ab.z*ac.y,ab.z*ac.x-ab.x*ac.z,ab.x*ac.y-ab.y*ac.x)/2;
      const cosTilt=projected/surface;
      ceilings.forEach(ct=>{
        const p=clip(t,ct),pa=area(p);if(pa<1e-8||p.some(v=>v.z<ct[0].z-.03))return;
        let v=0;for(let i=1;i<p.length-1;i++){const tri=[p[0],p[i],p[i+1]];v+=area(tri)*Math.max(0,(tri.reduce((s,x)=>s+x.z,0)/3-ct[0].z));}
        roofArea+=pa/cosTilt;covered+=pa;volume+=v;
        // Unit normal; winding does not determine outward/upward direction.
        let normal={x:ab.y*ac.z-ab.z*ac.y,y:ab.z*ac.x-ab.x*ac.z,z:ab.x*ac.y-ab.y*ac.x};
        const length=Math.hypot(normal.x,normal.y,normal.z),sign=normal.z<0?-1:1;Object.keys(normal).forEach(k=>normal[k]*=sign/length);
        patches.push({area:pa/cosTilt,normal});
      });
    });
    return {ceilingArea,roofArea,volume,patches,coverage:ceilingArea?covered/ceilingArea:0,...classified};
  }
  function specs(data,part){
    if(part==='屋根'&&num(data?.activeRoofU)>0)return [{id:'source-0',u:Number(data.activeRoofU),label:'共通の断熱設定「屋根U」'}];
    const groups=new Map();(data?.csvBoundaryRows||[]).filter(r=>r.part===part).forEach(r=>{
      const key=String(r.spec||'');if(!groups.has(key))groups.set(key,{area:0,loss:0,valid:true});const g=groups.get(key);
      g.valid=g.valid&&num(r.area)>0&&num(r.heatLoss)>0;g.area+=Number(r.area)||0;g.loss+=Number(r.heatLoss)||0;
    });
    const list=[...groups.values()].map((g,i)=>({id:'source-'+i,u:g.valid?g.loss/g.area:null,label:'読込仕様 '+(i+1)}));
    if(!groups.size&&part==='屋根'&&num(data?.uRoof)>0)list.push({id:'source-0',u:Number(data.uRoof),label:'読込済みの屋根U値'});
    if(!groups.size&&part==='天井'&&num(data?.uCeiling)>0)list.push({id:'source-0',u:Number(data.uCeiling),source:'pdf',label:'PDFから取得した天井U値'});
    return list;
  }
  const presets={roof:{bare:4,light:.6,medium:.3,high:.15},ceiling:{bare:4,light:.5,medium:.25,high:.15}};
  function resolveU(part,key,manual,data){
    const choices=specs(data,part==='roof'?'屋根':'天井');
    if(!key&&choices.length===1)return choices[0].u;
    if(key?.startsWith('source-'))return choices.find(c=>c.id===key)?.u??null;
    if(key==='manual')return num(manual);
    return presets[part][key]??null;
  }
  function solve({outdoor,indoor,roofU,ceilingU,ceilingArea,patches,flow}){
    const roofH=patches.reduce((s,p)=>s+roofU*p.area,0),ceilingH=ceilingU*ceilingArea,ventH=1206*flow/3600;
    const roofHeat=patches.reduce((s,p)=>s+roofU*p.area*p.sat,0),temperature=(roofHeat+ceilingH*indoor+ventH*outdoor)/(roofH+ceilingH+ventH);
    return {temperature,heat:ceilingH*(temperature-indoor),roofH,ceilingH,ventH};
  }
  function estimate(data,mesh,options,climate){
    const g=geometry(mesh),codes=[];
    if(mesh?.readiness?.ready===false)codes.push('MODEL');
    const roofU=num(options.roofUOverride)!==null?num(options.roofUOverride):resolveU('roof',options.roofSpec,options.roofU,data),ceilingU=num(options.ceilingUOverride)!==null?num(options.ceilingUOverride):resolveU('ceiling',options.ceilingSpec,options.ceilingU,data);
    if(!['ceiling','roof'].includes(options.insulation))codes.push('INSULATION');
    if(!(roofU>0&&roofU<=20))codes.push('ROOF_U');if(!(ceilingU>0&&ceilingU<=20))codes.push('CEILING_U');
    if(!g.ceilingArea||g.uncertain.length)codes.push('CEILING_GEOMETRY');
    if(!g.roofArea||Math.abs(g.coverage-1)>.02)codes.push('ROOF_GEOMETRY');
    const numeric=['outdoor','indoor','alpha','ho','rho','correction','sunX','sunY','sunZ','direct','diffuse'];
    if(numeric.some(k=>num(climate?.[k])===null)||climate.ho<=0||climate.alpha<0||climate.alpha>1||climate.rho<0||climate.rho>1||climate.direct<0||climate.diffuse<0||climate.outdoor<=-273.15||climate.indoor<=-273.15)codes.push('CLIMATE');
    const volume=num(options.volume)>0?Number(options.volume):g.volume;
    if(options.volume!==undefined&&options.volume!==''&&!(num(options.volume)>0))codes.push('VOLUME');
    let flow=null;
    if(options.vent==='flow')flow=num(options.flow);
    else if(['0','0.5','5'].includes(options.vent)&&volume>0)flow=Number(options.vent)*volume;
    if(['0','0.5','5'].includes(options.vent)&&!(volume>0))codes.push('VENTILATION_VOLUME');
    else if(flow===null||flow<0||flow>1e7)codes.push('VENTILATION');
    if(!options.confirmed)codes.push('CONFIRM');
    const fingerprint=JSON.stringify([options,roofU,ceilingU,g.ceilingArea,g.roofArea,volume,g.patches,climate]);
    if(codes.length)return {ready:false,codes,geometry:g,roofU,ceilingU,fingerprint};
    const patches=g.patches.map(p=>{
      const incidence=Math.max(0,p.normal.x*climate.sunX+p.normal.y*climate.sunY+p.normal.z*climate.sunZ);
      const irradiance=climate.direct*incidence+climate.diffuse*(1+p.normal.z)/2+(climate.direct*Math.max(0,climate.sunZ)+climate.diffuse)*climate.rho*(1-p.normal.z)/2;
      return {...p,sat:climate.outdoor+climate.alpha*irradiance/climate.ho-climate.correction*(1+p.normal.z)/2};
    });
    const input={outdoor:climate.outdoor,indoor:climate.indoor,roofU,ceilingU,ceilingArea:g.ceilingArea,patches,flow};
    const result=solve(input),sensitivity=[0,.5,5].map(ach=>({ach,...solve({...input,flow:ach*volume})}));
    if(!Number.isFinite(result.temperature)||!Number.isFinite(result.heat))return {ready:false,codes:['NUMERIC'],fingerprint};
    return {...result,ready:true,codes:[],geometry:g,roofU,ceilingU,flow,volume,sensitivity,fingerprint};
  }
  function insulationEvidence(data){
    const rows=data?.csvBoundaryRows||[],ceiling=rows.some(r=>r.part==='天井'&&r.adjacent==='小屋裏'),roof=rows.some(r=>r.part==='屋根');
    return ceiling&&!roof?'ceiling':roof&&!rows.some(r=>r.part==='天井')?'roof':null;
  }
  const api={geometry,classify,specs,estimate,solve,presets,insulationEvidence};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BoundaryAtticModel=api;
})(typeof window!=='undefined'?window:globalThis);

// Solar units: radians / south-zero inside the legacy tool, degrees / north-zero at pvlib.
(function(root){
  'use strict';
  const radians=Math.PI/180;
  const normalized=value=>((value%360)+360)%360;
  const number=value=>Number(Number(value).toFixed(8));
  function surfaceKey(tilt,toolAz){return number(tilt)+':'+number(normalized(toolAz+180));}
  function surfaceSpec(tilt,toolAz){return {id:surfaceKey(tilt,toolAz),tilt:number(tilt),azimuth:number(normalized(toolAz+180))};}
  function normalPlane(normal,north=0){
    const angle=north*radians,c=Math.cos(angle),s=Math.sin(angle);
    const length=Math.hypot(normal.x,normal.y,normal.z);
    if(!(length>0))throw new Error('面の法線が不正です');
    const east=(normal.x*c-normal.y*s)/length,northward=(normal.x*s+normal.y*c)/length,z=normal.z/length;
    return {tilt:Math.acos(Math.max(-1,Math.min(1,z)))/radians,
      toolAz:Math.abs(z)>1-1e-12?-180:normalized(Math.atan2(east,northward)/radians)-180};
  }
  function normalKey(normal){return [normal.x,normal.y,normal.z].map(number).join(':');}
  function frame(context,hour){
    const i=context.hours.indexOf(Number(hour));
    if(i<0)throw new Error('日射データに指定した時間帯がありません');
    const alt=context.sun.altitude[i]*radians,az=(context.sun.azimuth[i]-180)*radians;
    return {hour:Number(hour),index:i,alt,az,sinAlt:Math.sin(alt),dni:context.weather.dni[i],
      dhi:context.weather.dhi[i],ghi:context.weather.ghi[i],temperature:context.weather.temperature[i]};
  }
  function surface(context,tilt,toolAz,hour){
    const record=context.surfaces[surfaceKey(tilt,toolAz)],i=context.hours.indexOf(Number(hour));
    if(!record||i<0)throw new Error('この面の日射計算がまだ完了していません');
    return Object.fromEntries(['beam','sky','ground','total'].map(key=>[key,record[key][i]]));
  }
  function legacyFrame({y,mo,d,hour,lat,lon,tmax,tmin,tpeak},position,temperature){
    const sun=lat===null||lon===null?{alt:0,az:0,sinAlt:0}:position(y,mo,d,hour,lat,lon);
    const dni=sun.alt>0?1098*Math.exp(-.057/Math.sin(sun.alt)):0,dhi=.125*dni;
    return {...sun,hour,dni,dhi,ghi:dni*Math.max(0,sun.sinAlt)+dhi,
      temperature:tmax!==null&&tmin!==null&&tpeak!==null?temperature(hour,tmax,tmin,tpeak):0};
  }
  function isotropic(state,tilt,toolAz,albedo){
    // Keep the original arithmetic order for legacy vertical/horizontal outputs.
    if(tilt===90){
      const beam=state.alt>0?state.dni*Math.max(0,Math.cos(state.alt)*Math.cos(state.az-toolAz*radians)):0;
      const sky=state.dhi*.5,ground=state.ghi*albedo*.5;
      return {beam,sky,ground,total:beam+sky+ground};
    }
    if(tilt===0){const beam=state.alt>0?state.dni*Math.max(0,state.sinAlt??Math.sin(state.alt)):0;return {beam,sky:state.dhi,ground:0,total:beam+state.dhi};}
    const beta=tilt*radians;
    const cosInc=Math.sin(state.alt)*Math.cos(beta)+Math.cos(state.alt)*Math.sin(beta)*Math.cos(state.az-toolAz*radians);
    const beam=state.alt>0?state.dni*Math.max(0,cosInc):0;
    const sky=state.dhi*(1+Math.cos(beta))/2,ground=state.ghi*albedo*(1-Math.cos(beta))/2;
    return {beam,sky,ground,total:beam+sky+ground};
  }
  const api={surfaceKey,surfaceSpec,normalPlane,normalKey,frame,surface,legacyFrame,isotropic};
  root.BoundarySolarData=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);

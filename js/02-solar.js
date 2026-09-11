// ========================= 太陽位置・気温 =========================
function solarPos(y,mo,d,hour,lat,lon){
  const dt = new Date(y,mo-1,d);
  const start = new Date(y,0,0);
  const n = Math.floor((dt-start)/86400000);
  const latR = lat*Math.PI/180;
  const decl = 23.45*Math.sin(2*Math.PI*(284+n)/365)*Math.PI/180;
  const B = 2*Math.PI*(n-81)/365;
  const eot = 9.87*Math.sin(2*B) - 7.53*Math.cos(B) - 1.5*Math.sin(B);
  const solarTime = hour + eot/60 + (lon-135)/15;
  const H = (15*(solarTime-12))*Math.PI/180;
  const sinAlt = Math.sin(latR)*Math.sin(decl)+Math.cos(latR)*Math.cos(decl)*Math.cos(H);
  const alt = Math.asin(Math.max(-1,Math.min(1,sinAlt)));
  let az=0;
  if(alt>0){
    let cosAz=(sinAlt*Math.sin(latR)-Math.sin(decl))/(Math.cos(alt)*Math.cos(latR));
    cosAz=Math.max(-1,Math.min(1,cosAz));
    az=Math.acos(cosAz);
    if(H<0) az=-az;
  }
  return {alt, az, sinAlt};
}
function taAt(hour, tmax, tmin, tpeak){
  const tave=(tmax+tmin)/2, tamp=(tmax-tmin)/2;
  return tave + tamp*Math.cos(2*Math.PI*(hour-tpeak)/24);
}

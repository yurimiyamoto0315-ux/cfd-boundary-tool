// Grasshopper 時代の SAT / ISO 13786 ETD / 窓 r_G をブラウザへ移植。
// EnergyPlus SQL の面日射があればそれを使い、無ければ従来の晴天 I_DN に r_G だけ掛ける。

const SAT_PERIOD_H = 24;
const RG_TABLE = {
  S: {6:0.10, 7:0.14, 8:0.17, 9:0.27, 10:0.45, 11:0.61, 12:0.70,
      13:0.69, 14:0.58, 15:0.43, 16:0.33, 17:0.27, 18:0.22, 19:0.15, 20:0.12},
  E: {6:0.40, 7:0.60, 8:0.67, 9:0.65, 10:0.53, 11:0.35, 12:0.23,
      13:0.19, 14:0.16, 15:0.14, 16:0.13, 17:0.12, 18:0.10, 19:0.07, 20:0.06},
  W: {6:0.06, 7:0.07, 8:0.08, 9:0.08, 10:0.08, 11:0.08, 12:0.08,
      13:0.08, 14:0.38, 15:0.56, 16:0.68, 17:0.71, 18:0.57, 19:0.28, 20:0.19}
};

function rgCardinalFromToolAz(toolAz){
  const a = ((Number(toolAz)||0)+180)%360-180;
  if(Math.abs(a)>=135) return 'N';
  if(a<=-45) return 'E';
  if(a>=45) return 'W';
  return 'S';
}
function getRG(orientation, hour){
  const key = String(orientation||'').toUpperCase().slice(0,1);
  if(key==='N') return 1;
  const tbl = RG_TABLE[key];
  if(!tbl) return 1;
  const h = Math.round(Number(hour));
  if(tbl[h]!=null) return tbl[h];
  if(h<6) return tbl[6];
  return tbl[20];
}
function windowSolarCoeff(fc, rG){
  const f = (fc!=null && isFinite(fc)) ? Number(fc) : 0.10;
  const r = (rG!=null && isFinite(rG)) ? Number(rG) : 1;
  return f + (1-f)*r;
}

function cz(re, im){ return {re:re||0, im:im||0}; }
function cadd(a,b){ return cz(a.re+b.re, a.im+b.im); }
function cmul(a,b){ return cz(a.re*b.re-a.im*b.im, a.re*b.im+a.im*b.re); }
function cscale(a,s){ return cz(a.re*s, a.im*s); }
function cabs(a){ return Math.sqrt(a.re*a.re+a.im*a.im); }
function carg(a){ return Math.atan2(a.im, a.re); }
function cinv(a){
  const d=a.re*a.re+a.im*a.im;
  if(!(d>0)) return cz(0,0);
  return cz(a.re/d, -a.im/d);
}
function isoMM(A,B){
  return [
    [cadd(cmul(A[0][0],B[0][0]), cmul(A[0][1],B[1][0])), cadd(cmul(A[0][0],B[0][1]), cmul(A[0][1],B[1][1]))],
    [cadd(cmul(A[1][0],B[0][0]), cmul(A[1][1],B[1][0])), cadd(cmul(A[1][0],B[0][1]), cmul(A[1][1],B[1][1]))]
  ];
}
function isoFilm(R){
  return [[cz(1,0), cz(-Number(R)||0, 0)], [cz(0,0), cz(1,0)]];
}
function isoLayer(d, lam, rho, cp, ps){
  d=Number(d)||0; lam=Number(lam)||0; rho=Number(rho)||0; cp=Number(cp)||0;
  if(d<=0) return [[cz(1,0), cz(0,0)], [cz(0,0), cz(1,0)]];
  if(!(rho*cp>0) || !(lam>0)){
    const R = lam>0 ? d/lam : 0;
    return [[cz(1,0), cz(-R,0)], [cz(0,0), cz(1,0)]];
  }
  const aa=lam/(rho*cp);
  const delta=Math.sqrt(aa*ps/Math.PI);
  const xi=d/delta;
  const ch=Math.cosh(xi), sh=Math.sinh(xi), co=Math.cos(xi), si=Math.sin(xi);
  const z11=cz(ch*co, sh*si);
  const z12=cscale(cz(sh*co+ch*si, ch*si-sh*co), -(delta/(2*lam)));
  const z21=cscale(cz(sh*co-ch*si, sh*co+ch*si), -(lam/delta));
  return [[z11, z12], [z21, z11]];
}
function iso13786(layers, Rse, Rsi, ph){
  const period=(ph!=null && ph>0)?ph:SAT_PERIOD_H;
  const ps=period*3600;
  let M=isoFilm(Rse);
  let Rs=0;
  (layers||[]).forEach(function(L){
    const d=L.d!=null?L.d:L[0];
    const lam=L.lam!=null?L.lam:L[1];
    const rho=L.rho!=null?L.rho:L[2];
    const cp=L.cp!=null?L.cp:L[3];
    M=isoMM(M, isoLayer(d, lam, rho, cp, ps));
    if(Number(lam)>0) Rs += Number(d)/Number(lam);
  });
  M=isoMM(M, isoFilm(Rsi));
  const U=1/((Number(Rse)||0)+Rs+(Number(Rsi)||0));
  const Y12=cscale(cinv(M[0][1]), -1);
  const eta=(U>0)?(cabs(Y12)/U):1;
  let phi=((-carg(Y12)/(2*Math.PI))*period)%period;
  if(phi<0) phi+=period;
  return {U:U, eta:eta, phi:phi};
}
function interp1(x, xp, fp){
  if(!xp || !xp.length) return 0;
  if(x<=xp[0]) return fp[0];
  if(x>=xp[xp.length-1]) return fp[fp.length-1];
  let lo=0, hi=xp.length-1;
  while(hi-lo>1){
    const mid=(lo+hi)>>1;
    if(xp[mid]<=x) lo=mid; else hi=mid;
  }
  const t=(x-xp[lo])/(xp[hi]-xp[lo]||1);
  return fp[lo]+t*(fp[hi]-fp[lo]);
}
function etdSeries(sat, hours, indoor, lag, dec){
  const n=sat.length;
  const hrs=hours && hours.length===n ? hours : sat.map(function(_,i){ return i; });
  const satLag=(lag && lag>0) ? hrs.map(function(h){ return interp1(h-lag, hrs, sat); }) : sat.slice();
  const h0=hrs[0];
  const keys=hrs.map(function(h){ return Math.floor((h-h0)/24); });
  const sums={}, cnts={};
  keys.forEach(function(k,i){
    const v=sat[i];
    if(!isFinite(v)) return;
    sums[k]=(sums[k]||0)+v; cnts[k]=(cnts[k]||0)+1;
  });
  const means={};
  Object.keys(sums).forEach(function(k){ means[k]=sums[k]/cnts[k]; });
  return keys.map(function(k,i){
    const mean=means[k];
    if(!isFinite(mean) || !isFinite(satLag[i])) return NaN;
    return (mean-indoor)+dec*(satLag[i]-mean);
  });
}
function solAirAt(oat, isol, a, alphaO, lw){
  return oat + a*isol/alphaO - (lw||0);
}

function parseEpwDrybulb(text){
  const lines=String(text||'').split(/\r?\n/);
  const loc=(lines[0]||'').split(',');
  const oatByKey={};
  let n=0, lat=null, lon=null;
  if(loc.length>8){
    lat=parseFloat(loc[6]); lon=parseFloat(loc[7]);
  }
  for(let i=8;i<lines.length;i++){
    const p=lines[i].split(',');
    if(p.length<7) continue;
    const mo=+p[1], d=+p[2], h=+p[3], t=parseFloat(p[6]);
    if(!(mo>0) || !(d>0) || !(h>0) || !isFinite(t)) continue;
    oatByKey[mo+'-'+d+'-'+h]=t;
    n++;
  }
  return {
    name:(loc[1]||'').trim(),
    lat:isFinite(lat)?lat:null,
    lon:isFinite(lon)?lon:null,
    oatByKey:oatByKey,
    n:n
  };
}

function epWxIndex(wx, month, day, hour){
  if(!wx || !(wx.n>0)) return -1;
  let h=Math.round(Number(hour));
  if(!(h>0)) h=24;
  if(h>24) h=24;
  const mo=+month, d=+day;
  for(let i=0;i<wx.n;i++){
    if(wx.mo[i]===mo && wx.d[i]===d && wx.h[i]===h) return i;
  }
  return -1;
}
function epWxSeriesAt(map, name, idx){
  if(!map || idx<0 || !name) return null;
  const key=(typeof idfNameKey==='function') ? idfNameKey(name) : String(name).trim().toLowerCase();
  const arr=map[key];
  if(!arr) return null;
  const v=arr[idx];
  return isFinite(v) ? v : null;
}

function readSolarFc(){
  if(typeof numOrNull==='function'){
    const v=numOrNull('solarFc');
    if(v!=null && isFinite(v)) return v;
  }
  return 0.10;
}

function epTransmittedW(winName, month, day, hour, area){
  if(typeof epSqlWx==='undefined' || !epSqlWx) return null;
  const idx=epWxIndex(epSqlWx, month, day, hour);
  if(idx<0) return null;
  let w=epWxSeriesAt(epSqlWx.transmittedW, winName, idx);
  if(w!=null) return w;
  const wm2=epWxSeriesAt(epSqlWx.transmittedWm2, winName, idx);
  if(wm2!=null && area>0) return wm2*area;
  return null;
}

function computeEpSatBundle(opts){
  const parse=(typeof epParse!=='undefined') ? epParse : null;
  const wx=(typeof epSqlWx!=='undefined') ? epSqlWx : null;
  const epw=(typeof epwData!=='undefined') ? epwData : null;
  if(!parse || !wx || !(wx.n>0) || !wx.nIncident) return null;
  const mo=opts.month, d=opts.day, hour=opts.hour;
  const idx=epWxIndex(wx, mo, d, hour);
  if(idx<0) return {ok:false, reason:'SQLに '+mo+'/'+d+' '+Math.round(hour)+' 時の行がありません'};
  const alpha=(opts.alpha>0)?opts.alpha:0.7;
  const ho=(opts.ho>0)?opts.ho:23;
  const roofCorr=(opts.roofCorr!=null && isFinite(opts.roofCorr))?opts.roofCorr:3.9;
  const indoor=(opts.targetT!=null && isFinite(opts.targetT))?opts.targetT:26;
  const Rse=1/ho;
  const Rsi=0.13;
  const hi=(opts.hi>0)?opts.hi:9;

  const oat=new Array(wx.n);
  let oatOk=0;
  for(let i=0;i<wx.n;i++){
    let t=wx.oat ? wx.oat[i] : NaN;
    if(!isFinite(t) && epw && epw.oatByKey){
      t=epw.oatByKey[wx.mo[i]+'-'+wx.d[i]+'-'+wx.h[i]];
    }
    oat[i]=t;
    if(isFinite(t)) oatOk++;
  }
  if(oatOk<24) return {ok:false, reason:'外気温の時系列が足りません。SQLかEPWを入れてください'};

  const hours=wx.n>1 ? oat.map(function(_,i){ return i; }) : null;
  const {hi:hiUse, ho:hoUse}=(typeof epHiHo==='function') ? epHiHo() : {hi:hi, ho:ho};
  const rows=(typeof epOpaqueRows==='function') ? epOpaqueRows(parse, hiUse, hoUse) : [];
  const groups={};
  function ensure(key){
    if(!groups[key]) groups[key]={satSum:[], etdQ:0, uaCfd:0, uaIso:0, area:0, iso:null, satAt:NaN, etdAt:NaN, isolAt:NaN, n:0};
    return groups[key];
  }
  rows.forEach(function(s){
    const t=String(s.type||'').toLowerCase();
    const isRoof=t==='roof' || t==='ceiling';
    const isWall=t==='wall';
    if(!isRoof && !isWall) return;
    const isolArr=wx.incident && wx.incident[(typeof idfNameKey==='function'?idfNameKey(s.name):String(s.name).toLowerCase())];
    if(!isolArr) return;
    const key=isRoof ? '屋根' : (s.orient||'南');
    const g=ensure(key);
    const lw=isRoof ? roofCorr : 0;
    const layers=(parse.consLayers && (parse.consLayers[s.construction] || (typeof idfGet==='function' ? idfGet(parse.consLayers, s.construction) : null))) || [];
    const iso=layers.length ? iso13786(layers, Rse, Rsi, SAT_PERIOD_H) : {U:s.u, eta:1, phi:0};
    const sat=oat.map(function(ta,i){
      const isol=isolArr[i];
      if(!isFinite(ta) || !isFinite(isol)) return NaN;
      return solAirAt(ta, isol, alpha, ho, lw);
    });
    const etd=etdSeries(sat, hours, indoor, iso.phi, iso.eta);
    const area=s.net>0?s.net:(s.gross||0);
    if(!(area>0)) return;
    const uCfd=(s.u>0)?s.u:(iso.U>0?iso.U:null);
    const uIso=(iso.U>0)?iso.U:uCfd;
    if(!(g.satSum.length)) g.satSum=sat.map(function(){ return {w:0, a:0}; });
    sat.forEach(function(v,i){
      if(!isFinite(v)) return;
      g.satSum[i].w+=v*area; g.satSum[i].a+=area;
    });
    const e=etd[idx], sa=sat[idx], isol=isolArr[idx];
    if(isFinite(e) && uIso>0){
      g.etdQ += uIso*e*area;
      g.uaIso += uIso*area;
    }
    if(uCfd>0) g.uaCfd += uCfd*area;
    g.area += area;
    g.n += 1;
    if(isFinite(sa)) g.satAt = isFinite(g.satAt) ? g.satAt : 0;
    if(!g.iso) g.iso=iso;
    g._satW=(g._satW||0)+(isFinite(sa)?sa*area:0);
    g._satA=(g._satA||0)+(isFinite(sa)?area:0);
    g._etdW=(g._etdW||0)+(isFinite(e)?e*area:0);
    g._etdA=(g._etdA||0)+(isFinite(e)?area:0);
    g._isolW=(g._isolW||0)+(isFinite(isol)?isol*area:0);
    g._isolA=(g._isolA||0)+(isFinite(isol)?area:0);
  });

  const satByOri={}, satRawByOri={}, etdByOri={}, isoByOri={}, isolByOri={};
  const daySatByOri={};
  let used=0;
  Object.keys(groups).forEach(function(key){
    const g=groups[key];
    if(!(g.n>0)) return;
    used+=g.n;
    const satRaw=(g._satA>0)?g._satW/g._satA:NaN;
    const etd=(g._etdA>0)?g._etdW/g._etdA:NaN;
    const ua=g.uaCfd>0?g.uaCfd:g.uaIso;
    const tCfd=(ua>0 && isFinite(g.etdQ)) ? indoor + g.etdQ/ua : (isFinite(etd)?indoor+etd:satRaw);
    const day=g.satSum.map(function(p){ return p.a>0?p.w/p.a:null; });
    if(key==='屋根'){
      groups._roof={tCfd:tCfd, satRaw:satRaw, etd:etd, iso:g.iso, isol:(g._isolA>0)?g._isolW/g._isolA:NaN, day:day, n:g.n, area:g.area};
    }else{
      satByOri[key]=tCfd;
      satRawByOri[key]=satRaw;
      etdByOri[key]=etd;
      isoByOri[key]=g.iso;
      isolByOri[key]=(g._isolA>0)?g._isolW/g._isolA:NaN;
      daySatByOri[key]=day;
    }
  });
  if(!used) return {ok:false, reason:'SQLの入射日射が、居室の外壁・屋根名と一致しませんでした'};

  const roof=groups._roof||{};
  const dayHours=[];
  for(let i=0;i<wx.n;i++){
    if(wx.mo[i]===mo && wx.d[i]===d) dayHours.push({i:i, h:wx.h[i]});
  }
  function dayVals(arr){
    if(!arr) return null;
    const out=new Array(25).fill(null);
    dayHours.forEach(function(t){
      const v=arr[t.i];
      const h=Math.min(24, Math.max(0, t.h));
      if(isFinite(v)) out[h]=v;
    });
    return out;
  }
  const daySeries={};
  Object.keys(daySatByOri).forEach(function(k){ daySeries[k]=dayVals(daySatByOri[k]); });
  return {
    ok:true,
    idx:idx,
    oatAt:oat[idx],
    satByOri:satByOri,
    satRawByOri:satRawByOri,
    etdByOri:etdByOri,
    isoByOri:isoByOri,
    isolByOri:isolByOri,
    roofSat:roof.tCfd,
    roofSatRaw:roof.satRaw,
    roofEtd:roof.etd,
    roofIso:roof.iso,
    roofIsol:roof.isol,
    nSurfaces:used,
    daySeries:daySeries,
    dayRoof:dayVals(roof.day)
  };
}

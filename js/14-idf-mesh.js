// ========================= IDF → 色分け 3DS 書き出し =========================
// EnergyPlus の meshFaces (12-energyplus.js) から厚みなしポリゴンの 3DS を作る。
// 窓は親壁と同一平面にぴったり重ねる（色で識別）。単位は mm。

const IDF_MESH_PALETTE = {
  wall_北: {r:40, g:80, b:180, mat:'WALL_N'},
  wall_東: {r:40, g:160, b:80, mat:'WALL_E'},
  wall_南: {r:200, g:60, b:50, mat:'WALL_S'},
  wall_西: {r:180, g:140, b:40, mat:'WALL_W'},
  roof: {r:120, g:50, b:50, mat:'ROOF'},
  floor1: {r:90, g:90, b:90, mat:'FLOOR1'},
  found: {r:70, g:50, b:40, mat:'FOUND'},
  innerwall: {r:180, g:180, b:180, mat:'INNER'},
  window: {r:80, g:180, b:220, mat:'WINDOW'},
  doorbody: {r:140, g:90, b:50, mat:'DOOR'}
};

const IDF_MESH_SJIS = {
"\u5916":[0x8A,0x4F],
"\u58C1":[0x95,0xC7],
"\u5317":[0x96,0x6B],
"\u6771":[0x93,0x8C],
"\u5357":[0x93,0xEC],
"\u897F":[0x90,0xBC],
"\u7A93":[0x91,0x8B],
"\u5185":[0x93,0xE0],
"\u5C4B":[0x89,0xAE],
"\u6839":[0x8D,0xAA],
"\u5E8A":[0x8F,0xB0],
"\u57FA":[0x8A,0xEE],
"\u790E":[0x91,0x62],
"\u30C9":[0x83,0x68],
"\u30A2":[0x83,0x41],
"\u5929":[0x93,0x56],
"\u4E95":[0x88,0xE4]
};

function idfMeshSjisBytes(text){
  const bytes = [];
  const bad = [];
  for(const ch of String(text)){
    const code = ch.codePointAt(0);
    if(code<128) bytes.push(code);
    else if(IDF_MESH_SJIS[ch]) IDF_MESH_SJIS[ch].forEach(b=>bytes.push(b));
    else if(bad.indexOf(ch)===-1) bad.push(ch);
  }
  return {bytes, bad};
}

function idfMeshU16(n){ return [n&255, (n>>>8)&255]; }
function idfMeshU32(n){ return [n&255, (n>>>8)&255, (n>>>16)&255, (n>>>24)&255]; }
function idfMeshF32(n){
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, n, true);
  return [dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)];
}
function idfMeshConcat(parts){
  const out = [];
  parts.forEach(p=>{
    if(p==null) return;
    if(typeof p==='number') out.push(p&255);
    else for(let i=0;i<p.length;i++) out.push(p[i]&255);
  });
  return out;
}
function idfMeshChunk(id, payload){
  const body = idfMeshConcat([payload]);
  return idfMeshConcat([idfMeshU16(id), idfMeshU32(6+body.length), body]);
}
function idfMeshAsciiZ(s){
  const bytes = [];
  const t = String(s||'');
  for(let i=0;i<t.length;i++) bytes.push(t.charCodeAt(i)&127);
  bytes.push(0);
  return bytes;
}
function idfMeshNameZ(str){
  const enc = idfMeshSjisBytes(str);
  if(enc.bad.length || enc.bytes.length>10){
    return {bytes: idfMeshAsciiZ(str.replace(/[^\x20-\x7E]/g,'').slice(0,10)||'OBJ'), ok:false};
  }
  return {bytes: enc.bytes.concat([0]), ok:true};
}

function idfMeshToMm(face){
  return (face.verts||[]).map(v=>({x:v.x*1000, y:v.y*1000, z:v.z*1000}));
}

function idfMeshTriangulate(n){
  const faces = [];
  for(let i=1;i<=n-2;i++) faces.push([0, i, i+1]);
  return faces;
}

function idfMeshColor24(col){
  return idfMeshChunk(0x0011, [col.r&255, col.g&255, col.b&255]);
}
function idfMeshMatEntry(name, col){
  const inner = idfMeshConcat([
    idfMeshChunk(0xA000, idfMeshAsciiZ(name)),
    idfMeshChunk(0xA010, idfMeshColor24(col)),
    idfMeshChunk(0xA020, idfMeshColor24(col)),
    idfMeshChunk(0xA030, idfMeshColor24({r:0,g:0,b:0}))
  ]);
  return idfMeshChunk(0xAFFF, inner);
}
function idfMeshNamedTri(objNameBytes, verts, matName){
  const n = verts.length;
  const tris = idfMeshTriangulate(n);
  let pts = idfMeshU16(n);
  verts.forEach(v=>{
    pts = idfMeshConcat([pts, idfMeshF32(v.x), idfMeshF32(v.y), idfMeshF32(v.z)]);
  });
  const pointChunk = idfMeshChunk(0x4110, pts);
  let faceBody = idfMeshU16(tris.length);
  tris.forEach(t=>{
    faceBody = idfMeshConcat([faceBody, idfMeshU16(t[0]), idfMeshU16(t[1]), idfMeshU16(t[2]), idfMeshU16(7)]);
  });
  let grp = idfMeshAsciiZ(matName);
  grp = idfMeshConcat([grp, idfMeshU16(tris.length)]);
  tris.forEach((_,i)=>{ grp = idfMeshConcat([grp, idfMeshU16(i)]); });
  faceBody = idfMeshConcat([faceBody, idfMeshChunk(0x4130, grp)]);
  const faceChunk = idfMeshChunk(0x4120, faceBody);
  const triObj = idfMeshChunk(0x4100, idfMeshConcat([pointChunk, faceChunk]));
  return idfMeshChunk(0x4000, idfMeshConcat([objNameBytes, triObj]));
}

function idfMeshReady(){
  return !!(typeof appMode!=='undefined' && appMode==='energyplus' &&
    typeof epParse!=='undefined' && epParse && (epParse.meshFaces||[]).length);
}

function idfMeshPaletteForFace(face){
  if(face && (face.kind==='window' || face.sslKey==='window')){
    const us = (typeof uniqueSortedWinU==='function')
      ? uniqueSortedWinU((epParse.windows||[]).map(function(w){ return w.u; }))
      : [];
    const groups = (typeof windowUColorGroupsFromUs==='function') ? windowUColorGroupsFromUs(us) : [];
    const u = (face.u>0 && typeof roundWinU==='function') ? roundWinU(face.u) : null;
    let gi = (u!=null) ? us.indexOf(u) : 0;
    if(gi<0) gi = 0;
    const grp = groups[gi];
    if(grp) return {r:grp.color.r, g:grp.color.g, b:grp.color.b, mat:grp.mat, u:grp.u};
    const base = IDF_MESH_PALETTE.window;
    return {r:base.r, g:base.g, b:base.b, mat:base.mat, u:u};
  }
  return IDF_MESH_PALETTE[face.sslKey] || IDF_MESH_PALETTE.innerwall;
}

function buildIdfMeshExport(){
  if(!idfMeshReady()) return null;
  const faces = epParse.meshFaces;
  const seq = {};
  const rows = [];
  const usedMats = {};
  const objects = [];
  faces.forEach(face=>{
    const pal = idfMeshPaletteForFace(face);
    usedMats[pal.mat] = pal;
    seq[face.nameJa] = (seq[face.nameJa]||0) + 1;
    const shortName = face.nameJa + String(seq[face.nameJa]).padStart(2,'0');
    const named = idfMeshNameZ(shortName);
    const verts = idfMeshToMm(face);
    if(verts.length<3) return;
    objects.push(idfMeshNamedTri(named.bytes, verts, pal.mat));
    rows.push({
      tds: shortName,
      nameJa: face.nameJa,
      idfName: face.idfName||'',
      zone: face.zone||'',
      sslKey: face.sslKey,
      u: pal.u!=null ? pal.u : (face.u>0 ? face.u : ''),
      rgb: pal.r+' '+pal.g+' '+pal.b
    });
  });
  if(!objects.length) return null;
  let mdata = [];
  Object.keys(usedMats).forEach(mat=>{
    mdata = idfMeshConcat([mdata, idfMeshMatEntry(mat, usedMats[mat])]);
  });
  objects.forEach(o=>{ mdata = idfMeshConcat([mdata, o]); });
  const version = idfMeshChunk(0x0002, idfMeshU32(3));
  const main = idfMeshChunk(0x4D4D, idfMeshConcat([version, idfMeshChunk(0x3D3D, mdata)]));
  return {bytes: new Uint8Array(main), rows};
}

function idfMeshCsvText(rows){
  const esc = s=>{
    const t = String(s==null?'':s);
    return /[",\r\n]/.test(t) ? '"'+t.replace(/"/g,'""')+'"' : t;
  };
  const lines = ['3DS名,日本語部材,IDF面名,ゾーン,SSLカテゴリ,U,RGB'];
  rows.forEach(r=>lines.push([r.tds, r.nameJa, r.idfName, r.zone, r.sslKey, r.u, r.rgb].map(esc).join(',')));
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}

function idfMeshDownloadBlob(blob, filename){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportIdfMesh(){
  const info = document.getElementById('idfMeshExportInfo');
  const built = buildIdfMeshExport();
  if(!built){
    if(info) info.textContent = 'EnergyPlusモードでIDFを読み込むと書き出せます。';
    return;
  }
  const stamp = (typeof epIdfName==='string' && epIdfName) ? epIdfName.replace(/\.[^.]+$/,'') : 'cfd_from_idf';
  idfMeshDownloadBlob(new Blob([built.bytes], {type:'application/octet-stream'}), stamp+'_cfd.3ds');
  setTimeout(function(){
    idfMeshDownloadBlob(new Blob([idfMeshCsvText(built.rows)], {type:'text/csv;charset=utf-8'}), stamp+'_cfd_names.csv');
  }, 250);
  if(info) info.textContent = '3DS と名前CSVを書き出しました ('+built.rows.length+' 面)。FlowDesignerへ 3DS を取り込み、続けて SSL 一括反映へ進んでください。';
}

function refreshIdfMeshUi(){
  const btn = document.getElementById('idfMeshExportBtn');
  const info = document.getElementById('idfMeshExportInfo');
  const sum = document.getElementById('idfMeshSummary');
  const ready = idfMeshReady();
  if(btn) btn.disabled = !ready;
  if(!sum) return;
  if(typeof appMode==='undefined' || appMode!=='energyplus'){
    sum.innerHTML = '<p class="small" style="margin:0;">EnergyPlusモードで IDF を読むと、色分けした 3DS を書き出せます。手動・アーキトレンドでは使いません。</p>';
    if(info) info.textContent = '';
    return;
  }
  if(!ready){
    sum.innerHTML = '<p class="small" style="margin:0;">まだ IDF が読み込まれていません。ページ上部の EnergyPlus IDF を指定してください。</p>';
    return;
  }
  const counts = {};
  epParse.meshFaces.forEach(f=>{ counts[f.nameJa] = (counts[f.nameJa]||0)+1; });
  let html = '<table><tr><th>部材</th><th>面数</th></tr>';
  Object.keys(counts).forEach(k=>{
    html += '<tr><td class="l">'+k+'</td><td>'+counts[k]+'</td></tr>';
  });
  html += '<tr style="font-weight:600; background:#F4F4F4;"><td class="l">合計</td><td>'+epParse.meshFaces.length+'</td></tr></table>';
  const us = (typeof uniqueSortedWinU==='function') ? uniqueSortedWinU((epParse.windows||[]).map(function(w){ return w.u; })) : [];
  if(us.length>1 && typeof windowUColorGroupsFromUs==='function'){
    html += '<p class="small" style="margin:8px 0 4px;">窓Uが '+us.length+' 種類あるので、3DSでは色を分けます。</p><table><tr><th>U</th><th>色</th></tr>';
    windowUColorGroupsFromUs(us).forEach(function(g){
      const rgb='rgb('+g.color.r+','+g.color.g+','+g.color.b+')';
      html += '<tr><td>'+g.u+'</td><td class="l"><span style="display:inline-block;width:28px;height:12px;border:1px solid #C9C9C9;background:'+rgb+';vertical-align:middle;margin-right:6px;"></span>'+
        g.color.r+' '+g.color.g+' '+g.color.b+'</td></tr>';
    });
    html += '</table>';
  }
  const rel = epParse.relative ? 'Relative（Zone原点でワールド化済み）' : 'World';
  html += '<p class="small" style="margin:8px 0 0;">座標系: '+rel+' / 単位: mm / 厚みなし / 窓は壁と同一平面に重ねる</p>';
  sum.innerHTML = html;
}

(function initIdfMeshUi(){
  const btn = document.getElementById('idfMeshExportBtn');
  if(btn) btn.addEventListener('click', exportIdfMesh);
  refreshIdfMeshUi();
})();

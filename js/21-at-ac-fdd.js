// Placed air conditioners are written as FlowDesigner FDD, not 3DS.
// 3DS import turns 吹出口 / 吸込口 into 形状モデル, and that type cannot be changed.
// The library FDD already is 吹出口(流入) / 吸込口(流出). This file moves those
// meshes onto the same meter origin as the house 3DS and writes flow and temperature.

function atFddNum(n){
  const sign = n < 0 ? '-' : '';
  const exp = n === 0 ? 0 : Math.floor(Math.log10(Math.abs(n)));
  const mant = n === 0 ? 0 : n / Math.pow(10, exp);
  const expSign = exp >= 0 ? '+' : '-';
  return sign + Math.abs(mant).toFixed(6) + 'e' + expSign + String(Math.abs(exp)).padStart(2, '0');
}

function atFddIdentityMatrix(){
  const z = atFddNum(0), o = atFddNum(1);
  return [o,z,z,z, z,o,z,z, z,z,o,z, z,z,z,o].join(',');
}

function atFddModelEnd(xml, start){
  let depth = 0, j = start;
  while (j < xml.length){
    const open = xml.indexOf('<model>', j);
    const close = xml.indexOf('</model>', j);
    if (close < 0) return -1;
    if (open >= 0 && open < close){
      depth++;
      j = open + 7;
    }else{
      depth--;
      j = close + 8;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function atFddMatrices(head){
  const read = type => {
    const m = head.match(new RegExp('<matrix type="' + type + '">([^<]*)</matrix>'));
    return m && typeof atPartMatrix === 'function' ? atPartMatrix(m[1]) : null;
  };
  return {move: read('move'), rotate: read('rotate')};
}

function atFddFormatMatrix(m){
  return m.map(atFddNum).join(',');
}

// 斜め吹き出しの仰角は回転行列の向きに対する角度。頂点へ焼き込んで回転を
// 単位行列にすると、水平の -90° が真下になる。頂点はローカルのまま残す。
function atFddYawRotate(angleDeg, rotate){
  const a = (Number(angleDeg) || 0) * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const R = rotate || [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  return [
    c*R[0] - s*R[4], c*R[1] - s*R[5], c*R[2] - s*R[6], 0,
    s*R[0] + c*R[4], s*R[1] + c*R[5], s*R[2] + c*R[6], 0,
    R[8], R[9], R[10], 0,
    0, 0, 0, 1
  ];
}

function atFddPlaceMove(item, anchor, shift, move){
  const a = (Number(item.angle) || 0) * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const M = move || [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const dx = M[3] - anchor.x, dy = M[7] - anchor.y, dz = M[11] - anchor.z;
  const zFloor = typeof atPartFloorZ === 'function' ? atPartFloorZ(item.floor) : 0;
  const zBase = (zFloor == null ? 0 : zFloor) + (item.kind === 'ac' ? 2 : 0);
  return [1, 0, 0, item.x + dx * c - dy * s + shift.x,
          0, 1, 0, item.y + dx * s + dy * c + shift.y,
          0, 0, 1, zBase + dz + shift.z,
          0, 0, 0, 1];
}

function atFddRelativeMove(move, parentMove){
  const M = move || [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const P = parentMove || [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  return [1,0,0, M[3] - P[3], 0,1,0, M[7] - P[7], 0,0,1, M[11] - P[11], 0,0,0,1];
}

function atFddBakeHead(head, anchor, item, shift, flow, temp, parentMove){
  const matrices = atFddMatrices(head);
  const name = (head.match(/<name>([^<]*)<\/name>/) || [])[1] || '';
  let out = head;
  const placed = parentMove
    ? atFddRelativeMove(matrices.move, parentMove)
    : atFddPlaceMove(item, anchor, shift, matrices.move);
  out = out.replace(/<matrix type="move">[^<]*<\/matrix>/, '<matrix type="move">' + atFddFormatMatrix(placed) + '</matrix>');
  // 子パーツの回転は空調班パーツのまま。平面角度は親だけにかける。
  // 子にもかけると FlowDesigner が親の回転を重ねて、さらに90°回ることがある。
  if (!parentMove && Number(item.angle)) {
    out = out.replace(/<matrix type="rotate">[^<]*<\/matrix>/, '<matrix type="rotate">' + atFddFormatMatrix(atFddYawRotate(item.angle, matrices.rotate)) + '</matrix>');
  }
  if (name === '吹出口' || name === '吸込口') out = atFddSetValue(out, 'OUTLETAMOUNT', atFddNum(flow));
  if (name === '吹出口'){
    out = atFddSetValue(out, 'TEMP', atFddNum(temp));
    out = atFddSetValue(out, 'HUMIDITY', atFddNum(95));
    out = atFddSetValue(out, 'INPUTTYPE', '流量');
  }
  if (name === '吸込口') out = atFddSetValue(out, 'INPUTTYPE', '流量');
  return out;
}

function atFddSetValue(block, tag, text){
  const mark = '<cntag>' + tag + '</cntag>';
  const i = block.indexOf(mark);
  if (i < 0) return block;
  const v = block.indexOf('<value>', i);
  const e = block.indexOf('</value>', v);
  if (v < 0 || e < 0) return block;
  return block.slice(0, v + 7) + text + block.slice(e);
}

function atFddBakeBlock(block, anchor, item, shift, flow, temp, names, parentMove){
  const childAt = block.indexOf('<model>', 7);
  const headEnd = childAt < 0 ? block.lastIndexOf('</model>') : childAt;
  const rawHead = block.slice(0, headEnd);
  const ownMove = atFddMatrices(rawHead).move;
  const head = atFddBakeHead(rawHead, anchor, item, shift, flow, temp, parentMove);
  let children = '';
  let i = childAt;
  while (i >= 0 && i < block.length){
    const end = atFddModelEnd(block, i);
    if (end < 0) break;
    children += atFddBakeBlock(block.slice(i, end), anchor, item, shift, flow, temp, names, parentMove || ownMove);
    const next = block.indexOf('<model>', end);
    if (next < 0 || next >= block.lastIndexOf('</model>')) break;
    i = next;
  }
  let named = head;
  if (names && names.outer && head.indexOf('<model>') === 0){
    named = head.replace(/<name>[^<]*<\/name>/, '<name>' + names.outer + '</name>');
    names.outer = '';
  }
  return named + children + '</model>';
}

function atFddBakeXml(xml, item, shift, flow, temp, label){
  const parsed = atPartParseFdd(xml, 'ac', label || 'ac');
  const start = xml.indexOf('<model>');
  const end = atFddModelEnd(xml, start);
  if (start < 0 || end < 0) throw new Error('FDD にモデルがありません');
  const baked = atFddBakeBlock(xml.slice(start, end), parsed.anchor, item, shift, flow, temp, {outer: label || 'AC'});
  return {head: xml.slice(0, start), model: baked, tail: xml.slice(end)};
}

function atFddSupplyTemp(){
  if (typeof runAll === 'function') runAll();
  if (typeof sslTrVal === 'function'){
    const n = parseFloat(sslTrVal('3', 'エアコン (吹出)', '吹出温度 [℃]'));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function exportAtAcFdd(){
  const info = document.getElementById('idfMeshExportInfo');
  const units = typeof atPartAcUnits === 'function' ? atPartAcUnits() : [];
  if (!units.length){
    if (info) info.textContent = 'エアコンが未配置です。3Dビューワーで置いてから書き出してください。';
    return;
  }
  if (typeof atPartTemplatesReady === 'function' && !atPartTemplatesReady()){
    if (info) info.textContent = 'エアコンのFDDテンプレートをまだ読めません。';
    return;
  }
  const shiftMm = typeof idfMeshOriginShiftMm === 'function' ? idfMeshOriginShiftMm() : {dx:0, dy:0, dz:0};
  const shift = {x: (shiftMm.dx || 0) / 1000, y: (shiftMm.dy || 0) / 1000, z: (shiftMm.dz || 0) / 1000};
  const volEl = document.getElementById('volSel');
  const vol = volEl ? volEl.value : '強';
  const temp = atFddSupplyTemp();
  if (temp == null){
    if (info) info.textContent = '吹出温度がまだ計算できません。気象・室温・負荷を入れてから書き出してください。';
    return;
  }
  const jobs = units.map(function(item, index){
    const dir = atPartAcDir(item);
    const file = AT_AC_FILES[dir];
    const flow = atPartAcTableFlow(dir, vol);
    const label = 'AC' + String(index + 1).padStart(3, '0');
    return atPartXmlSource(AT_AC_BUNDLE[dir], file).then(function(xml){
      return atFddBakeXml(xml, item, shift, flow, temp, label).model;
    });
  });
  Promise.all(jobs).then(function(models){
    return atPartXmlSource(AT_AC_BUNDLE[atPartAcDir(units[0])], AT_AC_FILES[atPartAcDir(units[0])]).then(function(xml){
      const start = xml.indexOf('<model>');
      const end = atFddModelEnd(xml, start);
      const doc = xml.slice(0, start).replace(/<title>[^<]*<\/title>/, '<title>エアコン配置</title>')
        + models.join('\n') + xml.slice(end);
      const stamp = (typeof atMesh !== 'undefined' && atMesh && atMesh.stamp) ? String(atMesh.stamp).replace(/\.[^.]+$/, '') : 'cfd';
      idfMeshDownloadBlob(new Blob([doc], {type: 'application/xml'}), stamp + '_ac.fdd');
      if (info) info.textContent = 'エアコン ' + units.length + ' 台を ' + stamp + '_ac.fdd に書き出しました。家の3DSと同じ原点です。FlowDesigner ではライブラリ配置ではなく、このFDDを原点に読み込んでください。吹出温度 ' + temp.toFixed(2) + ' ℃、湿度 95%。';
    });
  }).catch(function(err){
    if (info) info.textContent = err.message || String(err);
  });
}

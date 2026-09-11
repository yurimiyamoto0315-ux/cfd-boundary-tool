// ========================= Step 3: 台数比較表 =========================
function renderAcCompare(qReq, flowPer, acMax, targetT, currentCount){
  let html = '<table><tr><th>台数</th><th>総風量 [㎥/h]</th><th>1台あたり処理熱量 [W]</th><th>1台あたり吹出温度 [℃]</th><th>能力判定</th></tr>';
  for(let n=1; n<=6; n++){
    const vT = flowPer*n;
    const qPer = qReq/n;
    const dT = vT>0 ? qReq/(RHOCP*vT) : 0;
    const ts = targetT - dT;
    const capOk = (acMax*1000*n) >= qReq;
    const cur = (n===currentCount);
    html += '<tr'+(cur?' style="background:#F4F4F4; font-weight:600;"':'')+'>'+
      '<td>'+n+'台'+(cur?' ← 現在の設定':'')+'</td>'+
      '<td>'+vT.toFixed(0)+'</td>'+
      '<td>'+qPer.toFixed(0)+'</td>'+
      '<td>'+ts.toFixed(2)+'</td>'+
      '<td>'+(capOk?'<span class="ok">OK</span>':'<span style="color:#DE5A3A; font-weight:600;">能力不足</span>')+'</td></tr>';
  }
  html += '</table>';
  document.getElementById('acCountCompare').innerHTML = html;
}


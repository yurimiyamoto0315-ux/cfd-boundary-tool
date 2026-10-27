// Sensible cooling balance. m³/h is converted to W/K once, here.
// Missing inputs stay missing; an impossible outlet is never an export value.
let acCalculationState=null;
function calculateAcLoadSupply(input){
  const number=v=>v===null||v===undefined||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
  const values={};for(const k of ['ua','envelopeArea','outdoorTemperature','targetTemperature','ach','volume','heatRecoveryPercent','internalSensible','internalLatent','count','totalFlow','maxCapacityKw'])values[k]=number(input[k]);
  const errors=[],warnings=[];
  const add=(code,message)=>errors.push({code,message});
  if(!(values.ua>0))add('UA_MISSING','UA値を入力してください。');
  else if(values.ua>5)add('UA_REVIEW','UA値が5 W/m²Kを超えています。熱損失や面積を読み込んでいないか、資料のUA値を確認してください。');
  if(!(values.envelopeArea>0))add('ENVELOPE_AREA_MISSING','外皮面積を入力してください。');
  if(input.weatherReady===false||values.outdoorTemperature===null||values.outdoorTemperature< -273.15)add('WEATHER_MISSING','日時・気象の最高気温、最低気温、ピーク時刻を設定してください。');
  if(values.targetTemperature===null||values.targetTemperature< -273.15)add('TARGET_MISSING','目標室温を入力してください。');
  if(values.internalSensible===null)add('INTERNAL_MISSING','部屋の顕熱負荷を確認してください。');
  const ventilated=input.ventMode!=='none';
  if(ventilated){
    if(values.ach===null||values.ach<0)add('VENTILATION_RATE_MISSING','換気回数を0以上で入力してください。');
    if(!(values.volume>0))add('VOLUME_MISSING','換気する部屋の体積を入力してください。');
    if(input.ventMode==='first'&&(values.heatRecoveryPercent===null||values.heatRecoveryPercent<0||values.heatRecoveryPercent>100))add('HEAT_RECOVERY_INVALID','熱交換効率を0〜100%で入力してください。');
  }
  const loadReady=!errors.length,delta=loadReady?values.outdoorTemperature-values.targetTemperature:null;
  const factor=input.ventMode==='first'?1-values.heatRecoveryPercent/100:1;
  const envelope=loadReady?values.ua*values.envelopeArea*delta:null;
  const ventilation=loadReady?(ventilated?(1.2*1000/3600)*values.ach*values.volume*delta*factor:0):null;
  const total=loadReady?envelope+ventilation+values.internalSensible:null,cooling=total===null?null:Math.max(0,total);
  if(values.count===null||!Number.isInteger(values.count)||values.count<=0)add('AC_NOT_PLACED','エアコン未配置です。配置または台数を設定してください。');
  if(!(values.totalFlow>0))add('FLOW_MISSING','エアコンの総風量を0より大きい値で設定してください。');
  const canDivide=loadReady&&values.count>0&&Number.isInteger(values.count)&&values.totalFlow>0;
  const temperatureDifference=canDivide?cooling/((1.2*1000/3600)*values.totalFlow):null;
  const calculatedSupply=canDivide?values.targetTemperature-temperatureDifference:null;
  if(calculatedSupply!==null&&(!Number.isFinite(calculatedSupply)||calculatedSupply<5))add('SUPPLY_TOO_LOW','この負荷と風量では吹出温度が5℃未満になります。負荷の読取値・風量・台数を確認してください。温度のコピーとエアコン条件の出力を止めています。');
  if(loadReady&&values.maxCapacityKw>0&&values.count>0&&cooling>values.maxCapacityKw*1000*values.count)warnings.push({code:'CAPACITY_INSUFFICIENT',message:'最大冷房能力を超えています。機器能力・台数を確認してください。'});
  return {values,errors,warnings,loadReady,ready:!errors.length,envelope,ventilation,internal:values.internalSensible,latent:values.internalLatent,total,cooling,temperatureDifference,supplyTemperature:!errors.length?calculatedSupply:null,perUnit:canDivide?cooling/values.count:null,noCooling:loadReady&&total<=0,ventilationFactor:factor};
}
function boundaryAcCalculationStatus(){return acCalculationState;}

// ========================= Step 3: 台数比較表 =========================
function renderAcCompare(qReq, flowPer, acMax, targetT, currentCount){
  let html = '<table><tr><th>台数</th><th>総風量 [㎥/h]</th><th>1台あたり処理熱量 [W]</th><th>1台あたり吹出温度 [℃]</th><th>能力判定</th></tr>';
  for(let n=1; n<=6; n++){
    const vT = flowPer*n;
    const qPer = qReq/n;
    const known=Number.isFinite(qReq)&&Number.isFinite(targetT)&&flowPer>0;
    const dT = known ? Math.max(0,qReq)/(RHOCP*vT) : null;
    const ts = known ? targetT - dT : null;
    const supplyReady=ts!==null&&Number.isFinite(ts)&&ts>=5;
    const capKnown = acMax>0;
    const capOk = capKnown && (acMax*1000*n) >= qReq;
    const cur = (n===currentCount);
    const judge = !known?'入力を確認':!supplyReady?'負荷・風量を確認':capKnown
      ? (capOk?'<span class="ok">OK</span>':'<span style="color:#DE5A3A; font-weight:600;">能力不足</span>')
      : '—';
    html += '<tr'+(cur?' style="background:#F4F4F4; font-weight:600;"':'')+'>'+
      '<td>'+n+'台'+(cur?' ← 現在の設定':'')+'</td>'+
      '<td>'+vT.toFixed(0)+'</td>'+
      '<td>'+(known?Math.max(0,qPer).toFixed(0):'—')+'</td>'+
      '<td>'+(supplyReady?ts.toFixed(2):'算定保留')+'</td>'+
      '<td>'+judge+'</td></tr>';
  }
  html += '</table>';
  document.getElementById('acCountCompare').innerHTML = html;
}


// A failed replacement must never export the preceding project's inputs.
(function(){
  'use strict';
  let modelPending=false;
  window.boundaryExportEpoch=0;
  function modeIsAt(){return typeof appMode!=='undefined'&&appMode==='architrend';}
  window.boundaryExportReadiness=function(kind){
    if(!modeIsAt())return {ready:true,message:''};
    if(modelPending)return {ready:false,message:'3DSを読み直してください。前のモデルは出力できません。'};
    const mesh=typeof atMesh!=='undefined'?atMesh:null;
    if(mesh&&typeof atRoomFloorReadiness==='function'){
      const floor=atRoomFloorReadiness(mesh);if(!floor.ready)return floor;
    }
    if(mesh&&(mesh.rooms||[]).some(r=>r.stairAutoNeedsReview))return {ready:false,message:'結合した階段の自動形状が区画外へ出ています。図の階段経路を調整してから出力してください。',codes:['MERGED_STAIR_REVIEW_REQUIRED']};
    if(mesh&&mesh.gainColorError)return {ready:false,message:'部屋の色分け数が上限を超えています。部屋区画を確認してください。',codes:[mesh.gainColorError]};
    if(mesh&&mesh.readiness&&!mesh.readiness.ready)return {ready:false,message:'モデルの単位・階数・床を確認してください。未確定のモデルは出力できません。'};
    if(typeof architrendImportReadiness==='function'){
      const data=architrendImportReadiness();
      if(data.status==='needs-review'&&data.codes?.includes('CEILING_ASSIGNMENT_REQUIRED'))return {ready:false,message:'小屋裏の条件を確認し、「概算した条件を天井へ反映する」を押してください。気象や屋根Uを変えた場合は再反映が必要です。',codes:data.codes};
      if(!data.ready&&!(kind==='model'&&data.status==='empty'))return {ready:false,message:'CSV/PDFの読込結果と未確定の条件を確認してください。前の物件の条件は出力できません。'};
    }
    if(typeof atLastParse!=='undefined'&&atLastParse?.result&&typeof window.boundaryThermalReadiness==='function'){
      const source=atLastParse.result,thermal=window.boundaryThermalReadiness(source.csvDiagnostics?.requiredManual||[],source);
      if(!thermal.ready)return {ready:false,message:'断熱仕様と小屋裏の条件を確認して反映してください。気象・形状を変えた場合は再計算が必要です。',codes:thermal.codes};
    }
    if(kind==='conditions'&&typeof architrendWindowReadiness==='function'){
      const windows=architrendWindowReadiness();
      if(!windows.ready)return {ready:false,message:'窓の部屋割当・方位・面積・U値・日射取得率を確認してください。未確定の窓条件は出力できません。',codes:windows.codes};
    }
    if(typeof architrendWindowUReadiness==='function'){
      const windowU=architrendWindowUReadiness();
      if(!windowU.ready)return {ready:false,message:'U値が異なる窓と3DSの面を対応付けてください。未確定のまま同じ色で出力することはできません。',codes:windowU.codes};
    }
    return {ready:true,message:''};
  };
  function invalidate(model){
    window.boundaryExportEpoch++;
    if(model)modelPending=true;
    if(typeof resetSslCategory==='function')resetSslCategory();
    ['sslCatInput'].forEach(function(id){const input=document.getElementById(id);if(input)input.value='';});
    // Prevent queued autosaves from reviving source-dependent room assignments.
    if(typeof saveTimer!=='undefined')clearTimeout(saveTimer);
    try{
      if(typeof STORE_KEY!=='undefined'){
        localStorage.removeItem(STORE_KEY+'_architrend');
        const last=JSON.parse(localStorage.getItem(STORE_KEY)||'null');
        if(last&&last.mode==='architrend')localStorage.removeItem(STORE_KEY);
      }
    }catch(error){}
    refresh();
  }
  function refresh(){
    if(!modeIsAt())return;
    const status=window.boundaryExportReadiness('model');
    for(const id of ['idfMeshExportBtn','atAcFddExportBtn']){
      const button=document.getElementById(id);
      if(button)button.disabled=!status.ready||typeof atMesh==='undefined'||!atMesh;
    }
    if(!status.ready){
      for(const id of ['idfMeshExportBtn','atAcFddExportBtn']){const button=document.getElementById(id);if(button)button.disabled=true;}
      const info=document.getElementById('idfMeshExportInfo');if(info)info.textContent=status.message;
    }
  }
  window.addEventListener('architrend-import-invalidated',function(){invalidate(false);});
  window.addEventListener('architrend-model-invalidated',function(){invalidate(true);});
  window.addEventListener('architrend-model-ready',function(){modelPending=false;refresh();});
  window.addEventListener('architrend-data-ready',refresh);
  window.addEventListener('architrend-thermal-changed',function(){invalidate(false);});
  window.addEventListener('architrend-room-mapping-changed',function(){invalidate(false);});
  // Capture prevents existing button listeners and downloadable artifacts on invalid input.
  document.addEventListener('click',function(event){
    const button=event.target.closest&&event.target.closest('#idfMeshExportBtn,#atAcFddExportBtn');
    if(!button)return;
    const status=window.boundaryExportReadiness('model');
    if(!status.ready){event.preventDefault();event.stopImmediatePropagation();refresh();}
  },true);
})();

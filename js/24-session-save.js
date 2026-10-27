/* Local resume snapshots. No source files, network calls or raw PDF text. */
(function(){
  'use strict';
  const originalGather=gatherState,originalApply=applyState;
  let restoring=false,saving=false,clearing=false;
  const key=mode=>STORE_KEY+'_session_'+mode;
  function copy(value){
    const materials=new Map();
    return JSON.parse(JSON.stringify(value,function(k,v){
      if(['projectName','workName','projectLocation','siteAddress'].includes(k))return '';
      if(k==='fileName')return 'model.3ds';
      if(['windowMatchSource','gainVolumes','projectedFloorSourceRooms','projectedFloorEvidenceCache','resolvedFloorCache'].includes(k))return null;
      if(k==='idfName')return 'FACE_'+(this.atFaceId||'LOCAL');
      if(k==='mat'&&typeof v==='string'){if(!materials.has(v))materials.set(v,'MAT_LOCAL_'+(materials.size+1));return materials.get(v);}
      if(k==='files'&&v&&typeof v==='object')return Object.fromEntries(Object.keys(v).map(t=>[t,t==='pdf'?'performance.pdf':t==='csv'?'model.csv':'model.3ds']));
      return v;
    }));
  }
  function message(text,error=false){const el=document.getElementById('saveInfo');if(el){el.textContent=text;el.dataset.saveError=String(error);if(error&&el.closest('.header-status'))el.closest('.header-status').style.display='flex';}}
  function validMesh(mesh){
    return !mesh||Array.isArray(mesh.meshFaces)&&Array.isArray(mesh.rooms)&&mesh.meshFaces.every(f=>Array.isArray(f.verts)&&f.verts.length>=3&&f.verts.every(p=>[p.x,p.y,p.z].every(Number.isFinite)));
  }
  function basicDetailKey(detail){
    const room=detail.closest('.room-card');
    return detail.dataset.basicDetail+(room?':'+[...document.querySelectorAll('.room-card')].indexOf(room):'');
  }
  gatherState=function(){
    if(typeof syncUnassignedFromDom==='function'&&appMode==='architrend')syncUnassignedFromDom();
    if(appMode==='architrend'&&typeof atCaptureRoomEditorDraft==='function')atCaptureRoomEditorDraft();
    const s=originalGather();
    s.savedAt=Date.now();
    if(appMode==='architrend'){
      s.resume={version:1,mesh:atMesh,csv:atCsvParse,pdf:atPdfParse,last:atLastParse,importState:atImportState,
        view:{floor:atRoomView.floor,selected:atRoomView.selected,plan:atRoomView.plan,yaw:atRoomView.yaw,tilt:atRoomView.tilt,zoom:atRoomView.zoom,northDeg:atRoomView.northDeg,editorDrafts:atRoomView.editorDrafts},
        thermal:window.boundaryThermalSnapshot?.(),ssl:{colors:sslColors,assign:sslAssign,diagnostics:sslCatDiagnostics},
         scrollY:window.scrollY,details:[...document.querySelectorAll('details:not([data-basic-detail]):not([data-gains-disclosure])')].map((d,i)=>({i,open:d.open})),
        basicDetails:[...document.querySelectorAll('[data-basic-detail]')].map(d=>({key:basicDetailKey(d),open:d.open}))};
    }
    return copy(s);
  };
  function restore(s){
    const r=s?.resume;
    if(!r||r.version!==1||s.mode!=='architrend'||!validMesh(r.mesh))return false;
    restoring=true;clearTimeout(saveTimer);
    try{
      const data=copy(s),runtime=data.resume;
      atMesh=runtime.mesh;atCsvParse=runtime.csv;atPdfParse=runtime.pdf;atLastParse=runtime.last;
      atImportState=runtime.importState||{status:atLastParse?'ready':'empty',codes:[]};
      if(atImportState.status==='loading')atImportState={status:'invalid',codes:['RESTORED_INCOMPLETE_IMPORT']};
      if(atMesh)atMesh.windowMatchSource=atLastParse?.result;
      Object.assign(atRoomView,runtime.view||{});
      atRoomView.editorMesh=null;const viewer=document.getElementById('atRoomViewer');if(viewer)viewer._editorMesh=null;
      originalApply(data);
      if(atMesh&&typeof atSetProjectedFloorSources==='function')atSetProjectedFloorSources(atMesh,atLastParse?.result?.rooms||[]);
      atUnassignedWindows=data.atUnassigned||[];atAssignableRooms=data.atRoomCandidates||[];atNorthExcludedCount=data.atNorthExcludedCount||0;
      if(typeof atPartRestoreReview==='function'&&data.atRoomReview?.parts)atPartRestoreReview(data.atRoomReview.parts);
      window.boundaryThermalRender?.();
      const thermalRestored=runtime.thermal?window.boundaryThermalRestore?.(runtime.thermal):true;
      if(atLastParse)renderArchitrendReview(atLastParse,atLastParse.applied!==false);
      if(typeof atRenderRoomViewer==='function')atRenderRoomViewer();
      if(typeof at3dsEcho==='function')at3dsEcho();
      renderUnassignedWindows();runAll();
      if(atMesh)window.dispatchEvent(new CustomEvent('architrend-model-ready',{detail:{restored:true,readiness:atMesh.readiness}}));
      if(atLastParse)window.dispatchEvent(new CustomEvent('architrend-data-ready',{detail:{restored:true}}));
      sslColors=runtime.ssl?.colors||[];sslAssign=runtime.ssl?.assign||{};sslCatDiagnostics=runtime.ssl?.diagnostics||{errors:[],warnings:[]};sslFileName=sslColors.length?'復元した色対応CSV':'';
      if(typeof renderSslAssign==='function')renderSslAssign();
      const details=[...document.querySelectorAll('details:not([data-basic-detail]):not([data-gains-disclosure])')];(runtime.details||[]).forEach(d=>{if(details[d.i])details[d.i].open=!!d.open;});
      const basicDetails=new Map((runtime.basicDetails||[]).map(d=>[d.key,!!d.open]));
      document.querySelectorAll('[data-basic-detail]').forEach(d=>{if(basicDetails.has(basicDetailKey(d)))d.open=basicDetails.get(basicDetailKey(d));});
      requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo(0,Number(runtime.scrollY)||0)));
      message(thermalRestored?'前回の形状・入力・割当を復元しました':'入力を復元しました。断熱の反映状態を確認してください');
      return true;
    }finally{restoring=false;clearTimeout(saveTimer);}
  }
  applyState=function(s){if(s?.resume){if(!restore(s))throw new Error('保存したモデルの形式を確認できません。現在の入力を保持しました');}else originalApply(s);};
  window.boundarySessionLoad=function(mode){try{const s=JSON.parse(localStorage.getItem(key(mode))||'null');return s?.mode===mode&&s.resume?.version===1&&validMesh(s.resume.mesh)?s:null;}catch(e){return null;}};
  window.boundarySessionSave=function(){
    if(restoring||saving||clearing)return false;saving=true;clearTimeout(saveTimer);
    try{
      const s=gatherState(),base={...s};delete base.resume;
      if(s.resume)localStorage.setItem(key(s.mode),JSON.stringify(s));
      localStorage.setItem(modeStoreKey(s.mode),JSON.stringify(base));localStorage.setItem(STORE_KEY,JSON.stringify(base));
      message((s.resume?.mesh?'形状・入力・割当を保存済み':'入力を保存済み')+' ('+new Date().toLocaleTimeString()+')');return true;
    }catch(e){message('保存できませんでした。バックアップ保存でJSONを保存してください',true);return false;}
    finally{saving=false;}
  };
  window.boundarySessionClear=function(){clearing=true;clearTimeout(saveTimer);['manual','architrend','energyplus'].forEach(mode=>localStorage.removeItem(key(mode)));};
  window.addEventListener('pagehide',()=>saveStateNow());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveStateNow();});
  ['architrend-room-mapping-changed','architrend-thermal-changed','architrend-data-ready','architrend-input-applied','architrend-model-ready','architrend-model-invalidated','architrend-import-invalidated'].forEach(name=>window.addEventListener(name,()=>{if(!restoring)saveStateDebounced();}));
  const saved=window.boundarySessionLoad(appMode);if(saved){try{restore(saved);}catch(e){message('保存内容の復元中に問題が起きました。バックアップJSONの読込を試してください',true);}}
})();

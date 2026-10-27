// Local, source-derived progress only. No filenames or model data are stored here.
(function(){
  'use strict';
  const get=id=>document.getElementById(id);
  let modelStatus='empty';
  function badge(id,text,status){const el=get(id);if(el){el.textContent=text;el.dataset.status=status;}}
  function refresh(){
    const mesh=typeof atMesh!=='undefined'&&atMesh;
    const csv=typeof atCsvParse!=='undefined'&&atCsvParse;
    const pdf=typeof atPdfParse!=='undefined'&&atPdfParse;
    const source=typeof atImportState!=='undefined'?atImportState:{};
    const info=typeof architrendImportReadiness==='function'?architrendImportReadiness():{};
    if(mesh){
      const ready=!mesh.readiness||mesh.readiness.ready;
      badge('at3dsStatus',ready?'読込済み・形を確認しましょう':'読込済み・確認が必要',ready?'ready':'review');
      if(!ready)get('at3dsUnit')?.closest('.at-start-options')?.setAttribute('open','');
    }else badge('at3dsStatus',modelStatus==='loading'?'読み込んでいます…':modelStatus==='invalid'?'読み込めませんでした':'まだ選んでいません',modelStatus);
    for(const [key,parse,id] of [['csv',csv,'atCsvStatus'],['pdf',pdf,'atPdfStatus']]){
      const selected=get(key==='csv'?'atCsvInput':'atPdfInput')?.files?.length;
      const loaded=parse&&parse.status!=='invalid';
      const unsupported=key==='pdf'&&(source.codes||[]).some(code=>code==='PDF_NO_SUPPORTED_DATA'||code==='PDF_TEXT_EMPTY');
      badge(id,loaded?'読込済み・結果を確認':selected?(source.status==='loading'?'読み込んでいます…':unsupported?'自動取得できるデータがありません':'読込結果を確認してください'):key==='pdf'?'追加すると便利です':'まだ選んでいません',loaded?'ready':selected?'review':'empty');
    }
    const setRequirement=(id,text,optional=false)=>{const el=get(id),input=get(id.replace('Requirement','Input'));if(el){if(el.textContent!==text)el.textContent=text;el.dataset.fileRequirement=optional?'optional':'select';}if(input)input.dataset.fileFieldMode=id==='at3dsRequirement'&&!mesh?'required':optional?'optional':'manual';};
    const csvLoaded=csv&&csv.status!=='invalid',pdfLoaded=pdf&&pdf.status!=='invalid',pdfData=pdfLoaded&&pdf.result;
    const performance=!!pdfData&&((pdfData.windows||[]).length>0||(pdfData.envelopeSpecifications||[]).length>0||['ua','uWall','uRoof','uCeiling','uWin'].some(k=>pdfData[k]>0));
    setRequirement('at3dsRequirement',mesh?'選択済み：変更するときだけ選び直してください':'選択が必要：FDへ渡す家の3Dモデル');
    setRequirement('atCsvRequirement',csvLoaded?'選択済み：変更するときだけ選び直してください':performance?'追加は任意：性能表PDFから取得しています':'資料を選択：CSV・Excel または性能表PDF',!csvLoaded&&performance);
    setRequirement('atPdfRequirement',pdfLoaded?'選択済み：変更するときはPDF一式を選び直します':csvLoaded?'追加は任意：部屋名・窓の性能を補うときに選択':'補足PDFは任意。CSV・Excelがない場合は性能表PDFを選択',!!csvLoaded);
    for(const prefix of ['at3ds','atCsv','atPdf']){
      const status=get(prefix+'Status')?.dataset.status;
      if(status==='ready'){
        get(prefix+'Input').dataset.fileFieldMode='complete';
        get(prefix+'Requirement').dataset.fileRequirement='complete';
      }
    }
    window.boundaryRefreshFieldGuidance?.();
    const next=get('atStartNext');if(!next)return;
    next.textContent=!mesh?(modelStatus==='invalid'?'3DSを読み込めませんでした。出力形式を確認して、選び直してください。':modelStatus==='loading'?'3Dモデルを読み込んでいます。完了したら、下の図で形を確かめましょう。':'家の3Dモデル（3DS）を選びましょう。'):
      mesh.readiness&&!mesh.readiness.ready?'モデルの大きさ・階数・床について、下の読込結果を確認しましょう。':
      source.status==='loading'?'資料を読み込んでいます。読込結果が表示されるまでお待ちください。':
      info.status==='invalid'?'読み込めなかった資料があります。下の読込結果を確認し、選び直してください。':
      !csv&&!pdf?'モデルを読み込みました。次に同じ物件のCSV・Excelを選びましょう。':
      'この下の読込結果を上から確認し、入力への反映・部屋と階の確認を順番に進めてください。';
  }
  ['architrend-data-ready','architrend-import-invalidated','architrend-room-mapping-changed','architrend-thermal-changed'].forEach(name=>window.addEventListener(name,refresh));
  window.addEventListener('architrend-model-ready',()=>{modelStatus='ready';refresh();});
  window.addEventListener('architrend-model-invalidated',event=>{modelStatus=event.detail?.code==='AT3DS_LOADING'?'loading':'invalid';refresh();});
  refresh();
})();

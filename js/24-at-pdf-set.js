// Pure transaction combiner. Input is already parsed; no file, DOM or network access.
(function(root){
  'use strict';
  const scalarKeys=['ua','envArea','uRoof','uCeiling','uWall','uFloor','uFound','uWin','uDoor','trueNorthDeg'];
  const windowFields=['width','height','area','az','orient','eta','u','gain','tilt','roofLike'];
  const copy=value=>JSON.parse(JSON.stringify(value)),text=value=>String(value??'').normalize('NFKC').trim();
  const floor=value=>text(value).toUpperCase().replace(/(?:F|階)$/,'');
  const present=value=>value!==null&&value!==undefined&&value!=='';
  const equal=(a,b)=>typeof a==='number'&&typeof b==='number'?Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b)):a===b;
  const picked=(record,fields)=>Object.fromEntries(fields.map(key=>[key,record[key]??null]));
  const sorted=records=>records.map(value=>JSON.stringify(value)).sort();
  const roomCore=room=>({...picked(room,['name','type','area','dx','dy','compound']),floor:floor(room.floor),plan:room.sourceKind==='plan'?picked(room.plan||{},['x','y','width','height']):null});
  function canonical(result){return JSON.stringify({values:picked(result,scalarKeys.concat(['projectName','workName','projectLocation'])),
    windows:sorted((result.windows||[]).map(w=>({id:text(w.id),floor:floor(w.floor),...picked(w,windowFields),uConflict:w.uConflict===true,printedU:w.uSourceKind==='pdf-specification'}))),
    rooms:sorted((result.rooms||[]).map(roomCore)),specifications:sorted((result.envelopeSpecifications||[]).map(s=>picked(s,['part','index','u'])))});}
  function combine(input,options={}){
    const report={ready:false,parsed:null,codes:[],documents:[],conflicts:[],counts:{selected:Array.isArray(input)?input.length:0,recognized:0,unsupported:0,duplicates:0,roomMetadataMerged:0}};
    const fail=code=>{if(!report.codes.includes(code))report.codes.push(code);return report;};
    const roomConflict=(reason,records)=>{report.conflicts.push({code:'PDF_ROOM_IDENTITY_CONFLICT',reason,rooms:records.map(room=>({...picked(room,['name','floor','area','type','sourcePage','sourceDocumentOrdinal']),plan:room.sourceKind==='plan'?picked(room.plan||{},['x','y','width','height']):null}))});return fail('PDF_ROOM_IDENTITY_CONFLICT');};
    if(!Array.isArray(input)||!input.length||input.length>16)return fail('PDF_SET_INVALID');
    const documents=[],signatures=new Map(),warnings=[];
    for(let i=0;i<input.length;i++){
      const source=input[i],ordinal=i+1,result=source?.parsed?.result,assessment=source?.assessment;
      if(!result||!assessment||typeof assessment.ready!=='boolean'||!Array.isArray(result.windows)||!Array.isArray(result.rooms)||!Array.isArray(source.parsed.warnings))return fail('PDF_SET_INVALID');
      if(scalarKeys.some(key=>present(result[key])&&(typeof result[key]!=='number'||!Number.isFinite(result[key]))))return fail('PDF_SET_INVALID');
      const recognized=scalarKeys.filter(key=>key!=='trueNorthDeg').some(key=>result[key]>0)||result.rooms.length>0||result.windows.length>0||(result.envelopeSpecifications||[]).some(spec=>spec.u>0);
      if(!!recognized!==assessment.ready)return fail('PDF_SET_INVALID');
      const info={ordinal,ready:assessment.ready,code:assessment.ready?'PDF_DATA_RECOGNIZED':assessment.code==='PDF_TEXT_EMPTY'?'PDF_TEXT_EMPTY':'PDF_NO_SUPPORTED_DATA',rooms:result.rooms.length,windows:result.windows.length};
      report.documents.push(info);
      if(!assessment.ready){report.counts.unsupported++;warnings.push('PDF '+ordinal+': 部屋・窓・断熱性能の対応データを取得できませんでした。このPDFからの自動入力は保留し、ほかのPDFで取得できた値を保持しています。画像や輪郭文字の図面は、部屋名などを手動で確認してください。');continue;}
      report.counts.recognized++;const signature=canonical(result),prior=signatures.get(signature);
      if(prior){report.counts.duplicates++;info.duplicateOf=prior;warnings.push('PDF '+ordinal+': PDF '+prior+' と同じ取得内容のため、重複して追加していません。');continue;}
      signatures.set(signature,ordinal);documents.push({ordinal,parsed:copy(source.parsed)});
    }
    if(!documents.length)return fail(input.length===1&&report.documents[0].code==='PDF_TEXT_EMPTY'?'PDF_TEXT_EMPTY':'PDF_NO_SUPPORTED_DATA');
    const result=copy(documents[0].parsed.result);result.sources={};result.inputSources={csv:false,pdf:true};result.pdfDocuments=copy(report.documents);
    for(const key of scalarKeys.concat(['projectName','workName','projectLocation'])){
      let value=null,owner=null;
      for(const doc of documents){const next=doc.parsed.result[key];if(!present(next))continue;
        if(typeof next==='number'&&!Number.isFinite(next))return fail('PDF_SET_INVALID');
        if(present(value)&&!equal(value,next))return fail(scalarKeys.includes(key)?'PDF_SCALAR_CONFLICT':'PDF_PROJECT_CONFLICT');
        if(!present(value)){value=next;owner=doc.ordinal;}}
      result[key]=value;if(owner)result.sources[key]='PDF '+owner;
    }
    const windows=[],specifications=[];
    for(const doc of documents){
      for(const original of doc.parsed.result.windows){
        const item={...copy(original),sourceDocumentOrdinal:doc.ordinal,sourceLabel:'PDF '+doc.ordinal+(original.sourcePage?' p.'+original.sourcePage:'')},id=text(item.id),level=floor(item.floor);
        if(!id)return fail('PDF_WINDOW_IDENTITY_CONFLICT');
        const ambiguous=windows.some(w=>text(w.id)===id&&floor(w.floor)!==level&&(!floor(w.floor)||!level));if(ambiguous)return fail('PDF_WINDOW_IDENTITY_CONFLICT');
        const prior=windows.find(w=>text(w.id)===id&&floor(w.floor)===level);
        if(prior){
          if(prior.uConflict||item.uConflict)return fail('PDF_WINDOW_CONFLICT');
          const fillU=!present(prior.u)&&present(item.u),proveU=present(item.u)&&equal(prior.u,item.u)&&!prior.uSourceKind&&item.uSourceKind==='pdf-specification';
          for(const key of windowFields){if(present(prior[key])&&present(item[key])&&!equal(prior[key],item[key]))return fail('PDF_WINDOW_CONFLICT');if(!present(prior[key])&&present(item[key])){prior[key]=item[key];if(key==='eta'){prior.sourceDocumentOrdinal=doc.ordinal;prior.sourceLabel=item.sourceLabel;prior.sourcePage=item.sourcePage;prior.etaSource=item.etaSource;}}}
          if(fillU||proveU){for(const key of ['uSource','uSourceKind','uSourcePage','specificationIndex'])prior[key]=item[key]??null;prior.uSourceDocumentOrdinal=doc.ordinal;}
        }
        else windows.push(item);
      }
      for(const original of doc.parsed.result.envelopeSpecifications||[]){
        const item={...copy(original),sourceDocumentOrdinal:doc.ordinal},prior=specifications.find(s=>s.part===item.part&&s.index===item.index);
        if(prior&&present(prior.u)&&present(item.u)&&!equal(prior.u,item.u))return fail('PDF_SPECIFICATION_CONFLICT');
        if(prior){if(!present(prior.u)&&present(item.u))prior.u=item.u;}else specifications.push(item);
      }
    }
    result.windows=windows;result.envelopeSpecifications=specifications;result.envelopeMethod=documents.some(d=>d.parsed.result.envelopeMethod==='headers')?'headers':result.envelopeMethod;
    result.notes=[...new Set(documents.flatMap(d=>d.parsed.result.notes||[]))];
    const selected=options.roomDocumentOrdinal;
    let roomDocuments=documents;
    if(selected!==undefined&&selected!==null){
      if(!Number.isInteger(selected)||selected<1||selected>input.length)return fail('PDF_ROOM_SOURCE_INVALID');
      const info=report.documents.find(d=>d.ordinal===selected),ordinal=info?.duplicateOf||selected;
      const chosen=documents.find(d=>d.ordinal===ordinal);
      if(!chosen?.parsed.result.rooms.length)return fail('PDF_ROOM_SOURCE_INVALID');
      roomDocuments=[chosen];result.selectedRoomDocumentOrdinal=selected;
      warnings.push('室名・部屋区画は選択したPDF '+selected+' を参照しています。ほかのPDFは窓・断熱性能の照合に使用しています。');
    }
    const planDocs=roomDocuments.filter(d=>(d.parsed.result.rooms||[]).some(room=>room.sourceKind==='plan')||d.parsed.result.planRoomPages?.length),roomDocs=planDocs.length?planDocs:roomDocuments.filter(d=>d.parsed.result.rooms.length),rooms=[];
    // Consumers scope coordinates by document ordinal AND the original page.
    // Page 1 of two separate PDFs is normal; it is not a shared drawing frame.
    for(const doc of planDocs)for(const room of doc.parsed.result.rooms){if(room.sourceKind!=='plan')continue;const page=room.sourcePage;
      if(!Number.isInteger(page)||page<1)return fail('PDF_PLAN_FRAME_CONFLICT');}
    for(const doc of roomDocs)for(const original of doc.parsed.result.rooms){
      const room={...copy(original),sourceDocumentOrdinal:doc.ordinal};
      const candidates=rooms.filter(r=>text(r.name)===text(room.name)&&(!floor(r.floor)||!floor(room.floor)||floor(r.floor)===floor(room.floor))&&r.sourceDocumentOrdinal!==doc.ordinal);
      if(candidates.length){
        const sameInDocument=doc.parsed.result.rooms.filter(r=>text(r.name)===text(room.name)&&(!floor(r.floor)||!floor(room.floor)||floor(r.floor)===floor(room.floor)));
        if(candidates.length!==1||sameInDocument.length!==1)return roomConflict('multiple-room-candidates',[...candidates,room]);
        const prior=candidates[0];
        if(!floor(prior.floor)||!floor(room.floor)||floor(prior.floor)!==floor(room.floor))return roomConflict('floor-identity-unresolved',[prior,room]);
        const fields=['type','area','dx','dy','compound'];
        if(fields.some(key=>present(prior[key])&&present(room[key])&&!equal(prior[key],room[key])))return roomConflict('known-identity-fields-differ',[prior,room]);
        // A label's drawing coordinates are not its physical identity. Keep
        // each frame scoped to its own PDF/page; never reuse another PDF's XY
        // as though it belonged to the primary drawing.
        const frame=r=>r.sourceKind==='plan'?{sourceDocumentOrdinal:r.sourceDocumentOrdinal,sourcePage:r.sourcePage,key:r.key??null,plan:r.plan?copy(r.plan):null}:null;
        const frames=prior.planFrames||[frame(prior)].filter(Boolean),nextFrame=frame(room);
        if(nextFrame)frames.push(nextFrame);
        if(frames.length)prior.planFrames=frames;
        prior.sourceDocumentOrdinals=[...new Set([...(prior.sourceDocumentOrdinals||[prior.sourceDocumentOrdinal]),doc.ordinal])];
        for(const key of fields)if(!present(prior[key])&&present(room[key])){
          prior[key]=copy(room[key]);prior.fieldSourceDocuments=prior.fieldSourceDocuments||{};prior.fieldSourceDocuments[key]={document:doc.ordinal,page:room.sourcePage??null};
          if(key==='area'){
            prior.areaSource=room.areaSource|| (room.sourceKind==='plan'?'plan':'table');
            if(room.tableSourcePage)prior.tableSourcePage=room.tableSourcePage;
            prior.tableSourceDocumentOrdinal=doc.ordinal;
          }
        }
        report.counts.roomMetadataMerged++;
        continue;
      }
      if(input.length>1&&room.sourceKind==='plan'&&room.key)room.key='doc:'+doc.ordinal+':'+room.key;
      rooms.push(room);
    }
    const unmatched=[];
    const retainUnmatched=(room,ordinal)=>{const item={...copy(room),sourceKind:'table',sourceDocumentOrdinal:ordinal,planEvidenceMissing:true};if(!unmatched.some(prior=>JSON.stringify(roomCore(prior))===JSON.stringify(roomCore(item))))unmatched.push(item);};
    for(const doc of roomDocuments)for(const room of doc.parsed.result.unmatchedPlanTableRooms||[])retainUnmatched(room,doc.ordinal);
    if(planDocs.length){
      const tables=roomDocuments.filter(d=>!planDocs.includes(d)).flatMap(d=>d.parsed.result.rooms.map(room=>({room,ordinal:d.ordinal})));
      for(const table of tables)if(!rooms.some(room=>text(room.name)===text(table.room.name)&&(!floor(room.floor)||!floor(table.room.floor)||floor(room.floor)===floor(table.room.floor))))retainUnmatched(table.room,table.ordinal);
      for(const room of rooms){
        const peers=rooms.filter(r=>text(r.name)===text(room.name)&&(!floor(r.floor)||!floor(room.floor)||floor(r.floor)===floor(room.floor)));
        const matches=tables.filter(t=>text(t.room.name)===text(room.name)&&(!floor(t.room.floor)||!floor(room.floor)||floor(t.room.floor)===floor(room.floor)));
        if(peers.length!==1||matches.length!==1)continue;
        const table=matches[0];
        for(const key of ['area','type'])if(present(room[key])&&present(table.room[key])&&!equal(room[key],table.room[key]))return roomConflict('table-'+key+'-differs',[room,{...table.room,sourceDocumentOrdinal:table.ordinal}]);
        if(!present(room.area)&&table.room.area>0){room.area=table.room.area;room.areaSource='table';room.tableSourcePage=table.room.sourcePage||null;room.tableSourceDocumentOrdinal=table.ordinal;}
        if(!present(room.type)&&present(table.room.type))room.type=table.room.type;
        if(!room.floor&&!room.floorEvidenceIncomplete&&floor(table.room.floor)){room.floor=floor(table.room.floor);room.floorSource='table';}
      }
    }
    result.unmatchedPlanTableRooms=unmatched;
    for(const ordinal of [...new Set(unmatched.map(room=>room.sourceDocumentOrdinal))])warnings.push('PDF '+ordinal+': 面積表でのみ取得した室が '+unmatched.filter(room=>room.sourceDocumentOrdinal===ordinal).length+' 室あります。平面図で対応を確認できていないため、表の情報を保留候補として保持しています。');
    result.rooms=rooms;
    if(report.counts.roomMetadataMerged)result.notes.push('複数PDFで階と室名が一意な '+report.counts.roomMetadataMerged+' 室の情報を統合しました。図面ごとの座標は別々に保持し、同名の複数室や既知の面積・用途の矛盾は保留します。');
    const living=typeof options.isLiving==='function'?options.isLiving:r=>r.type==='A'||r.type==='B'||/^(?:LDK|LD|DK|居間|リビング|食堂|ダイニング|キッチン|台所|洋室|和室|寝室|主寝室|子供|子ども|書斎)/i.test(r.name||'');
    result.habitableRooms=rooms.filter(living);result.excludedRooms=rooms.filter(r=>!living(r));
    result.planRoomPages=[...new Set(planDocs.flatMap(d=>d.parsed.result.planRoomPages||[]))];
    result.planRoomDocuments=planDocs.map(d=>({ordinal:d.ordinal,pages:d.parsed.result.planRoomPages||[]}));
    result.roomSourceLabel=roomDocs.length?'PDF '+roomDocs.map(d=>d.ordinal).join('・')+(planDocs.length?' 平面図':' 室面積表'):'PDF';if(rooms.length)result.sources.rooms=result.roomSourceLabel;
    result.validation=result.validation||{};
    const fullWindowDoc=documents.find(d=>d.parsed.result.windows.length===windows.length&&d.parsed.result.windows.every(w=>windows.some(a=>text(a.id)===text(w.id)&&floor(a.floor)===floor(w.floor))));
    if(fullWindowDoc?.parsed.result.validation?.windows)result.validation.windows=copy(fullWindowDoc.parsed.result.validation.windows);
    else if(windows.length)result.validation.windows={count:windows.length,areaSum:windows.reduce((n,w)=>n+(w.area||0),0),expectedArea:null,gainSum:windows.reduce((n,w)=>n+(w.gain||0),0),expectedGain:null,areaOk:false,gainOk:false};
    if(roomDocs.length===1&&roomDocs[0].parsed.result.validation?.rooms)result.validation.rooms=copy(roomDocs[0].parsed.result.validation.rooms);else delete result.validation.rooms;
    result.validation.pdfExtraction={pageCount:input.reduce((n,d)=>n+(Number(d.assessment.pageCount)||0),0),lowTextPages:input.length===1?copy(input[0].assessment.lowTextPages||[]):input.flatMap((d,i)=>(d.assessment.lowTextPages||[]).map(page=>({document:i+1,page})))};
    for(const doc of documents)warnings.push(...doc.parsed.warnings.map(w=>'PDF '+doc.ordinal+': '+w));
    report.parsed={result,warnings:[...new Set(warnings)]};report.ready=true;return report;
  }
  root.boundaryCombineArchitrendPdfs=combine;
  if(typeof module!=='undefined'&&module.exports)module.exports={boundaryCombineArchitrendPdfs:combine};
})(typeof window==='undefined'?globalThis:window);

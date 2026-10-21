const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fixture=path.resolve(__dirname,'../../260914 Test1');

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.TEST_URL||'http://127.0.0.1:8765');
    await page.evaluate(()=>selectMode('architrend'));
    await page.locator('#atPdfInput').setInputFiles(path.join(fixture,'アーキトレンド温熱出力データ.pdf'));
    await page.waitForFunction(()=>atLastParse!==null);
    await page.locator('#at3dsInput').setInputFiles(path.join(fixture,'AB様邸新築工事外皮3DSテクスチャ有.3ds'));
    await page.waitForFunction(()=>atMesh?.reviewHash);
    await page.waitForFunction(()=>atParts.acTemplates && atParts.acTemplates['50°'] && atParts.templates.door && !atParts.loadError);
    const templateStatus=await page.evaluate(()=>({loaded:Object.keys(atParts.templates),acDirs:Object.keys(atParts.acTemplates||{}),error:atParts.loadError}));
    assert.equal(templateStatus.loaded.length,4,JSON.stringify({templateStatus,errors}));
    assert.deepEqual(templateStatus.acDirs.sort(),['30°','50°','水平'].sort(),JSON.stringify(templateStatus));
    await page.evaluate(()=>confirmApplyArchitrend());
    await page.locator('[data-floor="1"]').click();
    assert.equal(await page.locator('[data-part-mode="ac"]').count(), 0);
    await page.evaluate(()=>{
      const r=atMesh.rooms.find(r=>r.floor===1&&r.name==='LDK')||atMesh.rooms.find(r=>r.floor===1);
      const c=atRoomLabelPoint(r);
      if(!atPartAdd('ac', r.floor, c.x, c.y, {blowDir:'水平'})) throw Error('AC placement failed');
    });
    await page.waitForFunction(()=>atParts.items.length===1);
    await page.locator('[data-view="plan"]').click();
    const firstDir=await page.evaluate(()=>atParts.items[0].blowDir);
    assert.equal(firstDir,'水平');
    const marker=await page.locator('[data-part-id] circle').first().boundingBox();
    const start={x:marker.x+marker.width/2,y:marker.y+marker.height/2};
    const originalX=await page.evaluate(()=>atParts.items[0].x);
    await page.mouse.move(start.x,start.y);
    await page.mouse.down();
    await page.mouse.move(start.x+30,start.y,{steps:5});
    await page.mouse.up();
    assert.notEqual(await page.evaluate(()=>atParts.items[0].x),originalX);
    await page.locator('[data-view="3d"]').click();
    assert.ok(await page.locator('[data-part-id]').count());
    await page.locator('[data-view="plan"]').click();
    const result=await page.evaluate(()=>{
      const r2=atMesh.rooms.find(r=>r.floor===2&&r.area>5)||atMesh.rooms.find(r=>r.floor===2);
      const c2=atRoomLabelPoint(r2);
      if(!atPartAdd('ac',2,c2.x,c2.y,{blowDir:'30°'})) throw Error('2F AC placement failed');
      const ac=atParts.items.filter(it=>it.kind==='ac');
      if(ac[0].blowDir!=='水平' || ac[1].blowDir!=='30°') throw Error('blowDir '+ac.map(it=>it.blowDir));
      const floors=ac.map(it=>({floor:it.floor,base:Math.min(...atPartWorldMeshes(it).filter(m=>m.key==='ac_body').flatMap(m=>m.verts.map(v=>v.z))),fl:atPartFloorZ(it.floor)}));
      atPartRotateAc(ac[0].id,90);
      const doorKinds=['door','swing','slide'];
      const placed=[];
      for(const kind of doorKinds){
        const seg=atPartWallCandidates(1).map(c=>c.seg).find(s=>s.axis==='x'?s.y1-s.y0>atParts.templates[kind].width+0.1:s.x1-s.x0>atParts.templates[kind].width+0.1);
        if(!seg) throw Error('no 1F wall for '+kind);
        const x=seg.axis==='x'?seg.x:(seg.x0+seg.x1)/2;
        const y=seg.axis==='x'?(seg.y0+seg.y1)/2:seg.y;
        if(!atPartAdd(kind,1,x,y)) throw Error(kind+' placement failed');
        placed.push(atParts.items.at(-1));
      }
      atPartSetDoorWidth(placed[0].id, 0.55);
      const sized=atParts.items.find(it=>it.id===placed[0].id);
      const bodyMesh=atPartWorldMeshes(sized).find(m=>m.key==='doorbody');
      const bb=atPartBounds(bodyMesh.verts);
      const widthSpan=Math.max(bb.maxx-bb.minx, bb.maxy-bb.miny);
      atPartSetDoorOpen(sized.id, true);
      const openKeys=atPartWorldMeshes(atParts.items.find(it=>it.id===sized.id)).map(m=>m.key);
      const before=atAssignWindowsToRooms(atMesh.meshFaces,atMesh.rooms,atMesh.stats);
      const entrance=before.find(w=>w.floor==='1'&&/玄関/.test(w.roomName))||before.find(w=>w.floor==='1');
      if(!entrance) throw Error('no 1F window');
      const faceId=String(entrance.face.atFaceId),face=entrance.face;
      atParts.doorKind='door';
      atPartConvertFace(faceId);
      const after=atAssignWindowsToRooms(atMesh.meshFaces,atMesh.rooms,atMesh.stats);
      const house=buildIdfMeshExport(),fill=buildIdfFillExport(),gain=buildIdfGainExport();
      const parsed=at3dsParseBuffer(house.bytes.buffer);
      const parsedFill=fill?at3dsParseBuffer(fill.bytes.buffer):[];
      const acBodyRows=(fill?fill.rows:[]).filter(r=>r.sslKey==='ac_body');
      const encodedAcBases=acBodyRows.map(r=>Math.min(...parsedFill.find(o=>o.name===r.tds).verts.map(v=>v.z)));
      const state=atRoomReviewState();
      return {floors,acCount:document.getElementById('acCount').value,
        kinds:placed.map(it=>it.kind),widthSpan,doorWidth:sized.width,openKeys,
        template:Object.fromEntries(Object.entries(atParts.templates).map(([k,t])=>[k,{width:t.width,height:t.height,keys:t.meshes.map(m=>m.key)}])),
        before:before.length,after:after.length,faceId,entranceRoom:entrance.roomName,faceKey:face.sslKey,replaced:face.atReplacedByPart,
        convertedPart:atParts.items.some(it=>it.sourceFaceId===faceId),
        shape:(()=>{
          const row=house.rows.find(r=>r.idfName===face.idfName&&String(r.sslKey).startsWith('extdoor_'));
          const obj=row&&parsed.find(o=>o.name===row.tds);
          const span=vs=>{
            if(!vs||!vs.length) return null;
            const xs=vs.map(v=>v.x),ys=vs.map(v=>v.y),zs=vs.map(v=>v.z);
            return [Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys),Math.max(...zs)-Math.min(...zs)];
          };
          const a=span(face.verts),b=obj&&span(obj.verts);
          return {ok:!!(a&&b&&a.every((n,i)=>Math.abs(n-b[i])<0.002)),face:a,export:b,key:row&&row.sslKey};
        })(),
        staleWindowRow:!!document.querySelector('.win-row[data-at-face-id="'+faceId+'"]'),
        staleUnassigned:atUnassignedWindows.some(w=>String(w.atFaceId)===faceId),
        exportKeys:house.rows.map(r=>r.sslKey),fillKeys:(fill?fill.rows:[]).map(r=>r.sslKey),doorSourceInExport:house.rows.some(r=>r.idfName===face.idfName&&r.tds.startsWith('ドア')),
        shifted:house.origin.dx===fill.origin.dx&&house.origin.dy===fill.origin.dy&&house.origin.dz===fill.origin.dz&&
          house.origin.dx===gain.origin.dx&&house.origin.dy===gain.origin.dy&&house.origin.dz===gain.origin.dz,
        exportedNames:parsed.filter(o=>/^AC|^DR/.test(o.name)).map(o=>o.name),
        fillNames:parsedFill.filter(o=>/^AC|^FILL/.test(o.name)).map(o=>o.name),
        encodedAcBases,originDz:house.origin.dz,
        houseSpan:Math.max(...parsed.flatMap(o=>o.verts.map(v=>Math.abs(v.x)))),
        savedItems:state.parts.items.length,savedOverride:state.parts.overrides[faceId]};
    });
    assert.equal(result.acCount,'2');
    result.floors.forEach(v=>assert.ok(Math.abs(v.base-v.fl-2)<1e-6));
    assert.deepEqual(result.kinds,['door','swing','slide']);
    assert.deepEqual(result.template.ac.keys.sort(),['ac_body','ac_return','ac_supply'].sort());
    for(const key of ['door','swing','slide']) assert.deepEqual(result.template[key].keys.sort(),['doorbody','doorgap_top','doorgap_uc'].sort());
    assert.equal(result.before-result.after,1);
    assert.ok(String(result.faceKey).startsWith('extdoor_'));
    assert.equal(result.replaced,false);
    assert.equal(result.convertedPart,false);
    assert.equal(result.shape.ok,true, JSON.stringify(result.shape));
    assert.equal(result.staleWindowRow,false);
    assert.equal(result.staleUnassigned,false);
    assert.equal(result.savedOverride,'door');
    assert.equal(result.savedItems,5);
    assert.ok(result.exportedNames.some(n=>n.startsWith('AC')));
    assert.ok(result.exportedNames.some(n=>n.startsWith('DR')));
    assert.ok(result.fillNames.some(n=>n.startsWith('AC') && n.endsWith('B')));
    result.encodedAcBases.forEach((z,i)=>assert.ok(Math.abs(z-(result.floors[i].base+result.originDz/1000))<1e-4, JSON.stringify({z,base:result.floors[i].base,originDz:result.originDz})));
    assert.ok(result.houseSpan<100, '3DS should be meters, span='+result.houseSpan);
    assert.ok(Math.abs(result.widthSpan-result.doorWidth)<0.02, JSON.stringify({span:result.widthSpan,width:result.doorWidth}));
    assert.deepEqual(result.openKeys, ['dooropen']);
    for(const key of ['ac_supply','ac_return','doorbody','doorgap_top','doorgap_uc','dooropen'])
      assert.ok(result.exportKeys.includes(key),key);
    assert.equal(result.exportKeys.includes('ac_body'), false);
    assert.ok(result.fillKeys.includes('ac_body'));
    const sslColors=await page.evaluate(()=>{
      const house=buildIdfMeshExport(),fill=buildIdfFillExport();
      return [...house.rows,...(fill?fill.rows:[])].filter(r=>r.tds.startsWith('AC')||r.tds.startsWith('DR'))
        .map(r=>({expected:r.sslKey,actual:sslGuessCategory(r.rgb)}));
    });
    sslColors.forEach(v=>assert.equal(v.actual,v.expected));
    assert.equal(result.shifted,true);
    if(process.env.SCREENSHOT) await page.locator('#atRoomViewer').screenshot({path:process.env.SCREENSHOT});
    await page.evaluate(()=>saveStateNow());
    await page.reload();
    await page.evaluate(()=>selectMode('architrend'));
    await page.locator('#at3dsInput').setInputFiles(path.join(fixture,'AB様邸新築工事外皮3DSテクスチャ有.3ds'));
    await page.waitForFunction(()=>atMesh?.reviewHash&&atParts.items.length===5);
    const reopened=await page.evaluate(faceId=>({count:atParts.items.length,
      faceKey:atMesh.meshFaces.find(f=>String(f.atFaceId)===faceId)?.sslKey,
      acCount:document.getElementById('acCount').value}),result.faceId);
    assert.equal(reopened.count,5);
    assert.ok(String(reopened.faceKey).startsWith('extdoor_'));
    assert.equal(reopened.acCount,'2');
    const restored=await page.evaluate(async()=>{
      const state=atRoomReviewState(),file=document.getElementById('at3dsInput').files[0];
      const buf=await file.arrayBuffer();
      atRoomView.pending=state;
      atMesh=buildAtMeshFromBuffer(buf,file.name);
      await atRoomModelLoaded(buf);
      const faceId=Object.keys(state.parts.overrides)[0];
      const counts={items:atParts.items.length,faceKey:atMesh.meshFaces.find(f=>String(f.atFaceId)===faceId)?.sslKey,
        acCount:document.getElementById('acCount').value};
      const acIds=atParts.items.filter(it=>it.kind==='ac').map(it=>it.id);
      acIds.forEach(id=>atPartRemove(id));
      counts.zeroCount=document.getElementById('acCount').value;
      counts.zeroWarn=document.getElementById('acWarn').textContent;
      counts.hasNaN=document.getElementById('supplyStats').textContent.includes('NaN');
      atUndoRoomEdit();
      counts.undoCount=document.getElementById('acCount').value;
      return counts;
    });
    assert.equal(restored.items,5);
    assert.ok(String(restored.faceKey).startsWith('extdoor_'));
    assert.equal(restored.acCount,'2');
    assert.equal(restored.zeroCount,'0');
    assert.match(restored.zeroWarn,/未配置/);
    assert.equal(restored.hasNaN,false);
    assert.equal(restored.undoCount,'1');
    assert.deepEqual(errors,[]);
    console.log('parts OK',JSON.stringify({floors:result.floors,templates:result.template,
      entranceRoom:result.entranceRoom,windowCount:[result.before,result.after],restored}));
  }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});

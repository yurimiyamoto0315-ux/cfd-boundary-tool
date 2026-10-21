// Run with Playwright available through NODE_PATH and the tool served at TEST_URL.
// The real AB fixture stays in the sibling 260914 Test1 directory.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const fixture=path.resolve(__dirname,'../../260914 Test1');
const model=path.join(fixture,'AB様邸新築工事外皮3DSテクスチャ有.3ds');
const pdf=path.join(fixture,'アーキトレンド温熱出力データ.pdf');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',async d=>{errors.push(d.message());await d.dismiss();});
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:8765');
  await page.evaluate(()=>selectMode('architrend'));
  await page.locator('#atPdfInput').setInputFiles(pdf);
  await page.waitForFunction(()=>atLastParse!==null);
  const catalog=await page.evaluate(()=>atLastParse.result.rooms);
  assert.equal(catalog.length,22);
  assert.deepEqual(catalog.filter(r=>r.floor==='1').map(r=>r.area),[23.19,3.31,3.31,1.66,4.97,3.31,3.31,1.66,1.66,1.66,1.66]);
  assert.deepEqual(catalog.filter(r=>r.floor==='2').map(r=>r.area),[5.8,2.49,2.48,1.66,12.4,12,11.17,6.62,4.97,1.66,.83]);
  await page.locator('#at3dsInput').setInputFiles(model);
  await page.waitForFunction(()=>atMesh?.reviewHash);
  await page.evaluate(()=>confirmApplyArchitrend());
  await page.waitForFunction(()=>document.querySelectorAll('.room-card').length>0);
  assert.equal(await page.locator('#atRoomViewer [data-floor="1"]').count(),1);
  assert.equal(await page.locator('#atRoomViewer [data-floor="2"]').count(),1);
  assert.equal(await page.evaluate(()=>atMesh.rooms.length),23);
  // Every 3DS window follows its geometric room into the internal-gain card.
  const windowLinks=await page.evaluate(()=>{
    const wins=atAssignWindowsToRooms(atMesh.meshFaces,atMesh.rooms,atMesh.stats);
    return wins.map((w,i)=>{
      const room=atMesh.rooms.find(r=>r.key===w.roomKey);
      const row=document.querySelector(`.win-row[data-at-mesh-window-index="${i}"]`);
      return {index:i,roomKey:w.roomKey,habitable:!!room?.habitable,keep:!!room?.keep,
        cardKey:row?.closest('.room-card')?.dataset.atRoomKey||'',
        queued:atUnassignedWindows.some(q=>String(q.atMeshWindowIndex)===String(i))};
    });
  });
  assert.ok(windowLinks.length>0);
  windowLinks.forEach(w=>{
    if(w.roomKey){
      assert.equal(w.keep, true);
      assert.equal(w.cardKey, w.roomKey);
      assert.equal(w.queued, false);
    }else{
      assert.ok(w.queued);
    }
  });
  const gainRooms=await page.evaluate(()=>{
    const wins=atAssignWindowsToRooms(atMesh.meshFaces,atMesh.rooms,atMesh.stats);
    const winKeys=new Set(wins.map(w=>w.roomKey).filter(Boolean));
    return atMesh.rooms.map(r=>{
      const card=document.querySelector(`.room-card[data-at-room-key="${r.key}"]`);
      const occ=card && card.querySelector('.occCount');
      const equip=card && card.querySelector('.equipSensRate');
      return {key:r.key, habitable:!!r.habitable, keep:!!r.keep, hasWin:winKeys.has(r.key),
        hasCard:!!card, occ:occ?Number(occ.value):null, equip:equip?Number(equip.value):null,
        nonHab:card?card.dataset.nonHabitable:''};
    });
  });
  gainRooms.filter(r=>r.habitable || r.hasWin).forEach(r=>{
    assert.equal(r.keep, true);
    assert.equal(r.hasCard, true);
  });
  gainRooms.filter(r=>r.habitable).forEach(r=>{
    assert.equal(r.nonHab, 'false');
    assert.ok(r.equip>0);
  });
  gainRooms.filter(r=>!r.habitable && r.hasWin).forEach(r=>{
    assert.equal(r.nonHab, 'true');
    assert.equal(r.occ, 0);
    assert.equal(r.equip, 0);
  });
  assert.ok(await page.locator('.room-window-link').filter({hasText:'3DS位置から自動'}).count());
  // Roof fill plus cantilever fill to the foundation bottom. No crawl-space fill.
  const fillLevels=await page.evaluate(()=>{
    const built=idfMeshBuildFillPrisms();
    const cantTops=idfMeshCantileverFacesMm().map(v=>v.reduce((s,p)=>s+p.z,0)/v.length);
    const spans=built.prisms.map(p=>{
      const zs=p.verts.map(v=>v.z); return {min:Math.min(...zs),max:Math.max(...zs)};
    });
    const house=buildIdfMeshExport();
    return {
      zFound:built.zFound,zFloor1:built.zFloor1,zTop:built.zTop,cantTops,spans,
      floorOut:atMesh.meshFaces.filter(f=>f.sslKey==='floor_out').length,
      exportAttic:house.rows.filter(r=>r.sslKey==='attic').length,
      exportFloorOut:house.rows.filter(r=>r.sslKey==='floor_out').length,
      skippedAttic:house.skippedAttic||0
    };
  });
  assert.ok(fillLevels.zFound<fillLevels.zFloor1);
  fillLevels.cantTops.forEach(top=>{
    const prism=fillLevels.spans.find(s=>Math.abs(s.max-top)<1);
    assert.ok(prism);
    assert.ok(Math.abs(prism.min-fillLevels.zFound)<1);
  });
  assert.ok(!fillLevels.spans.some(s=>Math.abs(s.max-fillLevels.zFloor1)<1 && Math.abs(s.min-fillLevels.zFound)<1));
  assert.ok(fillLevels.floorOut>0);
  assert.ok(fillLevels.skippedAttic>0);
  assert.equal(fillLevels.exportAttic, 0);
  assert.ok(fillLevels.exportFloorOut>0);
  // Combined envelope AABB min XYZ is written as the 3DS origin on house/fill/gain.
  const originExport=await page.evaluate(()=>{
    function aabbOf(u8){
      const copy=u8.buffer.slice(u8.byteOffset, u8.byteOffset+u8.byteLength);
      const objects=at3dsParseBuffer(copy);
      let minx=Infinity,miny=Infinity,minz=Infinity,maxx=-Infinity,maxy=-Infinity,maxz=-Infinity;
      objects.forEach(o=>o.verts.forEach(v=>{
        minx=Math.min(minx,v.x); miny=Math.min(miny,v.y); minz=Math.min(minz,v.z);
        maxx=Math.max(maxx,v.x); maxy=Math.max(maxy,v.y); maxz=Math.max(maxz,v.z);
      }));
      return {minx,miny,minz,maxx,maxy,maxz};
    }
    const mesh=buildIdfMeshExport();
    const fill=buildIdfFillExport();
    const gain=buildIdfGainExport();
    return {mesh:aabbOf(mesh.bytes), fill:aabbOf(fill.bytes), gain:aabbOf(gain.bytes)};
  });
  assert.ok(Math.abs(originExport.mesh.minx)<1e-3);
  assert.ok(Math.abs(originExport.mesh.miny)<1e-3);
  assert.ok(Math.abs(originExport.mesh.minz)<1e-3);
  assert.ok(originExport.fill.minx>=-1e-2);
  assert.ok(originExport.fill.miny>=-1e-2);
  assert.ok(originExport.fill.minz>=-1e-2);
  assert.ok(originExport.fill.maxx<=originExport.mesh.maxx+1e-2);
  assert.ok(originExport.fill.maxy<=originExport.mesh.maxy+1e-2);
  assert.ok(Math.abs(originExport.mesh.maxz-originExport.fill.maxz)<1e-2);
  assert.ok(originExport.gain.minx>0 && originExport.gain.miny>0 && originExport.gain.minz>0);
  assert.ok(originExport.gain.maxx<originExport.mesh.maxx);
  assert.ok(originExport.gain.maxy<originExport.mesh.maxy);
  assert.ok(originExport.gain.maxz<originExport.mesh.maxz);
  // Concave 2F rooms keep their footprint and receive a real wall setback.
  const concaveGains=await page.evaluate(()=>{
    const targets=atMesh.rooms.filter(r=>/洋室3/.test(r.name) ||
      (r.floor===2 && Math.abs(r.area-9.1091)<0.15 && (r.ring||[]).length>4));
    const gains=atBuildGainVolumes({rooms:atMesh.rooms.map(r=>targets.includes(r)?Object.assign({},r,{keep:true,name:r.name||'ローカ'}):r)});
    return targets.map(r=>{
      const g=gains.find(v=>v.roomKey===r.key), inner=g?.prisms?.[0]?.bot||[];
      return {name:r.name||'ローカ',roomArea:atRingAreaM2(r.ring),gainArea:atRingAreaM2(inner),
        roomPoints:r.ring.length,gainPoints:inner.length,
        inside:inner.every(p=>atPointInRing(p.x,p.y,r.ring))};
    });
  });
  assert.ok(concaveGains.some(g=>/ローカ|廊下/.test(g.name)));
  assert.ok(concaveGains.some(g=>/洋室3/.test(g.name)));
  concaveGains.forEach(g=>{
    assert.ok(g.gainArea>0 && g.gainArea<g.roomArea-0.1);
    assert.ok(g.gainPoints>=g.roomPoints);
    assert.ok(g.inside);
  });
  // 3DS floor area × inferred story height automatically feeds the ventilation volume.
  const volume=await page.evaluate(()=>atMeshLivingVolume(atMesh));
  assert.ok(volume>150);
  assert.equal(await page.locator('#roomVol').inputValue(),(Math.round(volume*10)/10).toFixed(1));
  assert.equal(await page.locator('#roomVolTag').textContent(),'3DS自動');
  assert.match(await page.locator('#atRoomEditor').textContent(),/認識階高/);
  assert.match(await page.locator('#atRoomEditor').textContent(),/自動体積/);
  // The calculated volume is the value used by the ventilation-load equation.
  await page.evaluate(()=>{
    document.getElementById('ventMode').value='third';
    document.getElementById('ach').value='0.5';
    document.getElementById('tmax').value='35';
    document.getElementById('tmin').value='25';
    document.getElementById('tpeak').value='14';
    document.getElementById('targetT').value='26';
    document.getElementById('detailHour').value='14';
    runAll();
  });
  const vent=await page.evaluate(()=>{
    const out=Number(document.getElementById('outTaDisp').value), target=Number(document.getElementById('targetT').value);
    const shown=Number(document.querySelectorAll('#loadStats .val')[1].textContent.replace(/[^0-9.-]/g,''));
    return {shown,expected:Math.round(RHOCP*Number(document.getElementById('ach').value)*Number(document.getElementById('roomVol').value)*(out-target))};
  });
  assert.ok(Math.abs(vent.shown-vent.expected)<=2);
  // Rotating model north updates geometric windows, eight-direction wall SAT groups, and the viewer compass.
  await page.evaluate(()=>{
    document.getElementById('lat').value='35.68'; document.getElementById('lon').value='139.76';
    document.getElementById('calcDate').value='2026-07-21'; document.getElementById('detailHour').value='15'; runAll();
  });
  const azBefore=await page.evaluate(()=>atAssignWindowsToRooms(atMesh.meshFaces,atMesh.rooms,atMesh.stats).map(w=>w.az));
  const hintsBefore=await page.locator('.wSolarHint').allTextContents();
  await page.locator('#atNorthDeg').fill('45');
  await page.locator('#atNorthDeg').blur();
  const azAfter=await page.evaluate(()=>atAssignWindowsToRooms(atMesh.meshFaces,atMesh.rooms,atMesh.stats).map(w=>w.az));
  const wrap=a=>{while(a>180)a-=360;while(a<=-180)a+=360;return a;};
  assert.deepEqual(azBefore.map(v=>Math.round(wrap(v-45)*10)/10),azAfter.map(v=>Math.round(v*10)/10));
  assert.ok(await page.evaluate(()=>atMesh.meshFaces.some(f=>/^wall_(北東|南東|南西|北西)$/.test(f.sslKey))));
  assert.ok(await page.evaluate(()=>transferRows.some(r=>r.target==='外壁 北東 (発生パネル)')));
  assert.ok(await page.evaluate(()=>SSL_CATEGORIES.some(c=>c.key==='wall_北東')));
  assert.equal(await page.locator('#atNorthRange').inputValue(),'45');
  assert.ok(await page.locator('#atRoomScene .at-rv-compass').count());
  const hintsAfter=await page.locator('.wSolarHint').allTextContents();
  assert.ok(hintsAfter.some((v,i)=>v!==hintsBefore[i]));
  // Same-area bedrooms can be reversed; swapping must retain both identities.
  await page.locator('[data-floor="2"]').click();
  const pair=await page.evaluate(()=>atMesh.rooms.filter(r=>['洋室1','洋室2'].includes(r.name)).map(r=>({key:r.key,index:r.pdfIndex,name:r.name})));
  // Unchecking 居室 drops ventilation volume but keeps solar heat on windowed rooms.
  await page.locator(`[data-room="${pair[0].key}"]`).click();
  await page.locator('#atRoomHeatTarget').uncheck();
  await page.locator('[data-action="commit"]').click();
  assert.ok(Number(await page.locator('#roomVol').inputValue())<volume);
  assert.equal(await page.locator(`.room-card[data-at-room-key="${pair[0].key}"]`).count(),1);
  assert.equal(await page.evaluate(k=>atMesh.rooms.find(r=>r.key===k).habitable,pair[0].key),false);
  assert.equal(await page.evaluate(k=>atMesh.rooms.find(r=>r.key===k).keep,pair[0].key),true);
  await page.locator('[data-action="undo"]').click();
  assert.equal(await page.locator('#roomVol').inputValue(),(Math.round(volume*10)/10).toFixed(1));
  await page.locator(`[data-room="${pair[0].key}"]`).click();
  await page.locator('#atRoomPdfChoice').selectOption(String(pair[1].index));
  await page.locator('[data-action="commit"]').click();
  assert.deepEqual(await page.evaluate(keys=>keys.map(k=>atMesh.rooms.find(r=>r.key===k).name),pair.map(r=>r.key)),[pair[1].name,pair[0].name]);
  assert.ok(await page.evaluate(()=>{
    const wins=atAssignWindowsToRooms(atMesh.meshFaces,atMesh.rooms,atMesh.stats);
    return wins.every((w,i)=>{
      const room=atMesh.rooms.find(r=>r.key===w.roomKey);
      const row=document.querySelector(`.win-row[data-at-mesh-window-index="${i}"]`);
      return room?.keep ? row?.closest('.room-card')?.dataset.atRoomKey===w.roomKey : !row || !w.roomKey;
    });
  }));
  assert.equal(await page.evaluate(()=>atMesh.rooms.filter(r=>r.reviewed).length),1);
  await page.locator('[data-action="undo"]').click();
  assert.deepEqual(await page.evaluate(keys=>keys.map(k=>atMesh.rooms.find(r=>r.key===k).name),pair.map(r=>r.key)),pair.map(r=>r.name));
  // Editing from the viewer persists through PDF re-match, calculation cards, and gain export.
  await page.locator('#atRoomNameEdit').fill('設計者確認・洋室');
  await page.locator('[data-action="commit"]').click();
  const key=pair[0].key;
  await page.evaluate(()=>renderArchitrendReview(atLastParse,false));
  assert.equal(await page.evaluate(k=>atMesh.rooms.find(r=>r.key===k).name,key),'設計者確認・洋室');
  assert.equal(await page.locator(`.room-card[data-at-room-key="${key}"] .roomName`).inputValue(),'設計者確認・洋室');
  assert.ok(await page.evaluate(()=>atBuildGainVolumes(atMesh).some(g=>g.zone==='設計者確認・洋室')));
  await page.locator(`.room-card[data-at-room-key="${key}"] .occCount`).fill('3');
  await page.evaluate(()=>runAll());
  await page.locator('#at3dsInput').setInputFiles([]);
  await page.locator('#at3dsInput').setInputFiles(model);
  await page.waitForFunction(()=>atRoomView.restored);
  assert.equal(await page.evaluate(k=>atMesh.rooms.find(r=>r.key===k).name,key),'設計者確認・洋室');
  assert.equal(await page.locator(`.room-card[data-at-room-key="${key}"] .occCount`).inputValue(),'3');
  const state=await page.evaluate(()=>gatherState());
  assert.equal(state.atRoomReview.hash.length,64);
  await page.evaluate(()=>saveStateNow());
  await page.reload();
  await page.locator('#at3dsInput').setInputFiles(model);
  await page.waitForFunction(()=>atMesh?.reviewHash);
  assert.equal(await page.evaluate(k=>atMesh.rooms.find(r=>r.key===k).name,key),'設計者確認・洋室');
  assert.ok(await page.evaluate(()=>atRoomView.restored));
  assert.equal(await page.evaluate(()=>atRoomView.northDeg),45);
  // A different file cannot receive the old snapshot even if a room key matches.
  const hash=state.atRoomReview.hash;
  assert.equal(await page.evaluate(h=>{atMesh.reviewHash='different';const ok=atRestoreRoomAssignments();atMesh.reviewHash=h;return ok;},hash),false);
  // JSON round trip also restores after an intervening edit.
  await page.evaluate(s=>applyState(JSON.parse(JSON.stringify(s))),state);
  assert.equal(await page.evaluate(k=>atMesh.rooms.find(r=>r.key===k).name,key),'設計者確認・洋室');
  // Stair centerline: wall-span treads+risers; a covering upper floor still plans.
  const stairs=await page.evaluate(()=>{
    function rect(x0,y0,x1,y1){ return [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]; }
    const upper={name:'洋室', floor:2, z:2.84, ring:rect(8,8,12,12)};
    const straight={name:'階段', floor:1, z:0, zTop:2.84, ring:rect(0,0,1.1,3.4),
      stairPath:[{x:0.55,y:0.25},{x:0.55,y:3.15}], stairPathEdited:true};
    const L={name:'階段', floor:1, z:0, zTop:2.84, ring:[{x:0,y:0},{x:2.4,y:0},{x:2.4,y:2.4},{x:1.4,y:2.4},{x:1.4,y:1.0},{x:0,y:1.0}],
      stairPath:[{x:0.5,y:0.5},{x:1.85,y:0.5},{x:1.85,y:1.9}], stairPathEdited:true};
    const covered={name:'階段', floor:1, z:0, zTop:2.84, ring:rect(0,0,2,1.2),
      stairPath:[{x:0.3,y:0.6},{x:1.7,y:0.6}], stairPathEdited:true};
    const coverFace={sslKey:'floor1', nameJa:'内床', verts:[{x:0,y:0,z:2.9},{x:2,y:0,z:2.9},{x:2,y:1.2,z:2.9},{x:0,y:1.2,z:2.9}]};
    const sMesh={rooms:[straight, upper], meshFaces:[]};
    const lMesh={rooms:[L, upper], meshFaces:[]};
    const cMesh={rooms:[covered], meshFaces:[coverFace]};
    atPlanStairsForMesh(sMesh);
    atPlanStairsForMesh(lMesh);
    atPlanStairsForMesh(cMesh);
    const zs=(straight.stair.treads||[]).map(t=>t.zTop);
    const cornerS=1.85-0.5;
    const before=L.stair.treads.find(t=>t.kind!=='landing' && t.s<cornerS-0.05);
    const after=L.stair.treads.find(t=>t.kind!=='landing' && t.s>cornerS+0.05);
    const inside=(L.stair.treads||[]).every(t=>(t.ring||[]).every(p=>atPointInRing(p.x,p.y,L.ring)));
    const prev=atMesh.rooms;
    atMesh.rooms=sMesh.rooms;
    const house=buildIdfMeshExport();
    const guess=typeof sslGuessCategory==='function' ? sslGuessCategory('180 180 180') : '';
    atMesh.rooms=prev;
    const lastZ=zs.length?zs[zs.length-1]:null;
    return {
      zs, mono:zs.every((z,i)=>i===0||z>=zs[i-1]-1e-9),
      n:zs.length, going:straight.stair.going, lastZ, toZ:straight.stair.toZ,
      nRisers:(straight.stair.risers||[]).length,
      beforeT:{x:before&&before.tangent.x, y:before&&before.tangent.y},
      afterT:{x:after&&after.tangent.x, y:after&&after.tangent.y},
      inside, covered:!!covered.stair, hasUpper:atStairHasUpperFloor(covered, cMesh),
      sslRows:(house.rows||[]).filter(r=>r.nameJa==='階段' && r.sslKey==='innerwall').length,
      guess
    };
  });
  assert.ok(stairs.n>=8);
  assert.equal(stairs.mono, true);
  assert.ok(stairs.going>=0.15);
  assert.ok(Math.abs(stairs.beforeT.x)>0.7 && Math.abs(stairs.beforeT.y)<0.4);
  assert.ok(Math.abs(stairs.afterT.y)>0.7 && Math.abs(stairs.afterT.x)<0.4);
  assert.equal(stairs.inside, true);
  assert.equal(stairs.hasUpper, true);
  assert.equal(stairs.covered, true);
  assert.ok(Math.abs(stairs.lastZ-stairs.toZ)<1e-6);
  assert.ok(stairs.nRisers>=8);
  assert.ok(stairs.sslRows>=1);
  assert.equal(stairs.guess, 'innerwall');
  await page.evaluate(()=>{
    const ring=[{x:200,y:200},{x:201.2,y:200},{x:201.2,y:203.2},{x:200,y:203.2}];
    const r={key:'stair-test', name:'階段', floor:1, z:0, zTop:2.84, area:3.84, dx:1.2, dy:3.2, ring,
      stairPath:[{x:200.6,y:200.3},{x:200.6,y:202.9}], stairPathEdited:true, reviewed:true, habitable:false, keep:false};
    r.stair=atStairFromPath(r, {rooms:[r], meshFaces:[]});
    atMesh.rooms.push(r);
    atRoomView.floor='1'; atRoomView.selected=r.key; atRoomView.plan=true;
    atRenderRoomViewer();
  });
  assert.ok(await page.locator('#atRoomScene .at-rv-stair-path').count());
  assert.ok(await page.locator('#atRoomScene [data-stair-vertex]').count()>=2);
  assert.ok(await page.locator('[data-action="stair-add"]').count());
  await page.locator('[data-action="stair-add"]').click();
  assert.equal(await page.evaluate(()=>atMesh.rooms.find(r=>r.key==='stair-test').stairPath.length),3);
  await page.evaluate(()=>{
    atMesh.rooms=atMesh.rooms.filter(r=>r.key!=='stair-test');
    atRenderRoomViewer();
  });
  // A 3F floor above the legacy ceiling cutoff is recognized when full-height walls rise above it.
  const third=await page.evaluate(()=>{
    const faces=[];
    for(let i=0;i<3;i++){
      const z=i*3;
      faces.push({sslKey:i===0?'floor1':'innerwall',nameJa:i===2?'天井':'内床',verts:[{x:0,y:0,z},{x:4,y:0,z},{x:4,y:4,z},{x:0,y:4,z}]});
      faces.push({sslKey:'innerwall',nameJa:'内壁',verts:[{x:0,y:0,z},{x:0,y:4,z},{x:0,y:4,z:z+2.8},{x:0,y:0,z:z+2.8}]});
    }
    const rooms=atBuildRoomsFromFaces(faces,{});
    const old=atMesh.rooms;
    atMesh.rooms=rooms;
    atRenderRoomViewer();
    const hasTab=!!document.querySelector('[data-floor="3"]');
    atMesh.rooms=old;
    atRenderRoomViewer();
    return {floors:rooms.map(r=>r.floor),hasTab};
  });
  assert.deepEqual(third,{floors:[1,2,3],hasTab:true});
  await page.locator('[data-floor="2"]').click();
  await page.locator('[data-view="plan"]').click();
  assert.ok(await page.locator('#atRoomScene polygon[data-scene-room]').count()>0);
  // Scene labels select the same editor as the accessible list.
  const label=page.locator('#atRoomScene text[data-scene-room]').first();
  const selectedKey=await label.getAttribute('data-scene-room');
  await label.click();
  assert.equal(await page.evaluate(()=>atRoomView.selected),selectedKey);
  await page.setViewportSize({width:390,height:844});
  const overflow=await page.locator('#atRoomViewer').evaluate(el=>el.scrollWidth>el.clientWidth+2);
  assert.equal(overflow,false);
  if(process.env.TEST_SCREENSHOT){
    await page.setViewportSize({width:1440,height:1100});
    await page.locator('[data-view="3d"]').click();
    // Hide sticky app chrome only in the screenshot to avoid occluding this scrolled section.
    await page.addStyleTag({content:'.app-chrome{visibility:hidden!important}'});
    await page.locator('#atRoomViewer').screenshot({path:process.env.TEST_SCREENSHOT});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: real PDF (22 rooms), both floors (20 regions), room-window linkage, auto volume, north-to-SAT/direct-solar/SSL linkage, swap/undo, reload, JSON, fingerprint isolation, stair wall-span panels, 3F fixture, picking, responsive layout.');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});

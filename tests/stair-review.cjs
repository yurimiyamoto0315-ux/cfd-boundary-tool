const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fixture=path.resolve(__dirname,'../../260914 Test1');
const model=path.join(fixture,'AB様邸新築工事外皮3DSテクスチャ有.3ds');
const pdf=path.join(fixture,'アーキトレンド温熱出力データ.pdf');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.TEST_URL||'http://127.0.0.1:8765');
    await page.evaluate(()=>selectMode('architrend'));
    await page.locator('#atPdfInput').setInputFiles(pdf);
    await page.waitForFunction(()=>atLastParse!==null);
    await page.locator('#at3dsInput').setInputFiles(model);
    await page.waitForFunction(()=>atMesh?.reviewHash);
    await page.evaluate(()=>confirmApplyArchitrend());
    await page.waitForFunction(()=>document.querySelectorAll('.room-card').length>0);
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
      atPlanStairsForMesh({rooms:[straight, upper], meshFaces:[]});
      atPlanStairsForMesh({rooms:[L, upper], meshFaces:[]});
      atPlanStairsForMesh({rooms:[covered], meshFaces:[coverFace]});
      const zs=(straight.stair.treads||[]).map(t=>t.zTop);
      const cornerS=1.85-0.5;
      const before=L.stair.treads.find(t=>t.kind!=='landing' && t.s<cornerS-0.05);
      const after=L.stair.treads.find(t=>t.kind!=='landing' && t.s>cornerS+0.05);
      const inside=(L.stair.treads||[]).every(t=>(t.ring||[]).every(p=>atPointInRing(p.x,p.y,L.ring)));
      const prev=atMesh.rooms;
      atMesh.rooms=[{...straight, stair:straight.stair, stairPath:straight.stairPath}];
      const house=buildIdfMeshExport();
      const guess=sslGuessCategory('180 180 180');
      atMesh.rooms=prev;
      const named=atMesh.rooms.filter(r=>atIsStairRoom(r)).map(r=>({name:r.name, floor:r.floor, n:((r.stair&&r.stair.treads)||[]).length, covered:!!r.stair && atStairHasUpperFloor(r, atMesh)}));
      const lastZ=zs.length?zs[zs.length-1]:null;
      return {
        zs, mono:zs.every((z,i)=>i===0||z>=zs[i-1]-1e-9), n:zs.length, going:straight.stair.going,
        lastZ, toZ:straight.stair.toZ, nRisers:(straight.stair.risers||[]).length,
        beforeT:{x:before&&before.tangent.x, y:before&&before.tangent.y},
        afterT:{x:after&&after.tangent.x, y:after&&after.tangent.y},
        inside, covered:!!covered.stair, hasUpper:atStairHasUpperFloor(covered,{meshFaces:[coverFace]}),
        sslRows:(house.rows||[]).filter(r=>r.nameJa==='階段' && r.sslKey==='innerwall').length, guess, named,
        sjisOk:idfMeshNameZ('階段01').ok
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
    assert.equal(stairs.sjisOk, true);
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
    assert.ok(await page.locator('#atRoomScene .at-rv-stair-tread').count()>0);
    await page.locator('[data-action="stair-add"]').click();
    assert.equal(await page.evaluate(()=>atMesh.rooms.find(r=>r.key==='stair-test').stairPath.length),3);
    await page.locator('[data-action="stair-flip"]').click();
    await page.locator('[data-action="stair-reset"]').click();
    assert.equal(await page.evaluate(()=>atMesh.rooms.find(r=>r.key==='stair-test').stairPath.length),2);
    const shot=process.env.TEST_SCREENSHOT || require('path').join(__dirname,'../../../tmp/room-review/stair-viewer.png');
    await page.locator('#atRoomViewer').screenshot({path:shot});
    assert.deepEqual(errors,[]);
    console.log('PASS stairs', JSON.stringify(stairs.named));
  } finally { await browser.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });

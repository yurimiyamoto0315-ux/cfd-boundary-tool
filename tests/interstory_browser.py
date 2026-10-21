"""Verify saved interstory migration, both viewers, and EP shared boundary geometry."""
from pathlib import Path
import sys,json
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'.python-deps')]
from playwright.sync_api import sync_playwright
from pipeline import geometry,energy,idf
fixture=ROOT.parent/'261013 Test'/'AB様邸新築工事(外皮・間仕切り壁・天井3DS).3ds'
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport=dict(width=1440,height=1050));errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto((ROOT/'index.html').as_uri(),wait_until='domcontentloaded');page.wait_for_function('window.boundaryPipeline')
    page.locator('#flowCoupled').click();page.locator('#at3dsInput').set_input_files(fixture)
    page.wait_for_function('atMesh && atMesh.reviewHash')
    data=page.evaluate("""()=>{
      const before=atMesh.rooms.length;
      const old=JSON.parse(JSON.stringify(atMesh.rooms));
      for(const r of old){if(r.floor===1)r.zTop=2.956;else r.floor=3;}
      old[0].name='保持する部屋名';
      old.push({...old[0],key:'old-interstory',name:'階間',floor:2,z:2.956,zTop:3.4});
      atRestoreRoomReviewState({version:3,hash:atMesh.reviewHash,rooms:old,northDeg:0});
      return {before,after:atMesh.rooms.length,floors:[...new Set(atMesh.rooms.map(r=>r.floor))],lower:atMesh.rooms.filter(r=>r.floor===1).map(r=>r.zTop),name:atMesh.rooms[0].name};
    }""")
    assert data['before']==data['after'] and data['floors']==[1,2],data
    assert all(abs(z-3.4)<1e-5 for z in data['lower']),data
    assert data['name']=='保持する部屋名'
    assert page.locator('#atRoomViewer [data-floor="3"]').count()==0
    page.locator('#pipeBuildAt').click();page.wait_for_function("!document.getElementById('pipeBuildAt').disabled")
    assert page.locator('#pipeGhost [data-view="floor"] option').count()==3
    model=page.evaluate('boundaryPipeline.getState().model')
    assert len(model['rooms'])==data['before']
    assert all(r['floor'] in (1,2) for r in model['rooms'])
    # Also check a minimal stacked model all the way through EP object generation.
    page.evaluate("""()=>{
      const face=(z,name)=>({sslKey:name==='1F床'?'floor1':'innerwall',nameJa:name,verts:[{x:0,y:0,z},{x:4,y:0,z},{x:4,y:4,z},{x:0,y:4,z}]});
      const faces=[face(0,'1F床'),face(2.9,'内床'),face(3,'内床'),face(5.8,'天井')];
      atMesh={meshFaces:faces,rooms:atBuildRoomsFromFaces(faces,{})};
    }""")
    page.locator('#pipeBuildAt').click();page.wait_for_function("!document.getElementById('pipeBuildAt').disabled")
    model=page.evaluate('boundaryPipeline.getState().model')
    assert len(model['rooms'])==2
    model=geometry.pair_adjacent(model)
    for s in model['surfaces']:
        if s['boundary']=='Surface':s['construction']='partition'
    model['settings']['reviewed']=True
    ep,mapping,normalized=energy.build(model)
    volumes=geometry.validate(normalized)['rooms']
    assert abs(volumes[0]['volume']-48)<1e-6,volumes
    shared=[s for s in normalized['surfaces'] if s['boundary']=='Surface']
    assert len(shared)==2 and all(all(abs(p[2]-3)<1e-6 for p in s['vertices']) for s in shared)
    assert len(ep['Zone'])==2
    assert 'BuildingSurface:Detailed' in idf.serialize(ep)
    assert not errors,errors
    browser.close()
print('PASS: real 3DS restored assignments, no interstory floor in either viewer, 1F includes gap, 2 EP zones with shared floor/ceiling at 3m')

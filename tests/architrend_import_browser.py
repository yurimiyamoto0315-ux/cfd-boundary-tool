"""Real CSV/PDF/3DS import and exact exported performance, no EP simulation."""
from pathlib import Path
import sys,json,subprocess
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'.python-deps'),str(ROOT/'tests')]
from playwright.sync_api import sync_playwright
from pipeline_fixtures import single_room
fixture=ROOT.parent/'261013 Test'
server=subprocess.Popen([sys.executable,str(ROOT/'start_pipeline.py'),'--port','0','--no-browser'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
try:
    url=server.stdout.readline().strip().split('Boundary Tool: ',1)[1]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='msedge',headless=True)
        page=browser.new_page(viewport=dict(width=1440,height=1080),accept_downloads=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('dialog',lambda d:(errors.append(d.message),d.dismiss()))
        page.goto(url,wait_until='domcontentloaded');page.wait_for_function('window.boundaryPipeline')
        page.locator('#flowCoupled').click()
        page.locator('#atCsvInput').set_input_files(fixture/'シミュレートデータ.csv');page.wait_for_function('atCsvParse!==null')
        page.locator('#atPdfInput').set_input_files(fixture/'アーキトレンド温熱出力データ.pdf');page.wait_for_function('atPdfParse!==null')
        data=page.evaluate('atLastParse.result')
        assert data['validation']['windows']['crossOk'],data['validation']['windows']
        assert abs(data['uWall']-.405)<1e-6 and data['uWin']>0
        assert all(w['u']>0 for w in data['windows'])
        page.locator('#at3dsInput').set_input_files(fixture/'AB様邸新築工事(外皮・間仕切り壁・天井3DS).3ds')
        page.wait_for_function('atMesh && atMesh.reviewHash')
        page.evaluate('confirmApplyArchitrend()')
        page.locator('#pipeBuildAt').click();page.wait_for_function("!document.getElementById('pipeBuildAt').disabled",timeout=90000)
        model=page.evaluate('boundaryPipeline.getState().model');report=model['architrendImport']
        print('real import counts:',report['counts'],flush=True)
        assert report['counts']['envelope']>0 and report['counts']['windowU']>0 and report['counts']['windowSolar']>0 and report['counts']['rooms']>0,report
        assert model['constructions']['AT_Source_wall']['architrendU']==data['uWall']
        assert all(s['construction']=='partition' for s in model['surfaces'] if s['boundary']=='Surface')
        assert page.locator('#pipeAtImport').is_visible()
        page.locator('#pipeSyncAt').click()
        assert len(page.evaluate('boundaryPipeline.getState().model.constructions'))==len(model['constructions'])
        # Change values through the user's normal detailed and simple controls.
        page.locator('#pipeAdvanced').evaluate('(el)=>el.open=true')
        field=page.locator('[data-material="AT_Source_wall"][data-key="resistance"]');field.fill('7');field.press('Tab')
        page.locator('[data-setup-step="1"]').click()
        page.locator('[data-room-key="name"]').fill('手で入力した部屋');page.locator('[data-room-key="name"]').press('Tab')
        page.locator('#atCsvInput').set_input_files([])
        page.locator('#atCsvInput').set_input_files(fixture/'シミュレートデータ.csv')
        page.wait_for_function('boundaryPipeline.getState().model.architrendImport.counts.protected>0')
        assert page.evaluate('boundaryPipeline.getState().model.constructions.AT_Source_wall.resistance')==7
        assert page.evaluate('boundaryPipeline.getState().model.rooms[0].name')=='手で入力した部屋'
        page.reload(wait_until='domcontentloaded');page.wait_for_function('window.boundaryPipeline')
        assert page.evaluate('atLastParse.result.uWall')==data['uWall']
        assert page.evaluate('boundaryPipeline.getState().model.constructions.AT_Source_wall.resistance')==7
        # A geometrically valid minimal model receives the very same real parsed properties.
        minimal=single_room();minimal['source']='architrend';minimal['rooms'][0].update(sourceId='mesh-test',name='room1',floor=1)
        w=next(w for w in data['windows'] if w['id']=='G南東-1')
        minimal['openings'][0]['vertices']=[[1,0,1],[1+w['width'],0,1],[1+w['width'],0,1+w['height']],[1,0,1+w['height']]]
        idx=next(i for i,r in enumerate(data['rooms']) if r['name']=='LDK')
        page.evaluate("""args=>{atMesh={rooms:[{key:'mesh-test',pdfIndex:args.idx,name:'LDK',floor:1,area:20}],meshFaces:[]};boundaryPipeline.hydrate(args.model);boundaryPipeline.syncAtModel(true);}""",dict(idx=idx,model=minimal))
        page.locator('[data-setup-step="3"]').click();page.locator('#pipeReviewed').check()
        with page.expect_download() as item:page.locator('#pipeStart').click()
        dest=ROOT/'.test-output/architrend-model.idf';item.value.save_as(dest)
        ep=Path('C:/EnergyPlusV24-2-0/energyplus.exe')
        if ep.exists():
            run=subprocess.run([str(ep),'--convert-only','-d',str(dest.parent),str(dest)],capture_output=True,text=True)
            assert run.returncode==0,run.stdout+run.stderr
            out=json.loads(dest.with_suffix('.epJSON').read_text(encoding='utf-8'))
            assert abs(out['Material:NoMass']['AT_Source_wall__NoMass']['thermal_resistance']-(1/data['uWall']-.15))<1e-7
            assert out['WindowMaterial:SimpleGlazingSystem']['AT_Source_window_window1Glass']['u_factor']==data['uWin']
            assert out['WindowMaterial:SimpleGlazingSystem']['AT_Source_window_window1Glass']['solar_heat_gain_coefficient']==w['eta']
            assert 'visible_transmittance' not in out['WindowMaterial:SimpleGlazingSystem']['AT_Source_window_window1Glass']
        page.set_viewport_size(dict(width=390,height=844));assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+2')
        assert not errors,errors
        browser.close()
    print('PASS: real CSV/PDF/3DS automatic model import, repeated sync, manual protection, reload, exact U/solar/NoMass IDF export, mobile')
finally:
    server.terminate();server.wait(timeout=15)

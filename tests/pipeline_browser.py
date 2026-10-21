"""Browser acceptance for IDF preparation and import of an existing SQL (no EP execution).
Dev dependency: pip install playwright (or .python-deps); installed Edge is used.
"""
import csv
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.python-deps'))
from playwright.sync_api import sync_playwright

server=subprocess.Popen([sys.executable,str(ROOT/'start_pipeline.py'),'--port','0','--no-browser'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
try:
    url=server.stdout.readline().strip().split('Boundary Tool: ',1)[1]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='msedge',headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.add_init_script("if(!localStorage.getItem('seeded')){localStorage.setItem('cfdBoundaryToolState_v2',JSON.stringify({mode:'manual',inputs:{targetT:'26'},rooms:[]}));localStorage.setItem('seeded','1');}")
        page.goto(url,wait_until='domcontentloaded')
        page.wait_for_function("window.boundaryPipeline && document.querySelector('#pipeService').textContent.includes('24.2')")
        assert page.evaluate("JSON.parse(localStorage.getItem('cfdBoundaryToolState_v3')).schemaVersion") == 3
        page.locator('#flowCoupled').click()
        page.locator('#pipeSourceRhino').click()
        page.locator('#pipeSample').click()
        page.wait_for_function("boundaryPipeline.getState().model !== null")
        page.locator('#pipeValidate').click()
        page.wait_for_function("document.querySelector('#pipeValidation').classList.contains('pipe-ok')")
        assert page.locator('#pipeStart').is_enabled()
        with page.expect_download() as info: page.locator('#pipeStart').click()
        idf_path=ROOT/'.test-output'/'browser-model.idf';info.value.save_as(idf_path)
        assert 'Output:SQLite,' in idf_path.read_text(encoding='utf-8')
        assert page.evaluate('boundaryPipeline.getState().job.status')=='prepared'
        assert page.locator('#pipeSql').is_disabled()
        page.locator('#pipeSqlConfirmed').check()
        page.locator('#pipeSql').set_input_files(ROOT/'.test-output'/'single'/'eplusout.sql')
        page.wait_for_function("['complete','failed','cancelled'].includes(boundaryPipeline.getState().job?.status)",timeout=90000)
        assert page.evaluate('boundaryPipeline.getState().job.status')=='complete',page.locator('#pipeJobStatus').inner_text()
        page.wait_for_function("document.querySelector('#pipeResults tbody tr') !== null")
        assert page.locator('#pipeTimeSelect option').count()==8760
        for key in ('supplyM3h','returnM3h'):
            page.locator('[data-flow-room="room1"][data-key="'+key+'"]').fill('500')
            page.locator('[data-flow-room="room1"][data-key="'+key+'"]').press('Tab')
        with page.expect_download() as info:page.locator('#pipeDownload').click()
        path=ROOT/'.test-output'/'browser-cfd.zip';info.value.save_as(path)
        with zipfile.ZipFile(path) as z:
            rows=list(csv.DictReader(io.StringIO(z.read('surface_map.csv').decode('utf-8-sig'))))
            gains=list(csv.DictReader(io.StringIO(z.read('gain_map.csv').decode('utf-8-sig'))))
            colors=list(dict.fromkeys(r['RGB'] for r in rows+gains))
            cats='\n'.join('#'+''.join(format(int(x),'02x') for x in color.split())+','+str(i+1) for i,color in enumerate(colors))
        catpath=ROOT/'.test-output'/'browser-categories.csv';catpath.write_text(cats,encoding='cp932')
        page.locator('#pipeCategory').set_input_files(catpath)
        with page.expect_download() as info:page.locator('#pipeDownload').click()
        info.value.save_as(ROOT/'.test-output'/'browser-cfd-with-params.zip')
        with zipfile.ZipFile(ROOT/'.test-output'/'browser-cfd-with-params.zip') as z:assert 'objParam.csv' in z.namelist()
        page.locator('#pipeHeatPeak').click();page.locator('#pipeTimeSelect').select_option('0')
        assert page.evaluate('boundaryPipeline.getState().index')==0
        page.screenshot(path=ROOT/'.test-output'/'pipeline-complete.png',full_page=True)
        page.locator('#pipeAdvanced').evaluate('(el)=>el.open=true')
        page.locator('#pipeCooling').fill('28');page.locator('#pipeCooling').press('Tab')
        assert page.locator('#pipeDownload').is_disabled()
        page.reload(wait_until='domcontentloaded')
        page.wait_for_function('window.boundaryPipeline !== undefined')
        assert page.evaluate('boundaryPipeline.stale()')
        assert page.locator('#pipeDownload').is_disabled()
        page.locator('#flowCfd').click()
        assert page.locator('#modeTabs').is_visible()
        assert page.locator('#pipelinePanel').is_hidden()
        page.locator('[data-mode="energyplus"]').click()
        assert page.locator('#epPanel').is_visible()
        # Same model through ARCHITREND's room adapter: compare volume and opening area.
        page.locator('#flowCoupled').click();page.locator('#pipeSourceAt').click()
        page.evaluate("""atMesh={rooms:[{key:'r1',name:'AB test',z:0,zTop:3,area:20,habitable:true,ring:[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:0,y:4}]}],meshFaces:[{kind:'window',sslKey:'window',verts:[{x:1,y:0,z:1},{x:3,y:0,z:1},{x:3,y:0,z:2},{x:1,y:0,z:2}]}]};""")
        page.evaluate('boundaryPipeline.buildAt()')
        model=page.evaluate('boundaryPipeline.getState().model')
        assert len(model['rooms'])==1 and len(model['surfaces'])==6 and len(model['openings'])==1
        assert '60.00' in page.locator('#pipeGeometrySummary').inner_text()
        # Mobile layout must not push the entire document beyond the viewport.
        page.set_viewport_size({'width':390,'height':844})
        page.locator('#pipeSourceRhino').click()
        page.screenshot(path=ROOT/'.test-output'/'pipeline-mobile.png',full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+2'),page.evaluate("Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>innerWidth+2 && e.getBoundingClientRect().width>0).map(e=>({tag:e.tagName,id:e.id,cls:e.className,width:e.getBoundingClientRect().width})).slice(0,20)")
        assert not errors,errors
        browser.close()
    print('PASS browser: migration, modes, model import, IDF download, existing SQL import, time selection, export, stale guard, ARCHITREND adapter, mobile')
finally:
    server.terminate()
    server.wait(timeout=15)

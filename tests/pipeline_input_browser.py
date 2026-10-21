"""Regression: click the actual import button, including direct file:// startup."""
from pathlib import Path
import subprocess, sys, json
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'.python-deps'),str(ROOT)]
from playwright.sync_api import sync_playwright
from pipeline.energy import defaults
bundled=(ROOT/'js/23-pipeline-defaults.js').read_text(encoding='utf-8').split('window.boundaryPipelineDefaults = ',1)[1].strip().removesuffix(';')
assert json.loads(bundled)==defaults(), 'Browser defaults must match server defaults'
mesh="""atMesh={rooms:[{key:'r1',name:'Room',z:0,zTop:3,area:20,habitable:true,ring:[{x:0,y:0},{x:5,y:0},{x:5,y:4},{x:0,y:4}]}],meshFaces:[]};"""
server=subprocess.Popen([sys.executable,str(ROOT/'start_pipeline.py'),'--port','0','--no-browser'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
try:
    url=server.stdout.readline().strip().split('Boundary Tool: ',1)[1]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='msedge',headless=True)
        for address in ((ROOT/'index.html').as_uri(),url):
            context=browser.new_context()
            page=context.new_page(); errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(address,wait_until='domcontentloaded')
            page.wait_for_function('window.boundaryPipeline !== undefined')
            page.locator('#flowCoupled').click()
            page.locator('#pipeBuildAt').click()
            assert '3DS本体' in page.locator('#pipeInputStatus').inner_text()
            assert page.locator('#pipeInputStatus').is_visible()
            page.evaluate(mesh)
            page.locator('#pipeBuildAt').click()
            page.wait_for_function("!document.getElementById('pipeBuildAt').disabled")
            assert page.locator('#pipePreview polygon').count()==6
            assert page.evaluate('boundaryPipeline.getState().model.rooms.length')==1
            if address.startswith('file:'):
                assert 'BoundaryTool.vbs' in page.locator('#pipeInputStatus').inner_text()
                assert page.locator('#pipeStart').is_disabled()
                with page.expect_download() as item:page.locator('#pipeSaveModel').evaluate('(el)=>el.click()')
                assert item.value.suggested_filename.endswith('.json')
            else:
                assert '部屋候補を作成しました' in page.locator('#pipeInputStatus').inner_text()
                assert '60.00' in page.locator('#pipeGeometrySummary').inner_text()
            page.evaluate('atMesh.rooms[0].zTop=0')
            page.locator('#pipeBuildAt').click()
            assert '高さが不正' in page.locator('#pipeInputStatus').inner_text()
            assert page.locator('#pipePreview polygon').count()==6
            assert not errors,errors
            context.close()
        browser.close()
    print('PASS: direct HTML and service startup, missing 3DS, candidate preview, JSON save, invalid height, defaults parity')
finally:
    server.terminate();server.wait(timeout=15)

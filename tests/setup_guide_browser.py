"""Illustrated setup → shared model → IDF, without running a simulation."""
from pathlib import Path
import json,subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'.python-deps'),str(ROOT/'tests')]
from playwright.sync_api import sync_playwright
from pipeline_fixtures import single_room
m=single_room();m['constructions']['wall']['layers'][1]['thickness']=.15;m['constructions']['window']['visibleTransmittance']=.42
server=subprocess.Popen([sys.executable,str(ROOT/'start_pipeline.py'),'--port','0','--no-browser'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
try:
    url=server.stdout.readline().strip().split('Boundary Tool: ',1)[1]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='msedge',headless=True)
        page=browser.new_page(viewport=dict(width=1440,height=1080),accept_downloads=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(url,wait_until='domcontentloaded');page.wait_for_function('window.boundaryPipeline')
        page.evaluate('(m)=>{boundaryPipeline.setWorkflow("coupled");boundaryPipeline.hydrate(m);}',m)
        page.wait_for_function("document.getElementById('pipeService').textContent.includes('接続済み')")
        initial=page.evaluate('boundaryPipeline.getState().model')
        assert not page.locator('#pipeAdvanced').evaluate('(el)=>el.open')
        for step in [1,2,3,0]:page.locator(f'[data-setup-step="{step}"]').click()
        assert page.evaluate('boundaryPipeline.getState().model')==initial,'Navigation must not rewrite existing input'
        assert page.locator('#pipeSetup img').count()==5
        assert page.locator('#pipeSetup img').evaluate_all('(els)=>els.every(e=>e.complete&&e.naturalWidth>0)')
        page.locator('[data-thickness="wall"]').select_option('200');page.locator('[data-envelope="wall"]').click()
        page.locator('[data-window="u"]').fill('2.8');page.locator('[data-envelope="window"]').click()
        new=page.evaluate('boundaryPipeline.getState().model')
        assert new['constructions']['Guide_wall']['layers'][1]['thickness']==.2
        assert new['constructions']['wall']['layers'][1]['thickness']==.15
        assert new['constructions']['Guide_window']['visibleTransmittance']==.42
        assert all(s['construction']=='Guide_wall' for s in new['surfaces'] if s['type']=='Wall')
        page.locator('#pipeSetup').screenshot(path=str(ROOT/'.test-output/setup-envelope.png'),style='.app-chrome{visibility:hidden!important}')
        page.locator('[data-setup-step="1"]').click();page.locator('[data-room-example="living"]').click()
        page.locator('[data-room-key="name"]').fill('リビング');page.locator('[data-room-key="name"]').press('Tab')
        page.locator('[data-room-key="people"]').fill('3');page.locator('[data-room-key="people"]').press('Tab')
        page.locator('[data-setup-step="2"]').click();page.locator('[data-living="away"]').click()
        page.locator('#setupHeating').fill('21');page.locator('#setupHeating').press('Tab')
        page.locator('#setupCooling').fill('28');page.locator('#setupCooling').press('Tab')
        page.locator('#setupHvac').select_option('morningEvening')
        page.locator('#pipeSetup').screenshot(path=str(ROOT/'.test-output/setup-living.png'),style='.app-chrome{visibility:hidden!important}')
        new=page.evaluate('boundaryPipeline.getState().model')
        assert new['settings']['heating']==21 and new['settings']['cooling']==28
        assert sum(new['settings']['hvacSchedule'])==10
        assert new['rooms'][0]['people']==3 and new['rooms'][0]['lightsWm2']==5
        assert new['rooms'][0]['name']=='リビング'
        assert new['settings']['reviewed']==False
        page.locator('#pipeStart').click()
        assert page.locator('[data-setup-step="3"]').get_attribute('aria-current')=='step'
        assert not page.locator('#pipeReviewed').is_checked()
        page.locator('[data-setup-step="3"]').click();assert '3人' in page.locator('#setupSummary').inner_text()
        page.locator('#pipeReviewed').check();page.locator('#setupToSave').click()
        with page.expect_download() as item:page.locator('#pipeStart').click()
        dest=ROOT/'.test-output/setup-model.idf';item.value.save_as(dest)
        # Check exact exported fields using the official converter, without creating SQL.
        ep=Path('C:/EnergyPlusV24-2-0/energyplus.exe')
        if ep.exists():
            proc=subprocess.run([str(ep),'--convert-only','-d',str(dest.parent),str(dest)],capture_output=True,text=True)
            assert proc.returncode==0,proc.stdout+proc.stderr
            out=json.loads(dest.with_suffix('.epJSON').read_text(encoding='utf-8'))
            assert out['People']['Z1People']['number_of_people']==3
            assert out['Lights']['Z1Lights']['watts_per_floor_area']==5
            assert out['Schedule:Constant']['HeatSetpoint']['hourly_value']==21
            assert out['Material']['Guide_wall__L1']['thickness']==.2
        page.reload(wait_until='domcontentloaded');page.wait_for_function('window.boundaryPipeline')
        assert page.evaluate('boundaryPipeline.getState().model.settings.heating')==21
        page.set_viewport_size(dict(width=390,height=844))
        for step in range(4):
            page.locator(f'[data-setup-step="{step}"]').click()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+2'),step
        assert not errors,errors
        browser.close()
    print('PASS: illustrated 4-step setup, preserve custom values, envelope/room/lifestyle edits, exact IDF output, reload, mobile')
finally:
    server.terminate();server.wait(timeout=15)

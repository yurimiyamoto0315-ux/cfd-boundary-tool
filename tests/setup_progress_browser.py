"""Missing-only setup using the directly opened HTML, with saved per-field review."""
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'.python-deps'),str(ROOT/'tests')]
from playwright.sync_api import sync_playwright
from pipeline_fixtures import single_room
m=single_room();m['source']='architrend';m['settings']['reviewed']=False
m['rooms'][0].update(sourceId='mesh1',name='room1',floor=1)
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport=dict(width=1440,height=1080));errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto((ROOT/'index.html').as_uri(),wait_until='domcontentloaded');page.wait_for_function('window.boundaryPipeline')
    page.evaluate("""m=>{
      applyArchitrendToBoundaryModel(m,{uWall:.405,uRoof:.218,windows:[{id:'G1',width:2,height:1,floor:'1',u:2,uSource:'CSV概算'}],rooms:[{name:'LDK',area:20,floor:'1',type:'A'}],sources:{uWall:'PDF p.1',uRoof:'PDF p.1',rooms:'PDF p.9'}},{fresh:true,rooms:[{key:'mesh1',name:'LDK',area:20,floor:1,pdfIndex:0}],roomValues:{mesh1:{people:3,equipmentW:100}}});
      boundaryPipeline.setWorkflow('coupled');boundaryPipeline.hydrate(m);
    }""",m)
    assert page.locator('#setupOnlyPending').is_checked()
    assert page.locator('[data-setup-count="imported"]').inner_text()=='4'
    assert page.locator('[data-setup-count="provided"]').inner_text()=='2'
    page.locator('#setupCompletedTitle').click()
    assert 'PDF p.1' in page.locator('#setupCompletedList').inner_text()
    page.locator('#setupCompletedTitle').click()
    initial=page.evaluate('boundaryPipeline.getState().model')
    page.locator('#setupTaskSelect').select_option('window:window1')
    assert page.locator('#setupTaskFields input').count()==1
    assert 'SHGC' in page.locator('#setupTaskFields').inner_text()
    assert 'CSV概算' in page.locator('#setupTaskRead').inner_text()
    assert 'U値' in page.locator('#setupTaskRead').inner_text()
    page.locator('#setupTaskField0').fill('.35');page.locator('#setupConfirmTask').click()
    assert page.locator('#setupTaskSelect').input_value()=='room:room1','Confirm then move to next remaining task'
    room_text=page.locator('#setupTaskFields').inner_text()
    assert '何人が使う' not in room_text and '部屋の名前' not in room_text
    assert '照明' in room_text and '外気' in room_text
    assert page.locator('#setupTaskFields input').count()==3
    page.locator('#setupConfirmTask').click()
    assert page.locator('#setupTaskError').inner_text()==''
    state=page.evaluate('boundaryPipeline.getState().model')
    assert state['rooms']==initial['rooms'],'Confirming defaults must not overwrite the room'
    assert state['constructions'][state['openings'][0]['construction']]['u']==2
    assert state['constructions'][state['openings'][0]['construction']]['shgc']==.35
    assert page.evaluate("boundarySetupTasks(boundaryPipeline.getState().model).find(t=>t.id==='room:room1').pending.length")==0
    page.reload(wait_until='domcontentloaded');page.wait_for_function('window.boundaryPipeline')
    assert page.evaluate("boundarySetupTasks(boundaryPipeline.getState().model).find(t=>t.id==='room:room1').pending.length")==0
    assert page.evaluate("boundarySetupTasks(boundaryPipeline.getState().model).find(t=>t.id==='window:window1').pending.length")==0
    page.locator('[data-setup-step="1"]').click()
    assert '資料から入力済み' in page.locator('#setupRoom').inner_text()
    page.locator('[data-room-key="ventilationACH"]').fill('.8');page.locator('[data-room-key="ventilationACH"]').press('Tab')
    page.locator('#setupOnlyPending').check();page.locator('#setupTaskSelect').select_option('room:room1')
    assert page.locator('#setupTaskFields input').count()==1
    assert '外気' in page.locator('#setupTaskFields').inner_text()
    # Reject an invalid input instead of marking it complete.
    page.locator('#setupTaskField0').fill('-1');page.locator('#setupConfirmTask').click()
    assert '値を確認' in page.locator('#setupTaskError').inner_text()
    page.locator('#setupTaskField0').fill('.8');page.locator('#setupConfirmTask').click()
    page.locator('#setupTaskSelect').select_option('assumptions');before_details=page.evaluate('boundaryPipeline.getState().model')
    page.locator('#setupTaskDetails').click()
    assert page.locator('#pipeAdvanced').evaluate('(el)=>el.open')
    assert page.evaluate('boundaryPipeline.getState().model')==before_details
    page.locator('#setupTaskSelect').select_option('living')
    page.locator('#pipeSetup').screenshot(path=str(ROOT/'.test-output/setup-progress.png'),style='.app-chrome{visibility:hidden!important}')
    page.set_viewport_size(dict(width=390,height=844))
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+2')
    page.locator('#pipeSetup').screenshot(path=str(ROOT/'.test-output/setup-progress-mobile.png'),style='.app-chrome{visibility:hidden!important}')
    # Finish all valid current values, one pending group at a time.
    guard=0
    while page.locator('#setupConfirmTask').is_visible():
        page.locator('#setupConfirmTask').click();guard+=1
        assert not page.locator('#setupTaskError').inner_text(),page.locator('#setupTaskError').inner_text()
        assert guard<30
    assert page.locator('[data-setup-count="pending"]').inner_text()=='0'
    page.locator('#setupQueueReview').click();assert page.locator('#pipeReviewed').is_visible()
    page.locator('#pipeReviewed').check();assert page.evaluate('boundaryPipeline.getState().model.settings.reviewed')
    assert not errors,errors
    browser.close()
print('PASS: file HTML, source badges, U-only import, only missing room fields, next task, persisted confirmations, single-field recheck, validation, completion, mobile')

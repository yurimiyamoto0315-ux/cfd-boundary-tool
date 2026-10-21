from pathlib import Path
import sys,copy
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'.python-deps'),str(ROOT/'tests')]
from playwright.sync_api import sync_playwright
from pipeline_fixtures import single_room,room_box
m=single_room();m['rooms']=[];m['surfaces']=[];m['openings']=[]
for i in range(26):
    rid='zone'+str(i);m['rooms'].append(dict(id=rid,name=f'{i//13+1}F Room {i%13+1}',conditioned=True,people=1,equipmentW=100,ventilationACH=.5))
    faces=room_box(rid,(i%13%4)*5)
    for f in faces:
        for p in f['vertices']:p[1]+=(i%13//4)*4;p[2]+=(i//13)*3
    m['surfaces']+=faces
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport=dict(width=1440,height=1050));errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto((ROOT/'index.html').as_uri(),wait_until='domcontentloaded');page.wait_for_function('window.boundaryPipeline')
    page.evaluate('(m)=>{boundaryPipeline.setWorkflow("coupled");boundaryPipeline.hydrate(m);}',m)
    svg=page.locator('#pipePreview');svg.scroll_into_view_if_needed()
    assert svg.locator('polygon').count()==156
    old=svg.locator('polygon').first.get_attribute('points')
    box=svg.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+70,y+40,steps=5);page.mouse.up()
    assert old!=svg.locator('polygon').first.get_attribute('points')
    old=svg.locator('polygon').first.get_attribute('points');page.mouse.wheel(0,-200)
    page.wait_for_timeout(100);assert old!=svg.locator('polygon').first.get_attribute('points')
    page.locator('[data-zone-button="zone4"]').click();page.locator('[data-view="isolate"]').check()
    assert svg.locator('polygon').count()==6
    page.locator('[data-view="all"]').click();page.locator('[data-view="floor"]').select_option('3')
    assert svg.locator('polygon').count()==78
    page.locator('[data-view="roof"]').uncheck();assert svg.locator('polygon').count()==65
    page.locator('[data-view="all"]').click();page.locator('[data-view="roof"]').check()
    page.locator('#pipeGhost').screenshot(path=str(ROOT/'.test-output/ghost-zones.png'))
    page.locator('[data-zone-button="zone4"]').click();page.locator('[data-view="isolate"]').check()
    svg.scroll_into_view_if_needed()
    pos=svg.locator('polygon').last.evaluate("el=>{const ps=Array.from(el.points);const p=new DOMPoint(ps.reduce((s,p)=>s+p.x,0)/ps.length,ps.reduce((s,p)=>s+p.y,0)/ps.length).matrixTransform(el.getScreenCTM());return {x:p.x,y:p.y};}")
    page.mouse.dblclick(pos['x'],pos['y'],delay=70)
    assert page.locator('#pipeFaceEditor').is_visible()
    page.set_viewport_size(dict(width=390,height=844));assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+2'),page.evaluate("Array.from(document.querySelectorAll('div,section,aside,label,button,svg')).filter(e=>e.getBoundingClientRect().right>innerWidth+2).map(e=>[e.id,e.className,e.getBoundingClientRect().width,e.outerHTML.slice(0,300)]).slice(0,4)")
    assert not errors,errors
    browser.close()
print('PASS 26 zones: orbit, zoom, selection, isolate, floor filter, roof, face editing, mobile')

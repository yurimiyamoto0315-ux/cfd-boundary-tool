"""Generate fixtures and run real EnergyPlus, then the regression suite."""
from pathlib import Path
import json
import os
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'.python-deps')]
from pipeline.energy import build
from pipeline_fixtures import single_room,two_rooms

ep=Path(os.environ.get('BOUNDARY_ENERGYPLUS',r'C:\EnergyPlusV24-2-0\energyplus.exe'))
weather=Path(os.environ.get('BOUNDARY_TEST_EPW',str(ep.parent/'WeatherData'/'USA_CA_San.Francisco.Intl.AP.724940_TMY3.epw')))
(ROOT/'samples').mkdir(exist_ok=True)
(ROOT/'.test-output').mkdir(exist_ok=True)
for name,fixture in [('single',single_room),('two',two_rooms)]:
    model=fixture(); content,mapping,_=build(model)
    (ROOT/'samples'/('single-room.json' if name=='single' else 'two-rooms.json')).write_text(json.dumps(model,ensure_ascii=False,indent=2),encoding='utf-8')
    path=ROOT/'.test-output'/(name+'.epJSON')
    path.write_text(json.dumps(content),encoding='utf-8')
    with (ROOT/'.test-output'/(name+'-console.txt')).open('w',encoding='utf-8') as out:
        subprocess.run([str(ep),'-w',str(weather),'-d',str(ROOT/'.test-output'/name),str(path)],stdout=out,stderr=subprocess.STDOUT,check=True,timeout=180)
    print('PASS real EP annual: '+name,flush=True)
subprocess.run([sys.executable,str(ROOT/'tests'/'test_pipeline.py'),'-v'],check=True)

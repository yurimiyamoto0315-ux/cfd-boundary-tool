import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT/'.python-deps')]
from pipeline import energy, idf
from pipeline_fixtures import single_room, two_rooms


class IdfTests(unittest.TestCase):
    def test_positional_and_nameless_objects(self):
        ep, _, _ = energy.build(single_room())
        text = idf.serialize(ep)
        self.assertIn('Output:SQLite,\n  SimpleAndTabular,', text)
        self.assertIn('Version,\n  24.2;', text)
        self.assertIn('  4,  !- number_of_vertices', text)
        self.assertIn('  Z1,  !- zone_name', text)

    def test_unknown_fields_and_delimiters_rejected(self):
        with self.assertRaises(ValueError):
            idf.serialize({'Zone': {'bad!name': {}}})
        with self.assertRaises(ValueError):
            idf.serialize({'Zone': {'Z': {'typo': 1}}})

    @unittest.skipUnless(Path('C:/EnergyPlusV24-2-0/energyplus.exe').exists(), '24.2 converter unavailable')
    def test_official_converter_roundtrip_without_simulation(self):
        # Conversion only: do not run a simulation or create SQL.
        for model in (single_room(), two_rooms()):
            model['settings'].update(hvacMode='season',heatingPeriods=[dict(startMonth=1,startDay=1,endMonth=4,endDay=16)],coolingPeriods=[dict(startMonth=5,startDay=6,endMonth=10,endDay=18)])
            model['rooms'][0].update(lightsWm2=5,equipmentWm2=3,infiltrationACH=.1)
            model['constructions']['door']={'kind':'nomass','resistance':.4}
            ep, _, _ = energy.build(model)
            with tempfile.TemporaryDirectory() as tmp:
                source=Path(tmp)/'model.idf';source.write_text(idf.serialize(ep),encoding='utf-8')
                proc=subprocess.run(['C:/EnergyPlusV24-2-0/energyplus.exe','--convert-only','-d',tmp,str(source)],capture_output=True,text=True)
                self.assertEqual(proc.returncode,0,proc.stdout+proc.stderr)
                actual=json.loads(source.with_suffix('.epJSON').read_text(encoding='utf-8'))
                for kind, objects in ep.items():
                    # Nameless objects get new generated keys on conversion.
                    named='name' in idf.LAYOUT[kind]['fields']
                    for i,(name, fields) in enumerate(objects.items()):
                        candidate=actual[kind][name] if named else list(actual[kind].values())[i]
                        for field,value in fields.items():
                            self.assertEqual(candidate[field],value,(kind,name,field))


if __name__ == '__main__':
    unittest.main()

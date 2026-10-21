import copy
import io
import json
from pathlib import Path
import sys
import unittest
import zipfile
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT),str(ROOT/'.python-deps')]
from pipeline.geometry import validate,triangles,polygon,normalize,pair_adjacent
from pipeline.energy import build,extract,availability_segments,reference_u
from pipeline.cfd import export_bundle
from pipeline_fixtures import single_room,two_rooms,room_box


class GeometryTests(unittest.TestCase):
    def test_closed_room_units_and_volume(self):
        m=single_room(); check=validate(m)
        self.assertEqual(check['errors'],[])
        self.assertAlmostEqual(check['rooms'][0]['volume'],60)
        self.assertAlmostEqual(check['rooms'][0]['floorArea'],20)
        m['units']='mm'
        for key in ('surfaces','openings'):
            for s in m[key]: s['vertices']=[[x*1000 for x in p] for p in s['vertices']]
        self.assertAlmostEqual(validate(m)['rooms'][0]['volume'],60)

    def test_missing_face_and_reversed_face(self):
        m=single_room();m['surfaces'].pop();self.assertFalse(validate(m)['valid'])
        m=single_room();m['surfaces'][0]['vertices'].reverse();self.assertFalse(validate(m)['valid'])

    def test_window_outside_and_hole_mesh_area(self):
        m=single_room();s=m['surfaces'][2];w=m['openings'][0]
        area=sum(polygon(t).area for t in triangles(s['vertices'],[w['vertices']]))
        self.assertAlmostEqual(area,13)
        w['vertices'][0][0]=-2;self.assertFalse(validate(m)['valid'])

    def test_diagonal_sloped_and_two_storey(self):
        m=single_room()
        for key in ('surfaces','openings'):
            for s in m[key]:
                s['vertices']=[[p[0]+.3*p[1],p[1],p[2]+(.2*p[0] if p[2]==3 else 0)] for p in s['vertices']]
        self.assertTrue(validate(m)['valid'])
        m=two_rooms();self.assertTrue(validate(m)['valid'])
        shared=[s for s in m['surfaces'] if s['boundary']=='Surface'];self.assertEqual(len(shared),2)
        shared[0]['adjacentSurfaceId']='missing';self.assertFalse(validate(m)['valid'])
        m=single_room()
        m['rooms'].append(dict(m['rooms'][0],id='upstairs'))
        upper=room_box('upstairs')
        for s in upper:
            for p in s['vertices']:p[2]+=3
        m['surfaces']+=upper
        m=pair_adjacent(m)
        check=validate(m)
        self.assertEqual(check['errors'],[])
        self.assertEqual({s['type'] for s in m['surfaces'] if s['boundary']=='Surface'},{'Roof','Floor'})
        self.assertTrue(all(abs(r['volume']-60)<1e-7 for r in check['rooms']))

    def test_idf_objects_use_construction_names_and_room_loads(self):
        plain=single_room()
        ep,_,_=build(plain)
        self.assertEqual(ep['Construction']['wall']['outside_layer'],'wall__L0')
        self.assertEqual(ep['Material']['wall__L0']['solar_absorptance'],.7)
        self.assertIn('OtherEquipment',ep)
        self.assertNotIn('Lights',ep)
        self.assertNotIn('ZoneInfiltration:DesignFlowRate',ep)
        self.assertNotIn('heating_availability_schedule_name', ep['ZoneHVAC:IdealLoadsAirSystem']['Z1Ideal'])
        wall=plain['constructions']['wall']['layers']
        # 0.012/0.14 + 0.10/0.04 + 0.0125/0.22
        perf=reference_u(plain['constructions']['wall'])
        self.assertAlmostEqual(perf['r'], wall[0]['thickness']/wall[0]['conductivity']+wall[1]['thickness']/wall[1]['conductivity']+wall[2]['thickness']/wall[2]['conductivity'])
        self.assertAlmostEqual(perf['uOut'], 1/(perf['r']+.15))
        m=single_room()
        m['constructions']['OW1']={'label':'外壁','layers':[{'name':'OuterWall','thickness':.1295,'conductivity':.055,'density':100,'specificHeat':1000,'thermalAbsorptance':.9,'solarAbsorptance':.7,'visibleAbsorptance':.7}]}
        m['constructions']['D1']={'label':'ドア','kind':'nomass','resistance':.4291845493562232,'cfdMaterial':'2杉(1)','cfdThickness':.04}
        m['constructions']['WindowConst1']={'label':'窓','u':.82,'shgc':.24,'visibleTransmittance':.433}
        m['surfaces'][2]['construction']='OW1'
        m['openings'][0]['construction']='WindowConst1'
        room=m['rooms'][0]
        room.update(lightsWm2=7, equipmentW=100, equipmentWm2=4.01, infiltrationACH=.2)
        m['settings'].update(lightsSchedule=[1]*24, infiltrationSchedule=[1]*24, hvacMode='season', heating=24, cooling=26,
            heatingPeriods=[{'startMonth':1,'startDay':1,'endMonth':4,'endDay':16},{'startMonth':11,'startDay':9,'endMonth':12,'endDay':31}],
            coolingPeriods=[{'startMonth':5,'startDay':6,'endMonth':10,'endDay':18}],
            maxHeatingSupply=50, minCoolingSupply=13, maxHeatingHumidity=.0156, minCoolingHumidity=.0077, coolingSHR=.7,
            equipmentRadiant=0, lightsRadiant=0)
        ep,_,_=build(m)
        self.assertEqual(ep['Construction']['OW1']['outside_layer'],'OW1__OuterWall')
        self.assertAlmostEqual(ep['Material']['OW1__OuterWall']['thickness']/.055,.1295/.055)
        self.assertAlmostEqual(reference_u(m['constructions']['OW1'])['uOut'], 1/(.1295/.055+.15))
        self.assertAlmostEqual(ep['Material:NoMass']['D1__NoMass']['thermal_resistance'],.4291845493562232)
        self.assertAlmostEqual(ep['WindowMaterial:SimpleGlazingSystem']['WindowConst1Glass']['u_factor'],.82)
        self.assertEqual(ep['BuildingSurface:Detailed']['S3']['construction_name'],'OW1')
        self.assertEqual(ep['FenestrationSurface:Detailed']['W1']['construction_name'],'WindowConst1')
        self.assertEqual(ep['Lights']['Z1Lights']['watts_per_floor_area'],7)
        self.assertEqual(ep['ElectricEquipment']['Z1Equipment']['watts_per_floor_area'],4.01)
        self.assertNotIn('OtherEquipment',ep)
        self.assertEqual(ep['ZoneInfiltration:DesignFlowRate']['Z1Infiltration']['air_changes_per_hour'],.2)
        ideal=ep['ZoneHVAC:IdealLoadsAirSystem']['Z1Ideal']
        self.assertEqual(ideal['heating_availability_schedule_name'],'HeatingAvail')
        self.assertEqual(ideal['cooling_availability_schedule_name'],'CoolingAvail')
        self.assertEqual(ideal['maximum_heating_supply_air_temperature'],50)
        self.assertEqual(ideal['cooling_sensible_heat_ratio'],.7)
        self.assertEqual(ideal['dehumidification_control_type'],'ConstantSensibleHeatRatio')
        heat=[(w['start_month'],w['start_day'],w['end_month'],w['end_day'],w['schedule_week_name']) for w in ep['Schedule:Year']['HeatingAvail']['schedule_weeks']]
        self.assertEqual(heat,[(1,1,4,16,'HeatingAvailOnWeek'),(4,17,11,8,'HeatingAvailOffWeek'),(11,9,12,31,'HeatingAvailOnWeek')])
        cool=[(w['start_month'],w['start_day'],w['end_month'],w['end_day']) for w in ep['Schedule:Year']['CoolingAvail']['schedule_weeks']]
        self.assertEqual(cool,[(1,1,5,5),(5,6,10,18),(10,19,12,31)])
        self.assertEqual(availability_segments(m['settings']['heatingPeriods'])[0],(1,106,1))
        with self.assertRaises(ValueError):
            build(dict(m, settings=dict(m['settings'], heatingPeriods=[{'startMonth':1,'startDay':1,'endMonth':6,'endDay':1},{'startMonth':5,'startDay':1,'endMonth':12,'endDay':31}])))

    def test_thermal_missing_material_and_bad_schedule(self):
        m=single_room();m['surfaces'][0]['construction']='missing'
        with self.assertRaises(ValueError):build(m)
        m=single_room();m['settings']['peopleSchedule']=[1]*23
        with self.assertRaises(ValueError):build(m)
        m=single_room();m['settings']['reviewed']=False
        with self.assertRaises(ValueError):build(m)

    def test_partial_adjacency_splits_and_preserves_volume(self):
        m=two_rooms()
        for s in m['surfaces']:
            s.pop('adjacentSurfaceId',None)
            if s['boundary']=='Surface':s['boundary']='Outdoors'
            if s['roomId']=='room2':
                for p in s['vertices']:p[1]+=2
        paired=pair_adjacent(m)
        check=validate(paired)
        self.assertEqual(check['errors'],[])
        self.assertEqual(len([s for s in paired['surfaces'] if s['boundary']=='Surface']),2)
        self.assertTrue(all(abs(r['volume']-60)<1e-7 for r in check['rooms']))


class RealEnergyPlusTests(unittest.TestCase):
    def results(self,name,model):
        path=ROOT/'.test-output'/name/'eplusout.sql'
        if not path.exists():self.skipTest('Run the EnergyPlus acceptance fixtures first')
        _,mapping,normalized=build(model)
        return normalized,extract(path,mapping,normalized)

    def test_single_year_and_cfd_snapshot(self):
        model,result=self.results('single',single_room())
        self.assertEqual(len(result['times']),8760)
        self.assertEqual(len(result['surfaces']),7)
        i=max(range(8760),key=lambda i:result['rooms']['room1']['cooling'][i])
        flows={'room1':{'supplyM3h':500,'returnM3h':500,'outdoorM3h':30,'exhaustM3h':30,'supplyTemperature':18}}
        data=export_bundle(model,result,i,flows)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            self.assertEqual(z.read('ep_cfd.3ds')[:2],b'MM')
            snap=json.loads(z.read('snapshot.json'))
            self.assertEqual(snap['surfaces']['window1'],result['surfaces']['window1'][i])
            self.assertNotIn('objParam.csv',z.namelist())
            self.assertEqual(len(z.read('surface_map.csv').decode('utf-8-sig').splitlines()),8)
        with self.assertRaises(ValueError):export_bundle(model,result,i,{'room1':{'supplyM3h':100,'returnM3h':0}})
        flows['room1']['outdoorM3h']=0;flows['room1']['exhaustM3h']=0
        with self.assertRaises(ValueError):export_bundle(model,result,i,flows)

    def test_two_room_result_and_material_only_shared_wall(self):
        model,result=self.results('two',two_rooms())
        self.assertEqual(len(result['rooms']),2)
        self.assertTrue(all(x==0 for x in result['rooms']['room2']['cooling']))
        flows={'room1':{'supplyM3h':500,'returnM3h':500,'outdoorM3h':30,'exhaustM3h':30,'supplyTemperature':30},'room2':{}}
        bundle=export_bundle(model,result,0,flows)
        import csv
        with zipfile.ZipFile(io.BytesIO(bundle)) as z:
            rows=list(csv.DictReader(io.StringIO(z.read('surface_map.csv').decode('utf-8-sig'))))
            inner=[r for r in rows if r['boundaryMode']=='material_thickness']
            self.assertEqual(len(inner),2)
            self.assertEqual(len({r['3DS name'] for r in inner}),1)
            self.assertTrue(all(r['temperature_C']=='' for r in inner))
            gain=list(csv.DictReader(io.StringIO(z.read('gain_map.csv').decode('utf-8-sig'))))
            colors=list(dict.fromkeys(r['RGB'] for r in rows+gain))
            cats='\n'.join('#'+''.join(format(int(x),'02x') for x in color.split())+','+str(i+1) for i,color in enumerate(colors))
            shared_id=colors.index(inner[0]['RGB'])+1
        with zipfile.ZipFile(io.BytesIO(export_bundle(model,result,0,flows,cats))) as z:
            params=list(csv.reader(io.StringIO(z.read('objParam.csv').decode('cp932'))))
            shared=[p for p in params if p[0]==str(shared_id)]
            self.assertIn([str(shared_id),'23','厚みを考慮'],shared)
            self.assertFalse(any(p[1]=='55' for p in shared))
            self.assertTrue(any(p[1]=='27' for p in shared))


if __name__=='__main__':unittest.main()

"""EnergyPlus 24.2 epJSON generation and SQL extraction."""
import math
import sqlite3
from .geometry import validate, fingerprint

VARIABLES = {
    'surfaceTemperature':'Surface Inside Face Temperature',
    'airTemperature':'Zone Mean Air Temperature',
    'cooling':'Zone Ideal Loads Zone Sensible Cooling Rate',
    'heating':'Zone Ideal Loads Zone Sensible Heating Rate',
    'convectiveGain':'Zone Total Internal Convective Heating Rate',
    'latentGain':'Zone Total Internal Latent Gain Rate',
    'humidity':'Zone Air Relative Humidity',
    'outdoorTemperature':'Site Outdoor Air Drybulb Temperature',
    'surfaceSolar':'Surface Inside Face Solar Radiation Heat Gain Rate',
    'surfaceInternalRadiation':'Surface Inside Face Internal Gains Radiation Heat Gain Rate',
    'surfaceLightsRadiation':'Surface Inside Face Lights Radiation Heat Gain Rate',
    'surfaceNetRadiation':'Surface Inside Face Net Surface Thermal Radiation Heat Gain Rate',
}


def defaults():
    return {
        'settings': {'heating':20, 'cooling':27, 'groundTemperature':18,
                     'activityW':120, 'peopleRadiant':.3, 'lightsRadiant':0, 'equipmentRadiant':.3, 'equipmentLatent':0,
                     'peopleSchedule':[.8]*7+[.3]*10+[1]*7,
                     'equipmentSchedule':[.25]*7+[.5]*10+[1]*7,
                     'lightsSchedule':[.25]*7+[.5]*10+[1]*7,
                     'ventilationSchedule':[1]*24, 'infiltrationSchedule':[1]*24, 'hvacSchedule':[1]*24,
                     'hvacMode':'hourly', 'heatingPeriods':[], 'coolingPeriods':[],
                     'reviewed':False},
        'constructions': {
            'wall':{'label':'仮定：木造断熱壁', 'layers':[
                {'thickness':.012, 'conductivity':.14, 'density':600, 'specificHeat':1600},
                {'thickness':.10, 'conductivity':.04, 'density':24, 'specificHeat':840},
                {'thickness':.0125, 'conductivity':.22, 'density':800, 'specificHeat':1090}]},
            'roof':{'label':'仮定：断熱屋根', 'layers':[
                {'thickness':.012, 'conductivity':.14, 'density':600, 'specificHeat':1600},
                {'thickness':.20, 'conductivity':.04, 'density':24, 'specificHeat':840},
                {'thickness':.0125, 'conductivity':.22, 'density':800, 'specificHeat':1090}]},
            'floor':{'label':'仮定：断熱床', 'layers':[
                {'thickness':.10, 'conductivity':.04, 'density':24, 'specificHeat':840},
                {'thickness':.024, 'conductivity':.14, 'density':600, 'specificHeat':1600}]},
            'partition':{'label':'仮定：対称間仕切り', 'cfdMaterial':'2杉(1)', 'cfdThickness':.03, 'layers':[
                {'thickness':.0125, 'conductivity':.22, 'density':800, 'specificHeat':1090},
                {'thickness':.08, 'conductivity':.04, 'density':24, 'specificHeat':840},
                {'thickness':.0125, 'conductivity':.22, 'density':800, 'specificHeat':1090}]},
            'window':{'label':'仮定：複層窓', 'cfdMaterial':'1ガラス板(Low-E複層)', 'cfdThickness':.006, 'u':2.3,'shgc':.5,'visibleTransmittance':.6},
            'door':{'label':'仮定：木製ドア', 'cfdMaterial':'2杉(1)', 'cfdThickness':.04, 'layers':[
                {'thickness':.04, 'conductivity':.14, 'density':600, 'specificHeat':1600}]},
        }}


MDAYS=[31,28,31,30,31,30,31,31,30,31,30,31]
FILM_IN, FILM_OUT = .11, .04


def positive(value, name, zero=False):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or (value<0 if zero else value<=0):
        raise ValueError(name+': 有効な数値を入力してください')
    return value


def unit_interval(value, name):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not 0<=value<=1:
        raise ValueError(name+': 0〜1で入力してください')
    return value


def bounded(value, name, low, high):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not low<=value<=high:
        raise ValueError(name+'が不正です')
    return value


def construction_kind(c):
    kind=c.get('kind')
    if kind in ('layers','glazing','nomass'):
        return kind
    if 'u' in c and not c.get('layers'):
        return 'glazing'
    if 'resistance' in c and not c.get('layers'):
        return 'nomass'
    return 'layers'


def material_resistance(c):
    kind=construction_kind(c)
    if kind=='glazing':
        return None
    if kind=='nomass':
        return positive(c.get('resistance'), '熱抵抗')
    layers=c.get('layers') or []
    if not layers:
        raise ValueError('材料層がありません')
    return sum(positive(layer.get('thickness'),'厚み')/positive(layer.get('conductivity'),'熱伝導率') for layer in layers)


def reference_u(c):
    """Material R plus JIS A 2101 surface films. Glazing returns the entered U-factor."""
    kind=construction_kind(c)
    if kind=='glazing':
        return {'kind':kind, 'r':None, 'u':positive(c.get('u'),'U値'), 'uOut':None, 'uIn':None}
    r=material_resistance(c)
    return {'kind':kind, 'r':r, 'u':None, 'uOut':1/(r+FILM_IN+FILM_OUT), 'uIn':1/(r+FILM_IN+FILM_IN)}


def day_of_year(month, day):
    if isinstance(month,bool) or isinstance(day,bool) or not isinstance(month,int) or not isinstance(day,int) or not 1<=month<=12 or not 1<=day<=MDAYS[month-1]:
        raise ValueError('期間は1〜12月、2月は28日までの日付にしてください')
    return sum(MDAYS[:month-1])+day


def month_day(ordinal):
    for month,days in enumerate(MDAYS,1):
        if ordinal<=days:
            return month, ordinal
        ordinal-=days
    raise ValueError('期間が年の範囲を超えています')


def availability_segments(periods):
    """Non-overlapping inclusive periods when availability is 1. The rest of the non-leap year is 0."""
    if not isinstance(periods,list) or not periods:
        raise ValueError('運転期間を1つ以上入れてください')
    spans=[]
    for p in periods:
        if not isinstance(p,dict):
            raise ValueError('運転期間の形式が不正です')
        start, end = day_of_year(p.get('startMonth'),p.get('startDay')), day_of_year(p.get('endMonth'),p.get('endDay'))
        if start>end:
            raise ValueError('期間が年をまたいでいます。年始と年末で分けてください')
        spans.append((start,end))
    spans.sort()
    for i in range(len(spans)-1):
        if spans[i][1]>=spans[i+1][0]:
            raise ValueError('運転期間が重なっています')
    cursor, out = 1, []
    for start,end in spans:
        if cursor<start:
            out.append((cursor, start-1, 0))
        out.append((start, end, 1))
        cursor=end+1
    if cursor<=365:
        out.append((cursor, 365, 0))
    return out


def build(raw):
    check = validate(raw, thermal=True)
    if check['errors']:
        raise ValueError('\n'.join(check['errors']))
    m = check['model']; cfg = m.get('settings',{})
    if not cfg.get('reviewed'):
        raise ValueError('材料・スケジュールの仮定を確認してください')
    heat, cool = cfg.get('heating'),cfg.get('cooling')
    if not all(isinstance(x,(int,float)) and math.isfinite(x) for x in (heat,cool)) or not -20 < heat < cool < 50:
        raise ValueError('冷暖房設定温度が不正です')
    north=m.get('north',0)
    if not isinstance(north,(int,float)) or not math.isfinite(north):
        raise ValueError('北方向が不正です')
    ep = {}
    def add(kind, name, **fields):
        ep.setdefault(kind,{})[name] = fields
    def constant(name,value):
        add('Schedule:Constant', name, hourly_value=value)
        return name
    add('Version','Version',version_identifier='24.2')
    add('Building','Building',north_axis=north, terrain='Suburbs', solar_distribution='FullInteriorAndExterior', maximum_number_of_warmup_days=50)
    add('GlobalGeometryRules','Rules',starting_vertex_position='UpperLeftCorner', vertex_entry_direction='Counterclockwise',coordinate_system='Relative')
    add('Timestep','Timestep',number_of_timesteps_per_hour=6)
    add('SimulationControl','Control',do_zone_sizing_calculation='No',do_system_sizing_calculation='No',do_plant_sizing_calculation='No',run_simulation_for_sizing_periods='No',run_simulation_for_weather_file_run_periods='Yes')
    add('RunPeriod','Annual',begin_month=1,begin_day_of_month=1,end_month=12,end_day_of_month=31,day_of_week_for_start_day='Monday',use_weather_file_daylight_saving_period='No')
    ground=cfg.get('groundTemperature',18)
    if not isinstance(ground,(int,float)) or not math.isfinite(ground) or not -20<ground<50:
        raise ValueError('地中温度が不正です')
    add('Site:GroundTemperature:BuildingSurface','Ground',**{x+'_ground_temperature':ground for x in ['january','february','march','april','may','june','july','august','september','october','november','december']})
    constant('On',1); constant('Control',4); constant('HeatSetpoint',heat); constant('CoolSetpoint',cool)
    constant('Activity', positive(cfg.get('activityW',120),'活動量'))
    people_rad=unit_interval(cfg.get('peopleRadiant',.3),'人体の放射比')
    lights_rad=unit_interval(cfg.get('lightsRadiant',0),'照明の放射比')
    equip_rad=unit_interval(cfg.get('equipmentRadiant',.3),'機器の放射比')
    equip_lat=unit_interval(cfg.get('equipmentLatent',0),'機器の潜熱比')
    if lights_rad>1 or equip_rad+equip_lat>1:
        raise ValueError('機器の放射比と潜熱比の合計が1を超えています')
    def day_week(name, values):
        if len(values)!=24 or any(not isinstance(v,(int,float)) or not math.isfinite(v) or v<0 or v>1 for v in values):
            raise ValueError(name+': 0〜1の24時間スケジュールが必要です')
        add('Schedule:Day:Hourly', name+'Day', **{'hour_'+str(i+1):v for i,v in enumerate(values)})
        days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday','holiday','summerdesignday','winterdesignday','customday1','customday2']
        add('Schedule:Week:Daily', name+'Week', **{d+'_schedule_day_name':name+'Day' for d in days})
        return name+'Week'
    def schedule(name, values):
        add('Schedule:Year',name,schedule_weeks=[{'schedule_week_name':day_week(name,values),'start_month':1,'start_day':1,'end_month':12,'end_day':31}])
    def binary_year(name, periods):
        day_week(name+'On',[1]*24); day_week(name+'Off',[0]*24)
        weeks=[]
        for start,end,flag in availability_segments(periods):
            sm,sd=month_day(start); em,ed=month_day(end)
            weeks.append({'schedule_week_name':name+('On' if flag else 'Off')+'Week','start_month':sm,'start_day':sd,'end_month':em,'end_day':ed})
        add('Schedule:Year',name,schedule_weeks=weeks)
    for name,key in [('Occupancy','peopleSchedule'),('Equipment','equipmentSchedule'),('Ventilation','ventilationSchedule'),('HVAC','hvacSchedule')]:
        schedule(name,cfg.get(key,[]))
    use_lights=any(r.get('lightsWm2') is not None for r in m['rooms'])
    use_infiltration=any(r.get('infiltrationACH') is not None for r in m['rooms'])
    if use_lights:
        schedule('Lights', cfg.get('lightsSchedule',[]))
    if use_infiltration:
        schedule('Infiltration', cfg.get('infiltrationSchedule',[]))
    hvac_mode=cfg.get('hvacMode') or 'hourly'
    if hvac_mode not in ('hourly','season'):
        raise ValueError('空調の期間指定が不正です')
    if hvac_mode=='season':
        try:
            binary_year('HeatingAvail', cfg.get('heatingPeriods') or [])
        except ValueError as e:
            raise ValueError('暖房: '+str(e)) from e
        try:
            binary_year('CoolingAvail', cfg.get('coolingPeriods') or [])
        except ValueError as e:
            raise ValueError('冷房: '+str(e)) from e
    heat_supply=cfg.get('maxHeatingSupply', None)
    cool_supply=cfg.get('minCoolingSupply', None)
    heat_w=cfg.get('maxHeatingHumidity', None)
    cool_w=cfg.get('minCoolingHumidity', None)
    shr=cfg.get('coolingSHR', None)
    if heat_supply is not None: heat_supply=bounded(heat_supply,'加熱供給温度',0,100)
    if cool_supply is not None: cool_supply=bounded(cool_supply,'冷却供給温度',-20,40)
    if heat_w is not None: heat_w=bounded(heat_w,'加熱供給湿度比',0,0.2)
    if cool_w is not None: cool_w=bounded(cool_w,'冷却供給湿度比',0,0.2)
    if shr is not None: shr=unit_interval(shr,'冷房顕熱比')
    used_materials=set()
    def ep_token(key):
        if not isinstance(key,str) or not key or key!=key.strip() or any(ch in key for ch in ',;'):
            raise ValueError('構成名が空、またはカンマ・セミコロンを含んでいます: '+str(key))
        return key
    def absorb(source, prefix):
        return dict(thermal_absorptance=unit_interval(source.get('thermalAbsorptance',.9), prefix+'長波放射率'),
                    solar_absorptance=unit_interval(source.get('solarAbsorptance',.7), prefix+'日射吸収率'),
                    visible_absorptance=unit_interval(source.get('visibleAbsorptance', source.get('solarAbsorptance',.7)), prefix+'可視吸収率'))
    for key,c in m['constructions'].items():
        name=ep_token(key)
        kind=construction_kind(c)
        if kind=='glazing':
            if not 0<c.get('shgc',0)<=1 or (c.get('visibleTransmittance') is not None and not 0<c['visibleTransmittance']<=1):
                raise ValueError(key+': 日射・可視光透過率が不正です')
            glazing=dict(u_factor=positive(c.get('u'),key+' U値'),solar_heat_gain_coefficient=c['shgc'])
            if c.get('visibleTransmittance') is not None: glazing['visible_transmittance']=c['visibleTransmittance']
            add('WindowMaterial:SimpleGlazingSystem',name+'Glass',**glazing)
            add('Construction',name,outside_layer=name+'Glass')
        elif kind=='nomass':
            lname=name+'__NoMass'
            add('Material:NoMass',lname,roughness='MediumRough',thermal_resistance=positive(c.get('resistance'),key+'熱抵抗'),**absorb(c,key))
            add('Construction',name,outside_layer=lname)
        else:
            layers=c.get('layers',[])
            if not 1<=len(layers)<=10:
                raise ValueError(key+': 材料層は1〜10層です')
            fields={}
            for j,layer in enumerate(layers):
                raw=str(layer.get('name') or 'L'+str(j)).strip() or 'L'+str(j)
                if any(ch in raw for ch in ',;'):
                    raise ValueError(key+': 材料名にカンマとセミコロンは使えません')
                lname=name+'__'+raw
                if lname in used_materials:
                    lname=name+'__'+raw+'_'+str(j)
                used_materials.add(lname)
                add('Material',lname,roughness='MediumRough',thickness=positive(layer.get('thickness'),key+'厚み'),conductivity=positive(layer.get('conductivity'),key+'熱伝導率'),density=positive(layer.get('density'),key+'密度'),specific_heat=positive(layer.get('specificHeat'),key+'比熱'),**absorb(layer,key))
                fields['outside_layer' if j==0 else 'layer_'+str(j+1)]=lname
            add('Construction',name,**fields)
    rnames={r['id']:'Z'+str(i+1) for i,r in enumerate(m['rooms'])}
    snames={s['id']:'S'+str(i+1) for i,s in enumerate(m['surfaces'])}
    wnames={s['id']:'W'+str(i+1) for i,s in enumerate(m['openings'])}
    for r in m['rooms']:
        rn=rnames[r['id']]
        add('Zone',rn)
        if r.get('conditioned',True):
            add('ThermostatSetpoint:DualSetpoint',rn+'Setpoint',heating_setpoint_temperature_schedule_name='HeatSetpoint',cooling_setpoint_temperature_schedule_name='CoolSetpoint')
            add('ZoneControl:Thermostat',rn+'Thermostat',zone_or_zonelist_name=rn,control_type_schedule_name='Control',control_1_object_type='ThermostatSetpoint:DualSetpoint',control_1_name=rn+'Setpoint')
            ideal=dict(availability_schedule_name='HVAC',zone_supply_air_node_name=rn+'Supply',heating_limit='NoLimit',cooling_limit='NoLimit',dehumidification_control_type='ConstantSensibleHeatRatio' if shr is not None else 'None',humidification_control_type='None')
            if hvac_mode=='season':
                ideal['heating_availability_schedule_name']='HeatingAvail'
                ideal['cooling_availability_schedule_name']='CoolingAvail'
            if heat_supply is not None: ideal['maximum_heating_supply_air_temperature']=heat_supply
            if cool_supply is not None: ideal['minimum_cooling_supply_air_temperature']=cool_supply
            if heat_w is not None: ideal['maximum_heating_supply_air_humidity_ratio']=heat_w
            if cool_w is not None: ideal['minimum_cooling_supply_air_humidity_ratio']=cool_w
            if shr is not None: ideal['cooling_sensible_heat_ratio']=shr
            add('ZoneHVAC:IdealLoadsAirSystem',rn+'Ideal',**ideal)
            add('ZoneHVAC:EquipmentList',rn+'List',load_distribution_scheme='SequentialLoad',equipment=[{'zone_equipment_object_type':'ZoneHVAC:IdealLoadsAirSystem','zone_equipment_name':rn+'Ideal','zone_equipment_cooling_sequence':1,'zone_equipment_heating_or_no_load_sequence':1}])
            add('ZoneHVAC:EquipmentConnections',rn+'Connections',zone_name=rn,zone_conditioning_equipment_list_name=rn+'List',zone_air_inlet_node_or_nodelist_name=rn+'Supply',zone_air_node_name=rn+'Air',zone_return_air_node_or_nodelist_name=rn+'Return')
        add('People',rn+'People',zone_or_zonelist_or_space_or_spacelist_name=rn,number_of_people_schedule_name='Occupancy',number_of_people_calculation_method='People',number_of_people=positive(r.get('people',0),rn+'人数',True),fraction_radiant=people_rad,activity_level_schedule_name='Activity')
        if r.get('lightsWm2') is not None:
            add('Lights',rn+'Lights',zone_or_zonelist_or_space_or_spacelist_name=rn,schedule_name='Lights',design_level_calculation_method='Watts/Area',watts_per_floor_area=positive(r.get('lightsWm2'),rn+'照明',True),return_air_fraction=0,fraction_radiant=lights_rad,fraction_visible=0,fraction_replaceable=1,end_use_subcategory='General')
        if r.get('equipmentWm2') is not None:
            add('ElectricEquipment',rn+'Equipment',zone_or_zonelist_or_space_or_spacelist_name=rn,schedule_name='Equipment',design_level_calculation_method='Watts/Area',watts_per_floor_area=positive(r.get('equipmentWm2'),rn+'機器発熱',True),fraction_latent=equip_lat,fraction_radiant=equip_rad,fraction_lost=0,end_use_subcategory='General')
        else:
            add('OtherEquipment',rn+'Equipment',fuel_type='None',zone_or_zonelist_or_space_or_spacelist_name=rn,schedule_name='Equipment',design_level_calculation_method='EquipmentLevel',design_level=positive(r.get('equipmentW',0),rn+'機器発熱',True),fraction_latent=equip_lat,fraction_radiant=equip_rad,fraction_lost=0)
        if r.get('infiltrationACH') is not None:
            add('ZoneInfiltration:DesignFlowRate',rn+'Infiltration',zone_or_zonelist_or_space_or_spacelist_name=rn,schedule_name='Infiltration',design_flow_rate_calculation_method='AirChanges/Hour',air_changes_per_hour=positive(r.get('infiltrationACH'),rn+'漏気',True),constant_term_coefficient=1,temperature_term_coefficient=0,velocity_term_coefficient=0,velocity_squared_term_coefficient=0)
        add('ZoneVentilation:DesignFlowRate',rn+'Vent',zone_or_zonelist_or_space_or_spacelist_name=rn,schedule_name='Ventilation',design_flow_rate_calculation_method='AirChanges/Hour',air_changes_per_hour=positive(r.get('ventilationACH',0),rn+'換気',True),ventilation_type='Natural',constant_term_coefficient=1,temperature_term_coefficient=0,velocity_term_coefficient=0,velocity_squared_term_coefficient=0,minimum_indoor_temperature=-100,maximum_indoor_temperature=100,delta_temperature=-100,minimum_outdoor_temperature=-100,maximum_outdoor_temperature=100,maximum_wind_speed=40)
    for s in m['surfaces']:
        bc=s['boundary']
        if construction_kind(m['constructions'][s['construction']])=='glazing':
            raise ValueError(s['id']+': 不透明面に窓仕様は使えません')
        fields=dict(surface_type=s['type'],construction_name=s['construction'],zone_name=rnames[s['roomId']],outside_boundary_condition=bc,sun_exposure='SunExposed' if bc=='Outdoors' else 'NoSun',wind_exposure='WindExposed' if bc=='Outdoors' else 'NoWind',vertices=[dict(zip(('vertex_x_coordinate','vertex_y_coordinate','vertex_z_coordinate'),p)) for p in s['vertices']])
        if bc=='Surface':
            fields['outside_boundary_condition_object']=snames[s['adjacentSurfaceId']]
        add('BuildingSurface:Detailed',snames[s['id']],**fields)
    for w in m['openings']:
        if (w['type']=='Window') != (construction_kind(m['constructions'][w['construction']])=='glazing'):
            raise ValueError(w['id']+': 開口種別と材料仕様が一致しません')
        fields=dict(surface_type=w['type'],construction_name=w['construction'],building_surface_name=snames[w['surfaceId']],number_of_vertices=len(w['vertices']))
        if w.get('adjacentOpeningId'):
            fields['outside_boundary_condition_object']=wnames[w['adjacentOpeningId']]
        for j,p in enumerate(w['vertices']):
            fields.update({'vertex_'+str(j+1)+'_'+axis+'_coordinate':p[k] for k,axis in enumerate('xyz')})
        add('FenestrationSurface:Detailed',wnames[w['id']],**fields)
    for i,s in enumerate(m['shades']):
        add('Shading:Building:Detailed','Shade'+str(i),vertices=[dict(zip(('vertex_x_coordinate','vertex_y_coordinate','vertex_z_coordinate'),p)) for p in s['vertices']])
    add('Output:SQLite','SQL',option_type='SimpleAndTabular')
    for key,name in VARIABLES.items():
        add('Output:Variable',key,key_value='*',variable_name=name,reporting_frequency='Hourly')
    mapping={'rooms':rnames,'surfaces':{**snames,**wnames},'fingerprint':fingerprint(m)}
    return ep,mapping,m


def extract(sql_path, mapping, model):
    db=sqlite3.connect(sql_path)
    try:
        times=[dict(zip(('index','month','day','hour','minute','interval'),row)) for row in db.execute('SELECT TimeIndex,Month,Day,Hour,Minute,Interval FROM Time WHERE COALESCE(WarmupFlag,0)=0 AND IntervalType=1 ORDER BY TimeIndex')]
        if not times:
            raise ValueError('Hourlyの本計算結果がありません')
        index={t['index']:i for i,t in enumerate(times)}
        reverse={name.upper():key for key,name in mapping['surfaces'].items()}
        room_rev={name.upper():key for key,name in mapping['rooms'].items()}
        # IdealLoads output is keyed by the Zone name (some releases use the equipment name).
        room_rev.update({(name+'Ideal').upper():key for key,name in mapping['rooms'].items()})
        output={'times':times,'surfaces':{},'surfaceRadiation':{},'rooms':{r['id']:{} for r in model['rooms']},'fingerprint':mapping['fingerprint'],
                'geometry':validate(model)['rooms']}
        names={v.lower():k for k,v in VARIABLES.items()}
        for rid,key,name in db.execute("SELECT ReportDataDictionaryIndex,KeyValue,Name FROM ReportDataDictionary WHERE ReportingFrequency='Hourly'"):
            kind=names.get(name.lower())
            if not kind:
                continue
            if kind.startswith('surface'):
                target=reverse.get(key.upper())
                if target is None: continue
                if kind=='surfaceTemperature':
                    dest=output['surfaces']; prop=target
                else:
                    dest=output['surfaceRadiation'].setdefault(target,{}); prop=kind
            elif kind=='outdoorTemperature':
                dest=output; prop=kind
            else:
                target=room_rev.get(key.upper())
                if target is None: continue
                dest=output['rooms'][target]; prop=kind
            values=[None]*len(times)
            for ti,value in db.execute('SELECT TimeIndex,Value FROM ReportData WHERE ReportDataDictionaryIndex=?',(rid,)):
                if ti in index: values[index[ti]]=value
            if any(v is None or not math.isfinite(v) for v in values):
                raise ValueError(name+' / '+key+': 時系列が欠落しています')
            dest[prop]=values
        missing=set(mapping['surfaces'])-set(output['surfaces'])
        if missing:
            raise ValueError('表面温度が不足しています: '+', '.join(sorted(missing)))
        for s in model['surfaces']:
            if s['boundary'] in ('Surface','Adiabatic') and any(k not in output['surfaceRadiation'].get(s['id'],{}) for k in VARIABLES if k.startswith('surface') and k!='surfaceTemperature'):
                raise ValueError(s['id']+': 内壁の放射熱収支出力が不足しています')
        for r in model['rooms']:
            values=output['rooms'][r['id']]
            required=['airTemperature','humidity','convectiveGain','latentGain']
            if r.get('conditioned',True): required += ['cooling','heating']
            if any(k not in values for k in required):
                raise ValueError(r['id']+': 必須の室出力がありません')
            for k in ('cooling','heating'):
                values.setdefault(k,[0]*len(times))
        if 'outdoorTemperature' not in output:
            raise ValueError('外気温がありません')
        return output
    finally:
        db.close()

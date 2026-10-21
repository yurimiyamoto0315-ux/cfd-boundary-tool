import copy
from pipeline.energy import defaults
from pipeline.geometry import pair_adjacent


def room_box(rid='room1',x=0):
    p=lambda a,b,c:[a+x,b,c]
    faces=[('floor','Floor',[p(0,0,0),p(0,4,0),p(5,4,0),p(5,0,0)]),
           ('roof','Roof',[p(0,0,3),p(5,0,3),p(5,4,3),p(0,4,3)]),
           ('south','Wall',[p(0,0,0),p(5,0,0),p(5,0,3),p(0,0,3)]),
           ('east','Wall',[p(5,0,0),p(5,4,0),p(5,4,3),p(5,0,3)]),
           ('north','Wall',[p(5,4,0),p(0,4,0),p(0,4,3),p(5,4,3)]),
           ('west','Wall',[p(0,4,0),p(0,0,0),p(0,0,3),p(0,4,3)])]
    return [{'id':rid+'-'+key,'roomId':rid,'type':kind,'boundary':'Ground' if kind=='Floor' else 'Outdoors','construction':'floor' if kind=='Floor' else ('roof' if kind=='Roof' else 'wall'),'vertices':vs} for key,kind,vs in faces]


def single_room():
    m={'schemaVersion':1,'source':'rhino','units':'m','north':0,
       'rooms':[{'id':'room1','name':'検証室','conditioned':True,'people':2,'equipmentW':100,'ventilationACH':.5}],
       'surfaces':room_box(),'openings':[{'id':'window1','surfaceId':'room1-south','type':'Window','construction':'window','vertices':[[1,0,1],[3,0,1],[3,0,2],[1,0,2]]}],'shades':[]}
    m.update(copy.deepcopy(defaults())); m['settings']['reviewed']=True
    return m


def two_rooms():
    m=single_room()
    m['rooms'].append({'id':'room2','name':'隣室','conditioned':False,'people':0,'equipmentW':0,'ventilationACH':0})
    m['surfaces']+=room_box('room2',5)
    m=pair_adjacent(m)
    for s in m['surfaces']:
        if s['boundary']=='Surface': s['construction']='partition'
    return m

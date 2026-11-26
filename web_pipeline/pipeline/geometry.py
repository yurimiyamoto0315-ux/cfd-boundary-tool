"""Planar building geometry. Metres; CCW vertices seen from outside the room."""
import copy
import hashlib
import json
import math
from collections import defaultdict
from shapely.geometry import Polygon
from shapely import constrained_delaunay_triangles

TOL = 1e-5


def sub(a, b):
    return [a[i] - b[i] for i in range(3)]


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def length(a):
    return math.sqrt(dot(a, a))


def frame(vertices):
    if len(vertices) < 3:
        raise ValueError('面には3頂点以上が必要です')
    o = vertices[0]
    n = [0., 0., 0.]
    for a, b in zip(vertices, vertices[1:]+vertices[:1]):
        c = cross(sub(a, o), sub(b, o))
        n = [n[i]+c[i] for i in range(3)]
    size = length(n)
    if size < TOL*TOL:
        raise ValueError('面積がゼロです')
    n = [x/size for x in n]
    u = sub(vertices[1], o)
    if length(u) < TOL:
        raise ValueError('重複頂点があります')
    u = [x/length(u) for x in u]
    v = cross(n, u)
    return o, u, v, n


def project(vertices, basis):
    o, u, v, _ = basis
    return [(dot(sub(p, o), u), dot(sub(p, o), v)) for p in vertices]


def unproject(p, basis):
    o, u, v, _ = basis
    return [o[i]+p[0]*u[i]+p[1]*v[i] for i in range(3)]


def polygon(vertices, basis=None):
    basis = basis or frame(vertices)
    if any(abs(dot(sub(p, basis[0]), basis[3])) > TOL for p in vertices):
        raise ValueError('平面ではありません。曲面を平面に分割してください')
    p = Polygon(project(vertices, basis))
    if not p.is_valid or p.area < TOL*TOL:
        raise ValueError('面が自己交差しているか、面積がゼロです')
    return p


def triangles(vertices, holes=()):
    basis = frame(vertices)
    p = Polygon(project(vertices, basis), [project(h, basis) for h in holes])
    if not p.is_valid:
        raise ValueError('開口を含む面の形状が不正です')
    result = []
    for t in constrained_delaunay_triangles(p).geoms:
        vs = [unproject(x, basis) for x in list(t.exterior.coords)[:-1]]
        if dot(cross(sub(vs[1], vs[0]), sub(vs[2], vs[0])), basis[3]) < 0:
            vs.reverse()
        result.append(vs)
    return result


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def normalize(raw):
    m = copy.deepcopy(raw)
    if m.get('schemaVersion') != 1:
        raise ValueError('建物JSONのschemaVersionは1が必要です')
    unit = m.get('units')
    if unit not in ('m', 'mm', 'cm'):
        raise ValueError('unitsをm/mm/cmで指定してください')
    scale = {'m':1, 'mm':.001, 'cm':.01}[unit]
    m.setdefault('sourceTransform', {'units':unit, 'scaleToMetres':scale, 'origin':[0,0,0]})
    m['units'] = 'm'
    for s in m.get('surfaces', []) + m.get('openings', []) + m.get('shades', []):
        vs = s.get('vertices', [])
        if any(not isinstance(p, list) or len(p) != 3 or any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) for x in p) for p in vs):
            raise ValueError(str(s.get('id'))+': 頂点は有限のXYZ数値で指定してください')
        s['vertices'] = [[x*scale for x in p] for p in vs]
    m.setdefault('north', 0)
    m.setdefault('openings', [])
    m.setdefault('shades', [])
    return m


def validate(raw, thermal=False):
    m = normalize(raw)
    errors, warnings = [], []
    rooms = {r['id']:r for r in m.get('rooms', [])}
    surfaces = {s['id']:s for s in m.get('surfaces', [])}
    all_ids = [x.get('id') for key in ('rooms','surfaces','openings','shades') for x in m.get(key, [])]
    if not rooms:
        errors.append('部屋がありません')
    if len(set(all_ids)) != len(all_ids) or any(not isinstance(i,str) or not i for i in all_ids):
        errors.append('IDは空でない一意の文字列にしてください')
    bases, polys = {}, {}
    for s in list(surfaces.values())+m['openings']+m['shades']:
        try:
            bases[s['id']] = frame(s['vertices'])
            polys[s['id']] = polygon(s['vertices'], bases[s['id']])
        except (ValueError, KeyError) as e:
            errors.append(f"{s.get('id')}: {e}")
    for s in surfaces.values():
        sid = s['id']
        if s.get('roomId') not in rooms:
            errors.append(sid+': 所属部屋が不明です')
        if s.get('type') not in ('Wall','Floor','Roof','Ceiling'):
            errors.append(sid+': 面種別を指定してください')
        if s.get('boundary') not in ('Outdoors','Ground','Surface','Adiabatic'):
            errors.append(sid+': 境界条件を指定してください')
        if s.get('boundary') == 'Surface':
            other = surfaces.get(s.get('adjacentSurfaceId'))
            if not other or other.get('adjacentSurfaceId') != sid or other.get('boundary') != 'Surface' or other.get('roomId') == s.get('roomId'):
                errors.append(sid+': 隣接面は別室の面と相互指定してください')
            elif sid in bases and other['id'] in bases:
                try:
                    p = polygon(other['vertices'], bases[sid])
                    if p.symmetric_difference(polys[sid]).area > TOL or dot(bases[sid][3], bases[other['id']][3]) > -.999:
                        errors.append(sid+': 隣接面の範囲・法線が一致しません。共通範囲で面を分割してください')
                except ValueError:
                    errors.append(sid+': 隣接面が同一平面ではありません')
        if thermal and s.get('construction') not in m.get('constructions', {}):
            errors.append(sid+': 材料構成が未設定です')
    # Split edges at all collinear vertices, so legitimate T-junctions are supported.
    stats = []
    for rid, room in rooms.items():
        faces = [s for s in surfaces.values() if s.get('roomId') == rid and s['id'] in bases]
        points = [p for s in faces for p in s['vertices']]
        edges = defaultdict(list)
        volume = 0.
        for s in faces:
            vs = s['vertices']
            for a, b in zip(vs, vs[1:]+vs[:1]):
                d = sub(b,a); dd = dot(d,d)
                if dd < TOL*TOL:
                    errors.append(s['id']+': 短すぎる辺があります'); continue
                ts = [0.,1.]
                for p in points:
                    t = dot(sub(p,a),d)/dd
                    if TOL < t < 1-TOL and length(sub(sub(p,a),[t*x for x in d])) < TOL:
                        ts.append(t)
                ts = sorted(set(round(t,8) for t in ts))
                for t0,t1 in zip(ts,ts[1:]):
                    p = tuple(round(a[i]+t0*d[i],5) for i in range(3))
                    q = tuple(round(a[i]+t1*d[i],5) for i in range(3))
                    edges[tuple(sorted((p,q)))].append(1 if p<q else -1)
            for t in triangles(vs):
                volume += dot(t[0], cross(t[1],t[2]))/6
        if not faces or any(len(v)!=2 or sum(v)!=0 for v in edges.values()):
            errors.append(rid+': 部屋が閉じていないか、面の向き・重複が不正です')
        if volume <= TOL:
            errors.append(rid+': 部屋の体積が正ではありません。面は室外から見て反時計回りにしてください')
        stats.append({'id':rid, 'name':room.get('name',rid), 'volume':volume,
                      'floorArea':sum(polys[s['id']].area for s in faces if s.get('type')=='Floor')})
    by_parent = defaultdict(list)
    for w in m['openings']:
        sid = w.get('surfaceId'); parent = surfaces.get(sid)
        if not parent or sid not in bases or w['id'] not in bases:
            errors.append(w['id']+': 親面が不明または不正です'); continue
        try:
            p = polygon(w['vertices'], bases[sid])
            if not polys[sid].buffer(TOL).covers(p) or p.area >= polys[sid].area-TOL:
                errors.append(w['id']+': 開口が親面からはみ出しています')
            if dot(bases[w['id']][3], bases[sid][3]) < .999:
                errors.append(w['id']+': 開口と親面の向きが異なります')
            if any(p.intersection(q).area > TOL for q in by_parent[sid]):
                errors.append(w['id']+': 開口が重複しています')
            by_parent[sid].append(p)
            if len(w['vertices']) not in (3,4):
                errors.append(w['id']+': EPの開口は三角形または四角形に分割してください')
        except ValueError as e:
            errors.append(w['id']+': '+str(e))
        if w.get('type') not in ('Window','Door'):
            errors.append(w['id']+': 開口種別はWindowまたはDoorです')
        if thermal and w.get('construction') not in m.get('constructions',{}):
            errors.append(w['id']+': 窓・ドア仕様が未設定です')
        if parent.get('boundary') == 'Surface':
            other = next((x for x in m['openings'] if x['id']==w.get('adjacentOpeningId')),None)
            if not other or other.get('adjacentOpeningId')!=w['id'] or other.get('surfaceId')!=parent.get('adjacentSurfaceId'):
                errors.append(w['id']+': 室間開口の相手面を相互指定してください')
    # Coplanar overlaps must be explicitly paired, even between different rooms.
    fs = [s for s in surfaces.values() if s['id'] in bases]
    for i,a in enumerate(fs):
        for b in fs[i+1:]:
            if a.get('adjacentSurfaceId')==b['id']:
                continue
            if abs(dot(bases[a['id']][3],bases[b['id']][3])) < .99999:
                continue
            try:
                overlap = polys[a['id']].intersection(polygon(b['vertices'],bases[a['id']])).area
                if overlap > TOL:
                    errors.append(a['id']+' / '+b['id']+': 重複面または未指定の隣接面があります')
            except ValueError:
                pass
    return {'model':m, 'errors':errors, 'warnings':warnings, 'rooms':stats, 'valid':not errors}


def pair_adjacent(model):
    """Split coplanar partial overlaps before pairing; keep original face provenance."""
    m = normalize(model)
    originals={s['id']:copy.deepcopy(s) for s in m['surfaces']}

    def pieces(geom):
        if geom.is_empty: return []
        if geom.geom_type=='Polygon':
            if geom.area<=TOL: return []
            return list(constrained_delaunay_triangles(geom).geoms) if geom.interiors else [geom]
        return [p for g in getattr(geom,'geoms',[]) for p in pieces(g)]

    def fragment(s,p,basis):
        vs=[unproject(x,basis) for x in list(p.exterior.coords)[:-1]]
        if dot(frame(vs)[3],frame(s['vertices'])[3])<0: vs.reverse()
        if polygon(s['vertices'],basis).symmetric_difference(p).area<TOL:
            return copy.deepcopy(s)
        part=copy.deepcopy(s)
        part['sourceSurfaceId']=s.get('sourceSurfaceId',s['id'])
        part['id']=part['sourceSurfaceId']+'_'+fingerprint(sorted([[round(x,6) for x in v] for v in vs]))[:10]
        part['vertices']=vs
        return part

    while True:
        fs=m['surfaces']; found=False
        for i,a in enumerate(fs):
            if a.get('boundary')=='Surface': continue
            for b in fs[i+1:]:
                if a['roomId']==b['roomId'] or b.get('boundary')=='Surface': continue
                try:
                    basis=frame(a['vertices'])
                    if dot(basis[3],frame(b['vertices'])[3])>-.999: continue
                    pa,pb=polygon(a['vertices'],basis),polygon(b['vertices'],basis)
                    common=pa.intersection(pb)
                    if common.area<TOL: continue
                    replacement=[]
                    for p in pieces(common):
                        aa,bb=fragment(a,p,basis),fragment(b,p,basis)
                        aa.update(boundary='Surface',adjacentSurfaceId=bb['id'])
                        bb.update(boundary='Surface',adjacentSurfaceId=aa['id'])
                        replacement.extend((aa,bb))
                    replacement += [fragment(a,p,basis) for p in pieces(pa.difference(common))]
                    replacement += [fragment(b,p,basis) for p in pieces(pb.difference(common))]
                    m['surfaces']=[s for s in fs if s['id'] not in (a['id'],b['id'])]+replacement
                    found=True;break
                except ValueError: continue
            if found:break
        if not found:break
        if len(m['surfaces'])>10000: raise ValueError('隣接面分割が多すぎます。形状を整理してください')
    openings=[]
    for w in m['openings']:
        original=originals.get(w.get('surfaceId'))
        if not original:
            openings.append(w); continue
        basis=frame(original['vertices']); wp=polygon(w['vertices'],basis)
        targets=[s for s in m['surfaces'] if s['id']==original['id'] or s.get('sourceSurfaceId')==original['id']]
        contained=False
        for s in targets:
            intersection=polygon(s['vertices'],basis).intersection(wp)
            for p in pieces(intersection):
                parts=list(constrained_delaunay_triangles(p).geoms) if len(p.exterior.coords)>5 else [p]
                for part in parts:
                    item=fragment(w,part,basis);item['surfaceId']=s['id'];openings.append(item);contained=True
        if not contained: openings.append(w)
    m['openings']=openings
    surfaces={s['id']:s for s in m['surfaces']}
    for i,a in enumerate(openings):
        parent=surfaces.get(a.get('surfaceId'),{})
        if parent.get('boundary')!='Surface':continue
        for b in openings[i+1:]:
            if b['surfaceId']!=parent.get('adjacentSurfaceId'):continue
            basis=frame(a['vertices'])
            try:
                if polygon(a['vertices'],basis).symmetric_difference(polygon(b['vertices'],basis)).area<TOL:
                    a['adjacentOpeningId']=b['id'];b['adjacentOpeningId']=a['id']
            except ValueError:pass
    return m

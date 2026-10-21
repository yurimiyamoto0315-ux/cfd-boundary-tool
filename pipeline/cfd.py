"""Explicit surface-temperature exports. Never re-use SAT transferRows."""
import csv
import io
import json
import math
import re
import struct
import zipfile
from .geometry import triangles, frame, validate, polygon


def chunk(code, data):
    return struct.pack('<HI',code,len(data)+6)+data


def mesh3ds(objects):
    data=chunk(0x0100,struct.pack('<f',1.0))
    for name,color,tris in objects:
        if len(tris)*3>65535:
            raise ValueError(name+': 3DS頂点上限を超えています')
        mat=name.encode('ascii')+b'\0'
        data+=chunk(0xAFFF,chunk(0xA000,mat)+chunk(0xA020,chunk(0x0011,bytes(color))))
        vs=[v for t in tris for v in t]
        vertices=chunk(0x4110,struct.pack('<H',len(vs))+b''.join(struct.pack('<fff',*v) for v in vs))
        faces=struct.pack('<H',len(tris))+b''.join(struct.pack('<HHHH',i*3,i*3+1,i*3+2,7) for i in range(len(tris)))
        faces+=chunk(0x4130,mat+struct.pack('<H',len(tris))+b''.join(struct.pack('<H',i) for i in range(len(tris))))
        data+=chunk(0x4000,mat+chunk(0x4100,vertices+chunk(0x4120,faces)))
    return chunk(0x4D4D,chunk(0x0002,struct.pack('<I',3))+chunk(0x3D3D,data))


def csv_bytes(rows, encoding='utf-8-sig'):
    s=io.StringIO(newline=''); csv.writer(s).writerows(rows)
    return s.getvalue().encode(encoding)


def snapshot(model,result,index):
    if not 0<=index<len(result['times']):
        raise ValueError('解析時刻が範囲外です')
    return {'time':result['times'][index], 'surfaces':{k:v[index] for k,v in result['surfaces'].items()},
            'surfaceRadiation':{sid:{k:v[index] for k,v in values.items()} for sid,values in result.get('surfaceRadiation',{}).items()},
            'rooms':{rid:{k:v[index] for k,v in data.items()} for rid,data in result['rooms'].items()},
            'outdoorTemperature':result['outdoorTemperature'][index]}


def export_bundle(model,result,index,flows,category_csv=''):
    snap=snapshot(model,result,index)
    stats={r['id']:r for r in validate(model)['rooms']}
    conditions=[]
    for room in model['rooms']:
        rid=room['id']; f=flows.get(rid,{})
        for key in ('supplyM3h','returnM3h','outdoorM3h','exhaustM3h'):
            value=f.get(key,0)
            if not isinstance(value,(int,float)) or not math.isfinite(value) or value<0:
                raise ValueError(rid+': 風量が不正です')
        if abs(f.get('supplyM3h',0)+f.get('outdoorM3h',0)-f.get('returnM3h',0)-f.get('exhaustM3h',0))>.1:
            raise ValueError(rid+': 流入・流出風量が一致しません')
        if f.get('supplyM3h',0)>0 and not (isinstance(f.get('supplyTemperature'),(int,float)) and math.isfinite(f['supplyTemperature'])):
            raise ValueError(rid+': 吹出温度を入力してください')
        if max(snap['rooms'][rid]['cooling'],snap['rooms'][rid]['heating'])>1 and f.get('supplyM3h',0)<=0:
            raise ValueError(rid+': 空調負荷があります。CFD用の給気・還気風量と吹出温度を設定してください')
        hourly=model['settings']['ventilationSchedule'][snap['time']['hour']-1]
        expected=room.get('ventilationACH',0)*stats[rid]['volume']*hourly
        if abs(f.get('outdoorM3h',0)-expected)>max(.1,expected*.01):
            raise ValueError(rid+': 外気風量がEPの換気条件と一致しません（必要 '+str(round(expected,2))+' m3/h）')
        conditions.append({'roomId':rid, **snap['rooms'][rid], **f, 'outdoorTemperature':snap['outdoorTemperature']})
    objects=[]; rows=[['3DS name','surfaceId','roomId','temperature_C','RGB','parentId','boundaryMode','adjacentId']]
    settings=[]
    allvs=[v for s in model['surfaces'] for v in s['vertices']]
    origin=[min(v[i] for v in allvs) for i in range(3)]
    # Coordinates stay model-relative; north is recorded for FD orientation.
    byid={s['id']:s for s in model['surfaces']}
    emitted={}
    for i,s in enumerate(model['surfaces']+model['openings']):
        parent=byid.get(s.get('surfaceId'),s)
        interior=parent['boundary'] in ('Surface','Adiabatic')
        adjacent=s.get('adjacentSurfaceId') or s.get('adjacentOpeningId')
        if adjacent in emitted:
            name,rgb=emitted[adjacent]
            rows.append([name,s['id'],s.get('roomId') or parent['roomId'],'',rgb,s.get('surfaceId',''),'material_thickness',adjacent])
            continue
        name='EP'+str(i+1).zfill(6)
        code=i+1; color=(64+(code%128),32+((code//128)%128),64+((code//16384)%128))
        holes=[w['vertices'] for w in model['openings'] if w['surfaceId']==s['id']]
        tris=triangles(s['vertices'],holes)
        tris=[[[p[j]-origin[j] for j in range(3)] for p in t] for t in tris]
        objects.append((name,color,tris))
        rgb=' '.join(map(str,color)); temp=snap['surfaces'][s['id']]
        rid=s.get('roomId') or byid[s['surfaceId']]['roomId']
        rows.append([name,s['id'],rid,'' if interior else temp,rgb,s.get('surfaceId',''),'material_thickness' if interior else 'surface_temperature',adjacent or ''])
        emitted[s['id']]=(name,rgb)
        if interior:
            construction=model['constructions'][s['construction']]
            material=construction.get('cfdMaterial')
            thickness=construction.get('cfdThickness')
            if not material or not isinstance(thickness,(int,float)) or not math.isfinite(thickness) or thickness<=0:
                raise ValueError(s['id']+': CFD内壁の材質名・厚みを設定してください')
            if adjacent:
                other=next(x for x in model['surfaces']+model['openings'] if x['id']==adjacent)
                oc=model['constructions'][other['construction']]
                if oc.get('cfdMaterial')!=material or oc.get('cfdThickness')!=thickness:
                    raise ValueError(s['id']+': 室間壁の両側でCFD材質・厚みを揃えてください')
            # EP's absorbed solar/internal/longwave net heat is deposited into the
            # material panel. CFD solar/radiation must be OFF to avoid counting it twice.
            radiant=sum(snap['surfaceRadiation'].get(s['id'],{}).values())
            if adjacent: radiant+=sum(snap['surfaceRadiation'].get(adjacent,{}).values())
            area=polygon(s['vertices']).area-sum(polygon(w['vertices']).area for w in model['openings'] if w['surfaceId']==s['id'])
            if area<=0: raise ValueError(s['id']+': 内壁の正味面積が不正です')
            settings.append((rgb,[(23,'厚みを考慮'),(25,material),(26,str(thickness)),(27,str(radiant/(area*thickness))),(28,'0'),(29,'0'),(90001,'30')]))
        else:
            settings.append((rgb,[(54,'表面温度固定'),(55,str(temp)),(60,'0'),(61,'いいえ'),(90001,'30')]))
    # Gain volumes use the closed room shell. No solar or radiant gains are added.
    gain_objects=[]; gainrows=[['3DS name','roomId','RGB','convective_W','moisture_g_h']]
    for i,r in enumerate(model['rooms']):
        color=(230,80+(i%128),32+(i//128)); rgb=' '.join(map(str,color)); rid=r['id']
        tris=[]
        for s in model['surfaces']:
            if s['roomId']==rid:
                tris.extend([[[p[j]-origin[j] for j in range(3)] for p in t] for t in triangles(s['vertices'])])
        gain_objects.append(('GN'+str(i+1).zfill(6),color,tris))
        values=snap['rooms'][rid]; moisture=values['latentGain']/2450000*3600000
        gainrows.append(['GN'+str(i+1).zfill(6),rid,rgb,values['convectiveGain'],moisture])
        settings.append((rgb,[(76,'全体'),(77,str(values['convectiveGain'])),(78,str(moisture)),(90001,'10')]))
    param=None
    if category_csv:
        cats={}
        for row in csv.reader(io.StringIO(category_csv)):
            if len(row)>=2:
                rgb=' '.join(row[0].strip().split())
                if re.fullmatch(r'#[0-9a-fA-F]{6}',rgb):
                    rgb=' '.join(str(int(rgb[j:j+2],16)) for j in (1,3,5))
                ids=row[1].strip().split()
                if ids and all(x.isdigit() for x in ids):
                    cats.setdefault(rgb,[]).extend(ids)
        assigned=set(); param=[['; EP surface temperature export','',''],['●データ開始行','=','='],['オブジェクトID','パラメータID','パラメータ']]
        for rgb,params in settings:
            if rgb not in cats:
                raise ValueError('FlowDesignerの色対応が不足しています: '+rgb)
            for oid in cats[rgb]:
                if oid in assigned: raise ValueError('オブジェクトIDが重複しています: '+oid)
                assigned.add(oid)
                param.extend([[oid,pid,value] for pid,value in params])
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('ep_cfd.3ds',mesh3ds(objects))
        z.writestr('ep_cfd_gain.3ds',mesh3ds(gain_objects))
        z.writestr('surface_map.csv',csv_bytes(rows))
        z.writestr('gain_map.csv',csv_bytes(gainrows))
        z.writestr('room_conditions.json',json.dumps(conditions,ensure_ascii=False,indent=2))
        z.writestr('snapshot.json',json.dumps(snap,ensure_ascii=False,indent=2))
        z.writestr('coordinates.json',json.dumps({'units':'m','originMetres':origin,'northDegrees':model.get('north',0),'sourceTransform':model.get('sourceTransform')},indent=2))
        if param: z.writestr('objParam.csv',csv_bytes(param,'cp932'))
        z.writestr('README.txt',('EP→CFD 外皮温度＋内壁伝熱\n1. ep_cfd.3ds と ep_cfd_gain.3ds は既存ツール同様メートル座標です。5 mの辺が5000 mmになることを確認します。\n2. 外皮面は解析領域境界または領域外扱いとなる位置に配置してください。外形の凹部・勾配屋根の外側は領域外として処理します。\n3. 既存のカテゴライズVBSでobjcatidlist.csvを出し、ツールの色対応入力に指定して再出力します。\n4. objParam.csvを既存SSLで反映します。外皮は54=表面温度固定、55=温度。内壁は23=厚みを考慮、25=材質、26=厚み、27=EPの正味放射受熱を疑似体積で割った発熱です。内壁にEP表面温度を指定しません。\n5. room_conditions.jsonを参照して空調と換気の位置・向き・流量・温度、室温初期値を設定します。これらの配置は手動です。\n6. CFDの日射・輻射解析はOFFにします。EP側で面の正味放射受熱を計算済みです。外皮にSAT・外気温／貫流条件を追加しません。室の空気発熱は対流成分のみです。暖冷房負荷全体を内部発熱へ加えないでください。\n7. 内壁はCFDで伝熱を再計算するため、EPの内壁温度とは一致を強制しません。収束後の室平均温度と熱収支を比較してください。\n\nFlowDesigner実機での取込・解析結果は別途検証してください。\n').encode('utf-8-sig'))
    return stream.getvalue()

# -*- coding: utf-8 -*-
"""Run in Rhino 7/8 Python. No Honeybee or third-party package required.
Layers: BT::Rooms (closed planar Breps), BT::Windows, BT::Doors, BT::Shades.
Use object UserText `roomId` to disambiguate the room for an opening.
"""
import json
import hashlib
import Rhino
import rhinoscriptsyntax as rs
import scriptcontext as sc
import System


def vertices(face, scale):
    tolerance=sc.doc.ModelAbsoluteTolerance
    if not face.IsPlanar(tolerance):
        raise ValueError('Curved faces are not supported. Split into planar faces.')
    if face.Loops.Count != 1:
        raise ValueError('Room faces must not contain holes. Export windows/doors as separate objects.')
    curve=face.OuterLoop.To3dCurve()
    ok,poly=curve.TryGetPolyline()
    if not ok:
        raise ValueError('Face boundary must consist of straight segments.')
    pts=list(poly)
    if pts[0].DistanceTo(pts[-1]) <= tolerance: pts.pop()
    vs=[[p.X*scale,p.Y*scale,p.Z*scale] for p in pts]
    # Match the outward face normal, independent of trim direction.
    nx=ny=nz=0
    for a,b in zip(vs,vs[1:]+vs[:1]):
        nx+=(a[1]-b[1])*(a[2]+b[2]); ny+=(a[2]-b[2])*(a[0]+b[0]); nz+=(a[0]-b[0])*(a[1]+b[1])
    normal=face.NormalAt(face.Domain(0).Mid,face.Domain(1).Mid)
    if face.OrientationIsReversed: normal=-normal
    if nx*normal.X+ny*normal.Y+nz*normal.Z<0: vs.reverse()
    return vs


def main():
    scale=Rhino.RhinoMath.UnitScale(sc.doc.ModelUnitSystem,Rhino.UnitSystem.Meters)
    model={'schemaVersion':1,'source':'rhino','units':'m','north':0,'sourceTransform':{'units':str(sc.doc.ModelUnitSystem),'scaleToMetres':scale,'origin':[0,0,0]},'rooms':[],'surfaces':[],'openings':[],'shades':[]}
    parents=[]; pending=[]
    objects=rs.GetObjects('Select BT::Rooms, BT::Windows, BT::Doors and BT::Shades',preselect=True)
    if not objects: return
    for oid in objects:
        layer=rs.ObjectLayer(oid).split('::')[-1].lower()
        if layer not in ('rooms','windows','doors','shades'): continue
        brep=rs.coercebrep(oid)
        if brep is None: raise ValueError(str(oid)+': Brep required')
        brep=brep.DuplicateBrep()
        rid=str(oid)
        if layer=='rooms':
            if not brep.IsSolid: raise ValueError(rid+': Room is not closed')
            if brep.SolidOrientation==Rhino.Geometry.BrepSolidOrientation.Inward: brep.Flip()
            model['rooms'].append({'id':rid,'sourceId':rid,'name':rs.ObjectName(oid) or rid,'conditioned':True,'people':0,'equipmentW':0,'ventilationACH':0})
            for face in brep.Faces:
                vs=vertices(face,scale)
                signature=json.dumps(sorted(vs),sort_keys=True).encode('utf-8')
                sid=rid+'-'+hashlib.sha256(signature).hexdigest()[:12]
                normal=face.NormalAt(face.Domain(0).Mid,face.Domain(1).Mid)
                if face.OrientationIsReversed: normal=-normal
                kind='Roof' if normal.Z>.5 else ('Floor' if normal.Z<-.5 else 'Wall')
                surface={'id':sid,'sourceId':rid,'roomId':rid,'type':kind,'boundary':'Outdoors','vertices':vs}
                model['surfaces'].append(surface); parents.append((surface,face.DuplicateFace(False)))
        else:
            for j,face in enumerate(brep.Faces):
                item={'id':rid+'-'+str(j),'sourceId':rid,'vertices':vertices(face,scale)}
                if layer=='shades': model['shades'].append(item)
                else:
                    item['type']='Window' if layer=='windows' else 'Door'
                    pending.append((item,rs.GetUserText(oid,'roomId'),face))
    for item,room_id,face in pending:
        hits=[]
        for surface,parent in parents:
            if room_id and surface['roomId']!=room_id: continue
            # Closest-point distances of all vertices are a conservative parent candidate.
            points=[Rhino.Geometry.Point3d(*[x/scale for x in p]) for p in item['vertices']]
            if all(parent.ClosestPoint(p).DistanceTo(p)<sc.doc.ModelAbsoluteTolerance for p in points):
                hits.append(surface)
        if len(hits)!=1:
            raise ValueError(item['id']+': Set roomId UserText; opening must have exactly one parent face')
        parent=hits[0]; item['surfaceId']=parent['id']
        def normal(vs):
            a,b,c=[Rhino.Geometry.Point3d(*p) for p in vs[:3]]
            return Rhino.Geometry.Vector3d.CrossProduct(b-a,c-a)
        if normal(item['vertices'])*normal(parent['vertices'])<0: item['vertices'].reverse()
        model['openings'].append(item)
    if not model['rooms']: raise ValueError('No closed rooms found on BT::Rooms')
    path=rs.SaveFileName('Boundary Tool building JSON','JSON (*.json)|*.json||')
    if not path: return
    with open(path,'wb') as stream:
        stream.write(json.dumps(model,ensure_ascii=False,indent=2).encode('utf-8'))
    print('Exported: '+path)


if __name__=='__main__':
    try: main()
    except Exception as error: rs.MessageBox(str(error),16,'Boundary Tool export')

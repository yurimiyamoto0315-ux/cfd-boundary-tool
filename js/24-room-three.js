/* Shared Three.js display and existing placement-tool bridge for AT/EP rooms. */
function atDisposeThreeRoom(host){
  host?._threeRoomView?.dispose();
  if(host)host._threeRoomView=null;
}
function atDrawThreeRoomScene(){
  const host=reviewHost(),svg=document.getElementById('atRoomScene'),slot=host?.querySelector('.at-rv-canvas-wrap');
  if(!slot||!svg)return false;
  const editing=reviewView().inspectorPanel==='edit';
  if(!window.AKLRoomThree||host.dataset.threeFailed){if(svg.parentElement!==slot)slot.append(svg);host._threeRoomView?.activate(false);host._threeRoomView?.element.remove();slot.classList.remove('has-three','is-three-edit');svg.removeAttribute('aria-hidden');host.dataset.viewerEngine='svg-fallback';if(host.dataset.threeFailed){const help=host.querySelector('.at-rv-help');if(help)help.textContent='3D表示を開始できないため簡易表示を使っています。ブラウザのハードウェアアクセラレーションを確認してください。';}return false;}
  const mesh=reviewMesh(),view=reviewView(),rooms=(mesh?.rooms||[]).filter(r=>view.floor==='all'||String(r.floor)===view.floor);
  const low=view.threeFullWalls!==true,faces=[],arrows=[];
  const source=appMode==='architrend'&&typeof atResolvedRoomFloorFaces==='function'?atResolvedRoomFloorFaces(mesh):(mesh.meshFaces||[]);
  // Clip only display copies. Native geometry, zone IDs, openings and north stay intact.
  for(const floor of new Set(rooms.map(r=>String(r.floor)))){
    const rs=rooms.filter(r=>String(r.floor)===floor),z=Math.min(...rs.map(r=>r.z)),top=low?z+.85:Math.max(...rs.map(r=>r.zTop));
    for(const f of source){
      const win=f.sslKey==='window',door=/^(extdoor_|door)/.test(f.sslKey||'');
      if(!atIsPartition(f)&&!win&&!door)continue;
      const verts=f.verts||[];if(verts.length<3)continue;
      if(Math.max(...verts.map(p=>p.z))<z-.04||Math.min(...verts.map(p=>p.z))>top)continue;
      let color=win?'#b8d9e5':door?'#df9b73':'#dce2e9';
      if(appMode==='energyplus'&&!win&&!door&&typeof idfMeshPaletteForFace==='function'){const p=idfMeshPaletteForFace(f);if(p)color='rgb('+p.r+','+p.g+','+p.b+')';}
      const room=rs.find(r=>r.epZone&&r.epZone===f.zone);
      // 3DS verts can be an unordered indexed mesh, not one polygon boundary.
      // Use the parser's triangles, including IDF openings, before story clipping.
      const polygons=f.tris?.length?f.tris.map(t=>t.map(i=>verts[i])):[verts];
      for(const polygon of polygons){if(polygon.length<3||polygon.some(p=>!p))continue;const cut=atClipRoomFace(atClipRoomFace(polygon,z-.04,true),top,false);if(cut.length>=3)faces.push({verts:cut,color,opacity:win?.4:.72,roomKey:room?.key||''});}
    }
  }
  if(typeof atParts!=='undefined'&&typeof atPartWorldMeshes==='function')for(const item of atParts.items||[]){
    if(!rooms.some(r=>String(r.floor)===String(item.floor)))continue;
    const world=atPartWorldMeshes(item);
    for(const f of world)faces.push({verts:f.verts,tris:f.tris,color:item.kind==='ac'?'#5c80af':'#d79567',opacity:1});
    const dir=item.kind==='ac'&&typeof atPartSupplyDirection==='function'?atPartSupplyDirection(world):null;
    if(dir)arrows.push({origin:{x:item.x,y:item.y,z:atPartFloorZ(item.floor)+2.15},direction:{...dir,z:0},length:.9,color:'#cf3427'});
  }
  try{
    if(host._threeMesh!==mesh){atDisposeThreeRoom(host);host._threeMesh=mesh;}
    if(!host._threeRoomView){
      host._threeRoomView=window.AKLRoomThree.create({
        onSelect(key,shift){if(shift&&appMode==='architrend')atShiftSelectRoom(key);else atSelectViewerRoom(key);},
        onPreset(id){view.plan=id==='top';host.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.view==='plan')===view.plan)));},
        onRender(){atDrawThreeToolOverlay(host);},
        onPointerDown(e){if(view.inspectorPanel!=='edit'||e.shiftKey||atRoomMergeActive()||!view.plan)return false;const overlay=host.querySelector('#atRoomScene');return typeof atPartPointerDown==='function'&&atPartPointerDown(e,overlay);},
        onPointerMove(e){const overlay=host.querySelector('#atRoomScene');if(overlay&&typeof atPartPointerMove==='function')atPartPointerMove(e,overlay);},
        onPointerUp(e){const overlay=host.querySelector('#atRoomScene');if(overlay&&typeof atPartPointerUp==='function')atPartPointerUp(e,overlay);},
        onPointerCancel(){host.querySelector('#atRoomScene')?.onpointercancel?.();},
        onDoubleClick(e){if(view.inspectorPanel==='edit'&&host._threeRoomView?.canProjectXY())host.querySelector('#atRoomScene')?.ondblclick?.(e);},
        onError(message){const help=host.querySelector('.at-rv-help');if(help){help.textContent=message;help.setAttribute('role','alert');}}
      });
      const wall=document.createElement('button');wall.type='button';wall.dataset.threeWalls='';wall.title='壁の表示高さを切り替えます。解析形状は変わりません。';wall.onclick=()=>{view.threeFullWalls=!view.threeFullWalls;atDrawRoomScene();};host._threeRoomView.element.querySelector('.akl-three-bottom').prepend(wall);
    }
    const viewer=host._threeRoomView;
    if(viewer.overlay&&viewer.overlay!==svg)viewer.overlay.remove();viewer.overlay=svg;
    // Re-inserting even into the same parent releases active pointer capture.
    // Attach only when the host was rebuilt; keep both nodes stable during drags.
    if(viewer.element.parentElement!==slot)slot.append(viewer.element);
    if(svg.parentElement!==viewer.element)viewer.element.append(svg);
    slot.classList.add('has-three');slot.classList.toggle('is-three-edit',editing);svg.setAttribute('aria-hidden',String(!editing));host.dataset.viewerEngine='three-r'+window.AKLRoomThree.revision;viewer.activate(true);
    const wall=viewer.element.querySelector('[data-three-walls]');wall.textContent=low?'壁：低く':'壁：全高';wall.setAttribute('aria-pressed',String(!low));
    const selectedKeys=typeof atRoomMergeActive==='function'&&atRoomMergeActive()?view.merge.keys:[view.selected];
    viewer.setModel({floor:view.floor,plan:view.plan,northDeg:view.northDeg,selected:view.selected,selectedKeys,faces,arrows,rooms:rooms.map(r=>({...r,color:r.floorVoid?'#e1e7ec':atRoomColor(r),labelPoint:atRoomLabelPoint(r),label:atRoomNumber(r)+'. '+atRoomTitle(r)+(r.floorVoid?'（吹抜け）':''),title:r.floor+'F · '+atRoomTitle(r)+' · '+r.area.toFixed(2)+' m²',panels:r.stair?.panels||r.stair?.treads?.map(t=>({verts:(t.ring||[]).map(p=>({...p,z:t.zTop||t.z||r.z})),kind:t.kind}))||[]}))});
    const help=host.querySelector('.at-rv-help');if(help)help.textContent=atRoomMergeActive()?'結合する区画をクリックしてください':editing&&typeof atParts!=='undefined'&&atParts.mode==='door'?'ドアを置く壁をクリックしてください · 右ドラッグで移動 · ホイール前で拡大':'左クリックで部屋選択 · 右ドラッグで回転 · Shift＋右で移動 · ホイール前で拡大';
    host.dataset.viewerEngine='three-r'+window.AKLRoomThree.revision;return true;
  }catch(error){
    console.warn('Three.js room viewer unavailable',error);slot.append(svg);atDisposeThreeRoom(host);host.dataset.threeFailed='true';host.dataset.viewerEngine='svg-fallback';slot.classList.remove('has-three','is-three-edit');svg.removeAttribute('aria-hidden');
    const help=host.querySelector('.at-rv-help');if(help)help.textContent='3D表示を開始できないため簡易表示を使っています。ブラウザのハードウェアアクセラレーションを確認してください。';
    return false;
  }
}

// Keep only existing operation marks in SVG; all building/part geometry is Three.js.
function atDrawThreeToolOverlay(host){
  const viewer=host?._threeRoomView,svg=host?.querySelector('#atRoomScene');
  if(!viewer||!svg)return;
  if(reviewView().inspectorPanel!=='edit'){svg.innerHTML='';return;}
  const matrix=svg.getScreenCTM?.();if(!matrix)return;
  const inverse=matrix.inverse(),rect=viewer.element.getBoundingClientRect();
  const project=p=>{const q=viewer.project(p),v=new DOMPoint(rect.left+q.x,rect.top+q.y).matrixTransform(inverse);return {x:v.x,y:v.y};};
  const rooms=(reviewMesh()?.rooms||[]).filter(r=>reviewView().floor==='all'||String(r.floor)===reviewView().floor);
  const defs='<defs><marker id="atStairArrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#d14e32"/></marker></defs>';
  svg.innerHTML=defs+atStairSceneHtml(rooms,project)+(typeof atPartSceneHtml==='function'?atPartSceneHtml(rooms,project):'');
  svg.querySelectorAll('polygon').forEach(el=>el.remove());
  if(!viewer.canProjectXY())svg.querySelectorAll('[data-stair-vertex],[data-part-rotate]').forEach(el=>el.remove());
}

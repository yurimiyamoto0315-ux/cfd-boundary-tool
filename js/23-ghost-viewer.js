/* Orthographic ghost viewport. No network/WebGL dependency; works from file://. */
window.createBoundaryGhostViewer=function(host,onEdit){
  const svg=host.querySelector('svg'), ns='http://www.w3.org/2000/svg';
  let model=null, selected='', yaw=-.65, tilt=.55, zoom=1, pan=[0,0], drag=null, moved=false, lastClick=null;
  const colors=['#4b9d91','#cf9854','#718fc2','#b780a0','#91a85a','#8c7eb4','#55a2bb','#b77b59'];
  const get=id=>host.querySelector('[data-view="'+id+'"]');
  const el=(tag,attrs,text)=>{const node=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v));if(text!=null)node.textContent=text;return node;};
  const owner=s=>s.roomId||model?.surfaces.find(p=>p.id===s.surfaceId)?.roomId||'';
  const levels=()=>new Map(model.rooms.map(r=>[r.id,Math.round(Math.min(...model.surfaces.filter(s=>s.roomId===r.id).flatMap(s=>s.vertices.map(p=>p[2])))*10)/10]));
  function draw(){
    svg.replaceChildren();if(!model||!model.surfaces.length)return;
    const lv=levels(), floor=get('floor').value, only=get('isolate').checked, roof=get('roof').checked;
    const visible=r=>(floor===''||String(lv.get(r))===floor)&&(!only||!selected||r===selected);
    const faces=[...model.surfaces,...model.openings,...model.shades].filter(s=>visible(owner(s))&&(roof||!['Roof','Ceiling'].includes(s.type)));
    const points=faces.flatMap(s=>s.vertices);if(!points.length)return;
    const lo=[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),hi=[0,1,2].map(i=>Math.max(...points.map(p=>p[i]))),center=lo.map((x,i)=>(x+hi[i])/2);
    const rotate=p=>{const [x,y,z]=p.map((v,i)=>v-center[i]),a=x*Math.cos(yaw)-y*Math.sin(yaw),b=x*Math.sin(yaw)+y*Math.cos(yaw);return [a,b*Math.sin(tilt)-z*Math.cos(tilt),b*Math.cos(tilt)+z*Math.sin(tilt)];};
    const rotated=points.map(rotate),span=i=>Math.max(...rotated.map(p=>p[i]))-Math.min(...rotated.map(p=>p[i]));
    const scale=Math.min(740/Math.max(span(0),1),440/Math.max(span(1),1))*zoom;
    const project=p=>{const q=rotate(p);return [450+pan[0]+q[0]*scale,280+pan[1]+q[1]*scale,q[2]];};
    const opacity=Number(get('opacity').value)/100;
    // Sort by camera depth (not world Y) so orbit and tilt preserve overlap order.
    faces.map(s=>({s,pts:s.vertices.map(project)})).sort((a,b)=>a.pts.reduce((n,p)=>n+p[2],0)/a.pts.length-b.pts.reduce((n,p)=>n+p[2],0)/b.pts.length).forEach(({s,pts})=>{
      const rid=owner(s),i=model.rooms.findIndex(r=>r.id===rid),active=rid===selected,dim=selected&&!active;
      const poly=el('polygon',{points:pts.map(p=>p.slice(0,2).join(',')).join(' '),fill:i<0?'#8ca3af':colors[i%colors.length],'fill-opacity':dim?.035:active?Math.min(.55,opacity+.15):opacity,stroke:active?'#163e43':i<0?'#527d99':colors[i%colors.length],'stroke-opacity':dim?.12:.8,'stroke-width':active?2:1,'vector-effect':'non-scaling-stroke','data-preview-face':s.id,'data-zone':rid,tabindex:0,role:'button','aria-label':(model.rooms[i]?.name||rid)+' / '+s.id});
      poly.append(el('title',{},(model.rooms[i]?.name||rid)+' — '+s.id+'（ダブルクリックで面を編集）'));svg.append(poly);
    });
    if(get('labels').checked)model.rooms.filter(r=>visible(r.id)&&(!selected||selected===r.id)).forEach(r=>{
      const pp=model.surfaces.filter(s=>s.roomId===r.id).flatMap(s=>s.vertices);if(!pp.length)return;
      const middle=[0,1,2].map(i=>(Math.min(...pp.map(p=>p[i]))+Math.max(...pp.map(p=>p[i])))/2),p=project(middle);
      svg.append(el('text',{x:p[0],y:p[1],'text-anchor':'middle',class:'ghost-label','pointer-events':'none'},r.name||r.id));
    });
    const axis=el('g',{'pointer-events':'none'});
    [[1,0,0,'X','#bc6b55'],[0,1,0,'Y','#4c9677'],[0,0,1,'Z','#638eb8']].forEach(([x,y,z,label,color])=>{
      const a=rotate(center),b=rotate(center.map((v,i)=>v+[x,y,z][i]));
      const end=[55+(b[0]-a[0])*32,510+(b[1]-a[1])*32];axis.append(el('line',{x1:55,y1:510,x2:end[0],y2:end[1],stroke:color,'stroke-width':2}),el('text',{x:end[0]+5,y:end[1]+4,fill:color,'font-size':12},label));
    });svg.append(axis);
    get('selection').textContent=selected?(model.rooms.find(r=>r.id===selected)?.name||selected)+' を選択中':'全ゾーン表示';
    host.querySelectorAll('[data-zone-button]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.zoneButton===selected)));
  }
  function choose(id){selected=id;draw();}
  function reset(){yaw=-.65;tilt=.55;zoom=1;pan=[0,0];draw();}
  get('zones').onclick=e=>{const b=e.target.closest('[data-zone-button]');if(b)choose(b.dataset.zoneButton);};
  ['opacity','isolate','labels','roof'].forEach(id=>get(id).oninput=draw);
  get('floor').onchange=()=>{selected='';zoom=1;pan=[0,0];draw();};
  get('reset').onclick=reset;
  get('all').onclick=()=>{selected='';get('isolate').checked=false;get('floor').value='';reset();};
  get('top').onclick=()=>{tilt=Math.PI/2;yaw=0;pan=[0,0];draw();};
  get('front').onclick=()=>{tilt=0;yaw=0;pan=[0,0];draw();};
  get('plus').onclick=()=>{zoom=Math.min(8,zoom*1.2);draw();};
  get('minus').onclick=()=>{zoom=Math.max(.25,zoom/1.2);draw();};
  svg.onpointerdown=e=>{if(e.button!==0&&e.button!==1&&e.button!==2)return;drag={x:e.clientX,y:e.clientY,yaw,tilt,pan:pan.slice(),move:e.shiftKey||e.button!==0,face:e.target.closest('[data-preview-face]')?.dataset.previewFace,zone:e.target.closest('[data-zone]')?.dataset.zone};moved=false;svg.setPointerCapture(e.pointerId);};
  svg.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)<4&&!moved)return;moved=true;if(drag.move){const factor=900/svg.getBoundingClientRect().width;pan=[drag.pan[0]+dx*factor,drag.pan[1]+dy*factor];}else{yaw=drag.yaw+dx*.008;tilt=Math.max(-1.5,Math.min(Math.PI/2,drag.tilt+dy*.008));}draw();};
  svg.onpointerup=e=>{if(!drag)return;const id=drag.zone,face=drag.face;drag=null;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);if(!moved&&id){const now=Date.now();if(lastClick&&lastClick.face===face&&now-lastClick.time<350){lastClick=null;onEdit(face);}else{lastClick={face,time:now};choose(id);}}};
  svg.onpointercancel=()=>{drag=null;};
  svg.oncontextmenu=e=>e.preventDefault();
  svg.ondblclick=e=>{const f=e.target.closest('[data-preview-face]');if(f)onEdit(f.dataset.previewFace);};
  svg.onkeydown=e=>{const z=e.target.closest('[data-zone]');if((e.key==='Enter'||e.key===' ')&&z){e.preventDefault();choose(z.dataset.zone);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')yaw-=.12;if(e.key==='ArrowRight')yaw+=.12;if(e.key==='ArrowUp')tilt=Math.min(Math.PI/2,tilt+.12);if(e.key==='ArrowDown')tilt=Math.max(-1.5,tilt-.12);if(e.key==='+')zoom=Math.min(8,zoom*1.2);if(e.key==='-')zoom=Math.max(.25,zoom/1.2);draw();}};
  svg.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.25,Math.min(8,zoom*Math.exp(-e.deltaY*.001)));draw();},{passive:false});
  return {update(m){model=m;if(!m)return;if(!m.rooms.some(r=>r.id===selected))selected='';const lv=levels(),old=get('floor').value;get('floor').replaceChildren(new Option('すべての高さ',''));[...new Set(lv.values())].filter(Number.isFinite).sort((a,b)=>a-b).forEach(z=>get('floor').append(new Option('床高さ '+z+' m',String(z))));get('floor').value=[...get('floor').options].some(o=>o.value===old)?old:'';get('zones').replaceChildren();m.rooms.forEach((r,i)=>{const b=document.createElement('button');b.type='button';b.dataset.zoneButton=r.id;b.textContent=r.name||r.id;b.style.setProperty('--zone-color',colors[i%colors.length]);get('zones').append(b);});draw();},draw};
};

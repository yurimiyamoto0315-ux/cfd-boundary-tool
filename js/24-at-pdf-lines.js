/* Pure PDF.js operator-list geometry. No PDF, DOM, file or network access. */
(function(root){
 'use strict';
 const DEFAULT_OPS={setLineWidth:2,setDash:6,setGState:9,save:10,restore:11,transform:12,moveTo:13,lineTo:14,curveTo:15,curveTo2:16,curveTo3:17,closePath:18,rectangle:19,stroke:20,closeStroke:21,fill:22,eoFill:23,fillStroke:24,eoFillStroke:25,closeFillStroke:26,closeEOFillStroke:27,endPath:28,clip:29,eoClip:30,setTextRenderingMode:38,paintFormXObjectBegin:74,paintFormXObjectEnd:75,beginGroup:76,endGroup:77,beginAnnotation:80,endAnnotation:81,constructPath:91};
 const finite=Number.isFinite,vector=x=>Array.isArray(x)||ArrayBuffer.isView(x),EPS=.05;
 const matrix=x=>vector(x)&&x.length===6&&Array.from(x).every(finite);
 function multiply(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
 function atPdfRulingLines(operatorList,options){
  const opt=options||{},ops={...DEFAULT_OPS,...opt.ops},diagnostics=[],counts={operators:0,paths:0,lines:0,skippedPaths:0};
  let complete=true;
  const issue=code=>{complete=false;if(!diagnostics.some(d=>d.code===code))diagnostics.push({code});};
  const fail=code=>{issue(code);return {complete:false,lines:[],diagnostics,counts};};
  const width=opt.width,height=opt.height,viewport=opt.viewportTransform;
  if(!operatorList||!vector(operatorList.fnArray)||!vector(operatorList.argsArray)||operatorList.fnArray.length!==operatorList.argsArray.length||!matrix(viewport)||!finite(width)||!finite(height)||width<=0||height<=0)return fail('PDF_RULING_INPUT_INVALID');
  if(operatorList.fnArray.length>200000)return fail('PDF_RULING_LIMIT');
  let state={m:[1,0,0,1,0,0],clip:[0,0,width,height],unknownClip:false,dashed:false,strokeAlpha:1,fillAlpha:1};
  const stack=[],lines=[],seen=new Set();let path=[],rectangles=[],current=null,start=null,pendingClip=false,onlyRectangles=true;
  const point=(x,y)=>{const m=multiply(viewport,state.m),px=m[0]*x+m[2]*y+m[4],py=m[1]*x+m[3]*y+m[5];return {x:px,y:height-py};};
  function clear(){path=[];rectangles=[];current=null;start=null;pendingClip=false;onlyRectangles=true;}
  function copyState(){return {...state,m:state.m.slice(),clip:state.clip&&state.clip.slice()};}
  function axisRectangle(points){
   if(points.length!==4||points.some(p=>!finite(p.x)||!finite(p.y)))return null;
   if(points.some((p,i)=>Math.abs(p.x-points[(i+1)%4].x)>EPS&&Math.abs(p.y-points[(i+1)%4].y)>EPS))return null;
   return [Math.min(...points.map(p=>p.x)),Math.min(...points.map(p=>p.y)),Math.max(...points.map(p=>p.x)),Math.max(...points.map(p=>p.y))];
  }
  function intersectClip(box){
   if(!box){state.unknownClip=true;issue('PDF_RULING_CLIP_UNSUPPORTED');return;}
   const previous=state.clip;state.clip=[Math.max(previous[0],box[0]),Math.max(previous[1],box[1]),Math.min(previous[2],box[2]),Math.min(previous[3],box[3])];
  }
  function add(a,b,respectDash=true){
   if(state.unknownClip||(respectDash&&state.dashed)){counts.skippedPaths++;if(respectDash&&state.dashed)issue('PDF_RULING_DASH_UNSUPPORTED');return;}
   if(!a||!b||![a.x,a.y,b.x,b.y].every(finite))throw Error();
   const dx=Math.abs(a.x-b.x),dy=Math.abs(a.y-b.y),clip=state.clip;
   if(clip[2]<=clip[0]||clip[3]<=clip[1])return;
   let line;
   if(dy<=EPS&&dx>1){const y=(a.y+b.y)/2;if(y<clip[1]-EPS||y>clip[3]+EPS)return;line={x1:Math.max(clip[0],Math.min(a.x,b.x)),y1:y,x2:Math.min(clip[2],Math.max(a.x,b.x)),y2:y};}
   else if(dx<=EPS&&dy>1){const x=(a.x+b.x)/2;if(x<clip[0]-EPS||x>clip[2]+EPS)return;line={x1:x,y1:Math.max(clip[1],Math.min(a.y,b.y)),x2:x,y2:Math.min(clip[3],Math.max(a.y,b.y))};}
   else return;
   if(Math.hypot(line.x2-line.x1,line.y2-line.y1)<=1)return;
   const key=[line.x1,line.y1,line.x2,line.y2].map(v=>Math.round(v*1000)).join(',');
   if(!seen.has(key)){seen.add(key);lines.push(line);if(lines.length>50000)throw Error('LIMIT');}
  }
  function consume(stroke,fill,close){
   counts.paths++;if(close&&current&&start)path.push([current,start]);
   if(stroke&&state.strokeAlpha>0)path.forEach(edge=>add(...edge));
   if(fill&&state.fillAlpha>0&&onlyRectangles){
    for(const box of rectangles){if(!box)continue;const dx=box[2]-box[0],dy=box[3]-box[1];
     if(dy>0&&dy<=1&&dx>3)add({x:box[0],y:(box[1]+box[3])/2},{x:box[2],y:(box[1]+box[3])/2},false);
     else if(dx>0&&dx<=1&&dy>3)add({x:(box[0]+box[2])/2,y:box[1]},{x:(box[0]+box[2])/2,y:box[3]},false);
    }
   }
   if(pendingClip)intersectClip(onlyRectangles&&rectangles.length===1?rectangles[0]:null);
   clear();
  }
  function command(name,args){
   const a=args||[];
   if(name===ops.moveTo){onlyRectangles=false;current=point(a[0],a[1]);start=current;}
   else if(name===ops.lineTo){onlyRectangles=false;const end=point(a[0],a[1]);if(current)path.push([current,end]);current=end;}
   else if(name===ops.rectangle){
    const points=[point(a[0],a[1]),point(a[0]+a[2],a[1]),point(a[0]+a[2],a[1]+a[3]),point(a[0],a[1]+a[3])];
    points.forEach((p,i)=>path.push([p,points[(i+1)%4]]));rectangles.push(axisRectangle(points));current=points[0];start=current;
   }else if(name===ops.closePath){if(current&&start)path.push([current,start]);current=start;}
   else if(name===ops.curveTo||name===ops.curveTo2||name===ops.curveTo3){onlyRectangles=false;current=point(a[a.length-2],a[a.length-1]);}
   else throw Error();
  }
  try{for(let index=0;index<operatorList.fnArray.length;index++){
   counts.operators++;const op=operatorList.fnArray[index],args=operatorList.argsArray[index]||[];
   // Annotation appearances are not evidence of source table cells, and text
   // clipping requires glyph outlines that this ruling-only decoder lacks.
   if(op===ops.beginAnnotation||op===ops.endAnnotation)return fail('PDF_RULING_ANNOTATION_UNSUPPORTED');
   if(op===ops.setTextRenderingMode&&Number(args[0])>=4){state.unknownClip=true;issue('PDF_RULING_TEXT_CLIP_UNSUPPORTED');}
   else if(op===ops.save){stack.push(copyState());}
   else if(op===ops.restore){if(!stack.length)throw Error();state=stack.pop();}
   else if(op===ops.transform){if(!matrix(args))throw Error();state.m=multiply(state.m,args);}
   else if(op===ops.paintFormXObjectBegin||op===ops.beginGroup){
    stack.push(copyState());const group=op===ops.beginGroup?args[0]||{}:null,m=group?group.matrix:args[0],box=group?group.bbox:args[1];
    if(m){if(!matrix(m))throw Error();state.m=multiply(state.m,m);}
    if(box){if(!vector(box)||box.length!==4||!Array.from(box).every(finite))throw Error();intersectClip(axisRectangle([point(box[0],box[1]),point(box[2],box[1]),point(box[2],box[3]),point(box[0],box[3])]));}
    if(group&&group.smask){state.unknownClip=true;issue('PDF_RULING_MASK_UNSUPPORTED');}
   }
   else if(op===ops.paintFormXObjectEnd||op===ops.endGroup){if(!stack.length)throw Error();state=stack.pop();}
   else if(op===ops.setDash){state.dashed=vector(args[0])&&Array.from(args[0]).some(v=>v!==0);}
   else if(op===ops.setGState){
    for(const [key,value] of args[0]||[]){if(key==='CA')state.strokeAlpha=finite(value)?value:0;else if(key==='ca')state.fillAlpha=finite(value)?value:0;else if(key==='D')state.dashed=vector(value?.[0])&&Array.from(value[0]).some(v=>v!==0);else if(key==='SMask'&&value&&value!=='None'){state.unknownClip=true;issue('PDF_RULING_MASK_UNSUPPORTED');}}
   }
   else if(op===ops.constructPath){
    const names=args[0],raw=args[1];if(!vector(names)||!vector(raw))throw Error();const coordinates=Array.from(raw);if(!coordinates.every(finite))throw Error();let offset=0;
    for(const name of names){const size=name===ops.rectangle?4:name===ops.moveTo||name===ops.lineTo?2:name===ops.curveTo?6:name===ops.curveTo2||name===ops.curveTo3?4:name===ops.closePath?0:-1;if(size<0||offset+size>coordinates.length)throw Error();command(name,coordinates.slice(offset,offset+size));offset+=size;}
    if(offset!==coordinates.length)throw Error();
   }
   else if([ops.moveTo,ops.lineTo,ops.rectangle,ops.curveTo,ops.curveTo2,ops.curveTo3,ops.closePath].includes(op))command(op,Array.from(args));
   else if(op===ops.clip||op===ops.eoClip)pendingClip=true;
   else if([ops.stroke,ops.closeStroke,ops.fill,ops.eoFill,ops.fillStroke,ops.eoFillStroke,ops.closeFillStroke,ops.closeEOFillStroke,ops.endPath].includes(op))consume([ops.stroke,ops.closeStroke,ops.fillStroke,ops.eoFillStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(op),[ops.fill,ops.eoFill,ops.fillStroke,ops.eoFillStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(op),[ops.closeStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(op));
  }}catch(error){return fail(error.message==='LIMIT'?'PDF_RULING_LIMIT':'PDF_RULING_OPERATOR_INVALID');}
  if(stack.length)return fail('PDF_RULING_STATE_UNBALANCED');
  counts.lines=lines.length;
  return {complete,lines,diagnostics,counts};
 }
 root.atPdfRulingLines=atPdfRulingLines;
 if(typeof module!=='undefined'&&module.exports)module.exports={atPdfRulingLines};
})(typeof window!=='undefined'?window:globalThis);

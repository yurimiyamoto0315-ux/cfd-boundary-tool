/* Local adaptation of Joly UI's Liquid Metal Button (MIT).
 * The unchanged Paper Design GLSL is in vendor/paper-liquid-metal.js.
 * One shared renderer paints only the hovered control's rim.
 * See vendor/liquid-metal-NOTICE.txt for source and license details.
 */
(function(){
  'use strict';
  const shader=window.BoundaryLiquidMetalShader;if(!shader)return;
  const selector='.header-name,.header-utils button,.header-save-group button,.workflow-tabs button,#journeyFooter button';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),contrast=matchMedia('(forced-colors: active)'),pointer=matchMedia('(any-hover: hover) and (any-pointer: fine)');
  // These are the supplied demo's material parameters; hover runs at its 1x speed.
  const uniforms={u_repetition:4,u_softness:.5,u_shiftRed:.3,u_shiftBlue:.3,u_distortion:0,u_contour:0,u_angle:45,u_scale:8,u_shape:1,u_offsetX:.1,u_offsetY:-.1,u_imageAspectRatio:1,u_isImage:false};
  let renderer=null,failed=false,host=null,point=null,raf=0,last=0,phase=0,frames=0;
  const allowed=()=>!document.hidden&&!reduced.matches&&!contrast.matches&&pointer.matches;
  const control=element=>element instanceof Element?element.closest(selector):null;
  function compile(gl,type,source){
    const s=gl.createShader(type);if(!s)throw Error('METAL_SHADER');
    gl.shaderSource(s,source);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);throw Error('METAL_SHADER');}return s;
  }
  function init(){
    if(renderer)return true;if(failed)return false;
    const canvas=document.createElement('canvas'),layer=document.createElement('span');
    canvas.className='metal-rim-canvas';layer.className='metal-rim-layer';layer.setAttribute('aria-hidden','true');layer.append(canvas);
    let gl,program,buffer,vertex,fragment,texture;
    try{
      gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'low-power'});if(!gl)throw Error('METAL_UNAVAILABLE');
      vertex=compile(gl,gl.VERTEX_SHADER,shader.vertex);fragment=compile(gl,gl.FRAGMENT_SHADER,shader.fragment);
      program=gl.createProgram();if(!program)throw Error('METAL_PROGRAM');
      gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('METAL_PROGRAM');
      gl.deleteShader(vertex);gl.deleteShader(fragment);vertex=fragment=null;gl.useProgram(program);
      buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
      // Complete the shader's unused image branch on strict drivers.
      texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      for(const [key,value]of Object.entries(uniforms)){
        const location=gl.getUniformLocation(program,key);
        if(location!==null){if(typeof value==='boolean')gl.uniform1i(location,Number(value));else gl.uniform1f(location,value);}
      }
      // The original material viewport stays small, independent of button size.
      const ratio=Math.min(2,Math.max(1,devicePixelRatio||1));canvas.width=Math.round(142*ratio);canvas.height=Math.round(46*ratio);
      gl.viewport(0,0,canvas.width,canvas.height);
      gl.uniform2f(gl.getUniformLocation(program,'u_resolution'),canvas.width,canvas.height);gl.uniform1f(gl.getUniformLocation(program,'u_pixelRatio'),ratio);
      renderer={gl,canvas,layer,program,buffer,texture,time:gl.getUniformLocation(program,'u_time')};
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();clear();renderer=null;failed=true;});
      return true;
    }catch{
      if(gl){if(vertex)gl.deleteShader(vertex);if(fragment)gl.deleteShader(fragment);if(buffer)gl.deleteBuffer(buffer);if(texture)gl.deleteTexture(texture);if(program)gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();}
      failed=true;return false;
    }
  }
  function fit(){
    if(!host||!renderer)return;
    const style=getComputedStyle(host),edges=['Top','Right','Bottom','Left'].map(side=>parseFloat(style['border'+side+'Width'])||0);
    renderer.layer.style.inset=edges.map(value=>-value+'px').join(' ');
    renderer.layer.style.padding=Math.max(2,Math.min(4,Math.max(...edges)))+'px';
  }
  function draw(){
    const r=renderer;if(!r)return;r.gl.useProgram(r.program);r.gl.uniform1f(r.time,phase);r.gl.drawArrays(r.gl.TRIANGLES,0,6);frames++;
  }
  function clear(){
    if(raf)cancelAnimationFrame(raf);raf=0;last=0;
    if(host){resize.unobserve(host);host.classList.remove('metal-surface','metal-relative');}
    renderer?.layer.remove();host=null;
  }
  function tick(now){
    raf=0;
    if(!allowed()||!host?.isConnected||host.matches(':disabled,[aria-disabled="true"]')||!host.matches(':hover')){clear();return;}
    phase+=(last?Math.min(64,now-last):0)*.001;last=now;draw();raf=requestAnimationFrame(tick);
  }
  function choose(target){
    const next=allowed()&&target?.isConnected&&!target.matches(':disabled,[aria-disabled="true"]')&&target.getClientRects().length?target:null;
    if(next===host)return;clear();if(!next||!init())return;
    host=next;if(getComputedStyle(host).position==='static')host.classList.add('metal-relative');
    host.classList.add('metal-surface');fit();host.append(renderer.layer);resize.observe(host);draw();raf=requestAnimationFrame(tick);
  }
  function reconcile(){choose(point?control(document.elementFromPoint(point.x,point.y)):null);}
  const resize=new ResizeObserver(fit);
  document.addEventListener('pointerover',event=>{
    if(!['mouse','pen'].includes(event.pointerType)){point=null;clear();return;}
    point={x:event.clientX,y:event.clientY};choose(control(event.target));
  });
  document.addEventListener('pointermove',event=>{
    if(!['mouse','pen'].includes(event.pointerType))return;
    point={x:event.clientX,y:event.clientY};const target=control(event.target);
    if(target!==host)choose(target);
  },{passive:true});
  document.addEventListener('pointerout',event=>{
    if(!['mouse','pen'].includes(event.pointerType)){point=null;clear();return;}
    if(host&&event.relatedTarget instanceof Node&&host.contains(event.relatedTarget))return;
    point=event.relatedTarget?{x:event.clientX,y:event.clientY}:null;choose(control(event.relatedTarget));
  });
  const reset=()=>{point=null;clear();};
  document.addEventListener('pointercancel',reset);window.addEventListener('blur',reset);
  document.addEventListener('visibilitychange',()=>document.hidden?reset():reconcile());
  document.addEventListener('scroll',reconcile,{capture:true,passive:true});
  window.addEventListener('boundary-journey-changed',reconcile);
  // Stage buttons are rebuilt when progress changes; do not retain removed nodes.
  const nav=document.getElementById('sidenav');if(nav)new MutationObserver(()=>{if(host&&!host.isConnected)reconcile();}).observe(nav,{childList:true,subtree:true});
  for(const media of [reduced,contrast,pointer])media.addEventListener('change',reconcile);
  // Effect state only; no form values, model data or persistence.
  window.boundaryMetalMotion={inspect:()=>({target:host?.id||host?.dataset.journeyGo||host?.classList[0]||null,renderer:renderer?'webgl':'static',running:!!raf,frames,phase,failed}),refresh:reconcile};
})();

/* Keep the user's place across synchronous apply/re-render operations. No field values are restored here. */
(function(){
  'use strict';
  const selector='#atApplyImportBtn,#winPresetApply,[data-thermal-apply],[data-thermal-face-apply],[data-attic-apply],[data-action="commit"],[data-action="floor-opening-apply"],[data-action="merge-apply"],[data-floor-confirm],[data-assign-window],#atWindowRecheckBtn';
  let serial=0;
  function locator(el){
    if(el.id)return ()=>document.getElementById(el.id);
    for(const attr of ['data-boundary-action','data-thermal-apply','data-thermal-face-apply','data-attic-apply','data-floor-confirm','data-assign-window','data-action'])if(el.hasAttribute(attr)){
      const value=el.getAttribute(attr);return ()=>[...document.querySelectorAll('['+attr+']')].find(node=>node.getAttribute(attr)===value)||(attr==='data-boundary-action'&&value==='merge'?document.querySelector('[data-boundary-action="room"]'):attr==='data-action'&&value==='merge-apply'?document.querySelector('[data-action="commit"]'):null);
    }
    const classes=[...el.classList].filter(c=>/^[A-Za-z][\w-]*$/.test(c));
    if(classes.length){
      const scope=el.parentElement?.closest('[id]'),scopeId=scope?.id,query='.'+classes[0];
      const index=[...(scope||document).querySelectorAll(query)].indexOf(el);
      return ()=>el.isConnected?el:(scopeId?document.getElementById(scopeId):document)?.querySelectorAll(query)[index]||null;
    }
    return ()=>el.isConnected?el:null;
  }
  function capture(button){
    const anchor=button.closest('[data-boundary-action]')||button,resolve=locator(anchor),rect=anchor.getBoundingClientRect(),containers=[];
    for(let node=anchor.parentElement;node&&node!==document.body;node=node.parentElement)if(node.scrollHeight>node.clientHeight+1||node.scrollWidth>node.clientWidth+1)containers.push({resolve:locator(node),top:node.scrollTop,left:node.scrollLeft,vertical:node.scrollHeight>node.clientHeight+1});
    const viewer=button.closest('#atRoomViewer');
    if(viewer)for(const node of viewer.querySelectorAll('#atRoomEditor,.at-rv-lists,.at-rv-list'))if(!containers.some(c=>c.resolve()===node))containers.push({resolve:locator(node),top:node.scrollTop,left:node.scrollLeft});
    return {resolve,top:rect.top,left:window.scrollX,y:window.scrollY,modal:!!button.closest('dialog[open]'),containers,button:locator(button),mesh:typeof reviewMesh==='function'?reviewMesh():null,token:++serial};
  }
  function restore(saved){
    if(saved.token!==serial)return;
    const first=()=>{
      if(saved.token!==serial||typeof reviewMesh==='function'&&saved.mesh!==reviewMesh())return;
      for(const entry of saved.containers){const node=entry.resolve();if(node)node.scrollTo({top:entry.top,left:entry.left,behavior:'instant'});}
      const anchor=saved.resolve(),delta=anchor?.isConnected?anchor.getBoundingClientRect().top-saved.top:0;
      if(saved.modal){const container=saved.containers.find(c=>c.vertical)?.resolve();if(container)container.scrollTo({top:container.scrollTop+delta,behavior:'instant'});window.scrollTo({left:saved.left,top:saved.y,behavior:'instant'});}
      else window.scrollTo({left:saved.left,top:anchor?window.scrollY+delta:saved.y,behavior:'instant'});
      saved.button()?.focus({preventScroll:true});
    };
    requestAnimationFrame(()=>{first();requestAnimationFrame(first);});
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest?.(selector);if(!button||button.disabled)return;
    const saved=capture(button);
    // Target/ancestor action handlers finish before the microtask. Later actions supersede this one.
    queueMicrotask(()=>restore(saved));
  },true);
  for(const name of ['pointerdown','wheel','keydown'])document.addEventListener(name,()=>{serial++;},{capture:true,passive:true});
  window.boundaryActionMessage=function(el,text,state='applied'){
    if(!el)return;el.textContent=text;el.dataset.state=state;el.classList.add('boundary-action-status');el.setAttribute('role','status');el.setAttribute('aria-live','polite');
  };
})();

/* Header composition only: move the existing controls; retain their events and saved state. */
(function(){
  'use strict';
  const header=document.querySelector('.app-header'),brand=header?.querySelector('.header-name'),utilities=header?.querySelector('.header-utils'),actions=header?.querySelector('.header-actions');
  const current=document.getElementById('journeyCompactCurrent'),status=header?.querySelector('.header-status'),save=actions?.querySelector('button');
  if(!header||!brand||!utilities||!actions||!current||!status||!save)return;
  const mark=document.createElement('img');mark.className='header-brand-mark';mark.src='assets/brand/flow-mark.svg';mark.alt='';mark.width=48;mark.height=44;
  const copy=document.createElement('span');copy.className='header-brand-copy';
  const title=document.createElement('span');title.className='header-brand-title';title.textContent='CFD Boundary Tool';copy.append(title,current);brand.prepend(mark,copy);
  const group=document.createElement('div');group.className='header-save-group';save.classList.add('header-save-main');
  const toggle=document.createElement('button');toggle.id='headerToolsToggle';toggle.type='button';toggle.hidden=true;toggle.setAttribute('aria-label','入力方法・バックアップ・読み込みなどの操作');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','headerTools');
  toggle.innerHTML='<span>データ</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
  group.append(save,toggle);header.append(group,status);utilities.id='headerTools';utilities.setAttribute('role','group');utilities.setAttribute('aria-label','入力方法とデータの操作');
  const compact=matchMedia('(min-width:0px)');let expanded=false;
  function sync(){
    const small=compact.matches;toggle.hidden=!small;utilities.hidden=small&&!expanded;
    utilities.classList.toggle('is-tools-open',small&&expanded);toggle.setAttribute('aria-expanded',String(small&&expanded));
  }
  function setOpen(open,focus){
    if(open){const nav=document.getElementById('navToggle');if(nav?.getAttribute('aria-expanded')==='true')nav.click();}
    expanded=!!open;sync();
    if(focus){const target=open?utilities.querySelector('button:not([hidden])'):toggle;target?.focus({preventScroll:true});}
  }
  toggle.addEventListener('click',()=>setOpen(!expanded,!expanded));
  document.addEventListener('pointerdown',event=>{if(compact.matches&&expanded&&!utilities.contains(event.target)&&!group.contains(event.target))setOpen(false,false);});
  document.addEventListener('focusin',event=>{if(compact.matches&&expanded&&!utilities.contains(event.target)&&!group.contains(event.target))setOpen(false,false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&compact.matches&&expanded){setOpen(false,true);event.preventDefault();}});
  utilities.addEventListener('click',event=>{if(compact.matches&&event.target.closest('button'))setOpen(false,true);});
  compact.addEventListener('change',()=>{expanded=false;sync();});
  const saveInfo=document.getElementById('saveInfo');
  if(saveInfo){const describe=()=>saveInfo.title=saveInfo.textContent;describe();new MutationObserver(describe).observe(saveInfo,{childList:true,characterData:true,subtree:true});}
  document.body.classList.add('has-brand-header');sync();
})();

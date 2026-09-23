// ========================= 初期化 =========================
initSelectors();
let saved=null;
try{ saved = JSON.parse(localStorage.getItem(STORE_KEY)); }catch(err){}

document.getElementById('atCsvInput').addEventListener('change', function(){ onAtCsvSelected(this); });
document.getElementById('atPdfInput').addEventListener('change', function(){ onAtPdfSelected(this); });
const at3dsInput = document.getElementById('at3dsInput');
if(at3dsInput){
  at3dsInput.addEventListener('click', function(){ this.value=''; });
  at3dsInput.addEventListener('change', function(){ onAt3dsSelected(this); });
}
document.getElementById('epIdfInput').addEventListener('click', function(){ this.value=''; });
document.getElementById('epSqlInput').addEventListener('click', function(){ this.value=''; });
document.getElementById('epEpwInput').addEventListener('click', function(){ this.value=''; });
document.getElementById('epIdfInput').addEventListener('change', function(){ onEpIdfSelected(this); });
document.getElementById('epSqlInput').addEventListener('change', function(){ onEpSqlSelected(this); });
document.getElementById('epEpwInput').addEventListener('change', function(){ onEpEpwSelected(this); });
document.getElementById('atUnassignedList').addEventListener('input', function(){
  syncUnassignedFromDom();
  refreshNeedManual();
});

const _runAllOrig = runAll;
runAll = function(){
  _runAllOrig();
  if(appMode==='architrend') refreshNeedManual();
};

(function bootMode(){
  const mode = (saved && saved.mode) || 'manual';
  const modeSaved = loadModeState(mode) || (saved && saved.mode===mode ? saved : null);
  if(mode==='architrend') startArchitrendMode(modeSaved);
  else if(mode==='energyplus') startEnergyPlusMode(modeSaved);
  else startManualMode(modeSaved);
})();

(function(){
  const ids=['common','step1','step2','step3','idfmesh','ssl','step4','step5','transfer'];
  const nav=document.getElementById('sidenav');
  const toggle=document.getElementById('navToggle');
  const backdrop=document.getElementById('navBackdrop');
  if(!nav) return;

  function headerOffset(){
    const chrome=document.querySelector('.app-chrome');
    return chrome ? chrome.offsetHeight + 24 : 132;
  }
  function setCurrent(){
    let current=ids[0];
    const y=headerOffset();
    ids.forEach(id=>{
      const el=document.getElementById(id);
      if(el && el.getBoundingClientRect().top <= y) current=id;
    });
    nav.querySelectorAll('a[href^="#"]').forEach(a=>{
      a.classList.toggle('is-current', a.getAttribute('href')==='#'+current);
    });
  }
  function setNavOpen(open){
    document.body.classList.toggle('nav-open', open);
    if(toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  window.addEventListener('scroll', setCurrent, {passive:true});
  window.addEventListener('resize', setCurrent);
  setCurrent();

  if(toggle){
    toggle.addEventListener('click', ()=>{
      setNavOpen(!document.body.classList.contains('nav-open'));
    });
  }
  if(backdrop) backdrop.addEventListener('click', ()=> setNavOpen(false));
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'){
      if(typeof atPartCancelPendingAc==='function' && atPartCancelPendingAc()) return;
      setNavOpen(false);
    }
  });
  nav.querySelectorAll('a').forEach(a=>{
    a.addEventListener('click', ()=> setNavOpen(false));
  });

  const tabs=document.getElementById('modeTabs');
  if(tabs){
    tabs.addEventListener('click', e=>{
      const btn=e.target.closest('[data-mode]');
      if(!btn) return;
      selectMode(btn.getAttribute('data-mode'));
    });
    tabs.addEventListener('keydown', e=>{
      const btns=[...tabs.querySelectorAll('[data-mode]')];
      const i=btns.findIndex(b=>b.getAttribute('aria-selected')==='true');
      if(e.key==='ArrowRight' && i<btns.length-1){ e.preventDefault(); selectMode(btns[i+1].getAttribute('data-mode')); btns[i+1].focus(); }
      if(e.key==='ArrowLeft' && i>0){ e.preventDefault(); selectMode(btns[i-1].getAttribute('data-mode')); btns[i-1].focus(); }
    });
  }
})();

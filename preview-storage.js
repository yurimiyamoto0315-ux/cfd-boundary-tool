// GitHub Pages project sites share an origin. Keep preview saves separate.
(function(){
  if(!location.pathname.startsWith('/cfd-boundary-tool-preview/'))return;
  const prefix='boundary-preview-20261027:';
  for(const method of ['getItem','setItem','removeItem']){
    const original=Storage.prototype[method];
    Storage.prototype[method]=function(key,...args){return original.call(this,prefix+String(key),...args);};
  }
})();

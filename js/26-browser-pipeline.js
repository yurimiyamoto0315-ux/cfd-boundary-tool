/* The browser worker receives models and SQL directly; no application data is sent to a server. */
(function(){
  'use strict';

  window.createBrowserPipelineClient=function(onFatal){
    const worker=new Worker(new URL('web_pipeline/worker.mjs?v=20261126a',document.baseURI),{type:'module'});
    const pending=new Map();
    let nextId=0,closed=false,readyResolve,readyReject;
    const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const timer=setTimeout(()=>fail(new Error('準備が時間内に完了しませんでした。通信を確認して再試行してください。')),120000);

    function fail(error){
      if(closed)return;
      closed=true;clearTimeout(timer);worker.terminate();
      readyReject(error);
      for(const entry of pending.values())entry.reject(error);
      pending.clear();
      if(onFatal)onFatal(error);
    }
    worker.onerror=event=>fail(new Error(event.message||'ブラウザ内の処理を開始できませんでした。'));
    worker.onmessageerror=()=>fail(new Error('ブラウザ内の処理との通信に失敗しました。'));
    worker.onmessage=({data})=>{
      if(data?.type==='ready'){clearTimeout(timer);readyResolve();return;}
      if(data?.type==='error'){fail(new Error(data.error||'ブラウザ内の処理を開始できませんでした。'));return;}
      const entry=pending.get(data?.id);
      if(!entry)return;
      pending.delete(data.id);
      if(data.ok)entry.resolve(data.result);
      else entry.reject(new Error(data.error||'ブラウザ内の処理に失敗しました。'));
    };

    async function call(action,payload={}){
      await ready;
      if(closed)throw new Error('ブラウザ内の処理を再準備してください。');
      return new Promise((resolve,reject)=>{
        const id=++nextId;
        pending.set(id,{resolve,reject});
        try{worker.postMessage({id,action,...payload});}
        catch(error){pending.delete(id);reject(error);}
      });
    }
    function close(){
      if(closed)return;
      closed=true;clearTimeout(timer);worker.terminate();
      const error=new Error('ブラウザ内の処理を終了しました。');
      readyReject(error);
      for(const entry of pending.values())entry.reject(error);
      pending.clear();
    }
    return {call,close};
  };
})();

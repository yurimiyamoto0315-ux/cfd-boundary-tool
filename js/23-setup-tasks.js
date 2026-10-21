/* Completion is based on provenance or an explicit confirmation, never just a default value. */
(function(){
  'use strict';
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const clone=x=>JSON.parse(JSON.stringify(x));
  const physics=c=>Object.fromEntries(Object.entries(c||{}).filter(([k])=>!['label','architrendSource','architrendU','architrendKind','architrendFields','guideKind'].includes(k)));
  const kind=c=>c?.kind||(c?.u!=null&&!c.layers?.length?'glazing':c?.resistance!=null&&!c.layers?.length?'nomass':'layers');
  function materialOrigin(m,key,prop){
    const c=m.constructions[key],record=m.architrendImport?.applied?.['material:'+key]?.value;
    if(!c)return null;
    const own=c.architrendFields?.[prop];
    if(own&&same(c[prop],own.value))return own.source;
    if(!c.architrendSource||!record)return null;
    if(prop==='construction')return same(physics(c),physics(record))?c.architrendSource:null;
    if(prop==='u'&&c.architrendU!=null&&same(c.u,record.u))return c.architrendSource.split(' / ')[0];
    if(prop==='shgc'&&c.architrendSource.includes('垂直窓η')&&same(c.shgc,record.shgc))return c.architrendSource;
    return null;
  }
  window.boundarySetupTasks=function(m){
    if(!m)return [];
    const tasks=[],confirmed=m.setupReview?.confirmed||{};
    function add(task){
      task.fields.forEach(f=>{
        f.value=f.get(m);
        f.valid=f.validate?f.validate(f.value):true;
        const origin=f.origin?.(m);
        f.status=f.valid&&origin?(/CSV|PDF/.test(origin)?'imported':'provided'):f.valid&&same(confirmed[f.id]?.value,f.value)?'confirmed':'pending';
        f.source=origin||'';
      });
      task.pending=task.fields.filter(f=>f.status==='pending');tasks.push(task);
    }
    const numeric=(id,title,get,set,unit='',nullable=false)=>({id,title,type:'number',get,set,unit,validate:v=>nullable&&v===null||typeof v==='number'&&Number.isFinite(v)&&v>=0});
    function materialTask(part,title,list){
      for(const key of [...new Set(list.map(s=>s.construction))]){
        const ids=list.filter(s=>s.construction===key).map(s=>s.id);
        const id='material:'+part+':'+ids.slice().sort().join('|');
        add({id,title:title+(new Set(list.map(s=>s.construction)).size>1?' / '+key:''),step:0,advanced:['door','partition'].includes(part)?'pipeMaterials':null,description:ids.length+'面の仕様です。いまの仕様を使う場合も、内容を確認して進めてください。',fields:[{
          id,title:'使用する仕様',type:'construction',part,materialKey:key,surfaceIds:ids,
          get:x=>ids.map(sid=>{const s=(part==='door'?x.openings:x.surfaces).find(s=>s.id===sid);return [sid,s?.construction,physics(x.constructions[s?.construction])];}),
          set:(x,value)=>ids.forEach(sid=>{const s=(part==='door'?x.openings:x.surfaces).find(s=>s.id===sid);if(s)s.construction=value;}),
          origin:x=>ids.every(sid=>{const s=(part==='door'?x.openings:x.surfaces).find(s=>s.id===sid);return materialOrigin(x,s.construction,'construction');})?materialOrigin(x,key,'construction'):null,
          validate:v=>v.every(([,key])=>{const c=m.constructions[key];return kind(c)==='nomass'?Number.isFinite(c.resistance)&&c.resistance>0:kind(c)==='layers'&&c?.layers?.length>0&&c.layers.every(l=>['thickness','conductivity','density','specificHeat'].every(k=>Number.isFinite(l[k])&&l[k]>0));}),
          display:()=>m.constructions[key]?.label||key
        }]});
      }
    }
    materialTask('wall','外壁の仕様',m.surfaces.filter(s=>s.type==='Wall'&&s.boundary==='Outdoors'));
    materialTask('roof','屋根・最上階の天井の仕様',m.surfaces.filter(s=>['Roof','Ceiling'].includes(s.type)&&s.boundary==='Outdoors'));
    materialTask('floor','外気・地盤側の床の仕様',m.surfaces.filter(s=>s.type==='Floor'&&s.boundary!=='Surface'&&s.boundary!=='Adiabatic'));
    const floors=m.surfaces.filter(s=>s.type==='Floor'&&s.boundary!=='Surface');
    const low=Math.min(...floors.flatMap(s=>s.vertices.map(p=>p[2])));
    const bottom=floors.filter(s=>s.vertices.every(p=>Math.abs(p[2]-low)<.05)).map(s=>s.id);
    if(bottom.length)add({id:'floor-boundary',title:'最下階の床の接し方',step:0,description:'地盤に直接接する床か、床下・外気側として扱う床かを確認します。',fields:[{
      id:'floor-boundary',title:'最下階の床',type:'boundary',get:x=>bottom.map(id=>[id,x.surfaces.find(s=>s.id===id)?.boundary]),
      set:(x,v)=>bottom.forEach(id=>x.surfaces.find(s=>s.id===id).boundary=v),validate:v=>v.every(([,b])=>['Ground','Outdoors','Adiabatic'].includes(b))
    }]});
    for(const w of m.openings.filter(s=>s.type==='Window')){
      const parent=m.surfaces.find(s=>s.id===w.surfaceId),room=m.rooms.find(r=>r.id===parent?.roomId);
      const fields=['u','shgc'].map(prop=>({
        id:'window:'+w.id+'.'+prop,title:prop==='u'?'熱の逃げやすさ（U値）':'日射の入りやすさ（SHGC）',type:'number',unit:prop==='u'?'W/m²K':'0〜1',
        get:x=>x.constructions[x.openings.find(s=>s.id===w.id)?.construction]?.[prop],
        origin:x=>materialOrigin(x,x.openings.find(s=>s.id===w.id).construction,prop),
        validate:v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&(prop!=='shgc'||v<=1),
        set:(x,v)=>{
          const opening=x.openings.find(s=>s.id===w.id),old=x.constructions[opening.construction];
          let key='Setup_Window_'+w.id;
          while(x.constructions[key]&&x.constructions[key].setupWindowId!==w.id)key+='_new';
          const c=clone(old||window.boundaryPipelineDefaults.constructions.window);
          c.architrendFields={...c.architrendFields};
          for(const p of ['u','shgc']){const source=materialOrigin(x,opening.construction,p);if(source)c.architrendFields[p]={value:c[p],source};}
          c[prop]=v;c.setupWindowId=w.id;c.label=(w.architrendWindowId||w.id)+'（確認画面で設定）';
          x.constructions[key]=c;opening.construction=key;
        }
      }));
      add({id:'window:'+w.id,title:(w.architrendWindowId||w.id)+(room?' / '+(room.name||room.id):''),step:0,description:'読めた性能値は入力済みです。確認が必要な性能だけ設定してください。',fields});
    }
    materialTask('door','ドアの仕様',m.openings.filter(s=>s.type==='Door'));
    materialTask('partition','部屋同士を仕切る壁・床',m.surfaces.filter(s=>s.boundary==='Surface'||s.boundary==='Adiabatic'));
    for(const [index,r] of m.rooms.entries()){
      const read=key=>x=>{
        const room=x.rooms.find(a=>a.id===r.id),record=x.architrendImport?.applied?.[r.id+'.'+key];
        // A/B/C describes occupancy classification, not a measured HVAC choice.
        if(key==='conditioned'||!record||!same(room[key],record.value))return null;
        return record.source;
      };
      const fields=[{id:r.id+'.name',title:'部屋の名前',type:'text',get:x=>x.rooms.find(a=>a.id===r.id).name,set:(x,v)=>x.rooms.find(a=>a.id===r.id).name=v,origin:read('name'),validate:v=>typeof v==='string'&&!!v.trim()},
        {id:r.id+'.conditioned',title:'この部屋で冷暖房を使う',type:'checkbox',get:x=>x.rooms.find(a=>a.id===r.id).conditioned!==false,set:(x,v)=>x.rooms.find(a=>a.id===r.id).conditioned=v,hint:r.architrendRoom?'資料の居室区分から入れた初期値です。実際の使い方を確認してください。':''}];
      for(const [key,title,unit,nullable] of [['people','何人が使う？','人',false],['lightsWm2','照明の消費電力','W/m²',true],[r.equipmentWm2!=null?'equipmentWm2':'equipmentW','家電から出る熱',r.equipmentWm2!=null?'W/m²':'W',false],['ventilationACH','外気と入れ替える量','回/h',false]]){
        fields.push({...numeric(r.id+'.'+key,title,x=>{const v=x.rooms.find(a=>a.id===r.id)[key];return v===undefined?(nullable?null:0):v;},(x,v)=>x.rooms.find(a=>a.id===r.id)[key]=v,unit,nullable),origin:read(key),hint:key==='lightsWm2'?'空欄を確認すると、照明からの発熱を計算しない設定になります。':key==='ventilationACH'?'0は換気なしの計算です。実際の換気計画を確認してください。':'0人・0Wも有効な設定です。初期値を使う場合も確認して進めてください。'});
      }
      add({id:'room:'+r.id,title:r.name||r.id,step:1,roomIndex:index,description:r.architrendRoom?'部屋名・面積の出典：'+r.architrendRoom.source+' / '+r.architrendRoom.area+' m²':'この部屋の使い方を確認します。',fields});
    }
    add({id:'living',title:'在室・照明・家電の時間割',step:2,description:'生活に合う例を選ぶか、いまの時間割を確認して使います。全曜日に共通です。',fields:[{
      id:'living',title:'生活の時間割',type:'living',get:x=>Object.fromEntries(['peopleSchedule','lightsSchedule','equipmentSchedule'].map(k=>[k,x.settings[k]])),validate:v=>Object.values(v).every(a=>Array.isArray(a)&&a.length===24&&a.every(v=>Number.isFinite(v)&&v>=0&&v<=1)),
      set:(x,kind)=>{const home=kind==='home';x.settings.peopleSchedule=Array.from({length:24},(_,h)=>home?1:h<7?.8:h<18?.2:1);x.settings.lightsSchedule=Array.from({length:24},(_,h)=>h<6?.1:h<8?.7:h<18?(home?.4:.1):1);x.settings.equipmentSchedule=Array.from({length:24},(_,h)=>home?.7:h<7?.25:h<18?.3:1);}
    }]});
    if(m.rooms.some(r=>r.conditioned!==false)){
      add({id:'temperature',title:'暖房・冷房の設定温度',step:2,description:'暖房は冷房より低い温度に設定します。',fields:['heating','cooling'].map((k,i)=>({...numeric('settings.'+k,i?'夏の冷房':'冬の暖房',x=>x.settings[k],(x,v)=>x.settings[k]=v,'℃'),validate:v=>Number.isFinite(v)&&v>-20&&v<50&&m.settings.heating<m.settings.cooling}))});
      add({id:'hvac',title:'冷暖房を使う時間',step:2,description:'冷暖房する全室に共通です。設定温度を保つために必要なときだけ運転します。',fields:[{id:'hvac',title:'運転する時間',type:'hvac',get:x=>({mode:x.settings.hvacMode,hours:x.settings.hvacSchedule,heating:x.settings.heatingPeriods,cooling:x.settings.coolingPeriods}),set:(x,v)=>{x.settings.hvacMode='hourly';x.settings.hvacSchedule=Array.from({length:24},(_,h)=>v==='all'||h>=6&&h<9||h>=17?1:0);},validate:v=>Array.isArray(v.hours)&&v.hours.length===24&&v.hours.every(v=>Number.isFinite(v)&&v>=0&&v<=1)}]});
    }
    const more=['groundTemperature','activityW','peopleRadiant','lightsRadiant','equipmentRadiant','equipmentLatent','ventilationSchedule','infiltrationSchedule','maxHeatingSupply','minCoolingSupply','maxHeatingHumidity','minCoolingHumidity','coolingSHR'];
    add({id:'assumptions',title:'その他の計算条件',step:2,advanced:'pipeGround',description:'資料にない条件には、いまの初期値を使います。必要なら詳細設定から変更できます。',fields:[{id:'assumptions',title:'地中温度・人体の活動量など',type:'assumptions',get:x=>({settings:Object.fromEntries(more.map(k=>[k,x.settings[k]??null])),infiltration:x.rooms.map(r=>[r.id,r.infiltrationACH??null])}),validate:v=>Number.isFinite(v.settings.groundTemperature)&&Number.isFinite(v.settings.activityW)}]});
    return tasks;
  };
  window.confirmBoundarySetupFields=function(m,fields){
    m.setupReview=m.setupReview||{version:1,confirmed:{}};m.setupReview.confirmed=m.setupReview.confirmed||{};
    for(const f of fields)if(f.valid)m.setupReview.confirmed[f.id]={value:clone(f.value)};
  };
  window.confirmAllBoundarySetupFields=function(m){window.confirmBoundarySetupFields(m,window.boundarySetupTasks(m).flatMap(t=>t.fields));};
})();

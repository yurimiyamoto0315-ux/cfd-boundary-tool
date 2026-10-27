/* Pure room-condition aggregation. No DOM, source text, file, or network access. */
(function(root){
  'use strict';
  const keys=['roomArea','occCount','peopleSensRate','peopleMoistRate','equipSensRate','equipMoistRate','extraSens','extraMoist'];
  const numeric=value=>{
    if(!['number','string'].includes(typeof value)||typeof value==='string'&&!value.trim())return null;
    const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;
  };
  const blank=value=>typeof value==='string'&&!value.trim();
  const string=value=>String(Object.is(value,-0)?0:value);
  function atPlanMergedRoomConditions(sources,mergedArea,options={}){
    const fail=code=>({ready:false,code,fields:null,warnings:[]});
    if(!options||typeof options!=='object'||Array.isArray(options))return fail('MERGE_CONDITIONS_TARGET_INVALID');
    const area=numeric(mergedArea);
    if(!(area>0))return fail('MERGE_CONDITIONS_AREA_INVALID');
    if(!Array.isArray(sources)||!sources.length||sources.some(source=>!source||!source.room||typeof source.room.key!=='string'||!source.room.key||!(numeric(source.room.area)>0)))return fail('MERGE_CONDITIONS_SOURCE_INVALID');
    if(new Set(sources.map(source=>source.room.key)).size!==sources.length)return fail('MERGE_CONDITIONS_SOURCE_INVALID');
    if(typeof options.habitable!=='boolean')return fail('MERGE_CONDITIONS_TARGET_INVALID');
    const primary=options.primaryKey==null?sources[0]:sources.find(source=>source.room.key===options.primaryKey);
    if(!primary)return fail('MERGE_CONDITIONS_PRIMARY_MISSING');
    const existing=new Map();
    for(const source of sources){
      if(source.fields==null)continue;
      if(typeof source.fields!=='object'||Array.isArray(source.fields))return fail('MERGE_CONDITIONS_FIELD_INVALID');
      const fields={};
      for(const key of keys){
        if(key==='occCount'&&blank(source.fields[key]))fields[key]=null;
        else{
          const value=numeric(source.fields[key]);
          if(value===null)return fail('MERGE_CONDITIONS_FIELD_INVALID');
          fields[key]=value;
        }
      }
      existing.set(source.room.key,fields);
    }
    const principal=existing.get(primary.room.key),defaults=options.defaults||{};
    function inherited(key){
      if(principal)return principal[key];
      const value=numeric(defaults[key]);
      return value!==null?value:options.habitable?null:0;
    }
    const rows=[];
    for(const source of sources){
      const saved=existing.get(source.room.key);
      if(saved){rows.push(saved);continue;}
      const rates={peopleSensRate:inherited('peopleSensRate'),peopleMoistRate:inherited('peopleMoistRate'),equipSensRate:options.habitable?inherited('equipSensRate'):0,equipMoistRate:options.habitable?inherited('equipMoistRate'):0};
      if(Object.values(rates).some(value=>value===null))return fail('MERGE_CONDITIONS_DEFAULT_MISSING');
      rows.push({roomArea:Number(source.room.area),occCount:0,...rates,extraSens:0,extraMoist:0});
    }
    const unknown=rows.some(row=>row.occCount===null);
    const common=key=>rows.every(row=>row[key]===rows[0][key]);
    if(unknown&&(!common('peopleSensRate')||!common('peopleMoistRate')))return fail('MERGE_CONDITIONS_UNKNOWN_OCCUPANCY_RATE');
    const total=read=>rows.reduce((sum,row)=>sum+read(row),0);
    const count=unknown?null:total(row=>row.occCount),primaryRow=principal||rows[sources.indexOf(primary)];
    const values={roomArea:area,occCount:count,
      peopleSensRate:unknown?rows[0].peopleSensRate:count>0?total(row=>row.occCount*row.peopleSensRate)/count:primaryRow.peopleSensRate,
      peopleMoistRate:unknown?rows[0].peopleMoistRate:count>0?total(row=>row.occCount*row.peopleMoistRate)/count:primaryRow.peopleMoistRate,
      equipSensRate:total(row=>row.roomArea*row.equipSensRate)/area,
      equipMoistRate:total(row=>row.roomArea*row.equipMoistRate)/area,
      extraSens:total(row=>row.extraSens),extraMoist:total(row=>row.extraMoist)};
    if(Object.entries(values).some(([key,value])=>!(key==='occCount'&&value===null)&&(!Number.isFinite(value)||value<0)))return fail('MERGE_CONDITIONS_NUMERIC_OVERFLOW');
    return {ready:true,code:'',fields:Object.fromEntries(keys.map(key=>[key,key==='occCount'&&unknown?'':string(values[key])])),warnings:unknown?['MERGE_CONDITIONS_OCCUPANCY_UNKNOWN']:[]};
  }
  root.atPlanMergedRoomConditions=atPlanMergedRoomConditions;
  if(typeof module!=='undefined'&&module.exports)module.exports={atPlanMergedRoomConditions};
})(typeof window!=='undefined'?window:globalThis);

const assert=require('node:assert/strict');
const vm=require('node:vm');

const flowTable = {
  '水平': {'強':608, '弱':478, '微':350},
  '50°': {'強':1510, '弱':1010, '微':830},
  '30°': {'強':1000, '弱':1000, '微':1000}
};
const src = `
const AT_AC_DIRS=['水平','30°','50°'];
function atPartAcDir(item){
  return item&&AT_AC_DIRS.includes(item.blowDir)?item.blowDir:'水平';
}
function atPartAcTableFlow(dir,vol){
  const row=flowTable[dir]||flowTable['水平'];
  const v=row[vol];
  return Number.isFinite(v)?v:row['強'];
}
function atPartAcFlowSummary(vol){
  const units=atParts.items.filter(it=>it.kind==='ac');
  const dirs=units.map(atPartAcDir);
  const flows=units.map(it=>atPartAcTableFlow(atPartAcDir(it),vol));
  const unique=[...new Set(dirs)];
  const total=flows.reduce((s,v)=>s+v,0);
  return {units,dirs,flows,unique,same:unique.length<=1,dir:unique[0]||'水平',
    total,per:units.length?total/units.length:0};
}
`;
const ctx={flowTable, atParts:{items:[]}, Set, Number, Object};
vm.createContext(ctx);
vm.runInContext(src, ctx);

ctx.atParts.items=[{kind:'ac',blowDir:'水平'},{kind:'ac',blowDir:'30°'}];
let sum=vm.runInContext("atPartAcFlowSummary('強')", ctx);
assert.equal(sum.total, 1608);
assert.equal(sum.same, false);
assert.equal(Math.round(sum.per), 804);

ctx.atParts.items=[{kind:'ac'},{kind:'ac',blowDir:'水平'}];
sum=vm.runInContext("atPartAcFlowSummary('微')", ctx);
assert.equal(sum.total, 700);
assert.equal(sum.same, true);
assert.equal(sum.dir, '水平');

ctx.atParts.items=[{kind:'ac',blowDir:'50°'}];
sum=vm.runInContext("atPartAcFlowSummary('強')", ctx);
assert.equal(sum.total, 1510);
console.log('PASS: mixed and same blowDir flows match Z-T table');

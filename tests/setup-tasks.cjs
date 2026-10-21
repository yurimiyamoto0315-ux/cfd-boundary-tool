const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={window:{}};vm.createContext(ctx);
for(const name of ['23-pipeline-defaults.js','23-architrend-import.js','23-setup-tasks.js'])vm.runInContext(fs.readFileSync('js/'+name,'utf8'),ctx);
const clone=x=>JSON.parse(JSON.stringify(x)),d=ctx.window.boundaryPipelineDefaults;
const m={source:'architrend',...clone(d),rooms:[{id:'r1',sourceId:'mesh1',name:'r1',floor:1,people:0,equipmentW:0,ventilationACH:.5}],
  surfaces:[{id:'wall',roomId:'r1',type:'Wall',boundary:'Outdoors',construction:'wall',vertices:[[0,0,0],[5,0,0],[5,0,3],[0,0,3]]},{id:'roof',roomId:'r1',type:'Roof',boundary:'Outdoors',construction:'roof',vertices:[[0,0,3],[5,0,3],[5,4,3],[0,4,3]]},{id:'floor',roomId:'r1',type:'Floor',boundary:'Ground',construction:'floor',vertices:[[0,0,0],[5,0,0],[5,4,0],[0,4,0]]}],
  openings:[{id:'w1',type:'Window',surfaceId:'wall',construction:'window',vertices:[[1,0,1],[2,0,1],[2,0,2],[1,0,2]]}]};
ctx.window.applyArchitrendToBoundaryModel(m,{uWall:.405,uRoof:.218,windows:[{id:'G1',width:1,height:1,floor:'1',u:2,uSource:'CSV概算'}],rooms:[{name:'LDK',floor:'1',area:20,type:'A'}],sources:{uWall:'PDF p.1',uRoof:'PDF p.1',rooms:'PDF p.9'}},{defaults:d,fresh:true,rooms:[{key:'mesh1',name:'LDK',floor:1,area:20,pdfIndex:0}],roomValues:{mesh1:{people:0,equipmentW:100}}});
const tasks=()=>ctx.window.boundarySetupTasks(m),field=id=>tasks().flatMap(t=>t.fields).find(f=>f.id===id);
assert.equal(field('window:w1.u').status,'imported');assert.equal(field('window:w1.shgc').status,'pending','A template SHGC is not a read value');
assert.equal(field('r1.name').status,'imported');assert.equal(field('r1.people').status,'provided');assert.equal(field('r1.people').value,0);
assert.equal(field('r1.conditioned').status,'pending','Room category is only an HVAC suggestion');
assert.equal(field('r1.lightsWm2').status,'pending');assert.equal(field('r1.lightsWm2').valid,true,'No lights is a confirmable choice');
assert.equal(tasks().find(t=>t.id.startsWith('material:wall')).fields[0].status,'imported');
const floor=tasks().find(t=>t.id.startsWith('material:floor'));assert.equal(floor.fields[0].valid,true);assert.equal(floor.fields[0].status,'pending');
field('window:w1.shgc').set(m,.35);
assert.equal(field('window:w1.u').status,'imported','Editing SHGC must retain provenance for U');
ctx.window.confirmBoundarySetupFields(m,tasks().find(t=>t.id==='window:w1').pending);
assert.equal(field('window:w1.shgc').status,'confirmed');
ctx.window.confirmBoundarySetupFields(m,tasks().find(t=>t.id==='room:r1').pending);
assert.equal(tasks().find(t=>t.id==='room:r1').pending.length,0);
m.rooms[0].ventilationACH=.8;
assert.deepEqual(Array.from(tasks().find(t=>t.id==='room:r1').pending,f=>f.id),['r1.ventilationACH'],'Only changed room fields become pending again');
const persisted=clone(m);assert.equal(ctx.window.boundarySetupTasks(persisted).find(t=>t.id==='window:w1').pending.length,0);
field('r1.ventilationACH').set(m,null);assert.equal(field('r1.ventilationACH').valid,false,'An explicitly cleared required number is not zero');field('r1.ventilationACH').set(m,.8);
ctx.window.confirmAllBoundarySetupFields(m);assert.equal(tasks().flatMap(t=>t.pending).length,0);
m.settings.cooling=19;assert.equal(field('settings.cooling').valid,false);assert.equal(field('settings.heating').valid,false);
m.constructions.AT_Source_wall.resistance=7;assert.equal(tasks().find(t=>t.id.startsWith('material:wall')).fields[0].status,'pending');
console.log('PASS: granular provenance, missing-only queue, valid zero/blank defaults, confirmation, value-change invalidation, JSON round trip');

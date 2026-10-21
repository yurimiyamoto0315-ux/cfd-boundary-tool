const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../js/20-at-parts.js'), 'utf8')
  .replace(/\natPartLoadTemplates\(\);\s*$/, '');

const wall = {
  atFaceId: 'w1', sslKey: 'innerwall', nameJa: '内壁',
  verts: [
    {x: 0, y: 2, z: 0}, {x: 2.4, y: 2, z: 0},
    {x: 2.4, y: 2, z: 2.4}, {x: 0, y: 2, z: 2.4}
  ]
};
function box(x0, x1, y0, y1, z0, z1){
  return [
    {x:x0,y:y0,z:z0},{x:x1,y:y0,z:z0},{x:x1,y:y1,z:z0},{x:x0,y:y1,z:z0},
    {x:x0,y:y0,z:z1},{x:x1,y:y0,z:z1},{x:x1,y:y1,z:z1},{x:x0,y:y1,z:z1}
  ];
}
const doorTpl = {
  kind: 'door', width: 0.8, height: 2.0, depth: 0.04, widthAxis: 0,
  meshes: [
    {key:'doorbody', name:'本体', verts: box(-0.4, 0.4, -0.02, 0.02, 0, 2), tris:[[0,1,2],[0,2,3]]},
    {key:'doorgap_top', name:'上端', verts: box(-0.4, 0.4, -0.02, 0.02, 1.9, 2), tris:[[4,5,6]]},
    {key:'doorgap_uc', name:'アンダーカット', verts: box(-0.4, 0.4, -0.02, 0.02, 0, 0.1), tris:[[0,1,2]]}
  ]
};

const ctx = {
  console, Math, Number, Object, Array, String, Promise, Set,
  document: {getElementById(){ return {textContent:'', hidden:true}; }, body:{appendChild(){}}},
  escapeHtml: s => s,
  atSnapshotRoomEdit(){},
  reviewView(){ return {floor:'1', plan:true}; },
  reviewMesh(){ return ctx.mesh; },
  atIsPartition(f){ return f && f.nameJa === '内壁'; },
  atWallSeg(f){
    const xs = f.verts.map(v => v.x), ys = f.verts.map(v => v.y);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    if (maxy - miny < 0.08) return {y:(miny+maxy)/2, x0:minx, x1:maxx, axis:'y'};
    return {x:(minx+maxx)/2, y0:miny, y1:maxy, axis:'x'};
  }
};
ctx.mesh = {rooms:[{floor:1, z:0, zTop:2.65, ring:[[0,0],[3,0],[3,3],[0,3]]}], meshFaces:[wall]};
ctx.doorTpl = doorTpl;
vm.createContext(ctx);
vm.runInContext(code, ctx);
vm.runInContext("atParts.templates.door = doorTpl; atParts.templates.swing = doorTpl; atParts.templates.slide = doorTpl;", ctx);

const bar = vm.runInContext('atPartToolbarHtml()', ctx);
assert.equal(bar.includes('data-part-mode="ac"'), false);
assert.equal(bar.includes('＋ エアコン'), false);
assert.equal(bar.includes('＋ ドア'), true);

assert.equal(vm.runInContext("atPartAdd('door',1,1.2,2.05)", ctx), true);
const item = vm.runInContext('atParts.items[0]', ctx);
assert.ok(Math.abs(item.width - 0.8) < 1e-6, 'new door keeps the template width');

vm.runInContext("atPartSetDoorWidth(atParts.items[0].id, 0.55)", ctx);
const sized = vm.runInContext('atParts.items[0]', ctx);
assert.ok(Math.abs(sized.width - 0.55) < 1e-6);
const span = vm.runInContext(`(()=>{
  const body=atPartWorldMeshes(atParts.items[0]).find(m=>m.key==='doorbody');
  const b=atPartBounds(body.verts);
  return Math.max(b.maxx-b.minx, b.maxy-b.miny);
})()`, ctx);
assert.ok(Math.abs(span - 0.55) < 1e-6, 'scaled body span '+span);

vm.runInContext("atPartSetDoorWidth(atParts.items[0].id, 5)", ctx);
const clamped = vm.runInContext('atParts.items[0].width', ctx);
assert.ok(Math.abs(clamped - 2.4) < 1e-6, 'width clamps to the wall, got '+clamped);

vm.runInContext("atPartSetDoorWidth(atParts.items[0].id, 1.2)", ctx);
vm.runInContext("atPartSetDoorOpen(atParts.items[0].id, true)", ctx);
const open = vm.runInContext(`(()=>{
  const meshes=atPartWorldMeshes(atParts.items[0]);
  const b=atPartBounds(meshes[0].verts);
  return {keys:meshes.map(m=>m.key), span:Math.max(b.maxx-b.minx, b.maxy-b.miny), thick:Math.min(b.maxx-b.minx, b.maxy-b.miny), h:b.maxz-b.minz};
})()`, ctx);
assert.deepEqual(Array.from(open.keys), ['dooropen']);
assert.ok(Math.abs(open.span - 1.2) < 1e-6, 'open span '+open.span);
assert.ok(open.thick < 1e-6, 'open face has no thickness');
assert.ok(Math.abs(open.h - 2.65) < 1e-6, 'open height follows the story, got '+open.h);
ctx.mesh.rooms[0].zTop = null;
const wallOpen = vm.runInContext(`(()=>{
  const b=atPartBounds(atPartWorldMeshes(atParts.items[0])[0].verts);
  return b.maxz-b.minz;
})()`, ctx);
assert.ok(Math.abs(wallOpen - 2.4) < 1e-6, 'without a ceiling, open height follows the wall, got '+wallOpen);
ctx.mesh.rooms[0].zTop = 2.65;

const saved = vm.runInContext('atPartReviewData()', ctx);
assert.equal(saved.items[0].open, true);
assert.ok(Math.abs(saved.items[0].width - 1.2) < 1e-6);
vm.runInContext('atPartRestoreReview('+JSON.stringify(saved)+')', ctx);
const restored = vm.runInContext('({open:atParts.items[0].open, width:atParts.items[0].width})', ctx);
assert.equal(restored.open, true);
assert.ok(Math.abs(restored.width - 1.2) < 1e-6);

console.log('door-open ok');

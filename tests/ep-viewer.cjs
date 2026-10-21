const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeEl(id){
  return {
    id: id || '',
    innerHTML: '',
    hidden: true,
    textContent: '',
    value: '',
    dataset: {},
    style: {},
    classList: {toggle(){}, add(){}, remove(){}},
    onclick: null,
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    addEventListener(){},
    setPointerCapture(){},
    hasPointerCapture(){ return false; },
    releasePointerCapture(){},
    getBoundingClientRect(){ return {left:0, top:0, width:900, height:570}; },
    closest(){ return null; }
  };
}
const els = {};
const ctx = {
  console, Math, Number, String, Object, JSON, Array, isFinite, parseInt, parseFloat, Set, Map, Date,
  window: {},
  escapeHtml: function(v){ return String(v==null?'':v).replace(/[&<>"']/g, function(ch){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]); }); },
  document: {
    getElementById(id){ if(!els[id]) els[id]=makeEl(id); return els[id]; },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    addEventListener(){},
    createElement(){ return makeEl(); }
  }
};
ctx.window = ctx;
vm.createContext(ctx);
const root = path.join(__dirname, '..', 'js');
[
  '01-constants.js','02-solar.js','03-utils.js','15-sat-etd.js','12-energyplus.js','14-idf-mesh.js',
  '16-at-3ds.js','17-at-rooms.js','19-at-stairs.js','18-at-room-viewer.js','19-at-fdd-templates.js',
  '20-at-parts.js','22-ep-viewer.js'
].forEach(function(f){
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, {filename:f});
});

const idf = fs.readFileSync(path.join(__dirname, '../../../05_iworks Analysis PJ/01_EP_IDF/260831_iworks2_v2.idf'), 'utf8');
ctx.epParse = ctx.parseEnergyPlusIdf(idf);
ctx.epIdfName = '260831_iworks2_v2.idf';
ctx.appMode = 'energyplus';
ctx.epSyncViewerMesh();
const host = els.epRoomViewer;
assert.equal(host.hidden, false, 'viewer shows after IDF load');
assert.ok(host.innerHTML.indexOf('data-floor')>=0, 'floor buttons are drawn');
assert.ok(host.innerHTML.indexOf('真上から')>=0 && host.innerHTML.indexOf('>3D<')>=0, 'plan and 3D controls');
assert.ok(host.innerHTML.indexOf('atRoomPdfChoice')<0, 'PDF assignment is omitted');
const rooms = ctx.epViewMesh.rooms || [];
assert.ok(rooms.some(function(r){ return r.epZone==='1F LDK' || r.name==='1F LDK'; }), '1F LDK is a room');
assert.ok(!rooms.some(function(r){ return r.floor>2; }), 'only the occupied floors are listed');
const zones = {};
rooms.forEach(function(r){ zones[r.epZone]=true; });
['1F LDK','1F Washroom','1F Bathroom','2F R1','2F R2','2F Dryingroom'].forEach(function(name){
  assert.ok(zones[name], 'room '+name);
});
const south = ctx.epViewMesh.meshFaces.filter(function(f){ return String(f.idfName).indexOf('1F LDK_Wall_9')===0; });
assert.ok(south.length>=1, 'south wall is in the view mesh');
assert.ok(south.every(function(f){ return f.tris && f.tris.length; }), 'view mesh uses the same triangles as the 3DS export');

let flip = 0;
ctx.epParse.meshFaces.forEach(function(f){
  if(!f.verts || f.verts.length<6 || !f.tris) return;
  const nn = ctx.idfMeshNewell(f.verts);
  f.tris.forEach(function(t){
    const cr = ctx.idfMeshCross(f.verts[t[0]], f.verts[t[1]], f.verts[t[2]]);
    if(cr.x*nn.x+cr.y*nn.y+cr.z*nn.z<=0) flip++;
  });
});
assert.equal(flip, 0, 'concave faces keep one winding');

const ldk = rooms.filter(function(r){ return r.epZone==='1F LDK'; })[0];
const nameInput = {value: ldk.name};
const card = makeEl('room-ldk');
card.dataset.epZone = '1F LDK';
card.querySelector = function(sel){ return sel==='.roomName' ? nameInput : null; };
ctx.document.querySelectorAll = function(sel){
  if(String(sel).indexOf('room-card')>=0) return [card];
  return [];
};
ldk.name = 'LDK';
ldk.habitable = false;
ldk.reviewed = true;
ctx.epWriteRoomToCard(ldk);
assert.equal(nameInput.value, 'LDK');
assert.equal(ctx.epRoomReviewed['1F LDK'], true);
let addedRooms=0;
ctx.addRoom=function(){ addedRooms++; return 'room-extra'; };
ctx.atSyncMeshWindowsToRooms();
assert.equal(addedRooms, 0, 'EP mode keeps the zone cards and does not add a card per floor piece');
const stairRoom=(ctx.epViewMesh.rooms||[]).filter(function(r){ return r.epZone==='1F LDK' && r.area>10; })[0];
assert.equal(ctx.atIsStairRoom(stairRoom), false, 'a living room is not a stair until created');
ctx.atStairCreateRoom(stairRoom);
assert.equal(ctx.atIsStairRoom(stairRoom), true);
assert.ok(stairRoom.stair && stairRoom.stair.treads.length>1, 'created stair has treads');
assert.ok(ctx.idfMeshStairMeshes().length>0, 'created stair is in the 3DS export');
ctx.epSyncViewerMesh();
const kept=(ctx.epViewMesh.rooms||[]).filter(function(r){ return r.stairManual; });
assert.equal(kept.length, 1, 'only the chosen piece keeps the stair');
assert.ok(kept[0].stair && kept[0].stair.treads.length>1, 'stair survives a mesh rebuild');
assert.ok((ctx.epViewMesh.rooms||[]).some(function(r){ return r.epZone==='1F LDK' && !r.stairManual; }), 'the other LDK piece stays a room');
ctx.atStairClearRoom(kept[0]);
ctx.atPlanStairsForMesh(ctx.epViewMesh);
assert.equal(ctx.atIsStairRoom(kept[0]), false, 'clearing removes the stair');
const atOnly = {meshFaces:[{atFaceId:'at'}], rooms:[{key:'at-room', floor:'1', area:1, z:0}]};
ctx.atMesh = atOnly;
ctx.appMode = 'architrend';
assert.equal(ctx.reviewMesh(), atOnly, 'Architrend keeps its own mesh');
const atView = ctx.reviewView();
atView.northDeg = 12;
ctx.appMode = 'energyplus';
assert.equal(ctx.reviewView().northDeg, 0, 'EnergyPlus keeps a separate view');
assert.equal(ctx.reviewMesh().fileName, '260831_iworks2_v2.idf');
ctx.appMode = 'architrend';
assert.equal(ctx.reviewView().northDeg, 12, 'Architrend view is unchanged by the EnergyPlus viewer');
ctx.appMode = 'energyplus';

console.log('PASS', rooms.map(function(r){ return r.floor+'F '+r.epZone+' '+r.area.toFixed(1); }).join(' | '));

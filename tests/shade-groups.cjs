const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ctx = {
  console,
  Math, Number, String, Object, JSON, Array, isFinite, parseInt,
  window: {},
  document: {
    getElementById(){ return null; },
    addEventListener(){},
    querySelector(){ return null; },
    querySelectorAll(){ return []; }
  }
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/15-sat-etd.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/01-constants.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/14-idf-mesh.js'), 'utf8'), ctx);

function rec(name, orient, t, area){
  return {
    name, orient, area, uCfd:1, uIso:1, etd:t - 26, satRaw:t, isol:100,
    isRoof:false, tSurf:t
  };
}

const same = ctx.epClusterShadeGroups([
  rec('a', '南', 30, 10),
  rec('b', '南', 30.4, 4)
], 26, 1);
assert.equal(same.length, 1);
assert.equal(same[0].sslKey, 'wall_南');
assert.equal(same[0].n, 2);
assert.ok(Math.abs(same[0].tCfd - (30 * 10 + 30.4 * 4) / 14) < 1e-9);

const split = ctx.epClusterShadeGroups([
  rec('shade', '南', 28, 6),
  rec('sun', '南', 36, 20),
  rec('mid', '南', 35.2, 3)
], 26, 1);
assert.equal(split.length, 2);
const primary = split.find(g => g.index === 1);
const extra = split.find(g => g.index === 2);
assert.equal(primary.sslKey, 'wall_南');
assert.ok(primary.names.indexOf('sun') >= 0);
assert.ok(primary.names.indexOf('mid') >= 0);
assert.equal(extra.names.length, 1);
assert.equal(extra.names[0], 'shade');
assert.equal(extra.sslKey, 'wall_南#2');
assert.equal(extra.target, '外壁 南#2 (発生パネル)');
assert.ok(Math.abs(extra.tCfd - 28) < 1e-9);

vm.runInContext(`
assignEpShadeColors(${JSON.stringify(split.map(function(g){
  return {orient:g.orient, index:g.index, sslKey:g.sslKey, names:Array.from(g.names)};
}))});
if(epShadePalette['wall_南#2'].mat !== 'WALL_S2') throw new Error('mat');
function far(a, b){
  return Math.max(Math.abs(a.r-b.r), Math.abs(a.g-b.g), Math.abs(a.b-b.b)) >= 28;
}
const reserved = [];
Object.keys(IDF_MESH_PALETTE).forEach(function(k){ reserved.push(IDF_MESH_PALETTE[k]); });
WINDOW_U_COLOR_PALETTE.forEach(function(c){ reserved.push(c); });
const many = [];
['北','北東','東','南東','南','南西','西','北西'].forEach(function(ori){
  many.push({orient:ori, index:1, sslKey:'wall_'+ori, names:[]});
  many.push({orient:ori, index:2, sslKey:'wall_'+ori+'#2', names:[]});
  many.push({orient:ori, index:3, sslKey:'wall_'+ori+'#3', names:[]});
});
assignEpShadeColors(many);
const colors = Object.keys(epShadePalette).map(function(k){ return epShadePalette[k]; });
colors.forEach(function(c){
  reserved.forEach(function(base){
    if(!far(c, base)) throw new Error('too close to palette '+c.mat+' '+c.r+' '+c.g+' '+c.b);
  });
});
for(let i=0;i<colors.length;i++){
  for(let j=i+1;j<colors.length;j++){
    if(!far(colors[i], colors[j])) throw new Error(colors[i].mat+' vs '+colors[j].mat);
  }
}
`, ctx);

ctx.idfNameKey = function(name){ return String(name||'').trim().toLowerCase(); };
ctx.epParse = {meshFaces:[
  {sslKey:'wall_南', idfName:'shade', nameJa:'外壁南'},
  {sslKey:'wall_南', idfName:'sun', nameJa:'外壁南'},
  {sslKey:'roof', idfName:'roof1', nameJa:'屋根'}
]};
ctx.applyEpShadeToMesh(split);
assert.equal(ctx.epParse.meshFaces[0].sslKey, 'wall_南#2');
assert.equal(ctx.epParse.meshFaces[1].sslKey, 'wall_南');
assert.equal(ctx.epParse.meshFaces[2].sslKey, 'roof');
ctx.applyEpShadeToMesh([]);
assert.equal(ctx.epParse.meshFaces[0].sslKey, 'wall_南');

console.log('PASS: same-orientation walls split by SAT into distinct 3DS colors');

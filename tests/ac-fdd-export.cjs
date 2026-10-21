const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const ctx = {
  console, Math, Number, String, parseFloat, isFinite,
  atPartMatrix: function(text){
    const v = String(text || '').split(',').map(Number);
    return v.length === 16 && v.every(Number.isFinite) ? v : [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  },
  atPartTransform: function(v, m){
    return {x: m[0]*v.x + m[1]*v.y + m[2]*v.z + m[3],
      y: m[4]*v.x + m[5]*v.y + m[6]*v.z + m[7],
      z: m[8]*v.x + m[9]*v.y + m[10]*v.z + m[11]};
  }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'js/21-at-ac-fdd.js'), 'utf8'), ctx);
ctx.atPartFloorZ = function(){ return 0; };
ctx.atPartParseFdd = function(){ return {anchor: {x: 0, y: 0, z: 0}}; };

const xml = fs.readFileSync(path.join(root, 'assets/fdd/エアコン水平.fdd'), 'utf8');
const item = {x: 3, y: 4, angle: 0, floor: 1, kind: 'ac'};
const baked = ctx.atFddBakeXml(xml, item, {x: 0, y: 0, z: 0}, 608, 17.59, 'AC001');
assert.match(baked.model, /<objecttype>吹出口\(流入\)<\/objecttype>/);
assert.match(baked.model, /<objecttype>吸込口\(流出\)<\/objecttype>/);
assert.match(baked.model, /<name>AC001<\/name>/);
assert.match(baked.model, /<cntag>OUTLETAMOUNT<\/cntag>\s*<value>6\.080000e\+02<\/value>/);
assert.match(baked.model, /<cntag>TEMP<\/cntag>\s*<value>1\.759000e\+01<\/value>/);
assert.match(baked.model, /<cntag>HUMIDITY<\/cntag>\s*<value>9\.500000e\+01<\/value>/);
assert.equal(baked.model.includes('1.500000e+01'), false);
const outlet = baked.model.split('<name>吹出口</name>')[1];
assert.match(outlet, /<value>1 0 -90 1<\/value>/);
const srcRot = xml.match(/<name>吹出口<\/name>[\s\S]*?<matrix type="rotate">([^<]+)<\/matrix>/)[1];
const outRot = outlet.match(/<matrix type="rotate">([^<]+)<\/matrix>/)[1];
assert.equal(outRot, srcRot);
const turned = ctx.atFddBakeXml(xml, {x: 3, y: 4, angle: 90, floor: 1, kind: 'ac'}, {x: 0, y: 0, z: 0}, 608, 17.59, 'AC001');
const turnedOutlet = turned.model.split('<name>吹出口</name>')[1];
assert.equal(turnedOutlet.match(/<matrix type="rotate">([^<]+)<\/matrix>/)[1], srcRot);
const parentRot = turned.model.match(/<matrix type="rotate">([^<]+)<\/matrix>/)[1].split(',').map(Number);
assert.ok(Math.abs(parentRot[1] + 1) < 1e-6 && Math.abs(parentRot[4] - 1) < 1e-6);
const vert = baked.model.match(/<vertex id="0">([^<]+)<\/vertex>/);
assert.ok(vert, 'vertex');
const xyz = vert[1].split(',').map(Number);
assert.ok(xyz.every(Number.isFinite), vert[1]);
ctx.runAll = function(){ ctx.ran = true; };
ctx.sslTrVal = function(step, target, item){
  assert.equal(step, '3');
  assert.equal(target, 'エアコン (吹出)');
  assert.equal(item, '吹出温度 [℃]');
  return '17.59';
};
assert.equal(ctx.atFddSupplyTemp(), 17.59);
assert.equal(ctx.ran, true);
ctx.sslTrVal = function(){ return '—'; };
assert.equal(ctx.atFddSupplyTemp(), null);
console.log('ac-fdd-export ok', xyz.map(n => n.toFixed(3)).join(' '));

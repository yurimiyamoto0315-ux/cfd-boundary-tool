const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ctx = {
  console, Math, Number, String, Object, JSON, Array, isFinite, parseInt, parseFloat, Set, Map,
  window: {},
  document: {
    getElementById(){ return null; },
    addEventListener(){},
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    createElement(){ return {style:{}}; }
  }
};
ctx.window = ctx;
vm.createContext(ctx);
const root = path.join(__dirname, '..', 'js');
['01-constants.js','02-solar.js','03-utils.js','15-sat-etd.js','12-energyplus.js','14-idf-mesh.js'].forEach(function(f){
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, {filename:f});
});

vm.runInContext('if(EP_SHADE_DT!==0.1) throw new Error("dt "+EP_SHADE_DT);', ctx);
const near = ctx.epClusterShadeGroups([
  {name:'a', orient:'南', area:10, uCfd:1, uIso:1, etd:4, satRaw:30, isol:100, isRoof:false, tSurf:30},
  {name:'b', orient:'南', area:4, uCfd:1, uIso:1, etd:4.05, satRaw:30.05, isol:100, isRoof:false, tSurf:30.05}
], 26, 0.1);
assert.equal(near.length, 1, '0.05℃ stays one color');
const apart = ctx.epClusterShadeGroups([
  {name:'a', orient:'南', area:10, uCfd:1, uIso:1, etd:4, satRaw:30, isol:100, isRoof:false, tSurf:30},
  {name:'b', orient:'南', area:4, uCfd:1, uIso:1, etd:4.2, satRaw:30.2, isol:100, isRoof:false, tSurf:30.2}
], 26, 0.1);
assert.equal(apart.length, 2, '0.2℃ splits');

const idf = fs.readFileSync(path.join(__dirname, '../../../05_iworks Analysis PJ/01_EP_IDF/260831_iworks2_v2.idf'), 'utf8');
const parsed = ctx.parseEnergyPlusIdf(idf);
ctx.epParse = parsed;
assert.ok(parsed.shading.length >= 3, 'overhangs parsed');
const wall = parsed.meshFaces.find(f => f.idfName === '1F LDK_Wall_9');
assert.ok(wall, 'south wall face');
const sp = ctx.solarPos(2020, 8, 30, 12, 35.68, 139.77);
assert.ok(sp.alt > 0.8, 'summer noon is high');

const iso = ctx.iso13786(parsed.consLayers.OW1 || parsed.consLayers[Object.keys(parsed.consLayers)[0]], 1/23, 0.13, 24);
const southNames = ['1F LDK_Wall_9', '2F R2_Wall_5', '2F Dryingroom_Wall_2'];
const refined = ctx.epRefineShadeRecs(southNames.map(function(name, i){
  return {
    name:name, orient:'南', area:6, uCfd:0.4, uIso:0.4,
    etd:8, satRaw:40, isol:[385.7, 419.6, 502.7][i], isRoof:false, tSurf:34, eta:iso.eta
  };
}), {
  sunAlt:sp.alt, sunAz:sp.az, alpha:0.7, ho:23, idn:1000, isky:125, rho:0.2
}, 26);
const sun = refined.find(r => String(r.name).endsWith('//sun'));
const shade = refined.find(r => String(r.name).endsWith('//shade'));
assert.ok(sun && shade, 'south wall split into sun and shade');
assert.ok(Math.abs(sun.tSurf - shade.tSurf) > 0.1, 'split exceeds 0.1℃: '+sun.tSurf+' vs '+shade.tSurf);
assert.ok(shade.area > sun.area, 'shade is the larger part under the eave');
const mean = (sun.tSurf*sun.area + shade.tSurf*shade.area) / (sun.area+shade.area);
assert.ok(Math.abs(mean - 34) < 1e-6, 'area-weighted mean stays on the SQL surface temperature');

const groups = ctx.epClusterShadeGroups(refined, 26, 0.1);
ctx.assignEpShadeColors(groups);
ctx.applyEpShadeToMesh(groups);
const pieces = parsed.meshFaces.filter(f => String(f.idfName).indexOf('1F LDK_Wall_9//') === 0);
assert.ok(pieces.length >= 2, '3DS faces replaced by sun/shade quads');
const keys = {};
pieces.forEach(f => { keys[f.sslKey] = true; });
assert.equal(Object.keys(keys).length, 2, 'sun and shade use different colors');
assert.ok(parsed.meshFaces.some(f => f.idfName === '2F R2_Wall_5' || String(f.idfName).indexOf('2F R2_Wall_5')===0));
const parentGone = parsed.meshFaces.some(f => f.idfName === '1F LDK_Wall_9');
assert.equal(parentGone, false, 'unsplit parent face is not exported twice');

function covered(part, x, z){
  return pieces.some(function(f){
    if(!String(f.idfName).endsWith('//'+part)) return false;
    const xs=f.verts.map(function(v){ return v.x; });
    const zs=f.verts.map(function(v){ return v.z; });
    return x>=Math.min.apply(null, xs)-1e-6 && x<=Math.max.apply(null, xs)+1e-6 &&
      z>=Math.min.apply(null, zs)-1e-6 && z<=Math.max.apply(null, zs)+1e-6;
  });
}
assert.ok(covered('shade', 2.5, 1.2), 'wall under the eave is the shade color');
assert.ok(covered('sun', 2.5, 2.75), 'strip above the eave is the sun color');
wall.verts.forEach(function(p){
  assert.ok(pieces.some(function(f){
    return f.verts.some(function(v){ return Math.hypot(v.x-p.x, v.y-p.y, v.z-p.z)<1e-4; });
  }), 'IDF corner stays on the split boundary');
});
let flipped = 0;
(ctx.epParse.meshBase||[]).forEach(function(f){
  if(!f.verts || f.verts.length<6) return;
  const tris = ctx.idfMeshEarClip3(f.verts);
  const nn = ctx.idfMeshNewell(f.verts);
  tris.forEach(function(t){
    const cr = ctx.idfMeshCross(f.verts[t[0]], f.verts[t[1]], f.verts[t[2]]);
    if(cr.x*nn.x + cr.y*nn.y + cr.z*nn.z <= 0) flipped++;
  });
});
assert.equal(flipped, 0, 'concave IDF faces triangulate with one winding');
assert.ok(refined.some(function(r){ return String(r.name).indexOf('2F R2_Wall_5//')===0; }), '2F south wall also splits');

const all = parsed.opaque.filter(function(s){
  return String(s.type).toLowerCase()==='wall' && String(s.bc).toLowerCase()==='outdoors' &&
    parsed.habitable.some(function(z){ return z.name===s.zone; });
}).map(function(s){
  return {name:s.name, orient:s.orient, area:s.net, uCfd:0.4, uIso:0.4, etd:8, satRaw:40, isol:300, isRoof:false, tSurf:34, eta:iso.eta};
});
const t0 = Date.now();
const allRef = ctx.epRefineShadeRecs(all, {sunAlt:sp.alt, sunAz:sp.az, alpha:0.7, ho:23, idn:1000, isky:125, rho:0.2}, 26);
const ms = Date.now()-t0;
assert.ok(ms < 3000, 'shade split took '+ms+'ms');
assert.ok(allRef.some(function(r){ return String(r.name).indexOf('1F LDK_Wall_9//shade')===0; }));
console.log('PASS', 'eta', iso.eta.toFixed(2), 'fSun', (sun.area/(sun.area+shade.area)).toFixed(2), 'dT', (sun.tSurf-shade.tSurf).toFixed(2), 'quads', pieces.length, 'allMs', ms, 'recs', allRef.length);

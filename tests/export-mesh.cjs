const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const ctx={
  console,
  document:{
    getElementById(){ return null; },
    addEventListener(){},
    querySelector(){ return null; },
    querySelectorAll(){ return []; }
  },
  FILL_SOLID_COLOR:{r:61,g:61,b:61,mat:'FILL'},
  module:{exports:{}},
  Uint8Array, DataView, ArrayBuffer, Math, Number, String, Object, JSON
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/14-idf-mesh.js'),'utf8'), ctx);

const v=ctx.idfMeshShiftVerts([{x:1000,y:2000,z:3000}], {dx:500, dy:0, dz:-1000});
assert.ok(Math.abs(v[0].x-1.5)<1e-9);
assert.ok(Math.abs(v[0].y-2)<1e-9);
assert.ok(Math.abs(v[0].z-2)<1e-9);

const box=[{x:0,y:0,z:0},{x:800,y:0,z:0},{x:800,y:220,z:0},{x:0,y:220,z:0},
  {x:0,y:0,z:290},{x:800,y:0,z:290},{x:800,y:220,z:290},{x:0,y:220,z:290}];
const solid=ctx.idfMeshAabbPrismFromFacesMm([{verts:box}]);
assert.ok(solid && solid.verts.length>=8 && solid.tris.length>=12);
assert.equal(ctx.idfMeshOpenEdgeCount(solid.tris), 0);

console.log('PASS: 3DS export verts are meters; AC AABB is a closed solid');

const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ctx = { console, Math, module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/17-at-rooms.js'), 'utf8'), ctx);

function plate(z, name, x0, y0, x1, y1, ssl) {
  return {
    sslKey: ssl || (name === '1F床' ? 'floor1' : 'innerwall'),
    nameJa: name,
    verts: [
      { x: x0, y: y0, z }, { x: x1, y: y0, z },
      { x: x1, y: y1, z }, { x: x0, y: y1, z }
    ]
  };
}
function wall(z0, z1, x, y0, y1) {
  return {
    sslKey: 'innerwall', nameJa: '内壁',
    verts: [
      { x, y: y0, z: z0 }, { x, y: y1, z: z0 },
      { x, y: y1, z: z1 }, { x, y: y0, z: z1 }
    ]
  };
}

const ceiling = plate(2.956, '内床', 0, 0, 9.1, 5.46);
const faces = [
  plate(0.556, '1F床', 0, 0, 9.1, 5.46),
  ceiling,
  plate(3.4, '内床', 0, 0, 9.1, 6.825),
  plate(3.4, '2F床', 0, 0, 9.1, 1.365, 'floor_out'),
  plate(5.836, '天井', 0, 0, 9.1, 6.825)
];
const rooms = ctx.atBuildRoomsFromFaces(faces, {});
const floors = [...new Set(rooms.map(r => r.floor))].sort();
assert.deepEqual(floors, [1, 2]);
assert.equal(ceiling.nameJa, '天井');
assert.ok(rooms.every(r => r.floor === 1 ? Math.abs(r.z - 0.556) < 0.02 : Math.abs(r.z - 3.4) < 0.02));
assert.ok(rooms.filter(r => r.floor === 1).every(r => Math.abs((r.zTop - r.z) - 2.844) < 0.05));

const third = [];
for (let i = 0; i < 3; i++) {
  const z = i * 3;
  third.push(plate(z, i === 0 ? '1F床' : (i === 2 ? '天井' : '内床'), 0, 0, 4, 4, i === 0 ? 'floor1' : 'innerwall'));
  third.push(wall(z, z + 2.8, 0, 0, 4));
}
assert.deepEqual(Array.from(ctx.atBuildRoomsFromFaces(third, {}), r => r.floor), [1, 2, 3]);

const aside = plate(2.96, '内床', 12, 0, 15, 4);
const split = [
  plate(0.5, '1F床', 0, 0, 4, 4),
  plate(3.4, '内床', 0, 0, 4, 4),
  aside
];
const splitRooms = ctx.atBuildRoomsFromFaces(split, {});
assert.equal(aside.nameJa, '内床');
assert.equal(splitRooms.length, 3);

console.log('story-height ok');

// Thin slab/ceiling spacing used to slip through the 150 mm cutoff.
const thin=[plate(0,'1F床',0,0,4,4),plate(2.9,'内床',0,0,4,4),
  plate(3,'内床',0,0,4,4),plate(5.8,'天井',0,0,4,4)];
const thinRooms=ctx.atBuildRoomsFromFaces(thin,{});
assert.deepEqual(Array.from(thinRooms,r=>r.floor),[1,2]);
assert.equal(thinRooms[0].zTop,3);
assert.equal(ctx.atRoomVolume(thinRooms[0]),48);

// Previously stored assignments retain their names/keys, lose the interstory
// zone, and renumber the actual upper floor correctly.
const old=[{...thinRooms[0],name:'LDK',zTop:2.9},
  {...thinRooms[0],key:'old-plenum',floor:2,z:2.9,zTop:3,name:'階間'},
  {...thinRooms[1],name:'洋室',floor:3}];
const migrated=ctx.atNormalizeRoomStories(old,thin);
assert.deepEqual(Array.from(migrated,r=>[r.name,r.floor,r.z,r.zTop]),[['LDK',1,0,3],['洋室',2,3,5.8]]);
assert.equal(migrated[0].key,thinRooms[0].key);
console.log('interstory merged into lower volume; restored assignments migrated');

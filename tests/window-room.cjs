const assert=require('node:assert/strict');
const fs=require('fs');
const vm=require('vm');
const path=require('path');

function at3dsWrap180(d){ return d; }
function at3dsOrientFromToolAz(){ return '南'; }
function at3dsToolAzFromNormal(){ return 0; }
function atIsStairRoom(r){
  const n=String((r && r.name)||'').replace(/\s+/g,'');
  return n==='階段' || n.indexOf('階段')===0;
}
const ctx={
  at3dsWrap180, at3dsOrientFromToolAz, at3dsToolAzFromNormal, atIsStairRoom,
  console, Math, module:{exports:{}}
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/17-at-rooms.js'),'utf8'), ctx);

function rect(x0,y0,x1,y1){
  return [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
}
function win(x, y){
  return {
    sslKey:'window', area:3.39e6, modelToolAz:0,
    verts:[
      {x:x-0.8,y:y,z:1},{x:x+0.8,y:y,z:1},
      {x:x+0.8,y:y,z:2.1},{x:x-0.8,y:y,z:2.1}
    ]
  };
}
const ldk={key:'ldk', name:'LDK', floor:1, z:0.5, zTop:3.2, ring:rect(0,0,6,4)};
const stair={key:'stair', name:'階段', floor:1, z:0.5, zTop:3.2, ring:rect(0,3.2,1.2,5)};
const extended=Object.assign({}, stair, {ring:rect(0,0,6,5)});
const own={
  sslKey:'window', area:0.27e6, modelToolAz:180,
  verts:[
    {x:0.4,y:5,z:2},{x:0.8,y:5,z:2},
    {x:0.8,y:5,z:2.8},{x:0.4,y:5,z:2.8}
  ]
};

const stolen=ctx.atAssignWindowsToRooms([win(2, 0)], [stair, extended, ldk], {});
assert.equal(stolen[0].roomName, 'LDK');

const kept=ctx.atAssignWindowsToRooms([own], [extended, ldk], {});
assert.equal(kept[0].roomName, '階段');

const onWall=ctx.atAssignWindowsToRooms([win(2, 0.05)], [extended], {});
assert.equal(onWall[0].roomName, '階段');
const beside=ctx.atAssignWindowsToRooms([win(2, 0.05)], [extended, ldk], {});
assert.equal(beside[0].roomName, 'LDK');

console.log('window-room ok');

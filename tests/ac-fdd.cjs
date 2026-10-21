const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const dir=path.join(__dirname,'../assets/fdd');
const files={'水平':'エアコン水平.fdd','30°':'エアコン30°.fdd','50°':'エアコン50°.fdd'};
for(const [label,name] of Object.entries(files)){
  const xml=fs.readFileSync(path.join(dir,name),'utf8');
  for(const part of ['本体','吸込口','吹出口']){
    assert.match(xml, new RegExp('<name>'+part+'</name>'), name+' missing '+part);
  }
  const verts=[...xml.matchAll(/<vertex[^>]*>([^<]+)<\/vertex>/g)].map(m=>m[1].split(',').map(Number));
  assert.ok(verts.length>20, name+' too few verts '+verts.length);
  const span=Math.max(...verts.flatMap(v=>v.map(Math.abs)));
  assert.ok(span<50, name+' verts should be meters, span='+span);
  console.log('ok', label, name, 'verts', verts.length, 'span', span.toFixed(3));
}
console.log('PASS: AC blow-direction FDD files have body/supply/return in meters');

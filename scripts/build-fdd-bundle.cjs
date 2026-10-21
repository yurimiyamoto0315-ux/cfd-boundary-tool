// Keep the browser's part geometry available even when localhost fetch is blocked.
// Run `node scripts/build-fdd-bundle.cjs` after updating an FDD source file.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = {
  ac_h: 'エアコン水平.fdd',
  ac_30: 'エアコン30°.fdd',
  ac_50: 'エアコン50°.fdd',
  door: 'ドア100mmメッシュ.fdd',
  swing: '開戸.fdd',
  slide: '引戸.fdd',
};
const xml = Object.fromEntries(Object.entries(files).map(([kind, name]) => [
  kind,
  fs.readFileSync(path.join(root, 'assets', 'fdd', name), 'utf8'),
]));
const output = '// Generated from assets/fdd by scripts/build-fdd-bundle.cjs.\n'
  + `const AT_PART_FDD_XML = Object.freeze(${JSON.stringify(xml)});\n`;
fs.writeFileSync(path.join(root, 'js', '19-at-fdd-templates.js'), output);
console.log('wrote js/19-at-fdd-templates.js', Object.keys(xml).join(', '));

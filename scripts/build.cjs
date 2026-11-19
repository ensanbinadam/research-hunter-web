'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const assetVersions = [...html.matchAll(/\?v=([0-9]+\.[0-9]+\.[0-9]+)/g)].map(m => m[1]);
if (!assetVersions.length || assetVersions.some(v => v !== pkg.version)) {
  console.error(`Version mismatch: package.json=${pkg.version}, index.html assets=[${assetVersions.join(', ')}]`);
  process.exit(1);
}
JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const name of ['index.html', 'manifest.webmanifest', '.nojekyll', 'assets', 'samples']) fs.cpSync(path.join(root, name), path.join(dist, name), { recursive: true });
console.log(`Static site v${pkg.version} ready in dist/; the repository root also works directly on GitHub Pages.`);

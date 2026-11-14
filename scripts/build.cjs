'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
for (const name of ['index.html', '.nojekyll', 'assets', 'samples']) fs.cpSync(path.join(root, name), path.join(dist, name), { recursive: true });
console.log('Static site ready in dist/; the repository root also works directly on GitHub Pages.');

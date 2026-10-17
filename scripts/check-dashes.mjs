// Fails if any text file in the project has an en dash or an em dash.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', '.git', '.netlify', 'fonts', 'icons']);
const bad = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(js|mjs|css|html|json|md|toml|webmanifest|txt|csv)$/.test(name)) {
      const text = fs.readFileSync(p, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (/[\u2013\u2014]/.test(line)) bad.push(`${path.relative(root, p)}:${i + 1}`);
      });
    }
  }
}
walk(root);
if (bad.length) {
  console.error(`Long dashes found:\n${bad.join('\n')}`);
  process.exit(1);
}
console.log('No en or em dashes.');

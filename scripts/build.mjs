// Builds public/index.html (one file: styles and script inlined), copies the fonts and stamps
// the service worker with a content hash so phones pick up new versions.
//
//   npm run build
import { build, transform } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(root, ...p);

const js = await build({
  entryPoints: [r('src/app.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['es2020', 'safari15'],
  legalComments: 'none',
});
const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = (await transform(fs.readFileSync(r('src/styles.css'), 'utf8'), { loader: 'css', minify: true })).code;
const html = fs.readFileSync(r('src/index.html'), 'utf8')
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => script);
fs.writeFileSync(r('public/index.html'), html);

const fonts = [
  ['@fontsource/big-shoulders-display/files/big-shoulders-display-latin-800-normal.woff2', 'big-shoulders-display-800.woff2'],
  ['@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2', 'big-shoulders-display-900.woff2'],
  ['@fontsource/barlow/files/barlow-latin-400-normal.woff2', 'barlow-400.woff2'],
  ['@fontsource/barlow/files/barlow-latin-500-normal.woff2', 'barlow-500.woff2'],
  ['@fontsource/barlow/files/barlow-latin-600-normal.woff2', 'barlow-600.woff2'],
  ['@fontsource/barlow/files/barlow-latin-700-normal.woff2', 'barlow-700.woff2'],
];
fs.mkdirSync(r('public/fonts'), { recursive: true });
for (const [from, to] of fonts) {
  const src = r('node_modules', from);
  if (fs.existsSync(src)) fs.copyFileSync(src, r('public/fonts', to));
  else if (!fs.existsSync(r('public/fonts', to))) throw new Error(`Missing font ${from}. Run npm install.`);
}

const hash = createHash('sha256').update(html).digest('hex').slice(0, 10);
fs.writeFileSync(r('public/sw.js'), fs.readFileSync(r('src/sw.js'), 'utf8').replace('__VERSION__', `sweat-${hash}`));
console.log(`Built public/index.html (${Math.round(html.length / 1024)} KB), service worker sweat-${hash}`);

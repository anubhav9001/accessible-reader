import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

// Output goes into the Flutter app's assets, which the app serves to its WebView.
const out = '../assets/web';
await mkdir(`${out}/mathmaps`, { recursive: true });
await Promise.all([
  build({
    entryPoints: ['src/reader.ts'],
    outfile: `${out}/reader.js`,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome100', 'safari15'],
    logLevel: 'warning',
  }),
  cp('src/reader.html', `${out}/reader.html`),
  cp('src/reader.css', `${out}/reader.css`),
  // Maths in words (packages/web-view/src/math.ts): Speech Rule Engine and its rule files.
  cp('../../../node_modules/speech-rule-engine/lib/sre.js', `${out}/sre.js`),
  ...['base', 'en', 'hi'].map((l) => cp(`../../../node_modules/speech-rule-engine/lib/mathmaps/${l}.json`, `${out}/mathmaps/${l}.json`)),
]);
console.log('Mobile web reader built into assets/web');

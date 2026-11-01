import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

// Output goes into the Flutter app's assets, which the app serves to its WebView.
const out = '../assets/web';
await mkdir(out, { recursive: true });
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
]);
console.log('Mobile web reader built into assets/web');

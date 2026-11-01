import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

const common = { bundle: true, sourcemap: true, logLevel: 'warning' };

await mkdir('dist/renderer', { recursive: true });
await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main.cjs',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'dist/preload.cjs',
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/renderer/renderer.ts'],
    outfile: 'dist/renderer/renderer.js',
    platform: 'browser',
    format: 'esm',
    target: 'chrome130',
  }),
  cp('src/renderer/index.html', 'dist/renderer/index.html'),
  cp('src/renderer/styles.css', 'dist/renderer/styles.css'),
]);
console.log('Desktop build complete');

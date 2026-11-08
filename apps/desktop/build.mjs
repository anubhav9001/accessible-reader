import { build } from 'esbuild';
import { cp, mkdir, readFile } from 'node:fs/promises';

// The Sugamya Pustakalaya API key comes from config.local.json at the repository root, which
// git ignores, and is built into the main process only (never the reader window).
let sugamyaKey = '';
try {
  sugamyaKey = JSON.parse(await readFile('../../config.local.json', 'utf8')).SUGAMYA_API_KEY?.trim() ?? '';
} catch {
  // No local config: Sugamya Pustakalaya says it isn't set up in this copy.
}

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
    external: ['electron', 'koffi'],
    define: { __SUGAMYA_API_KEY__: JSON.stringify(sugamyaKey) },
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

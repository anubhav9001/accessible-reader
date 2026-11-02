// Starts the desktop reader. Rebuilds first only when source files changed since the
// last build, then runs Electron directly (no npm/npx in between, which costs seconds
// on Windows). With --detach the reader keeps running after this script exits, so the
// console window opened by "Start Reader.cmd" can close.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '../..');
const sources = [
  path.join(desktop, 'src'),
  path.join(desktop, 'build.mjs'),
  path.join(root, 'packages/engine/src'),
  path.join(root, 'packages/web-view/src'),
];

function newest(p) {
  const stat = statSync(p);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(0, ...readdirSync(p).map((name) => newest(path.join(p, name))));
}

const built = path.join(desktop, 'dist', 'main.cjs');
if (!existsSync(built) || Math.max(...sources.map(newest)) > statSync(built).mtimeMs) {
  console.log('Building the reader (only needed after changes)…');
  const result = spawnSync('npm', ['run', 'build'], { cwd: desktop, stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const args = process.argv.slice(2);
const detach = args.includes('--detach');
// Requiring the electron package from Node gives the path of the Electron executable.
const electron = createRequire(path.join(desktop, 'package.json'))('electron');
const child = spawn(electron, [desktop, ...args.filter((a) => a !== '--detach')], {
  stdio: detach ? 'ignore' : 'inherit',
  detached: detach,
});
if (detach) {
  child.unref();
} else {
  child.on('exit', (code) => process.exit(code ?? 0));
}

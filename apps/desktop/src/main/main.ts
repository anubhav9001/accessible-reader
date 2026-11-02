import { openPublication, type Container } from '@accessible-reader/engine';
import { xmldomPlatform } from '@accessible-reader/engine/xmldom';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, type MenuItemConstructorOptions } from 'electron';
import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BookInfo, Command, ModeState } from '../shared/api';
import { FileCache, mimeType, openContainer } from './book-files';

// One custom scheme serves both the reader UI (reader://app/…) and the open book's files
// (reader://book/…), so audio can stream with range requests and text can be fetched.
protocol.registerSchemesAsPrivileged([
  { scheme: 'reader', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const rendererDir = path.join(__dirname, 'renderer');
const smokeIndex = process.argv.indexOf('--smoke');
const smoke = smokeIndex >= 0;
const initialPath = smoke ? process.argv[smokeIndex + 1] : process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith('-'));

// The smoke test starts from a fresh profile, so no remembered reading position skews it.
if (smoke) app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'reader-smoke-')));

let window: BrowserWindow | undefined;
let container: Container | undefined;
const cache = new FileCache();

async function loadBook(file: string): Promise<BookInfo> {
  const opened = await openContainer(file);
  const { container: c, ...info } = await openPublication(opened, xmldomPlatform);
  container = c;
  cache.clear();
  window?.setTitle(`${info.metadata.title || path.basename(file)} – Reader`);
  return info;
}

// ---- online catalogues (OPDS) ----

const USER_AGENT = `AccessibleReader/${app.getVersion()} (desktop)`;

/** Catalogue traffic is HTTPS only and happens only when the reader asks for it. */
async function catalogFetch(url: string, accept: string): Promise<globalThis.Response> {
  if (new URL(url).protocol !== 'https:') throw new Error('Only secure (HTTPS) catalogues can be used.');
  const response = await net.fetch(url, { headers: { 'user-agent': USER_AGENT, accept } });
  if (!response.ok) throw new Error(`The library answered with an error (${response.status}).`);
  return response;
}

ipcMain.handle('catalog-fetch', async (_event, url: string) =>
  (await catalogFetch(url, 'application/atom+xml, application/xml;q=0.9, */*;q=0.5')).text(),
);

ipcMain.handle('catalog-download', async (_event, url: string, title: string) => {
  const response = await catalogFetch(url, 'application/epub+zip, application/zip;q=0.9, */*;q=0.5');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const ext = /epub/i.test(response.headers.get('content-type') ?? '') || /epub/i.test(url) ? '.epub' : '.zip';
  const dir = path.join(app.getPath('userData'), 'books');
  await mkdir(dir, { recursive: true });
  const safeTitle = title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 80) || 'book';
  const file = path.join(dir, `${safeTitle} ${Date.now()}${ext}`);
  await writeFile(file, bytes);
  return loadBook(file);
});

function bytesResponse(bytes: Uint8Array, type: string, range: string | null): Response {
  const headers: Record<string, string> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'access-control-allow-origin': 'reader://app',
  };
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (!m || (!m[1] && !m[2])) {
    return new Response(bytes as BodyInit, { headers: { ...headers, 'content-length': String(bytes.length) } });
  }
  const size = bytes.length;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
  }
  return new Response(bytes.subarray(start, end + 1) as BodyInit, {
    status: 206,
    headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) },
  });
}

function registerProtocol(): void {
  protocol.handle('reader', async (request) => {
    const url = new URL(request.url);
    const file = decodeURIComponent(url.pathname.replace(/^\//, ''));
    try {
      if (url.host === 'app') {
        const full = path.join(rendererDir, file || 'index.html');
        if (!full.startsWith(rendererDir + path.sep)) return new Response('Forbidden', { status: 403 });
        return new Response((await readFile(full)) as BodyInit, { headers: { 'content-type': mimeType(full) } });
      }
      if (url.host === 'book' && container) {
        const stored = container.resolve(file);
        if (!stored) return new Response('Not found', { status: 404 });
        return bytesResponse(await cache.get(container, stored), mimeType(stored), request.headers.get('range'));
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Response('Not found', { status: 404 });
      console.error(err);
      return new Response('Error', { status: 500 });
    }
    return new Response('Not found', { status: 404 });
  });
}

function send(command: Command) {
  return () => window?.webContents.send('command', command);
}

function buildMenu(): void {
  const item = (label: string, command: Command, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: send(command),
  });
  const radio = (id: string, label: string, command: Command, accelerator?: string): MenuItemConstructorOptions => ({
    id,
    type: 'radio',
    label,
    accelerator,
    click: send(command),
  });

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        item('&Open book…', 'open', 'CmdOrCtrl+O'),
        item('Online &libraries…', 'catalogs', 'CmdOrCtrl+L'),
        { type: 'separator' },
        { role: 'quit', label: 'E&xit' },
      ],
    },
    {
      label: '&Reading',
      submenu: [
        radio('mode-text', '&Text only', 'mode-text', 'CmdOrCtrl+1'),
        radio('mode-audio', '&Audio only', 'mode-audio', 'CmdOrCtrl+2'),
        radio('mode-textAudio', 'Text &and audio', 'mode-textAudio', 'CmdOrCtrl+3'),
        { type: 'separator' },
        item('&Faster', 'faster', 'CmdOrCtrl+]'),
        item('&Slower', 'slower', 'CmdOrCtrl+['),
      ],
    },
    {
      label: '&Playback',
      submenu: [
        item('&Play or pause', 'toggle-play', 'CmdOrCtrl+Space'),
        { type: 'separator' },
        item('&Next phrase', 'next-phrase', 'Alt+Right'),
        item('P&revious phrase', 'prev-phrase', 'Alt+Left'),
        item('Next &heading', 'next-heading', 'Alt+Down'),
        item('Previous h&eading', 'prev-heading', 'Alt+Up'),
        item('Next pa&ge', 'next-page', 'Alt+PageDown'),
        item('Previous pag&e', 'prev-page', 'Alt+PageUp'),
        item('&Go to page…', 'goto-page', 'CmdOrCtrl+G'),
        { type: 'separator' },
        {
          label: 'Heading &level for navigation',
          submenu: [
            radio('level-0', '&All levels', 'level-0'),
            ...[1, 2, 3, 4, 5, 6].map((n) => radio(`level-${n}`, `Level &${n} and above`, `level-${n}` as Command)),
          ],
        },
      ],
    },
    {
      label: '&Navigate',
      submenu: [
        item('&Table of contents', 'focus-toc', 'CmdOrCtrl+T'),
        item('Book &text', 'focus-text', 'CmdOrCtrl+E'),
        item('&Where am I?', 'where-am-i', 'CmdOrCtrl+I'),
      ],
    },
    { label: '&View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'toggleDevTools' }] },
    { label: '&Help', submenu: [item('&Reading commands', 'help', 'F1')] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1200,
    height: 800,
    // Shown once the page has painted, in the page's own colour, so there is no blank white flash.
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121212' : '#ffffff',
    title: 'Reader',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep narration running when the window is minimised or in the background.
      backgroundThrottling: false,
    },
  });
  // Links inside books must never replace the reader page or open new windows.
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (smoke || process.env.READER_MUTE === '1') window.webContents.setAudioMuted(true);
  if (!smoke) window.once('ready-to-show', () => window?.show());
  window.loadURL('reader://app/index.html');
}

ipcMain.handle('open-book-dialog', async () => {
  const result = await dialog.showOpenDialog(window!, {
    title: 'Open book',
    properties: ['openFile'],
    filters: [
      { name: 'Books (EPUB, DAISY)', extensions: ['epub', 'zip', 'html', 'htm', 'opf'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  const file = result.filePaths[0];
  if (result.canceled || !file) return null;
  try {
    return await loadBook(file);
  } catch (err) {
    dialog.showErrorBox('Could not open book', err instanceof Error ? err.message : String(err));
    return null;
  }
});

ipcMain.handle('initial-book', async () => {
  if (!initialPath) return null;
  try {
    return await loadBook(path.resolve(initialPath));
  } catch (err) {
    console.error(err);
    if (smoke) app.exit(2);
    return null;
  }
});

ipcMain.on('mode-changed', (_event, state: ModeState) => {
  const menu = Menu.getApplicationMenu();
  for (const mode of ['text', 'audio', 'textAudio'] as const) {
    const entry = menu?.getMenuItemById(`mode-${mode}`);
    if (!entry) continue;
    entry.enabled = state.available[mode];
    entry.checked = state.mode === mode;
  }
});

ipcMain.on('book-ready', () => {
  if (smoke) void runSmokeTest();
});

/** Opens the book hidden and muted, plays it for a moment, and checks the reader moved through the narration. */
async function runSmokeTest(): Promise<void> {
  const run = (js: string) => window!.webContents.executeJavaScript(js);
  const before = await run('readerDebug.state()');
  await run("readerDebug.command('toggle-play')");
  await new Promise((r) => setTimeout(r, 4000));
  const playing = await run('readerDebug.state()');
  await run("readerDebug.command('next-heading')");
  await new Promise((r) => setTimeout(r, 500));
  const afterHeading = await run('readerDebug.state()');
  console.log(JSON.stringify({ before, playing, afterHeading }, null, 2));
  const ok = playing.clipIndex > before.clipIndex && afterHeading.heading !== playing.heading;
  console.log(ok ? 'SMOKE TEST PASSED' : 'SMOKE TEST FAILED');
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(() => {
  registerProtocol();
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());

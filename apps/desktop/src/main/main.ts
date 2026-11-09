import { SUGAMYA_API, isSugamyaPath, openPublication, type Container } from '@accessible-reader/engine';
import { xmldomPlatform } from '@accessible-reader/engine/xmldom';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell, type MenuItem, type MenuItemConstructorOptions } from 'electron';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { BookInfo, Command, MenuEntry, ModeState } from '../shared/api';
import { FileCache, mimeType, openContainer } from './book-files';
import { Library } from './library';
import { AppLog, isPreRelease } from './log';
import { NativeBox } from './native-box';

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

const log = new AppLog(path.join(app.getPath('userData'), 'logs'), isPreRelease(app.getVersion(), app.isPackaged) && !smoke);
process.on('uncaughtException', (err) => log.error('main', `Uncaught: ${err.stack ?? err}`));
process.on('unhandledRejection', (err) => log.error('main', `Unhandled rejection: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`));

let window: BrowserWindow | undefined;
let container: Container | undefined;
const cache = new FileCache();
const booksDir = () => path.join(app.getPath('userData'), 'books');
let library: Library | undefined;

async function loadBook(file: string): Promise<BookInfo> {
  const opened = await openContainer(file);
  const { container: c, ...info } = await openPublication(opened, xmldomPlatform);
  container = c;
  cache.clear();
  log.info(
    'book',
    `Opened "${info.metadata.title || path.basename(file)}" (${path.basename(file)}): ${info.format}, ` +
      `${info.readingOrder.length} documents, ${info.toc.length} top contents entries, ` +
      `${info.pageList.length} pages, ${info.narration.length} narration clips.`,
  );
  window?.setTitle(`${info.metadata.title || path.basename(file)} – Reader`);
  if (!smoke) await library?.record(file, info);
  return info;
}

ipcMain.handle('library-list', () => library?.list() ?? []);
ipcMain.handle('library-open', async (_event, id: string) => {
  const file = await library?.fileFor(id);
  if (!file) throw new Error('This book is no longer in My books.');
  try {
    return await loadBook(file);
  } catch {
    throw new Error('The book file could not be opened. It may have been moved or deleted.');
  }
});
ipcMain.handle('library-remove', (_event, id: string) => library?.remove(id));

// ---- online catalogues (OPDS) ----

const USER_AGENT = `AccessibleReader/${app.getVersion()} (desktop)`;

/** "Busy" answers that are usually gone a moment later. */
const BUSY = new Set([502, 503, 504]);

/**
 * Catalogue traffic is HTTPS only and happens only when the reader asks for it. Busy
 * answers and network failures are tried twice more, waiting 2 then 4 seconds.
 */
async function catalogFetch(url: string, accept: string): Promise<globalThis.Response> {
  if (new URL(url).protocol !== 'https:') throw new Error('Only secure (HTTPS) catalogues can be used.');
  for (let attempt = 0; ; attempt++) {
    let failure: string;
    try {
      const response = await net.fetch(url, { headers: { 'user-agent': USER_AGENT, accept }, signal: AbortSignal.timeout(30000) });
      if (response.ok) return response;
      if (!BUSY.has(response.status)) throw new Error(`The library answered with an error (${response.status}).`);
      failure = `The library is busy right now (error ${response.status}). Please try again in a minute.`;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('The library answered')) throw err;
      failure = 'Could not reach the library. Check the internet connection and try again.';
    }
    log.info('network', `Catalogue request failed (attempt ${attempt + 1}): ${failure}`);
    if (attempt === 2) throw new Error(failure);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

ipcMain.handle('catalog-fetch', async (_event, url: string) =>
  (await catalogFetch(url, 'application/atom+xml, application/xml;q=0.9, */*;q=0.5')).text(),
);

// ---- Sugamya Pustakalaya ----

declare const __SUGAMYA_API_KEY__: string;

ipcMain.handle('sugamya-fetch', async (_event, path: string) => {
  if (!__SUGAMYA_API_KEY__) throw new Error("Sugamya Pustakalaya isn't set up in this copy of Reader.");
  if (!isSugamyaPath(path)) throw new Error('That is not a Sugamya Pustakalaya request.');
  const url = `${SUGAMYA_API}/${path}?API_key=${encodeURIComponent(__SUGAMYA_API_KEY__)}`;
  const body = await (await catalogFetch(url, 'application/xml')).text();
  if (/Don't have access/i.test(body)) throw new Error("Sugamya Pustakalaya didn't allow this request.");
  return body;
});

ipcMain.handle('catalog-download', async (_event, url: string, title: string) => {
  const response = await catalogFetch(url, 'application/epub+zip, application/zip;q=0.9, */*;q=0.5');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const ext = /epub/i.test(response.headers.get('content-type') ?? '') || /epub/i.test(url) ? '.epub' : '.zip';
  const dir = booksDir();
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
        item('&My books…', 'library', 'CmdOrCtrl+B'),
        item('&Open book…', 'open', 'CmdOrCtrl+O'),
        item('Online &libraries…', 'catalogs', 'CmdOrCtrl+L'),
        item('&Close book', 'close-book', 'CmdOrCtrl+W'),
        { type: 'separator' },
        item('&Settings…', 'settings', 'CmdOrCtrl+,'),
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
        // Shown here but handled by the page (see renderer.ts), so in the book's text box in
        // screen reader mode they are left to the screen reader's own sentence commands.
        { ...item('Next &heading', 'next-heading', 'Alt+Down'), registerAccelerator: false },
        { ...item('Previous h&eading', 'prev-heading', 'Alt+Up'), registerAccelerator: false },
        item('Next pa&ge', 'next-page', 'Alt+PageDown'),
        item('Previous pag&e', 'prev-page', 'Alt+PageUp'),
        item('Next se&ction', 'next-section', 'CmdOrCtrl+PageDown'),
        item('Previous sec&tion', 'prev-section', 'CmdOrCtrl+PageUp'),
        item('&Go to page…', 'goto-page', 'CmdOrCtrl+G'),
      ],
    },
    {
      label: '&Navigate',
      submenu: [
        item('&Table of contents', 'focus-toc', 'CmdOrCtrl+T'),
        item('Book &text', 'focus-text', 'CmdOrCtrl+E'),
        item('&Where am I?', 'where-am-i', 'CmdOrCtrl+I'),
        { type: 'separator' },
        {
          label: 'Heading &depth',
          submenu: [
            radio('level-0', '&All levels', 'level-0'),
            radio('level-1', 'Level &1 only', 'level-1'),
            ...[2, 3, 4, 5, 6].map((n) => radio(`level-${n}`, `Levels 1 to &${n}`, `level-${n}` as Command)),
          ],
        },
      ],
    },
    {
      label: '&View',
      submenu: [
        { id: 'sr-mode', type: 'checkbox', label: '&Screen reader mode', accelerator: 'CmdOrCtrl+Shift+R', click: send('sr-mode') },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: '&Help',
      submenu: [
        item('&Reading commands', 'help', 'F1'),
        { type: 'separator' },
        { label: 'Report a &problem…', click: () => void shell.openExternal('https://github.com/anubhav9001/accessible-reader/issues/new/choose') },
        ...(log.enabled
          ? [{ label: 'Open &log folder', click: () => void shell.openPath(log.dir) } as MenuItemConstructorOptions]
          : []),
        { label: '&About Reader', click: () => void dialog.showMessageBox({ title: 'About Reader', message: `Reader version ${app.getVersion()}`, detail: 'An accessible reader for DAISY and EPUB books.' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The menu bar is drawn inside the window (see menu-bar.ts) so it behaves like a Windows menu
// with the keyboard: arrow keys only, and Escape steps back one level. The application menu
// stays set, hidden, so its shortcut keys keep working; the window asks it for its items.
const ROLE_KEYS: Record<string, string> = { zoomin: 'Ctrl+Plus', zoomout: 'Ctrl+Minus', resetzoom: 'Ctrl+0', toggledevtools: 'Ctrl+Shift+I' };

function describe(items: MenuItem[], prefix: string): MenuEntry[] {
  return items.map((it, i) => {
    const path = prefix ? `${prefix}.${i}` : String(i);
    const role = (it.role ?? '').toLowerCase();
    return {
      path,
      type: it.type === 'submenu' || it.submenu ? 'submenu' : it.type === 'checkbox' || it.type === 'radio' || it.type === 'separator' ? it.type : 'normal',
      label: it.label,
      accelerator: String(it.accelerator ?? ROLE_KEYS[role] ?? '').replace(/CmdOrCtrl|CommandOrControl/, 'Ctrl').replace(/\+-$/, '+Minus'),
      enabled: it.enabled,
      checked: it.checked,
      submenu: it.submenu ? describe(it.submenu.items, path) : undefined,
    };
  });
}

ipcMain.on('log', (_event, level: 'info' | 'warn' | 'error', message: string) => log.write(level, 'window', String(message)));

ipcMain.handle('menu-entries', () => describe(Menu.getApplicationMenu()?.items ?? [], ''));

// ---- screen reader mode's native text box (see native-box.ts) ----

let nativeBox: NativeBox | undefined;

/** Menu items by their accelerator, in NativeBox's spelling ("ctrl+shift+r"), for keys pressed in the native box. */
function menuAccelerator(accelerator: string): (() => void) | undefined {
  if (!accelerator) return undefined;
  const find = (items: MenuItem[]): MenuItem | undefined => {
    for (const it of items) {
      if (it.submenu) {
        const inner = find(it.submenu.items);
        if (inner) return inner;
      } else if (it.accelerator && it.enabled && it.registerAccelerator !== false) {
        const parts = String(it.accelerator).toLowerCase().replace(/cmdorctrl|commandorcontrol/, 'ctrl').split('+');
        const key = parts.pop()!;
        const spelled = [parts.includes('ctrl') && 'ctrl', parts.includes('alt') && 'alt', parts.includes('shift') && 'shift', key].filter(Boolean).join('+');
        if (spelled === accelerator) return it;
      }
    }
    return undefined;
  };
  const item = find(Menu.getApplicationMenu()?.items ?? []);
  if (!item || !window) return undefined;
  return () => {
    log.info('native', `Shortcut ${accelerator}: ${item.label.replace(/&/g, '')}`);
    // The page gets the keyboard first, so a command that moves focus there can; focus on the
    // placeholder (the book text) comes back to the box (see native-host.ts).
    toPage();
    item.click(undefined, window, window?.webContents);
  };
}

/**
 * Puts the keyboard back in the native box, shortly, when the box should have it and the page took
 * it on its own. Tab, the menu bar, shortcuts and clicks say first that the page should have it.
 */
function backToBox(): void {
  if (!nativeBox?.wanted) return;
  setTimeout(() => {
    if (nativeBox?.wanted && nativeBox.shown && !nativeBox.hasKeyboard && window?.isFocused()) {
      log.info('native', 'Keyboard back to the box');
      nativeBox.focus();
    }
  }, 120);
}

/** Moves the keyboard from the native box to the page. */
function toPage(): void {
  nativeBox?.release();
  window?.webContents.focus();
}

function ensureNativeBox(): NativeBox | undefined {
  if (nativeBox || !window) return nativeBox;
  const send = (channel: string, ...args: unknown[]) => window?.webContents.send(channel, ...args);
  nativeBox = NativeBox.create(
    window,
    {
      caret: (offset) => send('native-caret', offset),
      key: (key) => send('native-key', key),
      tab: (shift) => {
        toPage();
        send('native-tab', shift);
      },
      menu: (letter) => {
        toPage();
        send('native-menu', letter ?? null);
      },
      focus: (focused) => {
        send('native-focused', focused);
        // Chromium sometimes takes the keyboard for its page without anyone asking (closing a
        // dialog, coming back to the window): give it back to the box if that's where it was.
        if (!focused) backToBox();
      },
    },
    menuAccelerator,
    log,
  );
  return nativeBox;
}

ipcMain.handle('native-available', () => !!ensureNativeBox());
ipcMain.handle('native-text', (_e, text: string) => {
  const t0 = Date.now();
  ensureNativeBox()?.setText(text);
  log.info('native', `Text set: ${text.length} characters in ${Date.now() - t0} ms`);
});
ipcMain.on('native-set-caret', (_e, offset: number) => nativeBox?.setCaret(offset));
ipcMain.on('native-layout', (_e, visible: boolean, x: number, y: number, w: number, h: number) => nativeBox?.layout(visible, x, y, w, h));
ipcMain.on('native-style', (_e, fg: string, bg: string, face: string, px: number) =>
  nativeBox?.style(fg, bg, face, px * 0.75 * (window?.webContents.getZoomFactor() ?? 1)),
);
ipcMain.on('native-focus', () => nativeBox?.focus());
ipcMain.on('native-say', (_e, message: string) => nativeBox?.say(message));
ipcMain.on('focus-page', (_e, why?: string) => {
  if (!nativeBox) return;
  log.info('native', `Page takes the keyboard (${why ?? 'focus moved'})`);
  toPage();
});

ipcMain.on('menu-run', (_event, path: string) => {
  let items = Menu.getApplicationMenu()?.items ?? [];
  let found: MenuItem | undefined;
  for (const i of path.split('.').map(Number)) {
    found = items[i];
    items = found?.submenu?.items ?? [];
  }
  log.info('menu', `${(found?.label ?? path).replace(/&/g, '')}`);
  if (found && found.enabled && window) found.click(undefined, window, window.webContents);
});

function createWindow(): void {
  window = new BrowserWindow({
    width: 1200,
    height: 800,
    // Shown once the page has painted, in the page's own colour, so there is no blank white flash.
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121212' : '#ffffff',
    title: 'Reader',
    autoHideMenuBar: false,
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
  // The window draws its own menu bar; the application menu stays for its shortcut keys.
  window.setMenuBarVisibility(false);
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  // Errors and warnings from the page, and the page crashing or hanging, go to the log too.
  window.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error') log.write(event.level === 'error' ? 'error' : 'warn', 'console', `${event.message} (${path.basename(event.sourceId || '')}:${event.lineNumber})`);
  });
  window.webContents.on('render-process-gone', (_e, details) => log.error('window', `Page process gone: ${details.reason} (exit ${details.exitCode})`));
  window.on('unresponsive', () => log.error('window', 'The window stopped responding.'));
  window.on('responsive', () => log.info('window', 'The window is responding again.'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (smoke || process.env.READER_MUTE === '1') window.webContents.setAudioMuted(true);
  if (!smoke) window.once('ready-to-show', () => window?.show());
  // Coming back to the window: the native box gets the keyboard back if it had it.
  // Coming back to the window, Chromium gives its page the keyboard: hand it back to the native
  // box if the box had it (a click on the page says otherwise first; see renderer.ts).
  window.on('focus', backToBox);
  window.webContents.on('focus', backToBox);
  window.on('closed', () => {
    nativeBox?.destroy();
    nativeBox = undefined;
  });
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
    log.error('book', `Could not open ${path.basename(file)}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    dialog.showErrorBox('Could not open book', err instanceof Error ? err.message : String(err));
    return null;
  }
});

ipcMain.handle('app-version', () => app.getVersion());

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

ipcMain.on('heading-depth-changed', (_event, level: number) => {
  const entry = Menu.getApplicationMenu()?.getMenuItemById(`level-${level}`);
  if (entry) entry.checked = true;
});

ipcMain.on('sr-mode-changed', (_event, on: boolean) => {
  const entry = Menu.getApplicationMenu()?.getMenuItemById('sr-mode');
  if (entry) entry.checked = on;
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

/**
 * Tells the window whether Narrator is running (checked every few seconds), because the
 * screen reader mode text box is kept smaller for Narrator (see plain-reader.ts).
 */
let narrator: boolean | undefined;
function watchNarrator(): void {
  if (process.platform !== 'win32' || smoke) return;
  const check = () =>
    execFile('tasklist', ['/FI', 'IMAGENAME eq Narrator.exe', '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, out) => {
      // READER_FAKE_NARRATOR=1 lets tests try the Narrator-sized box without Narrator.
      const running = process.env.READER_FAKE_NARRATOR === '1' || (!err && /narrator\.exe/i.test(out));
      if (running === narrator) return;
      narrator = running;
      log.info('app', `Narrator ${running ? 'is running' : 'is not running'}`);
      window?.webContents.send('narrator', running);
    });
  check();
  setInterval(check, 4000);
}

ipcMain.handle('narrator-running', () => narrator ?? false);

app.whenReady().then(() => {
  log.start(app.getVersion(), process.versions);
  watchNarrator();
  library = new Library(path.join(app.getPath('userData'), 'library.json'), booksDir());
  registerProtocol();
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  log.info('app', 'Reader closed.');
  app.quit();
});

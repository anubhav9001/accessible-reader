import { contextBridge, ipcRenderer } from 'electron';
import type { Command, ReaderApi } from '../shared/api';

const api: ReaderApi = {
  openBookDialog: () => ipcRenderer.invoke('open-book-dialog'),
  fetchCatalog: (url) => ipcRenderer.invoke('catalog-fetch', url),
  fetchSugamya: (path) => ipcRenderer.invoke('sugamya-fetch', path),
  sugamya: {
    account: () => ipcRenderer.invoke('sugamya-account'),
    signIn: (user, password) => ipcRenderer.invoke('sugamya-sign-in', user, password),
    signOut: () => ipcRenderer.invoke('sugamya-sign-out'),
    request: (bookId, format) => ipcRenderer.invoke('sugamya-request', bookId, format),
    requests: () => ipcRenderer.invoke('sugamya-requests'),
    download: (url, title) => ipcRenderer.invoke('sugamya-download', url, title),
    onProgress: (listener) => void ipcRenderer.on('sugamya-progress', (_e, fraction: number) => listener(fraction)),
    openWebsite: (url) => void ipcRenderer.invoke('open-external', url),
  },
  downloadBook: (url, title) => ipcRenderer.invoke('catalog-download', url, title),
  listLibrary: () => ipcRenderer.invoke('library-list'),
  openFromLibrary: (id) => ipcRenderer.invoke('library-open', id),
  removeFromLibrary: (id) => ipcRenderer.invoke('library-remove', id),
  initialBook: () => ipcRenderer.invoke('initial-book'),
  version: () => ipcRenderer.invoke('app-version'),
  onCommand: (listener) => {
    ipcRenderer.on('command', (_event, command: Command) => listener(command));
  },
  modeChanged: (state) => ipcRenderer.send('mode-changed', state),
  screenReaderModeChanged: (on) => ipcRenderer.send('sr-mode-changed', on),
  headingDepthChanged: (level) => ipcRenderer.send('heading-depth-changed', level),
  bookReady: () => ipcRenderer.send('book-ready'),
  menuEntries: () => ipcRenderer.invoke('menu-entries'),
  runMenuItem: (path) => ipcRenderer.send('menu-run', path),
  log: (level, message) => ipcRenderer.send('log', level, message),
  narratorRunning: () => ipcRenderer.invoke('narrator-running'),
  native: {
    available: () => ipcRenderer.invoke('native-available'),
    setText: (text) => ipcRenderer.invoke('native-text', text),
    setCaret: (offset) => ipcRenderer.send('native-set-caret', offset),
    layout: (visible, x, y, w, h) => ipcRenderer.send('native-layout', visible, x, y, w, h),
    style: (fg, bg, face, px) => ipcRenderer.send('native-style', fg, bg, face, px),
    focus: () => ipcRenderer.send('native-focus'),
    say: (message) => ipcRenderer.send('native-say', message),
    onCaret: (listener) => void ipcRenderer.on('native-caret', (_e, offset: number) => listener(offset)),
    onKey: (listener) => void ipcRenderer.on('native-key', (_e, key) => listener(key)),
    onTab: (listener) => void ipcRenderer.on('native-tab', (_e, shift: boolean) => listener(shift)),
    onMenu: (listener) => void ipcRenderer.on('native-menu', (_e, letter: string | null) => listener(letter)),
    onFocused: (listener) => void ipcRenderer.on('native-focused', (_e, focused: boolean) => listener(focused)),
  },
  focusPage: (why) => ipcRenderer.send('focus-page', why),
  onNarrator: (listener) => {
    ipcRenderer.on('narrator', (_event, running: boolean) => listener(running));
  },
};

contextBridge.exposeInMainWorld('reader', api);

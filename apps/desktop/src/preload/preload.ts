import { contextBridge, ipcRenderer } from 'electron';
import type { Command, ReaderApi } from '../shared/api';

const api: ReaderApi = {
  openBookDialog: () => ipcRenderer.invoke('open-book-dialog'),
  fetchCatalog: (url) => ipcRenderer.invoke('catalog-fetch', url),
  downloadBook: (url, title) => ipcRenderer.invoke('catalog-download', url, title),
  listLibrary: () => ipcRenderer.invoke('library-list'),
  openFromLibrary: (id) => ipcRenderer.invoke('library-open', id),
  removeFromLibrary: (id) => ipcRenderer.invoke('library-remove', id),
  initialBook: () => ipcRenderer.invoke('initial-book'),
  onCommand: (listener) => {
    ipcRenderer.on('command', (_event, command: Command) => listener(command));
  },
  modeChanged: (state) => ipcRenderer.send('mode-changed', state),
  screenReaderModeChanged: (on) => ipcRenderer.send('sr-mode-changed', on),
  bookReady: () => ipcRenderer.send('book-ready'),
};

contextBridge.exposeInMainWorld('reader', api);

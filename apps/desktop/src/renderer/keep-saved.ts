import type { ReaderApi } from '../shared/api';

/** How soon after a change it is written to disk; places change about once a second while reading. */
const FLUSH_AFTER_MS = 500;

/**
 * Makes sure settings, reading places and bookmarks reach the disk soon after they change.
 * They live in localStorage, which Chromium writes to disk only now and then: when an installer
 * closed Reader by force to update it, recent changes were lost (see main.ts, 'flush-storage').
 */
export function keepSaved(api: Pick<ReaderApi, 'flushStorage'>): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    timer ??= setTimeout(() => {
      timer = undefined;
      api.flushStorage();
    }, FLUSH_AFTER_MS);
  };
  const { setItem, removeItem } = Storage.prototype;
  Storage.prototype.setItem = function (key: string, value: string) {
    setItem.call(this, key, value);
    changed();
  };
  Storage.prototype.removeItem = function (key: string) {
    removeItem.call(this, key);
    changed();
  };
  // And whatever is left when the window closes.
  window.addEventListener('pagehide', () => api.flushStorage());
}

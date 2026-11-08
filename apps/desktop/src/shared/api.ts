import type { PublicationData } from '@accessible-reader/engine';

/** A publication as sent to the reader window. Its files are served at reader://book/<path>. */
export type BookInfo = PublicationData;

/** Commands sent from the application menu (and its keyboard shortcuts) to the reader window. */
export const COMMANDS = [
  'open',
  'library',
  'close-book',
  'catalogs',
  'toggle-play',
  'next-phrase',
  'prev-phrase',
  'next-heading',
  'prev-heading',
  'next-page',
  'prev-page',
  'next-section',
  'prev-section',
  'goto-page',
  'faster',
  'slower',
  'mode-text',
  'mode-audio',
  'mode-textAudio',
  'level-0',
  'level-1',
  'level-2',
  'level-3',
  'level-4',
  'level-5',
  'level-6',
  'focus-toc',
  'focus-text',
  'where-am-i',
  'sr-mode',
  'settings',
  'help',
] as const;
export type Command = (typeof COMMANDS)[number];

export interface ModeState {
  mode: 'text' | 'audio' | 'textAudio';
  available: { text: boolean; audio: boolean; textAudio: boolean };
}

/** One book in "My books". */
export interface LibraryEntry {
  id: string;
  title: string;
  authors: string[];
  format: BookInfo['format'];
  /** Downloaded by the app into its own folder (removing it deletes the file). */
  downloaded: boolean;
  /** Milliseconds since 1970. */
  lastOpened: number;
  /** The file has been moved or deleted since. */
  missing: boolean;
}

/** One entry of the app's menu, as the in-window menu bar draws it. */
export interface MenuEntry {
  /** Position in the menu, e.g. "0.3" (File, fourth item); used to run it. */
  path: string;
  type: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';
  /** Label with its access key marked by "&", as in "&Open book…". */
  label: string;
  accelerator: string;
  enabled: boolean;
  checked: boolean;
  submenu?: MenuEntry[];
}

/** The API the preload script exposes to the reader window as `window.reader`. */
export interface ReaderApi {
  openBookDialog(): Promise<BookInfo | null>;
  /** Fetches an online catalogue feed (OPDS) as text. */
  fetchCatalog(url: string): Promise<string>;
  /** Fetches a Sugamya Pustakalaya result page (XML); the path comes from sugamyaPath(). */
  fetchSugamya(path: string): Promise<string>;
  /** Downloads a book from a catalogue into the app's books folder and opens it. */
  downloadBook(url: string, title: string): Promise<BookInfo>;
  /** "My books", most recently read first. */
  listLibrary(): Promise<LibraryEntry[]>;
  openFromLibrary(id: string): Promise<BookInfo>;
  removeFromLibrary(id: string): Promise<void>;
  /** The book passed on the command line, if any. */
  initialBook(): Promise<BookInfo | null>;
  /** The app's version, e.g. "0.7.1". */
  version(): Promise<string>;
  onCommand(listener: (command: Command) => void): void;
  modeChanged(state: ModeState): void;
  /** Keeps the View menu's Screen reader mode tick in step. */
  screenReaderModeChanged(on: boolean): void;
  /** Heading depth for navigation changed (0 = all levels), so the menu shows it. */
  headingDepthChanged(level: number): void;
  bookReady(): void;
  /** The menu as it is right now (ticks and greyed items included). */
  menuEntries(): Promise<MenuEntry[]>;
  /** Runs a menu item, by its path. */
  runMenuItem(path: string): void;
  /** Adds a line to the tester log (pre-release builds only; see main/log.ts). */
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

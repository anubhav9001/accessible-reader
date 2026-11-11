import type { PublicationData, SugamyaRequest } from '@accessible-reader/engine';

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
  /** The reader's Sugamya Pustakalaya account (main/sugamya-account.ts); the password never comes back. */
  sugamya: {
    account(): Promise<{ user: string; name: string } | null>;
    signIn(user: string, password: string): Promise<{ user: string; name: string }>;
    signOut(): Promise<void>;
    /** Asks the library for a book; resolves to the library's reply. */
    request(bookId: string, format: string): Promise<string>;
    requests(): Promise<SugamyaRequest[]>;
    /** Downloads a ready book into My books and opens it. */
    download(url: string, title: string): Promise<BookInfo>;
    /** Download progress: 0 to 1, or -1 when the size isn't known. */
    onProgress(listener: (fraction: number) => void): void;
    /** Opens the library's website (sign-in help) in the browser. */
    openWebsite(url: string): void;
  };
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
  /** Whether Narrator is running now, and when that changes. */
  narratorRunning(): Promise<boolean>;
  onNarrator(listener: (running: boolean) => void): void;
  /** Screen reader mode's native Windows text box (see main/native-box.ts). */
  native: {
    available(): Promise<boolean>;
    setText(text: string): Promise<void>;
    setCaret(offset: number): void;
    layout(visible: boolean, x: number, y: number, w: number, h: number): void;
    style(fg: string, bg: string, face: string, px: number): void;
    focus(): void;
    say(message: string): void;
    onCaret(listener: (offset: number) => void): void;
    onKey(listener: (key: { key: string; code: string; shift: boolean; caret: number }) => void): void;
    onTab(listener: (shift: boolean) => void): void;
    onMenu(listener: (letter: string | null) => void): void;
    onFocused(listener: (focused: boolean) => void): void;
  };
  /** Gives the keyboard back to the page when the native box has it. */
  focusPage(why?: string): void;
}

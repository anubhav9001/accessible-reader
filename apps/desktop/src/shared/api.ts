import type { PublicationData } from '@accessible-reader/engine';

/** A publication as sent to the reader window. Its files are served at reader://book/<path>. */
export type BookInfo = PublicationData;

/** Commands sent from the application menu (and its keyboard shortcuts) to the reader window. */
export const COMMANDS = [
  'open',
  'toggle-play',
  'next-phrase',
  'prev-phrase',
  'next-heading',
  'prev-heading',
  'next-page',
  'prev-page',
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
] as const;
export type Command = (typeof COMMANDS)[number];

export interface ModeState {
  mode: 'text' | 'audio' | 'textAudio';
  available: { text: boolean; audio: boolean; textAudio: boolean };
}

/** The API the preload script exposes to the reader window as `window.reader`. */
export interface ReaderApi {
  openBookDialog(): Promise<BookInfo | null>;
  /** The book passed on the command line, if any. */
  initialBook(): Promise<BookInfo | null>;
  onCommand(listener: (command: Command) => void): void;
  modeChanged(state: ModeState): void;
  bookReady(): void;
}

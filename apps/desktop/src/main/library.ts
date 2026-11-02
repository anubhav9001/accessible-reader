import { existsSync } from 'node:fs';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BookInfo, LibraryEntry } from '../shared/api';

interface StoredEntry {
  id: string;
  file: string;
  title: string;
  authors: string[];
  format: BookInfo['format'];
  /** True for books the app downloaded into its own books folder, which it may delete. */
  downloaded: boolean;
  addedAt: number;
  lastOpened: number;
}

/**
 * "My books": every book opened or downloaded, kept in library.json in the app's data
 * folder. Books opened from elsewhere stay where they are; the list only points at them.
 */
export class Library {
  private entries: StoredEntry[] = [];
  private loaded = false;

  constructor(
    private readonly file: string,
    private readonly booksDir: string,
  ) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.entries = JSON.parse(await readFile(this.file, 'utf8')) as StoredEntry[];
    } catch {
      // First run with My books: list the books downloaded before it existed.
      this.entries = await this.scanDownloads();
      if (this.entries.length) await this.save();
    }
  }

  private async scanDownloads(): Promise<StoredEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.booksDir);
    } catch {
      return [];
    }
    const entries: StoredEntry[] = [];
    for (const name of names.filter((n) => /\.(epub|zip)$/i.test(n))) {
      const file = path.join(this.booksDir, name);
      const { mtimeMs } = await stat(file);
      entries.push({
        id: `${Math.round(mtimeMs).toString(36)}${entries.length}`,
        file,
        // Downloads are saved as "<title> <timestamp>.<ext>"; the real title replaces this when opened.
        title: name.replace(/ \d+\.\w+$/, '').replace(/\.\w+$/, ''),
        authors: [],
        format: /\.epub$/i.test(name) ? 'epub' : 'daisy3',
        downloaded: true,
        addedAt: mtimeMs,
        lastOpened: mtimeMs,
      });
    }
    return entries;
  }

  private save(): Promise<void> {
    return writeFile(this.file, JSON.stringify(this.entries, null, 2));
  }

  /** Adds a just-opened book, or moves it to the top if it is already listed. */
  async record(file: string, info: BookInfo): Promise<void> {
    await this.load();
    const now = Date.now();
    const existing = this.entries.find((e) => e.file === file);
    const entry: StoredEntry = existing ?? {
      id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      file,
      title: '',
      authors: [],
      format: info.format,
      downloaded: path.dirname(file) === this.booksDir,
      addedAt: now,
      lastOpened: now,
    };
    entry.title = info.metadata.title || path.basename(file);
    entry.authors = info.metadata.authors;
    entry.format = info.format;
    entry.lastOpened = now;
    if (!existing) this.entries.push(entry);
    await this.save();
  }

  /** Most recently read first. */
  async list(): Promise<LibraryEntry[]> {
    await this.load();
    return [...this.entries]
      .sort((a, b) => b.lastOpened - a.lastOpened)
      .map(({ id, title, authors, format, downloaded, lastOpened, file }) => ({
        id,
        title,
        authors,
        format,
        downloaded,
        lastOpened,
        missing: !existsSync(file),
      }));
  }

  async fileFor(id: string): Promise<string | undefined> {
    await this.load();
    return this.entries.find((e) => e.id === id)?.file;
  }

  /** Takes a book off the list, deleting its file only if the app downloaded it. */
  async remove(id: string): Promise<void> {
    await this.load();
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    this.entries = this.entries.filter((e) => e !== entry);
    await this.save();
    if (entry.downloaded) await rm(entry.file, { force: true });
  }
}

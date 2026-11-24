/** How often reading time is counted. */
const TICK_MS = 15_000;
/** Time without a key, click or playing that still counts as reading (a long paragraph, a pause to think). */
const IDLE_MS = 5 * 60_000;

export interface BookStats {
  /** When the book was first and last opened (milliseconds since 1970). */
  first: number;
  last: number;
  opens: number;
  /** Seconds spent reading it, in all. */
  seconds: number;
}

/**
 * How long each book has been read, for Where am I. Time counts while the book is open, Reader's
 * window is in front, and the reader is doing something: pressing keys, clicking, or listening.
 * Kept per book in localStorage, beside its saved place.
 */
export class ReadingStats {
  private key = '';
  private stats: BookStats | undefined;
  private session = 0;
  private active = Date.now();

  constructor(private readonly playing: () => boolean) {
    for (const type of ['keydown', 'mousedown', 'wheel']) document.addEventListener(type, () => (this.active = Date.now()), true);
    setInterval(() => this.tick(), TICK_MS);
  }

  /** A book was opened; `key` names it as its saved place does. */
  open(key: string): void {
    this.key = `stats:${key}`;
    const now = Date.now();
    const saved = this.load();
    this.stats = { first: saved?.first ?? now, last: now, opens: (saved?.opens ?? 0) + 1, seconds: saved?.seconds ?? 0 };
    this.session = 0;
    this.active = now;
    this.save();
  }

  close(): void {
    this.stats = undefined;
    this.key = '';
  }

  /** This book's figures, and the seconds read since it was opened this time. */
  current(): (BookStats & { session: number }) | undefined {
    return this.stats && { ...this.stats, session: this.session };
  }

  private tick(): void {
    if (!this.stats || !document.hasFocus()) return;
    if (!this.playing() && Date.now() - this.active > IDLE_MS) return;
    this.stats.seconds += TICK_MS / 1000;
    this.session += TICK_MS / 1000;
    this.save();
  }

  private load(): BookStats | undefined {
    try {
      const value = JSON.parse(localStorage.getItem(this.key) ?? 'null');
      return value && typeof value.seconds === 'number' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private save(): void {
    try {
      if (this.stats) localStorage.setItem(this.key, JSON.stringify(this.stats));
    } catch {
      // Not kept; the figures still show until Reader closes.
    }
  }
}

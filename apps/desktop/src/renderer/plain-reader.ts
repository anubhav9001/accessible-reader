import type { TextRef } from '@accessible-reader/engine';
import { blockAt, buildPlainBook, findItem, itemAt, type PlainBlock, type PlainBook, type PlainItem, type PlainKind } from '@accessible-reader/web-view';

export interface PlainReaderEvents {
  /** The reader moved the cursor (arrow keys, navigation keys, a followed link). */
  caret(offset: number, block: PlainBlock | undefined): void;
  announce(message: string): void;
  /** Enter on a table: show it as a real table, for the screen reader's table commands. */
  table(item: PlainItem): void;
}

/** Single-letter navigation keys, as in browse mode and Paperback. Shift goes backwards. */
const KEYS: Record<string, { kind: PlainKind; name: string; plural?: string }> = {
  h: { kind: 'heading', name: 'heading' },
  p: { kind: 'page', name: 'page' },
  k: { kind: 'link', name: 'link' },
  t: { kind: 'table', name: 'table' },
  l: { kind: 'list', name: 'list' },
  i: { kind: 'item', name: 'list item' },
  g: { kind: 'image', name: 'image' },
  f: { kind: 'figure', name: 'figure' },
  s: { kind: 'separator', name: 'separator' },
};

/**
 * The most characters the text box holds at once. NVDA reads the whole of a text field when
 * it gets focus; a whole book (over a million characters) froze it for more than ten seconds.
 */
const WINDOW_SIZE = 20_000;
/** When the cursor comes this close to either end of the box, the box moves on quietly. */
const MARGIN = 5_000;

/**
 * Screen reader mode: the book as plain text in a text box. The screen reader's own cursor is
 * the reading position, so arrow keys, say all and the screen reader's review commands all
 * work, and the app remembers exactly where the cursor is. The box holds about 20,000
 * characters around the cursor; as the reader moves towards either end, it moves on with them
 * before they get there, so reading goes straight on. The navigation keys search the whole
 * book. Offsets are always into the whole book's text.
 */
export class PlainReader {
  book: PlainBook | undefined;
  private building: Promise<PlainBook | undefined> | undefined;
  private generation = 0;
  private quiet = false;
  private caretTimer: ReturnType<typeof setTimeout> | undefined;
  private lastCaret = -1;
  /** The part of the book's text in the box. */
  private win: { start: number; end: number } | undefined;

  constructor(
    readonly area: HTMLTextAreaElement,
    private readonly events: PlainReaderEvents,
  ) {
    area.addEventListener('keydown', (event) => this.onKey(event));
    // The box is an ordinary (editable) text field, because screen readers only follow the
    // cursor and switch to focus mode by themselves in an editable one, as they do in
    // Paperback's native text box. Every change to the text is refused here instead.
    area.readOnly = false;
    area.addEventListener('beforeinput', (event) => event.preventDefault());
    for (const type of ['paste', 'cut', 'drop'] as const) area.addEventListener(type, (event) => event.preventDefault());
    // And if anything still gets through, put the book's text back where it was.
    area.addEventListener('input', () => {
      const w = this.win;
      if (!this.book || !w || area.value === this.book.text.slice(w.start, w.end)) return;
      const at = this.lastCaret >= 0 ? this.lastCaret : this.caret;
      this.win = undefined;
      this.place(at);
    });
    for (const type of ['keyup', 'mouseup', 'focus', 'select', 'selectionchange'] as const) {
      area.addEventListener(type, () => this.watchCaret());
    }
  }

  /** The cursor, as an offset into the whole book. */
  get caret(): number {
    return (this.win?.start ?? 0) + this.area.selectionStart;
  }

  get ready(): boolean {
    return !!this.book;
  }

  clear(): void {
    this.generation++;
    this.book = undefined;
    this.building = undefined;
    this.area.value = '';
    this.lastCaret = -1;
    this.win = undefined;
  }

  /** Reads the book in (once per book); resolves when the text is in the box. */
  load(documents: readonly { path: string; mediaType: string }[], url: (path: string) => string): Promise<PlainBook | undefined> {
    if (this.book) return Promise.resolve(this.book);
    if (this.building) return this.building;
    const generation = this.generation;
    this.area.value = 'Preparing the text of this book…';
    this.building = buildPlainBook(documents, url).then((book) => {
      if (generation !== this.generation) return undefined;
      this.book = book;
      this.win = undefined;
      this.place(0);
      return book;
    });
    return this.building;
  }

  /** Moves the cursor without reporting it as the reader's own move. */
  place(offset: number): void {
    if (!this.book) return;
    const at = Math.max(0, Math.min(offset, this.book.text.length));
    this.quiet = true;
    this.setCaret(at);
    this.lastCaret = at;
    this.quiet = false;
    this.scrollToCaret();
  }

  /** Puts the cursor at `offset`, first moving the box on if it is outside or near an end. */
  private setCaret(offset: number): void {
    if (!this.book) return;
    if (!this.win || this.nearEdge(offset)) this.showAround(offset);
    const w = this.win!;
    const local = Math.max(0, Math.min(offset - w.start, w.end - w.start));
    this.area.setSelectionRange(local, local);
  }

  /** Whether `offset` is outside the box, or close to an end of it that isn't the book's. */
  private nearEdge(offset: number): boolean {
    const w = this.win;
    if (!w || !this.book) return true;
    if (offset < w.start || offset > w.end) return true;
    return (w.start > 0 && offset - w.start < MARGIN) || (w.end < this.book.text.length && w.end - offset < MARGIN);
  }

  /** Fills the box with about WINDOW_SIZE characters around `offset`, cut at line breaks. */
  private showAround(offset: number): void {
    if (!this.book) return;
    const text = this.book.text;
    const from = Math.max(0, Math.min(offset - WINDOW_SIZE / 2, text.length - WINDOW_SIZE));
    const start = from > 0 ? Math.min(text.lastIndexOf('\n', from) + 1, offset) : 0;
    let end = Math.min(text.length, start + WINDOW_SIZE);
    if (end < text.length) {
      const cut = text.lastIndexOf('\n', end);
      end = cut >= offset ? cut : end;
    }
    if (this.win && this.win.start === start && this.win.end === end) return;
    const quiet = this.quiet;
    this.quiet = true;
    this.area.value = text.slice(start, end);
    this.win = { start, end };
    this.quiet = quiet;
  }

  focus(): void {
    this.area.focus();
  }

  blockOffset(path: string, index: number): number | undefined {
    const lower = path.toLowerCase();
    return this.book?.blocks.find((b) => b.index === index && b.path.toLowerCase() === lower)?.start;
  }

  anchorOffset(target: TextRef): number | undefined {
    if (!this.book) return undefined;
    const doc = this.book.docs.find((d) => d.path.toLowerCase() === target.path.toLowerCase());
    if (!doc) return undefined;
    if (!target.fragment) return doc.start;
    return this.book.anchors.get(`${doc.path}#${target.fragment}`) ?? doc.start;
  }

  /** The line of text at an offset. */
  lineAt(offset: number): string {
    const text = this.book?.text ?? '';
    const start = text.lastIndexOf('\n', offset - 1) + 1;
    const end = text.indexOf('\n', offset);
    return text.slice(start, end < 0 ? undefined : end).trim();
  }

  /** Moves to the next or previous item of a kind and says what is there. */
  go(kind: PlainKind, direction: 1 | -1, name: string, level?: number, maxLevel?: number): void {
    if (!this.book) return;
    const item = findItem(this.book, this.caret, kind, direction, level, maxLevel);
    const what = level ? `${name} at level ${level}` : maxLevel ? `${name} at level ${maxLevel} or above` : name;
    if (!item) return this.events.announce(`No ${direction > 0 ? 'next' : 'previous'} ${what}`);
    this.moveTo(item.start);
    this.events.announce(this.describe(item));
  }

  /** Where the cursor is, as a percentage of the book and the printed page. */
  whereAmI(): string {
    if (!this.book) return '';
    const percent = Math.round((this.caret / Math.max(1, this.book.text.length)) * 100);
    const page = findItem(this.book, this.caret + 1, 'page', -1);
    return [`${percent} percent`, page?.label].filter(Boolean).join(', ');
  }

  private describe(item: PlainItem): string {
    const line = this.lineAt(item.start);
    switch (item.kind) {
      case 'heading':
        return `Heading level ${item.level}, ${item.label || line}`;
      case 'page':
        return [item.label, line].filter(Boolean).join('. ');
      case 'link':
        return `Link, ${item.label}`;
      case 'table':
        return [`Table with ${item.count} row${item.count === 1 ? '' : 's'}`, item.label].filter(Boolean).join(', ');
      case 'list':
        return `List with ${item.count} item${item.count === 1 ? '' : 's'}`;
      case 'figure':
        return ['Figure', item.label].filter(Boolean).join(', ');
      case 'section':
        return `Section, ${line}`;
      default:
        return item.label || line;
    }
  }

  /** The reader's own move: report it, and keep the cursor line in view. */
  private moveTo(offset: number): void {
    this.setCaret(offset);
    this.scrollToCaret();
    this.reportCaret();
  }

  /**
   * A focused text box keeps its cursor in view by itself. When it isn't focused (the app
   * reading aloud), scroll roughly to the cursor's line so sighted helpers can follow.
   */
  private scrollToCaret(): void {
    if (document.activeElement === this.area || !this.book) return;
    const length = this.area.value.length;
    const ratio = length ? this.area.selectionStart / length : 0;
    this.area.scrollTop = Math.max(0, ratio * this.area.scrollHeight - this.area.clientHeight / 3);
  }

  private onKey(event: KeyboardEvent): void {
    if (!this.book || event.ctrlKey || event.altKey || event.metaKey) return;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.shiftKey && this.crossEdge(event.key === 'ArrowDown' ? 1 : -1)) {
      event.preventDefault();
      return;
    }
    const back = event.shiftKey ? -1 : 1;
    const digit = /^Digit([1-6])$/.exec(event.code);
    let handled = true;
    if (digit) {
      this.go('heading', back, 'heading', Number(digit[1]));
    } else if (event.key === ']' || event.key === '[') {
      this.go('section', event.key === ']' ? 1 : -1, 'section');
    } else if (event.key === '=') {
      this.events.announce(this.whereAmI());
    } else if (event.key === 'Enter' || event.key === ' ') {
      this.followLink();
    } else {
      const key = KEYS[event.key.toLowerCase()];
      if (key) this.go(key.kind, back, key.name);
      else handled = false;
    }
    if (handled) event.preventDefault();
  }

  /**
   * The box normally moves on before the cursor reaches an end. If the reader still gets to
   * its last line (or first) and the book goes on, move to the next (or previous) line here.
   */
  private crossEdge(direction: 1 | -1): boolean {
    if (!this.book || !this.win) return false;
    const value = this.area.value;
    const local = this.area.selectionStart;
    const text = this.book.text;
    if (direction > 0 ? this.win.end >= text.length : this.win.start <= 0) return false;
    const onEdge = direction > 0 ? value.indexOf('\n', local) < 0 : value.lastIndexOf('\n', local - 1) < 0;
    if (!onEdge) return false;
    const caret = this.caret;
    const target =
      direction > 0 ? text.indexOf('\n', caret) + 1 : text.lastIndexOf('\n', text.lastIndexOf('\n', caret - 1) - 1) + 1;
    this.moveTo(target);
    this.events.announce(this.lineAt(target) || 'Blank');
    return true;
  }

  private followLink(): void {
    if (!this.book) return;
    const link = itemAt(this.book, this.caret, 'link');
    if (!link) {
      const table = itemAt(this.book, this.caret, 'table');
      if (table?.html) return this.events.table(table);
      return this.events.announce('No link or table here');
    }
    if (!link.target) return this.events.announce(`${link.label}. This link goes outside the book.`);
    const offset = this.anchorOffset(link.target);
    if (offset === undefined) return this.events.announce('That part of the book could not be found.');
    this.moveTo(offset);
    this.events.announce(this.lineAt(offset));
  }

  private watchCaret(): void {
    if (this.quiet) return;
    clearTimeout(this.caretTimer);
    this.caretTimer = setTimeout(() => this.reportCaret(), 150);
  }

  private reportCaret(): void {
    clearTimeout(this.caretTimer);
    if (!this.book || this.quiet) return;
    const offset = this.caret;
    // Move the box on quietly before the reader reaches an end of it.
    if (this.area.selectionStart === this.area.selectionEnd && this.nearEdge(offset)) {
      this.quiet = true;
      this.setCaret(offset);
      this.quiet = false;
    }
    if (offset === this.lastCaret) return;
    this.lastCaret = offset;
    this.events.caret(offset, blockAt(this.book, offset));
  }

  /** Reports a cursor move not yet reported (before saving on quit). */
  flush(): void {
    if (this.caretTimer !== undefined) this.reportCaret();
  }
}

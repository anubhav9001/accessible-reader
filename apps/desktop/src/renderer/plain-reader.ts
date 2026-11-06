import type { TextRef } from '@accessible-reader/engine';
import { blockAt, buildPlainBook, findItem, itemAt, type PlainBlock, type PlainBook, type PlainItem, type PlainKind } from '@accessible-reader/web-view';

export interface PlainReaderEvents {
  /** The reader moved the cursor (arrow keys, navigation keys, a followed link). */
  caret(offset: number, block: PlainBlock | undefined): void;
  announce(message: string): void;
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
 * Screen reader mode: the whole book as plain text in one read-only text box. The screen
 * reader's own cursor is the reading position, so arrow keys, say all and the screen
 * reader's review commands all work, and the app remembers exactly where the cursor is.
 */
export class PlainReader {
  book: PlainBook | undefined;
  private building: Promise<PlainBook | undefined> | undefined;
  private generation = 0;
  private quiet = false;
  private caretTimer: ReturnType<typeof setTimeout> | undefined;
  private lastCaret = -1;

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
      if (!this.book || area.value === this.book.text) return;
      const at = Math.min(this.lastCaret >= 0 ? this.lastCaret : area.selectionStart, this.book.text.length);
      this.quiet = true;
      area.value = this.book.text;
      area.setSelectionRange(at, at);
      this.quiet = false;
    });
    for (const type of ['keyup', 'mouseup', 'focus', 'select', 'selectionchange'] as const) {
      area.addEventListener(type, () => this.watchCaret());
    }
  }

  get caret(): number {
    return this.area.selectionStart;
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
      this.quiet = true;
      this.area.value = book.text;
      this.area.setSelectionRange(0, 0);
      this.quiet = false;
      return book;
    });
    return this.building;
  }

  /** Moves the cursor without reporting it as the reader's own move. */
  place(offset: number): void {
    if (!this.book) return;
    const at = Math.max(0, Math.min(offset, this.book.text.length));
    this.quiet = true;
    this.area.setSelectionRange(at, at);
    this.lastCaret = at;
    this.quiet = false;
    this.scrollToCaret();
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
    this.area.setSelectionRange(offset, offset);
    this.scrollToCaret();
    this.reportCaret();
  }

  /**
   * A focused text box keeps its cursor in view by itself. When it isn't focused (the app
   * reading aloud), scroll roughly to the cursor's line so sighted helpers can follow.
   */
  private scrollToCaret(): void {
    if (document.activeElement === this.area || !this.book) return;
    const text = this.book.text;
    const ratio = text.length ? this.caret / text.length : 0;
    this.area.scrollTop = Math.max(0, ratio * this.area.scrollHeight - this.area.clientHeight / 3);
  }

  private onKey(event: KeyboardEvent): void {
    if (!this.book || event.ctrlKey || event.altKey || event.metaKey) return;
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

  private followLink(): void {
    if (!this.book) return;
    const link = itemAt(this.book, this.caret, 'link');
    if (!link) return this.events.announce('No link here');
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
    if (offset === this.lastCaret) return;
    this.lastCaret = offset;
    this.events.caret(offset, blockAt(this.book, offset));
  }

  /** Reports a cursor move not yet reported (before saving on quit). */
  flush(): void {
    if (this.caretTimer !== undefined) this.reportCaret();
  }
}

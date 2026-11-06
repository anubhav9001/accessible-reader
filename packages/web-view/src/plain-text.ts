import { resolveHref, type TextRef } from '@accessible-reader/engine';
import { innermostBlocks, PAGE_MARKERS, parseBookDocument, REMOVED } from './document-view.js';

/** What the structural navigation keys move between. */
export type PlainKind =
  | 'heading'
  | 'page'
  | 'link'
  | 'table'
  | 'list'
  | 'item'
  | 'figure'
  | 'image'
  | 'separator'
  | 'section';

export interface PlainItem {
  kind: PlainKind;
  /** Character offsets into PlainBook.text. */
  start: number;
  end: number;
  /** What to say on arriving, e.g. the heading's text or "Page 12". */
  label: string;
  /** Heading level 1–6. */
  level?: number;
  /** Where a link inside the book leads. */
  target?: TextRef;
  /** Rows of a table, or items of a list. */
  count?: number;
}

/** One readable block, matching DocumentView.blocks() of its document, so places carry across. */
export interface PlainBlock {
  path: string;
  index: number;
  start: number;
  end: number;
}

/**
 * The whole book as one plain text, for reading with a screen reader's own cursor, with
 * the structure kept alongside so headings, pages, links, tables and lists can still be
 * reached by key.
 */
export interface PlainBook {
  text: string;
  /** Sorted by start. */
  items: PlainItem[];
  /** Sorted by start. */
  blocks: PlainBlock[];
  /** "path#id" for every element id, so links and narration clips find their text. */
  anchors: Map<string, number>;
  /** Where each document of the reading order starts. */
  docs: { path: string; start: number }[];
}

// Elements that start and end a line of their own.
const LINE_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'caption', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption',
  'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul',
]);
const SKIPPED = new Set(['head', 'title', 'template', 'math-annotation', 'annotation']);

/** Builds up the text one piece at a time, collapsing white space the way a page does. */
class TextWriter {
  private readonly parts: string[] = [];
  length = 0;
  private atLineStart = true;
  private pendingSpace = false;

  text(raw: string, pre: boolean): void {
    if (pre) {
      this.flushSpace();
      this.push(raw);
      return;
    }
    const collapsed = raw.replace(/\s+/g, ' ');
    if (!collapsed.trim()) {
      if (collapsed && !this.atLineStart) this.pendingSpace = true;
      return;
    }
    const lead = collapsed.startsWith(' ');
    const trail = collapsed.endsWith(' ');
    if (lead && !this.atLineStart) this.pendingSpace = true;
    this.flushSpace();
    this.push(collapsed.trim());
    this.pendingSpace = trail;
  }

  /** Text that belongs to the app, not the book (a list bullet, a table cell divider). */
  marker(s: string): void {
    this.flushSpace();
    this.push(s);
  }

  newline(): void {
    this.pendingSpace = false;
    if (!this.atLineStart) this.push('\n');
  }

  /** Where the next character will go. */
  get here(): number {
    return this.length + (this.pendingSpace && !this.atLineStart ? 1 : 0);
  }

  toString(): string {
    return this.parts.join('');
  }

  private flushSpace(): void {
    if (this.pendingSpace && !this.atLineStart) this.push(' ');
    this.pendingSpace = false;
  }

  private push(s: string): void {
    if (!s) return;
    this.parts.push(s);
    this.length += s.length;
    this.atLineStart = s.endsWith('\n');
  }
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function addDocument(path: string, body: Element, w: TextWriter, book: Omit<PlainBook, 'text'>): void {
  for (const el of Array.from(body.querySelectorAll(REMOVED))) el.remove();
  const blockIndex = new Map(innermostBlocks(body).map((b, i) => [b as Element, i] as const));
  const pageMarkers = new Set(Array.from(body.querySelectorAll(PAGE_MARKERS)));
  let pre = 0;

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      w.text((node as CharacterData).data, pre > 0);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    if (SKIPPED.has(tag) || el.hasAttribute('hidden')) return;

    const id = el.getAttribute('id') ?? (tag === 'a' ? el.getAttribute('name') : null);
    if (id) book.anchors.set(`${path}#${id}`, w.here);

    if (pageMarkers.has(el)) {
      const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? `Page ${clean(el.textContent)}`;
      book.items.push({ kind: 'page', start: w.here, end: w.here, label: clean(label) });
      return;
    }
    if (tag === 'img' || tag === 'image') {
      const alt = clean(el.getAttribute('alt') ?? el.getAttribute('aria-label') ?? el.getAttribute('title'));
      const start = w.here;
      if (alt) w.text(`[${alt}]`, false);
      book.items.push({ kind: 'image', start, end: w.length, label: alt ? `Image: ${alt}` : 'Image' });
      return;
    }
    if (tag === 'br') {
      w.newline();
      return;
    }
    if (tag === 'hr') {
      w.newline();
      const start = w.here;
      w.marker('* * *');
      w.newline();
      book.items.push({ kind: 'separator', start, end: start + 5, label: 'Separator' });
      return;
    }

    const heading = /^h([1-6])$/.exec(tag);
    const line = LINE_ELEMENTS.has(tag);
    if (line) w.newline();

    // Cells of a row stay on one line, divided by a bar.
    if ((tag === 'td' || tag === 'th') && el.previousElementSibling) w.marker(' | ');
    if (tag === 'li') {
      const list = el.parentElement;
      if (list?.localName.toLowerCase() === 'ol') {
        const items = Array.from(list.children).filter((c) => c.localName.toLowerCase() === 'li');
        const first = Number(list.getAttribute('start') ?? '1') || 1;
        w.marker(`${first + items.indexOf(el)}. `);
      } else {
        w.marker('• ');
      }
    }

    const start = w.here;
    if (tag === 'pre') pre++;
    for (const child of Array.from(el.childNodes)) visit(child);
    if (tag === 'pre') pre--;
    const end = w.length;

    const block = blockIndex.get(el);
    if (block !== undefined) book.blocks.push({ path, index: block, start, end });

    if (heading) {
      book.items.push({ kind: 'heading', start, end, level: Number(heading[1]), label: clean(el.textContent) });
    } else if (tag === 'a' && el.getAttribute('href')) {
      const href = el.getAttribute('href')!;
      const target = href.startsWith('#')
        ? { path, fragment: href.slice(1) || undefined }
        : /^[a-z][a-z0-9+.-]*:/i.test(href)
          ? undefined
          : resolveHref(path, href);
      book.items.push({ kind: 'link', start, end, label: clean(el.textContent) || href, target });
    } else if (tag === 'table') {
      const rows = el.querySelectorAll('tr').length;
      const caption = clean(el.querySelector('caption')?.textContent);
      book.items.push({ kind: 'table', start, end, count: rows, label: caption });
    } else if (tag === 'ul' || tag === 'ol' || tag === 'dl') {
      const count = Array.from(el.children).filter((c) => /^(li|dt)$/i.test(c.localName)).length;
      book.items.push({ kind: 'list', start, end, count, label: '' });
    } else if (tag === 'li') {
      book.items.push({ kind: 'item', start, end, label: clean(el.textContent) });
    } else if (tag === 'figure') {
      const caption = clean(el.querySelector('figcaption')?.textContent);
      book.items.push({ kind: 'figure', start, end, label: caption });
    }

    if (line) w.newline();
  };

  visit(body);
}

/**
 * Reads every text document of the book, in reading order, into one PlainBook. Documents
 * are parsed without being shown, so nothing in them (images, audio) loads.
 */
export async function buildPlainBook(
  documents: readonly { path: string; mediaType: string }[],
  url: (path: string) => string,
): Promise<PlainBook> {
  const w = new TextWriter();
  const book: Omit<PlainBook, 'text'> = { items: [], blocks: [], anchors: new Map(), docs: [] };
  for (const doc of documents) {
    let body: Element;
    try {
      const text = await (await fetch(url(doc.path))).text();
      body = parseBookDocument(text, doc.path, doc.mediaType).body;
    } catch {
      continue;
    }
    w.newline();
    const start = w.here;
    book.docs.push({ path: doc.path, start });
    book.items.push({ kind: 'section', start, end: start, label: '' });
    addDocument(doc.path, body, w, book);
    // Let the window stay responsive while a long book is read in.
    await new Promise((r) => setTimeout(r, 0));
  }
  const byStart = (a: { start: number }, b: { start: number }) => a.start - b.start;
  book.items.sort(byStart);
  book.blocks.sort(byStart);
  return { ...book, text: w.toString() };
}

/** The block holding an offset, or the last one before it. */
export function blockAt(book: PlainBook, offset: number): PlainBlock | undefined {
  let lo = 0;
  let hi = book.blocks.length - 1;
  let found: PlainBlock | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (book.blocks[mid]!.start <= offset) {
      found = book.blocks[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found ?? book.blocks[0];
}

/** The document an offset falls in. */
export function documentAt(book: PlainBook, offset: number): string | undefined {
  let path: string | undefined;
  for (const d of book.docs) {
    if (d.start > offset) break;
    path = d.path;
  }
  return path ?? book.docs[0]?.path;
}

/**
 * The next (1) or previous (-1) item of a kind from an offset. For headings, `level` keeps
 * to one level, and `maxLevel` to that level and above (e.g. chapters and sections only).
 */
export function findItem(
  book: PlainBook,
  offset: number,
  kind: PlainKind,
  direction: 1 | -1,
  level?: number,
  maxLevel?: number,
): PlainItem | undefined {
  const matches = (i: PlainItem) =>
    i.kind === kind && (level === undefined || i.level === level) && (maxLevel === undefined || (i.level ?? 0) <= maxLevel);
  if (direction > 0) return book.items.find((i) => i.start > offset && matches(i));
  for (let k = book.items.length - 1; k >= 0; k--) {
    const i = book.items[k]!;
    if (i.start < offset && matches(i)) return i;
  }
  return undefined;
}

/** The innermost item of a kind that contains an offset (e.g. the link under the cursor). */
export function itemAt(book: PlainBook, offset: number, kind: PlainKind): PlainItem | undefined {
  let found: PlainItem | undefined;
  for (const i of book.items) {
    if (i.start > offset) break;
    if (i.kind === kind && offset < Math.max(i.end, i.start + 1)) found = i;
  }
  return found;
}

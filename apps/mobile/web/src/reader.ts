import {
  HttpContainer,
  NarrationTimeline,
  currentHeading,
  currentPage,
  defaultReadingMode,
  findPage,
  nextHeading,
  nextPage,
  openPublication,
  previousHeading,
  previousPage,
  readingModes,
  type PublicationData,
  type TextRef,
} from '@accessible-reader/engine';
import { browserPlatform } from '@accessible-reader/engine/browser';
import { DocumentView } from '@accessible-reader/web-view';

/**
 * The reader page inside the mobile app's WebView. The Flutter side owns playback and
 * the screens; it calls the methods below through `readerBridge.call(id, method, args)`
 * and gets each result back as a {type: 'result', id, value} message on ReaderChannel.
 */

declare global {
  interface Window {
    ReaderChannel?: { postMessage(message: string): void };
    readerBridge: { call(id: number, method: string, args: unknown[]): Promise<void> };
  }
}

/** A text document as the Flutter side sees it: one entry per readable block. */
interface TextDoc {
  path: string;
  index: number;
  lang: string;
  blocks: { text: string; heading: number | null }[];
}

const post = (message: object) => window.ReaderChannel?.postMessage(JSON.stringify(message));
const textEl = document.getElementById('text')!;

let book: PublicationData | undefined;
let view: DocumentView | undefined;
let blocks: HTMLElement[] = [];

function requireBook(): { book: PublicationData; view: DocumentView } {
  if (!book || !view) throw new Error('No book open');
  return { book, view };
}

function resource(path: string) {
  return book?.readingOrder.find((r) => r.path.toLowerCase() === path.toLowerCase());
}

function textForClip(index: number | null | undefined): TextRef | undefined {
  const text = index === null || index === undefined ? undefined : book?.narration[index]?.text;
  return text && resource(text.path) ? text : undefined;
}

function headingLevel(el: Element): number | null {
  const m = /^h([1-6])$/i.exec(el.tagName);
  return m ? Number(m[1]) : null;
}

function blockIndexFor(el: Element | undefined): number {
  if (!el) return 0;
  const i = blocks.findIndex((b) => b === el || b.contains(el) || el.contains(b));
  if (i >= 0) return i;
  const after = blocks.findIndex((b) => el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  return after >= 0 ? after : Math.max(0, blocks.length - 1);
}

function describeDoc(index: number): TextDoc {
  const { view } = requireBook();
  return {
    path: view.currentPath!,
    index,
    lang: view.lang,
    blocks: blocks.map((b) => ({ text: (b.innerText || b.textContent || '').trim(), heading: headingLevel(b) })),
  };
}

async function show(ref: TextRef, focus: boolean): Promise<HTMLElement | undefined> {
  const { view } = requireBook();
  const r = resource(ref.path);
  if (!r) return undefined;
  const changed = view.currentPath !== r.path;
  await view.show(r.path, r.mediaType);
  if (changed) blocks = view.blocks();
  const el = ref.fragment ? view.highlight(ref.fragment) : undefined;
  if (!ref.fragment) view.highlightElement(undefined);
  if (focus) view.focus(el);
  return el;
}

/** Shows the nearest document after (1) or before (-1) the current one that has readable text. */
async function showDocumentWithText(direction: 1 | -1): Promise<boolean> {
  const { book, view } = requireBook();
  const order = book.readingOrder;
  for (let i = order.findIndex((r) => r.path === view.currentPath) + direction; i >= 0 && i < order.length; i += direction) {
    await show({ path: order[i]!.path }, false);
    if (blocks.length) return true;
  }
  return false;
}

const methods = {
  /** Opens the book served at `baseUrl`, whose files are `paths`. */
  async open(baseUrl: string, paths: string[]) {
    const container = new HttpContainer(baseUrl, paths);
    const { container: _files, ...data } = await openPublication(container, browserPlatform);
    book = data;
    view = new DocumentView(textEl, (p) => container.url(p), (target) => post({ type: 'link', target }));
    blocks = [];
    const timeline = new NarrationTimeline(book.narration);
    return {
      publication: book,
      modes: readingModes(book),
      defaultMode: defaultReadingMode(book),
      clipStarts: book.narration.map((c) => timeline.startOf(c.index)),
      duration: timeline.duration,
    };
  },

  /** Shows and highlights a narration clip's text. Returns false when the clip has no displayable text. */
  async showClip(index: number, focus: boolean) {
    const ref = textForClip(index);
    if (!ref) return false;
    await show(ref, focus);
    return true;
  },

  /** Next/previous heading or page from a clip, for books read by clip (recorded audio). */
  clipNav(kind: 'heading' | 'page', direction: 1 | -1, clipIndex: number, level: number) {
    const { book } = requireBook();
    if (kind === 'heading') {
      const h =
        direction > 0 ? nextHeading(book, clipIndex, level || undefined) : previousHeading(book, clipIndex, level || undefined);
      return h?.clipIndex === undefined ? null : { clipIndex: h.clipIndex, label: h.label };
    }
    const p = direction > 0 ? nextPage(book, clipIndex) : previousPage(book, clipIndex);
    return p?.clipIndex === undefined ? null : { clipIndex: p.clipIndex, label: `Page ${p.label}` };
  },

  location(clipIndex: number) {
    const { book } = requireBook();
    const page = currentPage(book, clipIndex);
    return { heading: currentHeading(book, clipIndex)?.label ?? null, page: page ? `Page ${page.label}` : null };
  },

  findPage(label: string) {
    const { book } = requireBook();
    const p = findPage(book, label);
    if (!p) return null;
    const target = resource(p.target.path) ? p.target : textForClip(p.clipIndex);
    return { label: `Page ${p.label}`, clipIndex: p.clipIndex ?? null, target: target ?? null };
  },

  /**
   * Loads the text for reading by block (device voice or stepping by hand), at a TOC/page
   * target, at a clip's text, or at the current place.
   */
  async textAt(ref: TextRef | null, clipIndex: number | null): Promise<TextDoc> {
    const { book, view } = requireBook();
    const explicit = (ref && resource(ref.path) ? ref : undefined) ?? textForClip(clipIndex);
    const target: TextRef =
      explicit ??
      (view.currentPath ? { path: view.currentPath, fragment: view.current?.id || undefined } : { path: book.readingOrder[0]!.path });
    const el = await show(target, false);
    if (!blocks.length) blocks = view.blocks();
    // With no particular place asked for, start at the first page with text, not a cover picture.
    if (!explicit && !blocks.length && (await showDocumentWithText(1))) return describeDoc(0);
    return describeDoc(blockIndexFor(el ?? view.current));
  },

  /**
   * Moves to the next (1) or previous (-1) text document that has text, skipping pages with
   * only pictures. Returns null at either end of the book.
   */
  async textDocument(direction: 1 | -1): Promise<TextDoc | null> {
    if (!(await showDocumentWithText(direction))) return null;
    return describeDoc(direction > 0 ? 0 : blocks.length - 1);
  },

  highlightBlock(index: number, focus: boolean) {
    const { view } = requireBook();
    const el = blocks[index];
    if (!el) return;
    view.highlightElement(el);
    if (focus) view.focus(el);
  },

  /** Next/previous printed page marker in the current document, as a block index. */
  pageInText(direction: 1 | -1, blockIndex: number) {
    const { view } = requireBook();
    const here = blocks[blockIndex];
    if (!here) return null;
    const after = (m: Element) => !!(here.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) && !here.contains(m);
    const markers = view.pageMarkers();
    const marker = direction > 0 ? markers.find(after) : [...markers].reverse().find((m) => !after(m) && !here.contains(m));
    if (!marker) return null;
    return { index: blockIndexFor(marker), label: marker.getAttribute('aria-label') ?? `Page ${marker.textContent?.trim()}` };
  },

  /** The narration clip for a text block, used to carry the position into a recorded-audio mode. */
  clipForBlock(blockIndex: number) {
    const { book, view } = requireBook();
    const el = blocks[blockIndex];
    const id = el?.id || el?.querySelector('[id]')?.id;
    if (!id || !view.currentPath) return null;
    const path = view.currentPath.toLowerCase();
    return book.narration.find((c) => c.text?.fragment === id && c.text.path.toLowerCase() === path)?.index ?? null;
  },

  setFontScale(scale: number) {
    document.documentElement.style.setProperty('--font-scale', String(scale));
  },
};

type Methods = typeof methods;

window.readerBridge = {
  async call(id, method, args) {
    try {
      const fn = methods[method as keyof Methods] as (...a: unknown[]) => unknown;
      if (!fn) throw new Error(`Unknown method ${method}`);
      post({ type: 'result', id, value: (await fn(...args)) ?? null });
    } catch (err) {
      post({ type: 'result', id, error: err instanceof Error ? err.message : String(err) });
    }
  },
};

post({ type: 'ready' });

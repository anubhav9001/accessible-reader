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
import { BookPageView, DocumentView } from '@accessible-reader/web-view';

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
/** One document at a time, or (screen reader mode) the whole book as one text-only page. */
let view: DocumentView | BookPageView | undefined;
let bookUrl: (path: string) => string = (p) => p;
let blocks: HTMLElement[] = [];
const blockIndex = new Map<Element, number>();
/** The block the reader is at: set by the app's own moves, or by the screen reader (see trackPlace). */
let place = -1;
/** Off while the app reads aloud, when it already knows the place. */
let tracking = true;
/** Each block's narration clip, or the last clip before it; worked out once per document. */
let clipsByBlock: (number | null)[] | undefined;

function requireBook(): { book: PublicationData; view: DocumentView | BookPageView } {
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
  // Usually the element is a block or inside one: walk up rather than search every block.
  for (let up: Element | null = el; up && up !== textEl; up = up.parentElement) {
    const at = blockIndex.get(up);
    if (at !== undefined) return at;
  }
  const i = blocks.findIndex((b) => el.contains(b));
  if (i >= 0) return i;
  const after = blocks.findIndex((b) => el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  return after >= 0 ? after : Math.max(0, blocks.length - 1);
}

function describeDoc(index: number): TextDoc {
  const { view } = requireBook();
  place = index;
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
  if (changed) blocks = focusable(view.blocks());
  const el = ref.fragment ? view.highlight(ref.fragment) : undefined;
  if (!ref.fragment) view.highlightElement(undefined);
  if (changed || el) place = blockIndexFor(el);
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

/**
 * Blocks can take focus (but are not Tab stops), so moving the screen reader's cursor onto
 * one can move focus there too, which trackPlace below hears.
 */
function focusable(list: HTMLElement[]): HTMLElement[] {
  blockIndex.clear();
  clipsByBlock = undefined;
  list.forEach((b, i) => {
    if (!b.hasAttribute('tabindex')) b.tabIndex = -1;
    blockIndex.set(b, i);
  });
  return list;
}

function isOnScreen(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight;
}

/** The clip narrating a block, or the last clip before it in the same document. */
function clipNear(index: number): number | null {
  if (!clipsByBlock) {
    const { book, view } = requireBook();
    const path = view.currentPath?.toLowerCase();
    const first: (number | null)[] = blocks.map(() => null);
    for (const clip of book.narration) {
      const text = clip.text;
      if (!text?.fragment || text.path.toLowerCase() !== path) continue;
      const el = view.element(text.fragment);
      if (!el) continue;
      const at = blockIndexFor(el);
      if (first[at] === null) first[at] = clip.index;
    }
    let last: number | null = null;
    clipsByBlock = first.map((c) => (last = c ?? last));
  }
  return clipsByBlock[index] ?? null;
}

function reportPlace(index: number) {
  if (!tracking || !view?.currentPath || index < 0 || index === place) return;
  place = index;
  markPlace(blocks[index]);
  post({ type: 'place', path: view.currentPath, index, clip: clipNear(index) });
}

/**
 * In the whole-book page the screen reader can read on into the next chapter; report the
 * block there with its own document, and the app makes that document the current one.
 */
function reportPlaceIn(el: Element | undefined) {
  if (!(view instanceof BookPageView) || !el) return;
  const block = el.closest<HTMLElement>('[data-block]');
  const path = view.documentOf(el);
  if (!block || !path) return;
  if (path === view.currentPath) return reportPlace(blockIndexFor(block));
  if (!tracking) return;
  markPlace(block);
  post({ type: 'place', path, index: Number(block.dataset.block), clip: null });
}

let marked: HTMLElement | undefined;
/** A visible "you are here" outline on the place, in screen reader mode. */
function markPlace(el: HTMLElement | undefined) {
  if (!(view instanceof BookPageView) || el === marked) return;
  marked?.classList.remove('reader-place');
  marked = el;
  el?.classList.add('reader-place');
}

/**
 * Follows the reader while TalkBack or VoiceOver reads the text by itself, which the app's
 * buttons never hear about, so the app can save the place and come back to it. Focus gives
 * the exact block where the screen reader moves focus with its cursor. Otherwise the page
 * scrolling to keep the screen reader's cursor in view is the sign: once the remembered
 * block has left the screen, the first block still on screen becomes the place, so the
 * reader may hear a few lines again but never misses any.
 */
function trackPlace() {
  textEl.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement;
    if (target === textEl) return;
    if (view instanceof BookPageView) reportPlaceIn(target);
    else reportPlace(blockIndexFor(target));
  });
  let timer: number | undefined;
  window.addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (place >= 0 && blocks[place] && isOnScreen(blocks[place]!)) return;
      if (view instanceof BookPageView) {
        // Any chapter can be on screen: look through the whole page.
        reportPlaceIn(Array.from(textEl.querySelectorAll<HTMLElement>('[data-block]')).find(isOnScreen));
      } else {
        reportPlace(blocks.findIndex(isOnScreen));
      }
    }, 250);
  }, { passive: true });
}

const methods = {
  /** Opens the book served at `baseUrl`, whose files are `paths`; `textOnly` is screen reader mode. */
  async open(baseUrl: string, paths: string[], textOnly = false) {
    const container = new HttpContainer(baseUrl, paths);
    const { container: _files, ...data } = await openPublication(container, browserPlatform);
    book = data;
    bookUrl = (p) => container.url(p);
    await useView(textOnly);
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
    if (!blocks.length) blocks = focusable(view.blocks());
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
    place = index;
    markPlace(el);
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

  /**
   * Puts the screen reader's cursor on block `index` (or the current place) by moving focus
   * there afresh; the app first gives the web view itself focus, or the move goes unheard.
   */
  startAt(index: number | null) {
    const el = blocks[index ?? place];
    if (!el) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    markPlace(el);
    view?.highlightElement(el);
    view?.focus(el);
  },

  /**
   * Screen reader mode on or off: the whole book as one text-only page, or the formatted
   * chapter. Returns the current document and block so the app can carry on there.
   */
  async setTextOnly(on: boolean) {
    const path = view?.currentPath ?? null;
    const index = place;
    await useView(on);
    if (path) await show({ path }, false);
    return { path, index };
  },

  /** Records where the screen reader is without moving anything (screen reader mode). */
  notePlace(index: number) {
    place = index;
    markPlace(blocks[index]);
  },

  /** The narration clip for block `index` of document `path` (screen reader mode, recorded audio). */
  async clipIn(path: string, index: number) {
    await show({ path }, false);
    place = index;
    return clipNear(index);
  },

  setTracking(on: boolean) {
    tracking = on;
  },

  setFontScale(scale: number) {
    document.documentElement.style.setProperty('--font-scale', String(scale));
  },
};

async function useView(textOnly: boolean) {
  view?.clear();
  blocks = [];
  blockIndex.clear();
  place = -1;
  marked = undefined;
  document.body.classList.toggle('text-only', textOnly);
  const onLink = (target: TextRef) => post({ type: 'link', target });
  if (textOnly && book) {
    const page = new BookPageView(textEl, bookUrl, onLink);
    view = page;
    await page.load(book.readingOrder.filter((r) => /html|xml|dtbook/i.test(r.mediaType)));
  } else {
    view = new DocumentView(textEl, bookUrl, onLink);
  }
}

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

trackPlace();
post({ type: 'ready' });

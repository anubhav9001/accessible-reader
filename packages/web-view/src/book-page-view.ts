import { resolveHref, type TextRef } from '@accessible-reader/engine';
import { innermostBlocks, PAGE_MARKERS, parseBookDocument, REMOVED } from './document-view.js';

// Structure kept in the text-only page, so a screen reader can still move by heading, list,
// table and link. Everything else (styling, pictures, layout boxes) is left out.
const KEPT = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'div',
  'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i',
  'li', 'main', 'nav', 'ol', 'p', 'pre', 'q', 's', 'section', 'small', 'span', 'strong', 'sub', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);
const KEPT_ATTRIBUTES = ['colspan', 'rowspan', 'scope', 'headers', 'lang', 'start', 'reversed', 'title'];
const DROPPED = new Set(['audio', 'video', 'canvas', 'svg', 'math', 'head', 'title', 'template', 'object', 'picture', 'source']);

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * The whole book as one text-only page: every document of the reading order, one after
 * another, with the book's own styling and pictures left out (pictures are replaced by
 * their descriptions) but its headings, lists, tables and links kept. It has the same
 * methods as DocumentView, scoped to the "current" document, so the reader can treat it
 * the same way while the screen reader reads straight through from chapter to chapter.
 */
export class BookPageView {
  currentPath: string | undefined;
  current: HTMLElement | undefined;
  lang = '';
  private sections = new Map<string, { el: HTMLElement; lang: string }>();

  constructor(
    private readonly el: HTMLElement,
    private readonly url: (path: string) => string,
    private readonly onLink: (target: TextRef) => void,
  ) {
    el.addEventListener('click', (event) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-target]');
      if (!link) return;
      event.preventDefault();
      const [path = '', fragment] = link.dataset.target!.split('#');
      const target = this.find(path, fragment);
      if (target) this.focus(target);
      this.onLink({ path, fragment: fragment || undefined });
    });
  }

  /** Reads every text document in. Nothing in them (images, audio) loads. */
  async load(documents: readonly { path: string; mediaType: string }[]): Promise<void> {
    this.clear();
    const parts: HTMLElement[] = [];
    for (const [n, doc] of documents.entries()) {
      let body: Element;
      let lang: string;
      try {
        const text = await (await fetch(this.url(doc.path))).text();
        ({ body, lang } = parseBookDocument(text, doc.path, doc.mediaType));
      } catch {
        continue;
      }
      const section = document.createElement('div');
      section.className = 'book-doc';
      section.dataset.doc = doc.path;
      if (lang) section.lang = lang;
      section.append(this.simplify(body, n, doc.path));
      this.sections.set(doc.path.toLowerCase(), { el: section, lang });
      parts.push(section);
      // Let the page stay responsive while a long book is read in.
      await new Promise((r) => setTimeout(r, 0));
    }
    this.el.replaceChildren(...parts);
  }

  /** Makes a document the current one. The page doesn't move; highlight() moves it. */
  async show(path: string, _mediaType?: string): Promise<void> {
    const section = this.sections.get(path.toLowerCase());
    if (!section) return;
    if (this.currentPath !== path) this.current = undefined;
    this.currentPath = path;
    this.lang = section.lang;
  }

  clear(): void {
    this.el.replaceChildren();
    this.sections.clear();
    this.currentPath = undefined;
    this.current = undefined;
  }

  highlight(fragment: string | undefined): HTMLElement | undefined {
    const target = fragment ? this.element(fragment) : undefined;
    this.highlightElement(target);
    return target;
  }

  highlightElement(target: HTMLElement | undefined): void {
    if (this.current === target) return;
    this.current?.classList.remove('current-phrase');
    this.current = target;
    if (!target) return;
    target.classList.add('current-phrase');
    target.scrollIntoView({ block: 'center' });
  }

  focus(target: HTMLElement | undefined = this.current): void {
    const el = target ?? this.el;
    if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
    el.focus();
  }

  /** The current document's blocks, numbered exactly as DocumentView numbers them. */
  blocks(): HTMLElement[] {
    const section = this.section();
    if (!section) return [];
    const list: HTMLElement[] = [];
    for (const b of Array.from(section.querySelectorAll<HTMLElement>('[data-block]'))) list[Number(b.dataset.block)] = b;
    return list.filter(Boolean);
  }

  pageMarkers(): HTMLElement[] {
    return Array.from(this.section()?.querySelectorAll<HTMLElement>('.pagebreak') ?? []);
  }

  /** The element with this id in the current document. */
  element(fragment: string): HTMLElement | undefined {
    return this.currentPath ? this.find(this.currentPath, fragment) : undefined;
  }

  /** The document an element of the page belongs to. */
  documentOf(el: Element): string | undefined {
    return el.closest<HTMLElement>('.book-doc')?.dataset.doc;
  }

  private section(): HTMLElement | undefined {
    return this.currentPath ? this.sections.get(this.currentPath.toLowerCase())?.el : undefined;
  }

  private find(path: string, fragment: string | undefined): HTMLElement | undefined {
    const section = this.sections.get(path.toLowerCase())?.el;
    if (!section) return undefined;
    if (!fragment) return section.querySelector<HTMLElement>('[data-block]') ?? section;
    return section.querySelector<HTMLElement>(`[data-id="${CSS.escape(fragment)}"]`) ?? undefined;
  }

  /** A text-only copy of one document's body. */
  private simplify(body: Element, n: number, path: string): DocumentFragment {
    for (const el of Array.from(body.querySelectorAll(REMOVED))) el.remove();
    const blockIndex = new Map(innermostBlocks(body).map((b, i) => [b as Element, i] as const));
    const markers = new Set(Array.from(body.querySelectorAll(PAGE_MARKERS)));

    const copy = (node: Node, into: Node): void => {
      if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
        into.appendChild(document.createTextNode((node as CharacterData).data));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const src = node as Element;
      const tag = src.localName.toLowerCase();
      if (DROPPED.has(tag) || src.hasAttribute('hidden')) return;

      if (markers.has(src)) {
        const label = clean(src.getAttribute('aria-label') ?? src.getAttribute('title')) || `Page ${clean(src.textContent)}`;
        const marker = document.createElement('span');
        marker.className = 'pagebreak';
        marker.setAttribute('role', 'doc-pagebreak');
        marker.textContent = label;
        this.keepId(src, marker, n);
        into.appendChild(marker);
        return;
      }
      if (tag === 'img' || tag === 'image') {
        const alt = clean(src.getAttribute('alt') ?? src.getAttribute('aria-label') ?? src.getAttribute('title'));
        if (alt) {
          const text = document.createElement('span');
          text.className = 'img-alt';
          text.textContent = `[${alt}]`;
          into.appendChild(text);
        }
        return;
      }

      const out: Node = KEPT.has(tag) ? document.createElement(tag) : document.createDocumentFragment();
      if (out instanceof HTMLElement) {
        for (const name of KEPT_ATTRIBUTES) {
          const value = src.getAttribute(name);
          if (value !== null) out.setAttribute(name, value);
        }
        if (tag === 'div' && src.classList.contains('dtb-line')) out.className = 'dtb-line';
        this.keepId(src, out, n);
        const block = blockIndex.get(src);
        if (block !== undefined) out.dataset.block = String(block);
        if (tag === 'a') this.keepLink(src, out as HTMLAnchorElement, path);
      } else if (src.getAttribute('id')) {
        // An unwrapped element's id still has to be reachable (links, narration clips).
        const anchor = document.createElement('span');
        this.keepId(src, anchor, n);
        into.appendChild(anchor);
      }
      for (const child of Array.from(src.childNodes)) copy(child, out);
      into.appendChild(out);
    };

    const fragment = document.createDocumentFragment();
    for (const child of Array.from(body.childNodes)) copy(child, fragment);
    return fragment;
  }

  /** Ids must be unique across the whole book, so each is prefixed; the original stays in data-id. */
  private keepId(src: Element, out: HTMLElement, n: number): void {
    const id = src.getAttribute('id') ?? (src.localName.toLowerCase() === 'a' ? src.getAttribute('name') : null);
    if (!id) return;
    out.id = `d${n}-${id}`;
    out.dataset.id = id;
  }

  private keepLink(src: Element, out: HTMLAnchorElement, path: string): void {
    const href = src.getAttribute('href');
    if (!href) return;
    out.setAttribute('href', '#');
    if (href.startsWith('#')) {
      out.dataset.target = `${path}#${href.slice(1)}`;
    } else if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      const target = resolveHref(path, href);
      out.dataset.target = `${target.path}#${target.fragment ?? ''}`;
    } else {
      // Outside the book: shown as a link, but it goes nowhere from inside the reader.
      out.removeAttribute('href');
    }
  }
}

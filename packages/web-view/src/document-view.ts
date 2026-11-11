import { dtbookToHtml, resolveHref, resolvePath, type TextRef } from '@accessible-reader/engine';
import { prepareMath } from './math.js';

/** Elements read as one unit by the device voice, and stepped through as "phrases" in text mode. */
export const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,th,td,figcaption,caption,blockquote,pre,aside,div.dtb-line';
export const PAGE_MARKERS =
  '[role="doc-pagebreak"],[epub\\:type~="pagebreak"],.page-normal,.page-front,.page-special,.pagenum,.dtb-pagenum';
export const REMOVED = 'script,iframe,object,embed,style,link,meta,base,form,noscript';

/** Parses one text document of the book (XHTML, HTML or DTBook) into an HTML body. Nothing in it loads. */
export function parseBookDocument(text: string, path: string, mediaType: string): { body: Element; lang: string } {
  const parser = new DOMParser();
  const xml = /xml/.test(mediaType) || /\.(xhtml|xml)$/i.test(path);
  let source = parser.parseFromString(text, xml ? 'application/xml' : 'text/html');
  if (xml && source.getElementsByTagName('parsererror').length > 0) source = parser.parseFromString(text, 'text/html');
  const root = source.documentElement;
  const lang = root.getAttribute('xml:lang') ?? root.getAttribute('lang') ?? '';
  if (root.localName.toLowerCase() === 'dtbook') {
    source = parser.parseFromString(`<body>${dtbookToHtml(source)}</body>`, 'text/html');
  }
  return { body: source.getElementsByTagName('body')[0] ?? source.documentElement, lang };
}

/** The innermost readable blocks under `root`, in document order. */
export function innermostBlocks(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(BLOCKS)).filter(
    (b) => !b.querySelector(BLOCKS) && (b.textContent ?? '').trim() !== '',
  );
}

/**
 * Shows one text document of the book inside the reader page itself (not an iframe), so
 * the screen reader treats book text as part of one web page with full browse mode.
 */
export class DocumentView {
  currentPath: string | undefined;
  current: HTMLElement | undefined;
  lang = '';
  /** Settles once the shown document's equations have their words (data-speech; see math.ts). */
  mathReady: Promise<void> = Promise.resolve();

  constructor(
    private readonly el: HTMLElement,
    private readonly url: (path: string) => string,
    onLink: (target: TextRef) => void,
  ) {
    el.addEventListener('click', (event) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-book-href]');
      if (!link || !this.currentPath) return;
      event.preventDefault();
      onLink(resolveHref(this.currentPath, link.dataset.bookHref!));
    });
  }

  async show(path: string, mediaType: string): Promise<void> {
    if (path === this.currentPath) return;
    const text = await (await fetch(this.url(path))).text();
    const { body, lang } = parseBookDocument(text, path, mediaType);
    this.lang = lang;
    this.sanitize(body, path);

    this.el.replaceChildren(...Array.from(body.childNodes, (n) => document.importNode(n, true)));
    this.el.lang = this.lang;
    this.el.scrollTop = 0;
    this.currentPath = path;
    this.current = undefined;
    // The equations' words, for the device voice (math.ts); in the background, the page is already shown.
    this.mathReady = prepareMath(this.el, this.lang).catch(() => undefined);
  }

  clear(): void {
    this.el.replaceChildren();
    this.currentPath = undefined;
    this.current = undefined;
  }

  /** Highlights the element with this id (the phrase being read). */
  highlight(fragment: string | undefined): HTMLElement | undefined {
    const target = fragment ? (this.el.querySelector<HTMLElement>(`#${CSS.escape(fragment)}`) ?? undefined) : undefined;
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

  /** Moves keyboard focus, and so the screen reader's reading cursor, to an element. */
  focus(target: HTMLElement | undefined = this.current): void {
    const el = target ?? this.el;
    if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
    el.focus();
  }

  /** The innermost readable blocks, in document order. */
  blocks(): HTMLElement[] {
    return innermostBlocks(this.el);
  }

  /** The element with this id in the document. */
  element(fragment: string): HTMLElement | undefined {
    return this.el.querySelector<HTMLElement>(`#${CSS.escape(fragment)}`) ?? undefined;
  }

  pageMarkers(): HTMLElement[] {
    return Array.from(this.el.querySelectorAll<HTMLElement>(PAGE_MARKERS));
  }

  private sanitize(root: Element, docPath: string): void {
    // Book-relative resource links must point into the book, not at the reader page.
    const inBook = (value: string) =>
      /^(data|https?):|^#/i.test(value) ? value : this.url(resolvePath(docPath, value.split('#')[0]!));
    const rewrite = (el: Element, name: string) => {
      const value = el.getAttribute(name);
      if (value) el.setAttribute(name, inBook(value.trim()));
    };

    for (const el of Array.from(root.querySelectorAll(REMOVED))) el.remove();
    for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
      for (const a of Array.from(el.attributes)) {
        if (a.name.toLowerCase().startsWith('on')) el.removeAttribute(a.name);
      }
      rewrite(el, 'src');
      rewrite(el, 'poster');
      // SVG images (e.g. EPUB cover pages) use href or xlink:href instead of src.
      if (el.localName === 'image' || el.localName === 'use') {
        rewrite(el, 'href');
        rewrite(el, 'xlink:href');
      }
      const srcset = el.getAttribute('srcset');
      if (srcset) {
        const candidates = srcset.split(',').map((c) => {
          const [url = '', ...size] = c.trim().split(/\s+/);
          return [inBook(url), ...size].join(' ');
        });
        el.setAttribute('srcset', candidates.join(', '));
      }
      if (el.localName === 'a') {
        const href = el.getAttribute('href');
        if (!href || href.startsWith('#')) continue;
        el.setAttribute('href', '#');
        if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) el.setAttribute('data-book-href', href);
      }
    }
  }
}

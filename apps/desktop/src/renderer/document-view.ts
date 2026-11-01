import { dtbookToHtml, resolveHref, resolvePath, type TextRef } from '@accessible-reader/engine';

/** Elements read as one unit by the device voice, and stepped through as "phrases" in text mode. */
const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,th,td,figcaption,caption,blockquote,pre,aside,div.dtb-line';
const PAGE_MARKERS =
  '[role="doc-pagebreak"],[epub\\:type~="pagebreak"],.page-normal,.page-front,.page-special,.pagenum,.dtb-pagenum';
const REMOVED = 'script,iframe,object,embed,style,link,meta,base,form,noscript';

/**
 * Shows one text document of the book inside the reader page itself (not an iframe), so
 * the screen reader treats book text as part of one web page with full browse mode.
 */
export class DocumentView {
  currentPath: string | undefined;
  current: HTMLElement | undefined;
  lang = '';

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
    const parser = new DOMParser();
    const xml = /xml/.test(mediaType) || /\.(xhtml|xml)$/i.test(path);
    let source = parser.parseFromString(text, xml ? 'application/xml' : 'text/html');
    if (xml && source.getElementsByTagName('parsererror').length > 0) source = parser.parseFromString(text, 'text/html');

    const root = source.documentElement;
    this.lang = root.getAttribute('xml:lang') ?? root.getAttribute('lang') ?? '';
    if (root.localName.toLowerCase() === 'dtbook') {
      source = parser.parseFromString(`<body>${dtbookToHtml(source)}</body>`, 'text/html');
    }
    const body = source.getElementsByTagName('body')[0] ?? source.documentElement;
    this.sanitize(body, path);

    this.el.replaceChildren(...Array.from(body.childNodes, (n) => document.importNode(n, true)));
    this.el.lang = this.lang;
    this.el.scrollTop = 0;
    this.currentPath = path;
    this.current = undefined;
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
    return Array.from(this.el.querySelectorAll<HTMLElement>(BLOCKS)).filter(
      (b) => !b.querySelector(BLOCKS) && (b.textContent ?? '').trim() !== '',
    );
  }

  pageMarkers(): HTMLElement[] {
    return Array.from(this.el.querySelectorAll<HTMLElement>(PAGE_MARKERS));
  }

  private sanitize(root: Element, docPath: string): void {
    for (const el of Array.from(root.querySelectorAll(REMOVED))) el.remove();
    for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
      for (const a of Array.from(el.attributes)) {
        if (a.name.toLowerCase().startsWith('on')) el.removeAttribute(a.name);
      }
      const src = el.getAttribute('src');
      if (src && !/^(data|https?):/i.test(src)) el.setAttribute('src', this.url(resolvePath(docPath, src)));
      if (el.localName === 'a') {
        const href = el.getAttribute('href');
        if (!href || href.startsWith('#')) continue;
        el.setAttribute('href', '#');
        if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) el.setAttribute('data-book-href', href);
      }
    }
  }
}

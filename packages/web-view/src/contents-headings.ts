import type { NavItem } from '@accessible-reader/engine';

/**
 * Headings from the table of contents, for books that don't mark their headings as headings.
 *
 * Some books style their headings as ordinary paragraphs (<p class="h1">, <p class="ch-title">),
 * so a screen reader's H key and Reader's own Next heading found none ("No next heading" in Social
 * Background of Indian Nationalism, issue 8). Their table of contents still points at each
 * heading: whatever an entry points to, when it isn't a heading already, becomes one, at the
 * entry's level (role="heading" with aria-level), in every way Reader shows a book.
 */
let byPath = new Map<string, { fragment?: string; level: number }[]>();

/** The open book's table of contents (empty when no book is open). */
export function setBookContents(toc: readonly NavItem[]): void {
  byPath = new Map();
  const walk = (items: readonly NavItem[], depth: number) => {
    for (const item of items) {
      const key = item.target.path.toLowerCase();
      const list = byPath.get(key) ?? [];
      list.push({ fragment: item.target.fragment, level: Math.min(6, Math.max(1, item.level || depth)) });
      byPath.set(key, list);
      walk(item.children ?? [], depth + 1);
    }
  };
  walk(toc, 1);
}

const HEADINGS = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
// As BLOCKS in document-view.ts (not imported, to keep the modules apart).
const BLOCK = 'h1,h2,h3,h4,h5,h6,p,li,dt,dd,th,td,figcaption,caption,blockquote,pre,aside,div.dtb-line';

/** The heading level of an element: an h1–h6 tag, or a heading made from the contents. */
export function headingLevelOf(el: Element): number | undefined {
  const tag = /^h([1-6])$/i.exec(el.localName);
  if (tag) return Number(tag[1]);
  if (el.getAttribute('role') !== 'heading') return undefined;
  const level = Number(el.getAttribute('aria-level'));
  return level >= 1 && level <= 6 ? level : 2;
}

/** Marks what this document's contents entries point to as headings, where the book didn't. */
export function markContentsHeadings(body: Element, path: string): void {
  const entries = byPath.get(path.toLowerCase());
  if (!entries) return;
  for (const { fragment, level } of entries) {
    const target = fragment ? findId(body, fragment) : firstBlock(body);
    const block = target && blockFor(target);
    if (!block || block.matches(HEADINGS) || block.querySelector(HEADINGS) || !(block.textContent ?? '').trim()) continue;
    block.setAttribute('role', 'heading');
    block.setAttribute('aria-level', String(level));
  }
}

function findId(body: Element, id: string): Element | undefined {
  for (const el of Array.from(body.querySelectorAll('[id], a[name]'))) {
    if (el.getAttribute('id') === id || (el.localName === 'a' && el.getAttribute('name') === id)) return el;
  }
  return undefined;
}

/** The first block with text, such as a chapter's title. */
function firstBlock(root: Element): Element | undefined {
  return Array.from(root.querySelectorAll(BLOCK)).find((b) => !b.querySelector(BLOCK) && (b.textContent ?? '').trim());
}

/**
 * The block a contents entry means: the element itself when it is a block; the block around it
 * (an anchor inside a paragraph); or the first block inside it (a section). Not when the entry
 * points into a section that already starts with a real heading.
 */
function blockFor(el: Element): Element | undefined {
  if (el.matches(HEADINGS) || el.closest(HEADINGS)) return undefined;
  if (el.matches(BLOCK) && !el.querySelector(BLOCK)) return el;
  const around = el.parentElement?.closest(BLOCK);
  if (around && !el.querySelector(BLOCK)) return around;
  return firstBlock(el);
}

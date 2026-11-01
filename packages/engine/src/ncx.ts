import type { NavItem, PageKind, PageTarget } from './model.js';
import { resolveHref } from './paths.js';
import { attr, children, first, text } from './xml.js';

/** Parses an NCX navigation file (DAISY 3, and EPUB 2 books without a nav document). */
export function parseNcx(doc: Document, ncxPath: string): { toc: NavItem[]; pageList: PageTarget[] } {
  const navPoints = (parent: Element, level: number): NavItem[] =>
    children(parent, 'navpoint').flatMap((np) => {
      const src = attr(first(np, 'content') ?? np, 'src');
      if (!src) return [];
      return [
        {
          label: text(first(children(np, 'navlabel')[0] ?? np, 'text')),
          target: resolveHref(ncxPath, src),
          level,
          children: navPoints(np, level + 1),
        },
      ];
    });

  const navMap = first(doc, 'navmap');
  const pageListEl = first(doc, 'pagelist');
  const pageList: PageTarget[] = pageListEl
    ? children(pageListEl, 'pagetarget').flatMap((pt) => {
        const src = attr(first(pt, 'content') ?? pt, 'src');
        if (!src) return [];
        const label = text(first(children(pt, 'navlabel')[0] ?? pt, 'text')) || attr(pt, 'value') || '';
        return [{ label, target: resolveHref(ncxPath, src), kind: pageKind(attr(pt, 'type')) }];
      })
    : [];

  return { toc: navMap ? navPoints(navMap, 1) : [], pageList };
}

export function pageKind(value: string | undefined): PageKind {
  const v = value?.toLowerCase() ?? '';
  if (v.includes('front')) return 'front';
  if (v.includes('special')) return 'special';
  return 'normal';
}

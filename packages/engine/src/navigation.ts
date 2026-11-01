import type { NavItem, PageTarget, PublicationData } from './model.js';

/** The TOC as a flat list in reading order. */
export function flattenToc(toc: readonly NavItem[]): NavItem[] {
  return toc.flatMap((item) => [item, ...flattenToc(item.children)]);
}

function headings(pub: PublicationData, level?: number): (NavItem & { clipIndex: number })[] {
  return flattenToc(pub.toc).filter(
    (h): h is NavItem & { clipIndex: number } => h.clipIndex !== undefined && (level === undefined || h.level <= level),
  );
}

/**
 * Next heading after the current clip. With `level`, only headings at that level or above
 * count, like Thorium's "navigate by level" setting.
 */
export function nextHeading(pub: PublicationData, clipIndex: number, level?: number): NavItem | undefined {
  return headings(pub, level).find((h) => h.clipIndex > clipIndex);
}

/** Previous heading before the current clip. */
export function previousHeading(pub: PublicationData, clipIndex: number, level?: number): NavItem | undefined {
  return headings(pub, level)
    .reverse()
    .find((h) => h.clipIndex < clipIndex);
}

/** The heading whose section contains the current clip. */
export function currentHeading(pub: PublicationData, clipIndex: number): NavItem | undefined {
  return headings(pub)
    .reverse()
    .find((h) => h.clipIndex <= clipIndex);
}

export function currentPage(pub: PublicationData, clipIndex: number): PageTarget | undefined {
  return [...pub.pageList].reverse().find((p) => p.clipIndex !== undefined && p.clipIndex <= clipIndex);
}

export function nextPage(pub: PublicationData, clipIndex: number): PageTarget | undefined {
  return pub.pageList.find((p) => p.clipIndex !== undefined && p.clipIndex > clipIndex);
}

export function previousPage(pub: PublicationData, clipIndex: number): PageTarget | undefined {
  return [...pub.pageList].reverse().find((p) => p.clipIndex !== undefined && p.clipIndex < clipIndex);
}

/** "Go to page": matches the printed page label, ignoring case and surrounding spaces. */
export function findPage(pub: PublicationData, label: string): PageTarget | undefined {
  const wanted = label.trim().toLowerCase();
  return pub.pageList.find((p) => p.label.trim().toLowerCase() === wanted);
}

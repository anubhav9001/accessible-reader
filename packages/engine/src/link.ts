import type { NavItem, PublicationData, TextRef } from './model.js';

/**
 * Attaches a narration clip index to every TOC entry and page target, so the reader can
 * jump by heading or page in any mode. DAISY targets point into SMIL (par/seq ids);
 * EPUB targets point into the text, so both lookups are tried.
 */
export function linkNavigation(pub: PublicationData): void {
  const bySmilId = new Map<string, number>();
  const byTextId = new Map<string, number>();
  const byFile = new Map<string, number>();

  for (const clip of pub.narration) {
    if (clip.smil) {
      const smilFile = clip.smil.path.toLowerCase();
      if (!byFile.has(smilFile)) byFile.set(smilFile, clip.index);
      for (const id of clip.smil.ids) {
        const key = `${smilFile}#${id}`;
        if (!bySmilId.has(key)) bySmilId.set(key, clip.index);
      }
    }
    if (clip.text) {
      const textFile = clip.text.path.toLowerCase();
      if (!byFile.has(textFile)) byFile.set(textFile, clip.index);
      if (clip.text.fragment) {
        const key = `${textFile}#${clip.text.fragment}`;
        if (!byTextId.has(key)) byTextId.set(key, clip.index);
      }
    }
  }

  const find = (target: TextRef): number | undefined => {
    const file = target.path.toLowerCase();
    if (target.fragment) {
      const key = `${file}#${target.fragment}`;
      const hit = bySmilId.get(key) ?? byTextId.get(key);
      if (hit !== undefined) return hit;
    }
    return byFile.get(file);
  };

  const visit = (items: NavItem[]) => {
    for (const item of items) {
      item.clipIndex = find(item.target);
      visit(item.children);
    }
  };
  visit(pub.toc);
  for (const page of pub.pageList) page.clipIndex = find(page.target);
}

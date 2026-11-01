import { parseClock } from './clock.js';
import type { Container } from './container.js';
import { linkNavigation } from './link.js';
import type { Metadata, NarrationClip, NavItem, PageTarget, Publication, Resource } from './model.js';
import { pageKind } from './ncx.js';
import { resolveHref } from './paths.js';
import { parseSmil } from './smil.js';
import { attr, descendants, first, localName, parseDocument, text, type XmlPlatform } from './xml.js';

/**
 * Opens a DAISY 2.02 book. The NCC (ncc.html) is both the metadata and the navigation:
 * its headings h1–h6 and page spans link into SMIL files, which in turn reference
 * the audio and, for full-text books, separate HTML content files.
 */
export async function parseDaisy202(container: Container, xml: XmlPlatform): Promise<Publication> {
  const nccPath = findNcc(container);
  if (!nccPath) throw new Error('DAISY 2.02 book has no ncc.html');
  const ncc = xml.parseHtml(await container.readText(nccPath));

  const toc: NavItem[] = [];
  const pageList: PageTarget[] = [];
  const smilOrder: string[] = [];
  const stack: NavItem[] = [];

  for (const el of descendants(first(ncc, 'body') ?? ncc)) {
    const name = localName(el);
    if (name === 'a') {
      const href = attr(el, 'href');
      const path = href && container.resolve(resolveHref(nccPath, href).path);
      if (path && path.toLowerCase().endsWith('.smil') && !smilOrder.includes(path)) smilOrder.push(path);
      continue;
    }

    const heading = /^h([1-6])$/.exec(name);
    const pageClass = name === 'span' ? (attr(el, 'class') ?? '').toLowerCase() : '';
    if (!heading && !pageClass.startsWith('page-')) continue;
    const link = first(el, 'a');
    const href = link && attr(link, 'href');
    if (!href) continue;
    const target = resolveHref(nccPath, href);

    if (heading) {
      const item: NavItem = { label: text(link), target, level: Number(heading[1]), children: [] };
      while (stack.length > 0 && stack[stack.length - 1]!.level >= item.level) stack.pop();
      (stack.length > 0 ? stack[stack.length - 1]!.children : toc).push(item);
      stack.push(item);
    } else {
      pageList.push({ label: text(link), target, kind: pageKind(pageClass) });
    }
  }

  const narration: NarrationClip[] = [];
  for (const smilPath of smilOrder) {
    const smil = parseDocument(xml, await container.readText(smilPath), smilPath);
    narration.push(...parseSmil(smil, smilPath, narration.length));
  }

  // Full-text books point SMIL text at content files; audio-only books point back at the NCC.
  const readingOrder: Resource[] = [];
  for (const clip of narration) {
    const path = clip.text && container.resolve(clip.text.path);
    if (!path || path === nccPath || readingOrder.some((r) => r.path === path)) continue;
    readingOrder.push({ path, mediaType: 'text/html' });
  }

  const publication: Publication = {
    format: 'daisy202',
    metadata: nccMetadata(ncc),
    readingOrder,
    toc,
    pageList,
    narration,
    container,
  };
  linkNavigation(publication);
  return publication;
}

export function findNcc(container: Container): string | undefined {
  return container.paths
    .filter((p) => /(^|\/)ncc\.html?$/i.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
}

function nccMetadata(ncc: Document): Metadata {
  const values = new Map<string, string[]>();
  for (const m of descendants(ncc, 'meta')) {
    const name = attr(m, 'name')?.toLowerCase();
    const content = attr(m, 'content');
    if (!name || !content) continue;
    values.set(name, [...(values.get(name) ?? []), content.trim()]);
  }
  const one = (name: string) => values.get(name)?.[0];
  return {
    title: one('dc:title') ?? text(first(ncc, 'title')),
    authors: values.get('dc:creator') ?? [],
    narrators: values.get('ncc:narrator') ?? [],
    language: one('dc:language'),
    identifier: one('dc:identifier') ?? one('ncc:identifier'),
    publisher: one('dc:publisher'),
    duration: parseClock(one('ncc:totaltime')),
    multimediaType: one('ncc:multimediatype'),
  };
}

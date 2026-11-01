import type { Container } from './container.js';
import { linkNavigation } from './link.js';
import type { NarrationClip, NavItem, PageTarget, Publication } from './model.js';
import { parseNcx, pageKind } from './ncx.js';
import { parsePackage } from './opf.js';
import { resolveHref } from './paths.js';
import { parseSmil } from './smil.js';
import { attr, children, descendants, first, parseDocument, text, tokens, type XmlPlatform } from './xml.js';

/** Opens an EPUB 2 or EPUB 3 publication, including EPUB 3 media overlays (synced narration). */
export async function parseEpub(container: Container, xml: XmlPlatform): Promise<Publication> {
  const containerDoc = xml.parseXml(await container.readText('META-INF/container.xml'));
  const opfPath = attr(first(containerDoc, 'rootfile') ?? containerDoc.documentElement, 'full-path');
  if (!opfPath) throw new Error('EPUB has no package document listed in META-INF/container.xml');

  const pkg = parsePackage(xml.parseXml(await container.readText(opfPath)), opfPath);

  const narration: NarrationClip[] = [];
  for (const item of pkg.spine) {
    const overlay = item.mediaOverlay ? pkg.manifest.get(item.mediaOverlay) : undefined;
    if (!overlay || !container.has(overlay.path)) continue;
    const smil = parseDocument(xml, await container.readText(overlay.path), overlay.path);
    narration.push(...parseSmil(smil, overlay.path, narration.length));
  }

  let toc: NavItem[] = [];
  let pageList: PageTarget[] = [];
  const navItem = [...pkg.manifest.values()].find((i) => i.properties.includes('nav'));
  const ncxItem = pkg.tocId ? pkg.manifest.get(pkg.tocId) : undefined;
  if (navItem && container.has(navItem.path)) {
    ({ toc, pageList } = parseNavDocument(
      parseDocument(xml, await container.readText(navItem.path), navItem.path),
      navItem.path,
    ));
  } else if (ncxItem && container.has(ncxItem.path)) {
    ({ toc, pageList } = parseNcx(xml.parseXml(await container.readText(ncxItem.path)), ncxItem.path));
  }

  const publication: Publication = {
    format: 'epub',
    metadata: pkg.metadata,
    readingOrder: pkg.spine.map((i) => ({ path: i.path, mediaType: i.mediaType })),
    toc,
    pageList,
    narration,
    container,
  };
  linkNavigation(publication);
  return publication;
}

function parseNavDocument(doc: Document, navPath: string): { toc: NavItem[]; pageList: PageTarget[] } {
  const navs = descendants(doc, 'nav');
  const byType = (type: string) => navs.find((n) => tokens(attr(n, 'epub:type')).includes(type));

  const listItems = (ol: Element | undefined, level: number): NavItem[] =>
    ol
      ? children(ol, 'li').flatMap((li) => {
          const link = children(li, 'a')[0] ?? children(li, 'span')[0];
          const href = link && attr(link, 'href');
          const nested = listItems(children(li, 'ol')[0], level + 1);
          if (!href) return nested;
          return [{ label: text(link), target: resolveHref(navPath, href), level, children: nested }];
        })
      : [];

  const tocNav = byType('toc') ?? navs[0];
  const pageNav = byType('page-list');
  const pages = pageNav ? listItems(first(pageNav, 'ol'), 1) : [];
  return {
    toc: tocNav ? listItems(first(tocNav, 'ol'), 1) : [],
    pageList: pages.map((p) => ({ label: p.label, target: p.target, kind: pageKind(undefined) })),
  };
}

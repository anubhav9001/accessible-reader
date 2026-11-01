import type { Container } from './container.js';
import { linkNavigation } from './link.js';
import type { NarrationClip, Publication, Resource } from './model.js';
import { parseNcx } from './ncx.js';
import { parsePackage } from './opf.js';
import { parseSmil } from './smil.js';
import { parseDocument, type XmlPlatform } from './xml.js';

const DTBOOK = 'application/x-dtbook+xml';
const NCX = 'application/x-dtbncx+xml';

/** Opens a DAISY 3 (ANSI/NISO Z39.86) book: OPF + NCX + SMIL, with text in DTBook XML. */
export async function parseDaisy3(container: Container, xml: XmlPlatform): Promise<Publication> {
  const opfPath = findPackage(container);
  if (!opfPath) throw new Error('DAISY 3 book has no .opf package file');
  const pkg = parsePackage(xml.parseXml(await container.readText(opfPath)), opfPath);

  // In DAISY 3 the spine lists SMIL files, not text documents.
  const narration: NarrationClip[] = [];
  for (const item of pkg.spine) {
    if (!container.has(item.path)) continue;
    const smil = parseDocument(xml, await container.readText(item.path), item.path);
    narration.push(...parseSmil(smil, item.path, narration.length));
  }

  // Text documents in the order the narration first reaches them, then any never referenced.
  const items = [...pkg.manifest.values()];
  const textOrder: string[] = [];
  for (const clip of narration) {
    const path = clip.text && container.resolve(clip.text.path);
    if (path && !textOrder.includes(path)) textOrder.push(path);
  }
  const readingOrder: Resource[] = textOrder.map((path) => ({
    path,
    mediaType: items.find((i) => i.path.toLowerCase() === path.toLowerCase())?.mediaType ?? DTBOOK,
  }));
  for (const item of items) {
    if (item.mediaType === DTBOOK && !readingOrder.some((r) => r.path.toLowerCase() === item.path.toLowerCase())) {
      readingOrder.push({ path: item.path, mediaType: item.mediaType });
    }
  }

  const ncxItem = (pkg.tocId ? pkg.manifest.get(pkg.tocId) : undefined) ?? items.find((i) => i.mediaType === NCX);
  const nav =
    ncxItem && container.has(ncxItem.path)
      ? parseNcx(xml.parseXml(await container.readText(ncxItem.path)), ncxItem.path)
      : { toc: [], pageList: [] };

  const publication: Publication = {
    format: 'daisy3',
    metadata: pkg.metadata,
    readingOrder,
    toc: nav.toc,
    pageList: nav.pageList,
    narration,
    container,
  };
  linkNavigation(publication);
  return publication;
}

/** The shallowest .opf file in the container. */
export function findPackage(container: Container): string | undefined {
  return container.paths
    .filter((p) => p.toLowerCase().endsWith('.opf'))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
}

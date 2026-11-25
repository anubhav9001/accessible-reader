import { ZipContainer, type Container } from './container.js';
import { findPackage, parseDaisy3 } from './daisy3.js';
import { findNcc, parseDaisy202 } from './daisy202.js';
import { EBRAILLE_INDEX, EBRAILLE_PACKAGE, parseEpub } from './epub.js';
import type { BookFormat, Publication } from './model.js';
import type { XmlPlatform } from './xml.js';

export function detectFormat(container: Container): BookFormat | undefined {
  if (container.has('META-INF/container.xml')) return 'epub';
  // An unpackaged eBraille file set: no container needed (it opens through parseEpub).
  if (container.has(EBRAILLE_PACKAGE) && container.has(EBRAILLE_INDEX)) return 'ebraille';
  if (findPackage(container)) return 'daisy3';
  if (findNcc(container)) return 'daisy202';
  return undefined;
}

/** Opens any supported book (EPUB 2/3, DAISY 3, DAISY 2.02) into the common publication model. */
/**
 * The one book inside a zip that holds no book itself, if there is one: Sugamya Pustakalaya
 * sends an EPUB inside a .zip of its own. Mac zip leftovers (__MACOSX/, dot files) are ignored.
 */
export function wrappedBookPath(container: Container): string | undefined {
  if (detectFormat(container)) return undefined;
  const inner = container.paths.filter((path) => {
    const lower = path.toLowerCase();
    const name = lower.split('/').pop() ?? '';
    return !lower.startsWith('__macosx/') && !name.startsWith('.') && /\.(epub|ebrl|zip)$/.test(name);
  });
  return inner.length === 1 ? inner[0] : undefined;
}

export async function openPublication(container: Container, xml: XmlPlatform, depth = 0): Promise<Publication> {
  const inner = depth < 2 ? wrappedBookPath(container) : undefined;
  if (inner) return openPublication(ZipContainer.fromBytes(await container.readBytes(inner)), xml, depth + 1);
  switch (detectFormat(container)) {
    case 'epub':
    case 'ebraille':
      return parseEpub(container, xml);
    case 'daisy3':
      return parseDaisy3(container, xml);
    case 'daisy202':
      return parseDaisy202(container, xml);
    default:
      throw new Error('Not a supported book: no EPUB container, DAISY 3 package or DAISY 2.02 NCC found');
  }
}

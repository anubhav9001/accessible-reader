import type { Container } from './container.js';
import { findPackage, parseDaisy3 } from './daisy3.js';
import { findNcc, parseDaisy202 } from './daisy202.js';
import { parseEpub } from './epub.js';
import type { BookFormat, Publication } from './model.js';
import type { XmlPlatform } from './xml.js';

export function detectFormat(container: Container): BookFormat | undefined {
  if (container.has('META-INF/container.xml')) return 'epub';
  if (findPackage(container)) return 'daisy3';
  if (findNcc(container)) return 'daisy202';
  return undefined;
}

/** Opens any supported book (EPUB 2/3, DAISY 3, DAISY 2.02) into the common publication model. */
export async function openPublication(container: Container, xml: XmlPlatform): Promise<Publication> {
  switch (detectFormat(container)) {
    case 'epub':
      return parseEpub(container, xml);
    case 'daisy3':
      return parseDaisy3(container, xml);
    case 'daisy202':
      return parseDaisy202(container, xml);
    default:
      throw new Error('Not a supported book: no EPUB container, DAISY 3 package or DAISY 2.02 NCC found');
  }
}

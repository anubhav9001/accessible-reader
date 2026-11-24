import { parseClock } from './clock.js';
import type { Metadata, MetadataEntry } from './model.js';
import { resolvePath } from './paths.js';
import { attr, children, descendants, first, localName, text, tokens } from './xml.js';

export interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string[];
  mediaOverlay?: string;
}

export interface Package {
  metadata: Metadata;
  manifest: Map<string, ManifestItem>;
  spine: ManifestItem[];
  /** The spine's toc attribute (NCX item id), used by EPUB 2 and DAISY 3. */
  tocId?: string;
}

/** Parses an OPF package document. EPUB 2/3 and DAISY 3 share this structure. */
export function parsePackage(doc: Document, opfPath: string): Package {
  const pkg = doc.documentElement;
  const metaEl = first(doc, 'metadata') ?? pkg;

  // Named <meta> values: DAISY 3 uses name/content, EPUB 3 uses property + text.
  const named = new Map<string, string>();
  const refined = new Set<string>();
  for (const m of descendants(metaEl, 'meta')) {
    const name = attr(m, 'name') ?? attr(m, 'property');
    if (!name) continue;
    if (attr(m, 'refines')) {
      refined.add(name.toLowerCase());
      continue;
    }
    const value = attr(m, 'content') ?? text(m);
    if (!named.has(name.toLowerCase())) named.set(name.toLowerCase(), value);
  }

  const dc = (name: string) => descendants(metaEl, name).map((e) => text(e)).filter(Boolean);
  const uniqueId = attr(pkg, 'unique-identifier');
  const identifier =
    descendants(metaEl, 'identifier').find((e) => uniqueId && attr(e, 'id') === uniqueId) ??
    descendants(metaEl, 'identifier')[0];

  const narrators = [named.get('media:narrator'), named.get('dtb:narrator')].filter((n): n is string => !!n);
  const metadata: Metadata = {
    title: dc('title')[0] ?? '',
    authors: dc('creator'),
    narrators,
    language: dc('language')[0],
    identifier: identifier ? text(identifier) : undefined,
    publisher: dc('publisher')[0],
    duration: parseClock(named.get('media:duration') ?? named.get('dtb:totaltime')),
    multimediaType: named.get('dtb:multimediatype'),
    entries: packageEntries(metaEl),
  };

  const manifest = new Map<string, ManifestItem>();
  for (const item of descendants(first(doc, 'manifest') ?? pkg, 'item')) {
    const id = attr(item, 'id');
    const href = attr(item, 'href');
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      path: resolvePath(opfPath, href),
      mediaType: (attr(item, 'media-type') ?? '').toLowerCase(),
      properties: tokens(attr(item, 'properties')),
      mediaOverlay: attr(item, 'media-overlay'),
    });
  }

  const spineEl = first(doc, 'spine');
  const spine = spineEl
    ? children(spineEl, 'itemref').flatMap((ref) => {
        const item = manifest.get(attr(ref, 'idref') ?? '');
        return item ? [item] : [];
      })
    : [];

  return { metadata, manifest, spine, tocId: spineEl ? attr(spineEl, 'toc') : undefined };
}

/**
 * Every entry of the package metadata, as the book gives it: Dublin Core elements
 * (dc:title, dc:subject…) and named <meta> values (EPUB 3 property, DAISY 3 and EPUB 2 name).
 * A refinement (EPUB 3 refines="#id") is listed under the entry it refines, by name.
 */
function packageEntries(metaEl: Element): MetadataEntry[] {
  const entries: MetadataEntry[] = [];
  const byId = new Map<string, string>();
  for (const el of descendants(metaEl)) {
    if (el === metaEl) continue;
    const local = localName(el);
    let name: string | undefined;
    let value: string;
    if (local === 'meta') {
      name = attr(el, 'property') ?? attr(el, 'name');
      value = (attr(el, 'content') ?? text(el)).trim();
      const refines = attr(el, 'refines');
      const of = refines ? byId.get(refines.replace(/^#/, '')) : undefined;
      if (name && refines) name = of ? `${of} (${name})` : name;
    } else if (local === 'link' || local === 'dc-metadata' || local === 'x-metadata') {
      continue;
    } else {
      name = `dc:${local}`;
      value = text(el).trim();
      const id = attr(el, 'id');
      if (id) byId.set(id, name);
    }
    if (name && value) entries.push({ name, value });
  }
  return entries;
}

import { attr, children, descendants, first, text, type XmlPlatform } from './xml.js';

/**
 * OPDS 1.x catalogue feeds (Atom), as published by Project Gutenberg and many libraries.
 * The parser only reads; fetching is left to the host so desktop and mobile can each
 * use their own network stack.
 */

const ACQUISITION = 'http://opds-spec.org/acquisition';
const OPDS_FEED = /application\/atom\+xml/i;

/** An online catalogue the reader knows about. */
export interface Catalog {
  id: string;
  name: string;
  /** The catalogue's start feed. */
  url: string;
  /** Search URL with a {searchTerms} placeholder, when known without fetching the OpenSearch description. */
  searchTemplate?: string;
}

export const BUILT_IN_CATALOGS: Catalog[] = [
  {
    id: 'gutenberg',
    name: 'Project Gutenberg',
    url: 'https://www.gutenberg.org/ebooks.opds/',
    searchTemplate: 'https://www.gutenberg.org/ebooks/search.opds/?query={searchTerms}',
  },
];

export interface OpdsLink {
  /** Absolute URL. */
  href: string;
  rel?: string;
  type?: string;
  title?: string;
  /** Size in bytes, when the catalogue says. */
  length?: number;
}

export interface OpdsEntry {
  id: string;
  title: string;
  authors: string[];
  summary?: string;
  language?: string;
  /** Download links for the book itself. */
  acquisitions: OpdsLink[];
  /** A further feed to browse (a category, an author, or one book's own feed). */
  navigation?: OpdsLink;
}

export interface OpdsFeed {
  title: string;
  entries: OpdsEntry[];
  /** Next page of results. */
  next?: string;
  /** OpenSearch description document, to look up the search URL. */
  searchDescription?: string;
}

/** Plain HTTP is upgraded: phones refuse it, and catalogue traffic should not travel in the clear. */
export function secureUrl(url: string): string {
  const u = new URL(url);
  if (u.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) u.protocol = 'https:';
  return u.toString();
}

function link(el: Element, base: string): OpdsLink | undefined {
  const href = attr(el, 'href');
  if (!href || href.startsWith('data:')) return undefined;
  const length = Number(attr(el, 'length'));
  return {
    href: secureUrl(new URL(href, base).toString()),
    rel: attr(el, 'rel'),
    type: attr(el, 'type'),
    title: attr(el, 'title'),
    length: Number.isFinite(length) && length > 0 ? length : undefined,
  };
}

export function parseOpdsFeed(doc: Document, feedUrl: string): OpdsFeed {
  const feed = doc.documentElement;
  const feedLinks = children(feed, 'link').flatMap((l) => link(l, feedUrl) ?? []);

  const entries = children(feed, 'entry').map((entry): OpdsEntry => {
    const links = children(entry, 'link').flatMap((l) => link(l, feedUrl) ?? []);
    const content = children(entry, 'summary')[0] ?? children(entry, 'content')[0];
    return {
      id: text(children(entry, 'id')[0]) || links[0]?.href || text(children(entry, 'title')[0]),
      title: text(children(entry, 'title')[0]),
      authors: children(entry, 'author').map((a) => text(first(a, 'name'))).filter(Boolean),
      summary: content ? text(content) || undefined : undefined,
      language: text(first(entry, 'language')) || undefined,
      acquisitions: links.filter((l) => l.rel?.startsWith(ACQUISITION)),
      navigation: links.find((l) => OPDS_FEED.test(l.type ?? '') && l.rel !== 'self' && l.rel !== 'alternate'),
    };
  });

  return {
    title: text(children(feed, 'title')[0]),
    entries,
    next: feedLinks.find((l) => l.rel === 'next')?.href,
    searchDescription: feedLinks.find((l) => l.rel === 'search' && /opensearchdescription/i.test(l.type ?? ''))?.href,
  };
}

/** The Atom search template from an OpenSearch description document. */
export function parseOpenSearchTemplate(doc: Document): string | undefined {
  const urls = descendants(doc, 'url');
  const atom = urls.find((u) => OPDS_FEED.test(attr(u, 'type') ?? '')) ?? urls[0];
  const template = atom && attr(atom, 'template');
  return template ? secureUrl(template.replace('{searchTerms}', '__TERMS__')).replace('__TERMS__', '{searchTerms}') : undefined;
}

/** Fills a search template; optional parameters such as {startPage?} are dropped. */
export function searchUrl(template: string, terms: string): string {
  return template.replace('{searchTerms}', encodeURIComponent(terms.trim())).replace(/\{[^}]+\?\}/g, '');
}

/**
 * The download to offer for an entry: an EPUB, preferring EPUB 3 with images (which keeps
 * image descriptions), or a zipped DAISY book.
 */
export function bestAcquisition(entry: OpdsEntry): OpdsLink | undefined {
  return [...entry.acquisitions].filter((l) => acquisitionScore(l) > 0).sort((a, b) => acquisitionScore(b) - acquisitionScore(a))[0];
}

/**
 * The best download in a whole feed. A book's own feed may list several editions as
 * separate entries (Gutenberg lists "no images" and "with images" apart).
 */
export function bestDownload(feed: OpdsFeed): { entry: OpdsEntry; link: OpdsLink } | undefined {
  let best: { entry: OpdsEntry; link: OpdsLink } | undefined;
  for (const entry of feed.entries) {
    const link = bestAcquisition(entry);
    if (link && (!best || acquisitionScore(link) > acquisitionScore(best.link))) best = { entry, link };
  }
  return best;
}

/** 0 for formats the reader cannot open; higher is better. */
function acquisitionScore(l: OpdsLink): number {
  const label = `${l.title ?? ''} ${l.href}`.toLowerCase();
  if (/epub\+zip/i.test(l.type ?? '')) return 10 + (/epub3/.test(label) ? 2 : 0) + (/noimages|no images/.test(label) ? 0 : 1);
  return /zip|daisy/i.test(l.type ?? '') ? 5 : 0;
}

/** Parses feed text with the host's XML parser. */
export function readOpdsFeed(xml: XmlPlatform, body: string, feedUrl: string): OpdsFeed {
  return parseOpdsFeed(xml.parseXml(body), feedUrl);
}

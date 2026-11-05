import { children, descendants, type XmlPlatform } from './xml.js';

/**
 * Sugamya Pustakalaya, India's accessible online library (DAISY Forum of India), through
 * its NALP API (Access Infinity 2.1). Search and browse need only the app's API key; the
 * apps add it to each request themselves, so it never passes through this module.
 */

export const SUGAMYA_API = 'https://sugamyapustakalaya.org.in/rest/NALPAPIService/getNALPData';
export const SUGAMYA_SITE = 'https://sugamyapustakalaya.org.in';
export const SUGAMYA_PAGE_SIZE = 20;

/** One book in a search or browse result. Search results leave out format and language. */
export interface SugamyaBook {
  id: string;
  title: string;
  author: string;
  publisher: string;
  synopsis: string;
  /** e.g. "DAISY Audio Only", "daisy3", "EPUB Text Only"; empty when not given. */
  format: string;
  /** e.g. "27MB"; empty when not given or "NA". */
  size: string;
  language: string;
  isbn: string;
  freelyAvailable: boolean;
}

export interface SugamyaPage<T> {
  items: T[];
  total: number;
  page: number;
  /** A message from the library instead of results, e.g. "No data existing". */
  message?: string;
}

/** What the library can be asked for. Each path still needs `?API_key=` added by the app. */
export type SugamyaQuery =
  | { kind: 'search'; terms: string }
  | { kind: 'latest' }
  | { kind: 'categories' }
  | { kind: 'category'; name: string }
  | { kind: 'grades' }
  | { kind: 'grade'; name: string }
  | { kind: 'book'; id: string };

/** The request path (after getNALPData/) for a query and page. */
export function sugamyaPath(query: SugamyaQuery, page = 1, limit = SUGAMYA_PAGE_SIZE): string {
  const tail = `page/${page}/limit/${limit}/format/xml`;
  const part = (s: string) => encodeURIComponent(s.trim());
  switch (query.kind) {
    case 'search':
      return `authortitle/${part(query.terms)}/${tail}`;
    case 'latest':
      return `latest/${tail}`;
    case 'categories':
      return `categorylist/${tail}`;
    case 'category':
      return `category/${part(query.name)}/${tail}`;
    case 'grades':
      return `gradelist/${tail}`;
    case 'grade':
      return `grade/${part(query.name)}/${tail}`;
    case 'book':
      return `id/${part(query.id)}/page/1/limit/1/format/xml`;
  }
}

/** Only these characters may reach the library in a path, so a path can't be redirected elsewhere. */
export function isSugamyaPath(path: string): boolean {
  return /^(authortitle|latest|categorylist|category|gradelist|grade|id)\/[A-Za-z0-9%._~\-/]*format\/xml$/.test(path);
}

const text = (el: Element | undefined, name: string): string => {
  const child = el && children(el, name)[0];
  const value = (child?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // The library writes a missing value as NA or N/A.
  return /^N\/?A$/i.test(value) ? '' : value;
};

function parse(doc: Document): { results: Element[]; total: number; page: number; message?: string } {
  const root = doc.documentElement;
  const message = text(children(root, 'message')[0], 'string') || undefined;
  const results = descendants(root, 'result');
  const total = Number(text(root, 'total-results')) || results.length;
  const page = Number(text(root, 'requested-page')) || 1;
  return { results, total, page, message: results.length ? undefined : message };
}

/** Reads a page of books. */
export function parseSugamyaBooks(xml: XmlPlatform, body: string): SugamyaPage<SugamyaBook> {
  const { results, total, page, message } = parse(xml.parseXml(body));
  const items = results.map((r) => ({
    id: text(r, 'id'),
    title: text(r, 'title') || 'Untitled',
    author: text(r, 'author'),
    publisher: text(r, 'publisher'),
    synopsis: text(r, 'brief-synopsis'),
    format: text(r, 'download-format'),
    size: /^0\s*\w*$/.test(text(r, 'dtbook-size')) ? '' : text(r, 'dtbook-size'),
    language: text(r, 'language'),
    isbn: text(r, 'isbn13'),
    freelyAvailable: text(r, 'freely-available') === 'true',
  }));
  return { items: items.filter((b) => b.id), total, page, message };
}

/** Reads a page of names (categories or grades). */
export function parseSugamyaNames(xml: XmlPlatform, body: string): SugamyaPage<string> {
  const { results, total, page, message } = parse(xml.parseXml(body));
  return { items: results.map((r) => text(r, 'title')).filter(Boolean), total, page, message };
}

/** Whether Reader can open a Sugamya download format (DAISY and EPUB, not braille or Word). */
export function sugamyaFormatReadable(format: string): boolean {
  return /daisy|epub/i.test(format) && !/braille/i.test(format);
}

/** A format name as a reader would say it, e.g. "daisy3" → "DAISY 3". */
export function sugamyaFormatLabel(format: string): string {
  const known: Record<string, string> = { daisy3: 'DAISY 3', daisy202: 'DAISY 2.02', zedai: 'ZedAI', wordml: 'Word' };
  return known[format.toLowerCase()] ?? format;
}

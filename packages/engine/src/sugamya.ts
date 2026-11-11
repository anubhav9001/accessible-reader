import { children, descendants, type XmlPlatform } from './xml.js';

/**
 * Sugamya Pustakalaya, India's accessible online library (DAISY Forum of India), through
 * its NALP API (Access Infinity 2.1). Search and browse need only the app's API key; the
 * apps add it to each request themselves, so it never passes through this module.
 */

export const SUGAMYA_API = 'https://sugamyapustakalaya.org.in/rest/NALPAPIService/getNALPData';
export const SUGAMYA_SITE = 'https://sugamyapustakalaya.org.in';
export const SUGAMYA_PAGE_SIZE = 20;
/** Shown for a detail the library marks as not available (NA or N/A). */
export const SUGAMYA_NOT_AVAILABLE = 'Not available';

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
  | { kind: 'popular'; from: string; to: string }
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
    case 'popular':
      return `popularbooks/noOfTimesDelivered/${SUGAMYA_POPULAR_TIMES}/startDate/${part(query.from)}/endDate/${part(query.to)}/${tail}`;
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
  return /^(authortitle|latest|popularbooks|categorylist|category|gradelist|grade|id)\/[A-Za-z0-9%._~\-/]*format\/xml$/.test(path);
}

const text = (el: Element | undefined, name: string): string => {
  const child = el && children(el, name)[0];
  return (child?.textContent ?? '').replace(/\s+/g, ' ').trim();
};

/** A book detail: empty when not given, "Not available" when the library says NA or N/A. */
const detail = (el: Element, name: string): string => {
  const value = text(el, name);
  return /^N\/?A$/i.test(value) ? SUGAMYA_NOT_AVAILABLE : value;
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
    author: detail(r, 'author'),
    publisher: detail(r, 'publisher'),
    synopsis: detail(r, 'brief-synopsis'),
    format: detail(r, 'download-format'),
    // A size of 0 means the library doesn't know it.
    size: /^0\s*\w*$/.test(text(r, 'dtbook-size')) ? SUGAMYA_NOT_AVAILABLE : detail(r, 'dtbook-size'),
    language: detail(r, 'language'),
    isbn: detail(r, 'isbn13'),
    freelyAvailable: text(r, 'freely-available') === 'true',
  }));
  return { items: items.filter((b) => b.id), total, page, message };
}

/** Reads a page of names (categories or grades). */
export function parseSugamyaNames(xml: XmlPlatform, body: string): SugamyaPage<string> {
  const { results, total, page, message } = parse(xml.parseXml(body));
  return { items: results.map((r) => text(r, 'title')).filter(Boolean), total, page, message };
}

/** "Author. Language. Format" for a list entry, saying which of them are not available. */
export function sugamyaBookSummary(book: SugamyaBook): string {
  const na = SUGAMYA_NOT_AVAILABLE;
  return [
    book.author === na ? 'Author not available' : book.author,
    book.language === na ? 'Language not available' : book.language,
    book.format === na ? 'Format not available' : book.format && sugamyaFormatLabel(book.format),
  ]
    .map((part) => part.replace(/\.+$/, ''))
    .filter(Boolean)
    .join('. ');
}

/** The author line of a book's details. */
export function sugamyaByLine(book: SugamyaBook): string {
  return book.author === SUGAMYA_NOT_AVAILABLE ? `Author: ${SUGAMYA_NOT_AVAILABLE}` : `By ${book.author}`;
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

// ---- Popular books ----

/** A book counts as popular when it was delivered at least this many times in the past year. */
export const SUGAMYA_POPULAR_TIMES = 50;

/** Popular books: delivered at least SUGAMYA_POPULAR_TIMES times in the year up to `now`. */
export function sugamyaPopularQuery(now = new Date()): SugamyaQuery {
  const day = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD, as TCS confirmed (not the guide's YYYY-DD-MM)
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - 1);
  return { kind: 'popular', from: day(from), to: day(now) };
}

// ---- The reader's account: download requests ----

/** The account services (POST only, with the reader's user ID or email and password). */
export const SUGAMYA_ACCOUNT_API = 'https://sugamyapustakalaya.org.in/rest/NALPAPIService';
/** Links for the sign-in screen; the library has no API for these. */
export const SUGAMYA_FORGOT_PASSWORD = SUGAMYA_SITE;
export const SUGAMYA_JOIN = SUGAMYA_SITE;

export type SugamyaAccountCall = 'getUserInfo' | 'raiseBookDownloadRequest' | 'fetchUserDownloadRequests';

/** Format IDs from the API guide's table, for raiseBookDownloadRequest. Keys are lower case. */
const FORMAT_IDS: Record<string, number> = {
  braille: 1,
  brailledtbook: 2,
  daisy202: 4,
  daisy3: 5,
  'daisy audio only': 6,
  'daisy text only': 7,
  html: 9,
  latex: 10,
  odt: 11,
  rtf: 12,
  text: 13,
  word: 14,
  wordml: 15,
  xhtml: 16,
  zedai: 17,
  'formatted braille': 18,
  'hard braille': 19,
  'daisy multimedia': 20,
  'epub audio': 21,
  'epub text only': 22,
  'epub with media overlay': 23,
  'structured epub without proofreading': 24,
  'braille with tactile': 25,
};

/** The format ID the library wants for a download request, from a result's download-format. */
export function sugamyaFormatId(format: string): number | undefined {
  return FORMAT_IDS[format.trim().replace(/\s+/g, ' ').toLowerCase()];
}

/** The Authorization header for the reader's user ID (or email) and password. */
export function sugamyaAuthorization(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user.trim()}:${password}`);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `Basic ${btoa(binary)}`;
}

/** The form fields of an account request (the key is added by the app). */
export function sugamyaAccountFields(
  call: SugamyaAccountCall,
  args: { bookId?: string; formatId?: number; page?: number; limit?: number } = {},
): Record<string, string> {
  if (call === 'raiseBookDownloadRequest') return { bookId: String(args.bookId ?? ''), formatId: String(args.formatId ?? '') };
  if (call === 'fetchUserDownloadRequests') return { page: String(args.page ?? 1), limit: String(args.limit ?? 50) };
  return {};
}

/** Whether a download link is the library's own, over HTTPS, so the reader's password may go with it. */
export function isSugamyaDownloadUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'sugamyapustakalaya.org.in';
  } catch {
    return false;
  }
}

/** The library's own message in a reply (e.g. "Your download request has been registered…"). */
export function parseSugamyaMessage(xml: XmlPlatform, body: string): string | undefined {
  if (!/^\s*(<\?xml[^>]*>\s*)?<nalp[\s>]/.test(body)) return undefined;
  return text(children(xml.parseXml(body).documentElement, 'message')[0], 'string') || undefined;
}

export interface SugamyaUser {
  name: string;
  email: string;
}

/** The reader's details from getUserInfo; undefined when the reply has none (not signed in). */
export function parseSugamyaUser(xml: XmlPlatform, body: string): SugamyaUser | undefined {
  if (!/<nalp[\s>]/.test(body)) return undefined;
  const result = descendants(xml.parseXml(body).documentElement, 'result')[0];
  if (!result) return undefined;
  return { name: text(result, 'name'), email: text(result, 'email') };
}

/** One of the reader's download requests. */
export interface SugamyaRequest {
  title: string;
  format: string;
  /** The library's status text, e.g. "Available for Download". */
  status: string;
  /** Whether the book can be downloaded now. */
  ready: boolean;
  /** The download link (needs the reader's sign-in, valid for 7 days); empty until ready. */
  url: string;
}

/** Reads fetchUserDownloadRequests. */
export function parseSugamyaRequests(xml: XmlPlatform, body: string): SugamyaPage<SugamyaRequest> {
  const { results, total, page, message } = parse(xml.parseXml(body));
  const items = results.map((r) => {
    const status = text(r, 'available-to-download');
    const url = text(r, 'downloadurl'); // <downloadUrl>; names are matched in lower case
    return {
      title: text(r, 'title') || 'Untitled',
      format: detail(r, 'download-format'),
      status,
      // The app checks the link is the library's own before sending the password with it.
      ready: /^available/i.test(status) && /^https?:\/\//i.test(url),
      url: /^https?:\/\//i.test(url) ? url : '',
    };
  });
  return { items, total, page, message };
}

/** Whether the library took a download request ("Your download request has been registered successfully…"). */
export function isSugamyaRequestAccepted(message: string): boolean {
  return /registered successfully/i.test(message);
}

/** What Reader adds when the library won't take a request for a copy (its own reply comes first). */
export const SUGAMYA_REQUEST_REFUSED =
  "Reader can't get this copy from Sugamya Pustakalaya yet. You can download it on the Sugamya Pustakalaya website, then open it in Reader.";

/** What Reader says when the library doesn't accept the user ID or password. */
export const SUGAMYA_WRONG_PASSWORD =
  "Sugamya Pustakalaya didn't accept this user ID or password. Check them, or reset your password on the Sugamya Pustakalaya website.";

/** Whether the library's message means the user ID or password was wrong ("Security Autentication Failed"). */
export function isSugamyaAuthFailure(message: string | undefined): boolean {
  return !!message && /auth?enti?cation failed/i.test(message);
}

/**
 * What to tell the reader when an account call doesn't give the library's XML reply. A wrong
 * password comes back as XML ("Security Autentication Failed"); the HTML error page (HTTP 404)
 * comes when the library can't handle the request itself, e.g. a user ID it doesn't know at
 * sign-in, or a request it can't match to a book.
 */
export function sugamyaAccountProblem(call: SugamyaAccountCall, status: number): string {
  if (status === 401 || status === 403) return SUGAMYA_WRONG_PASSWORD;
  if (call === 'getUserInfo') return status === 404 ? "Sugamya Pustakalaya didn't recognise this user ID or email. Check it and try again." : `Sugamya Pustakalaya couldn't sign you in right now (error ${status}). Try again later.`;
  if (call === 'raiseBookDownloadRequest') return `Sugamya Pustakalaya couldn't take the request for this book (error ${status}). Try again later, or ask for it on the Sugamya Pustakalaya website.`;
  return `Sugamya Pustakalaya couldn't do this right now (error ${status}). Try again later.`;
}

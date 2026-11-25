import type { Metadata, NavItem } from '@accessible-reader/engine';
import { assetsBase } from './math.js';

/**
 * eBraille as print text: liblouis (vendor/liblouis, WebAssembly) translates the book's braille
 * cells back to print, so the book reads like any other: on screen, aloud and with a screen
 * reader's speech. Once set up (prepareBrailleToPrint), parseBookDocument translates every
 * document as it is read in, in every way Reader shows a book.
 */

interface Louis {
  cwrap(name: string, ret: string, args: string[]): (...args: unknown[]) => number;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
}

declare global {
  interface Window {
    createLouis?: () => Promise<Louis>;
  }
}

let louis: Promise<Louis | undefined> | undefined;
function loadLouis(): Promise<Louis | undefined> {
  louis ??= new Promise<Louis | undefined>((resolve) => {
    const done = () => (window.createLouis ? window.createLouis().then(resolve, () => resolve(undefined)) : resolve(undefined));
    if (window.createLouis) return done();
    const script = document.createElement('script');
    script.src = `${assetsBase()}liblouis.js`;
    script.onload = done;
    script.onerror = () => resolve(undefined);
    document.head.append(script);
  });
  return louis;
}

/** Bharati braille tables, by language. */
const BHARATI: Record<string, string> = {
  hi: 'hi-in-g1.utb',
  mr: 'mr-in-g1.utb',
  ne: 'np-in-g1.utb',
  sa: 'sa-in-g1.utb',
  gu: 'gu-in-g1.utb',
  bn: 'be-in-g1.utb',
  pa: 'pu-in-g1.utb',
  or: 'or-in-g1.utb',
  te: 'te-in-g1.utb',
  kn: 'ka-in-g1.utb',
  ml: 'ml-in-g1.utb',
  ta: 'ta-ta-g1.ctb',
  as: 'as-in-g1.utb',
  ks: 'ks-in-g1.utb',
};

/**
 * The liblouis table for a book's braille: from its language (dc:language, such as en-Brai-US or
 * hi-Brai) and braille system (a11y:brailleSystem). English is UEB unless the book says American
 * (EBAE); the grade 2 tables read uncontracted braille too.
 */
export function brailleTable(metadata: Metadata): string {
  const lang = (metadata.language ?? 'en').toLowerCase().split('-')[0] ?? 'en';
  const systems = (metadata.entries ?? []).filter((e) => /^a11y:brailleSystem$/i.test(e.name)).map((e) => e.value).join(' ');
  if (BHARATI[lang]) return `unicode.dis,${BHARATI[lang]}`;
  if (/ebae|english braille,? american|\bbana\b/i.test(systems) && !/ueb|unified/i.test(systems)) return 'unicode.dis,en-us-g2.ctb';
  return 'unicode.dis,en-ueb-g2.ctb';
}

let translate: ((braille: string) => string) | undefined;

/** Whether a text has braille cells in it (U+2800 to U+28FF). */
const BRAILLE = /[⠀-⣿]/;

/**
 * Sets up translation to print for a book. False when liblouis couldn't be loaded; the book then
 * shows as braille.
 */
export async function prepareBrailleToPrint(metadata: Metadata): Promise<boolean> {
  const L = await loadLouis();
  if (!L) return false;
  const table = brailleTable(metadata);
  const back = L.cwrap('lou_backTranslateString', 'number', ['string', 'number', 'number', 'number', 'number', 'number', 'number', 'number']);
  translate = (braille: string) => {
    const n = braille.length;
    const room = n * 4 + 16;
    const inPtr = L._malloc(n * 2 + 2);
    const outPtr = L._malloc(room * 2);
    const lens = L._malloc(8);
    try {
      for (let i = 0; i < n; i++) L.HEAPU16[(inPtr >> 1) + i] = braille.charCodeAt(i);
      L.HEAP32[lens >> 2] = n;
      L.HEAP32[(lens >> 2) + 1] = room;
      if (!back(table, inPtr, lens, outPtr, lens + 4, 0, 0, 0)) return braille;
      const length = L.HEAP32[(lens >> 2) + 1]!;
      let out = '';
      for (let i = 0; i < length; i += 4096) out += String.fromCharCode(...L.HEAPU16.subarray((outPtr >> 1) + i, (outPtr >> 1) + Math.min(length, i + 4096)));
      return out;
    } finally {
      L._free(inPtr);
      L._free(outPtr);
      L._free(lens);
    }
  };
  return true;
}

/** Back to showing braille as it is (another book, or the reader chose to see the braille). */
export function clearBrailleToPrint(): void {
  translate = undefined;
}

/** Whether eBraille is being shown as print text now. */
export function showingBrailleAsPrint(): boolean {
  return !!translate;
}

/** A piece of text in print: its braille cells translated, the spaces around it kept. */
export function brailleToPrint(text: string): string {
  if (!translate || !BRAILLE.test(text)) return text;
  const [, before = '', middle = '', after = ''] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
  return before + translate(middle) + after;
}

/** Translates a parsed document's text and its picture descriptions (parseBookDocument). */
export function translateBrailleDocument(body: Element): void {
  if (!translate) return;
  const walker = body.ownerDocument.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const t of texts) if (BRAILLE.test(t.data)) t.data = brailleToPrint(t.data);
  for (const el of Array.from(body.querySelectorAll('[alt], [title], [aria-label]'))) {
    for (const name of ['alt', 'title', 'aria-label']) {
      const v = el.getAttribute(name);
      if (v && BRAILLE.test(v)) el.setAttribute(name, brailleToPrint(v));
    }
  }
}

/** The contents' labels in print, for the contents list. */
export function translateNavLabels(items: NavItem[]): NavItem[] {
  return items.map((item) => ({ ...item, label: brailleToPrint(item.label), children: translateNavLabels(item.children ?? []) }));
}

/** A braille document's language for the voice: "en-Brai-US" is read as "en-US". */
export function printLanguage(lang: string): string {
  return lang.replace(/-Brai(?=-|$)/i, '');
}

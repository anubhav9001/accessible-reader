/**
 * Maths (MathML) in plain words, for screen reader mode, the text-only page and the device
 * voice: "x equals the fraction with numerator negative b plus or minus …". The words come from
 * Speech Rule Engine (the engine MathJax uses), loaded from the app's own files: its script
 * (sre.js) and one rule file per language in mathmaps/. Nothing is fetched from the internet.
 */

export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

/** The part of Speech Rule Engine Reader uses (the global its script defines). */
interface Sre {
  setupEngine(options: Record<string, unknown>): Promise<void>;
  engineReady(): Promise<void>;
  toSpeech(mathml: string): string;
}

declare global {
  interface Window {
    SRE?: Sre;
    /** The engine's settings, read when its script starts. */
    SREfeature?: Record<string, unknown>;
  }
}

/** How long Reader waits for the engine before falling back to the book's own description (ms). */
const ENGINE_WAIT = 8000;

/** Where sre.js and mathmaps/ are, relative to the page ('' = beside it). */
let assets = '';
/** Languages with rule files in the app; others are read with English rules. */
const LOCALES = ['en', 'hi'];

export function configureMath(base: string): void {
  assets = base && !base.endsWith('/') ? `${base}/` : base;
}

let engine: Promise<Sre | undefined> | undefined;
function loadEngine(): Promise<Sre | undefined> {
  engine ??= new Promise((resolve) => {
    if (window.SRE) return resolve(window.SRE);
    // Before the script runs: otherwise it fetches its rule files from a CDN on the internet
    // (the page's security policy blocks that, and the engine then never gets ready). Only the
    // location: the engine applies these again on every setupEngine(), so a language set here
    // would override every later change of language.
    window.SREfeature = { json: `${assets}mathmaps` };
    const script = document.createElement('script');
    script.src = `${assets}sre.js`;
    script.onload = () => resolve(window.SRE);
    script.onerror = () => resolve(undefined);
    document.head.append(script);
  });
  return engine;
}

let locale = '';
/** One request at a time: switching the engine's language is not safe to interleave. */
let queue: Promise<unknown> = Promise.resolve();

/** The locale Reader uses for a language tag ("hi-IN" → "hi"; unknown → "en"). */
export function mathLocale(lang: string): string {
  const base = lang.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return LOCALES.includes(base) ? base : 'en';
}

/** The language that applies to an element: its own lang, its parents', or the document's. */
export function langOf(el: Element, fallback = ''): string {
  const owner = el.closest('[lang], [xml\\:lang]');
  return owner?.getAttribute('lang') || owner?.getAttribute('xml:lang') || fallback;
}

/** The book's own description of an equation, if it gives one. */
export function mathDescription(el: Element): string {
  return clean(el.getAttribute('alttext') ?? el.getAttribute('aria-label') ?? '');
}

/**
 * Maths as plain words. Uses the speech engine when it can be loaded, else the book's own
 * description, else the symbols with spaces between them.
 */
export function mathSpeech(el: Element, lang: string): Promise<string> {
  const fallback = () => mathDescription(el) || mathSymbols(el);
  const work = queue.then(async () => {
    const sre = await loadEngine();
    if (!sre) return mathDescription(el) || mathSymbols(el);
    const want = mathLocale(lang);
    try {
      if (want !== locale) {
        await sre.setupEngine({ locale: want, domain: 'clearspeak', modality: 'speech', style: 'default', json: `${assets}mathmaps` });
        await sre.engineReady();
        locale = want;
      }
      return clean(sre.toSpeech(mathMarkup(el))) || mathDescription(el) || mathSymbols(el);
    } catch {
      return mathDescription(el) || mathSymbols(el);
    }
  });
  // Never let a stuck engine hold up the book: after ENGINE_WAIT, the fallback.
  const job = Promise.race([work, new Promise<string>((resolve) => setTimeout(() => resolve(fallback()), ENGINE_WAIT))]);
  queue = work.catch(() => undefined);
  return job;
}

/** Works out the words for every equation under `root` once, as data-speech, before it is read. */
export async function prepareMath(root: Element, docLang: string): Promise<void> {
  for (const el of mathElements(root)) {
    if (!el.hasAttribute('data-speech')) el.setAttribute('data-speech', await mathSpeech(el, langOf(el, docLang)));
  }
}

export function mathElements(root: Element): Element[] {
  return Array.from(root.getElementsByTagNameNS(MATHML_NS, 'math')).concat(
    // Parsed as HTML (an .html book), maths is still MathML; as plain XML without the namespace it isn't.
    Array.from(root.getElementsByTagName('math')).filter((m) => m.namespaceURI !== MATHML_NS),
  );
}

/** Whether an equation stands on its own line (display="block", or alone in its paragraph). */
export function isDisplayMath(el: Element): boolean {
  if ((el.getAttribute('display') ?? '').toLowerCase() === 'block') return true;
  const parent = el.parentElement;
  if (!parent) return false;
  return Array.from(parent.childNodes).every((n) => n === el || (n.nodeType === 3 && !n.textContent?.trim()));
}

/** The text of a block, with each equation as its words (data-speech), for the device voice. */
export function speakableText(block: Element): string {
  if (!block.querySelector('math, [data-speech]') && !mathElements(block).length) return '';
  let out = '';
  const walk = (node: Node): void => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      out += (node as CharacterData).data;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.localName.toLowerCase() === 'math') {
      out += ` ${el.getAttribute('data-speech') || mathDescription(el) || mathSymbols(el)} `;
      return;
    }
    for (const child of Array.from(el.childNodes)) walk(child);
  };
  walk(block);
  return clean(out);
}

/** The symbols of an equation with spaces between them, the last resort. */
export function mathSymbols(el: Element): string {
  const tokens: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 1) {
      const name = (node as Element).localName.toLowerCase();
      if (name === 'annotation' || name === 'annotation-xml') return;
      if (/^m(i|n|o|text|s)$/.test(name)) {
        const t = clean(node.textContent ?? '');
        if (t) tokens.push(t);
        return;
      }
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(el);
  return tokens.join(' ');
}

/**
 * The equation as MathML text for the engine. mathvariant="normal" on a single letter (a
 * chemical symbol, a unit) only means "upright"; the engine reads it as "normal H", so it is left out.
 */
export function mathMarkup(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const mi of Array.from(copy.getElementsByTagNameNS('*', 'mi'))) {
    if (mi.getAttribute('mathvariant') === 'normal') mi.removeAttribute('mathvariant');
  }
  copy.removeAttribute('data-speech');
  const xml = new XMLSerializer().serializeToString(copy);
  return /xmlns=/.test(xml.slice(0, xml.indexOf('>'))) ? xml : xml.replace(/^<math/, `<math xmlns="${MATHML_NS}"`);
}

/** MathML elements and attributes kept when an equation is shown on its own (the maths window). */
const SAFE_MATH = new Set([
  'math', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'ms', 'mspace', 'mfrac', 'msqrt', 'mroot', 'msup', 'msub', 'msubsup',
  'munder', 'mover', 'munderover', 'mtable', 'mtr', 'mtd', 'mlabeledtr', 'mpadded', 'mphantom', 'mfenced', 'menclose',
  'mstyle', 'merror', 'mmultiscripts', 'mprescripts', 'none', 'semantics',
]);
const SAFE_MATH_ATTRIBUTES = ['display', 'mathvariant', 'stretchy', 'fence', 'separator', 'accent', 'accentunder', 'linethickness',
  'columnalign', 'rowalign', 'columnspan', 'rowspan', 'open', 'close', 'separators', 'notation', 'form', 'lspace', 'rspace',
  'largeop', 'movablelimits', 'scriptlevel', 'displaystyle', 'width', 'height', 'depth'];

/** An equation rebuilt from scratch with only MathML structure and text, as markup. */
export function safeMathMarkup(el: Element): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const walk = (node: Node): string => {
    if (node.nodeType === 3 || node.nodeType === 4) return esc((node as CharacterData).data);
    if (node.nodeType !== 1) return '';
    const e = node as Element;
    const name = e.localName.toLowerCase();
    if (!SAFE_MATH.has(name)) return '';
    const attrs = SAFE_MATH_ATTRIBUTES.filter((a) => e.hasAttribute(a)).map((a) => ` ${a}="${esc(e.getAttribute(a)!)}"`).join('');
    return `<${name}${name === 'math' ? ` xmlns="${MATHML_NS}"` : ''}${attrs}>${Array.from(e.childNodes).map(walk).join('')}</${name}>`;
  };
  return walk(el);
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

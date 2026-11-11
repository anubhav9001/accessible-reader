import { attr, descendants, localName } from './xml.js';

/** DTBook elements and the HTML element each becomes. Anything unlisted becomes a <span>. */
const RENAME: Record<string, string> = {
  dtbook: 'div', book: 'div', frontmatter: 'section', bodymatter: 'section', rearmatter: 'section',
  level: 'section', level1: 'section', level2: 'section', level3: 'section',
  level4: 'section', level5: 'section', level6: 'section',
  h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6',
  p: 'p', li: 'li', lic: 'span', dl: 'dl', dt: 'dt', dd: 'dd',
  table: 'table', thead: 'thead', tbody: 'tbody', tfoot: 'tfoot', tr: 'tr', td: 'td', th: 'th',
  col: 'col', colgroup: 'colgroup', caption: 'caption',
  img: 'img', imggroup: 'figure', prodnote: 'aside', sidebar: 'aside', note: 'aside', annotation: 'aside',
  noteref: 'a', annoref: 'a', a: 'a',
  em: 'em', strong: 'strong', sub: 'sub', sup: 'sup', br: 'br', span: 'span', div: 'div',
  blockquote: 'blockquote', q: 'q', code: 'code', kbd: 'kbd', samp: 'samp',
  abbr: 'abbr', acronym: 'abbr', cite: 'cite', dfn: 'dfn', address: 'address',
  sent: 'span', w: 'span', pagenum: 'span', linegroup: 'div', line: 'div', linenum: 'span', poem: 'div',
  author: 'p', doctitle: 'p', docauthor: 'p', covertitle: 'p', bridgehead: 'p', byline: 'p', dateline: 'p',
  epigraph: 'blockquote', title: 'p',
};
const VOID = new Set(['img', 'br', 'col']);
const COPIED = ['id', 'src', 'alt', 'width', 'height', 'colspan', 'rowspan', 'headers', 'scope'];

/**
 * Converts a DAISY 3 DTBook document to an HTML fragment for display. Element ids are kept,
 * so SMIL text references (dtbook.xml#id) still find the phrase to highlight.
 */
export function dtbookToHtml(doc: Document): string {
  const root = doc.documentElement;
  const book = descendants(root, 'book')[0] ?? root;
  return render(book, 0, false);
}

function render(el: Element, depth: number, inImgGroup: boolean): string {
  const name = localName(el);
  if (name === 'head') return '';
  // Maths (MathML, usually written m:math) stays maths, so it can be shown and spoken.
  if (name === 'math') return mathml(el, true);

  let tag: string;
  if (name === 'hd') tag = `h${Math.min(6, Math.max(1, depth))}`;
  else if (name === 'list') tag = attr(el, 'type') === 'ol' ? 'ol' : 'ul';
  else if (name === 'caption' && inImgGroup) tag = 'figcaption';
  else tag = RENAME[name] ?? 'span';

  const childDepth = name === 'level' ? depth + 1 : /^level[1-6]$/.test(name) ? Number(name.slice(5)) : depth;

  const attrs: [string, string][] = [];
  for (const a of COPIED) {
    const v = attr(el, a);
    if (v !== undefined) attrs.push([a, v]);
  }
  const lang = attr(el, 'xml:lang') ?? attr(el, 'lang');
  if (lang) attrs.push(['lang', lang]);
  attrs.push(['class', [`dtb-${name}`, attr(el, 'class')].filter(Boolean).join(' ')]);
  const href = name === 'a' ? attr(el, 'href') : name === 'noteref' || name === 'annoref' ? attr(el, 'idref') : undefined;
  if (href && !/^\s*javascript:/i.test(href)) {
    attrs.push(['href', name === 'a' ? href : `#${href.replace(/^#/, '')}`]);
  }
  if (name === 'pagenum') {
    attrs.push(['role', 'doc-pagebreak'], ['aria-label', `Page ${(el.textContent ?? '').trim()}`]);
  }

  const open = `<${tag}${attrs.map(([k, v]) => ` ${k}="${escape(v)}"`).join('')}>`;
  if (VOID.has(tag)) return open;

  let inner = '';
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 || n.nodeType === 4) inner += escape(n.nodeValue ?? '');
    else if (n.nodeType === 1) inner += render(n as Element, childDepth, name === 'imggroup');
  }
  return `${open}${inner}</${tag}>`;
}

/** A MathML element as markup without its prefix (m:mfrac → mfrac), which the HTML parser reads as maths. */
function mathml(el: Element, root: boolean): string {
  const name = localName(el);
  const attrs = Array.from(el.attributes)
    .filter((a) => !/^xmlns(:|$)/.test(a.name))
    .map((a) => ` ${a.name.replace(/^[^:]+:(?!lang$)/, '')}="${escape(a.value)}"`)
    .join('');
  let inner = '';
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 || n.nodeType === 4) inner += escape(n.nodeValue ?? '');
    else if (n.nodeType === 1) inner += mathml(n as Element, false);
  }
  return `<${name}${root ? ' xmlns="http://www.w3.org/1998/Math/MathML"' : ''}${attrs}>${inner}</${name}>`;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

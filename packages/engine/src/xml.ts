/**
 * The engine never constructs a DOM parser itself, so it runs unchanged in Electron,
 * in a mobile WebView (browser DOMParser) and in Node (xmldom).
 */
export interface XmlPlatform {
  parseXml(text: string): Document;
  parseHtml(text: string): Document;
}

/** Parses markup, using the HTML parser for .html files and when strict XML parsing fails. */
export function parseDocument(platform: XmlPlatform, text: string, path: string): Document {
  if (/\.html?$/i.test(path)) return platform.parseHtml(text);
  const doc = platform.parseXml(text);
  if (!doc.documentElement || descendants(doc, 'parsererror').length > 0) return platform.parseHtml(text);
  return doc;
}

/** Lower-case local name, so matching ignores namespace prefixes and HTML upper-casing. */
export function localName(el: Element): string {
  return (el.localName || el.nodeName.replace(/^.*:/, '')).toLowerCase();
}

export function children(parent: Node, name?: string): Element[] {
  const out: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (name === undefined || localName(n as Element) === name)) out.push(n as Element);
  }
  return out;
}

/** All descendant elements with the given local name, in document order. */
export function descendants(root: Node, name?: string): Element[] {
  const out: Element[] = [];
  const stack: Node[] = [];
  for (let n = root.lastChild; n; n = n.previousSibling) stack.push(n);
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.nodeType !== 1) continue;
    if (name === undefined || localName(n as Element) === name) out.push(n as Element);
    for (let c = n.lastChild; c; c = c.previousSibling) stack.push(c);
  }
  return out;
}

export function first(root: Node, name: string): Element | undefined {
  return descendants(root, name)[0];
}

/**
 * Reads an attribute by its qualified name (case-insensitive). A prefixed name such as
 * "epub:type" also matches when the document used a different prefix for the namespace.
 */
export function attr(el: Element, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const wantedLocal = wanted.includes(':') ? wanted.replace(/^.*:/, '') : undefined;
  let byLocal: string | undefined;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i]!;
    const qname = a.name.toLowerCase();
    if (qname === wanted) return a.value;
    if (wantedLocal && qname.includes(':') && qname.replace(/^.*:/, '') === wantedLocal) byLocal ??= a.value;
  }
  return byLocal;
}

/** Text content with whitespace collapsed. */
export function text(el: Element | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function tokens(value: string | undefined): string[] {
  return value ? value.trim().split(/\s+/).map((t) => t.toLowerCase()) : [];
}

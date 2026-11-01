import { DOMParser } from '@xmldom/xmldom';
import type { XmlPlatform } from '../xml.js';

// Real-world DAISY files are often slightly malformed; keep whatever parses.
const parser = new DOMParser({ onError: () => {} });

/** XML platform for Node (Electron main process, tests). */
export const xmldomPlatform: XmlPlatform = {
  parseXml: (text) => parser.parseFromString(text, 'application/xml') as unknown as Document,
  parseHtml: (text) => parser.parseFromString(text, 'text/html') as unknown as Document,
};

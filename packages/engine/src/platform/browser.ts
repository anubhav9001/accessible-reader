import type { XmlPlatform } from '../xml.js';

/** XML platform for Electron renderers and mobile WebViews. */
export const browserPlatform: XmlPlatform = {
  parseXml: (text) => new DOMParser().parseFromString(text, 'application/xml'),
  parseHtml: (text) => new DOMParser().parseFromString(text, 'text/html'),
};

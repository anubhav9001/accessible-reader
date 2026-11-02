import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_CATALOGS,
  bestAcquisition,
  bestDownload,
  parseOpenSearchTemplate,
  readOpdsFeed,
  searchUrl,
  secureUrl,
} from '../src/index.js';
import { xmldomPlatform } from '../src/platform/xmldom.js';

// Trimmed copies of real Project Gutenberg feeds (November 2026).
const fixture = (name: string) => readFileSync(new URL(`./fixtures/opds/${name}`, import.meta.url), 'utf-8');

describe('OPDS catalogues', () => {
  it('reads the Gutenberg start feed as browsable categories', () => {
    const feed = readOpdsFeed(xmldomPlatform, fixture('gutenberg-root.xml'), 'https://www.gutenberg.org/ebooks.opds/');
    expect(feed.title).toBe('Project Gutenberg');
    expect(feed.entries.map((e) => e.title)).toEqual(['Popular', 'Latest', 'Random']);
    expect(feed.entries[0]!.navigation?.href).toBe('https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads');
    expect(feed.entries[0]!.acquisitions).toEqual([]);
    expect(feed.searchDescription).toBe('https://www.gutenberg.org/catalog/osd-books.xml');
  });

  it('reads search results with their next page', () => {
    const feed = readOpdsFeed(
      xmldomPlatform,
      fixture('gutenberg-search.xml'),
      'https://www.gutenberg.org/ebooks/search.opds/?query=tagore',
    );
    expect(feed.next).toBe('https://www.gutenberg.org/ebooks/search.opds/?query=tagore&start_index=26');
    const book = feed.entries.find((e) => e.title === 'Stray Birds');
    expect(book?.summary).toBe('Rabindranath Tagore');
    expect(book?.navigation?.href).toBe('https://www.gutenberg.org/ebooks/6524.opds');
  });

  it("reads a book's own feed and picks EPUB 3 with images across its editions", () => {
    const feed = readOpdsFeed(xmldomPlatform, fixture('gutenberg-book.xml'), 'https://www.gutenberg.org/ebooks/7164.opds');
    const noImages = feed.entries[0]!;
    expect(noImages.title).toBe('Gitanjali');
    expect(noImages.authors).toEqual(['Tagore, Rabindranath']);
    expect(noImages.language).toBe('en');
    expect(noImages.summary).toContain('Song offering');
    expect(bestAcquisition(noImages)?.href).toBe('https://www.gutenberg.org/ebooks/7164.epub.noimages');

    const best = bestDownload(feed)!;
    expect(best.entry.title).toBe('Gitanjali');
    expect(best.link).toMatchObject({
      href: 'https://www.gutenberg.org/ebooks/7164.epub3.images',
      type: 'application/epub+zip',
      length: 309321,
    });
  });

  it('finds the search template, upgraded to HTTPS', () => {
    const template = parseOpenSearchTemplate(xmldomPlatform.parseXml(fixture('gutenberg-osd.xml')));
    expect(template).toBe('https://m.gutenberg.org/ebooks/search.opds/?query={searchTerms}');
    expect(searchUrl(BUILT_IN_CATALOGS[0]!.searchTemplate!, ' gitanjali tagore ')).toBe(
      'https://www.gutenberg.org/ebooks/search.opds/?query=gitanjali%20tagore',
    );
    expect(searchUrl('https://x.org/s?q={searchTerms}&p={startPage?}', 'a')).toBe('https://x.org/s?q=a&p=');
  });

  it('upgrades plain HTTP except for the local server', () => {
    expect(secureUrl('http://www.gutenberg.org/ebooks/1.epub3.images')).toBe('https://www.gutenberg.org/ebooks/1.epub3.images');
    expect(secureUrl('http://127.0.0.1:8080/x')).toBe('http://127.0.0.1:8080/x');
  });
});

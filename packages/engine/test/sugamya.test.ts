import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSugamyaPath, parseSugamyaBooks, parseSugamyaNames, sugamyaFormatReadable, sugamyaPath } from '../src/index.js';
import { xmldomPlatform } from '../src/platform/xmldom.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/sugamya/${name}`, import.meta.url), 'utf8');

describe('Sugamya Pustakalaya', () => {
  it('builds request paths without the key', () => {
    expect(sugamyaPath({ kind: 'search', terms: ' tagore ' })).toBe('authortitle/tagore/page/1/limit/20/format/xml');
    expect(sugamyaPath({ kind: 'category', name: 'Art and Architecture' }, 2)).toBe('category/Art%20and%20Architecture/page/2/limit/20/format/xml');
    expect(sugamyaPath({ kind: 'book', id: '5884' })).toBe('id/5884/page/1/limit/1/format/xml');
    expect(isSugamyaPath(sugamyaPath({ kind: 'grade', name: 'Grade 10' }))).toBe(true);
    expect(isSugamyaPath('../../evil?x=1/format/xml')).toBe(false);
  });

  it('reads search results, treating NA as empty', () => {
    const page = parseSugamyaBooks(xmldomPlatform, fixture('search.xml'));
    expect(page.total).toBe(35);
    expect(page.items.map((b) => [b.id, b.title, b.author, b.size])).toEqual([
      ['474', 'Nauka Doobi', 'Ravindranath Tagore', ''],
      ['2861', 'The Postmaster', 'Rabindranath Tagore', ''],
    ]);
  });

  it("reads a book's details", () => {
    const [book] = parseSugamyaBooks(xmldomPlatform, fixture('book.xml')).items;
    expect(book).toMatchObject({ id: '5884', format: 'daisy3', size: '27MB', language: 'Malayalam' });
    expect(book!.synopsis).toMatch(/^THE HEART TOUCHING/);
  });

  it('reads category names and "no data" messages', () => {
    const names = parseSugamyaNames(xmldomPlatform, fixture('categories.xml'));
    expect(names.items).toEqual(['Animals', 'Art and Architecture', 'Biographies and Memoirs']);
    expect(names.total).toBe(49);
    const none = parseSugamyaBooks(xmldomPlatform, fixture('none.xml'));
    expect(none.items).toEqual([]);
    expect(none.message).toBe('No data existing');
  });

  it('knows which formats Reader can open', () => {
    for (const f of ['DAISY Audio Only', 'daisy3', 'daisy202', 'EPUB Text Only', 'EPUB with Media Overlay']) expect(sugamyaFormatReadable(f)).toBe(true);
    for (const f of ['Formatted Braille', 'brailleDtbook', 'Word', 'rtf', '']) expect(sugamyaFormatReadable(f)).toBe(false);
  });
});

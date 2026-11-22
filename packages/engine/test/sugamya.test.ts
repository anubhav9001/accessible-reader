import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  sugamyaRequestsWithState,
  sugamyaBookByTitle,
  isSugamyaInstantFormat,
  isSugamyaAuthFailure,
  isSugamyaRequestAccepted,
  isSugamyaDownloadUrl,
  sugamyaDownloadLink,
  isSugamyaPath,
  parseSugamyaMessage,
  parseSugamyaRequests,
  parseSugamyaUser,
  sugamyaAccountFields,
  sugamyaAuthorization,
  sugamyaFormatId,
  sugamyaPopularQuery,
  parseSugamyaBooks,
  parseSugamyaNames,
  sugamyaBookSummary,
  sugamyaByLine,
  sugamyaFormatReadable,
  sugamyaPath,
} from '../src/index.js';
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

  it('reads search results, marking NA as not available', () => {
    const page = parseSugamyaBooks(xmldomPlatform, fixture('search.xml'));
    expect(page.total).toBe(35);
    expect(page.items.map((b) => [b.id, b.title, b.author, b.size, b.isbn])).toEqual([
      ['474', 'Nauka Doobi', 'Ravindranath Tagore', 'Not available', ''],
      ['2861', 'The Postmaster', 'Rabindranath Tagore', 'Not available', ''],
    ]);
  });

  it('says which details are not available', () => {
    const xml = '<nalp><books><list><result><author>N/A</author><id>9</id><language>NA</language><title>Koyal Song</title><download-format>DAISY Audio Only</download-format><dtbook-size>0BS</dtbook-size></result></list></books></nalp>';
    const [book] = parseSugamyaBooks(xmldomPlatform, xml).items;
    expect(book).toMatchObject({ author: 'Not available', language: 'Not available', size: 'Not available', publisher: '' });
    expect(sugamyaBookSummary(book!)).toBe('Author not available. Language not available. DAISY Audio Only');
    expect(sugamyaByLine(book!)).toBe('Author: Not available');
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

describe('Sugamya Pustakalaya account', () => {
  it('asks for popular books of the past year, dates as YYYY-MM-DD', () => {
    const query = sugamyaPopularQuery(new Date('2026-11-10T08:00:00Z'));
    expect(sugamyaPath(query)).toBe('popularbooks/noOfTimesDelivered/50/startDate/2025-11-10/endDate/2026-11-10/page/1/limit/20/format/xml');
    expect(isSugamyaPath(sugamyaPath(query))).toBe(true);
  });

  it('knows format IDs by either kind of name', () => {
    expect(sugamyaFormatId('daisy3')).toBe(5);
    expect(sugamyaFormatId('DAISY Text Only')).toBe(7);
    expect(sugamyaFormatId(' EPUB  Text Only ')).toBe(22);
    expect(sugamyaFormatId('Not available')).toBeUndefined();
  });

  it('builds the Authorization header as UTF-8 Base64', () => {
    expect(sugamyaAuthorization('reader', 'pass')).toBe('Basic cmVhZGVyOnBhc3M=');
    expect(sugamyaAuthorization(' reader@example.org ', 'पास')).toBe(`Basic ${Buffer.from('reader@example.org:पास').toString('base64')}`);
  });

  it('only lets the password go to the library over HTTPS', () => {
    expect(isSugamyaDownloadUrl('https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/a b.zip')).toBe(true);
    expect(isSugamyaDownloadUrl('http://sugamyapustakalaya.org.in/x.zip')).toBe(false);
    expect(isSugamyaDownloadUrl('https://sugamyapustakalaya.org.in.evil.example/x.zip')).toBe(false);
    expect(isSugamyaDownloadUrl('ftp://library.daisyindia.org/x.zip')).toBe(false);
    expect(isSugamyaDownloadUrl('https://www.sugamyapustakalaya.org.in/x.zip')).toBe(true);
    expect(isSugamyaDownloadUrl('https://library.daisyindia.org/User_935/x.zip')).toBe(true);
    expect(isSugamyaDownloadUrl('https://evil.example/?u=https://sugamyapustakalaya.org.in/')).toBe(false);
    expect(isSugamyaDownloadUrl('https://me:pw@sugamyapustakalaya.org.in/x.zip')).toBe(false);
  });

  it('makes download links usable, or says why not', () => {
    const ok = (raw: string) => {
      const link = sugamyaDownloadLink(raw);
      return 'url' in link ? link.url : `PROBLEM ${link.problem}`;
    };
    // As in the API guide: the library's own link, with spaces in the file name.
    expect(ok('https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/Business study NCERT 11th-6.zip')).toBe(
      'https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/Business%20study%20NCERT%2011th-6.zip',
    );
    expect(ok('  http://sugamyapustakalaya.org.in/rest/x.epub\n')).toBe('https://sugamyapustakalaya.org.in/rest/x.epub');
    expect(ok('http://www.sugamyapustakalaya.org.in/rest/x.epub')).toBe('https://www.sugamyapustakalaya.org.in/rest/x.epub');
    expect(ok('/rest/NALPAPIService/downloadFile/a.epub')).toBe('https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/a.epub');
    expect(ok('https://library.daisyindia.org/User_935/a.zip')).toBe('https://library.daisyindia.org/User_935/a.zip');
    expect(ok('ftp://library.daisyindia.org:21/User_935/Sangeet Manjusha-6.zip')).toMatch(/^PROBLEM .*FTP link/);
    expect(ok('https://files.example.com/a.epub')).toMatch(/^PROBLEM .*isn't on Sugamya Pustakalaya's own website/);
    expect(ok('http://files.example.com/a.epub')).toMatch(/^PROBLEM /);
    expect(ok('')).toMatch(/^PROBLEM .*not given a download link/);
    // The shape for the log leaves out the file name.
    expect(sugamyaDownloadLink('https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/Secret Title.zip').shape).toBe(
      'https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/…',
    );
    expect(sugamyaDownloadLink('https://evil.example/My Title.zip').shape).toBe('https://evil.example/…');
  });

  it('reads download requests', () => {
    const page = parseSugamyaRequests(xmldomPlatform, fixture('requests.xml'));
    expect(page.items).toEqual([
      {
        title: 'Business study NCERT 11th',
        format: 'DAISY Audio Only',
        status: 'Available for Download',
        ready: true,
        url: 'https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/Business study NCERT 11th-6.zip',
      },
      { title: 'Sangeet Manjusha', format: 'EPUB Text Only', status: 'Request in process', ready: false, url: '' },
    ]);
  });

  it("reads the library's messages and the reader's details", () => {
    expect(parseSugamyaMessage(xmldomPlatform, fixture('request-raised.xml'))).toMatch(/^Your download request has been registered/);
    expect(parseSugamyaMessage(xmldomPlatform, '<!DOCTYPE html><html>Oops</html>')).toBeUndefined();
    expect(parseSugamyaUser(xmldomPlatform, fixture('user.xml'))).toEqual({ name: 'EndUser One', email: 'enduser.one@example.org' });
    expect(parseSugamyaUser(xmldomPlatform, fixture('request-raised.xml'))).toBeUndefined();
    expect(isSugamyaAuthFailure('Security Autentication Failed')).toBe(true);
    expect(isSugamyaRequestAccepted(parseSugamyaMessage(xmldomPlatform, fixture('request-raised.xml'))!)).toBe(true);
    expect(isSugamyaRequestAccepted('The Book is currently not available for download. An offline request may be raised for this book.')).toBe(false);
    expect(isSugamyaAuthFailure('No data existing')).toBe(false);
    expect(sugamyaAccountFields('raiseBookDownloadRequest', { bookId: '28', formatId: 6 })).toEqual({ bookId: '28', formatId: '6' });
  });
});

describe('download request states', () => {
  const day = 86_400_000;
  const now = Date.UTC(2026, 10, 22);
  const epub = 'Structured Epub without proofreading';
  const audio = 'DAISY Audio Only';
  const req = (title: string, format: string, url = '') => ({
    title,
    format,
    status: url ? 'Available for Download' : '',
    ready: !!url,
    url,
  });

  it('knows which formats the library makes at once', () => {
    expect(isSugamyaInstantFormat(epub)).toBe(true);
    expect(isSugamyaInstantFormat(audio)).toBe(false);
  });

  it('says ready, renew, preparing, expired or unknown', () => {
    const list = sugamyaRequestsWithState(
      [req('Ready', audio, 'https://sugamyapustakalaya.org.in/a.zip'), req('Old EPUB', epub), req('New audio', audio), req('Old audio', audio), req('Website audio', audio)],
      [
        { title: 'New audio', format: audio, bookId: '1', at: now - 2 * day },
        { title: 'Old audio', format: audio, bookId: '2', at: now - 8 * day },
      ],
      now,
    );
    expect(list.map((r) => `${r.title}: ${r.state}`)).toEqual([
      'Ready: ready',
      'Old EPUB: renew',
      'New audio: preparing',
      'Old audio: expired',
      'Website audio: unknown',
    ]);
    expect(list[3]!.bookId).toBe('2');
  });

  it('keeps one entry per book and format, the ready one first', () => {
    const list = sugamyaRequestsWithState(
      [req('Book', epub), req('Other', epub), req('book ', epub, 'https://sugamyapustakalaya.org.in/b.zip'), req('Book', epub)],
      [],
      now,
    );
    expect(list.map((r) => `${r.title}: ${r.state}`)).toEqual(['book : ready', 'Other: renew']);
  });

  it('finds a book by its exact title only when there is one', () => {
    const book = (id: string, title: string) =>
      ({ id, title, author: '', publisher: '', synopsis: '', format: '', size: '', language: '', isbn: '', freelyAvailable: false });
    expect(sugamyaBookByTitle([book('1', 'SBI Clerical Recruitment Exam'), book('2', 'SBI Clerical Exam Guide')], 'sbi clerical  recruitment exam')?.id).toBe('1');
    expect(sugamyaBookByTitle([book('1', 'Same'), book('2', 'Same')], 'Same')).toBeUndefined();
  });
});

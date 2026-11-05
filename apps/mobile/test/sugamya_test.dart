import 'dart:io';

import 'package:accessible_reader/sugamya.dart';
import 'package:flutter_test/flutter_test.dart';

// The same Sugamya responses the engine's TypeScript tests use.
String _fixture(String name) => File('../../packages/engine/test/fixtures/sugamya/$name').readAsStringSync();

void main() {
  test('builds request paths without the key', () {
    expect(const SugamyaSearch(' tagore ').path(1), 'authortitle/tagore/page/1/limit/20/format/xml');
    expect(const SugamyaIn('Art and Architecture').path(2), 'category/Art%20and%20Architecture/page/2/limit/20/format/xml');
    expect(const SugamyaNames(grades: true).path(1), 'gradelist/page/1/limit/20/format/xml');
  });

  test('reads search results, marking NA as not available', () {
    final page = parseSugamyaBooks(_fixture('search.xml'));
    expect(page.total, 35);
    expect(page.items.map((b) => [b.id, b.title, b.author, b.size]), [
      ['474', 'Nauka Doobi', 'Ravindranath Tagore', 'Not available'],
      ['2861', 'The Postmaster', 'Rabindranath Tagore', 'Not available'],
    ]);
  });

  test('says which details are not available', () {
    const xml = '<nalp><books><list><result><author>N/A</author><id>9</id><language>NA</language>'
        '<title>Koyal Song</title><download-format>DAISY Audio Only</download-format><dtbook-size>0BS</dtbook-size>'
        '</result></list></books></nalp>';
    final book = parseSugamyaBooks(xml).items.single;
    expect([book.author, book.language, book.size, book.publisher], ['Not available', 'Not available', 'Not available', '']);
    expect(book.detail, 'Author not available. Language not available. DAISY Audio Only');
    expect(book.byLine, 'Author: Not available');
  });

  test("reads a book's details", () {
    final book = parseSugamyaBooks(_fixture('book.xml')).items.single;
    expect([book.id, book.format, book.size, book.language], ['5884', 'daisy3', '27MB', 'Malayalam']);
    expect(book.detail, 'VAIKKAM MUHAMMED BASHIR. Malayalam. DAISY 3');
  });

  test('reads names and "no data" messages', () {
    expect(parseSugamyaNames(_fixture('categories.xml')).items, ['Animals', 'Art and Architecture', 'Biographies and Memoirs']);
    final none = parseSugamyaBooks(_fixture('none.xml'));
    expect(none.items, isEmpty);
    expect(none.message, 'No data existing');
  });

  test('knows which formats Reader can open', () {
    for (final f in ['DAISY Audio Only', 'daisy3', 'EPUB Text Only']) {
      expect(sugamyaFormatReadable(f), isTrue);
    }
    for (final f in ['Formatted Braille', 'Word', '']) {
      expect(sugamyaFormatReadable(f), isFalse);
    }
  });
}

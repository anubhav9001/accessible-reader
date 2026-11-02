import 'dart:io';

import 'package:accessible_reader/opds.dart';
import 'package:flutter_test/flutter_test.dart';

// The same trimmed Project Gutenberg feeds the engine's TypeScript tests use.
String _fixture(String name) => File('../../packages/engine/test/fixtures/opds/$name').readAsStringSync();

void main() {
  test('reads the Gutenberg start feed as browsable categories', () {
    final feed = parseOpdsFeed(_fixture('gutenberg-root.xml'), 'https://www.gutenberg.org/ebooks.opds/');
    expect(feed.title, 'Project Gutenberg');
    expect(feed.entries.map((e) => e.title), ['Popular', 'Latest', 'Random']);
    expect(feed.entries.first.navigation?.href, 'https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads');
    expect(bestDownload(feed), isNull);
  });

  test('reads search results with their next page', () {
    final feed = parseOpdsFeed(_fixture('gutenberg-search.xml'), 'https://www.gutenberg.org/ebooks/search.opds/?query=tagore');
    expect(feed.next, 'https://www.gutenberg.org/ebooks/search.opds/?query=tagore&start_index=26');
    final book = feed.entries.firstWhere((e) => e.title == 'Stray Birds');
    expect(book.summary, 'Rabindranath Tagore');
    expect(book.navigation?.href, 'https://www.gutenberg.org/ebooks/6524.opds');
  });

  test("picks EPUB 3 with images across a book's editions", () {
    final feed = parseOpdsFeed(_fixture('gutenberg-book.xml'), 'https://www.gutenberg.org/ebooks/7164.opds');
    final best = bestDownload(feed)!;
    expect(best.entry.title, 'Gitanjali');
    expect(best.entry.authors, ['Tagore, Rabindranath']);
    expect(best.entry.language, 'en');
    expect(best.link.href, 'https://www.gutenberg.org/ebooks/7164.epub3.images');
    expect(best.link.length, 309321);
  });

  test('builds search URLs and upgrades plain HTTP', () {
    expect(searchUrl(builtInCatalogs.first.searchTemplate!, ' gitanjali tagore '),
        'https://www.gutenberg.org/ebooks/search.opds/?query=gitanjali%20tagore');
    expect(secureUrl('http://www.gutenberg.org/x'), 'https://www.gutenberg.org/x');
    expect(secureUrl('http://127.0.0.1:8080/x'), 'http://127.0.0.1:8080/x');
  });

  test('refuses plain HTTP catalogues', () async {
    final client = CatalogClient();
    await expectLater(client.feed('http://example.org/feed'), throwsA(isA<CatalogException>()));
    client.close();
  });

  group('when the library is busy', () {
    late HttpServer server;
    late List<int> statuses;
    var requests = 0;

    setUp(() async {
      requests = 0;
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      server.listen((request) {
        final status = statuses[requests.clamp(0, statuses.length - 1)];
        requests++;
        request.response.statusCode = status;
        if (status == 200) request.response.write(_fixture('gutenberg-root.xml'));
        request.response.close();
      });
    });
    tearDown(() => server.close(force: true));

    CatalogClient client() => CatalogClient(retryDelay: Duration.zero, httpsOnly: false);
    String url() => 'http://127.0.0.1:${server.port}/ebooks.opds/';

    test('retries a gateway timeout and succeeds', () async {
      statuses = [504, 503, 200];
      final feed = await client().feed(url());
      expect(feed.title, 'Project Gutenberg');
      expect(requests, 3);
    });

    test('gives up after three tries with a clear message', () async {
      statuses = [504];
      await expectLater(
        client().feed(url()),
        throwsA(isA<CatalogException>().having((e) => e.message, 'message', contains('busy right now (error 504)'))),
      );
      expect(requests, 3);
    });

    test('does not retry other errors', () async {
      statuses = [404];
      await expectLater(client().feed(url()), throwsA(isA<CatalogException>()));
      expect(requests, 1);
    });
  });
}

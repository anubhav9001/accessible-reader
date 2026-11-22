import 'dart:convert';
import 'dart:io';

import 'package:accessible_reader/opds.dart';
import 'package:accessible_reader/sugamya.dart';
import 'package:accessible_reader/sugamya_account.dart';
import 'package:flutter_test/flutter_test.dart';

// Run with a key, as the app is built: flutter test --dart-define=SUGAMYA_API_KEY=test-key

String _fixture(String name) => File('../../packages/engine/test/fixtures/sugamya/$name').readAsStringSync();

class _MemorySecrets implements SugamyaSecrets {
  Map<String, String>? values;
  @override
  Future<Map<String, String>?> read() async => values;
  @override
  Future<void> write(Map<String, String> v) async => values = {...?values, ...v};
  @override
  Future<void> clear() async => values = null;
}

void main() {
  test('reads requests, messages and the reader, as the engine does', () {
    final requests = parseSugamyaRequests(_fixture('requests.xml'));
    expect(requests.map((r) => [r.title, r.format, r.ready, r.url.isNotEmpty]), [
      ['Business study NCERT 11th', 'DAISY Audio Only', true, true],
      ['Sangeet Manjusha', 'EPUB Text Only', false, false],
    ]);
    expect(parseSugamyaMessage(_fixture('request-raised.xml')), startsWith('Your download request has been registered'));
    expect(parseSugamyaMessage('<!DOCTYPE html><html>Oops</html>'), isNull);
    expect(parseSugamyaUser(_fixture('user.xml'))?.name, 'EndUser One');
    expect(sugamyaFormatId('daisy3'), 5);
    expect(sugamyaFormatId(' EPUB  Text Only '), 22);
    expect(sugamyaAuthorization('reader', 'pass'), 'Basic cmVhZGVyOnBhc3M=');
    expect(isSugamyaDownloadUrl('https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/a b.zip'), isTrue);
    expect(isSugamyaDownloadUrl('https://sugamyapustakalaya.org.in.evil.example/x.zip'), isFalse);
    expect(isSugamyaDownloadUrl('https://www.sugamyapustakalaya.org.in/x.zip'), isTrue);
    expect(isSugamyaDownloadUrl('https://library.daisyindia.org/User_935/x.zip'), isTrue);
    expect(isSugamyaDownloadUrl('http://sugamyapustakalaya.org.in/x.zip'), isFalse);
    expect(isSugamyaDownloadUrl('https://me:pw@sugamyapustakalaya.org.in/x.zip'), isFalse);
  });

  test('makes download links usable, or says why not', () {
    String ok(String raw) {
      final link = sugamyaDownloadLink(raw);
      return link.url?.toString() ?? 'PROBLEM ${link.problem}';
    }

    expect(ok('https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/Business study NCERT 11th-6.zip'),
        'https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/Business%20study%20NCERT%2011th-6.zip');
    expect(ok('  http://sugamyapustakalaya.org.in/rest/x.epub\n'), 'https://sugamyapustakalaya.org.in/rest/x.epub');
    expect(ok('http://www.sugamyapustakalaya.org.in/rest/x.epub'), 'https://www.sugamyapustakalaya.org.in/rest/x.epub');
    expect(ok('/rest/NALPAPIService/downloadFile/a.epub'), 'https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/a.epub');
    expect(ok('https://library.daisyindia.org/User_935/a.zip'), 'https://library.daisyindia.org/User_935/a.zip');
    expect(ok('ftp://library.daisyindia.org:21/User_935/Sangeet Manjusha-6.zip'), contains('FTP link'));
    expect(ok('https://files.example.com/a.epub'), contains("isn't on Sugamya Pustakalaya's own website"));
    expect(ok(''), contains('not given a download link'));
    expect(sugamyaDownloadLink('https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/Secret Title.zip').shape,
        'https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/…');
    expect(sugamyaDownloadLink('https://evil.example/My Title.zip').shape, 'https://evil.example/…');
    expect(SugamyaPopular(DateTime.utc(2026, 11, 10)).path(1),
        'popularbooks/noOfTimesDelivered/50/startDate/2025-11-10/endDate/2026-11-10/page/1/limit/20/format/xml');
  });

  group('account against a stand-in library', () {
    late HttpServer server;
    late String base;
    final calls = <String>[];
    var manyRequests = 0;
    var repeatPage = false;
    final pagesAsked = <int>[];
    final good = sugamyaAuthorization('tester', 's3cret pass');

    setUp(() async {
      calls.clear();
      manyRequests = 0;
      repeatPage = false;
      pagesAsked.clear();
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      base = 'http://127.0.0.1:${server.port}';
      server.listen((req) async {
        final body = await utf8.decoder.bind(req).join();
        final name = req.uri.path.substring(1);
        final authorized = req.headers.value('authorization') == good;
        calls.add('$name ${req.method} ${authorized ? 'good' : 'bad'} ${req.headers.value('strapikey') != null} $body');
        final res = req.response;
        if (!authorized && !name.startsWith('downloadFile/')) {
          // As the live library: a wrong password is an XML message.
          res.write('<nalp><api-version>1.0</api-version><message><string>Security Autentication Failed</string></message></nalp>');
        } else if (!authorized) {
          res.statusCode = 404;
          res.write('<!DOCTYPE html><div>Oops</div>');
        } else if (name == 'raiseBookDownloadRequest' && req.headers.value('bookId') == null) {
          // A request it can't handle gets its HTML error page.
          res.statusCode = 404;
          res.write('<!DOCTYPE html><div>Oops</div>');
        } else if (name.startsWith('downloadFile/')) {
          res.contentLength = 4;
          res.add([1, 2, 3, 4]);
        } else if (name == 'getUserInfo') {
          res.write(_fixture('user.xml'));
        } else if (name == 'raiseBookDownloadRequest') {
          res.write(_fixture('request-raised.xml'));
        } else if (name == 'fetchUserDownloadRequests' && manyRequests > 0) {
          // Paged like the library: page and limit from the headers.
          final limit = int.tryParse(req.headers.value('limit') ?? '') ?? 50;
          final page = repeatPage ? 1 : int.tryParse(req.headers.value('page') ?? '') ?? 1;
          pagesAsked.add(page);
          final from = (page - 1) * limit, to = (page * limit).clamp(0, manyRequests);
          final items = [
            for (var i = from; i < to; i++)
              '<result><available-to-download>Request in process</available-to-download><download-format>DAISY Audio Only</download-format><downloadUrl></downloadUrl><title>Book ${i + 1}</title></result>'
          ];
          res.write('<nalp><api-version>1.0</api-version><total-results>$manyRequests</total-results>'
              '${items.isEmpty ? '<message><string>No data existing</string></message>' : '<books><list>${items.join()}</list></books>'}</nalp>');
        } else {
          res.write(_fixture('requests.xml').replaceAll(
              'https://sugamyapustakalaya.org.in/rest/NALPAPIService/downloadFile/', '$base/downloadFile/'));
        }
        await res.close();
      });
    });
    tearDown(() => server.close(force: true));

    test('signs in, asks for a book, lists requests, downloads, signs out', () async {
      if (sugamyaApiKey.isEmpty) return markTestSkipped('needs --dart-define=SUGAMYA_API_KEY=test-key');
      final secrets = _MemorySecrets();
      final account = SugamyaAccount(secrets: secrets, base: base, allowLocal: true);
      expect(await account.info(), isNull);

      await expectLater(account.signIn('tester', 'wrong'), throwsA(isA<CatalogException>().having((e) => e.message, 'message', contains("didn't accept"))));
      expect(secrets.values, isNull);

      final info = await account.signIn(' tester ', 's3cret pass');
      expect(info.name, 'EndUser One');
      expect(secrets.values, {'user': 'tester', 'name': 'EndUser One', 'password': 's3cret pass', 'asked': '[]'});

      expect(await account.requestBook('28', 'DAISY Audio Only'), startsWith('Your download request has been registered'));
      expect(calls.last, contains('bookId=28&formatId=6&strapikey='));

      final requests = await account.requests();
      expect(requests.where((r) => r.ready).length, 1);

      final dir = await Directory.systemTemp.createTemp('sugamya-test');
      final file = File('${dir.path}/book.zip');
      final steps = <double>[];
      await account.download(requests.first.url, file, steps.add);
      expect(await file.readAsBytes(), [1, 2, 3, 4]);
      expect(steps.last, 1.0);
      await expectLater(account.download('https://evil.example/x.zip', file, (_) {}),
          throwsA(isA<CatalogException>().having((e) => e.message, 'message', contains("won't send your password"))));
      await dir.delete(recursive: true);

      // A new start reads the account back.
      final again = SugamyaAccount(secrets: secrets, base: base, allowLocal: true);
      expect((await again.info())?.user, 'tester');
      await again.signOut();
      expect(secrets.values, isNull);
      expect(calls.where((c) => c.contains(' POST ')).every((c) => c.split(' ')[3] == 'true'), isTrue, reason: 'every account call sends the key header');
    });
    test('fetches every page of download requests', () async {
      if (sugamyaApiKey.isEmpty) return markTestSkipped('needs --dart-define=SUGAMYA_API_KEY=test-key');
      final account = SugamyaAccount(secrets: _MemorySecrets(), base: base, allowLocal: true);
      await account.signIn('tester', 's3cret pass');
      manyRequests = 120;
      final all = await account.requests();
      expect(all.length, 120);
      expect(all.last.title, 'Book 120');
      expect(pagesAsked, [1, 2, 3]);

      pagesAsked.clear();
      manyRequests = 50;
      expect((await account.requests()).length, 50);
      expect(pagesAsked, [1]);

      // A library that ignores the page number: stop instead of repeating page 1.
      pagesAsked.clear();
      manyRequests = 120;
      repeatPage = true;
      expect((await account.requests()).length, 50);
      expect(pagesAsked, [1, 1]);
    });
  });

  group('download request states', () {
    final now = DateTime.utc(2026, 11, 22);
    const epub = 'Structured Epub without proofreading';
    const audio = 'DAISY Audio Only';
    SugamyaRequest req(String title, String format, [String url = '']) =>
        SugamyaRequest(title: title, format: format, status: url.isEmpty ? '' : 'Available for Download', ready: url.isNotEmpty, url: url);

    test('knows which formats the library makes at once', () {
      expect(isSugamyaInstantFormat(epub), isTrue);
      expect(isSugamyaInstantFormat(audio), isFalse);
    });

    test('says ready, renew, preparing, expired or unknown', () {
      final list = sugamyaRequestsWithState([
        req('Ready', audio, 'https://sugamyapustakalaya.org.in/a.zip'),
        req('Old EPUB', epub),
        req('New audio', audio),
        req('Old audio', audio),
        req('Website audio', audio),
      ], [
        SugamyaAsked(title: 'New audio', format: audio, bookId: '1', at: now.subtract(const Duration(days: 2))),
        SugamyaAsked(title: 'Old audio', format: audio, bookId: '2', at: now.subtract(const Duration(days: 8))),
      ], now);
      expect(list.map((r) => '${r.title}: ${r.state.name}'),
          ['Ready: ready', 'Old EPUB: renew', 'New audio: preparing', 'Old audio: expired', 'Website audio: unknown']);
      expect(list[3].bookId, '2');
    });

    test('keeps one entry per book and format, the ready one first', () {
      final list = sugamyaRequestsWithState(
          [req('Book', epub), req('Other', epub), req('book ', epub, 'https://sugamyapustakalaya.org.in/b.zip'), req('Book', epub)], [], now);
      expect(list.map((r) => '${r.title}: ${r.state.name}'), ['book : ready', 'Other: renew']);
    });

    test("trusts the library's status: Queued is being prepared, not expired", () {
      final queued = SugamyaRequest(title: 'Queued EPUB', format: epub, status: 'Queued', ready: false, url: '');
      expect(sugamyaRequestsWithState([queued], [], now).single.state, SugamyaRequestState.preparing);
    });

    test('notices when the library sent a different book', () {
      expect(sugamyaTitlesDiffer('THE Social Dimensions OF Early Buddhism', 'The Social Construction of Reality'), isTrue);
      expect(sugamyaTitlesDiffer('MSO-001 Sociological Theories and Concepts Block-7 Theories of Social Satisfaction',
          'Block-7 Theories of Social Satisfaction'), isFalse);
      expect(sugamyaTitlesDiffer('A', ''), isFalse);
    });

    test('remembers what Reader asked for, across a restart', () async {
      final secrets = _MemorySecrets()..values = {'user': 'tester', 'name': 'Test', 'password': 'pw'};
      final asked = [SugamyaAsked(title: 'A', format: audio, bookId: '7', at: DateTime.now())];
      secrets.values!['asked'] = jsonEncode(asked);
      final account = SugamyaAccount(secrets: secrets);
      expect((await account.info())?.user, 'tester');
      expect(sugamyaAskedToKeep(asked, DateTime.now()).single.bookId, '7');
      expect(sugamyaAskedToKeep(asked, DateTime.now().add(const Duration(days: 31))), isEmpty);
    });
  });
}


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
    expect(SugamyaPopular(DateTime.utc(2026, 11, 10)).path(1),
        'popularbooks/noOfTimesDelivered/50/startDate/2025-11-10/endDate/2026-11-10/page/1/limit/20/format/xml');
  });

  group('account against a stand-in library', () {
    late HttpServer server;
    late String base;
    final calls = <String>[];
    final good = sugamyaAuthorization('tester', 's3cret pass');

    setUp(() async {
      calls.clear();
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      base = 'http://127.0.0.1:${server.port}';
      server.listen((req) async {
        final body = await utf8.decoder.bind(req).join();
        final name = req.uri.path.substring(1);
        final authorized = req.headers.value('authorization') == good;
        calls.add('$name ${req.method} ${authorized ? 'good' : 'bad'} ${req.headers.value('strapikey') != null} $body');
        final res = req.response;
        if (!authorized) {
          res.statusCode = 404;
          res.write('<!DOCTYPE html><div>Oops</div>');
        } else if (name.startsWith('downloadFile/')) {
          res.contentLength = 4;
          res.add([1, 2, 3, 4]);
        } else if (name == 'getUserInfo') {
          res.write(_fixture('user.xml'));
        } else if (name == 'raiseBookDownloadRequest') {
          res.write(_fixture('request-raised.xml'));
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
      expect(secrets.values, {'user': 'tester', 'name': 'EndUser One', 'password': 's3cret pass'});

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
  });
}

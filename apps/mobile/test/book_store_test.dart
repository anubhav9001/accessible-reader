import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:accessible_reader/book_server.dart';
import 'package:accessible_reader/book_store.dart';
import 'package:archive/archive.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

/// Writes a small zipped DAISY-like book to [dir] and returns its path.
String _writeZip(Directory dir, Map<String, String> files) {
  final archive = Archive();
  files.forEach((name, text) => archive.addFile(ArchiveFile.bytes(name, utf8.encode(text))));
  final zip = File(p.join(dir.path, 'book.zip'))..writeAsBytesSync(ZipEncoder().encode(archive));
  return zip.path;
}

void main() {
  late Directory temp;

  setUp(() => temp = Directory.systemTemp.createTempSync('reader_test'));
  tearDown(() => temp.deleteSync(recursive: true));

  test('imports a zipped book, lists its files and remembers it', () async {
    final store = await BookStore.open(Directory(p.join(temp.path, 'books')));
    final zip = _writeZip(temp, {'NCC.HTML': '<html></html>', 'audio/a b.mp3': 'x'});

    final book = await store.import(zip, 'My Book.zip');
    expect(book.title, 'My Book');
    expect((await store.listFiles(book.id))..sort(), ['NCC.HTML', 'audio/a b.mp3']);

    final reopened = await BookStore.open(store.root);
    expect(reopened.books.single.id, book.id);

    await reopened.remove(book.id);
    expect(reopened.books, isEmpty);
    expect(reopened.folder(book.id).existsSync(), isFalse);
  });

  test('rejects a file that is not a zip', () async {
    final store = await BookStore.open(Directory(p.join(temp.path, 'books')));
    final notZip = File(p.join(temp.path, 'notes.txt'))..writeAsStringSync('hello');
    await expectLater(store.import(notZip.path, 'notes.txt'), throwsA(anything));
    expect(store.books, isEmpty);
  });

  test('server serves assets and book files only with its token', () async {
    final store = await BookStore.open(Directory(p.join(temp.path, 'books')));
    final book = await store.import(_writeZip(temp, {'text/ch 1.html': '<p>Hi</p>'}), 'b.zip');
    final server = BookServer(
      booksRoot: store.root.path,
      loadAsset: (asset) async => Uint8List.fromList(utf8.encode('asset:$asset')),
    );
    await server.start();
    final client = HttpClient();
    Future<(int, String)> get(String url) async {
      final res = await (await client.getUrl(Uri.parse(url))).close();
      return (res.statusCode, await res.transform(utf8.decoder).join());
    }

    try {
      expect(await get(server.readerUrl), (200, 'asset:assets/web/reader.html'));
      expect(await get('${server.bookUrl(book.id)}text/ch%201.html'), (200, '<p>Hi</p>'));
      expect((await get('${server.bookUrl(book.id)}missing.html')).$1, 404);

      final wrongToken = server.readerUrl.replaceFirst(server.token, 'nope');
      expect((await get(wrongToken)).$1, 403);
      final escape = '${server.bookUrl(book.id)}..%2F..%2Fbooks.json';
      expect((await get(escape)).$1, 404);
    } finally {
      client.close(force: true);
      await server.stop();
    }
  });
}

import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:path/path.dart' as p;

/// Loads one bundled asset, e.g. 'assets/web/reader.js'.
typedef AssetLoader = Future<Uint8List> Function(String asset);

/// A small HTTP server on the loopback address that feeds the WebView: the reader page
/// from the app's assets, and the open book's files from storage. Every URL starts with
/// a random token, so other apps on the phone cannot read books through it.
class BookServer {
  BookServer({required this.booksRoot, required this.loadAsset});

  final String booksRoot;
  final AssetLoader loadAsset;
  final String token = List.generate(16, (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  HttpServer? _server;

  Future<void> start() async {
    _server ??= await HttpServer.bind(InternetAddress.loopbackIPv4, 0)
      ..listen(_handle);
  }

  Future<void> stop() async {
    await _server?.close(force: true);
    _server = null;
  }

  String get _origin => 'http://127.0.0.1:${_server!.port}/$token';
  String get readerUrl => '$_origin/app/reader.html';
  String bookUrl(String id) => '$_origin/book/$id/';

  static const _types = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html',
    '.xhtml': 'application/xhtml+xml',
    '.xml': 'application/xml',
    '.smil': 'application/smil+xml',
    '.ncx': 'application/xml',
    '.opf': 'application/xml',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };

  Future<void> _handle(HttpRequest request) async {
    final response = request.response;
    response.headers.set('cache-control', 'no-store');
    try {
      final segments = request.uri.pathSegments;
      if (segments.length < 3 || segments[0] != token) return await _status(response, HttpStatus.forbidden);
      final type = _types[p.extension(segments.last).toLowerCase()] ?? 'application/octet-stream';

      if (segments[1] == 'app') {
        final bytes = await loadAsset('assets/web/${segments.skip(2).join('/')}');
        response.headers.set('content-type', type);
        response.add(bytes);
      } else if (segments[1] == 'book' && segments.length >= 4) {
        final bookDir = p.join(booksRoot, segments[2]);
        final file = File(p.joinAll([bookDir, ...segments.skip(3)]));
        if (!p.isWithin(bookDir, file.path) || !await file.exists()) return await _status(response, HttpStatus.notFound);
        response.headers.set('content-type', type);
        response.contentLength = await file.length();
        await response.addStream(file.openRead());
      } else {
        return await _status(response, HttpStatus.notFound);
      }
    } catch (_) {
      response.statusCode = HttpStatus.notFound;
    }
    await response.close();
  }

  Future<void> _status(HttpResponse response, int status) async {
    response.statusCode = status;
    await response.close();
  }
}

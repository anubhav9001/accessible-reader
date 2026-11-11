import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:xml/xml.dart';

import 'app_log.dart';
import 'opds.dart';
import 'sugamya.dart';

// The reader's Sugamya Pustakalaya account: sign-in, download requests and downloads.
// Mirrors the account part of packages/engine/src/sugamya.ts and the desktop's
// main/sugamya-account.ts.

/// The account services (POST only, with the reader's user ID or email and password).
const sugamyaAccountApi = 'https://sugamyapustakalaya.org.in/rest/NALPAPIService';
const sugamyaSite = 'https://sugamyapustakalaya.org.in';

/// Links for the sign-in screen; the library has no API for these.
const sugamyaForgotPassword = sugamyaSite;
const sugamyaJoin = sugamyaSite;

/// Development only: a local stand-in for the library, e.g.
/// `--dart-define=SUGAMYA_TEST_SERVER=http://127.0.0.1:8123` (with `adb reverse`).
const sugamyaTestServer = String.fromEnvironment('SUGAMYA_TEST_SERVER');

/// Format IDs from the API guide's table, for raiseBookDownloadRequest. Keys are lower case.
const _formatIds = {
  'braille': 1,
  'brailledtbook': 2,
  'daisy202': 4,
  'daisy3': 5,
  'daisy audio only': 6,
  'daisy text only': 7,
  'html': 9,
  'latex': 10,
  'odt': 11,
  'rtf': 12,
  'text': 13,
  'word': 14,
  'wordml': 15,
  'xhtml': 16,
  'zedai': 17,
  'formatted braille': 18,
  'hard braille': 19,
  'daisy multimedia': 20,
  'epub audio': 21,
  'epub text only': 22,
  'epub with media overlay': 23,
  'structured epub without proofreading': 24,
  'braille with tactile': 25,
};

/// The format ID the library wants for a download request, from a result's download-format.
int? sugamyaFormatId(String format) => _formatIds[format.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase()];

/// The Authorization header for the reader's user ID (or email) and password.
String sugamyaAuthorization(String user, String password) =>
    'Basic ${base64.encode(utf8.encode('${user.trim()}:$password'))}';

/// Whether a download link is the library's own, over HTTPS, so the reader's password may go with it.
bool isSugamyaDownloadUrl(String url) {
  final uri = Uri.tryParse(url);
  return uri != null && uri.scheme == 'https' && uri.host == 'sugamyapustakalaya.org.in';
}

bool _isNalp(String body) => RegExp(r'<nalp[\s>]').hasMatch(body);

String _text(XmlElement? el, String name) =>
    (el?.childElements.where((e) => e.localName.toLowerCase() == name).firstOrNull?.innerText ?? '')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();

/// The library's own message in a reply (e.g. "Your download request has been registered…").
String? parseSugamyaMessage(String body) {
  if (!_isNalp(body)) return null;
  final root = XmlDocument.parse(body).rootElement;
  final message = _text(root.childElements.where((e) => e.localName == 'message').firstOrNull, 'string');
  return message.isEmpty ? null : message;
}

class SugamyaUser {
  const SugamyaUser(this.name, this.email);
  final String name;
  final String email;
}

/// The reader's details from getUserInfo; null when the reply has none (not signed in).
SugamyaUser? parseSugamyaUser(String body) {
  if (!_isNalp(body)) return null;
  final result = XmlDocument.parse(body).rootElement.descendantElements.where((e) => e.localName == 'result').firstOrNull;
  return result == null ? null : SugamyaUser(_text(result, 'name'), _text(result, 'email'));
}

/// One of the reader's download requests.
class SugamyaRequest {
  const SugamyaRequest({required this.title, required this.format, required this.status, required this.ready, required this.url});

  final String title;
  final String format;

  /// The library's status text, e.g. "Available for Download".
  final String status;

  /// Whether the book can be downloaded now.
  final bool ready;

  /// The download link (needs the reader's sign-in, valid for 7 days); empty until ready.
  final String url;
}

/// The total-results of a list reply, or null when it has none.
int? parseSugamyaTotal(String body) {
  if (!_isNalp(body)) return null;
  return int.tryParse(_text(XmlDocument.parse(body).rootElement, 'total-results'));
}

/// Reads fetchUserDownloadRequests.
List<SugamyaRequest> parseSugamyaRequests(String body) {
  if (!_isNalp(body)) return const [];
  final results = XmlDocument.parse(body).rootElement.descendantElements.where((e) => e.localName == 'result');
  return [
    for (final r in results)
      () {
        final status = _text(r, 'available-to-download');
        final url = _text(r, 'downloadurl');
        final link = RegExp(r'^https?://', caseSensitive: false).hasMatch(url);
        final format = _text(r, 'download-format');
        return SugamyaRequest(
          title: _text(r, 'title').isEmpty ? 'Untitled' : _text(r, 'title'),
          format: RegExp(r'^N/?A$', caseSensitive: false).hasMatch(format) ? sugamyaNotAvailable : format,
          status: status,
          // The app checks the link is the library's own before sending the password with it.
          ready: RegExp('^available', caseSensitive: false).hasMatch(status) && link,
          url: link ? url : '',
        );
      }(),
  ];
}

/// Whether the library took a download request ("Your download request has been registered successfully…").
bool isSugamyaRequestAccepted(String message) => RegExp('registered successfully', caseSensitive: false).hasMatch(message);

/// What Reader adds when the library won't take a request for a copy (its own reply comes first).
const sugamyaRequestRefused =
    "Reader can't get this copy from Sugamya Pustakalaya yet. You can download it on the Sugamya Pustakalaya website, then add it with Add book.";

/// What Reader says when the library doesn't accept the user ID or password.
const sugamyaWrongPassword =
    "Sugamya Pustakalaya didn't accept this user ID or password. Check them, or reset your password on the Sugamya Pustakalaya website.";

/// Whether the library's message means the user ID or password was wrong ("Security Autentication Failed").
bool isSugamyaAuthFailure(String? message) =>
    message != null && RegExp('auth?enti?cation failed', caseSensitive: false).hasMatch(message);

/// What to tell the reader when an account call doesn't give the library's XML reply. A wrong
/// password comes back as XML; the HTML error page (HTTP 404) comes when the library can't
/// handle the request itself (a user ID it doesn't know, a request it can't match to a book).
String sugamyaAccountProblem(String call, int status) {
  if (status == 401 || status == 403) return sugamyaWrongPassword;
  if (call == 'getUserInfo') {
    return status == 404
        ? "Sugamya Pustakalaya didn't recognise this user ID or email. Check it and try again."
        : "Sugamya Pustakalaya couldn't sign you in right now (error $status). Try again later.";
  }
  if (call == 'raiseBookDownloadRequest') {
    return "Sugamya Pustakalaya couldn't take the request for this book (error $status). "
        'Try again later, or ask for it on the Sugamya Pustakalaya website.';
  }
  return "Sugamya Pustakalaya couldn't do this right now (error $status). Try again later.";
}

/// Where the account is kept: the Android Keystore in the app, memory in tests.
abstract class SugamyaSecrets {
  Future<Map<String, String>?> read();
  Future<void> write(Map<String, String> values);
  Future<void> clear();
}

class KeystoreSecrets implements SugamyaSecrets {
  static const _storage = FlutterSecureStorage();
  static const _keys = ['user', 'name', 'password'];

  @override
  Future<Map<String, String>?> read() async {
    try {
      final values = {for (final k in _keys) k: await _storage.read(key: 'sugamya.$k') ?? ''};
      return values['user']!.isEmpty || values['password']!.isEmpty ? null : values;
    } catch (e) {
      // e.g. restored from a backup on another phone, where the key can't be unwrapped.
      AppLog.info('sugamya', 'Saved account could not be read; signing in again.');
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(Map<String, String> values) async {
    for (final e in values.entries) {
      await _storage.write(key: 'sugamya.${e.key}', value: e.value);
    }
  }

  @override
  Future<void> clear() async {
    for (final k in _keys) {
      try {
        await _storage.delete(key: 'sugamya.$k');
      } catch (_) {}
    }
  }
}

class SugamyaAccountInfo {
  const SugamyaAccountInfo(this.user, this.name);
  final String user;
  final String name;
  String get shownName => name.isEmpty ? user : name;
}

/// The reader's account. The library has no tokens, so every request carries the reader's user
/// ID and password; the password stays in the Android Keystore and never goes in the log.
class SugamyaAccount {
  SugamyaAccount({SugamyaSecrets? secrets, String? base, HttpClient? http, this.allowLocal = false})
      : _secrets = secrets ?? KeystoreSecrets(),
        _base = base ?? (sugamyaTestServer.isNotEmpty ? sugamyaTestServer : sugamyaAccountApi),
        _http = http ?? (HttpClient()..connectionTimeout = const Duration(seconds: 20));

  final SugamyaSecrets _secrets;
  final String _base;
  final HttpClient _http;

  /// Tests and the development stand-in: allow downloads from the local server.
  final bool allowLocal;

  SugamyaAccountInfo? _info;
  String _password = '';
  bool _loaded = false;

  bool get _local => allowLocal || sugamyaTestServer.isNotEmpty;

  Future<SugamyaAccountInfo?> info() async {
    if (!_loaded) {
      _loaded = true;
      final saved = await _secrets.read();
      if (saved != null) {
        _info = SugamyaAccountInfo(saved['user']!, saved['name'] ?? '');
        _password = saved['password']!;
      }
    }
    return _info;
  }

  /// Checks the user ID and password with the library and keeps them.
  Future<SugamyaAccountInfo> signIn(String user, String password) async {
    user = user.trim();
    if (user.isEmpty || password.isEmpty) throw const CatalogException('Enter your user ID or email, and your password.');
    final body = await _post('getUserInfo', user: user, password: password);
    final reader = parseSugamyaUser(body);
    if (reader == null) throw CatalogException(parseSugamyaMessage(body) ?? sugamyaAccountProblem('getUserInfo', 404));
    _info = SugamyaAccountInfo(user, reader.name);
    _password = password;
    _loaded = true;
    await _secrets.write({'user': user, 'name': reader.name, 'password': password});
    AppLog.info('sugamya', 'Signed in.');
    return _info!;
  }

  Future<void> signOut() async {
    _info = null;
    _password = '';
    await _secrets.clear();
    AppLog.info('sugamya', 'Signed out.');
  }

  /// Asks the library for a book; returns the library's reply, to show the reader.
  Future<String> requestBook(String bookId, String format) async {
    final formatId = sugamyaFormatId(format);
    if (formatId == null) {
      throw CatalogException("Reader doesn't know Sugamya Pustakalaya's format \"$format\", so it can't ask for this book.");
    }
    final body = await _post('raiseBookDownloadRequest', fields: {'bookId': bookId, 'formatId': '$formatId'});
    final message = parseSugamyaMessage(body);
    AppLog.info('sugamya', 'Requested book $bookId (format $formatId): ${message ?? 'no message'}');
    if (message == null) {
      throw const CatalogException("Sugamya Pustakalaya didn't confirm the request. Check My download requests, or try again later.");
    }
    return message;
  }

  /// Download requests per page, and the most pages Reader fetches (1,000 requests).
  static const requestPage = 50;
  static const requestPagesMax = 20;

  /// Every page of the reader's download requests, not just the first.
  Future<List<SugamyaRequest>> requests() async {
    final all = <SugamyaRequest>[];
    int? total;
    var pages = 0;
    var stopped = '';
    for (var page = 1; page <= requestPagesMax; page++) {
      final body = await _post('fetchUserDownloadRequests', fields: {'page': '$page', 'limit': '$requestPage'});
      final items = parseSugamyaRequests(body);
      pages = page;
      total = parseSugamyaTotal(body) ?? total;
      if (items.isEmpty) break;
      // A library that ignored the page number would send page 1 again: stop rather than repeat it.
      final first = items.first;
      if (page > 1 && all.any((r) => r.title == first.title && r.format == first.format && r.url == first.url)) {
        stopped = '; page $page repeated an earlier page, so Reader stopped';
        break;
      }
      all.addAll(items);
      // A short page is the last; without total-results a full page means "maybe more".
      if (items.length < requestPage || (total != null && all.length >= total)) break;
      if (page == requestPagesMax) stopped = '; stopped after $requestPagesMax pages';
    }
    AppLog.info('sugamya',
        'Download requests: ${all.length} of ${total ?? all.length} in $pages page${pages == 1 ? '' : 's'} (${all.where((r) => r.ready).length} ready)$stopped.');
    return all;
  }

  /// Downloads a ready book to [file], reporting progress (0 to 1, or -1 when the size is unknown).
  Future<void> download(String url, File file, void Function(double fraction) progress) async {
    final allowed = isSugamyaDownloadUrl(url) || (_local && url.startsWith('$_base/'));
    if (!allowed) {
      throw const CatalogException("This download link isn't Sugamya Pustakalaya's own secure link, so Reader won't send your password to it.");
    }
    final request = await _http.getUrl(Uri.parse(url));
    request.headers.set(HttpHeaders.authorizationHeader, _authorization());
    final HttpClientResponse response;
    try {
      response = await request.close().timeout(const Duration(seconds: 60));
    } on Object {
      throw const CatalogException('Could not reach Sugamya Pustakalaya. Check the internet connection and try again.');
    }
    if (response.statusCode != HttpStatus.ok) {
      await response.drain<void>();
      AppLog.info('sugamya', 'Download failed: HTTP ${response.statusCode}.');
      throw CatalogException(response.statusCode == 404 || response.statusCode == 410
          ? 'This download link has expired (links last 7 days). Ask for the book again.'
          : sugamyaAccountProblem('download', response.statusCode));
    }
    final total = response.contentLength;
    var received = 0;
    final sink = file.openWrite();
    try {
      await for (final chunk in response) {
        received += chunk.length;
        sink.add(chunk);
        progress(total > 0 ? received / total : -1);
      }
      await sink.close();
    } catch (e) {
      await sink.close();
      if (await file.exists()) await file.delete();
      AppLog.info('sugamya', 'Download interrupted after $received bytes.');
      throw const CatalogException('The download was interrupted. Check the internet connection and try again.');
    }
    AppLog.info('sugamya', 'Downloaded $received bytes.');
  }

  String _authorization([String? user, String? password]) {
    user ??= _info?.user ?? '';
    password ??= _password;
    if (user.isEmpty || password.isEmpty) throw const CatalogException('Sign in to Sugamya Pustakalaya first.');
    return sugamyaAuthorization(user, password);
  }

  /// An account request: POST with the reader's Authorization header, and the app's key and the
  /// call's fields both as form fields and as headers. The guide lists them all as "name : value",
  /// like the Authorization header, without saying where they go; the key works either way, but
  /// asking for a book with them in the form only gave the library's error page.
  Future<String> _post(String call, {String? user, String? password, Map<String, String> fields = const {}}) async {
    if (sugamyaApiKey.isEmpty) throw const CatalogException("Sugamya Pustakalaya isn't set up in this copy of Reader.");
    final auth = _authorization(user, password);
    final HttpClientResponse response;
    try {
      final request = await _http.postUrl(Uri.parse('$_base/$call'));
      request.headers
        ..set(HttpHeaders.authorizationHeader, auth)
        ..set('strapikey', sugamyaApiKey)
        ..set(HttpHeaders.acceptHeader, 'application/xml')
        ..contentType = ContentType('application', 'x-www-form-urlencoded', charset: 'utf-8');
      fields.forEach(request.headers.set);
      request.write(Uri(queryParameters: {...fields, 'strapikey': sugamyaApiKey}).query);
      response = await request.close().timeout(const Duration(seconds: 30));
    } on Object {
      throw const CatalogException('Could not reach Sugamya Pustakalaya. Check the internet connection and try again.');
    }
    final body = await response.transform(utf8.decoder).join();
    // The library's replies are new to Reader: record what came back (never the request).
    final message = parseSugamyaMessage(body);
    final sent = fields.entries.map((e) => '${e.key}=${e.value}').join(' ');
    AppLog.info('sugamya',
        '$call${sent.isEmpty ? '' : ' ($sent)'}: HTTP ${response.statusCode}, ${_isNalp(body) ? 'XML' : 'not XML'}${message == null ? '' : ', "$message"'}.');
    if (isSugamyaAuthFailure(message)) throw const CatalogException(sugamyaWrongPassword);
    if (response.statusCode != HttpStatus.ok || !_isNalp(body)) throw CatalogException(sugamyaAccountProblem(call, response.statusCode));
    return body;
  }
}

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

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

/// The library's own web addresses, where the reader's password may go (over HTTPS only).
/// library.daisyindia.org is DAISY Forum of India's older address for the same library; it now
/// forwards to sugamyapustakalaya.org.in.
const sugamyaHosts = ['sugamyapustakalaya.org.in', 'www.sugamyapustakalaya.org.in', 'library.daisyindia.org'];

/// Whether a download link is the library's own, over HTTPS, so the reader's password may go with it.
bool isSugamyaDownloadUrl(String url) {
  final uri = Uri.tryParse(url);
  return uri != null && uri.scheme == 'https' && sugamyaHosts.contains(uri.host.toLowerCase()) && uri.userInfo.isEmpty;
}

const _linkProblem = "This download link isn't on Sugamya Pustakalaya's own website, so Reader won't send your password to it. "
    'Download the book on the Sugamya Pustakalaya website, then open it in Reader.';

/// A download link as the app will use it ([url]), or why it can't ([problem]); [shape] is the
/// link without its file name (scheme, host, the first part of the path), safe for the log.
class SugamyaDownloadLink {
  const SugamyaDownloadLink({this.url, this.problem, required this.shape});

  final Uri? url;
  final String? problem;
  final String shape;
}

/// Makes a download link from fetchUserDownloadRequests usable: a link relative to the site is
/// made whole, spaces are encoded, and http on the library's own host becomes https (the site
/// answers only https). FTP links (as in the API guide's example) and other hosts get a problem.
SugamyaDownloadLink sugamyaDownloadLink(String raw) {
  final text = raw.trim();
  if (text.isEmpty) {
    return const SugamyaDownloadLink(
        problem: 'Sugamya Pustakalaya has not given a download link for this book yet. Try again later.', shape: '(none)');
  }
  Uri uri;
  try {
    uri = Uri.parse('$sugamyaSite/').resolveUri(Uri.parse(Uri.encodeFull(text)));
  } on FormatException {
    return const SugamyaDownloadLink(problem: _linkProblem, shape: '(not a link)');
  }
  final host = uri.host.toLowerCase();
  final shape = '${uri.scheme}://${uri.hasPort ? '${uri.host}:${uri.port}' : uri.host}'
      // Without the file name.
      '${uri.pathSegments.length < 2 ? '' : '/${uri.pathSegments.take(math.min(3, uri.pathSegments.length - 1)).join('/')}'}/…';
  if (uri.scheme == 'http' && sugamyaHosts.contains(host)) uri = uri.replace(scheme: 'https');
  if (uri.scheme == 'ftp') {
    return SugamyaDownloadLink(
        problem: "Sugamya Pustakalaya gave an FTP link for this book, which Reader can't download. "
            'Download it on the Sugamya Pustakalaya website, then open it in Reader.',
        shape: shape);
  }
  if (!isSugamyaDownloadUrl(uri.toString())) return SugamyaDownloadLink(problem: _linkProblem, shape: shape);
  return SugamyaDownloadLink(url: uri, shape: shape);
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
  const SugamyaRequest({
    required this.title,
    required this.format,
    required this.status,
    required this.ready,
    required this.url,
    this.state = SugamyaRequestState.unknown,
    this.bookId,
    this.askedAt,
  });

  final String title;
  final String format;

  /// The library's status text, e.g. "Available for Download".
  final String status;

  /// Whether the book can be downloaded now.
  final bool ready;

  /// The download link (needs the reader's sign-in, valid for 7 days); empty until ready.
  final String url;

  /// What Reader makes of it ([sugamyaRequestsWithState]); the library's list alone doesn't say.
  final SugamyaRequestState state;

  /// The book's ID, when Reader asked for it (the library's list leaves it out).
  final String? bookId;

  /// When Reader asked for it, if it did.
  final DateTime? askedAt;

  SugamyaRequest withState(SugamyaRequestState state, SugamyaAsked? asked) => SugamyaRequest(
      title: title, format: format, status: status, ready: ready, url: url, state: state, bookId: asked?.bookId, askedAt: asked?.at);
}

/// How long the library's download links last, in days.
const sugamyaLinkDays = 7;

/// Formats the library makes as soon as it's asked (seconds, not hours), so Reader downloads the
/// book at once and asks again by itself when a link has expired. DFI confirmed (November 2026):
/// every text-only format is ready at once; any format with audio (6, 20, 21, 23) takes time.
/// DAISY 2.02 (4) and DAISY 3 (5) may hold audio, so they count as taking time too. As in the engine.
const _instantFormatIds = {1, 2, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 22, 24, 25};

bool isSugamyaInstantFormat(String format) => _instantFormatIds.contains(sugamyaFormatId(format));

/// ready: has a link. renew: an instant format without a link (it expired): Reader asks again
/// and downloads. preparing: Reader asked less than 7 days ago. expired: Reader asked more than
/// 7 days ago and there's no link. unknown: no link, and Reader doesn't know when it was asked.
enum SugamyaRequestState { ready, renew, preparing, expired, unknown }

/// A request Reader made, remembered because the library's list has no date or book ID.
class SugamyaAsked {
  const SugamyaAsked({required this.title, required this.format, required this.bookId, required this.at});

  factory SugamyaAsked.fromJson(Map<String, dynamic> j) => SugamyaAsked(
      title: j['title'] as String,
      format: j['format'] as String,
      bookId: j['bookId'] as String,
      at: DateTime.fromMillisecondsSinceEpoch(j['at'] as int));

  final String title;
  final String format;
  final String bookId;
  final DateTime at;

  Map<String, dynamic> toJson() => {'title': title, 'format': format, 'bookId': bookId, 'at': at.millisecondsSinceEpoch};
}

String _norm(String text) => text.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase();
String _requestKey(String title, String format) => '${_norm(title)}|${_norm(format)}';

/// Adds Reader's view to the library's list, and keeps one entry per book and format (asking
/// again adds a new entry beside the expired one): the ready one if there is one.
List<SugamyaRequest> sugamyaRequestsWithState(List<SugamyaRequest> items, List<SugamyaAsked> asked, DateTime now) {
  final latest = <String, SugamyaAsked>{};
  for (final a in asked) {
    final key = _requestKey(a.title, a.format);
    if (latest[key] == null || latest[key]!.at.isBefore(a.at)) latest[key] = a;
  }
  final kept = <String, SugamyaRequest>{};
  for (final r in items) {
    final key = _requestKey(r.title, r.format);
    final had = kept[key];
    if (had != null && (had.ready || !r.ready)) continue;
    final a = latest[key];
    // A status other than "Available…" (e.g. "Queued") means the library is still working on it.
    // An expired link leaves no status at all (and "NA" for the link).
    final status = r.status.trim();
    final working = !r.ready && status.isNotEmpty && !RegExp('^available', caseSensitive: false).hasMatch(status);
    final state = r.ready
        ? SugamyaRequestState.ready
        : working
            ? SugamyaRequestState.preparing
            : isSugamyaInstantFormat(r.format)
                ? SugamyaRequestState.renew
                : a == null
                    ? SugamyaRequestState.unknown
                    : now.difference(a.at) > const Duration(days: sugamyaLinkDays)
                        ? SugamyaRequestState.expired
                        : SugamyaRequestState.preparing;
    // A Dart map keeps a key's first position when it is set again.
    kept[key] = r.withState(state, a);
  }
  return kept.values.toList();
}

/// The requests Reader still needs to remember: a link can't outlive 7 days, so 30 is plenty.
List<SugamyaAsked> sugamyaAskedToKeep(List<SugamyaAsked> asked, DateTime now) {
  final kept = asked.where((a) => now.difference(a.at) < const Duration(days: 30)).toList();
  return kept.length > 200 ? kept.sublist(kept.length - 200) : kept;
}

/// The book in search results with exactly this title, if there's only one.
SugamyaBook? sugamyaBookByTitle(List<SugamyaBook> books, String title) {
  final same = books.where((b) => _norm(b.title) == _norm(title)).toList();
  return same.length == 1 ? same.single : null;
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
  static const _keys = ['user', 'name', 'password', 'asked'];

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

  /// Books asked for in Reader (the library's list has no date or book ID).
  List<SugamyaAsked> _asked = [];

  bool get _local => allowLocal || sugamyaTestServer.isNotEmpty;

  Future<SugamyaAccountInfo?> info() async {
    if (!_loaded) {
      _loaded = true;
      final saved = await _secrets.read();
      if (saved != null) {
        _info = SugamyaAccountInfo(saved['user']!, saved['name'] ?? '');
        _password = saved['password']!;
        try {
          final asked = saved['asked'] ?? '';
          _asked = asked.isEmpty ? [] : [for (final a in jsonDecode(asked) as List) SugamyaAsked.fromJson(a as Map<String, dynamic>)];
        } on Object {
          _asked = [];
        }
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
    final sameReader = _info?.user == user;
    _info = SugamyaAccountInfo(user, reader.name);
    _password = password;
    _loaded = true;
    if (!sameReader) _asked = [];
    await _secrets.write({'user': user, 'name': reader.name, 'password': password, 'asked': jsonEncode(_asked)});
    AppLog.info('sugamya', 'Signed in.');
    return _info!;
  }

  Future<void> signOut() async {
    _info = null;
    _password = '';
    _asked = [];
    await _secrets.clear();
    AppLog.info('sugamya', 'Signed out.');
  }

  /// Asks the library for a book; returns the library's reply, to show the reader.
  Future<String> requestBook(String bookId, String format, {String title = ''}) async {
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
    if (title.isNotEmpty && _info != null && isSugamyaRequestAccepted(message)) {
      final now = DateTime.now();
      _asked = sugamyaAskedToKeep([..._asked, SugamyaAsked(title: title, format: format, bookId: bookId, at: now)], now);
      try {
        await _secrets.write({'asked': jsonEncode(_asked)});
      } on Object {
        // Remembering is a help, not a must.
      }
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
    return sugamyaRequestsWithState(all, _asked, DateTime.now());
  }

  /// Downloads a ready book to [file], reporting progress (bytes so far, and the total or 0 when unknown).
  Future<void> download(String url, File file, void Function(int received, int total) progress) async {
    final link = _local && url.startsWith('$_base/')
        ? SugamyaDownloadLink(url: Uri.parse(url), shape: 'test server')
        : sugamyaDownloadLink(url);
    if (link.url == null) {
      AppLog.info('sugamya', 'Download link refused: ${link.shape}');
      throw CatalogException(link.problem!);
    }
    AppLog.info('sugamya', 'Download link: ${link.shape}');
    final request = await _http.getUrl(link.url!);
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
        progress(received, total > 0 ? total : 0);
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

Set<String> _titleWords(String title) =>
    title.toLowerCase().split(RegExp(r'[^\p{L}\p{M}\p{N}]+', unicode: true)).where((w) => w.length > 3).toSet();

/// Whether the book the library sent looks like a different book from the one asked for: fewer
/// than half the longer words shared. Sugamya Pustakalaya once sent "The Social Construction of
/// Reality" for "THE Social Dimensions OF Early Buddhism".
bool sugamyaTitlesDiffer(String asked, String got) {
  final a = _titleWords(asked);
  final b = _titleWords(got);
  if (a.isEmpty || b.isEmpty) return false;
  return b.where(a.contains).length / (a.length < b.length ? a.length : b.length) < 0.5;
}

/// What Reader says when the library sent a different book.
String sugamyaWrongBookNote(String asked, String got) =>
    'Sugamya Pustakalaya sent "$got", not "$asked", which you asked for. You may want to tell the library.';

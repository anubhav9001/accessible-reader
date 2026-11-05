import 'package:xml/xml.dart';

import 'opds.dart';

// Sugamya Pustakalaya, India's accessible online library (DAISY Forum of India), through its
// NALP API. Mirrors packages/engine/src/sugamya.ts, which the desktop app uses.

const sugamyaName = 'Sugamya Pustakalaya';
const sugamyaApi = 'https://sugamyapustakalaya.org.in/rest/NALPAPIService/getNALPData';
const sugamyaPageSize = 20;

/// Shown for a detail the library marks as not available (NA or N/A).
const sugamyaNotAvailable = 'Not available';

/// Built in at build time: `flutter build apk --dart-define-from-file=../../config.local.json`.
/// config.local.json stays on the build PC; git ignores it.
const sugamyaApiKey = String.fromEnvironment('SUGAMYA_API_KEY');

class SugamyaBook {
  const SugamyaBook({
    required this.id,
    required this.title,
    required this.author,
    required this.publisher,
    required this.synopsis,
    required this.format,
    required this.size,
    required this.language,
    required this.isbn,
  });

  final String id;
  final String title;
  final String author;
  final String publisher;
  final String synopsis;

  /// e.g. "DAISY Audio Only", "daisy3"; empty in search results.
  final String format;
  final String size;
  final String language;
  final String isbn;

  /// "Author. Language. Format" for a list entry, saying which of them are not available.
  String get detail => [
        author == sugamyaNotAvailable ? 'Author not available' : author,
        language == sugamyaNotAvailable ? 'Language not available' : language,
        format == sugamyaNotAvailable ? 'Format not available' : (format.isEmpty ? '' : sugamyaFormatLabel(format)),
      ].map((s) => s.replaceAll(RegExp(r'\.+$'), '')).where((s) => s.isNotEmpty).join('. ');

  /// The author line of the book's details.
  String get byLine => author == sugamyaNotAvailable ? 'Author: $sugamyaNotAvailable' : 'By $author';
}

class SugamyaPage<T> {
  const SugamyaPage(this.items, this.total, {this.message});

  final List<T> items;
  final int total;
  final String? message;
}

/// What can be asked of the library.
sealed class SugamyaQuery {
  const SugamyaQuery();
  String path(int page);
}

class SugamyaSearch extends SugamyaQuery {
  const SugamyaSearch(this.terms);
  final String terms;
  @override
  String path(int page) => 'authortitle/${Uri.encodeComponent(terms.trim())}/${_tail(page)}';
}

class SugamyaLatest extends SugamyaQuery {
  const SugamyaLatest();
  @override
  String path(int page) => 'latest/${_tail(page)}';
}

/// Categories (or, with [grades], school grades): a list of names, not books.
class SugamyaNames extends SugamyaQuery {
  const SugamyaNames({this.grades = false});
  final bool grades;
  @override
  String path(int page) => '${grades ? 'gradelist' : 'categorylist'}/${_tail(page)}';
}

class SugamyaIn extends SugamyaQuery {
  const SugamyaIn(this.name, {this.grade = false});
  final String name;
  final bool grade;
  @override
  String path(int page) => '${grade ? 'grade' : 'category'}/${Uri.encodeComponent(name.trim())}/${_tail(page)}';
}

String _tail(int page) => 'page/$page/limit/$sugamyaPageSize/format/xml';

String _text(XmlElement el, String name) =>
    (el.childElements.where((e) => e.localName == name).firstOrNull?.innerText ?? '').replaceAll(RegExp(r'\s+'), ' ').trim();

/// A book detail: empty when not given, "Not available" when the library says NA or N/A.
String _detail(XmlElement el, String name) {
  final value = _text(el, name);
  return RegExp(r'^N/?A$', caseSensitive: false).hasMatch(value) ? sugamyaNotAvailable : value;
}

({List<XmlElement> results, int total, String? message}) _parse(String body) {
  final root = XmlDocument.parse(body).rootElement;
  final results = root.descendantElements.where((e) => e.localName == 'result').toList();
  final message = root.childElements.where((e) => e.localName == 'message').map((m) => _text(m, 'string')).firstOrNull;
  final total = int.tryParse(_text(root, 'total-results')) ?? results.length;
  return (results: results, total: total, message: results.isEmpty ? message : null);
}

SugamyaPage<SugamyaBook> parseSugamyaBooks(String body) {
  final r = _parse(body);
  final books = [
    for (final e in r.results)
      if (_text(e, 'id').isNotEmpty)
        SugamyaBook(
          id: _text(e, 'id'),
          title: _text(e, 'title').isEmpty ? 'Untitled' : _text(e, 'title'),
          author: _detail(e, 'author'),
          publisher: _detail(e, 'publisher'),
          synopsis: _detail(e, 'brief-synopsis'),
          format: _detail(e, 'download-format'),
          // A size of 0 means the library doesn't know it.
          size: RegExp(r'^0\s*\w*$').hasMatch(_text(e, 'dtbook-size')) ? sugamyaNotAvailable : _detail(e, 'dtbook-size'),
          language: _detail(e, 'language'),
          isbn: _detail(e, 'isbn13'),
        ),
  ];
  return SugamyaPage(books, r.total, message: r.message);
}

SugamyaPage<String> parseSugamyaNames(String body) {
  final r = _parse(body);
  return SugamyaPage([for (final e in r.results) if (_text(e, 'title').isNotEmpty) _text(e, 'title')], r.total,
      message: r.message);
}

/// Whether Reader can open a Sugamya download format (DAISY and EPUB, not braille or Word).
bool sugamyaFormatReadable(String format) =>
    RegExp('daisy|epub', caseSensitive: false).hasMatch(format) && !RegExp('braille', caseSensitive: false).hasMatch(format);

String sugamyaFormatLabel(String format) =>
    const {'daisy3': 'DAISY 3', 'daisy202': 'DAISY 2.02', 'zedai': 'ZedAI', 'wordml': 'Word'}[format.toLowerCase()] ?? format;

/// Requests to the library, with the app's key added; uses the catalogue client's retries.
class SugamyaClient {
  SugamyaClient(this._client);

  final CatalogClient _client;

  bool get available => sugamyaApiKey.isNotEmpty;

  Future<String> _get(String path) async {
    if (!available) throw const CatalogException("Sugamya Pustakalaya isn't set up in this copy of Reader.");
    final body = await _client.text('$sugamyaApi/$path?API_key=${Uri.encodeQueryComponent(sugamyaApiKey)}',
        'application/xml');
    if (body.contains("Don't have access")) {
      throw const CatalogException("Sugamya Pustakalaya didn't allow this request.");
    }
    return body;
  }

  Future<SugamyaPage<SugamyaBook>> books(SugamyaQuery query, int page) async =>
      parseSugamyaBooks(await _get(query.path(page)));

  Future<SugamyaPage<String>> names(SugamyaNames query, int page) async =>
      parseSugamyaNames(await _get(query.path(page)));

  Future<SugamyaBook?> book(String id) async =>
      parseSugamyaBooks(await _get('id/${Uri.encodeComponent(id)}/page/1/limit/1/format/xml')).items.firstOrNull;
}

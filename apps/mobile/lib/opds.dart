import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:xml/xml.dart';

// OPDS 1.x catalogue feeds. Mirrors packages/engine/src/opds.ts, which the desktop app
// uses; the mobile library screen has no WebView to run the shared engine in.

const _acquisition = 'http://opds-spec.org/acquisition';
final _opdsFeed = RegExp('application/atom\\+xml', caseSensitive: false);

class Catalog {
  const Catalog({required this.id, required this.name, required this.url, this.searchTemplate});

  final String id;
  final String name;
  final String url;

  /// Search URL with a {searchTerms} placeholder.
  final String? searchTemplate;
}

const builtInCatalogs = [
  Catalog(
    id: 'gutenberg',
    name: 'Project Gutenberg',
    url: 'https://www.gutenberg.org/ebooks.opds/',
    searchTemplate: 'https://www.gutenberg.org/ebooks/search.opds/?query={searchTerms}',
  ),
];

class OpdsLink {
  const OpdsLink({required this.href, this.rel, this.type, this.title, this.length});

  final String href;
  final String? rel;
  final String? type;
  final String? title;
  final int? length;
}

class OpdsEntry {
  const OpdsEntry({
    required this.title,
    required this.authors,
    this.summary,
    this.language,
    required this.acquisitions,
    this.navigation,
  });

  final String title;
  final List<String> authors;
  final String? summary;
  final String? language;
  final List<OpdsLink> acquisitions;
  final OpdsLink? navigation;
}

class OpdsFeed {
  const OpdsFeed({required this.title, required this.entries, this.next});

  final String title;
  final List<OpdsEntry> entries;
  final String? next;
}

/// Plain HTTP is upgraded: Android refuses it, and catalogue traffic should not travel in the clear.
String secureUrl(String url) {
  final uri = Uri.parse(url);
  return uri.scheme == 'http' && !const ['127.0.0.1', 'localhost'].contains(uri.host)
      ? uri.replace(scheme: 'https').toString()
      : url;
}

String searchUrl(String template, String terms) => template
    .replaceFirst('{searchTerms}', Uri.encodeComponent(terms.trim()))
    .replaceAll(RegExp(r'\{[^}]+\?\}'), '');

String _text(XmlElement? el) => (el?.innerText ?? '').replaceAll(RegExp(r'\s+'), ' ').trim();

Iterable<XmlElement> _children(XmlElement el, String name) => el.childElements.where((e) => e.localName == name);

OpdsLink? _link(XmlElement el, Uri base) {
  final href = el.getAttribute('href');
  if (href == null || href.startsWith('data:')) return null;
  return OpdsLink(
    href: secureUrl(base.resolve(href).toString()),
    rel: el.getAttribute('rel'),
    type: el.getAttribute('type'),
    title: el.getAttribute('title'),
    length: int.tryParse(el.getAttribute('length') ?? ''),
  );
}

OpdsFeed parseOpdsFeed(String body, String feedUrl) {
  final feed = XmlDocument.parse(body).rootElement;
  final base = Uri.parse(feedUrl);
  final feedLinks = [for (final l in _children(feed, 'link')) ?_link(l, base)];

  final entries = [
    for (final entry in _children(feed, 'entry'))
      () {
        final links = [for (final l in _children(entry, 'link')) ?_link(l, base)];
        final content = _children(entry, 'summary').firstOrNull ?? _children(entry, 'content').firstOrNull;
        final language = _text(entry.descendantElements.where((e) => e.localName == 'language').firstOrNull);
        return OpdsEntry(
          title: _text(_children(entry, 'title').firstOrNull),
          authors: [
            for (final a in _children(entry, 'author'))
              if (_text(_children(a, 'name').firstOrNull).isNotEmpty) _text(_children(a, 'name').firstOrNull)
          ],
          summary: _text(content).isEmpty ? null : _text(content),
          language: language.isEmpty ? null : language,
          acquisitions: [for (final l in links) if (l.rel?.startsWith(_acquisition) ?? false) l],
          navigation: links
              .where((l) => _opdsFeed.hasMatch(l.type ?? '') && l.rel != 'self' && l.rel != 'alternate')
              .firstOrNull,
        );
      }(),
  ];

  return OpdsFeed(
    title: _text(_children(feed, 'title').firstOrNull),
    entries: entries,
    next: feedLinks.where((l) => l.rel == 'next').firstOrNull?.href,
  );
}

/// 0 for formats the reader cannot open; higher is better (EPUB 3 with images first).
int _score(OpdsLink l) {
  final label = '${l.title ?? ''} ${l.href}'.toLowerCase();
  final type = (l.type ?? '').toLowerCase();
  if (type.contains('epub+zip')) {
    return 10 + (label.contains('epub3') ? 2 : 0) + (RegExp('noimages|no images').hasMatch(label) ? 0 : 1);
  }
  return RegExp('zip|daisy').hasMatch(type) ? 5 : 0;
}

/// The best download in a feed; a book's own feed may list several editions as separate entries.
({OpdsEntry entry, OpdsLink link})? bestDownload(OpdsFeed feed) {
  ({OpdsEntry entry, OpdsLink link})? best;
  for (final entry in feed.entries) {
    for (final link in entry.acquisitions) {
      if (_score(link) > 0 && (best == null || _score(link) > _score(best.link))) best = (entry: entry, link: link);
    }
  }
  return best;
}

/// A catalogue request that failed, with a message fit to show the reader.
class CatalogException implements Exception {
  const CatalogException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Catalogue requests are HTTPS only and happen only when the reader asks for them.
class CatalogClient {
  CatalogClient({
    String userAgent = 'AccessibleReader/0.1 (mobile)',
    this.retryDelay = const Duration(seconds: 2),
    this.httpsOnly = true,
  }) : _client = HttpClient()
          ..userAgent = userAgent
          ..connectionTimeout = const Duration(seconds: 20);

  final HttpClient _client;

  /// Wait before the first retry; doubled before the second.
  final Duration retryDelay;

  /// Always true in the app; tests turn it off to use a local HTTP server.
  final bool httpsOnly;

  /// "Busy" answers that are usually gone a moment later.
  static const _busy = {HttpStatus.badGateway, HttpStatus.serviceUnavailable, HttpStatus.gatewayTimeout};

  Future<HttpClientResponse> _get(String url, String accept) async {
    final uri = Uri.parse(url);
    if (httpsOnly && uri.scheme != 'https') throw const CatalogException('Only secure (HTTPS) catalogues can be used.');
    for (var attempt = 0;; attempt++) {
      try {
        final request = await _client.getUrl(uri);
        request.headers.set(HttpHeaders.acceptHeader, accept);
        final response = await request.close().timeout(const Duration(seconds: 30));
        if (response.statusCode == HttpStatus.ok) return response;
        await response.drain<void>();
        if (!_busy.contains(response.statusCode) || attempt == 2) {
          throw CatalogException(_busy.contains(response.statusCode)
              ? 'The library is busy right now (error ${response.statusCode}). Please try again in a minute.'
              : 'The library answered with an error (${response.statusCode}).');
        }
      } on SocketException {
        if (attempt == 2) throw const CatalogException('Could not reach the library. Check the internet connection.');
      } on TimeoutException {
        if (attempt == 2) throw const CatalogException('The library took too long to answer. Please try again.');
      }
      await Future<void>.delayed(retryDelay * (attempt + 1));
    }
  }

  /// Any text resource, with the same retries (used for Sugamya Pustakalaya).
  Future<String> text(String url, String accept) async {
    final response = await _get(url, accept);
    return response.transform(utf8.decoder).join();
  }

  Future<OpdsFeed> feed(String url) async {
    final response = await _get(url, 'application/atom+xml, application/xml;q=0.9, */*;q=0.5');
    return parseOpdsFeed(await response.transform(utf8.decoder).join(), url);
  }

  /// Downloads a book to [file].
  Future<void> download(String url, File file) async {
    final response = await _get(url, 'application/epub+zip, application/zip;q=0.9, */*;q=0.5');
    await response.pipe(file.openWrite());
  }

  void close() => _client.close();
}

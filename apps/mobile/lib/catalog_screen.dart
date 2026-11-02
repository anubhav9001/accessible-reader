import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'book_store.dart';
import 'opds.dart';

/// Browses one page of an online catalogue: categories, search results, or a single
/// book's details with "Download and open". Each further page opens as a new screen,
/// so the system back gesture goes back through the catalogue.
class CatalogScreen extends StatefulWidget {
  const CatalogScreen({
    super.key,
    required this.catalog,
    required this.url,
    required this.client,
    required this.store,
    required this.onBook,
  });

  final Catalog catalog;
  final String url;
  final CatalogClient client;
  final BookStore store;

  /// Opens a downloaded book.
  final Future<void> Function(StoredBook book) onBook;

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  OpdsFeed? _feed;
  final _entries = <OpdsEntry>[];
  String? _next;
  String? _error;
  bool _loadingMore = false;
  bool _downloading = false;

  @override
  void initState() {
    super.initState();
    _load(widget.url);
  }

  void _announce(String message) {
    if (mounted) SemanticsService.sendAnnouncement(View.of(context), message, TextDirection.ltr);
  }

  Future<void> _load(String url) async {
    try {
      final feed = await widget.client.feed(url);
      if (!mounted) return;
      setState(() {
        _feed ??= feed;
        _entries.addAll(feed.entries.where((e) => e.navigation != null || e.acquisitions.isNotEmpty));
        _next = feed.next;
        _error = null;
      });
      _announce(bestDownload(feed) != null ? 'Book details' : '${_entries.length} items');
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not load the library: $e');
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _open(String url) {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => CatalogScreen(
        catalog: widget.catalog,
        url: url,
        client: widget.client,
        store: widget.store,
        onBook: widget.onBook,
      ),
    ));
  }

  Future<void> _search() async {
    final controller = TextEditingController();
    final terms = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Search ${widget.catalog.name}'),
        content: TextField(
          controller: controller,
          autofocus: true,
          textInputAction: TextInputAction.search,
          decoration: const InputDecoration(labelText: 'Title, author or subject'),
          onSubmitted: (v) => Navigator.pop(context, v),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Search')),
        ],
      ),
    );
    if (terms == null || terms.trim().isEmpty) return;
    _open(searchUrl(widget.catalog.searchTemplate!, terms));
  }

  Future<void> _download(OpdsEntry entry, OpdsLink link) async {
    setState(() => _downloading = true);
    _announce('Downloading ${entry.title}');
    final temp = await getTemporaryDirectory();
    final file = File(p.join(temp.path, 'download-${DateTime.now().microsecondsSinceEpoch}.epub'));
    try {
      await widget.client.download(link.href, file);
      final book = await widget.store.import(file.path, '${entry.title}.epub');
      if (entry.authors.isNotEmpty) {
        book.authors = entry.authors;
        await widget.store.save();
      }
      if (!mounted) return;
      Navigator.of(context).popUntil((route) => route.isFirst);
      await widget.onBook(book);
    } catch (e) {
      if (!mounted) return;
      setState(() => _downloading = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Download failed: $e')));
    } finally {
      if (await file.exists()) await file.delete();
    }
  }

  @override
  Widget build(BuildContext context) {
    final feed = _feed;
    final download = feed == null ? null : bestDownload(feed);
    return Scaffold(
      appBar: AppBar(
        title: Text(download?.entry.title ?? feed?.title ?? widget.catalog.name, overflow: TextOverflow.ellipsis),
        actions: [
          if (widget.catalog.searchTemplate != null)
            IconButton(tooltip: 'Search ${widget.catalog.name}', icon: const Icon(Icons.search), onPressed: _search),
        ],
      ),
      body: _error != null
          ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!)))
          : feed == null
              ? const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading'))
              : download != null
                  ? _bookDetails(download.entry, download.link)
                  : _list(),
    );
  }

  Widget _list() {
    if (_entries.isEmpty) return const Center(child: Text('Nothing found.'));
    return ListView.builder(
      itemCount: _entries.length + (_next != null ? 1 : 0),
      itemBuilder: (context, i) {
        if (i == _entries.length) {
          return ListTile(
            title: Text(_loadingMore ? 'Loading more…' : 'More results'),
            onTap: _loadingMore
                ? null
                : () {
                    setState(() => _loadingMore = true);
                    _load(_next!);
                  },
          );
        }
        final entry = _entries[i];
        final detail = entry.authors.isNotEmpty ? entry.authors.join(', ') : entry.summary;
        return ListTile(
          title: Text(entry.title),
          subtitle: detail == null ? null : Text(detail, maxLines: 2, overflow: TextOverflow.ellipsis),
          onTap: entry.navigation == null ? null : () => _open(entry.navigation!.href),
        );
      },
    );
  }

  Widget _bookDetails(OpdsEntry entry, OpdsLink link) {
    final size = link.length == null ? '' : ' (${(link.length! / 1024).round().clamp(1, 1 << 30)} KB)';
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(entry.title, style: Theme.of(context).textTheme.headlineSmall),
        if (entry.authors.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text('By ${entry.authors.join(', ')}')),
        if (entry.language != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text('Language: ${entry.language}')),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: FilledButton.icon(
            onPressed: _downloading ? null : () => _download(entry, link),
            icon: _downloading
                ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.download),
            label: Text(_downloading ? 'Downloading…' : 'Download and open$size'),
          ),
        ),
        if (entry.summary != null) Text(entry.summary!),
      ],
    );
  }
}

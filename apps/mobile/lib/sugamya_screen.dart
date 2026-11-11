import 'package:flutter/material.dart';

import 'announcer.dart';
import 'opds.dart';
import 'sugamya.dart';
import 'sugamya_account.dart';
import 'sugamya_account_screen.dart';

/// Sugamya Pustakalaya's start page: search, and ways to browse.
class SugamyaStartScreen extends StatefulWidget {
  const SugamyaStartScreen({super.key, required this.services});

  final SugamyaServices services;

  @override
  State<SugamyaStartScreen> createState() => _SugamyaStartScreenState();
}

class _SugamyaStartScreenState extends State<SugamyaStartScreen> {
  SugamyaAccountInfo? _account;

  SugamyaServices get services => widget.services;
  SugamyaClient get client => services.client;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final account = await services.account.info();
    if (mounted) setState(() => _account = account);
  }

  /// Opens a screen; the account may have changed when the reader comes back.
  Future<void> _open(BuildContext context, Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
    await _refresh();
  }

  Future<void> _search(BuildContext context) async {
    final controller = TextEditingController();
    final terms = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Search Sugamya Pustakalaya'),
        content: TextField(
          controller: controller,
          autofocus: true,
          textInputAction: TextInputAction.search,
          decoration: const InputDecoration(labelText: 'Title or author'),
          onSubmitted: (v) => Navigator.pop(context, v),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Search')),
        ],
      ),
    );
    if (terms == null || terms.trim().isEmpty || !context.mounted) return;
    _open(context, SugamyaListScreen(services: services, title: 'Search results for ${terms.trim()}', query: SugamyaSearch(terms)));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text(sugamyaName),
          actions: [
            IconButton(tooltip: 'Search Sugamya Pustakalaya', icon: const Icon(Icons.search), onPressed: () => _search(context)),
          ],
        ),
        body: ListView(
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text("India's accessible online library, from DAISY Forum of India. "
                  'Search by title or author with the Search button, or browse below.'),
            ),
            ListTile(
              title: const Text('Search by title or author'),
              leading: const Icon(Icons.search),
              onTap: () => _search(context),
            ),
            ListTile(
              title: const Text('Categories'),
              subtitle: const Text('Books by subject'),
              onTap: () => _open(context, SugamyaListScreen(services: services, title: 'Categories', query: const SugamyaNames())),
            ),
            ListTile(
              title: const Text('School books by grade'),
              subtitle: const Text('From pre-kindergarten upwards'),
              onTap: () =>
                  _open(context, SugamyaListScreen(services: services, title: 'Grades', query: const SugamyaNames(grades: true))),
            ),
            ListTile(
              title: const Text('Popular books'),
              subtitle: const Text('Downloaded $sugamyaPopularTimes times or more in the past year'),
              onTap: () => _open(context, SugamyaListScreen(services: services, title: 'Popular books', query: SugamyaPopular())),
            ),
            ListTile(
              title: const Text('Latest books'),
              subtitle: const Text('Added in the last 15 days'),
              onTap: () => _open(context, SugamyaListScreen(services: services, title: 'Latest books', query: const SugamyaLatest())),
            ),
            ListTile(
              title: const Text('My download requests'),
              subtitle: Text(_account == null ? 'Sign in first' : 'Books you asked for, and downloading them'),
              onTap: () => _open(context, _account == null ? SugamyaSignInScreen(services: services) : SugamyaRequestsScreen(services: services)),
            ),
            ListTile(
              title: Text(_account == null ? 'Sign in' : 'Your account'),
              subtitle: Text(_account == null
                  ? 'With your Sugamya Pustakalaya user ID or email, to download books'
                  : 'Signed in as ${_account!.shownName}'),
              onTap: () => _open(context, SugamyaSignInScreen(services: services)),
            ),
          ],
        ),
      );
}

/// A list of books, or of category or grade names, one page at a time.
class SugamyaListScreen extends StatefulWidget {
  const SugamyaListScreen({super.key, required this.services, required this.title, required this.query});

  final SugamyaServices services;
  SugamyaClient get client => services.client;
  final String title;
  final SugamyaQuery query;

  @override
  State<SugamyaListScreen> createState() => _SugamyaListScreenState();
}

class _SugamyaListScreenState extends State<SugamyaListScreen> {
  final _announcer = Announcer();
  final _books = <SugamyaBook>[];
  final _names = <String>[];
  int _page = 0;
  int _total = 0;
  bool _loading = true;
  String? _error;

  bool get _isNames => widget.query is SugamyaNames;
  int get _count => _isNames ? _names.length : _books.length;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _announcer.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = _page + 1;
      final query = widget.query;
      if (query is SugamyaNames) {
        final result = await widget.client.names(query, page);
        _names.addAll(result.items);
        _total = result.total;
      } else {
        final result = await widget.client.books(query, page);
        _books.addAll(result.items);
        _total = result.total;
        _fillFormats(result.items.where((b) => b.format.isEmpty).map((b) => b.id).toList());
      }
      _page = page;
      if (!mounted) return;
      setState(() => _loading = false);
      _announcer.say(context, _count == 0 ? _emptyText : '${widget.title}: $_total ${_isNames ? 'items' : 'books'}');
    } catch (e) {
      if (!mounted) return;
      final message = e is CatalogException ? e.message : 'Could not load the library: $e';
      setState(() {
        _loading = false;
        if (_count == 0) _error = message;
      });
      if (_count > 0) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      _announcer.say(context, message);
    }
  }

  /// Search results leave out each book's format and language, and each format of a book is a
  /// separate entry, so the same title can appear more than once. Look each one up (a few at a
  /// time) and add its format and language, so the copies can be told apart.
  Future<void> _fillFormats(List<String> ids) async {
    final queue = [...ids];
    Future<void> worker() async {
      while (queue.isNotEmpty && mounted) {
        final id = queue.removeAt(0);
        try {
          final book = await widget.client.book(id);
          final i = _books.indexWhere((b) => b.id == id);
          if (book != null && i >= 0 && mounted) setState(() => _books[i] = book);
        } catch (_) {
          // The entry keeps what the search gave; the book's page still has every detail.
        }
      }
    }

    await Future.wait([worker(), worker(), worker(), worker()]);
  }

  String get _emptyText => widget.query is SugamyaLatest ? 'No books were added in the last 15 days.' : 'Nothing found.';

  void _open(Widget screen) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));

  @override
  Widget build(BuildContext context) {
    final more = _page * sugamyaPageSize < _total;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title, overflow: TextOverflow.ellipsis)),
      bottomNavigationBar: SafeArea(child: AnnouncementRegion(announcer: _announcer)),
      body: _error != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(_error!, textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Try again')),
                ]),
              ),
            )
          : _count == 0
              ? Center(child: _loading ? const CircularProgressIndicator(semanticsLabel: 'Loading') : Text(_emptyText))
              : ListView.builder(
                  itemCount: _count + (more ? 1 : 0),
                  itemBuilder: (context, i) {
                    if (i == _count) {
                      return ListTile(
                        title: Text(_loading ? 'Loading more…' : 'More results'),
                        onTap: _loading ? null : _load,
                      );
                    }
                    if (_isNames) {
                      final name = _names[i];
                      final grades = (widget.query as SugamyaNames).grades;
                      return ListTile(
                        title: Text(name),
                        onTap: () => _open(SugamyaListScreen(
                            services: widget.services, title: name, query: SugamyaIn(name, grade: grades))),
                      );
                    }
                    final book = _books[i];
                    return ListTile(
                      title: Text(book.title),
                      subtitle: book.detail.isEmpty ? null : Text(book.detail, maxLines: 2, overflow: TextOverflow.ellipsis),
                      onTap: () => _open(SugamyaBookScreen(services: widget.services, id: book.id, title: book.title)),
                    );
                  },
                ),
    );
  }
}

/// One book's details.
class SugamyaBookScreen extends StatefulWidget {
  const SugamyaBookScreen({super.key, required this.services, required this.id, required this.title});

  final SugamyaServices services;
  SugamyaClient get client => services.client;
  final String id;
  final String title;

  @override
  State<SugamyaBookScreen> createState() => _SugamyaBookScreenState();
}

class _SugamyaBookScreenState extends State<SugamyaBookScreen> {
  SugamyaBook? _book;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final book = await widget.client.book(widget.id);
      if (!mounted) return;
      setState(() {
        _book = book;
        if (book == null) _error = 'This book could not be found in Sugamya Pustakalaya.';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is CatalogException ? e.message : 'Could not load the book: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final book = _book;
    return Scaffold(
      appBar: AppBar(title: Text(book?.title ?? widget.title, overflow: TextOverflow.ellipsis)),
      body: _error != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(_error!, textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Try again')),
                ]),
              ),
            )
          : book == null
              ? const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading'))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Semantics(header: true, child: Text(book.title, style: Theme.of(context).textTheme.headlineSmall)),
                    for (final line in [
                      if (book.author.isNotEmpty) book.byLine,
                      if (book.publisher.isNotEmpty) 'Publisher: ${book.publisher}',
                      if (book.language.isNotEmpty) 'Language: ${book.language}',
                      if (book.format == sugamyaNotAvailable)
                        'Format: $sugamyaNotAvailable'
                      else if (book.format.isNotEmpty)
                        'Format: ${sugamyaFormatLabel(book.format)}. '
                            '${sugamyaFormatReadable(book.format) ? 'Reader can open this format.' : "Reader can't open this format."}',
                      if (book.size.isNotEmpty) 'Size: ${book.size}',
                      if (book.isbn.isNotEmpty) 'ISBN: ${book.isbn}',
                      if (book.synopsis.isNotEmpty) book.synopsis,
                    ])
                      Padding(padding: const EdgeInsets.only(top: 12), child: Text(line)),
                    const SizedBox(height: 16),
                    SugamyaRequestPart(services: widget.services, id: book.id, title: book.title, format: book.format),
                  ],
                ),
    );
  }
}

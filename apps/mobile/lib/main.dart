import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'book_server.dart';
import 'app_version.dart';
import 'book_store.dart';
import 'catalog_screen.dart';
import 'help_screen.dart';
import 'opds.dart';
import 'reader_screen.dart';
import 'settings.dart';
import 'sugamya.dart';
import 'sugamya_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final docs = await getApplicationDocumentsDirectory();
  final store = await BookStore.open(Directory(p.join(docs.path, 'books')));
  final server = BookServer(
    booksRoot: store.root.path,
    loadAsset: (asset) async => (await rootBundle.load(asset)).buffer.asUint8List(),
  );
  await server.start();
  runApp(ReaderApp(store: store, server: server));
}

class ReaderApp extends StatelessWidget {
  const ReaderApp({super.key, required this.store, required this.server});

  final BookStore store;
  final BookServer server;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Reader',
      theme: ThemeData(colorSchemeSeed: const Color(0xFF0B57D0), useMaterial3: true),
      darkTheme: ThemeData(colorSchemeSeed: const Color(0xFF0B57D0), brightness: Brightness.dark, useMaterial3: true),
      home: LibraryScreen(store: store, server: server),
    );
  }
}

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key, required this.store, required this.server});

  final BookStore store;
  final BookServer server;

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  final _catalogClient = CatalogClient();
  bool _importing = false;

  @override
  void initState() {
    super.initState();
    // Settings can ask to go straight back into the last book read.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final settings = await AppSettings.load();
      final id = settings.lastBookId;
      if (!mounted || !settings.openLastBook || id == null) return;
      final book = widget.store.books.where((b) => b.id == id).firstOrNull;
      if (book != null) await _open(book);
    });
  }

  @override
  void dispose() {
    _catalogClient.close();
    super.dispose();
  }

  /// Online libraries: a choice of Project Gutenberg or Sugamya Pustakalaya.
  void _browseOnline() {
    final catalog = builtInCatalogs.first;
    void open(Widget screen) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
    open(Scaffold(
      appBar: AppBar(title: const Text('Online libraries')),
      body: ListView(
        children: [
          ListTile(
            title: const Text(sugamyaName),
            subtitle: const Text("India's accessible library, from DAISY Forum of India"),
            onTap: () => open(SugamyaStartScreen(client: SugamyaClient(_catalogClient))),
          ),
          ListTile(
            title: Text(catalog.name),
            subtitle: const Text('Free classics; download and open in one step'),
            onTap: () => open(CatalogScreen(
              catalog: catalog,
              url: catalog.url,
              client: _catalogClient,
              store: widget.store,
              onBook: _open,
            )),
          ),
        ],
      ),
    ));
  }

  Future<void> _addBook() async {
    final file = await FilePicker.pickFile(dialogTitle: 'Choose an EPUB or zipped DAISY book');
    if (file?.path == null) return;
    setState(() => _importing = true);
    try {
      final book = await widget.store.import(file!.path!, file.name);
      if (!mounted) return;
      setState(() {});
      await _open(book);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not add the book: $e')));
    } finally {
      if (mounted) setState(() => _importing = false);
    }
  }

  Future<void> _open(StoredBook book) async {
    (await AppSettings.load()).lastBookId = book.id;
    if (!mounted) return;
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => ReaderScreen(store: widget.store, server: widget.server, book: book),
    ));
    if (mounted) setState(() {});
  }

  Future<void> _remove(StoredBook book) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove book?'),
        content: Text('"${book.title}" will be deleted from this phone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Remove')),
        ],
      ),
    );
    if (confirmed != true) return;
    await widget.store.remove(book.id);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final books = widget.store.books;
    return Scaffold(
      appBar: AppBar(
        title: const Text('My books'),
        actions: [
          IconButton(tooltip: 'Online libraries', icon: const Icon(Icons.travel_explore), onPressed: _browseOnline),
          IconButton(
            tooltip: 'Settings',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () async {
              final settings = await AppSettings.load();
              if (!context.mounted) return;
              await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SettingsScreen(settings: settings)));
            },
          ),
          IconButton(
            tooltip: 'Help: reading commands',
            icon: const Icon(Icons.help_outline),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const HelpScreen())),
          ),
        ],
      ),
      body: books.isEmpty
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                    'No books yet. Use "Add book" to open an EPUB or zipped DAISY book from this phone, '
                    'or "Online libraries" to find free books.',
                    textAlign: TextAlign.center),
              ),
            )
          : ListView.builder(
              itemCount: books.length,
              itemBuilder: (context, i) {
                final book = books[i];
                return ListTile(
                  title: Text(book.title),
                  subtitle: book.authors.isEmpty ? null : Text(book.authors.join(', ')),
                  onTap: () => _open(book),
                  trailing: PopupMenuButton<String>(
                    tooltip: 'More options for ${book.title}',
                    onSelected: (_) => _remove(book),
                    itemBuilder: (_) => const [PopupMenuItem(value: 'remove', child: Text('Remove from phone'))],
                  ),
                );
              },
            ),
      bottomNavigationBar: const SafeArea(
        child: Padding(padding: EdgeInsets.symmetric(vertical: 8), child: AppVersionText(textAlign: TextAlign.center)),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _importing ? null : _addBook,
        icon: _importing ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator()) : const Icon(Icons.add),
        label: Text(_importing ? 'Adding book…' : 'Add book'),
      ),
    );
  }
}

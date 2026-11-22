import 'dart:convert';
import 'dart:io';

import 'package:archive/archive_io.dart';
import 'package:path/path.dart' as p;

/// A book unpacked into the app's storage.
class StoredBook {
  StoredBook({required this.id, required this.title, this.authors = const [], required this.addedAt, this.wrappedName});

  factory StoredBook.fromJson(Map<String, dynamic> json) => StoredBook(
        id: json['id'] as String,
        title: json['title'] as String,
        authors: [for (final a in json['authors'] as List? ?? const []) a as String],
        addedAt: DateTime.parse(json['addedAt'] as String),
      );

  final String id;
  String title;
  List<String> authors;
  final DateTime addedAt;

  /// Just imported only: the name of the book file found inside a zip of its own (not saved).
  final String? wrappedName;

  Map<String, dynamic> toJson() => {'id': id, 'title': title, 'authors': authors, 'addedAt': addedAt.toIso8601String()};
}

/// Imports zipped books (EPUB, zipped DAISY) by unpacking them under [root],
/// one folder per book, and keeps a small index of what is there.
class BookStore {
  BookStore._(this.root, this.books);

  static Future<BookStore> open(Directory root) async {
    await root.create(recursive: true);
    final index = File(p.join(root.path, 'books.json'));
    final books = <StoredBook>[];
    if (await index.exists()) {
      try {
        for (final b in jsonDecode(await index.readAsString()) as List) {
          books.add(StoredBook.fromJson(b as Map<String, dynamic>));
        }
      } on FormatException {
        // A damaged index only loses the list; the book folders stay on disk.
      }
    }
    return BookStore._(root, books);
  }

  final Directory root;
  final List<StoredBook> books;

  Directory folder(String id) => Directory(p.join(root.path, id));

  Future<StoredBook> import(String zipPath, String fileName) async {
    final id = DateTime.now().microsecondsSinceEpoch.toString();
    final target = folder(id);
    String? wrappedName;
    try {
      // Streams from disk, so large audio books are not loaded into memory at once.
      await extractFileToDisk(zipPath, target.path);
      var files = await listFiles(id);
      // Sugamya Pustakalaya sends an EPUB inside a .zip of its own: unpack the book inside.
      for (var depth = 0; depth < 2; depth++) {
        final inner = wrappedBookPath(files);
        if (inner == null) break;
        wrappedName = p.posix.basenameWithoutExtension(inner);
        if (!p.isWithin(target.path, p.join(target.path, inner))) throw const FormatException('Unsafe file path in archive.');
        final unpacked = Directory('${target.path}.inner');
        if (await unpacked.exists()) await unpacked.delete(recursive: true);
        await extractFileToDisk(p.join(target.path, inner), unpacked.path);
        await target.delete(recursive: true);
        await unpacked.rename(target.path);
        files = await listFiles(id);
      }
      if (files.isEmpty) throw const FormatException('The file is empty or not a zip archive.');
      for (final f in files) {
        if (!p.isWithin(target.path, p.join(target.path, f))) throw const FormatException('Unsafe file path in archive.');
      }
    } catch (_) {
      if (await target.exists()) await target.delete(recursive: true);
      final unpacked = Directory('${target.path}.inner');
      if (await unpacked.exists()) await unpacked.delete(recursive: true);
      rethrow;
    }
    final book = StoredBook(id: id, title: p.basenameWithoutExtension(fileName), addedAt: DateTime.now(), wrappedName: wrappedName);
    books.insert(0, book);
    await save();
    return book;
  }

  /// The book's files as container paths ("dir/file.ext", forward slashes).
  Future<List<String>> listFiles(String id) async {
    final dir = folder(id);
    if (!await dir.exists()) return [];
    return [
      await for (final e in dir.list(recursive: true))
        if (e is File) p.relative(e.path, from: dir.path).split(p.separator).join('/')
    ];
  }

  Future<void> remove(String id) async {
    books.removeWhere((b) => b.id == id);
    final dir = folder(id);
    if (await dir.exists()) await dir.delete(recursive: true);
    await save();
  }

  Future<void> save() =>
      File(p.join(root.path, 'books.json')).writeAsString(jsonEncode([for (final b in books) b.toJson()]));
}

/// The one book inside a zip that holds no book itself (an EPUB container, a DAISY 3 package
/// or a DAISY 2.02 NCC), if there is one. Mac zip leftovers (__MACOSX/, dot files) are ignored.
String? wrappedBookPath(List<String> files) {
  bool isBook(String f) {
    final lower = f.toLowerCase();
    return lower == 'meta-inf/container.xml' || lower.endsWith('.opf') || p.posix.basename(lower) == 'ncc.html';
  }

  if (files.any(isBook)) return null;
  final inner = files.where((f) {
    final lower = f.toLowerCase();
    final name = p.posix.basename(lower);
    return !lower.startsWith('__macosx/') && !name.startsWith('.') && (name.endsWith('.epub') || name.endsWith('.zip'));
  }).toList();
  return inner.length == 1 ? inner.single : null;
}

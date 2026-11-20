import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'announcer.dart';

/// A place in a book, as Go back and bookmarks keep it: the narration clip, and the block
/// (paragraph) of a text document.
class Spot {
  const Spot({required this.clipIndex, this.docPath, this.block});

  factory Spot.fromJson(Map<String, dynamic> json) =>
      Spot(clipIndex: (json['clipIndex'] as int?) ?? 0, docPath: json['docPath'] as String?, block: json['block'] as int?);

  final int clipIndex;
  final String? docPath;
  final int? block;

  Map<String, dynamic> toJson() =>
      {'clipIndex': clipIndex, if (docPath != null) 'docPath': docPath, if (block != null) 'block': block};

  bool sameAs(Spot other) => clipIndex == other.clipIndex && docPath == other.docPath && block == other.block;
}

class Bookmark {
  Bookmark({
    required this.id,
    required this.name,
    required this.where,
    required this.spot,
    required this.order,
    required this.created,
  });

  factory Bookmark.fromJson(Map<String, dynamic> json) => Bookmark(
        id: json['id'] as String,
        name: json['name'] as String,
        where: (json['where'] as String?) ?? '',
        spot: Spot.fromJson(json['spot'] as Map<String, dynamic>),
        order: [for (final n in (json['order'] as List? ?? const [])) n as int],
        created: (json['created'] as int?) ?? 0,
      );

  final String id;
  String name;

  /// Where it is, as said in the list: "Chapter 3, Page 41".
  final String where;
  final Spot spot;

  /// Its position in the book, for listing bookmarks in book order.
  final List<int> order;
  final int created;

  Map<String, dynamic> toJson() =>
      {'id': id, 'name': name, 'where': where, 'spot': spot.toJson(), 'order': order, 'created': created};
}

/// One book's bookmarks, kept on the phone.
class BookmarkStore {
  BookmarkStore(this.bookId);

  final String bookId;

  String get _key => 'bookmarks:$bookId';

  Future<List<Bookmark>> load() async {
    final raw = (await SharedPreferences.getInstance()).getString(_key);
    if (raw == null) return [];
    try {
      return [for (final b in jsonDecode(raw) as List) Bookmark.fromJson(b as Map<String, dynamic>)];
    } catch (_) {
      return [];
    }
  }

  Future<void> save(List<Bookmark> list) async {
    list.sort((a, b) {
      final d = compareOrder(a.order, b.order);
      return d != 0 ? d : a.created - b.created;
    });
    final prefs = await SharedPreferences.getInstance();
    if (list.isEmpty) {
      await prefs.remove(_key);
    } else {
      await prefs.setString(_key, jsonEncode([for (final b in list) b.toJson()]));
    }
  }
}

int compareOrder(List<int> a, List<int> b) {
  for (var i = 0; i < math.max(a.length, b.length); i++) {
    final d = (i < a.length ? a[i] : 0) - (i < b.length ? b[i] : 0);
    if (d != 0) return d;
  }
  return 0;
}

/// Asks for a bookmark's name, with [initial] filled in and selected. Null when cancelled.
Future<String?> askBookmarkName(BuildContext context,
    {required String title, required String action, required String initial, required String where}) {
  final controller = TextEditingController(text: initial)
    ..selection = TextSelection(baseOffset: 0, extentOffset: initial.length);
  return showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (where.isNotEmpty) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text('At: $where')),
          TextField(
            controller: controller,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'Name'),
            onSubmitted: (v) => Navigator.pop(context, v),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(context, controller.text), child: Text(action)),
      ],
    ),
  );
}

/// The book's bookmarks in book order: tap one to go there (it is returned); each has Rename and Delete.
class BookmarksScreen extends StatefulWidget {
  const BookmarksScreen({super.key, required this.store});

  final BookmarkStore store;

  @override
  State<BookmarksScreen> createState() => _BookmarksScreenState();
}

class _BookmarksScreenState extends State<BookmarksScreen> {
  List<Bookmark>? _list;
  final _announcer = Announcer();

  @override
  void initState() {
    super.initState();
    widget.store.load().then((list) {
      if (mounted) setState(() => _list = list);
    });
  }

  @override
  void dispose() {
    _announcer.dispose();
    super.dispose();
  }

  Future<void> _rename(Bookmark b) async {
    final name = await askBookmarkName(context, title: 'Rename bookmark', action: 'Rename', initial: b.name, where: b.where);
    final clean = name?.replaceAll(RegExp(r'\s+'), ' ').trim() ?? '';
    if (clean.isEmpty || !mounted) return;
    setState(() => b.name = clean);
    await widget.store.save(_list!);
    if (mounted) _announcer.say(context, 'Renamed to $clean');
  }

  Future<void> _delete(Bookmark b) async {
    setState(() => _list!.remove(b));
    await widget.store.save(_list!);
    if (!mounted) return;
    final left = _list!.length;
    _announcer.say(context, 'Deleted ${b.name}. ${left == 0 ? 'No bookmarks left.' : '$left left.'}');
  }

  @override
  Widget build(BuildContext context) {
    final list = _list;
    return Scaffold(
      appBar: AppBar(title: const Text('Bookmarks')),
      body: Column(
        children: [
          AnnouncementRegion(announcer: _announcer),
          Expanded(
            child: list == null
                ? const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading bookmarks'))
                : list.isEmpty
                    ? const Center(
                        child: Padding(
                          padding: EdgeInsets.all(24),
                          child: Text('No bookmarks in this book yet. While reading, choose Add bookmark in the '
                              'More reading options menu.', textAlign: TextAlign.center),
                        ),
                      )
                    : ListView.builder(
                        itemCount: list.length,
                        itemBuilder: (context, i) {
                          final b = list[i];
                          return ListTile(
                            title: Text(b.name),
                            subtitle: b.where.isEmpty ? null : Text(b.where),
                            onTap: () => Navigator.pop(context, b),
                            trailing: PopupMenuButton<String>(
                              tooltip: 'Options for ${b.name}',
                              onSelected: (choice) => choice == 'rename' ? _rename(b) : _delete(b),
                              itemBuilder: (_) => const [
                                PopupMenuItem(value: 'rename', child: Text('Rename')),
                                PopupMenuItem(value: 'delete', child: Text('Delete')),
                              ],
                            ),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}

import 'dart:async';
import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// How long one book has been read, for Where am I. Time counts while the book is open, the app is
/// in front, and the reader is doing something: touching the screen, moving with TalkBack, or
/// listening. As on Windows (reading-stats.ts).
class ReadingStats {
  ReadingStats(this.bookId, {required this.playing});

  final String bookId;
  final bool Function() playing;

  static const _tick = Duration(seconds: 15);

  /// Time without a touch, a TalkBack move or playing that still counts as reading.
  static const _idle = Duration(minutes: 5);

  String get _key => 'stats:$bookId';
  SharedPreferences? _prefs;
  Timer? _timer;
  DateTime _active = DateTime.now();

  late DateTime first;
  int opens = 0;
  int seconds = 0;
  int session = 0;

  /// The book was opened: counts the opening and starts counting time.
  Future<void> open() async {
    _prefs = await SharedPreferences.getInstance();
    Map<String, dynamic>? saved;
    try {
      saved = jsonDecode(_prefs!.getString(_key) ?? 'null') as Map<String, dynamic>?;
    } catch (_) {}
    first = saved == null ? DateTime.now() : DateTime.fromMillisecondsSinceEpoch(saved['first'] as int);
    opens = ((saved?['opens'] as int?) ?? 0) + 1;
    seconds = (saved?['seconds'] as int?) ?? 0;
    session = 0;
    _active = DateTime.now();
    _save();
    _timer = Timer.periodic(_tick, (_) => _count());
  }

  /// The reader did something (a touch, a TalkBack move): reading goes on.
  void active() => _active = DateTime.now();

  void close() => _timer?.cancel();

  void _count() {
    if (WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) return;
    if (!playing() && DateTime.now().difference(_active) > _idle) return;
    seconds += _tick.inSeconds;
    session += _tick.inSeconds;
    _save();
  }

  void _save() => _prefs?.setString(
      _key,
      jsonEncode({
        'first': first.millisecondsSinceEpoch,
        'last': DateTime.now().millisecondsSinceEpoch,
        'opens': opens,
        'seconds': seconds,
      }));
}

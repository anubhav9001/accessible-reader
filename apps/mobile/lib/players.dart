import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:just_audio/just_audio.dart';

import 'models.dart';

/// Plays the book's recorded narration clip by clip with the phone's native player.
/// Back-to-back clips of the same file play on without seeking, so narration has no gaps.
class RecordedPlayer {
  RecordedPlayer({
    required this.clips,
    required this.filePath,
    required this.onClip,
    required this.onState,
    required this.onEnded,
  }) {
    _position = _player
        .createPositionStream(minPeriod: const Duration(milliseconds: 40), maxPeriod: const Duration(milliseconds: 80))
        .listen(_onPosition);
    _state = _player.playerStateStream.listen((state) {
      // Clips without an end run to the end of their file.
      if (state.processingState == ProcessingState.completed && playing && !_loading) _advance();
    });
  }

  final List<Clip> clips;

  /// Maps a book path to the file on disk (resolving case differences).
  final String Function(String bookPath) filePath;
  final void Function(int index) onClip;
  final void Function(bool playing) onState;
  final VoidCallback onEnded;

  final AudioPlayer _player = AudioPlayer();
  late final StreamSubscription<Duration> _position;
  late final StreamSubscription<PlayerState> _state;
  int index = 0;
  bool playing = false;
  bool _loading = false;
  String? _file;
  int _token = 0;
  double _rate = 1;

  int? nextAudible(int from, int direction) {
    for (var i = from + direction; i >= 0 && i < clips.length; i += direction) {
      if (clips[i].audio != null) return i;
    }
    return null;
  }

  Future<void> play([int? from]) async {
    final start = from ?? index;
    final first = start < clips.length && clips[start].audio != null ? start : nextAudible(start, 1);
    if (first == null) return onEnded();
    playing = true;
    onState(true);
    await _start(first);
  }

  Future<void> pause() async {
    if (!playing) return;
    playing = false;
    _token++;
    await _player.pause();
    onState(false);
  }

  /// Moves to a clip; keeps playing if playing.
  void seek(int i) {
    index = i;
    if (playing) {
      _start(i);
    } else {
      onClip(i);
    }
  }

  Future<void> setRate(double rate) async {
    _rate = rate;
    await _player.setSpeed(rate);
  }

  Future<void> _start(int i) async {
    final audio = clips[i].audio!;
    final token = ++_token;
    index = i;
    _loading = true;
    onClip(i);
    try {
      final path = filePath(audio.path);
      if (path != _file) {
        _file = path;
        await _player.setFilePath(path);
      }
      if (token != _token) return;
      await _player.seek(Duration(microseconds: (audio.begin * 1e6).round()));
      await _player.setSpeed(_rate);
      // play() completes only when playback stops, so it is not awaited.
      unawaited(_player.play());
    } catch (e) {
      debugPrint('Cannot play ${audio.path}: $e');
      if (token == _token) await pause();
    } finally {
      if (token == _token) _loading = false;
    }
  }

  void _onPosition(Duration position) {
    if (!playing || _loading) return;
    final end = clips[index].audio?.end;
    if (end != null && position.inMicroseconds / 1e6 >= end - 0.03) _advance();
  }

  void _advance() {
    final current = clips[index].audio;
    final next = nextAudible(index, 1);
    if (next == null) {
      pause();
      onEnded();
      return;
    }
    final upcoming = clips[next].audio!;
    final continuous = current?.end != null &&
        upcoming.path == current!.path &&
        (upcoming.begin - current.end!).abs() < 0.05 &&
        _player.processingState != ProcessingState.completed;
    if (continuous) {
      index = next;
      onClip(next);
    } else {
      _start(next);
    }
  }

  Future<void> dispose() async {
    await _position.cancel();
    await _state.cancel();
    await _player.dispose();
  }
}

/// Reads text blocks aloud with the phone's text-to-speech voice.
class SpeechReader {
  SpeechReader({required this.onBlock, required this.onState, required this.onFinished, required this.onVoiceFailed}) {
    _tts.setCompletionHandler(_onDone);
  }

  final void Function(int index) onBlock;
  final void Function(bool playing) onState;

  /// Called after the last loaded block while reading; loads the next document or stops.
  final Future<void> Function() onFinished;

  /// The phone's speech engine could not be started.
  final void Function() onVoiceFailed;

  final FlutterTts _tts = FlutterTts();
  List<TextBlock> blocks = const [];
  int index = 0;
  bool playing = false;
  int _token = 0;
  int _speaking = -1;
  Future<bool>? _ready;
  String _lang = '';

  /// Connects to the phone's default speech engine, retrying a few times.
  ///
  /// On some phones the first connection, made as the app starts, fails, and flutter_tts
  /// never tries again by itself (its check for a lost connection cannot see Android's
  /// internals on recent versions). Choosing the engine afresh makes a new connection.
  Future<bool> _connect() async {
    if (!Platform.isAndroid) return true;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        final engine = await _tts.getDefaultEngine.timeout(const Duration(seconds: 2)) as String?;
        if (engine == null) return false;
        // Returns nothing on success; a failed connection throws.
        await _tts.setEngine(engine).timeout(const Duration(seconds: 3));
        return true;
      } catch (_) {
        // Try again below.
      }
      await Future<void>.delayed(const Duration(milliseconds: 500));
    }
    return false;
  }

  Future<void> load(TextDoc doc) async {
    blocks = doc.blocks;
    index = doc.index.clamp(0, blocks.isEmpty ? 0 : blocks.length - 1);
    // The language is set when reading starts, so opening a book never waits on the voice.
    _lang = doc.lang;
  }

  Future<void> play() async {
    if (blocks.isEmpty) {
      onFinished();
      return;
    }
    playing = true;
    onState(true);
    if (!await (_ready ??= _connect())) {
      _ready = null; // Try again on the next Play.
      await pause();
      onVoiceFailed();
      return;
    }
    if (_lang.isNotEmpty) {
      try {
        await _tts.setLanguage(_lang);
      } catch (_) {
        // Keep the current voice if the book's language has none on this phone.
      }
    }
    if (playing) _speak();
  }

  Future<void> pause() async {
    final was = playing;
    playing = false;
    _token++;
    await _tts.stop();
    if (was) onState(false);
  }

  /// Moves to a block; keeps reading if reading.
  void jump(int i) {
    if (i < 0 || i >= blocks.length) return;
    index = i;
    if (playing) {
      _speak();
    } else {
      onBlock(i);
    }
  }

  /// 1.0 is normal speed. Both Android and iOS treat 0.5 as their normal rate.
  Future<void> setRate(double rate) async {
    await _tts.setSpeechRate((0.5 * rate).clamp(0.1, 1.0));
    if (playing) _speak();
  }

  Future<void> _speak() async {
    final token = ++_token;
    onBlock(index);
    await _tts.stop();
    if (token != _token) return;
    _speaking = token;
    await _tts.speak(blocks[index].text);
  }

  void _onDone() {
    if (!playing || _speaking != _token) return;
    if (index + 1 < blocks.length) {
      index++;
      _speak();
    } else {
      onFinished();
    }
  }

  Future<void> dispose() => _tts.stop();
}

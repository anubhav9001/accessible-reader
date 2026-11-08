import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'announcer.dart';
import 'book_server.dart';
import 'book_store.dart';
import 'help_screen.dart';
import 'models.dart';
import 'players.dart';
import 'reader_bridge.dart';
import 'settings.dart';

class ReaderScreen extends StatefulWidget {
  const ReaderScreen({super.key, required this.store, required this.server, required this.book});

  final BookStore store;
  final BookServer server;
  final StoredBook book;

  @override
  State<ReaderScreen> createState() => _ReaderScreenState();
}

class _ReaderScreenState extends State<ReaderScreen> {
  late final ReaderBridge _bridge = ReaderBridge(onLink: (target) => _goToText(target), onPlace: _onPlace);
  late final SpeechReader _speech =
      SpeechReader(
      onBlock: _onBlock,
      onState: _onPlayState,
      onFinished: _onSpeechFinished,
      onVoiceFailed: () => _announce(
          "The phone's reading voice could not be started. If this copy of the app is a Dual App, "
          'open the normal copy instead, or check Text-to-speech in accessibility settings.'));
  RecordedPlayer? _recorded;
  OpenedBook? _book;
  String? _error;

  ReadingMode _mode = ReadingMode.text;
  int _clipIndex = 0;
  TextDoc? _doc;
  int _headingLevel = 0;
  int _contentsDepth = 0;
  double _rate = 1;
  bool _playing = false;
  String _heading = '';
  String _page = '';
  String _time = '';
  Timer? _saveTimer;

  @override
  void initState() {
    super.initState();
    _open();
  }

  @override
  void dispose() {
    _saveTimer?.cancel();
    _save();
    _recorded?.dispose();
    _speech.dispose();
    _announcer.dispose();
    super.dispose();
  }

  // ---- opening ----------------------------------------------------------------------

  Future<void> _open() async {
    try {
      final files = await widget.store.listFiles(widget.book.id);
      final byLower = {for (final f in files) f.toLowerCase(): f};
      final dir = widget.store.folder(widget.book.id).path;
      await _bridge.load(widget.server.readerUrl);
      final settings = await AppSettings.load();
      _textOnly = settings.screenReaderMode;
      _headingLevel = settings.headingDepth;
      _contentsDepth = settings.contentsDepth;
      _rate = settings.rate;
      _speech.voice = settings.voice;
      await _speech.setRate(_rate);
      final opened =
          await _bridge.call<Map<String, dynamic>>('open', [widget.server.bookUrl(widget.book.id), files, _textOnly]);
      final book = OpenedBook.fromJson(opened!);

      _recorded = RecordedPlayer(
        clips: book.narration,
        filePath: (path) => p.joinAll([dir, ...(byLower[path.toLowerCase()] ?? path).split('/')]),
        onClip: _onClip,
        onState: _onPlayState,
        onEnded: () => _announce('End of book'),
      );

      // Keep the library entry's title and authors in step with the book itself.
      if (book.title.isNotEmpty && book.title != widget.book.title) {
        widget.book
          ..title = book.title
          ..authors = book.authors;
        await widget.store.save();
      }
      await _recorded!.setRate(_rate);

      final saved = await _loadPosition();
      _clipIndex = (saved?['clipIndex'] as int?) ?? 0;
      final savedMode = ReadingMode.values.asNameMap()[saved?['mode']];
      setState(() => _book = book);
      await _setMode(savedMode != null && book.option(savedMode).available ? savedMode : book.defaultMode,
          restore: true, savedBlockPath: saved?['docPath'] as String?, savedBlock: saved?['block'] as int?);
      if (_screenReaderOn && _mode != ReadingMode.audio) {
        // Like a printed book left open: the screen reader goes on reading where it stopped.
        await _moveScreenReaderToPlace();
      } else {
        _announce('${book.title}. ${_mode.label} mode.');
      }
    } catch (e) {
      setState(() => _error = 'Could not open this book: $e');
    }
  }

  // ---- helpers ----------------------------------------------------------------------

  String get _source => _book?.option(_mode).audioSource ?? 'none';

  /// Recorded-audio books move clip by clip; device-voice reading moves block by block.
  bool get _usesClips => _source == 'recorded' || !(_book?.hasText ?? false);

  /// TalkBack or VoiceOver is on.
  bool get _screenReaderOn => mounted && MediaQuery.of(context).accessibleNavigation;

  static const _accessibility = MethodChannel('org.saksham.accessible_reader/accessibility');

  /// Puts TalkBack's or VoiceOver's cursor on the current place in the text.
  Future<void> _moveScreenReaderToPlace() async {
    // Let the screen reader finish settling on the newly opened screen first.
    await Future<void>.delayed(const Duration(milliseconds: 800));
    if (!mounted) return;
    if (Platform.isAndroid) {
      try {
        await _accessibility.invokeMethod<bool>('focusWebView');
      } on PlatformException {
        // Without it the place is still shown; the screen reader just starts at the top.
      }
    }
    await _bridge.call('startAt', [_usesClips ? null : _doc?.index]);
  }

  bool get _isPlaying => (_recorded?.playing ?? false) || _speech.playing;

  final _announcer = Announcer();

  void _announce(String message) {
    if (mounted) _announcer.say(context, message);
  }

  String _formatTime(double seconds) {
    final s = seconds.floor();
    String two(int n) => n.toString().padLeft(2, '0');
    return s >= 3600 ? '${s ~/ 3600}:${two(s % 3600 ~/ 60)}:${two(s % 60)}' : '${s ~/ 60}:${two(s % 60)}';
  }

  Future<void> _pauseAll() async {
    await _recorded?.pause();
    await _speech.pause();
  }

  // ---- position -----------------------------------------------------------------------

  String get _positionKey => 'position:${widget.book.id}';

  // ---- screen reader mode -------------------------------------------------------------

  /// Screen reader mode: the whole book as one text-only page, read straight through with
  /// TalkBack or VoiceOver, keeping its headings, lists, tables and links. A setting for all books.
  static const _textOnlyKey = 'screenReaderMode';
  bool _textOnly = false;

  Future<void> _setTextOnly(bool on) async {
    if (on == _textOnly) return;
    await _pauseAll();
    setState(() => _textOnly = on);
    await (await SharedPreferences.getInstance()).setBool(_textOnlyKey, on);
    if (on) _announce('Preparing the text of the whole book');
    final keep = _doc?.index;
    await _bridge.call('setTextOnly', [on]);
    if (!_usesClips && _doc != null) {
      await _loadDoc(await _bridge.call<Map<String, dynamic>>('textAt', [TextRef(_doc!.path).toJson(), null]),
          highlight: false);
      final doc = _doc!;
      if (keep != null && keep < doc.blocks.length) {
        doc.index = keep;
        _speech.index = keep;
      }
      await _bridge.call('highlightBlock', [doc.index, false]);
    } else if (_mode == ReadingMode.textAudio) {
      await _bridge.call('showClip', [_clipIndex, false]);
    }
    _announce(on
        ? 'Screen reader mode on. The whole book is one page of plain text.'
        : 'Screen reader mode off. The book is shown chapter by chapter.');
    if (_screenReaderOn && _mode != ReadingMode.audio) await _moveScreenReaderToPlace();
  }

  Future<Map<String, dynamic>?> _loadPosition() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_positionKey);
    return raw == null ? null : jsonDecode(raw) as Map<String, dynamic>;
  }

  void _scheduleSave() {
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(seconds: 1), _save);
  }

  Future<void> _save() async {
    if (_book == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
        _positionKey, jsonEncode({'mode': _mode.name, 'clipIndex': _clipIndex, 'docPath': _doc?.path, 'block': _doc?.index}));
  }

  // ---- modes --------------------------------------------------------------------------

  /// [restore] is for opening the book: it returns to the saved place, putting the screen reader there.
  Future<void> _setMode(ReadingMode next, {bool restore = false, String? savedBlockPath, int? savedBlock}) async {
    final book = _book;
    if (book == null) return;
    final option = book.option(next);
    if (!option.available) {
      _announce(option.reason ?? '${next.label} is not available for this book.');
      return;
    }
    final wasPlaying = _isPlaying;
    final wasByBlock = !_usesClips;
    await _pauseAll();

    // Carry the place across from block-by-block reading to a clip.
    if (wasByBlock && _doc != null) {
      final clip = await _bridge.call<int>('clipForBlock', [_doc!.index]);
      if (clip != null) _clipIndex = clip;
    }
    setState(() => _mode = next);

    if (!_usesClips) {
      // Keep the exact block, from the saved place or from the mode being left.
      final path = restore ? savedBlockPath : (wasByBlock ? _doc?.path : null);
      final block = restore ? savedBlock : (wasByBlock ? _doc?.index : null);
      await _loadDoc(await _bridge.call<Map<String, dynamic>>('textAt', [path == null ? null : TextRef(path).toJson(), _clipIndex]));
      if (block != null && _doc != null && path == _doc!.path) _speech.jump(block);
    } else if (_mode == ReadingMode.textAudio) {
      await _bridge.call('showClip', [_clipIndex, restore]);
    }
    await _updateLocation();
    if (!restore) _announce('${_mode.label} mode');
    if (wasPlaying) await _play();
  }

  /// [highlight] is false when following the screen reader, so the page doesn't jump under it.
  Future<void> _loadDoc(Map<String, dynamic>? json, {bool highlight = true}) async {
    if (json == null) return;
    final doc = TextDoc.fromJson(json);
    _doc = doc;
    await _speech.load(doc);
    if (highlight) await _bridge.call('highlightBlock', [doc.index, false]);
  }

  // ---- playback -----------------------------------------------------------------------

  Future<void> _play() async {
    if (_source == 'recorded') {
      await _recorded?.play(_clipIndex);
    } else if (_source == 'tts') {
      _speech.play();
    } else {
      _announce('There is nothing to play in this mode.');
    }
  }

  Future<void> _togglePlay() async {
    if (_isPlaying) {
      await _pauseAll();
    } else {
      await _play();
    }
  }

  void _onPlayState(bool playing) {
    if (mounted) setState(() => _playing = _isPlaying);
    // While reading aloud the app itself knows the place; following the screen reader is for when it is quiet.
    _bridge.call('setTracking', [!_isPlaying]);
  }

  void _onClip(int index) {
    _clipIndex = index;
    if (_mode == ReadingMode.textAudio) _bridge.call('showClip', [index, false]);
    _updateLocation();
    _scheduleSave();
  }

  void _onBlock(int index) {
    _doc?.index = index;
    // The screen reader stays on the button pressed (see _sayBlock), so it can be pressed again.
    _bridge.call('highlightBlock', [index, false]);
    _updateLocation();
    _scheduleSave();
  }

  /// TalkBack or VoiceOver read on through the text by itself: remember where it got to.
  Future<void> _onPlace(String path, int index, int? clip) async {
    if (_isPlaying || _book == null) return;
    if (_usesClips) {
      // In screen reader mode TalkBack can read on into another chapter: find its clip there.
      clip ??= await _bridge.call<int>('clipIn', [path, index]);
      if (clip == null || clip == _clipIndex) return;
      _clipIndex = clip;
    } else {
      var doc = _doc;
      if (doc != null && doc.path != path) {
        await _loadDoc(await _bridge.call<Map<String, dynamic>>('textAt', [TextRef(path).toJson(), null]),
            highlight: false);
        await _bridge.call('notePlace', [index]);
        doc = _doc;
      }
      if (doc == null || doc.path != path || index >= doc.blocks.length) return;
      doc.index = index;
      _speech.index = index;
    }
    _updateLocation();
    _scheduleSave();
  }

  Future<void> _onSpeechFinished() async {
    final next = await _bridge.call<Map<String, dynamic>>('textDocument', [1]);
    if (next == null) {
      await _speech.pause();
      _announce('End of book');
      return;
    }
    await _loadDoc(next);
    _speech.play();
  }

  // ---- navigation ---------------------------------------------------------------------

  Future<void> _goTo({int? clipIndex, TextRef? target, required String label}) async {
    if (_usesClips && clipIndex != null) {
      _recorded?.seek(clipIndex);
      if (!_isPlaying) _announce(label);
      return;
    }
    if (target != null || clipIndex != null) await _goToText(target, clipIndex: clipIndex);
    if (!_isPlaying) _announce(label);
  }

  Future<void> _goToText(TextRef? target, {int? clipIndex}) async {
    if (_usesClips) return;
    final wasPlaying = _speech.playing;
    await _loadDoc(await _bridge.call<Map<String, dynamic>>('textAt', [target?.toJson(), clipIndex]));
    if (wasPlaying) {
      _speech.play();
    } else {
      _onBlock(_doc!.index);
    }
  }

  Future<void> _stepPhrase(int direction) async {
    if (_usesClips) {
      final next = _recorded?.nextAudible(_clipIndex, direction);
      if (next == null) return _announce(direction > 0 ? 'End of book' : 'Start of book');
      _recorded!.seek(next);
      return;
    }
    final doc = _doc;
    if (doc == null) return;
    final target = doc.index + direction;
    if (target >= 0 && target < doc.blocks.length) {
      _speech.jump(target);
      return _sayBlock();
    }
    await _changeDoc(direction);
  }

  /// Reads out the current block after stepping by hand, unless reading aloud already does.
  void _sayBlock() {
    final doc = _doc;
    if (doc != null && !_speech.playing && doc.index < doc.blocks.length) _announce(doc.blocks[doc.index].text);
  }

  Future<void> _changeDoc(int direction) async {
    final next = await _bridge.call<Map<String, dynamic>>('textDocument', [direction]);
    if (next == null) return _announce(direction > 0 ? 'End of book' : 'Start of book');
    final wasPlaying = _speech.playing;
    await _loadDoc(next);
    if (wasPlaying) {
      _speech.play();
    } else {
      _onBlock(_doc!.index);
      _sayBlock();
    }
  }

  Future<void> _stepHeading(int direction) async {
    if (_usesClips) {
      final r = await _bridge.call<Map<String, dynamic>>('clipNav', ['heading', direction, _clipIndex, _headingLevel]);
      if (r == null) return _announce(direction > 0 ? 'No next heading' : 'No previous heading');
      return _goTo(clipIndex: r['clipIndex'] as int, label: r['label'] as String);
    }
    final doc = _doc;
    if (doc == null) return;
    for (var i = doc.index + direction; i >= 0 && i < doc.blocks.length; i += direction) {
      final level = doc.blocks[i].heading;
      if (level != null && (_headingLevel == 0 || level <= _headingLevel)) {
        _speech.jump(i);
        _announce(doc.blocks[i].text);
        return;
      }
    }
    // No more headings in this chapter: look in the next or previous ones.
    final fromPath = doc.path;
    final fromIndex = doc.index;
    while (true) {
      final json = await _bridge.call<Map<String, dynamic>>('textDocument', [direction]);
      if (json == null) break;
      final candidate = TextDoc.fromJson(json);
      final blocks = candidate.blocks;
      for (var i = direction > 0 ? 0 : blocks.length - 1; i >= 0 && i < blocks.length; i += direction) {
        final level = blocks[i].heading;
        if (level != null && (_headingLevel == 0 || level <= _headingLevel)) {
          await _loadDoc(json, highlight: false);
          _speech.jump(i);
          _announce(blocks[i].text);
          return;
        }
      }
    }
    // None anywhere: stay where the reader was.
    await _loadDoc(await _bridge.call<Map<String, dynamic>>('textAt', [TextRef(fromPath).toJson(), null]), highlight: false);
    _speech.jump(fromIndex);
    _announce(direction > 0 ? 'No next heading' : 'No previous heading');
  }

  Future<void> _stepPage(int direction) async {
    if (_usesClips) {
      final r = await _bridge.call<Map<String, dynamic>>('clipNav', ['page', direction, _clipIndex, 0]);
      if (r == null) return _announce(direction > 0 ? 'No next page' : 'No previous page');
      return _goTo(clipIndex: r['clipIndex'] as int, label: r['label'] as String);
    }
    final r = await _bridge.call<Map<String, dynamic>>('pageInText', [direction, _doc?.index ?? 0]);
    if (r == null) return _announce(direction > 0 ? 'No next page in this section' : 'No previous page in this section');
    _speech.jump(r['index'] as int);
    _announce(r['label'] as String);
  }

  /// Next (1) or previous (-1) entry of the table of contents.
  Future<void> _stepSection(int direction) async {
    final r = await _bridge.call<Map<String, dynamic>>('section', [direction, _contentsDepth, _usesClips, _clipIndex]);
    if (r == null) return _announce(direction > 0 ? 'No next section' : 'No previous section');
    if (r['none'] == true) return _announce('This book has no table of contents.');
    await _goTo(
      clipIndex: r['clipIndex'] as int?,
      target: r['target'] == null ? null : TextRef.fromJson(r['target'] as Map<String, dynamic>),
      label: r['label'] as String,
    );
  }

  Future<void> _goToPage() async {
    if (!(_book?.hasPages ?? false)) return _announce('This book has no page numbers.');
    final controller = TextEditingController();
    final label = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Go to page'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Page number'),
          onSubmitted: (v) => Navigator.pop(context, v),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Go')),
        ],
      ),
    );
    if (label == null || label.trim().isEmpty) return;
    final r = await _bridge.call<Map<String, dynamic>>('findPage', [label]);
    if (r == null) return _announce('Page $label not found');
    await _goTo(
      clipIndex: r['clipIndex'] as int?,
      target: r['target'] == null ? null : TextRef.fromJson(r['target'] as Map<String, dynamic>),
      label: r['label'] as String,
    );
  }

  Future<void> _showContents() async {
    final entries = [
      for (final e in _book?.toc ?? const <NavEntry>[]) ...e.flatten(),
    ].where((e) => _contentsDepth == 0 || e.level <= _contentsDepth).toList();
    final chosen = await showModalBottomSheet<NavEntry>(
      context: context,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        builder: (context, scroll) => Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text('Contents', style: Theme.of(context).textTheme.titleLarge, semanticsLabel: 'Contents'),
            ),
            Expanded(
              child: entries.isEmpty
                  ? const Center(child: Text('This book has no table of contents.'))
                  : ListView.builder(
                      controller: scroll,
                      itemCount: entries.length,
                      itemBuilder: (context, i) {
                        final e = entries[i];
                        return ListTile(
                          contentPadding: EdgeInsets.only(left: 16.0 * e.level, right: 16),
                          title: Text(e.label, semanticsLabel: '${e.label}, level ${e.level}'),
                          onTap: () => Navigator.pop(context, e),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
    if (chosen != null) await _goTo(clipIndex: chosen.clipIndex, target: chosen.target, label: chosen.label);
  }

  Future<void> _openSettings() async {
    final settings = await AppSettings.load();
    if (!mounted) return;
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SettingsScreen(settings: settings)));
    if (!mounted) return;
    if (settings.rate != _rate) {
      _rate = settings.rate;
      await _recorded?.setRate(_rate);
      await _speech.setRate(_rate);
    }
    _speech.voice = settings.voice;
    setState(() {
      _headingLevel = settings.headingDepth;
      _contentsDepth = settings.contentsDepth;
    });
    await _setTextOnly(settings.screenReaderMode);
  }

  // ---- location -----------------------------------------------------------------------

  Future<void> _updateLocation() async {
    final book = _book;
    if (book == null) return;
    String heading = '', page = '', time = '';
    if (_usesClips) {
      final loc = await _bridge.call<Map<String, dynamic>>('location', [_clipIndex]);
      heading = (loc?['heading'] as String?) ?? '';
      page = (loc?['page'] as String?) ?? '';
      if (book.duration > 0 && _clipIndex < book.clipStarts.length) {
        time = '${_formatTime(book.clipStarts[_clipIndex])} of ${_formatTime(book.duration)}';
      }
    } else if (_doc != null) {
      // A page may have no text at all (e.g. a cover picture), so stay within the blocks there are.
      final blocks = _doc!.blocks;
      for (var i = math.min(_doc!.index, blocks.length - 1); i >= 0; i--) {
        if (blocks[i].heading != null) {
          heading = blocks[i].text;
          break;
        }
      }
    }
    if (!mounted) return;
    setState(() {
      // Headings can hold line breaks, which TalkBack would read out.
      _heading = heading.replaceAll(RegExp(r'\s+'), ' ').trim();
      _page = page;
      _time = time;
    });
  }

  // ---- UI -----------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final book = _book;
    return Scaffold(
      appBar: AppBar(
        title: Text(book?.title ?? widget.book.title, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(tooltip: 'Contents', icon: const Icon(Icons.toc), onPressed: book == null ? null : _showContents),
          PopupMenuButton<String>(
            tooltip: 'More reading options',
            enabled: book != null,
            onSelected: (choice) => switch (choice) {
              'page' => _goToPage(),
              'next-page' => _stepPage(1),
              'prev-page' => _stepPage(-1),
              'next-section' => _stepSection(1),
              'prev-section' => _stepSection(-1),
              'settings' => _openSettings(),
              'close' => Navigator.of(context).maybePop(),
              'help' => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const HelpScreen())),
              _ => null,
            },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'page', child: Text('Go to page')),
              const PopupMenuItem(value: 'next-page', child: Text('Next page')),
              const PopupMenuItem(value: 'prev-page', child: Text('Previous page')),
              const PopupMenuItem(value: 'next-section', child: Text('Next section')),
              const PopupMenuItem(value: 'prev-section', child: Text('Previous section')),
              const PopupMenuItem(value: 'settings', child: Text('Settings')),
              const PopupMenuItem(value: 'help', child: Text('Help: reading commands')),
              const PopupMenuItem(value: 'close', child: Text('Close book')),
            ],
          ),
        ],
      ),
      body: _error != null
          ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_error!)))
          : Column(
              children: [
                if (book != null) _modeSelector(book),
                if (book != null) _locationBar(),
                AnnouncementRegion(announcer: _announcer),
                Expanded(
                  child: Stack(
                    children: [
                      // Kept alive in audio-only mode, but hidden from the screen and the screen reader.
                      Visibility(
                        visible: _mode != ReadingMode.audio,
                        maintainState: true,
                        child: WebViewWidget(controller: _bridge.controller),
                      ),
                      if (book == null) const Center(child: CircularProgressIndicator(semanticsLabel: 'Opening book')),
                      if (book != null && _mode == ReadingMode.audio)
                        const Center(
                          child: Padding(
                            padding: EdgeInsets.all(24),
                            child: Text('Audio only mode. The text is hidden. Use the buttons below to move through the book.',
                                textAlign: TextAlign.center),
                          ),
                        ),
                    ],
                  ),
                ),
                if (book != null) _controls(),
              ],
            ),
    );
  }

  /// Text, Audio and Both pick how the book is read; Screen reader shows it as one page of
  /// plain text for reading with TalkBack or VoiceOver (with the voice of Text, or Both).
  static const _screenReaderChoice = 'screen-reader';

  Future<void> _choose(String choice) async {
    if (choice == _screenReaderChoice) {
      // The text is hidden in audio only mode, so read it as text.
      if (_mode == ReadingMode.audio) await _setMode(ReadingMode.text);
      await _setTextOnly(true);
      return;
    }
    await _setTextOnly(false);
    await _setMode(ReadingMode.values.byName(choice));
  }

  Widget _modeSelector(OpenedBook book) => Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
        child: SegmentedButton<String>(
          showSelectedIcon: false,
          segments: [
            for (final m in ReadingMode.values)
              ButtonSegment(
                value: m.name,
                enabled: book.option(m).available,
                tooltip: m.label,
                label: Text(m.shortLabel, semanticsLabel: m.label),
              ),
            ButtonSegment(
              value: _screenReaderChoice,
              enabled: book.hasText,
              tooltip: 'Screen reader mode: the whole book as one page of plain text',
              label: const Text('Screen reader',
                  textAlign: TextAlign.center, maxLines: 2, semanticsLabel: 'Screen reader mode'),
            ),
          ],
          selected: {_textOnly ? _screenReaderChoice : _mode.name},
          onSelectionChanged: (s) => _choose(s.first),
        ),
      );

  Widget _locationBar() {
    final text = [_heading, _page, _time].where((s) => s.isNotEmpty).join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: Text(text, maxLines: 2, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodySmall),
    );
  }

  Widget _controls() => SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              IconButton(
                  tooltip: 'Previous heading', icon: const Icon(Icons.keyboard_double_arrow_up), onPressed: () => _stepHeading(-1)),
              IconButton(tooltip: 'Previous phrase', icon: const Icon(Icons.skip_previous), onPressed: () => _stepPhrase(-1)),
              IconButton.filled(
                tooltip: _playing ? 'Pause' : 'Play',
                iconSize: 36,
                icon: Icon(_playing ? Icons.pause : Icons.play_arrow),
                onPressed: _togglePlay,
              ),
              IconButton(tooltip: 'Next phrase', icon: const Icon(Icons.skip_next), onPressed: () => _stepPhrase(1)),
              IconButton(
                  tooltip: 'Next heading', icon: const Icon(Icons.keyboard_double_arrow_down), onPressed: () => _stepHeading(1)),
            ],
          ),
        ),
      );
}

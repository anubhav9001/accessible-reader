// Dart views of the data the WebView reader sends back (see web/src/reader.ts).

class TextRef {
  const TextRef(this.path, [this.fragment]);

  factory TextRef.fromJson(Map<String, dynamic> json) =>
      TextRef(json['path'] as String, json['fragment'] as String?);

  final String path;
  final String? fragment;

  Map<String, dynamic> toJson() => {'path': path, if (fragment != null) 'fragment': fragment};
}

class AudioClip {
  const AudioClip(this.path, this.begin, this.end);

  factory AudioClip.fromJson(Map<String, dynamic> json) => AudioClip(
        json['path'] as String,
        (json['begin'] as num).toDouble(),
        (json['end'] as num?)?.toDouble(),
      );

  final String path;
  final double begin;

  /// Null when the clip runs to the end of its file.
  final double? end;
}

/// One synchronised phrase: text, recorded audio, or both.
class Clip {
  const Clip(this.index, this.text, this.audio);

  factory Clip.fromJson(Map<String, dynamic> json) => Clip(
        json['index'] as int,
        json['text'] == null ? null : TextRef.fromJson(json['text'] as Map<String, dynamic>),
        json['audio'] == null ? null : AudioClip.fromJson(json['audio'] as Map<String, dynamic>),
      );

  final int index;
  final TextRef? text;
  final AudioClip? audio;
}

class NavEntry {
  const NavEntry(this.label, this.target, this.level, this.clipIndex, this.children);

  factory NavEntry.fromJson(Map<String, dynamic> json) => NavEntry(
        json['label'] as String,
        TextRef.fromJson(json['target'] as Map<String, dynamic>),
        (json['level'] as int?) ?? 1,
        json['clipIndex'] as int?,
        [for (final c in (json['children'] as List? ?? const [])) NavEntry.fromJson(c as Map<String, dynamic>)],
      );

  final String label;
  final TextRef target;
  final int level;
  final int? clipIndex;
  final List<NavEntry> children;

  Iterable<NavEntry> flatten() sync* {
    yield this;
    for (final c in children) {
      yield* c.flatten();
    }
  }
}

enum ReadingMode {
  text('Text only', 'Text'),
  audio('Audio only', 'Audio'),
  textAudio('Text and audio', 'Both');

  const ReadingMode(this.label, this.shortLabel);

  final String label;
  final String shortLabel;
}

class ModeOption {
  const ModeOption(this.mode, this.available, this.audioSource, this.reason);

  factory ModeOption.fromJson(Map<String, dynamic> json) => ModeOption(
        ReadingMode.values.byName(json['mode'] as String),
        json['available'] as bool,
        json['audioSource'] as String,
        json['reason'] as String?,
      );

  final ReadingMode mode;
  final bool available;

  /// 'recorded', 'tts' or 'none'.
  final String audioSource;
  final String? reason;
}

class OpenedBook {
  OpenedBook.fromJson(Map<String, dynamic> json)
      : title = (json['publication']['metadata']['title'] as String?) ?? '',
        authors = [for (final a in json['publication']['metadata']['authors'] as List) a as String],
        identifier = json['publication']['metadata']['identifier'] as String?,
        hasText = (json['publication']['readingOrder'] as List).isNotEmpty,
        narration = [
          for (final c in json['publication']['narration'] as List) Clip.fromJson(c as Map<String, dynamic>)
        ],
        toc = [for (final n in json['publication']['toc'] as List) NavEntry.fromJson(n as Map<String, dynamic>)],
        hasPages = (json['publication']['pageList'] as List).isNotEmpty,
        modes = [for (final m in json['modes'] as List) ModeOption.fromJson(m as Map<String, dynamic>)],
        defaultMode = ReadingMode.values.byName(json['defaultMode'] as String),
        clipStarts = [for (final s in json['clipStarts'] as List) (s as num).toDouble()],
        duration = (json['duration'] as num).toDouble();

  final String title;
  final List<String> authors;
  final String? identifier;
  final bool hasText;
  final List<Clip> narration;
  final List<NavEntry> toc;
  final bool hasPages;
  final List<ModeOption> modes;
  final ReadingMode defaultMode;
  final List<double> clipStarts;
  final double duration;

  ModeOption option(ReadingMode mode) => modes.firstWhere((m) => m.mode == mode);
}

class TextBlock {
  const TextBlock(this.text, this.heading);

  final String text;

  /// Heading level 1–6, or null for ordinary text.
  final int? heading;
}

/// A text document loaded for reading block by block.
class TextDoc {
  TextDoc.fromJson(Map<String, dynamic> json)
      : path = json['path'] as String,
        index = json['index'] as int,
        lang = (json['lang'] as String?) ?? '',
        blocks = [
          for (final b in json['blocks'] as List)
            TextBlock((b as Map<String, dynamic>)['text'] as String, b['heading'] as int?)
        ];

  final String path;
  int index;
  final String lang;
  final List<TextBlock> blocks;
}

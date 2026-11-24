import 'package:flutter/material.dart';

import 'models.dart';

/// One part of an information screen: a heading and its rows of label and value.
class InfoSection {
  const InfoSection(this.heading, this.rows);

  final String heading;
  final List<(String, String?)> rows;
}

/// Book information or Where am I: each part a heading (TalkBack's headings control moves between
/// them), each row one item read as "label, value". Empty rows are left out.
class InfoScreen extends StatelessWidget {
  const InfoScreen({super.key, required this.title, required this.sections});

  final String title;
  final List<InfoSection> sections;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ListView(
        children: [
          for (final section in sections)
            if (section.rows.any((r) => (r.$2 ?? '').trim().isNotEmpty)) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
                child: Semantics(header: true, child: Text(section.heading, style: theme.textTheme.titleMedium)),
              ),
              for (final (label, value) in section.rows)
                if ((value ?? '').trim().isNotEmpty)
                  // One item for TalkBack, label then value ("Author: DAISY Consortium").
                  Semantics(
                    container: true,
                    label: '$label: ${value!.trim()}',
                    child: ExcludeSemantics(
                      child: ListTile(
                        title: Text(label, style: theme.textTheme.bodySmall),
                        subtitle: Text(value.trim(), style: theme.textTheme.bodyLarge),
                      ),
                    ),
                  ),
            ],
        ],
      ),
    );
  }
}

const _formats = {'epub': 'EPUB', 'daisy202': 'DAISY 2.02', 'daisy3': 'DAISY 3'};

/// What a DAISY multimedia type means, in words.
const _multimedia = {
  'audiofulltext': 'audio and full text',
  'audioparttext': 'audio and part of the text',
  'audioonly': 'audio only',
  'audioncc': 'audio, with headings only',
  'audionctext': 'audio with headings, and text',
  'textpartaudio': 'text, with audio for part of it',
  'textncc': 'text, with headings only',
  'textonly': 'text only',
  'textnctext': 'text only',
};

/// "1 hour 20 minutes", "less than a minute".
String spokenDuration(num seconds) {
  if (seconds < 60) return 'less than a minute';
  final h = seconds ~/ 3600;
  final m = ((seconds % 3600) / 60).round();
  return [if (h > 0) '$h hour${h == 1 ? '' : 's'}', '$m minute${m == 1 ? '' : 's'}'].join(' ');
}

/// Book information: what the book says about itself, what it holds, then every metadata entry.
/// As on Windows (info-dialog.ts).
List<InfoSection> bookInfoSections(OpenedBook book) {
  List<String> many(String name) => [for (final e in book.entries) if (e.name.toLowerCase() == name) e.value];
  final type = book.multimediaType == null ? null : _multimedia[book.multimediaType!.toLowerCase()] ?? book.multimediaType;
  final contents = book.toc.expand((n) => n.flatten()).length;
  final pages = book.pageLabels;
  return [
    InfoSection('About this book', [
      ('Title', book.title),
      (book.authors.length > 1 ? 'Authors' : 'Author', book.authors.join(', ')),
      (book.narrators.length > 1 ? 'Narrators' : 'Narrator', book.narrators.join(', ')),
      ('Publisher', book.publisher),
      ('Date', many('dc:date').firstOrNull),
      ('Language', book.language),
      ('Subject', many('dc:subject').join('; ')),
      ('Description', many('dc:description').join(' ')),
      ('Rights', many('dc:rights').join(' ')),
      ('Identifier', book.identifier),
    ]),
    InfoSection('What the book holds', [
      ('Format', [_formats[book.format] ?? book.format, ?type].join(', ')),
      (
        'Recorded narration',
        book.narration.isEmpty ? 'No' : 'Yes${book.declaredDuration != null ? ', ${spokenDuration(book.declaredDuration!)}' : ''}'
      ),
      ('Text', book.readingOrder.isEmpty ? 'None (audio only)' : '${book.readingOrder.length} section${book.readingOrder.length == 1 ? '' : 's'}'),
      ('Contents', contents == 0 ? 'None' : '$contents ${contents == 1 ? 'entry' : 'entries'}'),
      ('Printed pages', pages.isEmpty ? 'Not marked' : '${pages.length}, from ${pages.first} to ${pages.last}'),
    ]),
    InfoSection('Accessibility, as the book declares it', [
      for (final e in book.entries)
        if (RegExp(r'^(schema:)?access|^a11y:|conformsto', caseSensitive: false).hasMatch(e.name)) (e.name, e.value),
    ]),
    InfoSection('All metadata in the book', [for (final e in book.entries) (e.name, e.value)]),
  ];
}

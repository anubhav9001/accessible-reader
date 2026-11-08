import 'package:flutter/material.dart';

import 'app_version.dart';

/// "Reading commands": what every button and menu item in the app does.
class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  static const _sections = <(String, List<(String, String)>)>[
    (
      'Reading modes',
      [
        ('Text', 'Shows the book text. Play reads it aloud with the phone\'s voice.'),
        ('Audio', 'Plays the book\'s recorded narration, or the phone\'s voice if it has none. The text is hidden.'),
        ('Both', 'Plays the narration and highlights each phrase in the text as it is read.'),
        ('Screen reader', 'Shows the whole book as one page of plain text, without pictures or styling, but with its headings, lists, tables and links. Read straight through with TalkBack or VoiceOver, or use their reading controls to move by heading, link or table. An outline marks where you are, and the app opens the book there next time. Play reads aloud from your place.'),
        ('Unavailable modes', 'A mode the book cannot support is dimmed, for example Text for a book with audio only.'),
      ],
    ),
    (
      'Buttons at the bottom of the reader',
      [
        ('Play or Pause', 'Starts or stops reading from the current phrase.'),
        ('Previous phrase and Next phrase', 'Move back or forward one phrase or paragraph.'),
        ('Previous heading and Next heading', 'Jump to the previous or next chapter or section heading.'),
      ],
    ),
    (
      'Top of the reader',
      [
        ('Contents', 'Lists the book\'s chapters and sections. Choose one to go there.'),
        ('Go to page', 'In the More reading options menu. Type a printed page number to go to that page.'),
        ('Next page and Previous page', 'In the same menu. Move by printed page.'),
        ('Next section and Previous section', 'In the same menu. Move to the next or previous entry of the contents.'),
        ('Close book', 'In the same menu. Goes back to My books; your place is kept.'),
        ('Settings', 'In the More reading options menu, or on the My books screen. Reading speed, the voice for reading aloud, heading depth (which headings Previous and Next heading stop at, such as chapters only), how many levels the contents list shows, and screen reader mode. Remembered for all books.'),
      ],
    ),
    (
      'Getting books',
      [
        ('Add book', 'On My books. Opens an EPUB or zipped DAISY book stored on this phone.'),
        ('Online libraries', 'On My books. Choose Sugamya Pustakalaya to search and browse its books, or Project Gutenberg to search, browse and choose Download and open.'),
        ('Remove from phone', 'In a book\'s options menu on My books.'),
      ],
    ),
    (
      'Good to know',
      [
        ('Your place', 'The app remembers where you stopped in each book, down to the paragraph, also when TalkBack or VoiceOver was reading, and takes you back there when you open the book again.'),
        ('Screen readers', 'With TalkBack or VoiceOver, swipe through the book text as on any page. Stepping by phrase moves the screen reader to the new phrase.'),
        ('Background listening', 'Reading stops when the screen locks or you leave the app. This will change in a later version.'),
      ],
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Reading commands')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          for (final (title, items) in _sections) ...[
            Padding(
              padding: const EdgeInsets.only(top: 20, bottom: 4),
              child: Semantics(header: true, child: Text(title, style: theme.textTheme.titleLarge)),
            ),
            for (final (name, description) in items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                // Read as one item: the command name, then what it does.
                child: MergeSemantics(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name, style: theme.textTheme.titleMedium),
                      Text(description),
                    ],
                  ),
                ),
              ),
          ],
          const Padding(padding: EdgeInsets.only(top: 24), child: AppVersionText()),
        ],
      ),
    );
  }
}

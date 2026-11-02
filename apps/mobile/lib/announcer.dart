import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

/// Messages for TalkBack and VoiceOver: "End of book", the phrase just stepped to, and so on.
///
/// Android 16 and later no longer speak app announcements, so on Android the message goes
/// into a status line marked as a live region ([AnnouncementRegion]), which TalkBack reads
/// whenever it changes. iOS keeps using announcements.
class Announcer extends ChangeNotifier {
  String message = '';
  bool _flip = false;

  void say(BuildContext context, String text) {
    if (Platform.isIOS) {
      SemanticsService.sendAnnouncement(View.of(context), text, TextDirection.ltr);
      return;
    }
    // Saying the same words twice must still change the text, or TalkBack stays quiet.
    _flip = !_flip;
    message = _flip ? text : '$text​';
    notifyListeners();
  }
}

/// The status line that speaks an [Announcer]'s messages on Android.
class AnnouncementRegion extends StatelessWidget {
  const AnnouncementRegion({super.key, required this.announcer});

  final Announcer announcer;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: announcer,
        builder: (context, _) => announcer.message.isEmpty
            ? const SizedBox.shrink()
            : Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Semantics(
                  liveRegion: true,
                  container: true,
                  child: Text(announcer.message,
                      maxLines: 2, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.bodySmall),
                ),
              ),
      );
}

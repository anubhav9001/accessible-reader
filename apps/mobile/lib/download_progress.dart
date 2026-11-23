import 'package:flutter/material.dart';

// Download progress for both libraries. Mirrors packages/engine/src/progress.ts, so the two apps
// say the same words.

/// A size for people: "850 KB", "12.3 MB", "1.2 GB" ("12 MB", not "12.0 MB": it is spoken).
String sizeText(int bytes) {
  String short(double n, int digits) => n.toStringAsFixed(digits).replaceFirst(RegExp(r'\.0$'), '');
  if (bytes < 1000000) return '${(bytes / 1000).round().clamp(1, 999)} KB';
  if (bytes < 1000000000) return '${short(bytes / 1000000, bytes < 100000000 ? 1 : 0)} MB';
  return '${short(bytes / 1000000000, 1)} GB';
}

/// How far a download is: "40 percent, 12 MB of 30 MB", or "12 MB so far" when the size isn't known.
String downloadProgressText(int received, int total) {
  if (total > 0) return '${(received * 100 ~/ total).clamp(0, 100)} percent, ${sizeText(received)} of ${sizeText(total)}';
  return '${sizeText(received)} so far';
}

/// Changes when the reader should hear how a download is going: every 10 percent, or every
/// 10 MB when the size isn't known. Starts at 0.
int downloadStep(int received, int total) => total > 0 ? (received * 10 ~/ total).clamp(0, 10) : received ~/ 10000000;

/// A book download's progress: a bar TalkBack reads as "Downloading <title>, 40 percent, 12 MB
/// of 30 MB", with the same words shown above it.
class DownloadProgressBar extends StatelessWidget {
  const DownloadProgressBar({super.key, required this.title, required this.received, required this.total});

  final String title;
  final int received;

  /// The whole size, or 0 when the library doesn't say.
  final int total;

  @override
  Widget build(BuildContext context) {
    final text = received == 0 ? 'Starting' : downloadProgressText(received, total);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The bar carries these words for TalkBack; shown here for everyone else.
          ExcludeSemantics(child: Text('Downloading $title: $text')),
          const SizedBox(height: 6),
          LinearProgressIndicator(
            value: total > 0 ? (received / total).clamp(0.0, 1.0) : null,
            minHeight: 8,
            semanticsLabel: 'Downloading $title',
            semanticsValue: text,
          ),
        ],
      ),
    );
  }
}

import 'app_log.dart';
import 'dart:async';
import 'dart:convert';

import 'package:webview_flutter/webview_flutter.dart';

import 'models.dart';

/// Request/reply link to the reader page in the WebView (web/src/reader.ts).
class ReaderBridge {
  ReaderBridge({required this.onLink, required this.onPlace, this.onPicture}) {
    controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel('ReaderChannel', onMessageReceived: _onMessage)
      ..setNavigationDelegate(NavigationDelegate(
        // The page never navigates; links inside books are handled by the reader.
        onNavigationRequest: (request) =>
            request.url.startsWith('http://127.0.0.1') ? NavigationDecision.navigate : NavigationDecision.prevent,
      ));
  }

  final WebViewController controller = WebViewController();
  /// A link in the book was followed; [from] is the block it was in (document path and block), for Go back.
  final void Function(TextRef target, (String, int)? from) onLink;

  /// The screen reader moved to block [index] of the document at [path]; [clip] narrates it.
  final void Function(String path, int index, int? clip) onPlace;

  /// A picture in the text was tapped: its address and description, to show it enlarged.
  final void Function(String src, String alt)? onPicture;
  final _pending = <int, Completer<Object?>>{};
  Completer<void> _ready = Completer<void>();
  int _nextId = 0;

  Future<void> load(String url) async {
    _ready = Completer<void>();
    await controller.loadRequest(Uri.parse(url));
    await _ready.future.timeout(const Duration(seconds: 20));
  }

  Future<T?> call<T>(String method, [List<Object?> args = const []]) {
    final id = ++_nextId;
    final completer = Completer<Object?>();
    _pending[id] = completer;
    controller.runJavaScript('readerBridge.call($id, ${jsonEncode(method)}, ${jsonEncode(args)})');
    return completer.future.then((value) => value as T?);
  }

  void _onMessage(JavaScriptMessage message) {
    final msg = jsonDecode(message.message) as Map<String, dynamic>;
    switch (msg['type']) {
      case 'ready':
        if (!_ready.isCompleted) _ready.complete();
      case 'result':
        final completer = _pending.remove(msg['id'] as int);
        if (completer == null) return;
        if (msg['error'] != null) {
          AppLog.write('error', 'web', 'Bridge call failed: ${msg['error']}');
          completer.completeError(Exception(msg['error']));
        } else {
          completer.complete(msg['value']);
        }
      case 'link':
        final from = msg['from'] as Map<String, dynamic>?;
        onLink(TextRef.fromJson(msg['target'] as Map<String, dynamic>),
            from == null ? null : (from['path'] as String, from['index'] as int));
      case 'log':
        AppLog.write(msg['level'] as String? ?? 'info', 'web', msg['message'] as String? ?? '');
      case 'place':
        onPlace(msg['path'] as String, msg['index'] as int, msg['clip'] as int?);
      case 'picture':
        onPicture?.call(msg['src'] as String, msg['alt'] as String? ?? '');
    }
  }
}

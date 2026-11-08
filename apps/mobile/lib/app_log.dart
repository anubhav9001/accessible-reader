import 'dart:io';

import 'package:package_info_plus/package_info_plus.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// The tester log: a plain text file of what the app did (start, books opened, menu choices,
/// what it said to the screen reader, mode changes) and every error, so a problem a tester
/// reports can be traced. Kept in pre-release builds only (versions below 1.0, or with a
/// pre-release tag such as 1.2.0-beta.1). It never holds the book's text or full file paths.
///
/// The file is in the app's folder on the phone's storage (Android/data/…/files/logs), so it
/// can be copied off over USB, and Help can copy it to share it. reader.log grows to 1 MB,
/// then becomes reader.old.log.
class AppLog {
  AppLog._();

  static File? _file;
  static File? _old;
  static bool get enabled => _file != null;

  /// The log file, for Help to show and copy.
  static File? get file => _file;

  static Future<void> init() async {
    try {
      final pkg = await PackageInfo.fromPlatform();
      final version = pkg.version;
      if (!(version.startsWith('0.') || version.contains('-'))) return;
      final base = (Platform.isAndroid ? await getExternalStorageDirectory() : null) ?? await getApplicationDocumentsDirectory();
      final dir = Directory(p.join(base.path, 'logs'));
      await dir.create(recursive: true);
      _file = File(p.join(dir.path, 'reader.log'));
      _old = File(p.join(dir.path, 'reader.old.log'));
      info('app',
          'Reader ${pkg.version} (build ${pkg.buildNumber}) started. ${Platform.operatingSystem} ${Platform.operatingSystemVersion}.');
    } catch (_) {
      _file = null;
    }
  }

  static void write(String level, String source, String message) {
    final file = _file;
    if (file == null) return;
    final clean = message
        .replaceAll(RegExp(r'/(?:data|storage)/[^\s]*/([^/\s]+)'), '…/\$1')
        .replaceAll(RegExp(r'[\r\n]+'), ' ⏎ ');
    final line = '${DateTime.now().toUtc().toIso8601String()} ${level.toUpperCase().padRight(5)} [$source] '
        '${clean.length > 2000 ? clean.substring(0, 2000) : clean}\n';
    try {
      if (file.existsSync() && file.lengthSync() > 1000000) file.renameSync(_old!.path);
      file.writeAsStringSync(line, mode: FileMode.append, flush: true);
    } catch (_) {
      // Logging must never break the app.
    }
  }

  static void info(String source, String message) => write('info', source, message);
  static void error(String source, Object error, [StackTrace? stack]) =>
      write('error', source, '$error${stack == null ? '' : ' $stack'}');

  /// The whole log (the older part first), for Help to copy.
  static String read() {
    final parts = [
      if (_old?.existsSync() ?? false) _old!.readAsStringSync(),
      if (_file?.existsSync() ?? false) _file!.readAsStringSync(),
    ];
    return parts.join();
  }
}

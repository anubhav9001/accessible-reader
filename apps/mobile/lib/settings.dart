import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Choices that hold for every book, kept on the phone between sessions.
class AppSettings {
  AppSettings._(this._prefs);

  final SharedPreferences _prefs;

  static const rates = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

  static Future<AppSettings> load() async => AppSettings._(await SharedPreferences.getInstance());

  /// 1.0 is normal speed.
  double get rate {
    final r = _prefs.getDouble('readingSpeed') ?? 1.0;
    return rates.contains(r) ? r : 1.0;
  }

  set rate(double value) => _prefs.setDouble('readingSpeed', value);

  /// Which headings next and previous heading stop at: 0 for all, otherwise levels 1 to this.
  int get headingDepth => (_prefs.getInt('headingDepth') ?? 0).clamp(0, 6);
  set headingDepth(int value) => _prefs.setInt('headingDepth', value);

  /// How many levels of the contents are listed: 0 for all.
  int get contentsDepth => (_prefs.getInt('contentsDepth') ?? 0).clamp(0, 6);
  set contentsDepth(int value) => _prefs.setInt('contentsDepth', value);

  /// The chosen reading voice ({name, locale}), or null to match each book's language.
  Map<String, String>? get voice {
    final name = _prefs.getString('voiceName');
    final locale = _prefs.getString('voiceLocale');
    return name == null || locale == null ? null : {'name': name, 'locale': locale};
  }

  set voice(Map<String, String>? value) {
    if (value == null) {
      _prefs.remove('voiceName');
      _prefs.remove('voiceLocale');
    } else {
      _prefs.setString('voiceName', value['name']!);
      _prefs.setString('voiceLocale', value['locale']!);
    }
  }

  /// Screen reader mode: the whole book as one page of plain text.
  bool get screenReaderMode => _prefs.getBool('screenReaderMode') ?? false;
  set screenReaderMode(bool value) => _prefs.setBool('screenReaderMode', value);

  static String speedLabel(double r) => r == 1.0 ? 'Normal (1×)' : '$r×';

  static String depthLabel(int level) => switch (level) {
        0 => 'All levels',
        1 => 'Level 1 only',
        _ => 'Levels 1 to $level',
      };
}

/// One screen for the reading choices: speed, voice, heading depth, contents and screen reader mode.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.settings});

  final AppSettings settings;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  AppSettings get _s => widget.settings;

  Future<T?> _choose<T>(String title, List<(T, String)> options, T current) {
    return showDialog<T>(
      context: context,
      builder: (context) => SimpleDialog(
        title: Text(title),
        children: [
          for (final (value, label) in options)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(context, value),
              child: Text(value == current ? '$label (current)' : label),
            ),
        ],
      ),
    );
  }

  Future<void> _chooseSpeed() async {
    final r = await _choose('Reading speed', [for (final r in AppSettings.rates) (r, AppSettings.speedLabel(r))], _s.rate);
    if (r != null) setState(() => _s.rate = r);
  }

  Future<void> _chooseDepth() async {
    final l = await _choose('Heading depth', [for (var l = 0; l <= 6; l++) (l, AppSettings.depthLabel(l))], _s.headingDepth);
    if (l != null) setState(() => _s.headingDepth = l);
  }

  Future<void> _chooseContents() async {
    final l = await _choose('Contents: levels listed', [for (var l = 0; l <= 3; l++) (l, AppSettings.depthLabel(l))], _s.contentsDepth);
    if (l != null) setState(() => _s.contentsDepth = l);
  }

  Future<void> _chooseVoice() async {
    List<Map<String, String>> voices = const [];
    try {
      final raw = await FlutterTts().getVoices.timeout(const Duration(seconds: 4)) as List<dynamic>?;
      voices = [
        for (final v in raw ?? const [])
          if (v is Map && v['name'] != null && v['locale'] != null)
            {
              'name': '${v['name']}',
              'locale': '${v['locale']}',
              if (v['network_required'] == '1') 'network': '1',
            }
      ]..sort((a, b) => '${a['locale']} ${a['name']}'.compareTo('${b['locale']} ${b['name']}'));
    } catch (_) {
      // No list: only Automatic is offered.
    }
    if (!mounted) return;
    const automatic = <String, String>{};
    final current = _s.voice;
    final chosen = await showDialog<Map<String, String>>(
      context: context,
      builder: (context) => SimpleDialog(
        title: const Text('Voice for reading aloud'),
        children: [
          SimpleDialogOption(
            onPressed: () => Navigator.pop(context, automatic),
            child: Text("Automatic (matches the book's language)${current == null ? ' (current)' : ''}"),
          ),
          if (voices.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('No voices were found on this phone.')),
          for (final v in voices)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(context, {'name': v['name']!, 'locale': v['locale']!}),
              child: Text('${v['locale']}: ${v['name']}${v['network'] != null ? ', needs internet' : ''}'
                  '${current?['name'] == v['name'] ? ' (current)' : ''}'),
            ),
        ],
      ),
    );
    if (chosen == null) return;
    setState(() => _s.voice = chosen.isEmpty ? null : chosen);
  }

  @override
  Widget build(BuildContext context) {
    final voice = _s.voice;
    Widget section(String title) => Padding(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
          child: Semantics(
            header: true,
            child: Text(title, style: Theme.of(context).textTheme.titleSmall),
          ),
        );
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          section('Reading'),
          ListTile(title: const Text('Reading speed'), subtitle: Text(AppSettings.speedLabel(_s.rate)), onTap: _chooseSpeed),
          ListTile(
            title: const Text('Voice for reading aloud'),
            subtitle: Text(voice == null ? "Automatic (matches the book's language)" : '${voice['locale']}: ${voice['name']}'),
            onTap: _chooseVoice,
          ),
          section('Navigation'),
          ListTile(
            title: const Text('Heading depth'),
            subtitle: Text('${AppSettings.depthLabel(_s.headingDepth)}. Next and previous heading stop at these.'),
            onTap: _chooseDepth,
          ),
          ListTile(
            title: const Text('Contents: levels listed'),
            subtitle: Text(AppSettings.depthLabel(_s.contentsDepth)),
            onTap: _chooseContents,
          ),
          section('Screen reader'),
          SwitchListTile(
            title: const Text('Screen reader mode'),
            subtitle: const Text('The whole book as one page of plain text, for TalkBack and VoiceOver'),
            value: _s.screenReaderMode,
            onChanged: (on) => setState(() => _s.screenReaderMode = on),
          ),
        ],
      ),
    );
  }
}

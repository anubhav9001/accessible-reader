import 'package:flutter/material.dart';

import 'settings.dart';

/// The choices for how the book's text looks, as in the shared rules (web-view, display.ts,
/// DISPLAY_CHOICES), which apply them. Values are what the rules expect; labels are what the reader sees.
final displayChoices = <String, List<(Object, String)>>{
  'font': [
    ('book', "The book's own"),
    ('sans', 'Sans serif (plain)'),
    ('serif', 'Serif'),
    ('readable', 'Wide and readable (Verdana)'),
    ('mono', 'Even width (monospace)'),
  ],
  'size': [
    for (final n in [75, 90, 100, 115, 130, 150, 175, 200, 250, 300]) (n, '$n percent')
  ],
  'line': [(0, 'Normal'), (1.2, 'Tight (1.2)'), (1.5, '1.5'), (2, 'Double (2)'), (2.5, '2.5'), (3, 'Triple (3)')],
  'word': [(0, 'Normal'), (0.15, 'Wider'), (0.3, 'Widest')],
  'letter': [(0, 'Normal'), (0.05, 'Wider'), (0.12, 'Widest')],
  'width': [('full', 'Full width (narrow margins)'), ('normal', 'Normal'), ('narrow', 'Narrow column (wide margins)')],
  'colours': [
    ('app', 'Follow the app (light or dark)'),
    ('dark', 'White on black'),
    ('light', 'Black on white'),
    ('yellow-black', 'Yellow on black'),
    ('white-black', 'White on dark blue'),
    ('black-yellow', 'Black on yellow'),
    ('sepia', 'Dark brown on cream (sepia)'),
    ('custom', 'Your own colours'),
  ],
};

/// Colours to pick from for "Your own colours" (no colour wheel: named colours read well with TalkBack).
const namedColours = [
  ('#000000', 'Black'),
  ('#ffffff', 'White'),
  ('#ffff00', 'Yellow'),
  ('#ffff66', 'Light yellow'),
  ('#00ff00', 'Bright green'),
  ('#00ffff', 'Cyan'),
  ('#00264d', 'Dark blue'),
  ('#1f3864', 'Navy'),
  ('#3b2a1a', 'Dark brown'),
  ('#f6ecd6', 'Cream'),
  ('#222222', 'Dark grey'),
  ('#dddddd', 'Light grey'),
  ('#ff9900', 'Orange'),
  ('#ffcccc', 'Pink'),
];

const _defaults = <String, Object>{
  'font': 'book',
  'bold': false,
  'size': 100,
  'line': 0,
  'word': 0,
  'letter': 0,
  'justify': false,
  'width': 'normal',
  'colours': 'app',
  'fg': '#000000',
  'bg': '#ffffff',
  'hidePages': false,
};

/// Settings, Display: how the book's text looks. Each choice is saved at once; the reader applies
/// them when you go back to the book.
class DisplaySettingsScreen extends StatefulWidget {
  const DisplaySettingsScreen({super.key, required this.settings});

  final AppSettings settings;

  @override
  State<DisplaySettingsScreen> createState() => _DisplaySettingsScreenState();
}

class _DisplaySettingsScreenState extends State<DisplaySettingsScreen> {
  late Map<String, Object?> _d = {..._defaults, ...widget.settings.display};

  void _set(String key, Object value) {
    setState(() => _d = {..._d, key: value});
    widget.settings.display = _d;
  }

  String _label(String key) {
    final value = _d[key];
    for (final (v, label) in displayChoices[key]!) {
      if (v == value || (v is num && value is num && v.toDouble() == value.toDouble())) return label;
    }
    return '$value';
  }

  String _colourName(String hex) => namedColours.where((c) => c.$1 == hex.toLowerCase()).map((c) => c.$2).firstOrNull ?? hex;

  Future<void> _choose(String key, String title) async {
    final current = _d[key];
    final chosen = await showDialog<Object>(
      context: context,
      builder: (context) => SimpleDialog(
        title: Text(title),
        children: [
          for (final (value, label) in displayChoices[key]!)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(context, value),
              child: Text(value == current ? '$label (current)' : label),
            ),
        ],
      ),
    );
    if (chosen != null) _set(key, chosen);
  }

  Future<void> _chooseColour(String key, String title) async {
    final current = '${_d[key]}'.toLowerCase();
    final chosen = await showDialog<String>(
      context: context,
      builder: (context) => SimpleDialog(
        title: Text(title),
        children: [
          for (final (hex, name) in namedColours)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(context, hex),
              child: Row(children: [
                ExcludeSemantics(
                  child: Container(
                    width: 28,
                    height: 28,
                    margin: const EdgeInsets.only(right: 12),
                    decoration: BoxDecoration(color: Color(int.parse('ff${hex.substring(1)}', radix: 16)), border: Border.all()),
                  ),
                ),
                Text(hex == current ? '$name (current)' : name),
              ]),
            ),
        ],
      ),
    );
    if (chosen != null) _set(key, chosen);
  }

  @override
  Widget build(BuildContext context) {
    ListTile choice(String key, String title) => ListTile(title: Text(title), subtitle: Text(_label(key)), onTap: () => _choose(key, title));
    SwitchListTile toggle(String key, String title, [String? subtitle]) => SwitchListTile(
          title: Text(title),
          subtitle: subtitle == null ? null : Text(subtitle),
          value: _d[key] == true,
          onChanged: (on) => _set(key, on),
        );
    return Scaffold(
      appBar: AppBar(title: const Text('Display')),
      body: ListView(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text("How the book's text looks. Changes are saved at once and show when you go back to the book."),
          ),
          choice('font', 'Typeface'),
          choice('size', 'Text size'),
          toggle('bold', 'Bold text'),
          choice('line', 'Line spacing'),
          choice('word', 'Space between words'),
          choice('letter', 'Space between letters'),
          choice('width', 'Line length and margins'),
          toggle('justify', "Keep the book's justified text", 'Lines spread to both edges'),
          choice('colours', 'Text and background colours'),
          if (_d['colours'] == 'custom') ...[
            ListTile(title: const Text('Text colour'), subtitle: Text(_colourName('${_d['fg']}')), onTap: () => _chooseColour('fg', 'Text colour')),
            ListTile(
                title: const Text('Background colour'), subtitle: Text(_colourName('${_d['bg']}')), onTap: () => _chooseColour('bg', 'Background colour')),
          ],
          toggle('hidePages', 'Hide printed page numbers in the text'),
          ListTile(
            title: const Text('Reset display settings'),
            leading: const Icon(Icons.restart_alt),
            onTap: () {
              setState(() => _d = {..._defaults});
              widget.settings.display = _d;
            },
          ),
        ],
      ),
    );
  }
}

/// A picture from the book, to enlarge: pinch to zoom and drag, or Larger and Smaller.
class PictureScreen extends StatefulWidget {
  const PictureScreen({super.key, required this.src, required this.alt});

  final String src;
  final String alt;

  @override
  State<PictureScreen> createState() => _PictureScreenState();
}

class _PictureScreenState extends State<PictureScreen> {
  final _zoom = TransformationController();

  void _scale(double by) {
    final now = _zoom.value.getMaxScaleOnAxis();
    final next = (now * by).clamp(1.0, 8.0);
    setState(() => _zoom.value = Matrix4.identity()..scaleByDouble(next, next, next, 1));
  }

  @override
  void dispose() {
    _zoom.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Picture'),
          actions: [
            IconButton(tooltip: 'Larger', icon: const Icon(Icons.zoom_in), onPressed: () => _scale(1.5)),
            IconButton(tooltip: 'Smaller', icon: const Icon(Icons.zoom_out), onPressed: () => _scale(1 / 1.5)),
          ],
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(widget.alt.isEmpty ? 'This picture has no description.' : widget.alt),
            ),
            Expanded(
              child: InteractiveViewer(
                transformationController: _zoom,
                minScale: 1,
                maxScale: 8,
                child: Center(child: Image.network(widget.src, semanticLabel: widget.alt, fit: BoxFit.contain)),
              ),
            ),
          ],
        ),
      );
}

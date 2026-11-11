import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:url_launcher/url_launcher.dart';

import 'announcer.dart';
import 'book_store.dart';
import 'opds.dart';
import 'sugamya.dart';
import 'sugamya_account.dart';

/// What the Sugamya screens share: the catalogue, the reader's account, and where downloaded
/// books go.
class SugamyaServices {
  const SugamyaServices({required this.client, required this.account, required this.store, required this.onBook});

  final SugamyaClient client;
  final SugamyaAccount account;
  final BookStore store;
  final Future<void> Function(StoredBook book) onBook;
}

String _message(Object e) => e is CatalogException ? e.message : '$e';

/// On a book's details: "Ask for this book", or what stands in its way.
class SugamyaRequestPart extends StatefulWidget {
  const SugamyaRequestPart({super.key, required this.services, required this.id, required this.title, required this.format});

  final SugamyaServices services;
  final String id;
  final String title;
  final String format;

  @override
  State<SugamyaRequestPart> createState() => _SugamyaRequestPartState();
}

class _SugamyaRequestPartState extends State<SugamyaRequestPart> {
  SugamyaAccountInfo? _account;
  bool _loaded = false;
  bool _asking = false;
  String? _reply;
  final _replyFocus = FocusNode();

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _replyFocus.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    final account = await widget.services.account.info();
    if (mounted) {
      setState(() {
        _account = account;
        _loaded = true;
      });
    }
  }

  Future<void> _ask() async {
    setState(() => _asking = true);
    try {
      final reply = await widget.services.account.requestBook(widget.id, widget.format);
      if (!mounted) return;
      setState(() => _reply = reply);
      WidgetsBinding.instance.addPostFrameCallback((_) => _replyFocus.requestFocus());
    } catch (e) {
      if (!mounted) return;
      setState(() => _asking = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${widget.title}: ${_message(e)}')));
    }
  }

  void _push(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final f = widget.format;
    if (f.isEmpty || f == sugamyaNotAvailable || !sugamyaFormatReadable(f) || sugamyaFormatId(f) == null) {
      return const Text("Reader can't download this copy. Search for the same title in a DAISY or EPUB format.");
    }
    if (!_loaded) return const SizedBox.shrink();
    if (_account == null) {
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('To download this book, sign in with your Sugamya Pustakalaya account.'),
        const SizedBox(height: 8),
        FilledButton(onPressed: () => _push(SugamyaSignInScreen(services: widget.services)), child: const Text('Sign in to ask for this book')),
      ]);
    }
    if (_reply != null) {
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Focus(
          focusNode: _replyFocus,
          child: Text('$_reply Sugamya Pustakalaya prepares the book, which can take a few hours. When it\'s ready, it shows '
              'in My download requests (and the library sends you an email or SMS); download it from there.'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: () => _push(SugamyaRequestsScreen(services: widget.services)), child: const Text('My download requests')),
      ]);
    }
    return FilledButton(onPressed: _asking ? null : _ask, child: Text(_asking ? 'Asking Sugamya Pustakalaya…' : 'Ask for this book'));
  }
}

/// Sign in, or (when signed in) who is signed in, with Sign out.
class SugamyaSignInScreen extends StatefulWidget {
  const SugamyaSignInScreen({super.key, required this.services});

  final SugamyaServices services;

  @override
  State<SugamyaSignInScreen> createState() => _SugamyaSignInScreenState();
}

class _SugamyaSignInScreenState extends State<SugamyaSignInScreen> {
  final _announcer = Announcer();
  final _user = TextEditingController();
  final _password = TextEditingController();
  final _passwordFocus = FocusNode();
  SugamyaAccountInfo? _account;
  bool _loaded = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    widget.services.account.info().then((a) {
      if (mounted) {
        setState(() {
          _account = a;
          _loaded = true;
        });
      }
    });
  }

  @override
  void dispose() {
    _announcer.dispose();
    _user.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final account = await widget.services.account.signIn(_user.text, _password.text);
      _password.clear();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Signed in as ${account.shownName}.')));
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _message(e);
      });
      _announcer.say(context, _error!);
      _passwordFocus.requestFocus();
    }
  }

  Future<void> _signOut() async {
    await widget.services.account.signOut();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Signed out of Sugamya Pustakalaya.')));
    Navigator.of(context).pop();
  }

  Future<void> _website(String url) async {
    if (!await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication) && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not open the browser. The address is $url')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final account = _account;
    return Scaffold(
      appBar: AppBar(title: Text(account == null ? 'Sign in to Sugamya Pustakalaya' : 'Your account')),
      bottomNavigationBar: SafeArea(child: AnnouncementRegion(announcer: _announcer)),
      body: !_loaded
          ? const SizedBox.shrink()
          : account != null
              ? ListView(padding: const EdgeInsets.all(16), children: [
                  Text('Signed in as ${account.shownName} (${account.user}).'),
                  const SizedBox(height: 8),
                  const Text("Reader keeps your password in this phone's secure storage."),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () => Navigator.of(context)
                        .pushReplacement(MaterialPageRoute<void>(builder: (_) => SugamyaRequestsScreen(services: widget.services))),
                    child: const Text('My download requests'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(onPressed: _signOut, child: const Text('Sign out')),
                ])
              : AutofillGroup(
                  child: ListView(padding: const EdgeInsets.all(16), children: [
                    const Text('Sign in with the user ID or email and password of your Sugamya Pustakalaya membership.'),
                    const SizedBox(height: 16),
                    TextField(
                      controller: _user,
                      autofocus: true,
                      autofillHints: const [AutofillHints.username],
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(labelText: 'User ID or email'),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _password,
                      focusNode: _passwordFocus,
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _busy ? null : _signIn(),
                      decoration: InputDecoration(labelText: 'Password', errorText: _error, errorMaxLines: 4),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(onPressed: _busy ? null : _signIn, child: Text(_busy ? 'Signing in…' : 'Sign in')),
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: () => _website(sugamyaForgotPassword),
                      child: const Text('Forgot your password? Opens the Sugamya Pustakalaya website'),
                    ),
                    TextButton(
                      onPressed: () => _website(sugamyaJoin),
                      child: const Text('Not a member yet? Join on the Sugamya Pustakalaya website'),
                    ),
                  ]),
                ),
    );
  }
}

/// The books the reader asked for; ready ones download into My books.
class SugamyaRequestsScreen extends StatefulWidget {
  const SugamyaRequestsScreen({super.key, required this.services});

  final SugamyaServices services;

  @override
  State<SugamyaRequestsScreen> createState() => _SugamyaRequestsScreenState();
}

class _SugamyaRequestsScreenState extends State<SugamyaRequestsScreen> {
  final _announcer = Announcer();
  List<SugamyaRequest>? _requests;
  String? _error;
  String _downloading = '';
  int _lastStep = -2;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _announcer.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
      _requests = null;
    });
    try {
      final requests = await widget.services.account.requests();
      if (!mounted) return;
      setState(() => _requests = requests);
      final ready = requests.where((r) => r.ready).length;
      _announcer.say(context,
          requests.isEmpty ? 'No download requests.' : '${requests.length} ${requests.length == 1 ? 'request' : 'requests'}, $ready ready to download.');
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = _message(e));
      _announcer.say(context, _error!);
    }
  }

  Future<void> _download(SugamyaRequest r) async {
    if (!r.ready) {
      _announcer.say(context, '${r.title}: not ready yet. Sugamya Pustakalaya is preparing it; choose Refresh later.');
      return;
    }
    if (_downloading.isNotEmpty) return;
    setState(() => _downloading = r.title);
    _announcer.say(context, 'Downloading ${r.title}');
    final temp = await getTemporaryDirectory();
    final file = File(p.join(temp.path, 'sugamya-${DateTime.now().microsecondsSinceEpoch}.zip'));
    try {
      await widget.services.account.download(r.url, file, (fraction) {
        // Every 10 per cent is plenty to say.
        final step = fraction < 0 ? -1 : (fraction * 10).floor();
        if (step != _lastStep && step > 0 && mounted) {
          _lastStep = step;
          _announcer.say(context, '${r.title}: ${step * 10}%');
        }
      });
      // The title as the library gives it ("Business study NCERT 11th"), not the file's name.
      final book = await widget.services.store.import(file.path, '${r.title}.zip');
      if (!mounted) return;
      Navigator.of(context).popUntil((route) => route.isFirst);
      await widget.services.onBook(book);
    } catch (e) {
      if (!mounted) return;
      setState(() => _downloading = '');
      _announcer.say(context, 'Download failed. ${_message(e)}');
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Download failed. ${_message(e)}')));
    } finally {
      if (await file.exists()) await file.delete();
    }
  }

  @override
  Widget build(BuildContext context) {
    final requests = _requests;
    return Scaffold(
      appBar: AppBar(
        title: const Text('My download requests'),
        actions: [IconButton(tooltip: 'Refresh', icon: const Icon(Icons.refresh), onPressed: _downloading.isEmpty ? _load : null)],
      ),
      bottomNavigationBar: SafeArea(child: AnnouncementRegion(announcer: _announcer)),
      body: _error != null
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(_error!, textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Try again')),
                ]),
              ),
            )
          : requests == null
              ? const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading'))
              : requests.isEmpty
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text('You have no download requests. Find a book and choose Ask for this book.', textAlign: TextAlign.center),
                      ),
                    )
                  : ListView(children: [
                      const Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('Choose a book that is ready to download it into My books and open it. Download links last 7 days.'),
                      ),
                      for (final r in requests)
                        ListTile(
                          title: Text(r.title),
                          subtitle: Text([
                            if (r.format.isNotEmpty && r.format != sugamyaNotAvailable) sugamyaFormatLabel(r.format),
                            _downloading == r.title ? 'Downloading…' : (r.ready ? 'Ready to download' : (r.status.isEmpty ? 'Being prepared' : r.status)),
                          ].join('. ')),
                          onTap: _downloading.isEmpty ? () => _download(r) : null,
                        ),
                    ]),
    );
  }
}

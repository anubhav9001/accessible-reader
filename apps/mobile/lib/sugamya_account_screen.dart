import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:url_launcher/url_launcher.dart';

import 'announcer.dart';
import 'app_log.dart';
import 'download_progress.dart';
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
      final reply = await widget.services.account.requestBook(widget.id, widget.format, title: widget.title);
      if (!mounted) return;
      setState(() => _reply = reply);
      if (isSugamyaRequestAccepted(reply) && isSugamyaInstantFormat(widget.format)) {
        // The library makes this format in seconds: wait for the link and download, as if it were direct.
        _push(SugamyaRequestsScreen(services: widget.services, waitFor: (title: widget.title, format: widget.format)));
        return;
      }
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
    final reply = _reply;
    if (reply != null) {
      final accepted = isSugamyaRequestAccepted(reply);
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Focus(
          focusNode: _replyFocus,
          child: Text(accepted
              ? isSugamyaInstantFormat(widget.format)
                  ? '${_sentence(reply)} When it\'s ready, it shows in My download requests; download it from there.'
                  : '${_sentence(reply)} Sugamya Pustakalaya prepares the book, which can take a few hours. When it\'s ready, it shows '
                      'in My download requests (and the library sends you an email or SMS); download it from there.'
              : 'Sugamya Pustakalaya says: ${_sentence(reply)} $sugamyaRequestRefused'),
        ),
        const SizedBox(height: 8),
        accepted
            ? OutlinedButton(
                onPressed: () => _push(SugamyaRequestsScreen(services: widget.services)), child: const Text('My download requests'))
            : OutlinedButton(
                onPressed: () => launchUrl(Uri.parse(sugamyaSite), mode: LaunchMode.externalApplication),
                child: const Text('Open the Sugamya Pustakalaya website')),
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
  const SugamyaRequestsScreen({super.key, required this.services, this.waitFor});

  final SugamyaServices services;

  /// A book just asked for in a format the library makes at once: wait for it and download it.
  final ({String title, String format})? waitFor;

  @override
  State<SugamyaRequestsScreen> createState() => _SugamyaRequestsScreenState();
}

class _SugamyaRequestsScreenState extends State<SugamyaRequestsScreen> {
  final _announcer = Announcer();
  List<SugamyaRequest>? _requests;
  String? _error;
  String _downloading = '';
  int _lastStep = 0;

  /// Bytes so far and the whole size (0 when unknown) of the download under way, or null.
  (int, int)? _progress;

  @override
  void initState() {
    super.initState();
    final waitFor = widget.waitFor;
    if (waitFor == null) {
      _load();
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) => _waitForBook(waitFor.title, waitFor.format));
    }
  }

  Future<void> _waitForBook(String title, String format) async {
    // The list stays on its loading indicator meanwhile.
    _announcer.say(context, 'Sugamya Pustakalaya is making $title. This usually takes a few seconds.');
    try {
      if (await _downloadWhenReady(title, format)) return;
      if (!mounted) return;
      await _load();
      if (!mounted) return;
      _announcer.say(context, "$title: Sugamya Pustakalaya hasn't finished making it yet. Choose Refresh in a minute.");
    } catch (e) {
      if (!mounted) return;
      setState(() => _downloading = '');
      await _load();
    }
  }

  /// After asking for a format the library makes at once: waits for its link (seen within
  /// seconds; up to 30 s), then downloads and opens it. False when the link didn't come.
  Future<bool> _downloadWhenReady(String title, String format) async {
    final wanted = SugamyaRequest(title: title, format: format, status: '', ready: false, url: '');
    setState(() => _downloading = title);
    for (var i = 0; i < 10; i++) {
      await Future<void>.delayed(const Duration(seconds: 3));
      final fresh = (await widget.services.account.requests()).where((x) => x.ready && _same(x, wanted)).firstOrNull;
      if (!mounted) return true;
      if (fresh != null) {
        setState(() => _downloading = '');
        await _download(fresh);
        return true;
      }
    }
    if (mounted) setState(() => _downloading = '');
    return false;
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

  /// What choosing a download request does, by what Reader knows of it.
  Future<void> _choose(SugamyaRequest r) async {
    switch (r.state) {
      case SugamyaRequestState.ready:
        return _download(r);
      case SugamyaRequestState.renew:
        return _renew(r);
      case SugamyaRequestState.preparing:
        return _checkAgain(r);
      case SugamyaRequestState.expired:
        return _askAgain(r);
      case SugamyaRequestState.unknown:
        if (r.ready) return _download(r);
        _announcer.say(
            context,
            '${r.title}: no download link yet. If you asked for it more than $sugamyaLinkDays days ago, the link has expired: '
            'find the book and choose Ask for this book again.');
    }
  }

  /// A request still being prepared: asks the library for its status now (DFI: Reader should check
  /// whenever the reader chooses a request), and downloads the book if it has become ready.
  Future<void> _checkAgain(SugamyaRequest r) async {
    _announcer.say(context, '${r.title}: checking with Sugamya Pustakalaya…');
    List<SugamyaRequest> fresh;
    try {
      fresh = await widget.services.account.requests();
    } catch (e) {
      if (!mounted) return;
      _announcer.say(context, _message(e));
      return;
    }
    if (!mounted) return;
    setState(() => _requests = fresh);
    final same = fresh.where((x) => _same(x, r)).toList();
    final now = same.where((x) => x.ready).firstOrNull ?? same.firstOrNull;
    if (now != null && now.ready) return _download(now);
    final status = now?.status.trim() ?? '';
    _announcer.say(context,
        '${r.title}: still being prepared${status.isEmpty ? '' : ' ($status)'}. Books with audio can take a few hours; choose it again later to check.');
  }

  /// The book's ID: remembered when Reader asked for it, or found by its exact title.
  Future<String?> _bookIdFor(SugamyaRequest r) async {
    if (r.bookId != null) return r.bookId;
    final found = await widget.services.client.books(SugamyaSearch(r.title), 1);
    return sugamyaBookByTitle(found.items, r.title)?.id;
  }

  bool _same(SugamyaRequest a, SugamyaRequest b) =>
      a.title.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase() == b.title.replaceAll(RegExp(r'\s+'), ' ').trim().toLowerCase() &&
      a.format.trim().toLowerCase() == b.format.trim().toLowerCase();

  /// A format the library makes at once whose link expired: ask again, wait for the link, download.
  Future<void> _renew(SugamyaRequest r) async {
    if (_downloading.isNotEmpty) return;
    setState(() => _downloading = r.title);
    _announcer.say(context, '${r.title}: the download link expired. Asking Sugamya Pustakalaya for a new one.');
    try {
      final id = await _bookIdFor(r);
      if (!mounted) return;
      if (id == null) {
        setState(() => _downloading = '');
        _announcer.say(context,
            "${r.title}: the download link expired, and Reader couldn't find the book to ask again. Search for it and choose Ask for this book.");
        return;
      }
      final reply = await widget.services.account.requestBook(id, r.format, title: r.title);
      if (!mounted) return;
      if (!isSugamyaRequestAccepted(reply)) {
        setState(() => _downloading = '');
        _announcer.say(context, '${r.title}: Sugamya Pustakalaya says: $reply');
        return;
      }
      setState(() => _downloading = '');
      if (await _downloadWhenReady(r.title, r.format) || !mounted) return;
      _announcer.say(context, "${r.title}: Reader asked for a new link, but it isn't ready yet. Choose Refresh in a minute.");
    } catch (e) {
      if (!mounted) return;
      setState(() => _downloading = '');
      _announcer.say(context, '${r.title}: ${_message(e)}');
    }
  }

  /// A format the library prepares over hours whose link expired: ask again.
  Future<void> _askAgain(SugamyaRequest r) async {
    _announcer.say(context, '${r.title}: the download link expired. Asking Sugamya Pustakalaya again.');
    try {
      final id = await _bookIdFor(r);
      if (!mounted) return;
      if (id == null) {
        _announcer.say(context, '${r.title}: the download link expired. Search for the book and choose Ask for this book again.');
        return;
      }
      final reply = await widget.services.account.requestBook(id, r.format, title: r.title);
      if (!mounted) return;
      _announcer.say(
          context,
          isSugamyaRequestAccepted(reply)
              ? '${r.title}: the download link expired, so Reader asked for the book again. '
                  'Sugamya Pustakalaya prepares it, which can take a few hours; choose Refresh later.'
              : '${r.title}: Sugamya Pustakalaya says: $reply');
    } catch (e) {
      if (!mounted) return;
      _announcer.say(context, '${r.title}: ${_message(e)}');
    }
  }

  Future<void> _download(SugamyaRequest r) async {
    if (_downloading.isNotEmpty) return;
    setState(() {
      _downloading = r.title;
      _progress = (0, 0);
      _lastStep = 0;
    });
    _announcer.say(context, "Downloading ${r.title}. Reader will say how it's going.");
    final temp = await getTemporaryDirectory();
    final file = File(p.join(temp.path, 'sugamya-${DateTime.now().microsecondsSinceEpoch}.zip'));
    var shown = DateTime.now();
    var said = DateTime.now();
    try {
      await widget.services.account.download(r.url, file, (received, total) {
        if (!mounted) return;
        // The bar: a few times a second is plenty.
        final now = DateTime.now();
        if (now.difference(shown).inMilliseconds >= 250 || received == total) {
          shown = now;
          setState(() => _progress = (received, total));
        }
        // Spoken every 10 percent (or every 10 MB when the size isn't known), but no closer
        // together than sayProgressEvery; the title was said at the start.
        final step = downloadStep(received, total);
        final done = total > 0 && received >= total;
        if (done || (step > _lastStep && now.difference(said) >= sayProgressEvery)) {
          _lastStep = step;
          said = now;
          _announcer.say(context, done ? '${r.title}: downloaded. Opening it.' : downloadProgressText(received, total));
        }
      });
      if (mounted) setState(() => _progress = null);
      // The title as the library gives it ("Business study NCERT 11th"), not the file's name.
      final book = await widget.services.store.import(file.path, '${r.title}.zip');
      if (!mounted) return;
      final got = book.wrappedName;
      if (got != null && sugamyaTitlesDiffer(r.title, got)) {
        AppLog.info('sugamya', 'The library sent a different book: asked for "${r.title}", got "$got".');
        // The app-wide messenger: it stays up over the book that opens next.
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(sugamyaWrongBookNote(r.title, got)), duration: const Duration(seconds: 12)));
      }
      Navigator.of(context).popUntil((route) => route.isFirst);
      await widget.services.onBook(book);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _downloading = '';
        _progress = null;
      });
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
      bottomNavigationBar: SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (_progress case (final received, final total))
            DownloadProgressBar(title: _downloading, received: received, total: total),
          AnnouncementRegion(announcer: _announcer),
        ]),
      ),
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
                            _downloading == r.title ? 'Downloading…' : _detail(r),
                          ].join('. ')),
                          onTap: _downloading.isEmpty ? () => _choose(r) : null,
                        ),
                    ]),
    );
  }
}

/// How a download request reads in the list.
String _detail(SugamyaRequest r) => switch (r.state) {
      SugamyaRequestState.ready => 'Ready to download',
      SugamyaRequestState.renew => 'Download link expired. Choose it to download again',
      SugamyaRequestState.preparing =>
        r.status.isNotEmpty && !RegExp('^available', caseSensitive: false).hasMatch(r.status) ? 'Being prepared (${r.status})' : 'Being prepared',
      SugamyaRequestState.expired => 'Download link expired (links last $sugamyaLinkDays days). Choose it to ask again',
      SugamyaRequestState.unknown => r.ready ? 'Ready to download' : (r.status.isEmpty ? 'No download link yet' : r.status),
    };

/// The library's replies sometimes lack a full stop ("…available for download").
String _sentence(String text) => RegExp(r'[.!?]$').hasMatch(text.trim()) ? text.trim() : '${text.trim()}.';

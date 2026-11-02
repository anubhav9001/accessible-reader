# accessible-reader (placeholder name)

An accessible book reader in the style of Thorium, connected to Sugamya Pustakalaya.

**Using or testing Reader?** Start with the [documentation](docs/README.md): guides for Android and Windows, keyboard shortcuts, FAQ, the testing guide and [release notes](docs/releases/README.md).

| Part | Platforms | Folder | Status |
|---|---|---|---|
| Reading engine (TypeScript) | shared by all apps | `packages/engine` | started |
| Desktop reader (Electron) | Windows, later macOS/Linux | `apps/desktop` | prototype |
| Mobile reader (Flutter, engine in a WebView) | Android, iOS | `apps/mobile` | prototype |
| Book text display (shared) | desktop + mobile | `packages/web-view` | started |
| Field Agent app (Flutter flavor of the mobile app) | Android, iOS | `apps/mobile` | not started |

## Reading engine

Opens EPUB 2/3 (with media overlays), DAISY 3 and DAISY 2.02 into one publication model:
metadata, reading order, table of contents, page list, and a list of narration clips
(text phrase + audio slice) that drives all three reading modes:

- **text**: text only, optionally read aloud with the device voice
- **audio**: recorded narration (or device voice), navigating by heading, page and phrase
- **textAudio**: narration with the current phrase highlighted

```bash
npm install
npm test
```

## Desktop reader prototype

```bash
cd apps/desktop
npm run samples   # builds samples/sample-daisy202.zip (Windows voice) and samples/sample-text.epub
npm start         # opens the reader; Ctrl+O to open a book
npm run smoke     # automated check: opens the sample hidden and muted, plays, jumps a heading
```

Opens `.epub`, zipped DAISY books (`.zip`), or an unzipped DAISY book through its `ncc.html` or `.opf`.
Book text is shown inside the page itself (not an iframe) so NVDA and JAWS browse mode work on it.
All commands are in the menu bar with their shortcuts:

| Action | Shortcut |
|---|---|
| Open book | Ctrl+O |
| Online libraries (Project Gutenberg) | Ctrl+L |
| Play / pause | Ctrl+Space |
| Next / previous phrase | Alt+Right / Alt+Left |
| Next / previous heading | Alt+Down / Alt+Up |
| Next / previous page | Alt+Page Down / Alt+Page Up |
| Go to page | Ctrl+G |
| Text only / Audio only / Text and audio | Ctrl+1 / Ctrl+2 / Ctrl+3 |
| Faster / slower | Ctrl+] / Ctrl+[ |
| Table of contents / book text | Ctrl+T / Ctrl+E |
| Where am I | Ctrl+I |

Heading level for navigation is under Playback → Heading level. The reading position is remembered per book.

## Mobile reader prototype

The Flutter app (`apps/mobile`) shows the screens and plays audio natively (`just_audio` for
recorded narration, `flutter_tts` for the device voice). The shared engine runs in a WebView
page (`apps/mobile/web`), which opens the book, works out modes and navigation, and shows the
text with highlighting. A loopback HTTP server with a random token feeds the page its files.

```bash
cd apps/mobile/web && npm run build   # builds the WebView page into apps/mobile/assets/web
cd apps/mobile && flutter test        # book import and server tests
cd apps/mobile && flutter run         # on a connected Android phone (USB debugging on)
```

Books are added from the phone's files ("Add book": an `.epub` or a zipped DAISY book) and
unpacked into app storage. Not yet done: background playback and lock-screen controls,
Sugamya sign-in and downloads, display settings.

## Online libraries (OPDS)

Both apps can browse, search and download free books from online catalogues that publish
OPDS feeds. Project Gutenberg is built in (`BUILT_IN_CATALOGS` in `packages/engine/src/opds.ts`,
`builtInCatalogs` in `apps/mobile/lib/opds.dart`); other OPDS catalogues can be added there.
The reader picks EPUB 3 with images when offered, since it keeps image descriptions.

Catalogue requests are HTTPS only and are made only when the user searches, browses or
downloads; the apps never crawl or pre-fetch (Gutenberg's site is meant for human visitors).

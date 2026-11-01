# accessible-reader (placeholder name)

An accessible book reader in the style of Thorium, connected to Sugamya Pustakalaya.

| Part | Platforms | Folder | Status |
|---|---|---|---|
| Reading engine (TypeScript) | shared by all apps | `packages/engine` | started |
| Desktop reader (Electron) | Windows, later macOS/Linux | `apps/desktop` | prototype |
| Mobile reader (Flutter, engine in a WebView) | Android, iOS | `apps/mobile` | not started |
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

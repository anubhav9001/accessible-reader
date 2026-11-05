# Getting started on Windows

Reader works on 64-bit Windows 10 and 11, with NVDA, JAWS, Narrator or no screen reader.

## Install

1. Run `Reader-Setup-<version>.exe` from the link you were sent.
2. If Windows says it protected your PC, choose **More info**, then **Run anyway**.
3. Follow the installer. It installs for your account only, so no administrator rights are needed, and adds Reader to the Start menu and the desktop.

To uninstall, use **Settings → Apps → Installed apps → Reader**.

## Add books

- **My books** (Ctrl+B) lists every book you have opened or downloaded, most recently read first. It opens by itself when you start Reader. Choose a book to carry on reading, or **Remove** it.
- **Open book** (Ctrl+O) opens an EPUB, a zipped DAISY book, or the `ncc.html` or `.opf` file of an unzipped DAISY folder.
- **Online libraries** (Ctrl+L) lets you search or browse Project Gutenberg, then download and open a book.

Removing a book you downloaded deletes its file. Removing a book you opened from elsewhere only takes it off the list.

## The window

From top to bottom:

1. The book title, a toolbar with My books, Open book, Online libraries, Play, the phrase and heading buttons and Go to page, and the reading speed.
2. The reading mode choice.
3. The table of contents, under the heading Contents.
4. Where you are: the heading, page and time.
5. The book text.

Every command is also in the menu bar; press Alt to reach it. Press F1 for the full list, or see [keyboard shortcuts](keyboard-shortcuts.md).

## Read and listen

| Mode | Shortcut | What it does |
|---|---|---|
| Text only | Ctrl+1 | Shows the text. Play reads it aloud with the Windows voice. |
| Audio only | Ctrl+2 | Plays the recorded narration, or the Windows voice, with the text hidden. |
| Text and audio | Ctrl+3 | Plays the narration and highlights each phrase as it is read. |

Ctrl+Space plays or pauses. Alt with the arrow keys moves by phrase (Left and Right) or by heading (Up and Down).

## Reading with NVDA or JAWS

The book text is an ordinary web page, so browse mode works as usual: arrow keys, H for headings, and say all.

Reader follows your screen reader and remembers the paragraph you reached. When you come back to the book:

- Tabbing into the text, or pressing Ctrl+E, lands on that paragraph.
- Ctrl+Space starts reading aloud from there.
- Ctrl+I (Where am I?) announces the heading, page, time, mode and speed.

Stepping by phrase or heading with the keyboard moves your screen reader into the text to read the new phrase. Shift+Tab or the menu bar gets you back to the toolbar.

## Screen reader mode

Screen reader mode shows the whole book as plain text in one read-only text box, like the Paperback reader. Your screen reader's own cursor is your reading position: read with the arrow keys and say all as in any document, and Reader remembers exactly where the cursor is, even after you open another book or close the app.

Turn it on or off with Ctrl+Shift+R, or **View → Screen reader mode**. Reader remembers the choice.

In the text box, single keys move the cursor through the book's structure. Shift with the key goes backwards.

| Key | Moves to |
|---|---|
| H | Next heading |
| 1 to 6 | Next heading at that level |
| P | Next printed page |
| K | Next link (Enter follows a link inside the book) |
| T | Next table (rows are on lines of their own, cells divided by a bar) |
| L / I | Next list / list item |
| G / F / S | Next image / figure / separator |
| ] / [ | Next / previous section (a part or chapter file of the book) |
| = | Says how far through the book you are, and the page |

Everything else works as usual: Ctrl+Space plays from the cursor, Alt+Up and Alt+Down move by heading (at the level chosen in the Playback menu), the table of contents moves the cursor to the chapter, and while Reader reads aloud the cursor follows the voice.

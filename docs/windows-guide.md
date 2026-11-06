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
- **Online libraries** (Ctrl+L) has a **Library** choice at the top:
  - **Sugamya Pustakalaya:** search by title or author, or browse categories, school books by grade and the latest books, and read each book's details. Downloading from Sugamya inside Reader comes in the next version.
  - **Project Gutenberg:** search or browse free classics, then download and open a book.

  Reader remembers which library you used last.

Removing a book you downloaded deletes its file. Removing a book you opened from elsewhere only takes it off the list.

## The window

From top to bottom:

1. The book title, a toolbar with My books, Open book, Online libraries, Play, the phrase and heading buttons and Go to page, and the reading speed.
2. The reading mode choice.
3. The table of contents, under the heading Contents. It is a tree: one Tab stop, then Up and Down to move, Right and Left to open and close a part, Home and End, a letter to jump to an entry starting with it, and Enter to go there. The entry you are reading is marked as current.
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

- Opening the book puts focus straight on that paragraph, and tabbing into the text, or pressing Ctrl+E, lands there too.
- Ctrl+Space starts reading aloud from there.
- Ctrl+I (Where am I?) announces the heading, page, time, mode and speed.

Stepping by phrase or heading with the keyboard moves your screen reader into the text to read the new phrase. Shift+Tab or the menu bar gets you back to the toolbar.

## Screen reader mode

Screen reader mode works like the Paperback reader: the whole book is shown as plain text in one read-only text box. Your screen reader's cursor is your reading position. Read with the arrow keys, Ctrl+arrows and say all, and Reader remembers exactly where the cursor is, down to the character, even after you open another book or close the app. When you open the book again, focus goes straight to that spot.

Turn it on or off with Ctrl+Shift+R, the **Screen reader mode** checkbox beside the reading modes, or **View → Screen reader mode**. Reader remembers the choice. NVDA switches to focus mode by itself when you reach the text box, as in Paperback, so the arrow keys and say all read straight away.

In the text box, single keys move the cursor through the book's structure, as in Paperback. Shift with the key goes backwards.

| Key | Moves to |
|---|---|
| H | Next heading |
| 1 to 6 | Next heading at that level |
| P | Next printed page |
| K | Next link (Enter or Space follows a link inside the book) |
| T | Next table (each row is a line, cells divided by a bar) |
| L / I | Next list / list item |
| G / F / S | Next image / figure / separator |
| ] / [ | Next / previous section (a part or chapter file of the book) |
| = | Says how far through the book you are, and the page |

Ctrl+Space plays from the cursor, Alt+Up and Alt+Down move by heading, the table of contents moves the cursor to the chapter and marks the chapter you are in, and while Reader reads aloud the cursor follows the voice.

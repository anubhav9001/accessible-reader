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

**Close book** (Ctrl+W, or File → Close book) closes the book you are reading and goes back to My books. Your place is kept, so opening it again carries on where you stopped.

Removing a book you downloaded deletes its file. Removing a book you opened from elsewhere only takes it off the list.

## The window

From top to bottom:

1. The book title, and a toolbar of icon buttons: My books, Open book, Online libraries, Settings, Play, the phrase and heading buttons and Go to page. Settings can show their text too. The toolbar is one Tab stop: use Left and Right to move between its buttons, and Home and End for the first and last.
2. The reading mode choice, with the Screen reader mode checkbox in the same group.
3. The table of contents, under the heading Contents. It is a tree: one Tab stop, then Up and Down to move, Right and Left to open and close a part, Home and End, a letter to jump to an entry starting with it, and Enter to go there. The entry you are reading is marked as current.
4. Where you are: the heading, page and time.
5. The book text.

Every command is also in the menu bar. Press Alt or F10 to reach it, or Alt with a menu's underlined letter (Alt+F for File) to open that menu. Use the arrow keys to move; Tab stays in the menu. Escape goes back one step: from a submenu to its menu, from a menu to the menu bar, then back to where you were. Press F1 for the full list, or see [keyboard shortcuts](keyboard-shortcuts.md).

## Settings

Press Ctrl+Comma, choose **Settings** in the toolbar, or **File → Settings**. Changes take effect straight away, and Reader remembers them:

- **Reading speed:** half speed to three times normal. Ctrl+] and Ctrl+[ change it too.
- **Voice:** the Windows voice used to read aloud books without narration, or Automatic to match the book's language.
- **Heading depth:** which headings next and previous heading stop at: all levels, level 1 only, or levels 1 to 2 up to 1 to 6. Also in the **Navigate** menu.
- **Table of contents:** how many levels of the contents are shown open. You can still open any part with the Right arrow.
- **Show text on toolbar buttons:** the toolbar shows icons only unless this is on. Screen readers read each button's name either way.
- **Screen reader mode.**

**Help → Report a problem** opens the form for reporting a bug, and **Help → About Reader** shows the version.

## Read and listen

| Mode | Shortcut | What it does |
|---|---|---|
| Text only | Ctrl+1 | Shows the text. Play reads it aloud with the Windows voice. |
| Audio only | Ctrl+2 | Plays the recorded narration, or the Windows voice, with the text hidden. |
| Text and audio | Ctrl+3 | Plays the narration and highlights each phrase as it is read. |

Ctrl+Space plays or pauses. Alt with the arrow keys moves by phrase (Left and Right) or by heading (Up and Down). Ctrl+Page Down and Ctrl+Page Up move to the next or previous section of the table of contents.

## Reading with NVDA or JAWS

The book text is an ordinary web page, so browse mode works as usual: arrow keys, H for headings, and say all.

Reader follows your screen reader and remembers the paragraph you reached. When you come back to the book:

- Opening the book puts focus straight on that paragraph, and tabbing into the text, or pressing Ctrl+E, lands there too.
- Ctrl+Space starts reading aloud from there.
- Ctrl+I (Where am I?) announces the heading, page, time, mode and speed.

Stepping by phrase or heading with the keyboard moves your screen reader into the text to read the new phrase. Shift+Tab or the menu bar gets you back to the toolbar.

## Screen reader mode

In screen reader mode the book is shown as plain text in a text box you can read but not change. The box holds the part of the book around your cursor and moves along with you as you read, so screen readers stay quick. Your screen reader's cursor is your reading position. Read with the arrow keys, Ctrl+arrows and say all, and Reader remembers exactly where the cursor is, down to the character, even after you open another book or close the app. When you open the book again, focus goes straight to that spot.

Reading line by line with the arrow keys goes straight on through the whole book. Say all may stop after a few pages; press it again to carry on.

Turn it on or off with Ctrl+Shift+R, the **Screen reader mode** checkbox beside the reading modes, or **View → Screen reader mode**. Reader remembers the choice. NVDA switches to focus mode by itself when you reach the text box, so the arrow keys and say all read straight away.

In the text box, single keys move the cursor through the book's structure. Shift with the key goes backwards.

| Key | Moves to |
|---|---|
| H | Next heading |
| 1 to 6 | Next heading at that level |
| P | Next printed page |
| K | Next link (Enter or Space follows a link inside the book) |
| T | Next table. A line gives its size, each row is a line with cells divided by a bar and each cell starting with its column heading ("Date: 260 B.C. \| Name: Battle of Mylae"), and End of table follows. Enter on a table opens it as a real table, for NVDA's table commands (Ctrl+Alt+arrows); Escape comes back |
| L / I | Next list / list item |
| G / F / S | Next image / figure / separator |
| ] / [ | Next / previous section (a part or chapter file of the book) |

These keys search the whole book, not just the chapter in the text box.
| = | Says how far through the book you are, and the page |

Ctrl+Space plays from the cursor, Alt+Up and Alt+Down move by heading, the table of contents moves the cursor to the chapter and marks the chapter you are in, and while Reader reads aloud the cursor follows the voice.

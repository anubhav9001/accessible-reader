import { openDialog } from './open-dialog';

/**
 * A place in a book, as Go back and bookmarks keep it: the paragraph (block) of a text file,
 * the exact character in screen reader mode, and the narration clip.
 */
export interface Spot {
  docPath?: string;
  block?: number;
  clipIndex: number;
  plainOffset?: number;
}

export interface Bookmark {
  id: string;
  name: string;
  /** Where it is, as said in the list: "Chapter 3, page 41". */
  where: string;
  spot: Spot;
  /** Its position in the book, for listing bookmarks in book order. */
  order: number[];
  created: number;
}

export interface BookmarkHost {
  /** The place the reader is at now, with a suggested name and where it is. */
  here(): { spot: Spot; name: string; where: string; order: number[] } | undefined;
  go(bookmark: Bookmark): void;
  announce(message: string): void;
  /** The key bookmarks are stored under, for the open book. */
  storageKey(): string | undefined;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * Bookmarks: Control D adds one at the reader's place (named, with a suggested name), and
 * Control Shift B lists them in book order to go to, rename or delete. They are kept per book.
 */
export class Bookmarks {
  private readonly nameDialog = $<HTMLDialogElement>('ui-bookmark-name-dialog');
  private readonly nameTitle = $('ui-bookmark-name-title');
  private readonly nameInput = $<HTMLInputElement>('ui-bookmark-name');
  private readonly nameWhere = $('ui-bookmark-where');
  private readonly nameOk = $<HTMLButtonElement>('ui-bookmark-name-ok');
  private readonly listDialog = $<HTMLDialogElement>('ui-bookmarks-dialog');
  private readonly list = $<HTMLSelectElement>('ui-bookmarks-list');
  private readonly listStatus = $('ui-bookmarks-status');
  /** What the name dialog is doing: adding at `adding`, or renaming `renaming`. */
  private adding: ReturnType<BookmarkHost['here']>;
  private renaming: Bookmark | undefined;

  constructor(private readonly host: BookmarkHost) {
    this.nameDialog.addEventListener('close', () => this.onNameClosed());
    this.list.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Enter') this.goSelected();
      else if (e.key === 'Delete') this.deleteSelected();
      else if (e.key === 'F2') this.renameSelected();
      else return;
      e.preventDefault();
    });
    this.list.addEventListener('dblclick', () => this.goSelected());
    $('ui-bookmarks-go').addEventListener('click', () => this.goSelected());
    $('ui-bookmarks-rename').addEventListener('click', () => this.renameSelected());
    $('ui-bookmarks-delete').addEventListener('click', () => this.deleteSelected());
  }

  all(): Bookmark[] {
    const key = this.host.storageKey();
    if (!key) return [];
    try {
      const list = JSON.parse(localStorage.getItem(key) ?? '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private save(list: Bookmark[]): boolean {
    const key = this.host.storageKey();
    if (!key) return false;
    list.sort((a, b) => compare(a.order, b.order) || a.created - b.created);
    try {
      if (list.length) localStorage.setItem(key, JSON.stringify(list));
      else localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  /** Control D: asks for a name (a suggestion filled in) and adds a bookmark at the reader's place. */
  add(): void {
    const here = this.host.here();
    if (!here) return this.host.announce('No book open.');
    this.adding = here;
    this.renaming = undefined;
    this.nameTitle.textContent = 'Add bookmark';
    this.nameOk.textContent = 'Add';
    this.nameWhere.textContent = here.where ? `At: ${here.where}` : '';
    this.nameInput.value = here.name;
    this.nameDialog.returnValue = '';
    openDialog(this.nameDialog, () => {
      this.nameInput.select();
      return this.nameInput;
    });
  }

  private renameSelected(): void {
    const bookmark = this.selected();
    if (!bookmark) return this.host.announce('No bookmark chosen.');
    this.adding = undefined;
    this.renaming = bookmark;
    this.nameTitle.textContent = 'Rename bookmark';
    this.nameOk.textContent = 'Rename';
    this.nameWhere.textContent = bookmark.where ? `At: ${bookmark.where}` : '';
    this.nameInput.value = bookmark.name;
    this.nameDialog.returnValue = '';
    openDialog(this.nameDialog, () => {
      this.nameInput.select();
      return this.nameInput;
    });
  }

  private onNameClosed(): void {
    const ok = this.nameDialog.returnValue === 'ok';
    const name = this.nameInput.value.replace(/\s+/g, ' ').trim();
    const adding = this.adding;
    const renaming = this.renaming;
    this.adding = undefined;
    this.renaming = undefined;
    if (renaming) {
      if (ok && name) {
        const list = this.all();
        const b = list.find((x) => x.id === renaming.id);
        if (b) b.name = name;
        this.save(list);
        this.fill(renaming.id);
        this.say(`Renamed to ${name}`);
      }
      setTimeout(() => this.list.focus(), 0);
      return;
    }
    if (!adding || !ok) return;
    const list = this.all();
    const same = list.find((b) => JSON.stringify(b.spot) === JSON.stringify(adding.spot));
    if (same) {
      same.name = name || adding.name || same.name;
      this.save(list);
      return this.host.announce(`There was already a bookmark here; it is now called ${same.name}.`);
    }
    const bookmark: Bookmark = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name || adding.name || adding.where || 'Bookmark',
      where: adding.where,
      spot: adding.spot,
      order: adding.order,
      created: Date.now(),
    };
    list.push(bookmark);
    if (!this.save(list)) return this.host.announce('The bookmark could not be saved.');
    this.host.announce(`Bookmark added: ${bookmark.name}`);
  }

  /** Control Shift B: the book's bookmarks, in book order. */
  open(): void {
    if (!this.host.storageKey()) return this.host.announce('No book open.');
    this.fill();
    openDialog(this.listDialog, () => (this.list.options.length ? this.list : $('ui-bookmarks-title')));
  }

  private fill(selectId?: string): void {
    const list = this.all();
    const keep = selectId ?? this.list.value;
    this.list.replaceChildren(...list.map((b) => new Option(b.where ? `${b.name}, ${b.where}` : b.name, b.id)));
    this.list.hidden = !list.length;
    for (const id of ['ui-bookmarks-go', 'ui-bookmarks-rename', 'ui-bookmarks-delete']) $<HTMLButtonElement>(id).disabled = !list.length;
    this.listStatus.textContent = list.length
      ? `${list.length} bookmark${list.length === 1 ? '' : 's'}, in book order. Enter goes to one, F2 renames it, Delete removes it.`
      : 'No bookmarks in this book yet. While reading, press Control D to add one.';
    if (list.length) {
      const i = Math.max(0, list.findIndex((b) => b.id === keep));
      this.list.selectedIndex = i;
    }
  }

  /** While the list is open, its own status line speaks (the page's live region is behind the dialog). */
  private say(message: string): void {
    if (!this.listDialog.open) return this.host.announce(message);
    this.listStatus.textContent = '';
    setTimeout(() => (this.listStatus.textContent = message), 50);
  }

  private selected(): Bookmark | undefined {
    return this.all().find((b) => b.id === this.list.value);
  }

  private goSelected(): void {
    const bookmark = this.selected();
    if (!bookmark) return;
    this.listDialog.close();
    this.host.go(bookmark);
  }

  private deleteSelected(): void {
    const bookmark = this.selected();
    if (!bookmark) return;
    const list = this.all();
    const i = list.findIndex((b) => b.id === bookmark.id);
    list.splice(i, 1);
    this.save(list);
    this.fill(list[Math.min(i, list.length - 1)]?.id);
    this.say(`Deleted ${bookmark.name}. ${list.length ? `${list.length} left.` : 'No bookmarks left.'}`);
    (list.length ? this.list : $<HTMLButtonElement>('ui-bookmarks-close')).focus();
  }
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

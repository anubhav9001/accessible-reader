import type { BookInfo, LibraryEntry, ReaderApi } from '../shared/api';

interface Elements {
  dialog: HTMLDialogElement;
  heading: HTMLElement;
  status: HTMLElement;
  list: HTMLElement;
}

const FORMAT_LABELS: Record<LibraryEntry['format'], string> = { epub: 'EPUB', daisy3: 'DAISY 3', daisy202: 'DAISY 2.02' };
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** "My books": every book opened or downloaded, most recently read first. */
export class LibraryView {
  constructor(
    private readonly el: Elements,
    private readonly api: ReaderApi,
    private readonly onBook: (info: BookInfo) => Promise<void>,
  ) {}

  /** Shows the list; returns false (and stays closed) when `onlyIfBooks` and there are none. */
  async open(onlyIfBooks = false): Promise<boolean> {
    const entries = await this.api.listLibrary();
    if (onlyIfBooks && entries.length === 0) return false;
    this.render(entries);
    if (!this.el.dialog.open) this.el.dialog.showModal();
    this.el.heading.focus();
    return true;
  }

  private render(entries: LibraryEntry[]): void {
    this.el.heading.textContent = `My books (${entries.length})`;
    this.el.status.textContent = '';
    if (!entries.length) {
      const p = document.createElement('p');
      p.textContent = 'No books yet. Use Open book (Control O) or Online libraries (Control L) to add one.';
      this.el.list.replaceChildren(p);
      return;
    }
    const list = document.createElement('ul');
    list.className = 'catalog-list';
    list.append(...entries.map((e) => this.renderEntry(e)));
    this.el.list.replaceChildren(list);
  }

  private renderEntry(entry: LibraryEntry): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'library-item';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'catalog-entry';
    const title = document.createElement('span');
    title.className = 'catalog-entry-title';
    title.textContent = entry.title;
    const detail = document.createElement('span');
    detail.className = 'catalog-entry-detail';
    detail.textContent = [
      entry.authors.length ? `By ${entry.authors.join(', ')}` : '',
      FORMAT_LABELS[entry.format],
      `last read ${dateFormat.format(entry.lastOpened)}`,
      entry.missing ? 'file not found' : '',
    ]
      .filter(Boolean)
      .join('. ');
    open.append(title, detail);
    open.addEventListener('click', () => void this.openEntry(entry));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${entry.title}`);
    remove.addEventListener('click', () => void this.removeEntry(entry, li));

    li.append(open, remove);
    return li;
  }

  private async openEntry(entry: LibraryEntry): Promise<void> {
    this.el.status.textContent = `Opening ${entry.title}…`;
    try {
      const info = await this.api.openFromLibrary(entry.id);
      this.el.dialog.close();
      await this.onBook(info);
    } catch (err) {
      this.el.status.textContent = errorMessage(err);
    }
  }

  private async removeEntry(entry: LibraryEntry, li: HTMLLIElement): Promise<void> {
    const question = entry.downloaded
      ? `Remove "${entry.title}" from My books and delete the downloaded copy?`
      : `Remove "${entry.title}" from My books? The book file itself is not deleted.`;
    if (!confirm(question)) return;
    await this.api.removeFromLibrary(entry.id);
    // Keep the keyboard near where it was: the next book's button, or the previous one's.
    const neighbour = (li.nextElementSibling ?? li.previousElementSibling)?.querySelector<HTMLButtonElement>('.catalog-entry');
    const entries = await this.api.listLibrary();
    this.render(entries);
    this.el.status.textContent = `Removed ${entry.title}.`;
    const title = neighbour?.querySelector('.catalog-entry-title')?.textContent;
    const again = [...this.el.list.querySelectorAll<HTMLButtonElement>('.catalog-entry')].find(
      (b) => b.querySelector('.catalog-entry-title')?.textContent === title,
    );
    (again ?? this.el.heading).focus();
  }
}

/** The main process's message, without the "Error invoking remote method …" wrapper Electron adds. */
function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

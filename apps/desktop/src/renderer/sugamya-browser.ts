import {
  SUGAMYA_NOT_AVAILABLE,
  SUGAMYA_PAGE_SIZE,
  parseSugamyaBooks,
  parseSugamyaNames,
  sugamyaBookSummary,
  sugamyaByLine,
  sugamyaFormatLabel,
  sugamyaFormatReadable,
  sugamyaPath,
  type SugamyaQuery,
} from '@accessible-reader/engine';
import { browserPlatform } from '@accessible-reader/engine/browser';
import type { ReaderApi } from '../shared/api';

interface Elements {
  dialog: HTMLDialogElement;
  heading: HTMLElement;
  searchForm: HTMLFormElement;
  searchLabel: HTMLElement;
  searchInput: HTMLInputElement;
  back: HTMLButtonElement;
  start: HTMLButtonElement;
  status: HTMLElement;
  results: HTMLElement;
}

/** A page of the Sugamya browser, kept so Back can show it again. */
type View = { kind: 'start' } | { kind: 'list'; title: string; query: SugamyaQuery } | { kind: 'book'; id: string };

const NAME = 'Sugamya Pustakalaya';

/**
 * Browses Sugamya Pustakalaya in the Online libraries window: search by title or author,
 * categories, school books by grade, latest books, and each book's details. Downloading
 * needs the reader's Sugamya account and comes next; until then the details say so.
 */
export class SugamyaBrowser {
  /** False while another library uses the same window. */
  active = false;
  private history: View[] = [];
  private current: View | undefined;

  constructor(
    private readonly el: Elements,
    private readonly api: ReaderApi,
  ) {
    el.searchForm.addEventListener('submit', (event) => {
      if (!this.active) return;
      event.preventDefault();
      const terms = el.searchInput.value.trim();
      if (terms) void this.show({ kind: 'list', title: `Search results for ${terms}`, query: { kind: 'search', terms } });
    });
    el.back.addEventListener('click', () => {
      if (!this.active) return;
      const previous = this.history.pop();
      if (previous) void this.show(previous, false);
    });
    el.start.addEventListener('click', () => this.active && void this.show({ kind: 'start' }));
  }

  open(): void {
    this.el.searchLabel.textContent = `Search ${NAME} by title or author`;
    if (!this.el.dialog.open) this.el.dialog.showModal();
    this.history = [];
    void this.show({ kind: 'start' }, false).then(() => this.el.searchInput.focus());
  }

  private setStatus(message: string): void {
    this.el.status.textContent = message;
  }

  private async fetch(path: string): Promise<string> {
    return this.api.fetchSugamya(path);
  }

  private async show(view: View, remember = true): Promise<void> {
    this.setStatus(view.kind === 'start' ? '' : 'Loading…');
    try {
      if (view.kind === 'start') this.renderStart();
      else if (view.kind === 'book') await this.renderBook(view.id);
      else await this.renderList(view.title, view.query);
      if (remember && this.current) this.history.push(this.current);
      this.current = view;
      this.el.heading.focus();
    } catch (err) {
      this.setStatus(errorMessage(err));
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => void this.show(view, remember));
      this.el.results.replaceChildren(retry);
      retry.focus();
    }
    this.el.back.disabled = this.history.length === 0;
  }

  private renderStart(): void {
    this.el.heading.textContent = NAME;
    const intro = paragraph(
      "India's accessible online library, from DAISY Forum of India. Search by title or author above, or browse below.",
    );
    const list = document.createElement('ul');
    list.className = 'catalog-list';
    list.append(
      this.entry('Categories', 'Books by subject', () => this.show({ kind: 'list', title: 'Categories', query: { kind: 'categories' } })),
      this.entry('School books by grade', 'From pre-kindergarten upwards', () =>
        this.show({ kind: 'list', title: 'Grades', query: { kind: 'grades' } }),
      ),
      this.entry('Latest books', 'Added in the last 15 days', () =>
        this.show({ kind: 'list', title: 'Latest books', query: { kind: 'latest' } }),
      ),
    );
    this.el.results.replaceChildren(intro, list, paragraph(DOWNLOAD_NOTE));
  }

  /** A page of books, or of category or grade names; "More results" adds the next page. */
  private async renderList(title: string, query: SugamyaQuery): Promise<void> {
    const names = query.kind === 'categories' || query.kind === 'grades';
    const list = document.createElement('ul');
    list.className = 'catalog-list';
    const more = document.createElement('button');
    more.type = 'button';
    more.textContent = 'More results';
    let page = 0;
    let total = 0;

    const loadPage = async (): Promise<void> => {
      page++;
      const body = await this.fetch(sugamyaPath(query, page));
      if (names) {
        const result = parseSugamyaNames(browserPlatform, body);
        total = result.total;
        for (const name of result.items) {
          const next: SugamyaQuery = query.kind === 'categories' ? { kind: 'category', name } : { kind: 'grade', name };
          list.append(this.entry(name, '', () => this.show({ kind: 'list', title: name, query: next })));
        }
      } else {
        const result = parseSugamyaBooks(browserPlatform, body);
        total = result.total;
        for (const book of result.items) {
          list.append(this.entry(book.title, sugamyaBookSummary(book), () => this.show({ kind: 'book', id: book.id })));
        }
      }
      more.hidden = page * SUGAMYA_PAGE_SIZE >= total;
    };

    await loadPage();
    this.el.heading.textContent = title;
    if (!list.children.length) {
      this.el.results.replaceChildren(paragraph(query.kind === 'latest' ? 'No books were added in the last 15 days.' : 'Nothing found.'));
      this.setStatus('Nothing found.');
      return;
    }
    more.addEventListener('click', async () => {
      const before = list.children.length;
      more.disabled = true;
      this.setStatus('Loading more…');
      try {
        await loadPage();
        this.setStatus(`${list.children.length} of ${total}`);
        list.children[before]?.querySelector('button')?.focus();
      } catch (err) {
        this.setStatus(errorMessage(err));
      }
      more.disabled = false;
    });
    this.el.results.replaceChildren(list, more);
    this.setStatus(`${title}: ${total} ${names ? 'items' : total === 1 ? 'book' : 'books'}`);
  }

  private async renderBook(id: string): Promise<void> {
    const [book] = parseSugamyaBooks(browserPlatform, await this.fetch(sugamyaPath({ kind: 'book', id }))).items;
    if (!book) throw new Error('This book could not be found in Sugamya Pustakalaya.');
    this.el.heading.textContent = book.title;
    const details = document.createElement('div');
    details.className = 'catalog-book';
    if (book.author) details.append(paragraph(sugamyaByLine(book)));
    if (book.publisher) details.append(paragraph(`Publisher: ${book.publisher}`));
    if (book.language) details.append(paragraph(`Language: ${book.language}`));
    if (book.format === SUGAMYA_NOT_AVAILABLE) {
      details.append(paragraph(`Format: ${SUGAMYA_NOT_AVAILABLE}`));
    } else if (book.format) {
      const label = sugamyaFormatLabel(book.format);
      details.append(
        paragraph(
          sugamyaFormatReadable(book.format)
            ? `Format: ${label}. Reader can open this format.`
            : `Format: ${label}. Reader can't open this format.`,
        ),
      );
    }
    if (book.size) details.append(paragraph(`Size: ${book.size}`));
    if (book.isbn) details.append(paragraph(`ISBN: ${book.isbn}`));
    if (book.synopsis) details.append(paragraph(book.synopsis));
    details.append(paragraph(DOWNLOAD_NOTE));
    this.el.results.replaceChildren(details);
    this.setStatus(`Book details: ${book.title}`);
  }

  private entry(title: string, detail: string, onChoose: () => Promise<void> | void): HTMLLIElement {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-entry';
    const t = document.createElement('span');
    t.className = 'catalog-entry-title';
    t.textContent = title;
    button.append(t);
    if (detail) {
      const d = document.createElement('span');
      d.className = 'catalog-entry-detail';
      d.textContent = detail;
      button.append(d);
    }
    button.addEventListener('click', () => void onChoose());
    li.append(button);
    return li;
  }
}

const DOWNLOAD_NOTE =
  'Downloading books needs your Sugamya Pustakalaya account. Signing in from Reader is coming in the next version; ' +
  'until then, download on sugamyapustakalaya.org.in and open the book with Open book (Control O).';

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function paragraph(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

import {
  SUGAMYA_NOT_AVAILABLE,
  SUGAMYA_PAGE_SIZE,
  parseSugamyaBooks,
  parseSugamyaNames,
  sugamyaBookSummary,
  sugamyaByLine,
  SUGAMYA_FORGOT_PASSWORD,
  SUGAMYA_JOIN,
  SUGAMYA_POPULAR_TIMES,
  SUGAMYA_SITE,
  SUGAMYA_REQUEST_REFUSED,
  isSugamyaRequestAccepted,
  sugamyaFormatId,
  sugamyaFormatLabel,
  sugamyaFormatReadable,
  sugamyaPath,
  sugamyaPopularQuery,
  type SugamyaQuery,
} from '@accessible-reader/engine';
import { browserPlatform } from '@accessible-reader/engine/browser';
import type { BookInfo, ReaderApi } from '../shared/api';
import { openDialog } from './open-dialog';

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
type View =
  | { kind: 'start' }
  | { kind: 'list'; title: string; query: SugamyaQuery }
  | { kind: 'book'; id: string }
  | { kind: 'account' }
  | { kind: 'requests' };

const NAME = 'Sugamya Pustakalaya';

/**
 * Browses Sugamya Pustakalaya in the Online libraries window: search by title or author,
 * categories, school books by grade, latest and popular books, and each book's details.
 * With the reader's Sugamya account it asks for books (the library prepares each one, which
 * can take hours) and downloads them from My download requests into My books.
 */
export class SugamyaBrowser {
  /** False while another library uses the same window. */
  active = false;
  private history: View[] = [];
  /** The title being downloaded, for progress in the status line. */
  private downloading = '';
  /** The reader's account: their name, or null when signed out. */
  private account: { user: string; name: string } | null = null;
  private current: View | undefined;
  /** Counts pages shown, so lookups for a page the reader has left can stop. */
  private shown = 0;

  constructor(
    private readonly el: Elements,
    private readonly api: ReaderApi,
    private readonly onBook: (info: BookInfo) => Promise<void>,
  ) {
    api.sugamya.onProgress((fraction) => {
      if (!this.downloading) return;
      this.setStatus(fraction < 0 ? `Downloading ${this.downloading}…` : `Downloading ${this.downloading}: ${Math.round(fraction * 100)}%`);
    });
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
    openDialog(this.el.dialog, () => null);
    this.history = [];
    void this.api.sugamya
      .account()
      .catch(() => null)
      .then((account) => {
        this.account = account;
        return this.show({ kind: 'start' }, false);
      })
      .then(() => this.el.searchInput.focus());
  }

  private setStatus(message: string): void {
    this.el.status.textContent = message;
  }

  private async fetch(path: string): Promise<string> {
    return this.api.fetchSugamya(path);
  }

  private async show(view: View, remember = true): Promise<void> {
    this.shown++;
    this.setStatus(view.kind === 'start' ? '' : 'Loading…');
    try {
      if (view.kind === 'start') this.renderStart();
      else if (view.kind === 'book') await this.renderBook(view.id);
      else if (view.kind === 'account') this.renderAccount();
      else if (view.kind === 'requests') await this.renderRequests();
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
      this.entry('Popular books', `Downloaded ${SUGAMYA_POPULAR_TIMES} times or more in the past year`, () =>
        this.show({ kind: 'list', title: 'Popular books', query: sugamyaPopularQuery() }),
      ),
      this.entry('Latest books', 'Added in the last 15 days', () =>
        this.show({ kind: 'list', title: 'Latest books', query: { kind: 'latest' } }),
      ),
      this.entry('My download requests', this.account ? 'Books you asked for, and downloading them' : 'Sign in first', () =>
        this.show(this.account ? { kind: 'requests' } : { kind: 'account' }),
      ),
      this.account
        ? this.entry('Your account', `Signed in as ${this.account.name || this.account.user}`, () => this.show({ kind: 'account' }))
        : this.entry('Sign in', 'With your Sugamya Pustakalaya user ID or email, to download books', () => this.show({ kind: 'account' })),
    );
    this.el.results.replaceChildren(intro, list);
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
        const missing: { id: string; li: HTMLLIElement }[] = [];
        for (const book of result.items) {
          const li = this.entry(book.title, sugamyaBookSummary(book), () => this.show({ kind: 'book', id: book.id }));
          list.append(li);
          if (!book.format) missing.push({ id: book.id, li });
        }
        void this.fillFormats(missing);
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
    this.el.results.replaceChildren(details, ...this.requestPart(book.id, book.title, book.format));
    this.setStatus(`Book details: ${book.title}`);
  }

  /** "Ask for this book", or what stands in its way. */
  private requestPart(id: string, title: string, format: string): HTMLElement[] {
    if (!format || format === SUGAMYA_NOT_AVAILABLE || !sugamyaFormatReadable(format) || !sugamyaFormatId(format)) {
      return [paragraph("Reader can't download this copy. Search for the same title in a DAISY or EPUB format.")];
    }
    if (!this.account) {
      return [
        paragraph('To download this book, sign in with your Sugamya Pustakalaya account.'),
        this.button('Sign in to ask for this book', () => this.show({ kind: 'account' })),
      ];
    }
    const ask = this.button('Ask for this book', async () => {
      ask.disabled = true;
      this.setStatus('Asking Sugamya Pustakalaya…');
      try {
        const reply = await this.api.sugamya.request(id, format);
        const accepted = isSugamyaRequestAccepted(reply);
        const note = paragraph(
          accepted
            ? `${reply} Sugamya Pustakalaya prepares the book, which can take a few hours. When it's ready, ` +
                'it shows in My download requests (and the library sends you an email or SMS); download it from there.'
            : `Sugamya Pustakalaya says: ${reply} ${SUGAMYA_REQUEST_REFUSED}`,
        );
        note.tabIndex = -1;
        if (accepted) ask.replaceWith(note, this.button('My download requests', () => this.show({ kind: 'requests' })));
        else ask.replaceWith(note, this.button('Open the Sugamya Pustakalaya website', () => this.api.sugamya.openWebsite(SUGAMYA_SITE)));
        this.setStatus(reply);
        note.focus();
      } catch (err) {
        this.setStatus(`${title}: ${errorMessage(err)}`);
        ask.disabled = false;
      }
    });
    ask.className = 'catalog-download';
    return [ask];
  }

  /** Sign in, or (when signed in) who is signed in, with Sign out. */
  private renderAccount(): void {
    this.el.heading.textContent = this.account ? 'Your Sugamya Pustakalaya account' : 'Sign in to Sugamya Pustakalaya';
    if (this.account) {
      this.el.results.replaceChildren(
        paragraph(`Signed in as ${this.account.name || this.account.user} (${this.account.user}).`),
        paragraph('Reader keeps your password encrypted on this computer, for this Windows user only.'),
        this.button('My download requests', () => this.show({ kind: 'requests' })),
        this.button('Sign out', async () => {
          await this.api.sugamya.signOut();
          this.account = null;
          await this.show({ kind: 'start' });
          this.setStatus('Signed out of Sugamya Pustakalaya.');
        }),
      );
      return;
    }
    const form = document.createElement('form');
    form.className = 'sugamya-sign-in';
    const field = (label: string, type: string, autocomplete: AutoFill): HTMLInputElement => {
      const id = `ui-sugamya-${type}`;
      const l = document.createElement('label');
      l.htmlFor = id;
      l.textContent = label;
      const input = document.createElement('input');
      input.id = id;
      input.type = type;
      input.autocomplete = autocomplete;
      input.required = true;
      form.append(l, input);
      return input;
    };
    const user = field('User ID or email', 'text', 'username');
    const password = field('Password', 'password', 'current-password');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Sign in';
    form.append(submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      this.setStatus('Signing in…');
      try {
        this.account = await this.api.sugamya.signIn(user.value, password.value);
        password.value = '';
        // Back to where the reader was (a book's details, usually), now with Ask for this book.
        const previous = this.history.pop();
        await this.show(previous ?? { kind: 'start' }, false);
        this.setStatus(`Signed in as ${this.account.name || this.account.user}.`);
      } catch (err) {
        this.setStatus(errorMessage(err));
        submit.disabled = false;
        password.select();
        password.focus();
      }
    });
    this.el.results.replaceChildren(
      paragraph('Sign in with the user ID or email and password of your Sugamya Pustakalaya membership.'),
      form,
      this.button('Forgot your password? (opens the Sugamya Pustakalaya website)', () => this.api.sugamya.openWebsite(SUGAMYA_FORGOT_PASSWORD)),
      this.button('Not a member yet? Join on the Sugamya Pustakalaya website', () => this.api.sugamya.openWebsite(SUGAMYA_JOIN)),
    );
  }

  /** The books the reader asked for; ready ones download into My books. */
  private async renderRequests(): Promise<void> {
    const requests = await this.api.sugamya.requests();
    this.el.heading.textContent = 'My download requests';
    const refresh = this.button('Refresh', () => this.show({ kind: 'requests' }, false));
    if (!requests.length) {
      this.el.results.replaceChildren(paragraph('You have no download requests. Find a book and choose Ask for this book.'), refresh);
      this.setStatus('No download requests.');
      return;
    }
    const list = document.createElement('ul');
    list.className = 'catalog-list';
    for (const r of requests) {
      const format = r.format && r.format !== SUGAMYA_NOT_AVAILABLE ? sugamyaFormatLabel(r.format) : '';
      const detail = [format, r.ready ? 'Ready to download' : r.status || 'Being prepared'].filter(Boolean).join('. ');
      list.append(
        this.entry(r.title, detail, async () => {
          if (!r.ready) return this.setStatus(`${r.title}: not ready yet. Sugamya Pustakalaya is preparing it; choose Refresh later.`);
          await this.download(r.url, r.title);
        }),
      );
    }
    const ready = requests.filter((r) => r.ready).length;
    this.el.results.replaceChildren(
      paragraph('Choose a book that is ready to download it into My books and open it. Download links last 7 days.'),
      list,
      refresh,
    );
    this.setStatus(`${requests.length} ${requests.length === 1 ? 'request' : 'requests'}, ${ready} ready to download.`);
  }

  private async download(url: string, title: string): Promise<void> {
    if (this.downloading) return this.setStatus(`Still downloading ${this.downloading}.`);
    this.downloading = title;
    this.setStatus(`Downloading ${title}…`);
    try {
      const info = await this.api.sugamya.download(url, title);
      this.downloading = '';
      this.el.dialog.close();
      await this.onBook(info);
    } catch (err) {
      this.downloading = '';
      this.setStatus(`Download failed. ${errorMessage(err)}`);
    }
  }

  private button(label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => void onClick());
    return button;
  }

  /**
   * Search results leave out each book's format and language, and each format of a book is a
   * separate entry, so the same title can appear more than once. Look each one up (a few at
   * a time) and add its format and language, so the copies can be told apart.
   */
  private async fillFormats(entries: { id: string; li: HTMLLIElement }[]): Promise<void> {
    const queue = [...entries];
    const page = this.shown;
    const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        if (this.shown !== page) return;
        try {
          const [book] = parseSugamyaBooks(browserPlatform, await this.fetch(sugamyaPath({ kind: 'book', id: next.id }))).items;
          const detail = next.li.querySelector('.catalog-entry-detail');
          if (book && detail) detail.textContent = sugamyaBookSummary(book);
        } catch {
          // The entry keeps what the search gave; the book's page still has every detail.
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
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
    const d = document.createElement('span');
    d.className = 'catalog-entry-detail';
    d.textContent = detail;
    button.append(d);
    button.addEventListener('click', () => void onChoose());
    li.append(button);
    return li;
  }
}

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function paragraph(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

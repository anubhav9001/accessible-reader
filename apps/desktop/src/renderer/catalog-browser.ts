import {
  BUILT_IN_CATALOGS,
  bestDownload,
  readOpdsFeed,
  searchUrl,
  type Catalog,
  type OpdsEntry,
  type OpdsFeed,
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

/**
 * Browses an online OPDS catalogue (Project Gutenberg for now): start page, search,
 * categories, one book's details, and "Download and open".
 */
export class CatalogBrowser {
  private catalog: Catalog = BUILT_IN_CATALOGS[0]!;
  private history: string[] = [];
  private current: string | undefined;
  /** False while another library uses the same window. */
  active = true;

  constructor(
    private readonly el: Elements,
    private readonly api: ReaderApi,
    private readonly onBook: (info: BookInfo) => Promise<void>,
  ) {
    el.searchForm.addEventListener('submit', (event) => {
      if (!this.active) return;
      event.preventDefault();
      const terms = el.searchInput.value.trim();
      if (terms && this.catalog.searchTemplate) void this.load(searchUrl(this.catalog.searchTemplate, terms));
    });
    el.back.addEventListener('click', () => {
      if (!this.active) return;
      const previous = this.history.pop();
      if (previous) void this.load(previous, false);
    });
    el.start.addEventListener('click', () => this.active && void this.load(this.catalog.url));
  }

  open(): void {
    this.el.searchLabel.textContent = `Search ${this.catalog.name}`;
    openDialog(this.el.dialog, () => null);
    // Show the page again: another library may have used the window since.
    void this.load(this.current ?? this.catalog.url, false).then(() => this.el.searchInput.focus());
  }

  private setStatus(message: string): void {
    this.el.status.textContent = message;
  }

  private async load(url: string, remember = true): Promise<void> {
    this.setStatus('Loading…');
    try {
      const feed = readOpdsFeed(browserPlatform, await this.api.fetchCatalog(url), url);
      if (remember && this.current) this.history.push(this.current);
      this.current = url;
      this.render(feed);
    } catch (err) {
      this.setStatus(errorMessage(err));
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => void this.load(url, remember));
      this.el.results.replaceChildren(retry);
      retry.focus();
    }
    this.el.back.disabled = this.history.length === 0;
  }

  private render(feed: OpdsFeed): void {
    const download = bestDownload(feed);
    this.el.heading.textContent = download ? download.entry.title : feed.title || this.catalog.name;
    this.el.results.replaceChildren();

    if (download) {
      this.renderBook(download.entry, download.link.href, download.link.length);
      this.setStatus(`Book details: ${download.entry.title}`);
    } else {
      const list = document.createElement('ul');
      list.className = 'catalog-list';
      for (const entry of feed.entries.filter((e) => e.navigation)) list.append(this.renderEntry(entry));
      this.el.results.append(list);
      if (feed.next) {
        const more = document.createElement('button');
        more.type = 'button';
        more.textContent = 'More results';
        more.addEventListener('click', () => void this.load(feed.next!));
        this.el.results.append(more);
      }
      this.setStatus(feed.entries.length ? `${feed.title}: ${list.children.length} items` : 'Nothing found.');
    }
    // Put the screen reader at the top of the new page.
    this.el.heading.focus();
  }

  private renderEntry(entry: OpdsEntry): HTMLLIElement {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-entry';
    const title = document.createElement('span');
    title.className = 'catalog-entry-title';
    title.textContent = entry.title;
    button.append(title);
    const detail = entry.authors.join(', ') || entry.summary;
    if (detail) {
      const small = document.createElement('span');
      small.className = 'catalog-entry-detail';
      small.textContent = detail;
      button.append(small);
    }
    button.addEventListener('click', () => void this.load(entry.navigation!.href));
    li.append(button);
    return li;
  }

  private renderBook(entry: OpdsEntry, href: string, length: number | undefined): void {
    const details = document.createElement('div');
    details.className = 'catalog-book';
    if (entry.authors.length) details.append(paragraph(`By ${entry.authors.join(', ')}`));
    if (entry.language) details.append(paragraph(`Language: ${entry.language}`));
    if (entry.summary) details.append(paragraph(entry.summary));

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'catalog-download';
    button.textContent = `Download and open${length ? ` (${Math.max(1, Math.round(length / 1024))} KB)` : ''}`;
    button.addEventListener('click', async () => {
      button.disabled = true;
      this.setStatus(`Downloading ${entry.title}…`);
      try {
        const info = await this.api.downloadBook(href, entry.title);
        this.el.dialog.close();
        await this.onBook(info);
      } catch (err) {
        this.setStatus(`Download failed. ${errorMessage(err)}`);
        button.disabled = false;
      }
    });
    details.append(button);
    this.el.results.append(details);
  }
}

/** The main process's message, without the "Error invoking remote method …" wrapper Electron adds. */
function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function paragraph(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

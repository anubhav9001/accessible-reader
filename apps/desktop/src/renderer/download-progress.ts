import { downloadProgressText, downloadStep } from '@accessible-reader/engine';
import type { ReaderApi } from '../shared/api';

/**
 * The online library window's progress bar for a book download (Sugamya Pustakalaya or an OPDS
 * library). It is a real progress bar with its value in words ("40 percent, 12 MB of 30 MB"),
 * so a screen reader can find it and read it, and the status line says how it's going every
 * 10 percent (or every 10 MB when the library doesn't give the size): an audio book can take
 * minutes.
 */
export class DownloadProgress {
  private title = '';
  private step = 0;
  private say: (message: string) => void = () => undefined;

  constructor(
    private readonly el: { box: HTMLElement; label: HTMLElement; bar: HTMLProgressElement },
    api: ReaderApi,
  ) {
    api.onDownloadProgress((received, total) => this.update(received, total));
  }

  /** A download starts; `say` puts a message in the window's status line. */
  start(title: string, say: (message: string) => void): void {
    this.title = title;
    this.step = 0;
    this.say = say;
    this.el.label.textContent = `Downloading ${title}`;
    this.el.bar.removeAttribute('value');
    this.el.bar.setAttribute('aria-valuetext', 'Starting');
    this.el.box.hidden = false;
    say(`Downloading ${title}. Reader will say how it's going.`);
  }

  private update(received: number, total: number): void {
    if (!this.title) return;
    const text = downloadProgressText(received, total);
    if (total > 0) {
      this.el.bar.max = total;
      this.el.bar.value = Math.min(received, total);
    } else {
      this.el.bar.removeAttribute('value');
    }
    this.el.bar.setAttribute('aria-valuetext', text);
    this.el.label.textContent = `Downloading ${this.title}: ${text}`;
    const step = downloadStep(received, total);
    if (step > this.step) {
      this.step = step;
      this.say(received === total ? `${this.title}: downloaded. Opening it…` : `Downloading ${this.title}: ${text}`);
    }
  }

  /** The download ended (done or failed). */
  finish(): void {
    this.title = '';
    this.el.box.hidden = true;
  }
}

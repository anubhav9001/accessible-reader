import { downloadProgressText, downloadStep } from '@accessible-reader/engine';
import type { ReaderApi } from '../shared/api';

/** The least time between spoken progress messages, long enough for one to be heard in full. */
const SAY_EVERY_MS = 3000;

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

  /**
   * Whether Narrator is running. Narrator reads none of the window's live regions, but it reads a
   * focused progress bar each time its value changes (tried in its speech recap), so with
   * Narrator the bar takes focus and changes only when the progress is to be said.
   */
  private narrator = false;
  /** Where focus was before the bar took it, to go back to if the window stays open. */
  private before: HTMLElement | null = null;

  constructor(
    private readonly el: { box: HTMLElement; label: HTMLElement; bar: HTMLProgressElement },
    api: ReaderApi,
  ) {
    api.onDownloadProgress((received, total) => this.update(received, total));
    api.onNarrator((running) => (this.narrator = running));
    void api.narratorRunning().then((running) => (this.narrator = running));
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
    this.saidAt = Date.now();
    say(`Downloading ${title}. Reader will say how it's going.`);
    if (this.narrator) {
      this.before = document.activeElement as HTMLElement | null;
      this.el.bar.tabIndex = -1;
      this.el.bar.focus();
    }
  }

  private update(received: number, total: number): void {
    if (!this.title) return;
    const text = downloadProgressText(received, total);
    const step = downloadStep(received, total);
    const done = total > 0 && received >= total;
    // Every 10 percent, but no closer together than SAY_EVERY_MS: on a short download the steps
    // came every half second, each message cut the last one off, and nothing was heard.
    const sayNow = done || (step > this.step && Date.now() - this.saidAt >= SAY_EVERY_MS);
    // With Narrator reading the focused bar, it changes only when the progress is to be said
    // (its label is its name, which Narrator reads too); otherwise it follows the download.
    if (!this.narrator || sayNow) this.show(received, total, text);
    if (sayNow) {
      this.step = step;
      this.saidAt = Date.now();
      // The title was said at the start; the progress alone is quicker to hear.
      this.say(done ? `${this.title}: downloaded. Opening it…` : text);
    }
  }

  private show(received: number, total: number, text: string): void {
    if (total > 0) {
      this.el.bar.max = total;
      this.el.bar.value = Math.min(received, total);
    } else {
      this.el.bar.removeAttribute('value');
    }
    this.el.bar.setAttribute('aria-valuetext', text);
    // The label is the bar's name: with Narrator reading the focused bar it stays the same, or
    // each step would be read twice (the name, then the value).
    if (!this.narrator) this.el.label.textContent = `Downloading ${this.title}: ${text}`;
  }

  /** When progress was last said, so messages don't come too close to be heard. */
  private saidAt = 0;

  /** The download ended (done or failed). */
  finish(): void {
    this.title = '';
    const hadFocus = document.activeElement === this.el.bar;
    this.el.box.hidden = true;
    this.el.bar.removeAttribute('tabindex');
    // If the window stays open (the download failed), focus goes back to where it was.
    if (hadFocus && this.before?.isConnected) this.before.focus();
    this.before = null;
  }
}

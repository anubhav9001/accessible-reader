import type { ReaderApi } from '../shared/api';

/**
 * Speaking Reader's messages: status lines in the main window and in dialogs.
 *
 * NVDA reads no live region in Reader's window. Chromium raises the events (checked with a
 * WinEvent hook: polite, assertive and new regions alike), and NVDA's speech log shows nothing
 * for any of them, so search results, download progress and every other message were silent with
 * NVDA. So a message goes straight to NVDA when it runs (its controller client, see nvda.ts), and
 * the status line is made not live for it, so a screen reader that does read live regions doesn't
 * hear it twice. Without NVDA, the status line is a polite live region.
 *
 * Narrator reads no live region here either, nor ariaNotify (tried in its speech recap), but it
 * reads a change to the name of the item that has focus. So with Narrator running, the focused
 * item takes the message as its name for the moment, and gets its own name back when focus leaves.
 */

let speech: Pick<ReaderApi['native'], 'say'> | undefined;
let narrator = false;
/** The last message written to each status line, for sayAfterFocus. */
const last = new WeakMap<HTMLElement, string>();

/** Gives this module the way to reach NVDA, and tells it whether Narrator is running. */
export function useSpeech(api: Pick<ReaderApi, 'native' | 'onNarrator' | 'narratorRunning'>): void {
  speech = api.native;
  api.onNarrator((running) => (narrator = running));
  void api.narratorRunning().then((running) => (narrator = running));
}

/** Items whose name is a message for now, with the name to give back (null: none of their own). */
const named = new Map<HTMLElement, string | null>();
let toggle = false;

/** Says a message to Narrator as the name of the item that has focus (see above). */
function nameFocus(message: string): void {
  const focused = document.activeElement;
  // A focused progress bar speaks for itself (see download-progress.ts).
  if (!(focused instanceof HTMLElement) || focused === document.body || focused instanceof HTMLProgressElement) return;
  if (!named.has(focused)) {
    named.set(focused, focused.getAttribute('aria-label'));
    focused.addEventListener(
      'blur',
      () => {
        const own = named.get(focused);
        named.delete(focused);
        if (own === null || own === undefined) focused.removeAttribute('aria-label');
        else focused.setAttribute('aria-label', own);
      },
      { once: true },
    );
  }
  // A hair space alternates at the end, so the same message twice is still a change.
  toggle = !toggle;
  focused.setAttribute('aria-label', message + (toggle ? '\u200a' : ''));
}

/**
 * Writes a message in a status line and makes sure it is spoken. `fresh` empties the line first,
 * so the same message twice is still a change.
 */
export function sayStatus(el: HTMLElement, message: string, fresh = false): void {
  last.set(el, message);
  const write = (live: boolean) => {
    el.setAttribute('aria-live', live ? 'polite' : 'off');
    if (!fresh) {
      el.textContent = message;
      return;
    }
    el.textContent = '';
    setTimeout(() => {
      if (last.get(el) === message) el.textContent = message;
    }, 50);
  };
  if (!message || !speech) return write(true);
  speech.say(message).then(
    (spoken) => {
      // Unless a newer message came meanwhile.
      if (last.get(el) !== message) return;
      write(!spoken);
      if (!spoken && narrator) nameFocus(message);
    },
    () => write(true),
  );
}

/** How long a screen reader takes to start reading a new focus, found by Paperback (30 to 100 ms). */
const AFTER_FOCUS_MS = 300;

/**
 * Says a status line's message again just after focus has moved. A window that writes its status
 * ("Loading…", "20 books found") and then moves focus to its heading had the message cut off: the
 * screen reader started reading it, then read the new focus instead.
 */
export function sayAfterFocus(el: HTMLElement): void {
  const message = last.get(el) ?? el.textContent ?? '';
  if (!message) return;
  setTimeout(() => {
    if (last.get(el) === message || !last.has(el)) sayStatus(el, message, true);
  }, AFTER_FOCUS_MS);
}

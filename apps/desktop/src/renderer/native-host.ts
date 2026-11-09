import type { ReaderApi } from '../shared/api';

/**
 * The page's side of screen reader mode's native Windows text box (main/native-box.ts). An
 * element of the page (the placeholder) stands where the box goes: the box is kept over it,
 * in the page's colours, and hidden whenever something of the page must show over it
 * (dialogs, the menu bar's menus). Focusing the placeholder hands the keyboard to the box.
 */
/** How long after the page's focus moves to the book text the box takes the keyboard (ms). */
const HAND_ON = 150;

export class NativeHost {
  /** The box's cursor, as last reported or set (offsets into the whole book). */
  caret = 0;
  /** Whether the box has the keyboard. */
  focused = false;
  /** Whether screen reader mode is using the box now. */
  active = false;
  private covered = 0;

  constructor(
    private readonly api: ReaderApi['native'],
    readonly placeholder: HTMLElement,
  ) {
    api.onFocused((focused) => (this.focused = focused));
    api.onCaret((offset) => (this.caret = offset));
    // Focus on the placeholder goes on to the box, unless it was only passing through (a
    // command run from the box moves focus elsewhere straight after). Not at once: Chromium tells
    // screen readers about the page's focus a moment later, and NVDA follows whichever it hears
    // last, staying in the page (in browse mode, taking the arrow keys) if that was the page.
    const handOn = () =>
      setTimeout(() => {
        if (this.active && document.hasFocus() && document.activeElement === placeholder) api.focus();
      }, HAND_ON);
    placeholder.addEventListener('focus', handOn);
    // The page getting the keyboard back (switching back to the window) with the book text as
    // its focus: on to the box.
    window.addEventListener('focus', handOn);
    new ResizeObserver(() => this.sync()).observe(placeholder);
    window.addEventListener('resize', () => {
      this.sync();
      this.restyle();
    });
    // Dialogs show over the page, so the box hides while one is open.
    new MutationObserver(() => this.sync()).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  }

  /** Something of the page (the menu bar's menus) is shown over the box's place: hide it meanwhile. */
  cover(on: boolean): void {
    this.covered = Math.max(0, this.covered + (on ? 1 : -1));
    this.sync();
  }

  setActive(on: boolean): void {
    this.active = on;
    this.placeholder.hidden = !on;
    this.sync();
    if (on) this.restyle();
  }

  setText(text: string): Promise<void> {
    return this.api.setText(text);
  }

  setCaret(offset: number): void {
    this.caret = offset;
    this.api.setCaret(offset);
  }

  focus(): void {
    // The box (or another window) has the keyboard: nothing of the page to wait for.
    if (!document.hasFocus()) return this.api.focus();
    // The page has it: focus moves to the placeholder first, then on to the box (see handOn).
    if (document.activeElement !== this.placeholder) this.placeholder.focus();
    setTimeout(() => {
      if (this.active && document.activeElement === this.placeholder) this.api.focus();
    }, HAND_ON);
  }

  say(message: string): void {
    this.api.say(message);
  }

  /** Puts the box over the placeholder (inside its padding), or hides it. */
  sync(): void {
    const el = this.placeholder;
    const visible = this.active && !el.hidden && this.covered === 0 && !document.querySelector('dialog[open]') && el.offsetParent !== null;
    if (!visible) return this.api.layout(false, 0, 0, 0, 0);
    const box = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    const top = parseFloat(css.paddingTop) || 0;
    const bottom = parseFloat(css.paddingBottom) || 0;
    const left = parseFloat(css.paddingLeft) || 0;
    const right = parseFloat(css.paddingRight) || 0;
    const s = window.devicePixelRatio || 1;
    this.api.layout(true, (box.left + left) * s, (box.top + top) * s, (box.width - left - right) * s, (box.height - top - bottom) * s);
  }

  /** The page's text colour, background and font for the box. */
  restyle(): void {
    const css = getComputedStyle(this.placeholder);
    const hex = (color: string) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
      return m ? '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('') : '#000000';
    };
    const face = css.fontFamily.split(',')[0]!.replace(/["']/g, '').trim() || 'Segoe UI';
    this.api.style(hex(css.color), hex(css.backgroundColor), face, parseFloat(css.fontSize) || 18);
  }
}

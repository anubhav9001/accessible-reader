import { DEFAULT_DISPLAY, DISPLAY_CHOICES, displayCss, normalizeDisplay, type DisplaySettings } from '@accessible-reader/web-view';

/** The book text's normal size in px (1.15rem), side margin and line length, as in styles.css. */
const BASE_PX = 18.4;

/**
 * The Display part of Settings: how the book's text looks (shared rules in web-view, display.ts).
 * Builds its controls from the shared list of choices, applies each change at once to the book text,
 * and hands the settings back to be saved.
 */
export class DisplaySettingsView {
  private settings: DisplaySettings;
  private readonly style = document.createElement('style');
  private readonly controls = new Map<keyof DisplaySettings, HTMLInputElement | HTMLSelectElement>();
  private readonly custom: HTMLElement;

  constructor(
    private readonly fieldset: HTMLElement,
    stored: unknown,
    private readonly save: (settings: DisplaySettings) => void,
  ) {
    this.settings = normalizeDisplay(stored);
    this.style.id = 'ui-display-style';
    document.head.append(this.style);

    this.select('font', 'Typeface', DISPLAY_CHOICES.font);
    this.select('size', 'Text size', DISPLAY_CHOICES.size);
    this.check('bold', 'Bold text');
    this.select('line', 'Line spacing', DISPLAY_CHOICES.line);
    this.select('word', 'Space between words', DISPLAY_CHOICES.word);
    this.select('letter', 'Space between letters', DISPLAY_CHOICES.letter);
    this.select('width', 'Line length and margins', DISPLAY_CHOICES.width);
    this.check('justify', "Keep the book's justified text (lines spread to both edges)");
    this.select('colours', 'Text and background colours', DISPLAY_CHOICES.colours);
    this.custom = document.createElement('div');
    this.custom.className = 'ui-display-custom';
    this.colour('fg', 'Text colour');
    this.colour('bg', 'Background colour');
    this.fieldset.append(this.custom);
    this.check('hidePages', 'Hide printed page numbers in the text');
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset display settings';
    reset.addEventListener('click', () => {
      this.settings = { ...DEFAULT_DISPLAY };
      this.changed();
    });
    this.fieldset.append(reset);
    this.apply();
  }

  /** Shows the current settings in the controls (when Settings opens). */
  refresh(): void {
    for (const [key, control] of this.controls) {
      if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = this.settings[key] === true;
      else control.value = String(this.settings[key]);
    }
    this.custom.hidden = this.settings.colours !== 'custom';
  }

  private changed(): void {
    this.refresh();
    this.apply();
    this.save(this.settings);
  }

  private apply(): void {
    this.style.textContent = displayCss('#ui-text', this.settings, BASE_PX, '24px', '46em');
    this.custom.hidden = this.settings.colours !== 'custom';
  }

  private select<K extends keyof DisplaySettings>(key: K, label: string, choices: readonly (readonly [DisplaySettings[K], string])[]): void {
    const id = `ui-display-${key}`;
    const l = document.createElement('label');
    l.htmlFor = id;
    l.textContent = label;
    const s = document.createElement('select');
    s.id = id;
    for (const [value, text] of choices) s.append(new Option(text, String(value)));
    s.value = String(this.settings[key]);
    s.addEventListener('change', () => {
      const raw = s.value;
      const value = typeof DEFAULT_DISPLAY[key] === 'number' ? Number(raw) : raw;
      this.settings = normalizeDisplay({ ...this.settings, [key]: value });
      this.changed();
    });
    this.controls.set(key, s);
    this.fieldset.append(l, s);
  }

  private check(key: 'bold' | 'justify' | 'hidePages', label: string): void {
    const l = document.createElement('label');
    l.className = 'ui-check';
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = this.settings[key];
    c.addEventListener('change', () => {
      this.settings = { ...this.settings, [key]: c.checked };
      this.changed();
    });
    l.append(c, ` ${label}`);
    this.controls.set(key, c);
    this.fieldset.append(l);
  }

  private colour(key: 'fg' | 'bg', label: string): void {
    const id = `ui-display-${key}`;
    const l = document.createElement('label');
    l.htmlFor = id;
    l.textContent = label;
    const c = document.createElement('input');
    c.type = 'color';
    c.id = id;
    c.value = this.settings[key];
    c.addEventListener('change', () => {
      this.settings = normalizeDisplay({ ...this.settings, [key]: c.value });
      this.changed();
    });
    this.controls.set(key, c);
    this.custom.append(l, c);
  }
}

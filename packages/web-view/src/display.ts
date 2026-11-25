import { PAGE_MARKERS } from './document-view.js';

/**
 * How the book's text looks: DAISY's Must-haves for visual adjustment (typeface, bold, text size,
 * line, word and letter spacing, justification off, margins, text and background colours, hiding
 * page numbers). The same settings and the same CSS on Windows and Android; each app stores them
 * (desktop: localStorage; Android: SharedPreferences, as JSON) and applies displayCss to its text.
 */
export interface DisplaySettings {
  /** A typeface, or 'book' for the book's own. */
  font: 'book' | 'sans' | 'serif' | 'readable' | 'mono';
  bold: boolean;
  /** Text size, percent of the app's normal size. */
  size: number;
  /** Line spacing (line-height), or 0 for the app's normal 1.7. */
  line: number;
  /** Extra space between words and between letters, in em. */
  word: number;
  letter: number;
  /** Keep the book's justified lines; off aligns all text to the start of the line. */
  justify: boolean;
  /** How wide the lines of text can be. */
  width: 'full' | 'normal' | 'narrow';
  /** Colours: 'app' follows the app's light or dark theme; 'custom' uses fg and bg. */
  colours: 'app' | 'dark' | 'light' | 'yellow-black' | 'white-black' | 'black-yellow' | 'sepia' | 'custom';
  fg: string;
  bg: string;
  /** Hide printed page numbers in the text. */
  hidePages: boolean;
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  font: 'book',
  bold: false,
  size: 100,
  line: 0,
  word: 0,
  letter: 0,
  justify: false,
  width: 'normal',
  colours: 'app',
  fg: '#000000',
  bg: '#ffffff',
  hidePages: false,
};

/** The choices, with the words each app shows for them. */
export const DISPLAY_CHOICES = {
  font: [
    ['book', "The book's own"],
    ['sans', 'Sans serif (plain)'],
    ['serif', 'Serif'],
    ['readable', 'Wide and readable (Verdana)'],
    ['mono', 'Even width (monospace)'],
  ],
  size: [75, 90, 100, 115, 130, 150, 175, 200, 250, 300].map((n) => [n, `${n} percent`] as const),
  line: [
    [0, 'Normal'],
    [1.2, 'Tight (1.2)'],
    [1.5, '1.5'],
    [2, 'Double (2)'],
    [2.5, '2.5'],
    [3, 'Triple (3)'],
  ],
  word: [
    [0, 'Normal'],
    [0.15, 'Wider'],
    [0.3, 'Widest'],
  ],
  letter: [
    [0, 'Normal'],
    [0.05, 'Wider'],
    [0.12, 'Widest'],
  ],
  width: [
    ['full', 'Full width (narrow margins)'],
    ['normal', 'Normal'],
    ['narrow', 'Narrow column (wide margins)'],
  ],
  colours: [
    ['app', 'Follow the app (light or dark)'],
    ['dark', 'White on black'],
    ['light', 'Black on white'],
    ['yellow-black', 'Yellow on black'],
    ['white-black', 'White on dark blue'],
    ['black-yellow', 'Black on yellow'],
    ['sepia', 'Dark brown on cream (sepia)'],
    ['custom', 'Your own colours'],
  ],
} as const;

const FONTS: Record<Exclude<DisplaySettings['font'], 'book'>, string> = {
  sans: '"Segoe UI", Roboto, "Noto Sans", system-ui, sans-serif',
  serif: 'Georgia, "Noto Serif", "Times New Roman", serif',
  readable: 'Verdana, Tahoma, "DejaVu Sans", sans-serif',
  mono: 'Consolas, "Roboto Mono", "Noto Sans Mono", monospace',
};

const COLOURS: Record<Exclude<DisplaySettings['colours'], 'app' | 'custom'>, [fg: string, bg: string]> = {
  dark: ['#ffffff', '#000000'],
  light: ['#000000', '#ffffff'],
  'yellow-black': ['#ffff00', '#000000'],
  'white-black': ['#ffffff', '#00264d'],
  'black-yellow': ['#000000', '#ffff66'],
  sepia: ['#3b2a1a', '#f6ecd6'],
};

/** Fills in anything missing or out of range, so a stored value from an older version still works. */
export function normalizeDisplay(value: unknown): DisplaySettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<DisplaySettings>;
  const pick = <K extends keyof typeof DISPLAY_CHOICES>(key: K, x: unknown, fallback: DisplaySettings[K & keyof DisplaySettings]) =>
    (DISPLAY_CHOICES[key] as readonly (readonly [unknown, string])[]).some(([c]) => c === x) ? (x as typeof fallback) : fallback;
  const colour = (x: unknown, fallback: string) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : fallback);
  return {
    font: pick('font', v.font, DEFAULT_DISPLAY.font),
    bold: v.bold === true,
    size: pick('size', v.size, DEFAULT_DISPLAY.size),
    line: pick('line', v.line, DEFAULT_DISPLAY.line),
    word: pick('word', v.word, DEFAULT_DISPLAY.word),
    letter: pick('letter', v.letter, DEFAULT_DISPLAY.letter),
    justify: v.justify === true,
    width: pick('width', v.width, DEFAULT_DISPLAY.width),
    colours: pick('colours', v.colours, DEFAULT_DISPLAY.colours),
    fg: colour(v.fg, DEFAULT_DISPLAY.fg),
    bg: colour(v.bg, DEFAULT_DISPLAY.bg),
    hidePages: v.hidePages === true,
  };
}

/** The text and background colours chosen, or undefined to follow the app's theme. */
export function displayColours(s: DisplaySettings): { fg: string; bg: string } | undefined {
  if (s.colours === 'app') return undefined;
  if (s.colours === 'custom') return { fg: s.fg, bg: s.bg };
  const [fg, bg] = COLOURS[s.colours];
  return { fg, bg };
}

/**
 * The CSS for the book's text under `scope` (a selector such as "#ui-text"). Rules use !important,
 * as a reader's own settings must win over the book's styles. `base` is the app's normal text size
 * in px, `pad` its smallest side margin and `normalWidth` its normal line length.
 */
export function displayCss(scope: string, s: DisplaySettings, base: number, pad = '24px', normalWidth = '46em'): string {
  const all = `${scope}, ${scope} *`;
  const rules: string[] = [];
  // The book's own sizes (headings larger, notes smaller) stay in proportion to this.
  rules.push(`${scope} { font-size: ${Math.round(base * s.size) / 100}px !important; }`);
  if (s.font !== 'book') rules.push(`${all} { font-family: ${FONTS[s.font]} !important; }`);
  if (s.bold) rules.push(`${all} { font-weight: bold !important; }`);
  if (s.line) rules.push(`${all} { line-height: ${s.line} !important; }`);
  if (s.word) rules.push(`${all} { word-spacing: ${s.word}em !important; }`);
  if (s.letter) rules.push(`${all} { letter-spacing: ${s.letter}em !important; }`);
  if (!s.justify) rules.push(`${all} { text-align: start !important; text-align-last: auto !important; hyphens: manual !important; }`);
  // The line length, as side margins that keep the text in a centred column.
  const width = s.width === 'narrow' ? '34em' : normalWidth;
  const side = s.width === 'full' ? pad : `max(${pad}, calc((100% - ${width}) / 2))`;
  rules.push(`${scope} { padding-left: ${side} !important; padding-right: ${side} !important; }`);
  const colours = displayColours(s);
  if (colours) {
    rules.push(`${scope} { color: ${colours.fg} !important; background: ${colours.bg} !important; }`);
    // The book's own colours and backgrounds give way; links stay underlined to be told apart.
    rules.push(`${scope} * { color: inherit !important; background-color: transparent !important; border-color: currentColor !important; }`);
    rules.push(`${scope} a { text-decoration: underline !important; }`);
    // The reading highlight keeps its own colours (each app's .current-phrase).
    rules.push(`${scope} .current-phrase, ${scope} .current-phrase * { color: var(--highlight-fg) !important; background-color: var(--highlight-bg) !important; }`);
  }
  if (s.hidePages) rules.push(`${scope} :is(${PAGE_MARKERS}), ${scope} .pagebreak { display: none !important; }`);
  return rules.join('\n');
}

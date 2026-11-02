import {
  NarrationTimeline,
  currentHeading,
  currentPage,
  defaultReadingMode,
  findPage,
  flattenToc,
  nextHeading,
  nextPage,
  previousHeading,
  previousPage,
  readingModes,
  type AudioSource,
  type ModeOption,
  type NavItem,
  type ReadingMode,
  type Resource,
  type TextRef,
} from '@accessible-reader/engine';
import type { BookInfo, Command, ReaderApi } from '../shared/api';
import { DocumentView } from '@accessible-reader/web-view';
import { CatalogBrowser } from './catalog-browser';
import { LibraryView } from './library-view';
import { RecordedPlayer } from './recorded-player';
import { SpeechPlayer } from './speech-player';

declare global {
  interface Window {
    reader: ReaderApi;
    readerDebug: unknown;
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  title: $('ui-title'),
  meta: $('ui-meta'),
  library: $<HTMLButtonElement>('ui-library'),
  open: $<HTMLButtonElement>('ui-open'),
  catalogs: $<HTMLButtonElement>('ui-catalogs'),
  play: $<HTMLButtonElement>('ui-play'),
  prevHeading: $<HTMLButtonElement>('ui-prev-heading'),
  prevPhrase: $<HTMLButtonElement>('ui-prev-phrase'),
  nextPhrase: $<HTMLButtonElement>('ui-next-phrase'),
  nextHeading: $<HTMLButtonElement>('ui-next-heading'),
  goto: $<HTMLButtonElement>('ui-goto'),
  speed: $<HTMLSelectElement>('ui-speed'),
  modes: $<HTMLFieldSetElement>('ui-modes'),
  toc: $('ui-toc'),
  tocTree: $('ui-toc-tree'),
  nowHeading: $('ui-now-heading-text'),
  nowPage: $('ui-now-page'),
  nowTime: $('ui-now-time'),
  text: $('ui-text'),
  audioOnly: $('ui-audio-only'),
  status: $('ui-status'),
  gotoDialog: $<HTMLDialogElement>('ui-goto-dialog'),
  gotoInput: $<HTMLInputElement>('ui-goto-input'),
};

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const MODE_LABELS: Record<ReadingMode, string> = { text: 'Text only', audio: 'Audio only', textAudio: 'Text and audio' };
const FORMAT_LABELS = { epub: 'EPUB', daisy3: 'DAISY 3', daisy202: 'DAISY 2.02' };

const bookUrl = (path: string) => `reader://book/${path.split('/').map(encodeURIComponent).join('/')}`;

let book: BookInfo | undefined;
let timeline = new NarrationTimeline([]);
let modes: ModeOption[] = [];
let mode: ReadingMode = 'text';
let clipIndex = 0;
let headingLevel = 0;
let rate = 1;
let recorded: RecordedPlayer | undefined;
let tocLinks: { item: NavItem; link: HTMLAnchorElement }[] = [];

const view = new DocumentView(ui.text, bookUrl, (target) => void goToText(target, true));
const speech = new SpeechPlayer({ block: onSpeechBlock, state: onPlayState, finished: () => void onSpeechFinished() });
const library = new LibraryView(
  {
    dialog: $<HTMLDialogElement>('ui-library-dialog'),
    heading: $('ui-library-heading'),
    status: $('ui-library-status'),
    list: $('ui-library-list'),
  },
  window.reader,
  (info) => openBook(info),
);
const catalogs = new CatalogBrowser(
  {
    dialog: $<HTMLDialogElement>('ui-catalog'),
    heading: $('ui-catalog-heading'),
    searchForm: $<HTMLFormElement>('ui-catalog-search'),
    searchLabel: $('ui-catalog-search-label'),
    searchInput: $<HTMLInputElement>('ui-catalog-input'),
    back: $<HTMLButtonElement>('ui-catalog-back'),
    start: $<HTMLButtonElement>('ui-catalog-start'),
    status: $('ui-catalog-status'),
    results: $('ui-catalog-results'),
  },
  window.reader,
  (info) => openBook(info),
);

// ---- status -------------------------------------------------------------------------

/** Speaks a short message through the screen reader (polite live region). */
function announce(message: string): void {
  ui.status.textContent = '';
  setTimeout(() => (ui.status.textContent = message), 50);
}

function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

function spokenDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return [h && `${h} hour${h === 1 ? '' : 's'}`, `${m} minute${m === 1 ? '' : 's'}`].filter(Boolean).join(' ');
}

// ---- helpers ------------------------------------------------------------------------

function audioSource(): AudioSource {
  return modes.find((m) => m.mode === mode)?.audioSource ?? 'none';
}

function isPlaying(): boolean {
  return !!recorded?.isPlaying || speech.isPlaying;
}

function textResource(path: string): Resource | undefined {
  return book?.readingOrder.find((r) => r.path.toLowerCase() === path.toLowerCase());
}

/** The text location of a clip, when it is in a displayable document (not the DAISY 2.02 NCC). */
function textForClip(index: number | undefined): TextRef | undefined {
  const text = index === undefined ? undefined : book?.narration[index]?.text;
  return text && textResource(text.path) ? text : undefined;
}

function textForTarget(target: TextRef, index: number | undefined): TextRef | undefined {
  return textResource(target.path) ? target : textForClip(index);
}

function usesClips(): boolean {
  return audioSource() === 'recorded' || !book?.readingOrder.length;
}

// ---- opening a book -----------------------------------------------------------------

interface SavedPosition {
  mode: ReadingMode;
  clipIndex: number;
  docPath?: string;
  fragment?: string;
  /** The paragraph (block) within docPath: works for text without ids, and follows the screen reader. */
  block?: number;
}

function positionKey(): string {
  return `position:${book?.metadata.identifier || book?.metadata.title}`;
}

function loadPosition(): SavedPosition | undefined {
  try {
    return JSON.parse(localStorage.getItem(positionKey()) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function savePosition(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const position: SavedPosition = {
      mode,
      clipIndex,
      docPath: view.currentPath,
      fragment: view.current?.id || undefined,
      block: place ? docBlocks().indexOf(place) : undefined,
    };
    try {
      localStorage.setItem(positionKey(), JSON.stringify(position));
    } catch {
      // Storage unavailable: the position is simply not remembered.
    }
  }, 1000);
}

async function openBook(info: BookInfo): Promise<void> {
  recorded?.stop();
  speech.pause();
  view.clear();

  book = info;
  timeline = new NarrationTimeline(info.narration);
  modes = readingModes(info);
  recorded = new RecordedPlayer(info.narration, timeline, bookUrl, {
    clip: onClip,
    state: onPlayState,
    ended: () => announce('End of book'),
  });
  recorded.setRate(rate);

  const saved = loadPosition();
  clipIndex = saved?.clipIndex ?? 0;

  const { metadata } = info;
  ui.title.textContent = metadata.title || 'Untitled book';
  ui.meta.textContent = [
    metadata.authors.length ? `By ${metadata.authors.join(', ')}.` : '',
    metadata.narrators.length ? `Narrated by ${metadata.narrators.join(', ')}.` : '',
    `${FORMAT_LABELS[info.format]}.`,
    metadata.duration ? `${spokenDuration(metadata.duration)}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  document.title = `${ui.title.textContent} – Reader`;
  renderToc();

  const savedOk = saved && modes.find((m) => m.mode === saved.mode)?.available;
  await setMode(savedOk ? saved.mode : defaultReadingMode(info), true);
  if (saved?.docPath && textResource(saved.docPath) && !usesClips()) {
    await showText({ path: saved.docPath, fragment: saved.fragment }, false);
    const el = saved.block === undefined ? undefined : docBlocks()[saved.block];
    if (el) {
      view.highlightElement(el);
      setPlace(el);
    }
  }
  updateNow();
  announce(`Opened ${ui.title.textContent}. ${MODE_LABELS[mode]} mode. Press Control Space to play.`);
  window.reader.bookReady();
}

function renderToc(): void {
  tocLinks = [];
  const build = (items: NavItem[]): HTMLUListElement => {
    const list = document.createElement('ul');
    for (const item of items) {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = item.label || 'Untitled';
      link.addEventListener('click', (event) => {
        event.preventDefault();
        void goToNav(item);
      });
      tocLinks.push({ item, link });
      li.append(link);
      if (item.children.length) li.append(build(item.children));
      list.append(li);
    }
    return list;
  };
  ui.tocTree.replaceChildren(book?.toc.length ? build(book.toc) : document.createTextNode('This book has no table of contents.'));
}

// ---- modes --------------------------------------------------------------------------

async function setMode(next: ReadingMode, quiet = false): Promise<void> {
  const option = modes.find((m) => m.mode === next);
  if (!book || !option) return;
  if (!option.available) {
    announce(option.reason ?? `${MODE_LABELS[next]} is not available for this book.`);
    syncModeUi();
    return;
  }
  const wasPlaying = isPlaying();
  recorded?.pause();
  speech.pause();

  // Carry the position across: from the device-voice block back to a clip, or the other way.
  if (mode !== next && !usesClips() && view.current) {
    const id = view.current.id || view.current.querySelector('[id]')?.id;
    const match = id ? book.narration.find((c) => c.text?.fragment === id) : undefined;
    if (match) clipIndex = match.index;
  }
  mode = next;

  ui.text.hidden = mode === 'audio';
  ui.audioOnly.hidden = mode !== 'audio';
  if (book.readingOrder.length) {
    await showText(textForClip(clipIndex) ?? { path: view.currentPath ?? book.readingOrder[0]!.path }, false);
  }
  syncModeUi();
  updateNow();
  if (!quiet) announce(`${MODE_LABELS[mode]} mode`);
  if (wasPlaying) await play();
}

function syncModeUi(): void {
  const available = { text: false, audio: false, textAudio: false };
  for (const m of modes) available[m.mode] = m.available;
  for (const input of Array.from(ui.modes.querySelectorAll<HTMLInputElement>('input[name="mode"]'))) {
    const m = input.value as ReadingMode;
    input.checked = m === mode;
    input.disabled = !available[m];
  }
  window.reader.modeChanged({ mode, available });
}

// ---- text display -------------------------------------------------------------------

async function showText(ref: TextRef, focus: boolean): Promise<HTMLElement | undefined> {
  const resource = textResource(ref.path);
  if (!resource) return undefined;
  await view.show(resource.path, resource.mediaType);
  const el = ref.fragment ? view.highlight(ref.fragment) : undefined;
  if (!ref.fragment) view.highlightElement(undefined);
  setPlace(blockOf(el) ?? docBlocks()[0]);
  if (focus) view.focus(el);
  return el;
}

// ---- the reader's place -------------------------------------------------------------

// The paragraph the reader is at. The app's own reading moves it, and so does a screen
// reader reading the text by itself, which the app learns from focus and scrolling. It is
// the one Tab stop in the text, so tabbing in (or Control E) lands there, and Play starts there.
let place: HTMLElement | undefined;
let blocksCache: { path: string; blocks: HTMLElement[] } | undefined;

function docBlocks(): HTMLElement[] {
  if (!view.currentPath) return [];
  if (blocksCache?.path !== view.currentPath) blocksCache = { path: view.currentPath, blocks: view.blocks() };
  return blocksCache.blocks;
}

function blockOf(el: Element | undefined): HTMLElement | undefined {
  const blocks = docBlocks();
  return el && blocks.length ? blocks[blockIndexFor(blocks, el)] : undefined;
}

function setPlace(el: HTMLElement | undefined): void {
  if (el === place) return;
  if (place?.isConnected) place.tabIndex = -1;
  place = el;
  if (el) el.tabIndex = 0;
  savePosition();
}

function focusPlace(): void {
  if (place?.isConnected) place.focus();
  else view.focus();
}

function isOnScreen(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect();
  const area = ui.text.getBoundingClientRect();
  return box.bottom > area.top && box.top < area.bottom;
}

let tabbing = false;
document.addEventListener('keydown', (event) => (tabbing = event.key === 'Tab'), true);
document.addEventListener('mousedown', () => (tabbing = false), true);

ui.text.addEventListener('focusin', (event) => {
  const target = event.target as HTMLElement;
  const from = event.relatedTarget as Node | null;
  // Tabbing in from outside goes to the place, not to the first link in the chapter.
  if (tabbing && !(from && ui.text.contains(from)) && place?.isConnected && target !== place) {
    tabbing = false;
    place.focus();
    return;
  }
  if (target !== ui.text && !isPlaying()) setPlace(blockOf(target));
});

// NVDA and JAWS scroll the text to keep their reading cursor in view. Once the place has
// left the screen, the first paragraph still on screen becomes the place: the reader may
// hear a few lines again, but never misses any.
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
ui.text.addEventListener(
  'scroll',
  () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (isPlaying() || (place?.isConnected && isOnScreen(place))) return;
      const first = docBlocks().find(isOnScreen);
      if (first) setPlace(first);
    }, 250);
  },
  { passive: true },
);

/** Index of the block holding (or following) an element. */
function blockIndexFor(blocks: readonly HTMLElement[], el: Element | undefined): number {
  if (!el) return 0;
  const i = blocks.findIndex((b) => b === el || b.contains(el) || el.contains(b));
  if (i >= 0) return i;
  const after = blocks.findIndex((b) => el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  return after >= 0 ? after : blocks.length - 1;
}

/** Makes sure the device-voice player holds the blocks of the document on screen. */
function syncSpeech(): void {
  if (!view.currentPath) return;
  if (speech.docPath !== view.currentPath) {
    const blocks = view.blocks();
    speech.load(view.currentPath, blocks, blockIndexFor(blocks, view.current), view.lang);
  }
}

async function goToText(ref: TextRef, focus: boolean): Promise<void> {
  const el = await showText(ref, focus);
  if (usesClips()) {
    const match = book?.narration.find(
      (c) => c.text && c.text.path.toLowerCase() === ref.path.toLowerCase() && (!ref.fragment || c.text.fragment === ref.fragment),
    );
    if (match) recorded?.seek(match.index);
    return;
  }
  syncSpeech();
  speech.jump(blockIndexFor(speech.elements, el));
}

// ---- playback -----------------------------------------------------------------------

async function play(): Promise<void> {
  if (!book) return;
  const source = audioSource();
  if (source === 'recorded') {
    await recorded?.play(clipIndex);
  } else if (source === 'tts') {
    if (!view.currentPath) await showText({ path: book.readingOrder[0]!.path }, false);
    syncSpeech();
    // Start where the reader is, which may be where the screen reader got to.
    speech.jump(blockIndexFor(speech.elements, place ?? view.current));
    speech.play();
  } else {
    announce('There is nothing to play in this mode.');
  }
}

function togglePlay(): void {
  if (isPlaying()) {
    recorded?.pause();
    speech.pause();
  } else {
    void play();
  }
}

function onPlayState(playing: boolean): void {
  ui.play.textContent = playing ? 'Pause' : 'Play';
}

function onClip(index: number): void {
  clipIndex = index;
  if (mode === 'textAudio') {
    const text = textForClip(index);
    if (text) void showText(text, false);
  }
  updateNow();
  savePosition();
}

function onSpeechBlock(_index: number, el: HTMLElement): void {
  view.highlightElement(el);
  setPlace(el);
  // When stepping by hand, move the screen reader to the new phrase; never while reading aloud.
  if (!speech.isPlaying) view.focus(el);
  updateNow();
  savePosition();
}

async function onSpeechFinished(): Promise<void> {
  const order = book?.readingOrder ?? [];
  const i = order.findIndex((r) => r.path === view.currentPath);
  const next = order[i + 1];
  if (!next) {
    speech.pause();
    announce('End of book');
    return;
  }
  await view.show(next.path, next.mediaType);
  speech.load(next.path, view.blocks(), 0, view.lang);
  speech.play();
}

// ---- navigation ---------------------------------------------------------------------

async function goToNav(item: { label: string; target: TextRef; clipIndex?: number }): Promise<void> {
  if (usesClips() && item.clipIndex !== undefined) {
    recorded?.seek(item.clipIndex);
    if (!isPlaying()) announce(item.label);
    return;
  }
  const ref = textForTarget(item.target, item.clipIndex);
  if (ref) await goToText(ref, !isPlaying());
}

function stepPhrase(direction: 1 | -1): void {
  if (!book) return;
  if (usesClips()) {
    const next = timeline.nextAudible(clipIndex, direction);
    if (next === undefined) return announce(direction > 0 ? 'End of book' : 'Start of book');
    recorded?.seek(next);
    return;
  }
  syncSpeech();
  const target = speech.position + direction;
  if (target < 0 || target >= speech.elements.length) {
    announce(direction > 0 ? 'End of section' : 'Start of section');
    return;
  }
  speech.jump(target);
}

function headingLevelOf(el: HTMLElement): number | undefined {
  const m = /^h([1-6])$/i.exec(el.tagName);
  return m ? Number(m[1]) : undefined;
}

async function stepHeading(direction: 1 | -1): Promise<void> {
  if (!book) return;
  const level = headingLevel || undefined;
  if (usesClips()) {
    const item = direction > 0 ? nextHeading(book, clipIndex, level) : previousHeading(book, clipIndex, level);
    if (!item) return announce(direction > 0 ? 'No next heading' : 'No previous heading');
    await goToNav(item);
    return;
  }
  syncSpeech();
  const blocks = speech.elements;
  for (let i = speech.position + direction; i >= 0 && i < blocks.length; i += direction) {
    const l = headingLevelOf(blocks[i]!);
    if (l !== undefined && (level === undefined || l <= level)) {
      speech.jump(i);
      if (speech.isPlaying) announce(blocks[i]!.textContent?.trim() ?? '');
      return;
    }
  }
  // No more headings here: continue at the start of the next document, or report the edge.
  const order = book.readingOrder;
  const next = order[order.findIndex((r) => r.path === view.currentPath) + direction];
  if (direction > 0 && next) await goToText({ path: next.path }, !speech.isPlaying);
  else announce(direction > 0 ? 'No next heading' : 'No previous heading');
}

async function stepPage(direction: 1 | -1): Promise<void> {
  if (!book) return;
  if (usesClips()) {
    const page = direction > 0 ? nextPage(book, clipIndex) : previousPage(book, clipIndex);
    if (!page) return announce(direction > 0 ? 'No next page' : 'No previous page');
    await goToNav({ ...page, label: `Page ${page.label}` });
    return;
  }
  syncSpeech();
  const here = speech.elements[speech.position];
  const markers = view.pageMarkers();
  const isAfter = (m: Element) => !!here && !!(here.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) && !here.contains(m);
  const marker = direction > 0 ? markers.find(isAfter) : [...markers].reverse().find((m) => !isAfter(m) && !here?.contains(m));
  if (!marker) return announce(direction > 0 ? 'No next page in this section' : 'No previous page in this section');
  speech.jump(blockIndexFor(speech.elements, marker));
  announce(marker.getAttribute('aria-label') ?? `Page ${marker.textContent?.trim()}`);
}

function goToPagePrompt(): void {
  if (!book) return;
  if (!book.pageList.length) return announce('This book has no page numbers.');
  ui.gotoInput.value = '';
  ui.gotoDialog.showModal();
}

ui.gotoDialog.addEventListener('close', () => {
  if (ui.gotoDialog.returnValue !== 'go' || !book) return;
  const page = findPage(book, ui.gotoInput.value);
  if (!page) return announce(`Page ${ui.gotoInput.value} not found`);
  void goToNav({ ...page, label: `Page ${page.label}` });
});

// ---- where am I ---------------------------------------------------------------------

function domHeading(): string | undefined {
  const blocks = speech.elements.length ? speech.elements : view.blocks();
  for (let i = blockIndexFor(blocks, view.current); i >= 0; i--) {
    if (blocks[i] && headingLevelOf(blocks[i]!) !== undefined) return blocks[i]!.textContent?.trim();
  }
  return undefined;
}

function location(): { heading?: string; page?: string; time?: string } {
  if (!book) return {};
  if (usesClips()) {
    const page = currentPage(book, clipIndex);
    return {
      heading: currentHeading(book, clipIndex)?.label,
      page: page && `Page ${page.label}`,
      time: timeline.duration > 0 ? `${formatTime(timeline.startOf(clipIndex))} of ${formatTime(timeline.duration)}` : undefined,
    };
  }
  return { heading: domHeading() };
}

function updateNow(): void {
  const { heading, page, time } = location();
  ui.nowHeading.textContent = heading ?? '';
  ui.nowPage.textContent = page ?? '';
  ui.nowTime.textContent = time ?? '';
  const current = usesClips() && book ? currentHeading(book, clipIndex) : undefined;
  for (const { item, link } of tocLinks) {
    if (item === current) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

function whereAmI(): void {
  if (!book) return announce('No book open. Press Control B for My books, or Control O to open a book.');
  const { heading, page, time } = location();
  announce(
    [heading, page, time, `${MODE_LABELS[mode]} mode`, `speed ${rate}`, isPlaying() ? 'playing' : 'paused']
      .filter(Boolean)
      .join('. '),
  );
}

// ---- settings -----------------------------------------------------------------------

function setRate(next: number): void {
  rate = next;
  recorded?.setRate(rate);
  speech.setRate(rate);
  ui.speed.value = String(rate);
  announce(`Speed ${rate}`);
}

function stepRate(direction: 1 | -1): void {
  const i = RATES.indexOf(rate);
  const next = RATES[Math.min(RATES.length - 1, Math.max(0, i + direction))]!;
  if (next !== rate) setRate(next);
}

function showHelp(): void {
  const dialog = $<HTMLDialogElement>('ui-help');
  if (!dialog.open) dialog.showModal();
  $('ui-help-title').focus();
}

function focusToc(): void {
  const current = tocLinks.find(({ link }) => link.hasAttribute('aria-current'))?.link ?? tocLinks[0]?.link;
  if (current) current.focus();
  else ui.toc.focus();
}

// ---- commands -----------------------------------------------------------------------

async function openFromDialog(): Promise<void> {
  const info = await window.reader.openBookDialog();
  if (info) await openBook(info);
}

function handle(command: Command): void {
  if (command.startsWith('level-')) {
    headingLevel = Number(command.slice(6));
    announce(headingLevel ? `Navigate by heading level ${headingLevel} and above` : 'Navigate by all heading levels');
    return;
  }
  if (command === 'open') return void openFromDialog();
  if (command === 'library') return void library.open();
  if (command === 'catalogs') return catalogs.open();
  if (command === 'help') return showHelp();
  if (!book) return announce('No book open. Press Control B for My books, or Control O to open a book.');
  switch (command) {
    case 'toggle-play':
      return togglePlay();
    case 'next-phrase':
      return stepPhrase(1);
    case 'prev-phrase':
      return stepPhrase(-1);
    case 'next-heading':
      return void stepHeading(1);
    case 'prev-heading':
      return void stepHeading(-1);
    case 'next-page':
      return void stepPage(1);
    case 'prev-page':
      return void stepPage(-1);
    case 'goto-page':
      return goToPagePrompt();
    case 'faster':
      return stepRate(1);
    case 'slower':
      return stepRate(-1);
    case 'mode-text':
      return void setMode('text');
    case 'mode-audio':
      return void setMode('audio');
    case 'mode-textAudio':
      return void setMode('textAudio');
    case 'focus-toc':
      return focusToc();
    case 'focus-text':
      return mode === 'audio' ? announce('The text is hidden in audio only mode.') : focusPlace();
    case 'where-am-i':
      return whereAmI();
  }
}

// ---- wiring -------------------------------------------------------------------------

// The page carries a warning for when it is opened outside the app (e.g. in a plain browser).
document.getElementById('ui-not-app')?.remove();

for (const r of RATES) ui.speed.add(new Option(`${r}×`, String(r), r === 1, r === 1));
ui.speed.addEventListener('change', () => setRate(Number(ui.speed.value)));
ui.library.addEventListener('click', () => handle('library'));
ui.open.addEventListener('click', () => handle('open'));
ui.catalogs.addEventListener('click', () => handle('catalogs'));
ui.play.addEventListener('click', () => handle('toggle-play'));
ui.prevHeading.addEventListener('click', () => handle('prev-heading'));
ui.prevPhrase.addEventListener('click', () => handle('prev-phrase'));
ui.nextPhrase.addEventListener('click', () => handle('next-phrase'));
ui.nextHeading.addEventListener('click', () => handle('next-heading'));
ui.goto.addEventListener('click', () => handle('goto-page'));
ui.modes.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  if (input.name === 'mode') void setMode(input.value as ReadingMode);
});
window.reader.onCommand(handle);

window.readerDebug = {
  command: handle,
  state: () => ({
    title: book?.metadata.title,
    mode,
    source: audioSource(),
    clipIndex,
    playing: isPlaying(),
    heading: location().heading,
    page: location().page,
    tocEntries: book ? flattenToc(book.toc).length : 0,
    textLength: ui.text.textContent?.length ?? 0,
    highlighted: view.current?.id,
  }),
};

// Start where the reader left off: the book given on the command line, or else My books.
void window.reader.initialBook().then(async (info) => {
  if (info) await openBook(info);
  else await library.open(true);
});

import { describe, expect, it } from 'vitest';
import {
  MemoryContainer,
  NarrationTimeline,
  ZipContainer,
  currentHeading,
  defaultReadingMode,
  findPage,
  nextHeading,
  openPublication,
  parseClock,
  previousHeading,
  readingModes,
  type Publication,
  type ReadingMode,
} from '../src/index.js';
import { xmldomPlatform } from '../src/platform/xmldom.js';
import { daisy202AudioOnly, daisy202FullText, daisy3, epub3, zip } from './fixtures.js';

const open = (files: Record<string, string | Uint8Array>) =>
  openPublication(ZipContainer.fromBytes(zip(files)), xmldomPlatform);

const available = (pub: Publication) =>
  Object.fromEntries(readingModes(pub).map((m) => [m.mode, m.available ? m.audioSource : 'unavailable'])) as Record<
    ReadingMode,
    string
  >;

describe('parseClock', () => {
  it.each([
    ['npt=12.345s', 12.345],
    ['0:01:02.5', 62.5],
    ['01:02.5', 62.5],
    ['500ms', 0.5],
    ['2min', 120],
    ['1.5h', 5400],
    ['12', 12],
    ['3.5s', 3.5],
  ])('%s → %d seconds', (input, seconds) => {
    expect(parseClock(input)).toBeCloseTo(seconds);
  });

  it('rejects garbage', () => {
    expect(parseClock('soon')).toBeUndefined();
    expect(parseClock(undefined)).toBeUndefined();
  });
});

describe('EPUB 3 with media overlays', () => {
  it('reads metadata, TOC, pages and synced narration', async () => {
    const pub = await open(epub3());
    expect(pub.format).toBe('epub');
    expect(pub.metadata).toMatchObject({
      title: 'Sample EPUB',
      authors: ['A. Writer'],
      narrators: ['R. Voice'],
      language: 'hi',
      identifier: 'urn:isbn:9780000000001',
      duration: 5,
    });
    expect(pub.readingOrder.map((r) => r.path)).toEqual(['OEBPS/text/ch1.xhtml']);
    expect(pub.narration).toHaveLength(3);
    expect(pub.narration[1]).toMatchObject({
      text: { path: 'OEBPS/text/ch1.xhtml', fragment: 's2' },
      audio: { path: 'OEBPS/audio/ch1.mp3', begin: 2, end: 3.5 },
    });

    expect(pub.toc[0]).toMatchObject({ label: 'Chapter 1', level: 1, clipIndex: 0 });
    expect(pub.toc[0]!.children[0]).toMatchObject({ label: 'Section 1.1', level: 2, clipIndex: 1 });
    expect(findPage(pub, ' 1 ')?.clipIndex).toBe(2);

    expect(available(pub)).toEqual({ text: 'tts', audio: 'recorded', textAudio: 'recorded' });
    expect(defaultReadingMode(pub)).toBe('textAudio');

    const timeline = new NarrationTimeline(pub.narration);
    expect(timeline.duration).toBeCloseTo(5);
    expect(timeline.complete).toBe(true);
    expect(timeline.indexAt(2.7)).toBe(1);
    expect(timeline.startOf(2)).toBeCloseTo(3.5);
  });

  it('falls back to device voice when there is no recorded narration', async () => {
    const pub = await open(epub3({ withOverlay: false }));
    expect(pub.narration).toHaveLength(0);
    expect(available(pub)).toEqual({ text: 'tts', audio: 'tts', textAudio: 'tts' });
    expect(defaultReadingMode(pub)).toBe('text');
  });
});

describe('DAISY 3', () => {
  it('reads OPF, NCX and SMIL, merging back-to-back audio clips', async () => {
    const pub = await open(daisy3());
    expect(pub.format).toBe('daisy3');
    expect(pub.metadata).toMatchObject({
      title: 'Sample DAISY 3',
      authors: ['B. Author'],
      narrators: ['C. Reader'],
      multimediaType: 'audioFullText',
      duration: 6,
    });
    expect(pub.readingOrder).toEqual([{ path: 'book/dtbook.xml', mediaType: 'application/x-dtbook+xml' }]);
    expect(pub.narration.map((c) => [c.audio?.begin, c.audio?.end])).toEqual([
      [0, 2.5],
      [2.5, 6],
    ]);

    // The NCX targets a <seq> id and a <par> id inside the SMIL file.
    expect(pub.toc[0]).toMatchObject({ label: 'Part One', clipIndex: 0 });
    expect(pub.toc[0]!.children[0]).toMatchObject({ label: 'Chapter A', clipIndex: 1 });
    expect(pub.pageList[0]).toMatchObject({ label: '1', kind: 'normal', clipIndex: 1 });

    expect(available(pub)).toEqual({ text: 'tts', audio: 'recorded', textAudio: 'recorded' });
    expect(defaultReadingMode(pub)).toBe('textAudio');
  });
});

describe('DAISY 2.02', () => {
  it('opens an audio-only book with an upper-case NCC and windows-1252 text', async () => {
    const pub = await open(daisy202AudioOnly());
    expect(pub.format).toBe('daisy202');
    expect(pub.metadata).toMatchObject({
      title: 'Sample DAISY 2.02 Café',
      authors: ['D. Poet'],
      narrators: ['E. Speaker'],
      duration: 7,
    });
    expect(pub.readingOrder).toEqual([]);
    expect(pub.narration).toHaveLength(3);
    expect(pub.toc).toHaveLength(1);
    expect(pub.toc[0]).toMatchObject({ label: 'Introduction', level: 1, clipIndex: 0 });
    expect(pub.toc[0]!.children[0]).toMatchObject({ label: 'Chapter 1', level: 2, clipIndex: 1 });
    expect(pub.pageList[0]).toMatchObject({ label: '1', kind: 'normal', clipIndex: 2 });

    expect(available(pub)).toEqual({ text: 'unavailable', audio: 'recorded', textAudio: 'unavailable' });
    expect(defaultReadingMode(pub)).toBe('audio');
    expect(new NarrationTimeline(pub.narration).duration).toBeCloseTo(7);
  });

  it('opens a full-text, full-audio book', async () => {
    const pub = await open(daisy202FullText());
    expect(pub.readingOrder.map((r) => r.path)).toEqual(['content.html']);
    expect(pub.toc[0]?.clipIndex).toBe(0);
    expect(available(pub)).toEqual({ text: 'tts', audio: 'recorded', textAudio: 'recorded' });
    expect(defaultReadingMode(pub)).toBe('textAudio');
  });
});

describe('navigation', () => {
  it('moves by heading, optionally limited to a level', async () => {
    const pub = await open(daisy202AudioOnly());
    expect(nextHeading(pub, 0)?.label).toBe('Chapter 1');
    expect(nextHeading(pub, 0, 1)).toBeUndefined();
    expect(previousHeading(pub, 2)?.label).toBe('Chapter 1');
    expect(currentHeading(pub, 2)?.label).toBe('Chapter 1');
  });

  it('works from an unzipped folder too', async () => {
    const pub = await openPublication(new MemoryContainer(daisy3()), xmldomPlatform);
    expect(pub.narration).toHaveLength(2);
  });
});

import type { PublicationData } from './model.js';

/**
 * The three ways of reading a book, as in Thorium:
 * - text: read the text on screen (optionally aloud with the device voice)
 * - audio: listen, navigating by heading/page/phrase, with no text shown
 * - textAudio: listen with the current phrase highlighted in the text
 */
export type ReadingMode = 'text' | 'audio' | 'textAudio';

/** Where the voice comes from: the book's recorded narration, or the device's text-to-speech. */
export type AudioSource = 'recorded' | 'tts' | 'none';

export interface ModeOption {
  mode: ReadingMode;
  available: boolean;
  audioSource: AudioSource;
  /** Why the mode is unavailable, for announcing to the user. */
  reason?: string;
}

export interface BookContent {
  /** The book has readable text beyond headings (a full-text book). */
  hasFullText: boolean;
  /** The book has recorded narration. */
  hasRecordedAudio: boolean;
  /** Recorded narration is synchronised with the full text. */
  hasSyncedAudio: boolean;
}

export function bookContent(pub: PublicationData): BookContent {
  const textPaths = new Set(pub.readingOrder.map((r) => r.path.toLowerCase()));
  const hasRecordedAudio = pub.narration.some((c) => c.audio);
  return {
    hasFullText: pub.readingOrder.length > 0,
    hasRecordedAudio,
    hasSyncedAudio: pub.narration.some((c) => c.audio && c.text && textPaths.has(c.text.path.toLowerCase())),
  };
}

/** Why an eBraille book without recorded narration can't be read aloud: the device voice would read braille cells by their dot numbers. */
export const BRAILLE_NOT_SPOKEN =
  "This is a braille book (eBraille): its text is braille cells, which the device voice can't read aloud. Read it on screen or on a braille display.";

/** How a book is shown: `brailleAsPrint` when an eBraille book's braille is translated to print text. */
export interface ModeContext {
  brailleAsPrint?: boolean;
}

export function readingModes(pub: PublicationData, context: ModeContext = {}): ModeOption[] {
  const { hasFullText, hasRecordedAudio, hasSyncedAudio } = bookContent(pub);
  // eBraille shown as braille: read on screen or a braille display; only recorded narration can be
  // heard. Shown as print text, it is read like any other book.
  if (pub.format === 'ebraille' && !context.brailleAsPrint) {
    return [
      { mode: 'text', available: hasFullText, audioSource: 'none', reason: hasFullText ? undefined : 'This book has no text.' },
      {
        mode: 'audio',
        available: hasRecordedAudio,
        audioSource: hasRecordedAudio ? 'recorded' : 'none',
        reason: hasRecordedAudio ? undefined : BRAILLE_NOT_SPOKEN,
      },
      {
        mode: 'textAudio',
        available: hasSyncedAudio,
        audioSource: hasSyncedAudio ? 'recorded' : 'none',
        reason: hasSyncedAudio ? undefined : BRAILLE_NOT_SPOKEN,
      },
    ];
  }
  const noText = 'This book has no full text, only audio.';
  return [
    {
      mode: 'text',
      available: hasFullText,
      audioSource: hasFullText ? 'tts' : 'none',
      reason: hasFullText ? undefined : noText,
    },
    {
      mode: 'audio',
      available: hasRecordedAudio || hasFullText,
      audioSource: hasRecordedAudio ? 'recorded' : hasFullText ? 'tts' : 'none',
      reason: hasRecordedAudio || hasFullText ? undefined : 'This book has no audio or text to read aloud.',
    },
    {
      mode: 'textAudio',
      available: hasFullText,
      audioSource: hasSyncedAudio ? 'recorded' : hasFullText ? 'tts' : 'none',
      reason: hasFullText ? undefined : noText,
    },
  ];
}

/** The mode a book should open in, following its declared DAISY multimedia type when there is one. */
export function defaultReadingMode(pub: PublicationData, context: ModeContext = {}): ReadingMode {
  const { hasFullText, hasRecordedAudio, hasSyncedAudio } = bookContent(pub);
  if (pub.format === 'ebraille' && !context.brailleAsPrint) return hasFullText ? 'text' : 'audio';
  const type = pub.metadata.multimediaType?.toLowerCase().replace(/[\s_-]/g, '');
  if (type === 'audioonly' || type === 'audioncc' || type === 'audioncx' || !hasFullText) return 'audio';
  if (type === 'textncx' || type === 'textncc' || !hasRecordedAudio) return 'text';
  return hasSyncedAudio ? 'textAudio' : 'text';
}

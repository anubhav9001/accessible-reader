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

export function readingModes(pub: PublicationData): ModeOption[] {
  const { hasFullText, hasRecordedAudio, hasSyncedAudio } = bookContent(pub);
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
export function defaultReadingMode(pub: PublicationData): ReadingMode {
  const { hasFullText, hasRecordedAudio, hasSyncedAudio } = bookContent(pub);
  const type = pub.metadata.multimediaType?.toLowerCase().replace(/[\s_-]/g, '');
  if (type === 'audioonly' || type === 'audioncc' || type === 'audioncx' || !hasFullText) return 'audio';
  if (type === 'textncx' || type === 'textncc' || !hasRecordedAudio) return 'text';
  return hasSyncedAudio ? 'textAudio' : 'text';
}

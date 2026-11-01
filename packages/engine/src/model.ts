import type { Container } from './container.js';

/** The source format a publication was opened from. */
export type BookFormat = 'epub' | 'daisy3' | 'daisy202';

export interface Metadata {
  title: string;
  authors: string[];
  narrators: string[];
  language?: string;
  identifier?: string;
  publisher?: string;
  /** Total narration length in seconds, as declared by the book. */
  duration?: number;
  /** DAISY multimedia type as declared (e.g. audioFullText, audioNcc, textNcx). */
  multimediaType?: string;
}

/** A file inside the book container. Paths are relative to the container root. */
export interface Resource {
  path: string;
  mediaType: string;
}

/** A point in a text document: file path plus optional element id. */
export interface TextRef {
  path: string;
  fragment?: string;
}

/** A slice of an audio file, in seconds. `end` is undefined when the clip runs to the end of the file. */
export interface AudioRef {
  path: string;
  begin: number;
  end?: number;
}

/**
 * One synchronised unit of the book: a phrase of text, a slice of recorded audio, or both.
 * The narration list is the book's spine for audio playback and for text/audio sync.
 */
export interface NarrationClip {
  index: number;
  text?: TextRef;
  audio?: AudioRef;
  /** Where this clip came from, used to resolve DAISY navigation targets (which point into SMIL). */
  smil?: { path: string; ids: string[] };
}

export interface NavItem {
  label: string;
  /** The raw navigation target. For DAISY this usually points into a SMIL file. */
  target: TextRef;
  /** Heading level, 1-based. */
  level: number;
  children: NavItem[];
  /** Index into `Publication.narration`, when the target could be matched to a clip. */
  clipIndex?: number;
}

export type PageKind = 'front' | 'normal' | 'special';

export interface PageTarget {
  label: string;
  target: TextRef;
  kind: PageKind;
  clipIndex?: number;
}

/** Everything about a book except access to its files; safe to send between processes. */
export interface PublicationData {
  format: BookFormat;
  metadata: Metadata;
  /** Text documents in reading order (XHTML for EPUB and DAISY 2.02, DTBook XML for DAISY 3). */
  readingOrder: Resource[];
  toc: NavItem[];
  pageList: PageTarget[];
  narration: NarrationClip[];
}

export interface Publication extends PublicationData {
  container: Container;
}

/** A saved reading position that works in every reading mode. */
export interface Locator {
  clipIndex?: number;
  /** Seconds into the clip's audio. */
  audioOffset?: number;
  text?: TextRef;
}

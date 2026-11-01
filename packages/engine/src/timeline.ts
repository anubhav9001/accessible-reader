import type { NarrationClip } from './model.js';

/**
 * Lays the narration clips end to end on one book-wide clock, so the player can show
 * elapsed and total time, seek to a time, and map a time back to the phrase being read.
 * Clips without recorded audio take no time.
 */
export class NarrationTimeline {
  private readonly starts: number[] = [];
  /** Total length in seconds of all clips with a known end. */
  readonly duration: number;
  /** False when some clip runs to the end of its file, so its length is only known once loaded. */
  readonly complete: boolean;

  constructor(readonly clips: readonly NarrationClip[]) {
    let time = 0;
    let complete = true;
    for (const clip of clips) {
      this.starts.push(time);
      time += this.durationOf(clip.index);
      if (clip.audio && clip.audio.end === undefined) complete = false;
    }
    this.duration = time;
    this.complete = complete;
  }

  durationOf(index: number): number {
    const audio = this.clips[index]?.audio;
    return audio?.end !== undefined ? Math.max(0, audio.end - audio.begin) : 0;
  }

  startOf(index: number): number {
    return this.starts[index] ?? this.duration;
  }

  /** The audible clip playing at `time` seconds into the book. */
  indexAt(time: number): number | undefined {
    let lo = 0;
    let hi = this.clips.length - 1;
    let found: number | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid]! <= time) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // Several silent clips can share a start time; step back to the audible one.
    while (found !== undefined && found >= 0 && !this.clips[found]!.audio) found = found > 0 ? found - 1 : undefined;
    return found;
  }

  /** The next (direction 1) or previous (-1) clip with recorded audio. */
  nextAudible(from: number, direction: 1 | -1 = 1): number | undefined {
    for (let i = from + direction; i >= 0 && i < this.clips.length; i += direction) {
      if (this.clips[i]!.audio) return i;
    }
    return undefined;
  }
}

import type { NarrationClip, NarrationTimeline } from '@accessible-reader/engine';

export interface PlayerEvents {
  clip(index: number): void;
  state(playing: boolean): void;
  ended(): void;
}

/**
 * Plays the book's recorded narration clip by clip. Back-to-back clips in the same file
 * play without seeking, so DAISY narration flows without gaps between phrases.
 */
export class RecordedPlayer {
  private readonly audio = new Audio();
  private src = '';
  private index = 0;
  private playing = false;
  private loading = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private token = 0;
  private rate = 1;

  constructor(
    private readonly clips: readonly NarrationClip[],
    private readonly timeline: NarrationTimeline,
    private readonly url: (path: string) => string,
    private readonly events: PlayerEvents,
  ) {
    this.audio.preservesPitch = true;
    // Clips without an end run to the end of their file.
    this.audio.addEventListener('ended', () => {
      if (this.playing && !this.loading) this.advance();
    });
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  async play(from = this.index): Promise<void> {
    const start = this.clips[from]?.audio ? from : this.timeline.nextAudible(from);
    if (start === undefined) {
      this.events.ended();
      return;
    }
    this.playing = true;
    this.events.state(true);
    this.timer ??= setInterval(this.tick, 40);
    await this.startClip(start);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.token++;
    this.audio.pause();
    clearInterval(this.timer);
    this.timer = undefined;
    this.events.state(false);
  }

  stop(): void {
    this.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.src = '';
  }

  /** Moves to a clip; keeps playing if playing. */
  seek(index: number): void {
    this.index = index;
    if (this.playing) void this.startClip(index);
    else this.events.clip(index);
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.audio.playbackRate = rate;
  }

  private async startClip(index: number): Promise<void> {
    const audio = this.clips[index]?.audio;
    if (!audio) return;
    const token = ++this.token;
    this.index = index;
    this.loading = true;
    this.events.clip(index);
    try {
      const src = this.url(audio.path);
      if (src !== this.src) {
        this.src = src;
        this.audio.src = src;
        await new Promise<void>((resolve, reject) => {
          this.audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
          this.audio.addEventListener('error', () => reject(new Error(`Cannot play ${audio.path}`)), { once: true });
        });
      }
      if (token !== this.token) return;
      this.audio.currentTime = audio.begin;
      this.audio.playbackRate = this.rate;
      await this.audio.play();
    } catch (err) {
      if (token === this.token) {
        console.error(err);
        this.pause();
      }
    } finally {
      if (token === this.token) this.loading = false;
    }
  }

  private readonly tick = () => {
    if (!this.playing || this.loading) return;
    const end = this.clips[this.index]?.audio?.end;
    if (end !== undefined && this.audio.currentTime >= end - 0.02) this.advance();
  };

  private advance(): void {
    const current = this.clips[this.index]?.audio;
    const next = this.timeline.nextAudible(this.index);
    if (next === undefined) {
      this.pause();
      this.events.ended();
      return;
    }
    const upcoming = this.clips[next]!.audio!;
    const continuous =
      current?.end !== undefined &&
      upcoming.path === current.path &&
      Math.abs(upcoming.begin - current.end) < 0.05 &&
      !this.audio.ended;
    if (continuous) {
      this.index = next;
      this.events.clip(next);
    } else {
      void this.startClip(next);
    }
  }
}

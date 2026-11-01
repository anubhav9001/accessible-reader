export interface SpeechEvents {
  block(index: number, element: HTMLElement): void;
  state(playing: boolean): void;
  /** Reached the end of the loaded blocks while playing; the caller loads the next document or stops. */
  finished(): void;
}

/** Reads text blocks aloud with the device's voices (Windows SAPI/OneCore voices in Electron). */
export class SpeechPlayer {
  private blocks: HTMLElement[] = [];
  private index = 0;
  private playing = false;
  private utterance: SpeechSynthesisUtterance | undefined;
  private rate = 1;
  private lang = '';
  /** The document the loaded blocks belong to. */
  docPath: string | undefined;

  constructor(private readonly events: SpeechEvents) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  get position(): number {
    return this.index;
  }

  get elements(): readonly HTMLElement[] {
    return this.blocks;
  }

  load(docPath: string, blocks: HTMLElement[], index: number, lang: string): void {
    this.docPath = docPath;
    this.blocks = blocks;
    this.index = Math.min(Math.max(0, index), Math.max(0, blocks.length - 1));
    this.lang = lang;
  }

  play(): void {
    if (this.blocks.length === 0) {
      this.events.finished();
      return;
    }
    this.playing = true;
    this.events.state(true);
    this.speak();
  }

  pause(): void {
    const was = this.playing;
    this.playing = false;
    this.utterance = undefined;
    speechSynthesis.cancel();
    if (was) this.events.state(false);
  }

  /** Moves to a block; keeps reading if reading. */
  jump(index: number): void {
    if (index < 0 || index >= this.blocks.length) return;
    this.index = index;
    if (this.playing) this.speak();
    else this.events.block(index, this.blocks[index]!);
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (this.playing) this.speak();
  }

  private speak(): void {
    const el = this.blocks[this.index];
    if (!el) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance((el.innerText || el.textContent || '').trim());
    u.rate = this.rate;
    if (this.lang) u.lang = this.lang;
    // cancel() fires `end` on the old utterance too; only the current one may advance.
    u.onend = () => {
      if (this.utterance !== u || !this.playing) return;
      if (this.index + 1 < this.blocks.length) {
        this.index++;
        this.speak();
      } else {
        this.utterance = undefined;
        this.events.finished();
      }
    };
    this.utterance = u;
    this.events.block(this.index, el);
    speechSynthesis.speak(u);
  }
}

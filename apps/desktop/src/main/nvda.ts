import { app } from 'electron';
import * as path from 'node:path';
import type { AppLog } from './log';

/**
 * Speaks through NVDA directly, with NV Access's controller client (vendor/nvda). While the
 * native text box has the keyboard, NVDA reads none of the signals a window can send (the page's
 * live region, name changes, alerts: issue 7), so Reader's messages go this way when NVDA runs.
 */
export class Nvda {
  private api: { testIfRunning(): number; speakText(text: string): number } | undefined;

  private constructor(private readonly log: AppLog) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const k = require('koffi') as typeof import('koffi');
    const dir = app.isPackaged ? path.join(process.resourcesPath, 'nvda') : path.join(app.getAppPath(), 'vendor', 'nvda');
    const lib = k.load(path.join(dir, 'nvdaControllerClient.dll'));
    this.api = {
      testIfRunning: lib.func('uint32 __stdcall nvdaController_testIfRunning()'),
      speakText: lib.func('uint32 __stdcall nvdaController_speakText(str16 text)'),
    };
  }

  /** NVDA's client, or undefined where it can't be loaded (not Windows, or the file is missing). */
  static create(log: AppLog): Nvda | undefined {
    if (process.platform !== 'win32') return undefined;
    try {
      return new Nvda(log);
    } catch (err) {
      log.error('nvda', `NVDA controller client unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  /** Speaks the message if NVDA is running; false when it isn't (or it failed), so Reader can try another way. */
  say(message: string): boolean {
    if (!this.api) return false;
    try {
      if (this.api.testIfRunning() !== 0) return false;
      const error = this.api.speakText(message);
      if (error !== 0) this.log.info('nvda', `NVDA could not speak (${error})`);
      return error === 0;
    } catch (err) {
      this.log.error('nvda', `Speaking through NVDA failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}

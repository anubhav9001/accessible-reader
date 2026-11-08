import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The tester log: a plain text file of what the app did (start, books opened, commands, what
 * it said to the screen reader, mode changes) and every error, so a problem a tester reports
 * can be traced. It is kept in pre-release builds only (versions below 1.0, or with a
 * pre-release tag such as 1.2.0-beta.1, and development runs). It never holds the book's text
 * or full file paths: paths are reduced to their file name.
 *
 * reader.log grows to 1 MB, then becomes reader.old.log and a new reader.log starts.
 */
export class AppLog {
  private readonly file: string;
  private readonly old: string;

  constructor(
    readonly dir: string,
    readonly enabled: boolean,
  ) {
    this.file = path.join(dir, 'reader.log');
    this.old = path.join(dir, 'reader.old.log');
    if (enabled) mkdirSync(dir, { recursive: true });
  }

  write(level: 'info' | 'warn' | 'error', source: string, message: string): void {
    if (!this.enabled) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${source}] ${scrub(message)}\n`;
    try {
      try {
        if (statSync(this.file).size > 1_000_000) renameSync(this.file, this.old);
      } catch {
        // No log yet.
      }
      appendFileSync(this.file, line, 'utf8');
    } catch {
      // Logging must never break the app.
    }
  }

  info(source: string, message: string): void {
    this.write('info', source, message);
  }

  error(source: string, message: string): void {
    this.write('error', source, message);
  }

  /** The first lines of a run: versions and system, to know what the tester was using. */
  start(appVersion: string, versions: NodeJS.ProcessVersions): void {
    this.info(
      'app',
      `Reader ${appVersion} started. Electron ${versions.electron}, Chromium ${versions.chrome}, ` +
        `${os.type()} ${os.release()} ${os.arch()}, ${Math.round(os.totalmem() / 2 ** 30)} GB memory.`,
    );
  }
}

/** Whether this version is a pre-release build that keeps a log. */
export function isPreRelease(version: string, packaged: boolean): boolean {
  return !packaged || /^0\./.test(version) || version.includes('-');
}

/** Full paths name the user's folders; keep only the file name. */
function scrub(message: string): string {
  return message
    .replace(/[A-Za-z]:[\\/][^\s'"<>|]*[\\/]([^\\/\s'"<>|]+)/g, '…/$1')
    .replace(/\/(?:Users|home)\/[^\s'"]*\/([^/\s'"]+)/g, '…/$1')
    .replace(/[\r\n]+/g, ' ⏎ ')
    .slice(0, 2000);
}

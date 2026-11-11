import {
  SUGAMYA_ACCOUNT_API,
  SUGAMYA_WRONG_PASSWORD,
  isSugamyaAuthFailure,
  isSugamyaDownloadUrl,
  parseSugamyaMessage,
  parseSugamyaRequests,
  parseSugamyaUser,
  sugamyaAccountFields,
  sugamyaAccountProblem,
  sugamyaAuthorization,
  sugamyaFormatId,
  type SugamyaAccountCall,
  type SugamyaRequest,
} from '@accessible-reader/engine';
import { xmldomPlatform } from '@accessible-reader/engine/xmldom';
import { net, safeStorage } from 'electron';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppLog } from './log';

/** The reader's Sugamya Pustakalaya account, as the page sees it (never the password). */
export interface SugamyaAccountInfo {
  user: string;
  name: string;
}

interface Saved {
  user: string;
  name: string;
  /** The password, encrypted with Windows' own data protection (safeStorage); base64. */
  password: string;
}

/**
 * The reader's Sugamya Pustakalaya account: sign-in, download requests and downloads. The
 * library has no tokens, so every request carries the reader's user ID and password. The
 * password is kept encrypted with Windows' data protection (only this Windows user can read
 * it), never reaches the page and never goes in the log.
 */
export class SugamyaAccount {
  private saved: Saved | undefined;
  private password = '';

  constructor(
    private readonly file: string,
    private readonly key: string,
    private readonly log: AppLog,
    private readonly userAgent: string,
    /** Development only: a local stand-in for the library (READER_SUGAMYA_TEST_SERVER). */
    private readonly testServer = '',
  ) {}

  private get base(): string {
    return this.testServer || SUGAMYA_ACCOUNT_API;
  }

  async load(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8')) as Saved;
      if (!saved.user || !saved.password || !safeStorage.isEncryptionAvailable()) return;
      this.password = safeStorage.decryptString(Buffer.from(saved.password, 'base64'));
      this.saved = saved;
    } catch {
      // No account saved yet, or it can't be read on this PC: the reader signs in again.
    }
  }

  info(): SugamyaAccountInfo | null {
    return this.saved ? { user: this.saved.user, name: this.saved.name } : null;
  }

  /** Checks the user ID and password with the library and keeps them. Returns the reader's name. */
  async signIn(user: string, password: string): Promise<SugamyaAccountInfo> {
    user = user.trim();
    if (!user || !password) throw new Error('Enter your user ID or email, and your password.');
    const body = await this.post('getUserInfo', user, password);
    const reader = parseSugamyaUser(xmldomPlatform, body);
    if (!reader) throw new Error(parseSugamyaMessage(xmldomPlatform, body) ?? sugamyaAccountProblem('getUserInfo', 404));
    this.password = password;
    this.saved = {
      user,
      name: reader.name,
      password: safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(password).toString('base64') : '',
    };
    // Without Windows' data protection the password is kept for this session only.
    if (this.saved.password) await writeFile(this.file, JSON.stringify(this.saved));
    this.log.info('sugamya', `Signed in${this.saved.password ? '' : ' (password not saved: no data protection)'}.`);
    return { user, name: reader.name };
  }

  async signOut(): Promise<void> {
    this.saved = undefined;
    this.password = '';
    await rm(this.file, { force: true });
    this.log.info('sugamya', 'Signed out.');
  }

  /** Asks the library for a book; returns the library's reply, to show the reader. */
  async requestBook(bookId: string, format: string): Promise<string> {
    const formatId = sugamyaFormatId(format);
    if (!formatId) throw new Error(`Reader doesn't know Sugamya Pustakalaya's format "${format}", so it can't ask for this book.`);
    const body = await this.post('raiseBookDownloadRequest', undefined, undefined, sugamyaAccountFields('raiseBookDownloadRequest', { bookId, formatId }));
    const message = parseSugamyaMessage(xmldomPlatform, body);
    this.log.info('sugamya', `Requested book ${bookId} (format ${formatId}): ${message ?? 'no message'}`);
    if (!message) throw new Error("Sugamya Pustakalaya didn't confirm the request. Check My download requests, or try again later.");
    return message;
  }

  /** The reader's download requests, newest as the library lists them. */
  async requests(): Promise<SugamyaRequest[]> {
    const body = await this.post('fetchUserDownloadRequests', undefined, undefined, sugamyaAccountFields('fetchUserDownloadRequests', { page: 1, limit: 50 }));
    const page = parseSugamyaRequests(xmldomPlatform, body);
    this.log.info('sugamya', `Download requests: ${page.items.length} (${page.items.filter((r) => r.ready).length} ready)${page.message ? `; ${page.message}` : ''}.`);
    return page.items;
  }

  /** Downloads a ready book into `dir`, reporting progress (0 to 1, or -1 when the size is unknown). */
  async download(url: string, title: string, dir: string, progress: (fraction: number) => void): Promise<string> {
    const allowed = isSugamyaDownloadUrl(url) || (!!this.testServer && url.startsWith(this.testServer + '/'));
    if (!allowed) throw new Error("This download link isn't Sugamya Pustakalaya's own secure link, so Reader won't send your password to it.");
    const response = await net.fetch(new URL(url).href, {
      headers: { authorization: this.authorization(), 'user-agent': this.userAgent },
    });
    if (!response.ok || !response.body) {
      this.log.write('warn', 'sugamya', `Download failed: HTTP ${response.status}.`);
      throw new Error(
        response.status === 404 || response.status === 410
          ? 'This download link has expired (links last 7 days). Ask for the book again.'
          : sugamyaAccountProblem('fetchUserDownloadRequests', response.status),
      );
    }
    const total = Number(response.headers.get('content-length')) || 0;
    const type = response.headers.get('content-type') ?? '';
    const ext = /epub/i.test(type) || /\.epub$/i.test(new URL(url).pathname) ? '.epub' : '.zip';
    await mkdir(dir, { recursive: true });
    const safeTitle = title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 80) || 'book';
    const file = path.join(dir, `${safeTitle} ${Date.now()}${ext}`);
    let received = 0;
    const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    body.on('data', (chunk: Buffer) => {
      received += chunk.length;
      progress(total ? received / total : -1);
    });
    try {
      await pipeline(body, createWriteStream(file));
    } catch (err) {
      await rm(file, { force: true });
      this.log.write('warn', 'sugamya', `Download interrupted after ${received} bytes: ${err instanceof Error ? err.message : String(err)}`);
      throw new Error('The download was interrupted. Check the internet connection and try again.');
    }
    this.log.info('sugamya', `Downloaded ${received} bytes (${ext}).`);
    return file;
  }

  private authorization(user = this.saved?.user ?? '', password = this.password): string {
    if (!user || !password) throw new Error('Sign in to Sugamya Pustakalaya first.');
    return sugamyaAuthorization(user, password);
  }

  /**
   * An account request: POST with the reader's Authorization header, and the app's key and
   * the call's fields both as form fields and as headers. The guide lists them all as
   * "name : value", like the Authorization header, without saying where they go; the key works
   * either way, but asking for a book with them in the form only gave the library's error page.
   */
  private async post(call: SugamyaAccountCall, user?: string, password?: string, fields: Record<string, string> = {}): Promise<string> {
    if (!this.key) throw new Error("Sugamya Pustakalaya isn't set up in this copy of Reader.");
    const form = new URLSearchParams({ ...fields, strapikey: this.key });
    let response: globalThis.Response;
    try {
      response = await net.fetch(`${this.base}/${call}`, {
        method: 'POST',
        headers: {
          authorization: this.authorization(user, password),
          ...fields,
          strapikey: this.key,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/xml',
          'user-agent': this.userAgent,
        },
        body: form.toString(),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error('Could not reach Sugamya Pustakalaya. Check the internet connection and try again.');
    }
    const body = await response.text();
    // The library's replies are new to Reader: record what came back (never the request).
    const message = parseSugamyaMessage(xmldomPlatform, body);
    const sent = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
    this.log.info('sugamya', `${call}${sent ? ` (${sent})` : ''}: HTTP ${response.status}, ${/<nalp[\s>]/.test(body) ? 'XML' : 'not XML'}${message ? `, "${message}"` : ''}.`);
    if (isSugamyaAuthFailure(message)) throw new Error(SUGAMYA_WRONG_PASSWORD);
    if (!response.ok || !/<nalp[\s>]/.test(body)) throw new Error(sugamyaAccountProblem(call, response.status));
    return body;
  }
}

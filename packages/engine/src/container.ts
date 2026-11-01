import { unzipSync } from 'fflate';

/**
 * Read-only access to the files of a book. Hosts provide their own implementation
 * (a folder on disk in Electron, app storage on mobile); zip and in-memory versions live here.
 * Lookups fall back to case-insensitive matching because DAISY books made on Windows
 * often reference "ncc.html" while the file is stored as "NCC.HTML".
 */
export interface Container {
  readonly paths: readonly string[];
  /** Returns the stored path for `path`, or undefined when the book has no such file. */
  resolve(path: string): string | undefined;
  has(path: string): boolean;
  readBytes(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
}

export abstract class BaseContainer implements Container {
  private readonly exact: Set<string>;
  private readonly lower = new Map<string, string>();

  constructor(readonly paths: readonly string[]) {
    this.exact = new Set(paths);
    for (const p of paths) {
      if (!this.lower.has(p.toLowerCase())) this.lower.set(p.toLowerCase(), p);
    }
  }

  resolve(path: string): string | undefined {
    return this.exact.has(path) ? path : this.lower.get(path.toLowerCase());
  }

  has(path: string): boolean {
    return this.resolve(path) !== undefined;
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const real = this.resolve(path);
    if (real === undefined) throw new Error(`File not found in book: ${path}`);
    return this.readStored(real);
  }

  async readText(path: string): Promise<string> {
    return decodeText(await this.readBytes(path));
  }

  protected abstract readStored(path: string): Promise<Uint8Array>;
}

export class MemoryContainer extends BaseContainer {
  private readonly files: Map<string, Uint8Array>;

  constructor(files: Record<string, Uint8Array | string>) {
    const encoder = new TextEncoder();
    const entries = Object.entries(files).map(
      ([path, data]) => [path, typeof data === 'string' ? encoder.encode(data) : data] as const,
    );
    super(entries.map(([path]) => path));
    this.files = new Map(entries);
  }

  protected async readStored(path: string): Promise<Uint8Array> {
    return this.files.get(path)!;
  }
}

/** A zipped book held in memory. Entries are inflated one at a time, on demand. */
export class ZipContainer extends BaseContainer {
  private constructor(
    private readonly data: Uint8Array,
    paths: string[],
  ) {
    super(paths);
  }

  static fromBytes(data: Uint8Array): ZipContainer {
    const paths: string[] = [];
    unzipSync(data, {
      filter: (file) => {
        if (!file.name.endsWith('/')) paths.push(file.name);
        return false;
      },
    });
    return new ZipContainer(data, paths);
  }

  protected async readStored(path: string): Promise<Uint8Array> {
    const out = unzipSync(this.data, { filter: (file) => file.name === path });
    return out[path]!;
  }
}

/**
 * A book served over HTTP, e.g. by the mobile app's local server. The host supplies
 * the file list, since a web server cannot be asked for a directory listing.
 */
export class HttpContainer extends BaseContainer {
  constructor(
    private readonly baseUrl: string,
    paths: readonly string[],
  ) {
    super(paths);
  }

  /** The URL of a stored file, with each path segment encoded. */
  url(path: string): string {
    return this.baseUrl.replace(/\/?$/, '/') + path.split('/').map(encodeURIComponent).join('/');
  }

  protected async readStored(path: string): Promise<Uint8Array> {
    const response = await fetch(this.url(path));
    if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

/**
 * Decodes a text file, honouring a BOM or a declared encoding. Older DAISY 2.02 books
 * are often windows-1252 or ISO-8859-1, sometimes without saying so.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));

  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  const declared = (/encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head) ?? /charset\s*=\s*["']?([\w.:-]+)/i.exec(head))?.[1];
  const label = declared?.toLowerCase();
  if (label && label !== 'utf-8' && label !== 'utf8') {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Unknown label: fall through to UTF-8 detection.
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

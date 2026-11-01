import { BaseContainer, ZipContainer, type Container } from '@accessible-reader/engine';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** An unzipped book in a folder on disk (e.g. a DAISY book opened through its ncc.html). */
export class DirectoryContainer extends BaseContainer {
  private constructor(
    private readonly root: string,
    paths: string[],
  ) {
    super(paths);
  }

  static async open(root: string): Promise<DirectoryContainer> {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    const paths = entries
      .filter((e) => e.isFile())
      .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join('/'));
    return new DirectoryContainer(root, paths);
  }

  protected async readStored(stored: string): Promise<Uint8Array> {
    return readFile(path.join(this.root, ...stored.split('/')));
  }
}

/** Opens a book from a .epub/.zip file, or from a DAISY ncc.html / .opf inside a book folder. */
export async function openContainer(file: string): Promise<Container> {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.epub' || ext === '.zip') return ZipContainer.fromBytes(await readFile(file));
  return DirectoryContainer.open(path.dirname(file));
}

/**
 * Keeps the last few files in memory. Audio elements fetch the same file many times
 * (one range request per seek), and inflating it from a zip each time would be slow.
 */
export class FileCache {
  private readonly entries = new Map<string, Uint8Array>();

  constructor(private readonly size = 4) {}

  async get(container: Container, file: string): Promise<Uint8Array> {
    const hit = this.entries.get(file);
    if (hit) {
      this.entries.delete(file);
      this.entries.set(file, hit);
      return hit;
    }
    const bytes = await container.readBytes(file);
    this.entries.set(file, bytes);
    if (this.entries.size > this.size) this.entries.delete(this.entries.keys().next().value!);
    return bytes;
  }

  clear(): void {
    this.entries.clear();
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xhtml': 'application/xhtml+xml',
  '.xml': 'application/xml',
  '.smil': 'application/smil+xml',
  '.ncx': 'application/xml',
  '.opf': 'application/xml',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export function mimeType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

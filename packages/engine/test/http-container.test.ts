import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpContainer, openPublication } from '../src/index.js';
import { xmldomPlatform } from '../src/platform/xmldom.js';
import { daisy202AudioOnly } from './fixtures.js';

describe('HttpContainer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads book files over HTTP, encoding each path segment', async () => {
    const files = daisy202AudioOnly();
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      const path = decodeURIComponent(url.replace('http://127.0.0.1:8080/t/book/', ''));
      const body = files[path];
      return body === undefined
        ? new Response(null, { status: 404 })
        : new Response(typeof body === 'string' ? body : (body as BodyInit));
    });

    const container = new HttpContainer('http://127.0.0.1:8080/t/book', Object.keys(files));
    expect(container.url('my book/a b.smil')).toBe('http://127.0.0.1:8080/t/book/my%20book/a%20b.smil');

    const pub = await openPublication(container, xmldomPlatform);
    expect(pub.narration).toHaveLength(3);
    expect(requested).toContain('http://127.0.0.1:8080/t/book/NCC.HTML');
    await expect(container.readBytes('missing.html')).rejects.toThrow('File not found');
  });
});

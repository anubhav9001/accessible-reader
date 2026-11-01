import type { TextRef } from './model.js';

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

/** Resolves `relative` against the file at `base`, returning a normalised container path. */
export function resolvePath(base: string, relative: string): string {
  let decoded = relative;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    // Keep malformed escapes as written.
  }
  const joined = decoded.startsWith('/') ? decoded.slice(1) : dirname(base) + decoded;
  const out: string[] = [];
  for (const part of joined.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** Resolves an href like "chapter.xhtml#p12" found in the file at `base`. An empty path means `base` itself. */
export function resolveHref(base: string, href: string): TextRef {
  const hash = href.indexOf('#');
  const path = hash < 0 ? href : href.slice(0, hash);
  const fragment = hash < 0 ? undefined : href.slice(hash + 1) || undefined;
  return { path: path === '' ? base : resolvePath(base, path), fragment };
}
